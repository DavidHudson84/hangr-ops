/* Hangr Ops: commercial account health (module A3, admin only).
   Weekly ex-GST sales per Xero contact (Jim Hudson Family Trust) loaded each morning by finance_pull.py into
   fin_account_weekly; account_health() compares each account's recent weeks with its own run-rate and last year.
   Owner, note and watch are edited here (accounts table). */

const ACC_STATUS = {
  stopped: ['Gone quiet', 'var(--bad)', 'no invoice for 5+ weeks (9+ for monthly billers) after regular work'],
  down: ['Down', 'var(--bad)', 'more than 25% below its own run-rate'],
  new: ['New', 'var(--blue)', 'first invoice in the last 16 weeks'],
  up: ['Up', 'var(--good)', 'more than 25% above its run-rate'],
  steady: ['Steady', 'var(--mute)', ''],
  dormant: ['Dormant', 'var(--mute)', 'nothing in either window'],
};
const ACC_ORDER = ['stopped', 'down', 'new', 'up', 'steady', 'dormant'];
const per4 = (v, win) => win ? v * 4 / win : v;

function spark(points, lastw) {
  if (!points?.length) return '';
  const start = addDays(lastw, -175), weeks = [...Array(26)].map((_, i) => addDays(start, i * 7));
  const m = Object.fromEntries(points.map(p => [p.w, +p.a]));
  const vals = weeks.map(w => Math.max(0, m[w] || 0)), mx = Math.max(...vals, 1);
  return `<svg width="104" height="22" viewBox="0 0 104 22" aria-hidden="true">${vals.map((v, i) => `<rect x="${i * 4}" y="${22 - Math.max(v ? 1 : 0, v / mx * 22)}" width="3" height="${Math.max(v ? 1 : 0, v / mx * 22)}" fill="${i >= 22 ? '#2E75B6' : '#a9bfdc'}"/>`).join('')}</svg>`;
}

