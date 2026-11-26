/* Hangr Ops: org chart and role cards (module B4, admin only).
   positions = the jobs (one role card each); position_holders = who does them (Employment Hero employee id, no pay detail).
   Cost per position comes from v_staff_cost (finalised pay runs, last ~9 weeks: wages + super + liabilities).
   Live numbers on a card come from the same labour, sales and Xero figures as the Labour screens. */

const AREAS = [['management', 'Management'], ['service', 'Service co-ordination'], ['plant', 'Plant'], ['delivery', 'Delivery'], ['stores', 'Stores'], ['office', 'Office'], ['dr_drapes', 'Dr Drapes']];
const AREA_NAME = Object.fromEntries(AREAS);
const RETAIL_PRE = { albert_park: 'ALP', seddon: 'SED', werribee: 'WER', butler: 'BUT', sth_kingsville: 'KIN' };
const METRIC_HELP = 'plant · stream:shirts · stream:dry_cleaning · stream:wash_fold · stream:restoration · store:albert_park (seddon, werribee, butler) · drd · yoy:retail · yoy:commercial · yoy:restoration · yoy:dr_drapes · yoy:retail:ALP (SED, WER, BUT, KIN)';
const FULL_WEEK = 38;

async function orgData(fresh) {
  if (S.cache.org && !fresh) return S.cache.org;
  const [p, h, st, c] = await Promise.all([
    sb.from('positions').select('*').eq('org_id', S.org.id).order('sort'),
    sb.from('position_holders').select('*').eq('org_id', S.org.id),
    sb.from('labour_staff').select('eh_employee_id,name,end_date,non_clocking').eq('org_id', S.org.id).order('name'),
    sb.from('v_staff_cost').select('*').eq('org_id', S.org.id)]);
  const err = p.error || h.error || st.error || c.error; if (err) throw err;
  const cost = Object.fromEntries((c.data || []).map(r => [r.eh_employee_id, r]));
  const staff = Object.fromEntries((st.data || []).map(r => [r.eh_employee_id, r]));
  const cutoff = addDays(iso(new Date()), -30);
  const active = (st.data || []).filter(r => !r.end_date || r.end_date >= cutoff);
  const pos = p.data || [], hold = h.data || [];
  for (const x of pos) {
    x.holders = hold.filter(r => r.position_id === x.id).map(r => r.eh_employee_id == null
      ? { ...r, ext: true, name: r.ext_name, c: { cost_pw: r.ext_cost_pw, hours_pw: r.ext_hours_pw } }
      : { ...r, name: staff[r.eh_employee_id]?.name || ('#' + r.eh_employee_id), c: cost[r.eh_employee_id] });
    x.cost_pw = x.holders.reduce((a, r) => a + (+r.c?.cost_pw || 0) * +r.share, 0);
    x.hours_pw = x.holders.reduce((a, r) => a + (+r.c?.hours_pw || 0) * +r.share, 0);
  }
  return S.cache.org = { pos, hold, staff, cost, active, byId: Object.fromEntries(pos.map(x => [x.id, x])) };
}

