/* Hangr Ops: Marketing (admin). Offer calendar, automated flows, $200 draw / free order, one-off campaigns,
   queue and results, opt-outs, templates. Every send path ends in sms_sends; the sms-send function only sends
   while Settings > mode is test or live. */

const MK_TABS = [['offers', 'Offer calendar'], ['flows', 'Automated flows'], ['loyalty', '$200 draw & free order'], ['campaigns', 'One-off campaigns'], ['results', 'Queue & results'], ['optouts', 'Opt-outs'], ['templates', 'Templates'], ['settings', 'Sending']];
const segs = t => t.length <= 160 ? 1 : Math.ceil(t.length / 153);
const FOOT = ' - MasterDC Reply STOP to opt out.';
const statusChip = s => `<span class="chip" style="${s === 'approved' || s === 'queued' || s === 'confirmed' ? 'background:#e6f4ea;color:#127a3d' : s === 'cancelled' ? 'background:#fdecea;color:#b42318' : ''}">${esc(s)}</span>`;

async function marketingView(tab = 'offers') {
  const { data: set } = await sb.from('sms_settings').select('*').eq('org_id', S.org.id).maybeSingle();
  S.sms = set;
  const asof = (await sb.from('orgs').select('orders_as_of').eq('id', S.org.id).single()).data?.orders_as_of;
  const stale = !asof || (Date.now() - new Date(asof)) / 864e5 > 10;
  app.innerHTML = `
  <div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:18px">Marketing</h2><span class="sp"></span>
    <span class="chip" style="${set?.mode === 'live' ? 'background:#e6f4ea;color:#127a3d' : set?.mode === 'test' ? 'background:#fff4e5;color:#b54708' : 'background:#fdecea;color:#b42318'}">Sending: ${set?.mode === 'live' ? 'LIVE' : set?.mode === 'test' ? 'test number only' : 'OFF'}</span>
    <span class="chip ${stale ? '' : ''}" style="${stale ? 'background:#fdecea;color:#b42318' : ''}">Orders loaded to ${fmtD(asof)}</span></div>
  ${stale ? '<div class="card" style="border-color:#f3c5c0"><b>Order data is out of date.</b> The automated flows and the monthly draw wait until Customer Orders are uploaded to within the last 10 days, so they never act on old information.</div>' : ''}
  <div class="row" style="margin-bottom:12px">${MK_TABS.map(([k, t]) => `<a class="btn ${k === tab ? '' : 'ghost'}" style="padding:5px 10px" href="#/marketing/${k}">${t}</a>`).join('')}</div>
  <div id="mk"></div>`;
  const fn = { offers: mkOffers, flows: mkFlows, loyalty: mkLoyalty, campaigns: mkCampaigns, results: mkResults, optouts: mkOptouts, templates: mkTemplates, settings: mkSettings }[tab] || mkOffers;
  await fn($('#mk'));
}