async function accountsView(filter = 'commercial') {
  app.innerHTML = '<p class="note">Loading accounts…</p>';
  const { data, error } = await sb.rpc('account_health', { p_org: S.org.id });
  if (error) { app.innerHTML = `<div class="card err">${esc(error.message)}</div>`; return; }
  const all = data.rows || [], lastw = data.last_week_end;
  const owners = [...new Set(['Jess', 'Peri', 'Baburam', 'David', ...all.map(r => r.owner).filter(Boolean)])];
  const st = { stream: filter, owner: '', status: '', q: '' };
  const render = () => {
    let rows = all.filter(r => (st.stream === 'all' || r.stream === st.stream) && (!st.owner || (st.owner === '(none)' ? !r.owner : r.owner === st.owner))
      && (!st.status || r.status === st.status) && (!st.q || r.name.toLowerCase().includes(st.q.toLowerCase())));
    rows.forEach(r => { r.r4 = per4(r.recent, r.win); r.n4 = per4(r.norm, r.win); r.gap = r.n4 - r.r4; });
    rows.sort((a, b) => ACC_ORDER.indexOf(a.status) - ACC_ORDER.indexOf(b.status) || ((['down', 'stopped'].includes(a.status) ? b.gap - a.gap : b.r52 - a.r52)));
    const scope = all.filter(r => st.stream === 'all' || r.stream === st.stream);
    const risk = scope.filter(r => r.watch && ['down', 'stopped'].includes(r.status));
    const lost4 = risk.reduce((a, r) => a + per4(r.norm - r.recent, r.win), 0);
    const r12 = scope.reduce((a, r) => a + r.r12, 0), ly12 = scope.reduce((a, r) => a + r.ly12, 0);
    $('#accBody').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="l">Accounts billed in the last year</div><div class="v">${num(scope.filter(r => r.r52 > 0).length)}</div><div class="d mu">${money(scope.reduce((a, r) => a + r.r52, 0))} over 52 weeks</div></div>
      <div class="tile"><div class="l">12 weeks vs last year</div><div class="v">${pctTxt(ly12 ? r12 / ly12 - 1 : null)}</div><div class="d mu">${money(r12)} vs ${money(ly12)}</div></div>
      <div class="tile"><div class="l">Down or gone quiet</div><div class="v ${risk.length ? 'dn' : ''}">${risk.length}</div><div class="d mu">${money(lost4)} a month below their usual</div></div>
      <div class="tile"><div class="l">New</div><div class="v">${scope.filter(r => r.status === 'new').length}</div><div class="d mu">${money(scope.filter(r => r.status === 'new').reduce((a, r) => a + per4(r.recent, r.win), 0))} a month</div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="scroll"><table>
      <tr><th>Account</th><th>Status</th><th>Last 26 weeks</th><th>Recent, a month</th><th>Usual, a month</th><th>Change</th><th>12 wks vs LY</th><th>52 weeks</th><th>Last invoice</th><th>Owner</th><th>Watch</th><th style="text-align:left">Note</th></tr>
      ${rows.map(r => { const s = ACC_STATUS[r.status] || [r.status, '', '']; return `<tr>
        <td style="white-space:normal;min-width:180px">${esc(r.name)}<div class="note">${esc(r.segment || '')}${st.stream === 'all' ? ' · ' + esc(r.stream) : ''}${r.win === 8 ? ' · billed monthly or irregularly' : ''}</div></td>
        <td><span class="chip" style="color:${s[1]}" title="${esc(s[2])}">${s[0]}</span></td>
        <td>${spark(r.spark, lastw)}</td><td>${money(r.r4)}</td><td>${r.n4 ? money(r.n4) : '–'}</td>
        <td>${r.n4 ? pctTxt(r.r4 / r.n4 - 1) : '–'}</td><td>${r.ly12 ? pctTxt(r.r12 / r.ly12 - 1) : '<span class="mu">–</span>'}</td>
        <td>${money(r.r52)}</td><td>${r.last_week ? fmtD(r.last_week) : '–'}</td>
        <td><select data-own="${esc(r.contact_id)}"><option value="">–</option>${owners.map(o => `<option ${o === r.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-watch="${esc(r.contact_id)}" ${r.watch ? 'checked' : ''}></td>
        <td style="text-align:left"><input data-note="${esc(r.contact_id)}" value="${esc(r.note || '')}" placeholder="e.g. called 2 Dec" style="width:170px"></td></tr>`; }).join('')}
    </table></div>
    <p class="note">From Xero (Jim Hudson Family Trust), ex GST, by invoice date, weeks to ${fmtD(lastw)}. "Usual" is the account's own average over the 12 weeks before the recent 4 (or the 24 before the recent 8 for accounts billed monthly or irregularly), so a monthly invoice doesn't read as a drop. Restoration and Dr Drapes lines are split out by account code, so one customer can appear under more than one stream. Untick Watch for one-off or finished accounts (events, Dennison's) so they stop counting as at risk. The Monday email lists the watched commercial accounts that are down or gone quiet.</p></div>`;
    const save = async (id, patch) => { const { error } = await sb.from('accounts').update({ ...patch, updated_at: new Date().toISOString() }).eq('org_id', S.org.id).eq('contact_id', id); if (error) alert(error.message); else all.filter(r => r.contact_id === id).forEach(r => Object.assign(r, patch)); };
    app.querySelectorAll('[data-own]').forEach(e => e.onchange = () => save(e.dataset.own, { owner: e.value || null }));
    app.querySelectorAll('[data-watch]').forEach(e => e.onchange = () => { save(e.dataset.watch, { watch: e.checked }).then(render); });
    app.querySelectorAll('[data-note]').forEach(e => e.onchange = () => save(e.dataset.note, { note: e.value.trim() || null }));
  };
  app.innerHTML = `
  <div class="row" style="margin-bottom:12px"><h2 style="margin:0;font-size:18px">Account health</h2><span class="sp" style="flex:1"></span>
    <select id="fStream"><option value="commercial">Commercial</option><option value="restoration">Restoration</option><option value="dr_drapes">Dr Drapes</option><option value="all">All streams</option></select>
    <select id="fOwner"><option value="">Every owner</option>${owners.map(o => `<option>${esc(o)}</option>`).join('')}<option>(none)</option></select>
    <select id="fStatus"><option value="">Every status</option>${ACC_ORDER.map(k => `<option value="${k}">${ACC_STATUS[k][0]}</option>`).join('')}</select>
    <input id="fQ" placeholder="Search" style="width:150px"></div>
  <div id="accBody"></div>`;
  $('#fStream').value = st.stream;
  $('#fStream').onchange = e => { st.stream = e.target.value; render(); };
  $('#fOwner').onchange = e => { st.owner = e.target.value; render(); };
  $('#fStatus').onchange = e => { st.status = e.target.value; render(); };
  $('#fQ').oninput = e => { st.q = e.target.value; render(); };
  render();
}