/* live figures for the metric keys a KPI can carry */
async function posMetrics() {
  if (S.cache.posm) return S.cache.posm;
  const [d, { data: Y }, { data: T }] = await Promise.all([lbData(), sb.rpc('sales_yoy', { p_org: S.org.id }), sb.from('roster_targets').select('key,value').eq('org_id', S.org.id)]);
  const tg = Object.fromEntries((T || []).map(r => [r.key, +r.value]));
  const salesWeeks = [...new Set(d.sw.map(r => r.week_end))].sort();
  const pw = salesWeeks.map(w => [w, plantWeek(d, w)]).filter(([, p]) => p.hasSales).slice(-4);
  const plantTo = pw.length ? pw[pw.length - 1][0] : null;
  const labWeeks = [...new Set(d.lw.map(r => r.week_end))].filter(w => w <= lastSunday()).sort().slice(-4);
  const labTo = labWeeks[labWeeks.length - 1];
  const M = {};
  if (pw.length) {
    const c = pw.reduce((a, [, p]) => a + p.totC, 0), s = pw.reduce((a, [, p]) => a + p.totS, 0);
    M.plant = { v: wTxt(wpct(c, s)), note: `4 weeks to ${fmtD(plantTo)} (last weeks with till sales)` };
    for (const [k, name] of STREAMS) {
      const t = pw.reduce((a, [, p]) => { const r = p.rows.find(x => x.k === k); return { h: a.h + r.h, c: a.c + r.c, pc: a.pc + r.pieces, s: a.s + r.sales }; }, { h: 0, c: 0, pc: 0, s: 0 });
      const pph = t.h ? t.pc / t.h : null, std = tg['pph_normal_' + k];
      M['stream:' + k] = k === 'restoration'
        ? { v: wTxt(wpct(t.c, t.s)), note: `wage %, ${money(t.c / pw.length)} a week on ${money(t.s / pw.length)}` }
        : { v: pph ? `<span class="${std && pph < std ? 'dn' : 'up'}">${pph.toFixed(1)}</span> /hr` : '–', note: `${name}; ${std ? 'normal ' + std + '/hr, ' : ''}wage % ${t.s ? (t.c / t.s * 100).toFixed(1) + '%' : '–'}; 4 weeks to ${fmtD(plantTo)}` };
    }
  }
  for (const s of S.stores) {
    const pre = RETAIL_PRE[s.code]; if (!pre) continue;
    const c = d.lw.filter(r => labWeeks.includes(r.week_end) && r.store_id === s.id).reduce((a, r) => a + +(r.cost || 0), 0);
    const sl = d.fin.filter(f => labWeeks.includes(f.week_end) && f.stream === 'retail:' + pre).reduce((a, f) => a + +f.amount, 0);
    M['store:' + s.code] = { v: wTxt(wpct(c, sl), .25, .32), note: `${money(c / 4)} a week on ${money(sl / 4)} retail (Xero, ex GST), 4 weeks to ${fmtD(labTo)}` };
  }
  {
    const c = d.lw.filter(r => labWeeks.includes(r.week_end) && r.section === 'dr_drapes').reduce((a, r) => a + +(r.cost || 0), 0);
    const sl = d.fin.filter(f => labWeeks.includes(f.week_end) && f.stream === 'dr_drapes' && f.source === 'xero').reduce((a, f) => a + +f.amount, 0);
    M.drd = { v: wTxt(wpct(c, sl), .35, .45), note: `${money(c / 4)} a week on ${money(sl / 4)} billed (Xero 41450), 4 weeks to ${fmtD(labTo)}` };
  }
  if (Y?.rows) {
    const rows = Object.fromEntries(Y.rows.map(r => [r.stream, r]));
    const ret = Y.rows.filter(r => r.stream.startsWith('retail:')).reduce((a, r) => ({ w12: a.w12 + (+r.w12 || 0), w12ly: a.w12ly + (+r.w12ly || 0) }), { w12: 0, w12ly: 0 });
    const yy = r => r && r.w12ly ? { v: pctTxt(r.w12 / r.w12ly - 1), note: `${money(r.w12)} over 12 weeks to ${fmtD(Y.last_week_end)} vs ${money(r.w12ly)}` } : null;
    M['yoy:retail'] = yy(ret);
    for (const k of ['commercial', 'restoration', 'dr_drapes']) M['yoy:' + k] = yy(rows[k]);
    for (const pre of Object.values(RETAIL_PRE)) M['yoy:retail:' + pre] = yy(rows['retail:' + pre]);
  }
  return S.cache.posm = M;
}

const hoursFlag = x => x.holders.length && x.hours_pw > x.fte * FULL_WEEK * 1.15;
const statusChip2 = s => s === 'approved' ? '<span class="chip" style="background:#e7f6ec;color:var(--good)">approved</span>' : '<span class="chip">draft</span>';