/* ---------- offer calendar ---------- */
async function mkOffers(el) {
  const { data: cycles } = await sb.from('offer_cycles').select('*').eq('org_id', S.org.id).order('starts_on');
  el.innerHTML = `<div class="card"><h2>Six offers a year <small>one every two months; every customer gets the variant for their tier</small></h2>
    <p class="note">VIP and Regular get added value (no discount), Casual a standard offer, Lapsed the strongest. Each cycle goes out in four waves by surname (A–F, G–L, M–R, S–Z) so the plant isn't hit at once. 10% are held back to measure what the offer actually won. Nothing is queued until you approve it here.</p>
    ${(cycles || []).map(c => `<div class="card" style="margin:10px 0" id="oc-${c.id}">
      <div class="row"><b>${c.year} · cycle ${c.cycle_no}: ${esc(c.theme)}</b> ${statusChip(c.status)}<span class="sp"></span><span class="note">${fmtD(c.starts_on)} – ${fmtD(c.ends_on)}</span></div>
      ${['vip', 'casual', 'lapsed'].map(v => { const b = c.variants?.[v]?.body || ''; return `<label>${{ vip: 'VIP and Regular', casual: 'Casual', lapsed: 'Lapsed (180-365 days)' }[v]} <span class="note" data-cnt="${c.id}-${v}">${b.length + FOOT.length} chars · ${segs(b + FOOT)} SMS</span></label>
        <textarea data-var="${v}" style="min-height:52px" ${c.status !== 'draft' ? 'disabled' : ''}>${esc(b)}</textarea>`; }).join('')}
      <p class="note">${esc(c.margin_floor_note || '')} Placeholders: {first_name}, {store}, {ends}. The opt-out line is added automatically.</p>
      <div class="row">${c.status === 'draft' ? `<button class="btn ghost" data-save="${c.id}">Save wording</button><button class="btn ghost" data-prev="${c.id}">Preview reach and cost</button><button class="btn" data-appr="${c.id}">Approve and queue</button>` : ''}
        ${c.status === 'queued' ? `<button class="btn ghost" data-cancel="${c.campaign_id}">Cancel unsent messages</button>` : ''}<span id="op-${c.id}" class="note"></span></div>
    </div>`).join('')}</div>`;
  el.querySelectorAll('textarea[data-var]').forEach(t => t.oninput = () => { const id = t.closest('.card').id.slice(3); const n = el.querySelector(`[data-cnt="${id}-${t.dataset.var}"]`); n.textContent = `${t.value.length + FOOT.length} chars · ${segs(t.value + FOOT)} SMS`; });
  const vars = id => { const card = $('#oc-' + id); const o = {}; card.querySelectorAll('textarea[data-var]').forEach(t => o[t.dataset.var] = { body: t.value.trim() }); return o; };
  el.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const { error } = await sb.from('offer_cycles').update({ variants: vars(b.dataset.save) }).eq('id', b.dataset.save); $('#op-' + b.dataset.save).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.'; });
  el.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
    const id = b.dataset.prev; await sb.from('offer_cycles').update({ variants: vars(id) }).eq('id', id);
    $('#op-' + id).textContent = 'Working it out…';
    const { data, error } = await sb.rpc('offer_preview', { p_cycle: id });
    $('#op-' + id).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : `${num(data.total)} customers (VIP/Regular ${num(data.by_variant?.vip)}, Casual ${num(data.by_variant?.casual)}, Lapsed ${num(data.by_variant?.lapsed)}). Waves: ${Object.entries(data.by_wave || {}).map(([k, v]) => `${k}: ${num(v)}`).join(' · ')}. About ${money(data.est_cost)} after the ${data.held_back_pct}% hold-back.`;
  });
  el.querySelectorAll('[data-appr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.appr; await sb.from('offer_cycles').update({ variants: vars(id) }).eq('id', id);
    if (!confirm('Approve this offer and queue every wave? Messages only leave while Sending is on.')) return;
    $('#op-' + id).textContent = 'Queuing…';
    const { data, error } = await sb.rpc('offer_approve', { p_cycle: id });
    if (error) { $('#op-' + id).innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    alert(`Queued ${data.queued} messages (${data.skipped_cap} skipped: already had 2 marketing texts that month).`); marketingView('offers');
  });
  el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { if (!confirm('Cancel every message in this offer that hasn\'t gone yet?')) return; const { data } = await sb.rpc('campaign_cancel', { p_campaign: b.dataset.cancel }); alert(`${data} messages cancelled.`); marketingView('offers'); });
}

/* ---------- flows ---------- */
async function mkFlows(el) {
  const [{ data: flows }, { data: runs }] = await Promise.all([
    sb.from('campaigns').select('*').eq('org_id', S.org.id).eq('kind', 'flow').order('name'),
    sb.from('flow_runs').select('*').eq('org_id', S.org.id).order('ran_at', { ascending: false }).limit(5)]);
  const names = { onboarding: 'New customers (second visit)', lapsing: 'Lapsing nudge', winback: 'Win-back', uncollected: 'Uncollected work', review: 'Google review ask' };
  el.innerHTML = `<div class="card"><h2>Automated flows <small>checked every morning at 8:30, sent from 10am</small></h2>
    <p class="note">Marketing flows respect the cap of 2 marketing texts per customer per month and pause for 14 days either side of an offer-cycle text. Account customers never get marketing.</p>
    <div class="scroll"><table><tr><th>Flow</th><th>What it does</th><th>Message</th><th>On</th></tr>
    ${(flows || []).map(f => `<tr><td><b>${names[f.name] || f.name}</b></td><td style="white-space:normal;text-align:left;max-width:420px">${esc(f.notes || '')}</td><td>${esc(f.template_key)}</td>
      <td><input type="checkbox" data-flow="${f.id}" ${f.status === 'approved' ? 'checked' : ''}></td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:10px"><button class="btn ghost" id="fPrev">How many would go today?</button><button class="btn ghost" id="fRun">Run now</button><span id="fMsg" class="note"></span></div>
    <h2 style="margin-top:14px">Last runs</h2>${(runs || []).map(r => `<div class="note">${new Date(r.ran_at).toLocaleString('en-AU')}: ${esc(JSON.stringify(r.result))}</div>`).join('') || '<p class="note">Not run yet.</p>'}</div>`;
  el.querySelectorAll('[data-flow]').forEach(c => c.onchange = async () => {
    const { error } = await sb.from('campaigns').update({ status: c.checked ? 'approved' : 'draft', approved_by: c.checked ? S.user.id : null, approved_at: c.checked ? new Date().toISOString() : null }).eq('id', c.dataset.flow);
    if (error) alert(error.message);
  });
  $('#fPrev').onclick = async () => { const { data, error } = await sb.rpc('preview_flows', { p_org: S.org.id }); $('#fMsg').textContent = error ? error.message : flowTxt(data); };
  $('#fRun').onclick = async () => { if (!confirm('Queue today\'s messages for every flow that is switched on?')) return; const { data, error } = await sb.rpc('run_flows_admin', { p_org: S.org.id }); $('#fMsg').textContent = error ? error.message : flowTxt(data); };
}
const flowTxt = d => d.skipped ? d.skipped : Object.entries(d).filter(([k]) => !['as_of', 'dry_run', 'note'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · ') + ` (orders to ${fmtD(d.as_of)})`;

/* ---------- loyalty ---------- */
async function mkLoyalty(el) {
  const { data: picks } = await sb.from('loyalty_picks').select('*, customers(full_name, mobile, lifetime_spend)').eq('org_id', S.org.id).order('month', { ascending: false }).order('kind').limit(60);
  const sn = id => S.stores.find(s => s.id === id)?.name || '';
  const months = [...new Set((picks || []).map(p => p.month))];
  el.innerHTML = `<div class="card"><h2>$200 monthly draw and top-10% free order <small>one of each per store, South Kingsville excluded</small></h2>
    <p class="note">Draw: retail customers with 2+ orders on different days at that store in the month. Free order: the store's top 10% by lifetime spend who ordered that month (staff ring them; the discount goes on in the POS). Picks appear automatically once the month's orders are loaded. Redraw if the winner isn't suitable; Confirm queues their text.</p>
    <div class="row"><button class="btn ghost" id="lPrep">Prepare last month now</button><span id="lMsg" class="note"></span></div>
    ${months.map(m => `<h2 style="margin-top:14px">${new Date(m + 'T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</h2><div class="scroll"><table>
      <tr><th>Store</th><th>Prize</th><th>Winner</th><th>Mobile</th><th>Lifetime</th><th>Eligible</th><th>Status</th><th></th></tr>
      ${picks.filter(p => p.month === m).map(p => `<tr><td>${esc(sn(p.store_id))}</td><td>${p.kind === 'draw' ? '$200 credit' : 'Free order'}</td>
        <td>${p.customer_id ? `<a href="#/customer/${p.customer_id}">${esc(p.customers?.full_name || '')}</a>` : '<span class="mu">nobody eligible</span>'}</td><td>${esc(p.customers?.mobile || '')}</td><td>${money(p.customers?.lifetime_spend)}</td><td>${num(p.eligible)}</td><td>${statusChip(p.status)}</td>
        <td>${p.status === 'pending' && p.customer_id ? `<button class="btn ghost" style="padding:2px 8px" data-redraw="${p.id}">Redraw</button> <button class="btn" style="padding:2px 8px" data-conf="${p.id}">Confirm</button>` : ''}
          ${p.status === 'confirmed' ? `<label style="display:inline;margin:0"><input type="checkbox" data-ct="${p.id}" ${p.contacted_at ? 'checked' : ''}> contacted</label> <label style="display:inline;margin:0"><input type="checkbox" data-cr="${p.id}" ${p.credit_applied_at ? 'checked' : ''}> ${p.kind === 'draw' ? 'credit applied' : 'discount given'}</label>` : ''}</td></tr>`).join('')}
    </table></div>`).join('') || '<p class="note" style="margin-top:12px">No picks yet.</p>'}</div>`;
  $('#lPrep').onclick = async () => { const { data, error } = await sb.rpc('loyalty_prepare', { p_org: S.org.id, p_month: null }); if (error) $('#lMsg').textContent = error.message; else if (data.waiting) $('#lMsg').textContent = data.waiting; else mkLoyalty(el); };
  el.querySelectorAll('[data-redraw]').forEach(b => b.onclick = async () => { const { error } = await sb.rpc('loyalty_redraw', { p_pick: b.dataset.redraw }); if (error) alert(error.message); mkLoyalty(el); });
  el.querySelectorAll('[data-conf]').forEach(b => b.onclick = async () => { if (!confirm('Confirm this winner and queue their text?')) return; const { error } = await sb.rpc('loyalty_confirm', { p_pick: b.dataset.conf }); if (error) alert(error.message); mkLoyalty(el); });
  el.querySelectorAll('[data-ct],[data-cr]').forEach(c => c.onchange = async () => {
    const col = c.dataset.ct ? 'contacted_at' : 'credit_applied_at'; const id = c.dataset.ct || c.dataset.cr;
    await sb.from('loyalty_picks').update({ [col]: c.checked ? new Date().toISOString() : null }).eq('id', id);
  });
}

/* ---------- one-off campaigns ---------- */
async function mkCampaigns(el) {
  const { data: camps } = await sb.from('campaigns').select('*').eq('org_id', S.org.id).eq('kind', 'custom').order('created_at', { ascending: false }).limit(20);
  const retail = S.stores.filter(s => s.channel === 'retail' && s.active);
  el.innerHTML = `<div class="card"><h2>Build a one-off campaign</h2>
    <label>Name</label><input id="cName" style="width:100%" placeholder="e.g. Albert Park VIP thank you">
    <label>Message <span class="note" id="cCnt"></span></label><textarea id="cBody" placeholder="Hi {first_name}, …  {store} is the customer's store. The opt-out line is added automatically."></textarea>
    <div class="row" style="margin-top:6px">
      <div><label>Stores</label>${retail.map(s => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cSt" value="${s.id}"> ${esc(s.name)}</label>`).join('')}</div></div>
    <div class="row"><div><label>Tiers</label>${['VIP', 'Regular', 'Casual', 'Lapsed'].map(t => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cTi" value="${t}"> ${t}</label>`).join('')}</div>
      <div><label>Surnames</label>${['A-F', 'G-L', 'M-R', 'S-Z'].map(t => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cQu" value="${t}"> ${t}</label>`).join('')}</div>
      <div><label>Last order within (days)</label><input id="cMax" type="number" value="365" style="width:90px"></div>
      <div><label>At most</label><input id="cLim" type="number" placeholder="no limit" style="width:100px"></div></div>
    <div class="row" style="margin-top:10px"><button class="btn ghost" id="cPrev">Preview</button><button class="btn" id="cMake">Create for approval</button><span id="cMsg" class="note"></span></div>
    <p class="note">Blank boxes mean everyone. Account customers, opt-outs, do-not-contact and anyone already at 2 marketing texts this month are left out. 10% are held back to measure results.</p></div>
  <div class="card"><h2>Campaigns</h2><div class="scroll"><table><tr><th>Created</th><th>Name</th><th>Message</th><th>Status</th><th></th></tr>
    ${(camps || []).map(c => `<tr><td>${new Date(c.created_at).toLocaleDateString('en-AU')}</td><td>${esc(c.name)}</td><td style="white-space:normal;text-align:left;max-width:380px">${esc(c.body || '')}</td><td>${statusChip(c.status)}</td>
      <td>${c.status === 'draft' ? `<button class="btn" style="padding:2px 8px" data-ok="${c.id}">Approve and send</button> ` : ''}${['draft', 'approved'].includes(c.status) ? `<button class="btn ghost" style="padding:2px 8px" data-x="${c.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">None yet</td></tr>'}</table></div></div>`;
  const filt = () => ({ stores: [...el.querySelectorAll('.cSt:checked')].map(x => x.value), tiers: [...el.querySelectorAll('.cTi:checked')].map(x => x.value), quadrants: [...el.querySelectorAll('.cQu:checked')].map(x => x.value), max_days: +$('#cMax').value || 365, ...($('#cLim').value ? { limit: +$('#cLim').value } : {}) });
  $('#cBody').oninput = () => { const t = $('#cBody').value; $('#cCnt').textContent = `${t.length + FOOT.length} chars · ${segs(t + FOOT)} SMS each`; };
  $('#cPrev').onclick = async () => { const { data, error } = await sb.rpc('campaign_preview', { p_org: S.org.id, p_filters: filt(), p_body: $('#cBody').value }); $('#cMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : `${num(data.recipients)} customers · ${data.segments} SMS each · about ${money(data.est_cost, 2)}. Sample: “${esc(data.sample)}”`; };
  $('#cMake').onclick = async () => {
    if (!$('#cName').value.trim() || !$('#cBody').value.trim()) { $('#cMsg').textContent = 'Give it a name and a message.'; return; }
    const { error } = await sb.rpc('campaign_create', { p_org: S.org.id, p_name: $('#cName').value.trim(), p_filters: filt(), p_body: $('#cBody').value.trim() });
    if (error) $('#cMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; else mkCampaigns(el);
  };
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { if (!confirm('Approve and queue this campaign? It goes at the next 10am send slot while Sending is on.')) return; const { data, error } = await sb.rpc('campaign_approve', { p_campaign: b.dataset.ok }); alert(error ? error.message : `${data} messages queued.`); mkCampaigns(el); });
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => { if (!confirm('Cancel this campaign\'s unsent messages?')) return; await sb.rpc('campaign_cancel', { p_campaign: b.dataset.x }); mkCampaigns(el); });
}

/* ---------- queue and results ---------- */
async function mkResults(el) {
  const from = addDays(iso(new Date()), -180);
  const [{ data: res }, { data: q }, { data: recent }] = await Promise.all([
    sb.rpc('sms_results', { p_org: S.org.id, p_from: from }),
    sb.from('sms_sends').select('category,status,scheduled_for').eq('org_id', S.org.id).in('status', ['queued', 'pending']).limit(20000),
    sb.from('sms_sends').select('created_at,sent_at,category,template_key,mobile,status,error,customer_id').eq('org_id', S.org.id).not('status', 'in', '(pending,queued)').order('created_at', { ascending: false }).limit(40)]);
  const qb = {}; (q || []).forEach(r => { const d = r.status === 'pending' ? 'awaiting approval' : r.scheduled_for ? new Date(r.scheduled_for).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'next slot'; const k = `${d}|${r.category}`; qb[k] = (qb[k] || 0) + 1; });
  el.innerHTML = `<div class="card"><h2>Results, last 180 days <small>an order within 30 days of the text, against the 10% held back</small></h2><div class="scroll"><table>
    <tr><th>Message</th><th>Sent</th><th>Ordered</th><th>Held back</th><th>Held back ordered</th><th>Lift</th><th>Sales (sent)</th><th>SMS cost</th></tr>
    ${(res || []).map(r => { const a = r.sent ? r.sent_ordered / r.sent : null, b = r.held ? r.held_ordered / r.held : null; return `<tr><td>${esc(r.template_key || r.category)}</td><td>${num(r.sent)}</td><td>${a == null ? '–' : (a * 100).toFixed(1) + '%'}</td><td>${num(r.held)}</td><td>${b == null ? '–' : (b * 100).toFixed(1) + '%'}</td><td>${a != null && b != null ? pctTxt(a - b) : '–'}</td><td>${money(r.sent_sales)}</td><td>${money(r.cost, 2)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="mu">Nothing sent yet</td></tr>'}
  </table></div><p class="note">"Lift" is the difference in the share who ordered. It needs a few hundred messages before it means much.</p></div>
  <div class="card"><h2>Waiting to go</h2><div class="scroll"><table><tr><th>When</th><th>Type</th><th>Messages</th></tr>
    ${Object.entries(qb).map(([k, v]) => { const [d, c] = k.split('|'); return `<tr><td>${esc(d)}</td><td>${esc(c)}</td><td>${num(v)}</td></tr>`; }).join('') || '<tr><td colspan="3" class="mu">Queue is empty</td></tr>'}</table></div></div>
  <div class="card"><h2>Latest activity</h2><div class="scroll"><table><tr><th>When</th><th>Type</th><th>Mobile</th><th>Status</th><th>Note</th></tr>
    ${(recent || []).map(r => `<tr><td>${new Date(r.sent_at || r.created_at).toLocaleString('en-AU')}</td><td>${esc(r.template_key || r.category)}</td><td>${r.customer_id ? `<a href="#/customer/${r.customer_id}">${esc(r.mobile)}</a>` : esc(r.mobile)}</td><td>${statusChip(r.status)}</td><td class="mu">${esc(r.error || '')}</td></tr>`).join('')}</table></div></div>`;
}

/* ---------- opt-outs ---------- */
async function mkOptouts(el) {
  const [{ data: sup }, { data: dnc }] = await Promise.all([
    sb.from('sms_suppression').select('*').eq('org_id', S.org.id).order('opted_out_at', { ascending: false }),
    sb.from('do_not_contact').select('*, customers(full_name)').eq('org_id', S.org.id).order('logged_at', { ascending: false })]);
  el.innerHTML = `<div class="grid g2"><div class="card"><h2>Opted out of SMS <small>never texted again, any message</small></h2>
    <div class="row"><input id="oMob" placeholder="Mobile, e.g. 0412 345 678"><button class="btn" id="oAdd">Add</button></div>
    <p class="note">Replies of STOP to the sending number are added automatically once the reply number is connected.</p>
    <table><tr><th>Mobile</th><th>When</th><th>Why</th><th></th></tr>${(sup || []).map(s => `<tr><td>${esc(s.mobile)}</td><td>${fmtD(s.opted_out_at.slice(0, 10))}</td><td class="mu">${esc(s.reason || '')}</td><td><button class="btn ghost" style="padding:2px 8px" data-um="${esc(s.mobile)}">Remove</button></td></tr>`).join('')}</table></div>
    <div class="card"><h2>Do not contact <small>no marketing; service messages still go</small></h2>
    <p class="note">Add someone from their customer page.</p>
    <table><tr><th>Customer</th><th>Why</th><th></th></tr>${(dnc || []).map(d => `<tr><td><a href="#/customer/${d.customer_id}">${esc(d.customers?.full_name || '')}</a></td><td class="mu">${esc(d.reason || '')}</td><td><button class="btn ghost" style="padding:2px 8px" data-ud="${d.customer_id}">Remove</button></td></tr>`).join('')}</table></div></div>`;
  $('#oAdd').onclick = async () => {
    const d = $('#oMob').value.replace(/\D/g, ''); const m = d.startsWith('614') && d.length === 11 ? '+' + d : d.startsWith('04') && d.length === 10 ? '+61' + d.slice(1) : null;
    if (!m) { alert('That doesn\'t look like an Australian mobile.'); return; }
    await sb.from('sms_suppression').upsert({ org_id: S.org.id, mobile: m, reason: 'Added by ' + S.user.email, source: 'admin' }); mkOptouts(el);
  };
  el.querySelectorAll('[data-um]').forEach(b => b.onclick = async () => { if (!confirm('Remove from the opt-out list? Only do this if the customer asked to receive texts again.')) return; await sb.from('sms_suppression').delete().eq('org_id', S.org.id).eq('mobile', b.dataset.um); mkOptouts(el); });
  el.querySelectorAll('[data-ud]').forEach(b => b.onclick = async () => { await sb.from('do_not_contact').delete().eq('org_id', S.org.id).eq('customer_id', b.dataset.ud); mkOptouts(el); });
}

/* ---------- templates ---------- */
async function mkTemplates(el) {
  const { data: t } = await sb.from('sms_templates').select('*').eq('org_id', S.org.id).order('category').order('key');
  el.innerHTML = `<div class="card"><h2>Message templates <small>used by the flows, draw and referrals</small></h2>
    <p class="note">Placeholders: {first_name}, {store}, plus {month} (draw), {code} (referral), {review_url} (review), {ready_date} (uncollected). The opt-out line is added automatically.</p>
    ${(t || []).map(x => `<div style="margin:12px 0"><label><b style="color:var(--ink)">${esc(x.name || x.key)}</b> · ${esc(x.category)} · <span data-tc="${esc(x.key)}">${segs(x.body + FOOT)} SMS</span></label>
      <textarea data-tk="${esc(x.key)}" style="min-height:${Math.min(220, 40 + x.body.length / 2)}px">${esc(x.body)}</textarea>
      <div class="row"><button class="btn ghost" style="padding:3px 10px" data-ts="${esc(x.key)}">Save</button><span class="note" data-tm="${esc(x.key)}"></span></div></div>`).join('')}</div>`;
  el.querySelectorAll('textarea[data-tk]').forEach(a => a.oninput = () => { el.querySelector(`[data-tc="${a.dataset.tk}"]`).textContent = `${segs(a.value + FOOT)} SMS`; });
  el.querySelectorAll('[data-ts]').forEach(b => b.onclick = async () => {
    const body = el.querySelector(`textarea[data-tk="${b.dataset.ts}"]`).value;
    const { error } = await sb.from('sms_templates').update({ body, updated_at: new Date().toISOString() }).eq('org_id', S.org.id).eq('key', b.dataset.ts);
    el.querySelector(`[data-tm="${b.dataset.ts}"]`).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.';
  });
}

/* ---------- sending settings ---------- */
async function mkSettings(el) {
  const s = S.sms || {};
  el.innerHTML = `<div class="card"><h2>Sending</h2>
    <label>Mode</label><select id="sMode"><option value="off">Off: nothing leaves</option><option value="test">Test: only to the test number</option><option value="live">Live: send to customers</option></select>
    <label>Test number</label><input id="sTest" value="${esc(s.test_mobile || '')}">
    <label>Sender shown on the phone</label><input id="sSender" value="${esc(s.sender_id || '')}"> <span class="note">A name like MasterDC can't receive replies, so STOP replies can't come back. Leave blank to send from ${esc(s.from_number || 'the number')} instead, which can.</span>
    <div class="row"><div><label>Send from</label><input id="sStart" value="${esc((s.quiet_start || '09:00').slice(0, 5))}" style="width:80px"></div><div><label>until</label><input id="sEnd" value="${esc((s.quiet_end || '19:00').slice(0, 5))}" style="width:80px"></div>
      <div><label>Marketing texts per customer per month</label><input id="sCap" type="number" value="${s.marketing_cap_per_month ?? 2}" style="width:80px"></div><div><label>Held back to measure (%)</label><input id="sCtl" type="number" value="${s.control_pct ?? 10}" style="width:80px"></div></div>
    <p class="note">Never on Sundays. ${money(s.cost_per_sms, 3)} per SMS part.</p>
    <div class="row"><button class="btn" id="sSave">Save</button><span id="sMsg" class="note"></span></div></div>`;
  $('#sMode').value = s.mode || 'off';
  $('#sSave').onclick = async () => {
    const mode = $('#sMode').value;
    if (mode === 'live' && s.mode !== 'live' && !confirm('Turn on live sending? Everything queued and due will start going to customers within 5 minutes (sending hours only).')) return;
    const { error } = await sb.from('sms_settings').update({ mode, test_mobile: $('#sTest').value.trim() || null, sender_id: $('#sSender').value.trim(), quiet_start: $('#sStart').value, quiet_end: $('#sEnd').value, marketing_cap_per_month: +$('#sCap').value, control_pct: +$('#sCtl').value, updated_at: new Date().toISOString() }).eq('org_id', S.org.id);
    $('#sMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.'; if (!error) marketingView('settings');
  };
}

/* ---------- customer page extras: texts, referral code, do-not-contact ---------- */
async function customerMarketingCard(c) {
  const [{ data: texts }, { data: dnc }, { data: code }] = await Promise.all([
    sb.from('sms_sends').select('created_at,sent_at,template_key,category,status,body').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(20),
    sb.from('do_not_contact').select('reason').eq('customer_id', c.id).maybeSingle(),
    sb.rpc('referral_code', { p_customer: c.id })]);
  return `<div class="card"><h2>Marketing</h2>
    <p>Referral code <b>${esc(code || '')}</b> · ${dnc ? `<span class="dn">Do not contact</span> (${esc(dnc.reason || '')}) <button class="btn ghost" style="padding:2px 8px" id="dncOff">Remove</button>` : `<button class="btn ghost" style="padding:2px 8px" id="dncOn">Do not contact</button>`}</p>
    <div class="scroll"><table><tr><th>When</th><th>Message</th><th>Status</th></tr>
    ${(texts || []).map(t => `<tr><td>${new Date(t.sent_at || t.created_at).toLocaleDateString('en-AU')}</td><td style="white-space:normal;text-align:left">${esc(t.body)}</td><td>${statusChip(t.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">No texts yet</td></tr>'}</table></div>
    <h2 style="margin-top:12px">Log a referral they made</h2>
    <div class="row"><input id="rName" placeholder="Friend's name"><input id="rMob" placeholder="Friend's mobile"><input id="rVal" type="number" placeholder="First order $" style="width:120px"><button class="btn ghost" id="rLog">Log ($75 each)</button><span id="rMsg" class="note"></span></div></div>`;
}
function wireCustomerMarketing(c) {
  const on = $('#dncOn'), off = $('#dncOff');
  if (on) on.onclick = async () => { const reason = prompt('Why? (e.g. asked not to be marketed to)'); if (reason == null) return; await sb.from('do_not_contact').insert({ org_id: S.org.id, customer_id: c.id, reason, logged_by: S.user.email }); customerView(c.id); };
  if (off) off.onclick = async () => { await sb.from('do_not_contact').delete().eq('org_id', S.org.id).eq('customer_id', c.id); customerView(c.id); };
  const r = $('#rLog'); if (r) r.onclick = async () => {
    const { data: code } = await sb.rpc('referral_code', { p_customer: c.id });
    const { error } = await sb.from('referrals').insert({ org_id: S.org.id, referrer_customer_id: c.id, code, referee_name: $('#rName').value.trim() || null, referee_mobile: $('#rMob').value.trim() || null, first_order_value: +$('#rVal').value || null, first_order_date: iso(new Date()), logged_by: S.user.id });
    $('#rMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Logged. Apply $75 credit to both in the POS.';
  };
}