/* ---------- org chart ---------- */
async function lbOrg(el) {
  const [O, M, Y] = await Promise.all([orgData(true), posMetrics().catch(() => ({})), sb.rpc('sales_yoy', { p_org: S.org.id }).then(r => r.data, () => null)]);
  el.__sales = salesPerWeek(Y);
  const kids = id => O.pos.filter(p => (p.reports_to || null) === id && p.id !== id);
  const roots = O.pos.filter(p => !p.reports_to || !O.byId[p.reports_to]);
  const placed = new Set(O.hold.filter(h => h.eh_employee_id != null).map(h => h.eh_employee_id));
  const unplaced = O.active.filter(s => !placed.has(s.eh_employee_id) && (O.cost[s.eh_employee_id]?.cost_pw > 0));
  const totCost = O.pos.reduce((a, p) => a + p.cost_pw, 0);
  const vacant = O.pos.filter(p => !p.holders.length);
  const heavy = O.pos.filter(hoursFlag);
  const metricOf = p => { const k = (p.kpis || []).find(k => k.metric && M[k.metric]); return k ? `<span class="note">${esc(k.label)}:</span> ${M[k.metric].v}` : ''; };
  const node = (p, depth) => `
    <div style="margin-left:${depth ? 18 : 0}px;border-left:${depth ? '2px solid var(--line)' : '0'};padding-left:${depth ? 10 : 0}px">
      <div class="card" style="margin:6px 0;padding:9px 12px">
        <div class="row"><a href="#/labour/role/${p.id}" style="font-weight:650;color:var(--navy);text-decoration:none">${esc(p.title)}</a>${statusChip2(p.status)}
          <span class="note">${esc(AREA_NAME[p.area] || p.area)}${p.section ? ' · ' + esc(SECTION_NAMES[p.section] || p.section) : ''}</span><span class="sp" style="flex:1"></span>
          <span class="note">${p.fte} FTE · ${p.holders.length || '<b class="dn">vacant</b>'}${p.holders.length ? ' ' + (p.holders.length === 1 ? 'person' : 'people') : ''} · paid ${num(p.hours_pw)} h/wk${hoursFlag(p) ? ' <b style="color:var(--warn)">over FTE</b>' : ''} · <b>${money(p.cost_pw)}</b>/wk</span></div>
        <div class="row" style="margin-top:3px"><span>${p.holders.map(h => esc(h.name) + (+h.c?.hours_pw > 45 ? ` <b style="color:var(--warn)" title="paid ${num(h.c.hours_pw)} hours a week">(${num(h.c.hours_pw)}h)</b>` : '')).join(', ') || '<span class="mu">no one assigned</span>'}</span><span class="sp" style="flex:1"></span>${metricOf(p)}</div>
      </div>
      ${kids(p.id).map(k => node(k, depth + 1)).join('')}
    </div>`;
  const byArea = AREAS.map(([a, name]) => { const ps = O.pos.filter(p => p.area === a); return { name, n: ps.length, ppl: new Set(ps.flatMap(p => p.holders.map(h => h.eh_employee_id))).size, h: ps.reduce((s, p) => s + p.hours_pw, 0), c: ps.reduce((s, p) => s + p.cost_pw, 0), fte: ps.reduce((s, p) => s + +p.fte, 0) }; }).filter(r => r.n);
  el.innerHTML = `
  <div class="tiles">
    <div class="tile"><div class="l">Positions</div><div class="v">${O.pos.length}</div><div class="d mu">${O.pos.filter(p => p.status === 'approved').length} approved, ${O.pos.filter(p => p.status !== 'approved').length} draft</div></div>
    <div class="tile"><div class="l">People placed</div><div class="v">${placed.size}</div><div class="d ${unplaced.length ? 'dn' : 'mu'}">${unplaced.length} paid recently but not in a position</div></div>
    <div class="tile"><div class="l">Labour a week</div><div class="v">${money(totCost)}</div><div class="d mu">from pay runs, last 9 weeks</div></div>
    <div class="tile"><div class="l">Vacant / over FTE</div><div class="v">${vacant.length} / ${heavy.length}</div><div class="d mu">paid hours more than 15% over the FTE set</div></div>
  </div>
  <div class="row" style="margin:12px 0"><span class="note">Seeded from the position descriptions in OneDrive and the Employment Hero staff list. Everything is a draft until approved on its card. FTE was seeded from paid hours, so set it to what the job needs and the over-FTE flags will show where the structure carries more hours than the work.</span><span class="sp" style="flex:1"></span><button class="btn ghost" id="addPos">Add position</button></div>
  ${unplaced.length ? `<div class="card"><h2>Paid but not in a position <small>last 9 weeks of pay runs</small></h2><div class="scroll"><table>
    <tr><th>Person</th><th>Paid h/wk</th><th>Cost/wk</th><th>Put in</th></tr>
    ${unplaced.map(s => `<tr><td>${esc(s.name)}</td><td>${num(O.cost[s.eh_employee_id]?.hours_pw)}</td><td>${money(O.cost[s.eh_employee_id]?.cost_pw)}</td>
      <td><select data-place="${s.eh_employee_id}"><option value="">choose a position…</option>${O.pos.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></td></tr>`).join('')}
  </table></div></div>` : ''}
  <div class="card"><h2>By area</h2><div class="scroll"><table>
    <tr><th>Area</th><th>Positions</th><th>People</th><th>FTE set</th><th>Paid h/wk</th><th>FTE paid</th><th>Cost/wk</th></tr>
    ${byArea.map(r => `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.ppl}</td><td>${r.fte.toFixed(1)}</td><td>${num(r.h)}</td><td>${(r.h / FULL_WEEK).toFixed(1)}</td><td>${money(r.c)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td>${O.pos.length}</td><td>${placed.size}</td><td>${byArea.reduce((a, r) => a + r.fte, 0).toFixed(1)}</td><td>${num(byArea.reduce((a, r) => a + r.h, 0))}</td><td>${(byArea.reduce((a, r) => a + r.h, 0) / FULL_WEEK).toFixed(1)}</td><td>${money(totCost)}</td></tr>
  </table></div><p class="note">David and Annalise aren't paid through Employment Hero, so management shows no cost. People not on the payroll (e.g. Huward) carry the weekly cost entered on their card. Paid hours include leave. FTE paid = paid hours ÷ ${FULL_WEEK}. Cost is wages + super; WorkCover isn't in it. Someone in two positions is split by the share on each card.</p></div>
  ${reportingCard(O)}
  ${planCard(O, el.__sales)}
  <div class="card"><h2>Structure <small>click a position for its role card</small></h2>${roots.map(r => node(r, 0)).join('')}</div>`;
  wirePlan(el, O);
  $('#addPos').onclick = async () => {
    const { data, error } = await sb.from('positions').insert({ org_id: S.org.id, code: 'new_' + Date.now().toString(36), title: 'New position', area: 'plant', reports_to: O.pos.find(p => p.code === 'gm')?.id || null }).select('id').single();
    if (error) return alert(error.message);
    location.hash = '#/labour/role/' + data.id;
  };
  el.querySelectorAll('[data-place]').forEach(s => s.onchange = async () => {
    if (!s.value) return;
    const { error } = await sb.from('position_holders').insert({ org_id: S.org.id, position_id: s.value, eh_employee_id: +s.dataset.place });
    if (error) return alert(error.message);
    lbOrg(el);
  });
}

/* ---------- role card ---------- */
async function lbRole(el, id) {
  const [O, M] = await Promise.all([orgData(true), posMetrics().catch(() => ({}))]);
  const p = O.byId[id];
  if (!p) { el.innerHTML = '<div class="card">That position no longer exists. <a href="#/labour/org">Back to the org chart</a></div>'; return; }
  const boss = O.byId[p.reports_to], team = O.pos.filter(x => x.reports_to === p.id);
  const store = S.stores.find(s => s.id === p.store_id);
  const list = a => (a || []).length ? `<ul style="margin:4px 0 0 18px;padding:0">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="note">None set.</p>';
  const lines = a => (a || []).join('\n');
  const kpiLines = (p.kpis || []).map(k => [k.label, k.target || '', k.metric || ''].join(' | ').replace(/( \| )+$/, '')).join('\n');
  const placedIds = new Set(p.holders.filter(h => !h.ext).map(h => h.eh_employee_id));
  el.innerHTML = `
  <div class="row noprint" style="margin-bottom:10px"><a href="#/labour/org">← Org chart</a><span class="sp" style="flex:1"></span>
    <button class="btn ghost" onclick="window.print()">Print card</button>
    <button class="btn ${p.status === 'approved' ? 'ghost' : ''}" id="rcStatus">${p.status === 'approved' ? 'Back to draft' : 'Approve this card'}</button></div>
  <div class="card" id="rcCard">
    <div class="row"><h2 style="margin:0;font-size:19px">${esc(p.title)}</h2>${statusChip2(p.status)}</div>
    <p class="note" style="margin:4px 0 0">Master Dry Cleaners · ${esc(AREA_NAME[p.area] || p.area)}${store ? ' · ' + esc(store.name) : ''} · Reports to ${boss ? `<a href="#/labour/role/${boss.id}">${esc(boss.title)}</a>` : '–'}${team.length ? ` · Leads ${team.map(t => `<a href="#/labour/role/${t.id}">${esc(t.title)}</a>`).join(', ')}` : ''}</p>
    <p class="note" style="margin:2px 0 0">${p.holders.length ? 'Held by ' + p.holders.map(h => esc(h.name)).join(', ') : 'Vacant'} · ${p.fte} FTE${p.award ? ' · ' + esc(p.award) : ''}</p>
    <h3 style="font-size:14px;margin:14px 0 2px">Purpose</h3><p style="margin:0">${esc(p.purpose || '–')}</p>
    <h3 style="font-size:14px;margin:14px 0 2px">What you're responsible for</h3>${list(p.responsibilities)}
    <h3 style="font-size:14px;margin:14px 0 2px">What good looks like</h3>${list(p.standards)}
    <h3 style="font-size:14px;margin:14px 0 4px">How it's measured</h3>
    ${(p.kpis || []).length ? `<table><tr><th>Measure</th><th>Target</th><th>Now</th></tr>${p.kpis.map(k => { const m = k.metric && M[k.metric]; return `<tr><td style="white-space:normal">${esc(k.label)}${m ? `<div class="note">${esc(m.note)}</div>` : ''}</td><td>${esc(k.target || '')}</td><td>${m ? m.v : '<span class="mu">checked by the manager</span>'}</td></tr>`; }).join('')}</table>` : '<p class="note">None set.</p>'}
    <p class="note" style="margin-top:10px">Source: ${esc(p.source || '–')}</p>
  </div>
  <div class="grid g2 noprint">
    <div class="card"><h2>People in this position <small>cost from pay runs, last 9 weeks</small></h2><table>
      <tr><th>Person</th><th>Share</th><th>Paid h/wk</th><th>Cost/wk</th><th></th></tr>
      ${p.holders.map(h => `<tr><td>${esc(h.name)}${h.ext ? ' <span class="chip">not on payroll</span>' : ''}</td><td><input data-share="${h.id}" type="number" min="0.1" max="1" step="0.1" value="${h.share}" style="width:64px"></td><td>${h.ext ? (h.c.hours_pw ? num(h.c.hours_pw) : '–') : +h.c?.cost_pw ? num(h.c.hours_pw) + (+h.c.hours_pw > 45 ? ' <b style="color:var(--warn)">long hours</b>' : '') : '<span class="mu">not paid through Employment Hero</span>'}</td><td>${h.ext ? `<input data-extc="${h.id}" type="number" value="${h.c.cost_pw ?? ''}" style="width:80px">` : +h.c?.cost_pw ? money(h.c.cost_pw) : '–'}</td><td><button class="btn ghost" style="padding:2px 8px" data-rm="${h.id}">Remove</button></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td></td><td>${num(p.hours_pw)}</td><td>${money(p.cost_pw)}</td><td></td></tr></table>
      <p class="note">${p.holders.length ? `${p.fte} FTE set is ${num(p.fte * FULL_WEEK)} hours a week; paid ${num(p.hours_pw)}${hoursFlag(p) ? ' <b style="color:var(--warn)">— more than the job is set at</b>' : ''}.` : ''} Share splits someone across two positions (0.5 = half their cost here).</p>
      <div class="row"><input id="extName" placeholder="Not on payroll: name" style="width:170px"><input id="extCost" type="number" placeholder="$ a week" style="width:100px"><button class="btn ghost" id="extAdd">Add</button></div>
      <div class="row" style="margin-top:6px"><select id="rcAdd"><option value="">Add a person…</option>${(() => { const where = id => O.pos.filter(x => x.holders.some(h => h.eh_employee_id === id)).map(x => x.title).join(', ');
        const c = O.active.filter(s => !placedIds.has(s.eh_employee_id)).map(s => ({ s, w: where(s.eh_employee_id) }));
        const opt = ({ s, w }) => `<option value="${s.eh_employee_id}">${esc(s.name)}${w ? ' (in ' + esc(w) + ')' : ''}</option>`;
        return `<optgroup label="Not in a position">${c.filter(x => !x.w).map(opt).join('')}</optgroup><optgroup label="Already in a position (adds a second one)">${c.filter(x => x.w).map(opt).join('')}</optgroup>`; })()}</select></div></div>
    <div class="card"><h2>Edit the card</h2>
      <label>Title</label><input id="f_title" value="${esc(p.title)}" style="width:100%">
      <div class="row">
        <div><label>Area</label><select id="f_area">${AREAS.map(([k, n]) => `<option value="${k}" ${k === p.area ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div><label>Labour section</label><select id="f_section"><option value="">–</option>${Object.entries(SECTION_NAMES).filter(([k]) => !['exclude', 'unmapped', 'unassigned'].includes(k)).map(([k, n]) => `<option value="${k}" ${k === p.section ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div><label>Store</label><select id="f_store"><option value="">–</option>${S.stores.filter(s => s.active).map(s => `<option value="${s.id}" ${s.id === p.store_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div><label>Reports to</label><select id="f_rep"><option value="">–</option>${O.pos.filter(x => x.id !== p.id).map(x => `<option value="${x.id}" ${x.id === p.reports_to ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></div>
        <div><label>FTE the job needs</label><input id="f_fte" type="number" step="0.1" min="0" value="${p.fte}" style="width:90px"></div>
        <div><label>Award / level</label><input id="f_award" value="${esc(p.award || '')}" placeholder="e.g. Dry Cleaning and Laundry Award, Level 2"></div>
        <div><label>Order</label><input id="f_sort" type="number" value="${p.sort}" style="width:70px"></div>
      </div>
      <label>Purpose</label><textarea id="f_purpose" style="min-height:60px">${esc(p.purpose || '')}</textarea>
      <label>Responsibilities (one per line)</label><textarea id="f_resp">${esc(lines(p.responsibilities))}</textarea>
      <label>What good looks like (one per line)</label><textarea id="f_std" style="min-height:60px">${esc(lines(p.standards))}</textarea>
      <label>Measures (one per line: measure | target | live figure)</label><textarea id="f_kpi">${esc(kpiLines)}</textarea>
      <p class="note">Live figure keys: ${esc(METRIC_HELP)}. Leave it off for measures the manager checks by hand.</p>
      <label>Source</label><input id="f_source" value="${esc(p.source || '')}" style="width:100%">
      <div class="row" style="margin-top:10px"><button class="btn" id="rcSave">Save</button><span id="rcMsg" class="note"></span><span class="sp" style="flex:1"></span><button class="btn ghost" id="rcDel" style="color:var(--bad);border-color:var(--bad)">Delete position</button></div>
    </div>
  </div>`;
  const reload = () => { S.cache.org = null; lbRole(el, id); };
  const split = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  $('#rcSave').onclick = async () => {
    const kpis = split($('#f_kpi').value).map(l => { const [label, target, metric] = l.split('|').map(x => (x || '').trim()); return { label, ...(target ? { target } : {}), ...(metric ? { metric } : {}) }; });
    const patch = { title: $('#f_title').value.trim() || 'Untitled', area: $('#f_area').value, section: $('#f_section').value || null, store_id: $('#f_store').value || null,
      reports_to: $('#f_rep').value || null, fte: +$('#f_fte').value || 0, award: $('#f_award').value.trim() || null, sort: +$('#f_sort').value || 100,
      purpose: $('#f_purpose').value.trim(), responsibilities: split($('#f_resp').value), standards: split($('#f_std').value), kpis, source: $('#f_source').value.trim() || null,
      updated_at: new Date().toISOString() };
    let b = O.byId[patch.reports_to];
    while (b) { if (b.id === p.id) { $('#rcMsg').innerHTML = '<span class="err">That would make the position report to itself.</span>'; return; } b = O.byId[b.reports_to]; }
    const { error } = await sb.from('positions').update(patch).eq('id', p.id);
    if (error) { $('#rcMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    reload();
  };
  $('#rcStatus').onclick = async () => { await sb.from('positions').update({ status: p.status === 'approved' ? 'draft' : 'approved', updated_at: new Date().toISOString() }).eq('id', p.id); reload(); };
  $('#rcDel').onclick = async () => {
    if (!confirm(`Delete "${p.title}"? People in it become unplaced and anyone reporting to it moves up to no manager.`)) return;
    const { error } = await sb.from('positions').delete().eq('id', p.id);
    if (error) return alert(error.message);
    S.cache.org = null; location.hash = '#/labour/org';
  };
  $('#rcAdd').onchange = async () => {
    const v = $('#rcAdd').value; if (!v) return;
    const { error } = await sb.from('position_holders').insert({ org_id: S.org.id, position_id: p.id, eh_employee_id: +v });
    if (error) return alert(error.message);
    reload();
  };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await sb.from('position_holders').delete().eq('id', b.dataset.rm); reload(); });
  el.querySelectorAll('[data-share]').forEach(i => i.onchange = async () => { await sb.from('position_holders').update({ share: Math.min(1, Math.max(0.1, +i.value || 1)) }).eq('id', i.dataset.share); reload(); });
  el.querySelectorAll('[data-extc]').forEach(i => i.onchange = async () => { await sb.from('position_holders').update({ ext_cost_pw: +i.value || 0 }).eq('id', i.dataset.extc); reload(); });
  $('#extAdd').onclick = async () => {
    const n = $('#extName').value.trim(); if (!n) return;
    const { error } = await sb.from('position_holders').insert({ org_id: S.org.id, position_id: p.id, ext_name: n, ext_cost_pw: +$('#extCost').value || 0 });
    if (error) return alert(error.message);
    reload();
  };
}

/* ---------- who reports to whom ---------- */
function reportingCard(O) {
  const ppl = p => p.holders.length ? p.holders.map(h => esc(h.name)).join(', ') : '<span class="dn">vacant</span>';
  const managers = O.pos.filter(p => O.pos.some(x => x.reports_to === p.id));
  const count = id => O.pos.filter(x => x.reports_to === id).reduce((a, x) => a + x.holders.length + count(x.id), 0);
  return `<div class="card"><h2>Who reports to whom <small>direct reports; the last column counts everyone underneath</small></h2><div class="scroll"><table>
    <tr><th>Manager</th><th>Held by</th><th style="text-align:left">Direct reports (position: people)</th><th>Everyone under</th></tr>
    ${managers.map(m => `<tr><td><a href="#/labour/role/${m.id}">${esc(m.title)}</a></td><td>${ppl(m)}</td>
      <td style="text-align:left;white-space:normal">${O.pos.filter(x => x.reports_to === m.id).map(x => `<div><a href="#/labour/role/${x.id}">${esc(x.title)}</a>: ${ppl(x)}</div>`).join('')}</td><td>${count(m.id)}</td></tr>`).join('')}
  </table></div><p class="note">Change a line on the role card (Reports to). Draft until each card is approved.</p></div>`;
}

/* ---------- what-if plan ---------- */
function salesPerWeek(Y) {
  if (!Y?.rows) return null;
  const g = k => Y.rows.filter(r => k(r.stream)).reduce((a, r) => a + (+r.w12 || 0), 0) / 12;
  return { retail: g(s => s.startsWith('retail:')), mdc: g(s => s.startsWith('retail:') || s === 'commercial' || s === 'restoration'), drd: g(s => s === 'dr_drapes'), to: Y.last_week_end };
}
function planCost(p, O) {
  const fte = +p.fte || 0, plan = p.plan_fte == null ? fte : +p.plan_fte;
  if (p.plan_fte == null || (plan === fte && p.cost_pw > 0)) return p.cost_pw;
  if (p.cost_pw > 0 && fte > 0 && p.plan_rate == null) return p.cost_pw * plan / fte;
  const same = O.pos.filter(x => x.area === p.area && x.hours_pw > 0);
  const cph = +p.plan_rate || (same.length ? same.reduce((a, x) => a + x.cost_pw, 0) / same.reduce((a, x) => a + x.hours_pw, 0) : 35);
  if (p.cost_pw > 0 && fte > 0) return p.cost_pw + (plan - fte) * FULL_WEEK * cph;
  return plan * FULL_WEEK * cph;
}
function planCard(O, SL) {
  const rows = O.pos.map(p => ({ p, now: p.cost_pw, plan: planCost(p, O) }));
  const bucket = (f, k) => rows.filter(r => f(r.p)).reduce((a, r) => a + r[k], 0);
  const isD = p => p.area === 'dr_drapes', isS = p => p.area === 'stores', notD = p => !isD(p);
  const W = (lab, sales) => sales ? wTxt(lab / sales, .30, .35) : '–';
  const changed = rows.filter(r => Math.abs(r.plan - r.now) >= 1);
  const dNow = bucket(notD, 'now'), dPlan = bucket(notD, 'plan');
  const allNow = bucket(() => true, 'now'), allPlan = bucket(() => true, 'plan');
  return `<div class="card" id="planCard"><h2>Plan changes <small>type a planned FTE to see what it does to wages; nothing changes until you apply it</small></h2>
    <div class="tiles">
      <div class="tile"><div class="l">MDC labour a week (ex Dr Drapes)</div><div class="v">${money(dPlan)}</div><div class="d">${pctTxt(dNow ? dPlan / dNow - 1 : null)} · ${dPlan - dNow >= 0 ? '+' : '-'}${money(Math.abs(dPlan - dNow))} on now</div></div>
      <div class="tile"><div class="l">MDC wage %</div><div class="v">${SL ? W(dPlan, SL.mdc) : '–'}</div><div class="d mu">now ${SL ? W(dNow, SL.mdc) : '–'} on ${SL ? money(SL.mdc) : '–'} sales a week</div></div>
      <div class="tile"><div class="l">Stores wage %</div><div class="v">${SL ? W(bucket(isS, 'plan'), SL.retail) : '–'}</div><div class="d mu">now ${SL ? W(bucket(isS, 'now'), SL.retail) : '–'} on ${SL ? money(SL.retail) : '–'} retail</div></div>
      <div class="tile"><div class="l">Dr Drapes wage %</div><div class="v">${SL ? W(bucket(isD, 'plan'), SL.drd) : '–'}</div><div class="d mu">now ${SL ? W(bucket(isD, 'now'), SL.drd) : '–'} on ${SL ? money(SL.drd) : '–'}</div></div>
      <div class="tile"><div class="l">Change over a year</div><div class="v">${allPlan - allNow >= 0 ? '+' : '-'}${money(Math.abs(allPlan - allNow) * 52)}</div><div class="d mu">${changed.length} position${changed.length === 1 ? '' : 's'} changed</div></div>
    </div>
    <div class="scroll" style="margin-top:10px"><table>
      <tr><th>Position</th><th>People</th><th>FTE now</th><th>Cost/wk now</th><th>Planned FTE</th><th>$/hr for added hours</th><th>Planned cost/wk</th><th>Change/wk</th><th style="text-align:left">Note</th></tr>
      ${rows.map(({ p, now, plan }) => `<tr><td><a href="#/labour/role/${p.id}">${esc(p.title)}</a></td><td>${p.holders.length}</td><td>${p.fte}</td><td>${money(now)}</td>
        <td><input data-pf="${p.id}" type="number" step="0.1" min="0" value="${p.plan_fte ?? ''}" placeholder="${p.fte}" style="width:70px"></td>
        <td><input data-pr="${p.id}" type="number" step="0.5" min="0" value="${p.plan_rate ?? ''}" placeholder="${p.hours_pw > 0 ? (p.cost_pw / p.hours_pw).toFixed(0) : 'avg'}" style="width:70px"></td>
        <td>${money(plan)}</td><td>${Math.abs(plan - now) < 1 ? '<span class="mu">–</span>' : `<span class="${plan > now ? 'dn' : 'up'}">${plan > now ? '+' : '-'}${money(Math.abs(plan - now))}</span>`}</td>
        <td style="text-align:left"><input data-pn="${p.id}" value="${esc(p.plan_note || '')}" placeholder="why" style="width:180px"></td></tr>`).join('')}
    </table></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="planSave">Save plan and recalculate</button><button class="btn ghost" id="planApply">Apply plan to the org chart</button><button class="btn ghost" id="planClear">Clear plan</button><span id="planMsg" class="note"></span></div>
    <p class="note">Cutting FTE scales a position's current pay-run cost down in proportion. Added hours are costed at the $/hr you enter, or else the position's own current rate, or the average for its area if it's vacant or new. Sales are the 12-week weekly average from Xero, ex GST${SL ? ', to ' + fmtD(SL.to) : ''}. MDC sales are retail, commercial and restoration; MDC labour is every position outside Dr Drapes, stores included. WorkCover isn't in any figure. For a new role, use Add position, set its FTE to 0 on the card, then give it a planned FTE here.</p></div>`;
}
function wirePlan(el, O) {
  const read = () => O.pos.map(p => {
    const v = el.querySelector(`[data-pf="${p.id}"]`).value, r = el.querySelector(`[data-pr="${p.id}"]`).value, n = el.querySelector(`[data-pn="${p.id}"]`).value.trim();
    return { id: p.id, plan_fte: v === '' ? null : +v, plan_rate: r === '' ? null : +r, plan_note: n || null };
  });
  const saveAll = async rows => {
    for (const r of rows) {
      const p = O.byId[r.id];
      if ((p.plan_fte ?? null) == r.plan_fte && (p.plan_rate ?? null) == r.plan_rate && (p.plan_note || null) == r.plan_note) continue;
      const { error } = await sb.from('positions').update({ plan_fte: r.plan_fte, plan_rate: r.plan_rate, plan_note: r.plan_note }).eq('id', r.id);
      if (error) throw error;
    }
  };
  $('#planSave').onclick = async () => { try { await saveAll(read()); lbOrg(el); } catch (e) { $('#planMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
  $('#planApply').onclick = async () => {
    const rows = read().filter(r => r.plan_fte != null);
    if (!rows.length) return alert('No planned FTE to apply.');
    if (!confirm(`Set FTE to the planned figure on ${rows.length} position(s)? This changes the org chart only, not anyone's hours or pay.`)) return;
    try {
      await saveAll(read());
      for (const r of rows) { const { error } = await sb.from('positions').update({ fte: r.plan_fte, plan_fte: null, updated_at: new Date().toISOString() }).eq('id', r.id); if (error) throw error; }
      lbOrg(el);
    } catch (e) { $('#planMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  $('#planClear').onclick = async () => { if (!confirm('Clear every planned FTE, rate and note?')) return; await sb.from('positions').update({ plan_fte: null, plan_rate: null, plan_note: null }).eq('org_id', S.org.id); lbOrg(el); };
}
