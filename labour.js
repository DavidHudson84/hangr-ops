/* Hangr Ops: Labour (module B2, admin only).
   Plant: labour by work stream against the sales and pieces that stream produced.
   Stores: counter labour against retail sales, rostered vs worked.
   Repairs: every store's repair sales against the repairers' wages (Seddon does the group's repairs).
   Dr Drapes: weekly wage % (Drapr value of work finished, Xero billed for rolling figures).
   Sections: home section per person, per-shift moves, location mapping sign-off.
   Labour comes from Employment Hero (read-only, daily pull); nothing here writes back to it. */

const LB_TABS = [['plant', 'Plant'], ['stores', 'Stores'], ['repairs', 'Repairs'], ['roster', 'Roster plan'], ['drdrapes', 'Dr Drapes'], ['sections', 'Sections'], ['org', 'Org chart']];
const SECTION_NAMES = {
  shirts: 'Shirts', pressing: 'Pressing / finishing', dc_production: 'Dry cleaning production', wash_fold: 'Wash & fold / DRYZ',
  restoration: 'Restoration', plant_shared: 'Plant shared (front desk, scanning, juniors, management)', delivery: 'Delivery / drivers',
  store_service: 'Store counter', alterations: 'Alterations', admin: 'Office / admin', dr_drapes: 'Dr Drapes', exclude: 'Not counted', unmapped: 'Unmapped', unassigned: 'Unassigned'
};
// labour section -> plant work stream (sales come from services.section with the same stream names)
const STREAMS = [
  ['shirts', 'Shirts', ['shirts']],
  ['dry_cleaning', 'Dry cleaning (production + pressing)', ['dc_production', 'pressing']],
  ['wash_fold', 'Wash & fold, linen, InLaundry', ['wash_fold']],
  ['restoration', 'Restoration', ['restoration']],
];
const OVERHEAD = [['plant_shared', 'Plant shared'], ['delivery', 'Plant delivery'], ['admin', 'Office / admin']];
const LB_FROM = '2025-11-23';
const DRAPR_FROM = '2026-07-19'; // Drapr in full use from this week; earlier weeks show Xero only
const wpct = (a, b) => b ? a / b : null;
const GST = 1.1; // POS Sales Incoming is GST inclusive; every labour ratio uses ex-GST work value (Xero is already ex GST)
const wTxt = (p, warn = .30, bad = .35) => p == null || !isFinite(p) ? '<span class="mu">–</span>' : `<span class="${p >= bad ? 'dn' : p >= warn ? '' : 'up'}" style="${p >= warn && p < bad ? 'color:var(--warn)' : ''}">${(p * 100).toFixed(1)}%</span>`;

async function lbData() {
  if (S.cache.lb) return S.cache.lb;
  const [lw, sw, fin, xw] = await Promise.all([
    all(() => sb.from('v_labour_week').select('*').eq('org_id', S.org.id).gte('week_end', LB_FROM)),
    all(() => sb.from('v_sales_week').select('store_id,service,sales_gross,orders,pieces,week_end').gte('week_end', LB_FROM)),
    all(() => sb.from('fin_weekly').select('*').eq('org_id', S.org.id).gte('week_end', LB_FROM)),
    all(() => sb.from('v_work_value_week').select('*').eq('org_id', S.org.id).gte('week_end', LB_FROM))]);
  const svcSec = Object.fromEntries(S.services.map(s => [s.name, s.section]));
  const svcCh = Object.fromEntries(S.services.map(s => [s.name, s.channel]));
  return S.cache.lb = { lw, sw, fin, xw, svcSec, svcCh };
}
const lastSunday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 7) % 7 || 7)); return iso(d); };

async function labourView(tab = 'plant', arg) {
  app.innerHTML = `
  <div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:18px">Labour</h2><span class="sp"></span>
    <span class="note">Employment Hero, pulled daily at 6:15am. Cost = wages + super. WorkCover not included.</span></div>
  <div class="row" style="margin-bottom:12px">${LB_TABS.map(([k, t]) => `<a class="btn ${k === tab || (k === 'org' && tab === 'role') ? '' : 'ghost'}" style="padding:5px 10px" href="#/labour/${k}">${t}</a>`).join('')}</div>
  <div id="lb"><p class="note">Loading…</p></div>`;
  const fn = { plant: lbPlant, stores: lbStores, repairs: lbRepairs, roster: lbRoster, drdrapes: lbDrd, sections: lbSections, org: lbOrg, role: lbRole }[tab] || lbPlant;
  await fn($('#lb'), arg);
}

function lbWeekPicker(weeksList, sel, href) {
  setTimeout(() => { const el = $('#lbwk'); if (el) el.onchange = () => { location.hash = href + el.value; }; });
  return `<select id="lbwk">${weeksList.slice().reverse().map(w => `<option value="${w}" ${w === sel ? 'selected' : ''}>Week ending ${fmtD(w)}</option>`).join('')}</select>`;
}

/* ---------- plant ---------- */
function plantWeek(d, wk) {
  const lab = d.lw.filter(r => r.week_end === wk);
  const L = secs => lab.filter(r => secs.includes(r.section) && (!r.store_id || r.section !== 'delivery')).reduce((a, r) => ({ h: a.h + +r.hours, c: a.c + +(r.cost || 0) }), { h: 0, c: 0 });
  const sales = {}, pieces = {};
  for (const r of d.sw) if (r.week_end === wk) { const s = d.svcSec[r.service]; if (!s || s === 'none') continue; sales[s] = (sales[s] || 0) + +r.sales_gross / GST; pieces[s] = (pieces[s] || 0) + +r.pieces; }
  const restX = d.fin.find(f => f.week_end === wk && f.stream === 'restoration' && f.source === 'xero');
  const rows = STREAMS.map(([k, name, secs]) => {
    const l = L(secs); let s = sales[k] || 0;
    if (k === 'restoration') s += restX ? +restX.amount : 0;
    const x = d.xw.find(v => v.week_end === wk && v.stream === k), xa = x ? +x.amount : 0;
    return { k, name, h: l.h, c: l.c, sales: s + xa, xero: xa, xest: !!x?.estimated, pieces: pieces[k] || 0 };
  });
  const over = OVERHEAD.map(([k, name]) => { const l = L([k]); return { k, name, h: l.h, c: l.c }; });
  const totS = rows.reduce((a, r) => a + r.sales, 0), totC = rows.reduce((a, r) => a + r.c, 0) + over.reduce((a, r) => a + r.c, 0);
  const totH = rows.reduce((a, r) => a + r.h, 0) + over.reduce((a, r) => a + r.h, 0);
  return { rows, over, totS, totC, totH, hasSales: rows.some(r => r.k !== 'restoration' && r.sales > 0), est: lab.some(r => r.estimated) };
}

async function lbPlant(el, wkSel) {
  const d = await lbData();
  const weeksList = [...new Set(d.lw.map(r => r.week_end))].filter(w => w <= lastSunday()).sort();
  if (!weeksList.length) { el.innerHTML = '<div class="card">No labour loaded yet.</div>'; return; }
  const salesWeeks = new Set(d.sw.map(r => r.week_end));
  const wk = wkSel || weeksList[weeksList.length - 1];
  const P = plantWeek(d, wk);
  const prior = weeksList.filter(w => w < wk && salesWeeks.has(w)).slice(-12).map(w => plantWeek(d, w));
  const avgOf = (k, f) => { const v = prior.map(p => f(p.rows.find(r => r.k === k))).filter(x => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const trend = weeksList.filter(w => salesWeeks.has(w)).slice(-16).map(w => ({ w, ...plantWeek(d, w) }));
  const lastSales = [...salesWeeks].sort().pop();
  el.innerHTML = `
  <div class="row" style="margin-bottom:12px"><span class="note">${P.est ? 'This week uses estimated rates until the pay run lands.' : ''}</span><span class="sp"></span>${lbWeekPicker(weeksList, wk, '#/labour/plant/')}</div>
  ${!P.hasSales ? `<div class="card" style="border-color:#f3c5c0"><b>No POS sales loaded for this week.</b> Labour is current, but Sales Incoming is only loaded to ${fmtD(lastSales)}, so pieces per hour and wage % show for weeks up to then. Once the VA uploads the missing weeks they fill in here.</div>` : ''}
  <div class="tiles">
    <div class="tile"><div class="l">Plant labour</div><div class="v">${money(P.totC)}</div><div class="d mu">${num(P.totH)} hours</div></div>
    <div class="tile"><div class="l">Plant work value</div><div class="v">${P.hasSales ? money(P.totS) : '–'}</div><div class="d mu">ex GST: POS sales by service + restoration and linen billed in Xero</div></div>
    <div class="tile"><div class="l">Plant wage %</div><div class="v">${P.hasSales ? wTxt(wpct(P.totC, P.totS)) : '–'}</div><div class="d mu">includes shared, delivery and office</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>By work stream <small>week ending ${fmtD(wk)}; arrows compare with the prior 12 weeks that have sales</small></h2><div class="scroll"><table>
    <tr><th>Stream</th><th>Hours</th><th>Labour</th><th>Sales</th><th>Pieces</th><th>Pieces / hr</th><th>12-wk avg</th><th>Labour / piece</th><th>Wage %</th><th>12-wk avg</th></tr>
    ${P.rows.map(r => { const pph = r.h ? r.pieces / r.h : null, wp = wpct(r.c, r.sales);
      const aP = avgOf(r.k, x => x.h && x.pieces ? x.pieces / x.h : null), aW = avgOf(r.k, x => x.sales ? x.c / x.sales : null);
      return `<tr><td>${esc(r.name)}</td><td>${num(r.h)}</td><td>${money(r.c)}</td><td>${r.sales ? money(r.sales) : '–'}${r.xero ? `<div class="note">incl. ${money(r.xero)} Xero linen${r.xest ? ' (Pacific est.)' : ''}</div>` : ''}</td><td>${r.pieces ? num(r.pieces) : '–'}</td>
        <td>${r.pieces && pph ? pph.toFixed(1) : '–'}</td><td class="mu">${aP ? aP.toFixed(1) : '–'}</td><td>${r.pieces ? money(r.c / r.pieces, 2) : '–'}</td><td>${wTxt(wp)}</td><td>${wTxt(aW)}</td></tr>`; }).join('')}
    ${P.over.map(r => `<tr><td class="mu">${esc(r.name)}</td><td>${num(r.h)}</td><td>${money(r.c)}</td><td colspan="5" class="note" style="text-align:left">shared cost, counted in the plant total</td><td>${wTxt(wpct(r.c, P.totS), .05, .08)}</td><td></td></tr>`).join('')}
    <tr class="tot"><td>Plant total</td><td>${num(P.totH)}</td><td>${money(P.totC)}</td><td>${money(P.totS)}</td><td></td><td></td><td></td><td></td><td>${wTxt(wpct(P.totC, P.totS))}</td><td></td></tr>
  </table></div>
  <p class="note">Pieces for wash & fold are counted the way the POS counts them (bags and kilos in some services), so compare that row with itself over time rather than with the others. Sales are ex GST. Wash & fold also counts the linen and uniform customers billed straight from Xero (Frog, Kempe, Little Ginger, Seaview, The Views, Westgate, Pacific Meats); Pacific is invoiced monthly, so its month is spread by day, and a month not yet invoiced uses the previous month's rate (marked est.) until the invoice lands. Restoration sales are what Xero billed that week (Steamatic, Coathanger, Linx, private), so the week can swing with invoicing.</p></div>
  <div class="card"><h2>Plant wage % by week</h2><div class="scroll"><table>
    <tr><th>Week ending</th><th>Labour</th><th>Hours</th><th>Work value</th><th>Wage %</th>${STREAMS.map(s => `<th>${esc(s[1].split(' (')[0].split(',')[0])}</th>`).join('')}</tr>
    ${trend.slice().reverse().map(t => `<tr><td>${fmtD(t.w)}</td><td>${money(t.totC)}</td><td>${num(t.totH)}</td><td>${money(t.totS)}</td><td>${wTxt(wpct(t.totC, t.totS))}</td>${t.rows.map(r => `<td>${wTxt(wpct(r.c, r.sales))}</td>`).join('')}</tr>`).join('')}
  </table></div></div>`;
}

/* ---------- stores ---------- */
async function lbStores(el, wkSel) {
  const d = await lbData();
  const noLab = new Set(S.services.filter(x => x.labour_exclude).map(x => x.name));
  const weeksList = [...new Set(d.lw.map(r => r.week_end))].filter(w => w <= lastSunday()).sort();
  const wk = wkSel || weeksList[weeksList.length - 1];
  const stores = S.stores.filter(s => d.lw.some(r => r.store_id === s.id));
  const { data: roster } = await sb.from('labour_roster').select('work_date,hours,eh_location_id').eq('org_id', S.org.id).gte('work_date', addDays(wk, -6)).lte('work_date', wk);
  const { data: locs } = await sb.from('labour_locations').select('eh_location_id,store_id').eq('org_id', S.org.id);
  const locStore = Object.fromEntries((locs || []).map(l => [l.eh_location_id, l.store_id]));
  const row = (s, w) => {
    const lab = d.lw.filter(r => r.week_end === w && r.store_id === s.id && r.section !== 'alterations');
    const c = lab.reduce((a, r) => a + +(r.cost || 0), 0), h = lab.reduce((a, r) => a + +r.hours, 0), sal = lab.reduce((a, r) => a + +(r.salaried_cost || 0), 0);
    const ids = [s.id, ...S.stores.filter(x => x.labour_parent_id === s.id).map(x => x.id)];
    const sales = d.sw.filter(r => r.week_end === w && ids.includes(r.store_id) && d.svcCh[r.service] === 'retail' && !noLab.has(r.service)).reduce((a, r) => a + +r.sales_gross / GST, 0);
    const orders = d.sw.filter(r => r.week_end === w && ids.includes(r.store_id) && d.svcCh[r.service] === 'retail').reduce((a, r) => a + +r.orders, 0);
    return { c, h, sal, sales, orders };
  };
  const salesWeeks = [...new Set(d.sw.map(r => r.week_end))].sort();
  el.innerHTML = `
  <div class="row" style="margin-bottom:12px"><span class="sp"></span>${lbWeekPicker(weeksList, wk, '#/labour/stores/')}</div>
  <div class="card"><h2>Stores <small>week ending ${fmtD(wk)}: counter and store delivery labour against the store's retail sales (repairs are on the Repairs tab)</small></h2><div class="scroll"><table>
    <tr><th>Store</th><th>Hours worked</th><th>Rostered</th><th>Labour</th><th>of which salaried</th><th>Retail sales ex GST <span class="note">excl. shoe repairs</span></th><th>Wage %</th><th>12-wk wage %</th><th>Orders / labour hr</th></tr>
    ${stores.map(s => { const r = row(s, wk), kids = S.stores.filter(x => x.labour_parent_id === s.id).map(x => x.name);
      const rost = (roster || []).filter(x => locStore[x.eh_location_id] === s.id).reduce((a, x) => a + +x.hours, 0);
      const pw = salesWeeks.filter(w => w <= wk).slice(-12).map(w => row(s, w)).filter(x => x.sales);
      const avg = pw.length ? pw.reduce((a, x) => a + x.c, 0) / pw.reduce((a, x) => a + x.sales, 0) : null;
      return `<tr><td>${esc(s.name)}${kids.length ? `<div class="note">incl. ${esc(kids.join(', '))} sales and driver</div>` : ''}</td><td>${num(r.h)}</td><td>${rost ? num(rost) : '–'}</td><td>${money(r.c)}</td><td class="mu">${r.sal ? money(r.sal) : '–'}</td><td>${r.sales ? money(r.sales) : '–'}</td><td>${r.sales ? wTxt(wpct(r.c, r.sales), .25, .32) : '–'}</td><td>${wTxt(avg, .25, .32)}</td><td>${r.sales && r.h ? (r.orders / r.h).toFixed(1) : '–'}</td></tr>`; }).join('')}
  </table></div>
  <p class="note">Rostered hours come from the Employment Hero store rosters. Salaried staff (Rhonda at Albert Park) are spread evenly over weekdays, so compare stores with and without that column. Retail sales are blank for weeks after the last Sales Incoming upload (${fmtD(salesWeeks[salesWeeks.length - 1])}).</p></div>`;
}

/* ---------- repairs: the whole group's repair sales against the repairers' wages ---------- */
async function lbRepairs(el) {
  const d = await lbData();
  const inHouse = new Set(S.stores.filter(s => s.repairs_in_house !== false).map(s => s.id));
  const sv = r => d.svcSec[r.service] === 'alterations' && inHouse.has(r.store_id);
  const salesWeeks = [...new Set(d.sw.map(r => r.week_end))].sort();
  const weeksList = [...new Set(d.lw.map(r => r.week_end))].filter(w => w <= lastSunday()).sort();
  const wkRow = w => {
    const lab = d.lw.filter(r => r.week_end === w && r.section === 'alterations');
    const s = d.sw.filter(r => r.week_end === w && sv(r));
    return { w, h: lab.reduce((a, r) => a + +r.hours, 0), c: lab.reduce((a, r) => a + +(r.cost || 0), 0),
      sales: s.reduce((a, r) => a + +r.sales_gross / GST, 0), pcs: s.reduce((a, r) => a + +r.pieces, 0), has: salesWeeks.includes(w) };
  };
  const rows = weeksList.slice(-16).map(wkRow);
  const last12 = rows.filter(r => r.has).slice(-12);
  const S12 = last12.reduce((a, r) => ({ h: a.h + r.h, c: a.c + r.c, s: a.s + r.sales, p: a.p + r.pcs }), { h: 0, c: 0, s: 0, p: 0 }), n = last12.length || 1;
  const from = last12[0]?.w, to = last12[last12.length - 1]?.w;
  const byStore = {};
  for (const r of d.sw) if (sv(r) && from && r.week_end >= from && r.week_end <= to) { const k = r.store_id; byStore[k] = byStore[k] || { s: 0, p: 0 }; byStore[k].s += +r.sales_gross / GST; byStore[k].p += +r.pieces; }
  const stName = id => S.stores.find(s => s.id === id)?.name || 'Other';
  const svcNames = S.services.filter(s => s.section === 'alterations').map(s => s.name).join(', ');
  el.innerHTML = last12.length ? `
  <div class="tiles">
    <div class="tile"><div class="l">Repair sales a week</div><div class="v">${money(S12.s / n)}</div><div class="d mu">ex GST, every store, ${num(S12.p / n)} pieces</div></div>
    <div class="tile"><div class="l">Repair wages a week</div><div class="v">${money(S12.c / n)}</div><div class="d mu">${num(S12.h / n)} hours</div></div>
    <div class="tile"><div class="l">Repairs wage %</div><div class="v">${wTxt(wpct(S12.c, S12.s), .35, .45)}</div><div class="d mu">12 weeks to ${fmtD(to)}</div></div>
    <div class="tile"><div class="l">Sales per repair hour</div><div class="v">${S12.h ? money(S12.s / S12.h) : '–'}</div><div class="d mu">${S12.h ? (S12.p / S12.h).toFixed(1) + ' pieces an hour' : ''}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Week by week</h2><div class="scroll"><table>
    <tr><th>Week ending</th><th>Repair sales ex GST</th><th>Pieces</th><th>Repair hours</th><th>Repair wages</th><th>Wage %</th><th>Sales / hour</th></tr>
    ${rows.slice().reverse().map(r => `<tr><td>${fmtD(r.w)}</td><td>${r.has ? money(r.sales) : '<span class="mu">not loaded</span>'}</td><td>${r.has ? num(r.pcs) : ''}</td><td>${num(r.h)}</td><td>${money(r.c)}</td>
      <td>${r.has ? wTxt(wpct(r.c, r.sales), .35, .45) : '–'}</td><td>${r.has && r.h ? money(r.sales / r.h) : '–'}</td></tr>`).join('')}
  </table></div></div>
  <div class="card"><h2>Where the repairs come from <small>12 weeks to ${fmtD(to)}, a week on average</small></h2><div class="scroll"><table>
    <tr><th>Store taking the work in</th><th>Repair sales ex GST</th><th>Pieces</th><th>Share</th></tr>
    ${Object.entries(byStore).sort((a, b) => b[1].s - a[1].s).map(([k, v]) => `<tr><td>${esc(stName(k))}</td><td>${money(v.s / n)}</td><td>${num(v.p / n)}</td><td>${S12.s ? (v.s / S12.s * 100).toFixed(0) + '%' : ''}</td></tr>`).join('')}
  </table></div>
  <p class="note">Repair sales are the POS services ${esc(svcNames)} at every store, ex GST. Shoe Repairs is left out because a cobbler does that work, and so is ${esc(S.stores.filter(s => s.repairs_in_house === false).map(s => s.name).join(', ') || 'no store')}, whose repairs were never ours. Repair wages are the Alterations section: Seddon's repairers, less the counter time of anyone who also serves (Surin: the first 2 hours of each day she works count as Seddon counter).</p></div>`
  : '<div class="card">No repair sales loaded yet.</div>';
}

/* ---------- Dr Drapes ---------- */
async function lbDrd(el) {
  const d = await lbData();
  const F = (w, src) => d.fin.find(f => f.week_end === w && f.stream === 'dr_drapes' && f.source === src);
  const weeksList = [...new Set(d.fin.filter(f => f.stream === 'dr_drapes').map(f => f.week_end))].filter(w => w <= lastSunday()).sort();
  const lab = w => d.lw.filter(r => r.week_end === w && r.section === 'dr_drapes').reduce((a, r) => ({ c: a.c + +(r.cost || 0), h: a.h + +r.hours, s: a.s + +(r.salaried_cost || 0), e: a.e || r.estimated }), { c: 0, h: 0, s: 0, e: false });
  const rows = weeksList.map(w => ({ w, l: lab(w), x: +(F(w, 'xero')?.amount || 0), xr: +(F(w, 'xero')?.detail?.restoration || 0), dr: w >= DRAPR_FROM ? +(F(w, 'drapr')?.amount || 0) : 0, jobs: w >= DRAPR_FROM ? F(w, 'drapr')?.jobs || 0 : 0 }))
    .filter(r => r.l.c > 0);
  const roll = (i, n, key) => { const p = rows.slice(Math.max(0, i - n + 1), i + 1); return p.length < n ? null : p.reduce((a, r) => a + r.l.c, 0) / p.reduce((a, r) => a + r[key], 0); };
  rows.forEach((r, i) => { r.r4 = roll(i, 4, 'x'); r.r12 = roll(i, 12, 'x'); r.d4 = roll(i, 4, 'dr'); });
  const cur = rows[rows.length - 1] || {};
  const last12 = rows.slice(-12);
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
  el.innerHTML = rows.length ? `
  <div class="tiles">
    <div class="tile"><div class="l">Last week's wage %</div><div class="v">${wTxt(wpct(cur.l.c, cur.dr), .35, .45)}</div><div class="d mu">${money(cur.l.c)} labour on ${money(cur.dr)} of work finished (Drapr)</div></div>
    <div class="tile"><div class="l">4-week rolling</div><div class="v">${wTxt(cur.r4, .35, .45)}</div><div class="d mu">on Xero billed</div></div>
    <div class="tile"><div class="l">12-week rolling</div><div class="v">${wTxt(cur.r12, .35, .45)}</div><div class="d mu">${money(sum(last12, r => r.l.c))} on ${money(sum(last12, r => r.x))}</div></div>
    <div class="tile"><div class="l">Labour a week</div><div class="v">${money(sum(last12, r => r.l.c) / (last12.length || 1))}</div><div class="d mu">${money(sum(last12, r => r.l.s) / (last12.length || 1))} of it salaried</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Week by week <small>ex GST</small></h2><div class="scroll"><table>
    <tr><th>Week ending</th><th>Labour</th><th>Hours</th><th>Drapr finished</th><th>Jobs</th><th>Wage % (Drapr)</th><th>Xero billed</th><th>of which restoration</th><th>4-wk %</th><th>12-wk %</th></tr>
    ${rows.slice().reverse().map(r => `<tr><td>${fmtD(r.w)}${r.l.e ? ' <span class="chip">est</span>' : ''}</td><td>${money(r.l.c)}</td><td>${num(r.l.h)}</td><td>${r.dr ? money(r.dr) : '–'}</td><td>${r.jobs || '–'}</td><td>${r.dr ? wTxt(wpct(r.l.c, r.dr), .35, .45) : '–'}</td>
      <td>${money(r.x)}</td><td class="mu">${r.xr ? money(r.xr) : '–'}</td><td>${wTxt(r.r4, .35, .45)}</td><td>${wTxt(r.r12, .35, .45)}</td></tr>`).join('')}
  </table></div>
  <p class="note">Labour is the Dr Drapes cost centres in Employment Hero plus Nicole, Shirley and John (salaried, spread over weekdays). Drapr is the value of jobs that first reached Rehung, Complete or Invoiced that week, so it shows the work done; Xero is account 41450 Dr Drapes Revenue on approved invoices by invoice date, which swings with batch invoicing, so it drives the rolling figures. Restoration curtain work billed to Steamatic, Coathanger and Linx is in Xero 41450 when it was coded there. Drapr figures start the week ending 19 Jul 2026, when it came into full use. Not yet included: curtains cleaned in the MDC plant and any subcontract installers.</p></div>`
    : '<div class="card">No Dr Drapes figures loaded yet.</div>';
}

/* ---------- sections ---------- */
async function lbSections(el, who) {
  const [locs, staff, shifts] = await Promise.all([
    sb.from('labour_locations').select('*').eq('org_id', S.org.id).order('name'),
    sb.from('labour_staff').select('*').eq('org_id', S.org.id).order('name'),
    all(() => sb.from('v_labour_shift').select('eh_timesheet_id,eh_employee_id,work_date,hours,section,eff_location_id,clocked_location_id,overridden,flag,start_at,end_at').eq('org_id', S.org.id).gte('work_date', addDays(iso(new Date()), -56)))]);
  const L = locs.data || [], ST = staff.data || [];
  const byId = Object.fromEntries(L.map(l => [l.eh_location_id, l]));
  const specific = L.filter(l => !l.generic);
  const short = n => String(n || '').replace(/^Master Dry Cleaners \/ /, '').replace(/^Laundry \/ /, '');
  const opt = (sel, blank = '— none —') => `<option value="">${blank}</option>` + specific.map(l => `<option value="${l.eh_location_id}" ${+sel === l.eh_location_id ? 'selected' : ''}>${esc(short(l.name))} · ${esc(SECTION_NAMES[l.section] || l.section || '?')}</option>`).join('');
  const hrs = {};
  for (const s of shifts) { const o = hrs[s.eh_employee_id] ||= { gen: 0, tot: 0 }; o.tot += +s.hours; if (byId[s.clocked_location_id]?.generic) o.gen += +s.hours; }
  const active = ST.filter(s => (hrs[s.eh_employee_id]?.tot || 0) > 0 || s.non_clocking).sort((a, b) => (hrs[b.eh_employee_id]?.gen || 0) - (hrs[a.eh_employee_id]?.gen || 0));
  const unsigned = L.filter(l => !l.signed_off).length;
  el.innerHTML = `
  <div class="card"><h2>People <small>last 8 weeks</small></h2>
    <p class="note">Whenever someone clocks on to plain "Laundry", their hours go to the section chosen here. Hangr Ops guesses it from the times they did pick a section ("auto"). Change it here and it's yours: the daily pull never overwrites it. People who never clock on (salaried) are costed from their pay run and spread over weekdays. Click a name to move single shifts.</p>
    <div class="scroll"><table>
    <tr><th>Person</th><th>Hours</th><th>to plain Laundry</th><th>Section for plain Laundry / salaried</th><th>Set by</th><th></th></tr>
    ${active.map(s => { const h = hrs[s.eh_employee_id] || { gen: 0, tot: 0 }; const cur = s.non_clocking ? s.non_clock_location_id : s.home_location_id;
      return `<tr><td><a href="#/labour/sections/${s.eh_employee_id}">${esc(s.name)}</a>${s.non_clocking ? ' <span class="chip">salaried</span>' : ''}</td><td>${num(h.tot)}</td><td>${h.gen ? num(h.gen) : '–'}</td>
        <td><select data-emp="${s.eh_employee_id}" data-nc="${s.non_clocking ? 1 : 0}" style="max-width:380px">${opt(cur)}</select></td>
        <td class="mu" id="src-${s.eh_employee_id}">${s.home_source === 'manual' ? 'you' : s.home_source === 'auto' ? 'auto' : '–'}</td><td id="ok-${s.eh_employee_id}"></td></tr>`; }).join('')}
  </table></div></div>
  <div id="shiftCard"></div>
  <div class="card"><h2>Locations <small>how each Employment Hero work location is counted${unsigned ? `; ${unsigned} not yet signed off` : ''}</small></h2>
    <p class="note">Draft mapping from 26 Nov 2026. Tick "Signed off" once a row is right; signed-off rows are never changed by the daily pull.</p>
    <div class="scroll"><table><tr><th>Location</th><th>Counts as</th><th>Store</th><th>Signed off</th><th></th></tr>
    ${L.map(l => `<tr><td>${esc(short(l.name))}</td>
      <td>${l.generic ? '<span class="note">person\'s home section</span>' : `<select data-lsec="${l.eh_location_id}">${Object.entries(SECTION_NAMES).filter(([k]) => !['unmapped', 'unassigned'].includes(k)).map(([k, n]) => `<option value="${k}" ${l.section === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`}</td>
      <td>${l.generic ? '' : `<select data-lsto="${l.eh_location_id}"><option value="">Plant / none</option>${S.stores.map(s => `<option value="${s.id}" ${l.store_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`}</td>
      <td><input type="checkbox" data-lsig="${l.eh_location_id}" ${l.signed_off ? 'checked' : ''}></td><td id="lok-${l.eh_location_id}"></td></tr>`).join('')}
    </table></div></div>`;
  const done = () => { S.cache.lb = null; };
  el.querySelectorAll('select[data-emp]').forEach(sel => sel.onchange = async () => {
    const id = +sel.dataset.emp, v = sel.value ? +sel.value : null;
    const patch = sel.dataset.nc === '1' ? { non_clock_location_id: v, home_source: 'manual' } : { home_location_id: v, home_source: 'manual' };
    const { error } = await sb.from('labour_staff').update(patch).eq('org_id', S.org.id).eq('eh_employee_id', id);
    $('#ok-' + id).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : '<span class="up">saved</span>';
    if (!error) { $('#src-' + id).textContent = 'you'; done(); }
  });
  const saveLoc = async id => {
    const patch = { signed_off: el.querySelector(`[data-lsig="${id}"]`).checked };
    const s = el.querySelector(`[data-lsec="${id}"]`), t = el.querySelector(`[data-lsto="${id}"]`);
    if (s) patch.section = s.value; if (t) patch.store_id = t.value || null;
    const { error } = await sb.from('labour_locations').update(patch).eq('org_id', S.org.id).eq('eh_location_id', id);
    $('#lok-' + id).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : '<span class="up">saved</span>';
    if (!error) done();
  };
  el.querySelectorAll('[data-lsec],[data-lsto],[data-lsig]').forEach(x => x.onchange = () => saveLoc(+(x.dataset.lsec || x.dataset.lsto || x.dataset.lsig)));

  if (who) {
    const p = ST.find(s => s.eh_employee_id === +who);
    const mine = shifts.filter(s => s.eh_employee_id === +who).sort((a, b) => a.work_date < b.work_date ? 1 : -1);
    const t = d => d ? String(d).slice(11, 16) : '';
    $('#shiftCard').innerHTML = `<div class="card"><h2>${esc(p?.name || 'Shifts')} <small>last 8 weeks; pick a location to move one shift</small></h2><div class="scroll"><table>
      <tr><th>Date</th><th>Time</th><th>Hours</th><th>Clocked to</th><th>Counted as</th><th>Move to</th><th></th></tr>
      ${mine.map(s => `<tr><td>${fmtD(s.work_date)}</td><td>${t(s.start_at)}–${t(s.end_at)}</td><td>${(+s.hours).toFixed(2)}${s.flag ? ` <span class="chip" title="${esc(s.flag)}">flagged</span>` : ''}</td>
        <td>${esc(short(byId[s.clocked_location_id]?.name))}</td><td>${esc(SECTION_NAMES[s.section] || s.section)}${s.overridden ? ' <span class="chip">moved</span>' : ''}</td>
        <td><select data-shift="${s.eh_timesheet_id}">${opt(s.overridden ? s.eff_location_id : '', s.overridden ? '— undo move —' : '— leave —')}</select></td><td id="sok-${s.eh_timesheet_id}"></td></tr>`).join('')}
    </table></div><p class="note">A move changes only how Hangr Ops counts the shift. Employment Hero and pay are untouched.</p></div>`;
    $('#shiftCard').querySelectorAll('select[data-shift]').forEach(sel => sel.onchange = async () => {
      const id = +sel.dataset.shift;
      const q = sel.value
        ? sb.from('labour_shift_overrides').upsert({ org_id: S.org.id, eh_timesheet_id: id, eh_location_id: +sel.value, set_at: new Date().toISOString() })
        : sb.from('labour_shift_overrides').delete().eq('org_id', S.org.id).eq('eh_timesheet_id', id);
      const { error } = await q;
      $('#sok-' + id).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : '<span class="up">saved</span>';
      if (!error) done();
    });
    $('#shiftCard').scrollIntoView({ behavior: 'smooth' });
  }
}

/* ---------- roster plan (B3) ---------- */
const STREAM_NAMES = { shirts: 'Shirts', dry_cleaning: 'Dry cleaning (production + pressing)', wash_fold: 'Wash & fold, linen, InLaundry' };
const OH_NAMES = { plant_shared: 'Plant shared', delivery: 'Plant delivery', restoration: 'Restoration', admin: 'Office / admin' };
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monday = d => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };

async function lbRoster(el, wkSel) {
  const thisMon = monday(iso(new Date()));
  const wk = wkSel || addDays(thisMon, 7);
  const { data: P, error } = await sb.rpc('roster_plan', { p_org: S.org.id, p_week: wk });
  if (error) { el.innerHTML = `<div class="card err">${esc(error.message)}</div>`; return; }
  const T = P.targets || {};
  const hrs = v => v == null ? '–' : Number(v).toFixed(0);
  const diff = (a, b) => a == null || b == null ? '<span class="mu">–</span>' : `<span class="${a - b > 0 ? 'dn' : 'up'}">${a - b > 0 ? '+' : ''}${(a - b).toFixed(0)}</span>`;
  const streams = P.streams || [], oh = P.overhead || [], stores = P.stores || [];
  const needN = streams.reduce((a, r) => a + (+r.need_normal || 0), 0), needT = streams.reduce((a, r) => a + (+r.need_target || 0), 0);
  const ohH = oh.filter(o => o.st !== 'restoration').reduce((a, o) => a + +o.h4, 0);
  const ohC = oh.filter(o => o.st !== 'restoration').reduce((a, o) => a + o.h4 * o.cph, 0);
  const curH = streams.reduce((a, r) => a + (+r.h4 || 0), 0);
  const curC = streams.reduce((a, r) => a + (+r.h4 || 0) * (+r.cph || 0), 0);
  const needC = streams.reduce((a, r) => a + (+r.need_normal || 0) * (+r.cph || 0), 0);
  const fcSales = streams.reduce((a, r) => a + (+r.sales || 0), 0);
  const weeks = [-7, 0, 7, 14].map(n => addDays(thisMon, n));
  const intake = P.weekday_intake || {}, wh = P.weekday_hours || {};
  const whTot = Object.values(wh).reduce((a, b) => a + +b, 0);
  el.innerHTML = `
  <div class="row" style="margin-bottom:12px"><span class="note">Sales are loaded to ${fmtD(P.sales_loaded_to)}, so the forecast is the same week last year adjusted by the trend in the latest 12 weeks loaded. It sharpens once the VA backfills Sales Incoming.</span><span class="sp"></span>
    <select id="rwk">${weeks.map(w => `<option value="${w}" ${w === wk ? 'selected' : ''}>Week of ${fmtD(w)}${w === thisMon ? ' (this week)' : w === addDays(thisMon, 7) ? ' (next week)' : ''}</option>`).join('')}</select></div>
  <div class="tiles">
    <div class="tile"><div class="l">Plant hours needed (normal pace)</div><div class="v">${hrs(needN + ohH)}</div><div class="d mu">${hrs(needT + ohH)} at target pace</div></div>
    <div class="tile"><div class="l">Average week, last 4 weeks</div><div class="v">${hrs(curH + ohH)}</div><div class="d">${diff(curH, needN)} hours on the production lines</div></div>
    <div class="tile"><div class="l">${curC >= needC ? 'Over the plan by' : 'Under the plan by'}</div><div class="v">${money(Math.abs(curC - needC))}</div><div class="d mu">a week on the production lines, at each section's cost per hour</div></div>
    <div class="tile"><div class="l">Plant wage % at the plan</div><div class="v">${fcSales ? wTxt((needC + ohC) / fcSales) : '–'}</div><div class="d mu">target ${T.plant_wage_pct ?? '–'}% · now ${fcSales ? ((curC + ohC) / fcSales * 100).toFixed(1) + '%' : '–'}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Plant, week of ${fmtD(P.week_start)} <small>hours needed for the forecast work against what the plant has been working</small></h2><div class="scroll"><table>
    <tr><th>Stream</th><th>Forecast pieces</th><th>Forecast value</th><th>Normal pace</th><th>Hours needed</th><th>At target pace</th><th>Avg last 4 wks</th><th>Last week</th><th>Over (+) / under</th><th>$ a week</th></tr>
    ${streams.map(r => `<tr><td>${esc(STREAM_NAMES[r.stream] || r.stream)}<div class="note">${esc(r.basis)}</div></td><td>${num(r.pieces)}</td><td>${money(r.sales)}</td><td>${r.pph_normal}/hr</td><td><b>${hrs(r.need_normal)}</b></td><td>${hrs(r.need_target)} <span class="note">(${r.pph_target}/hr)</span></td>
      <td>${hrs(r.h4)}</td><td>${hrs(r.hl)}</td><td>${diff(+r.h4, +r.need_normal)}</td><td>${r.h4 != null && r.cph ? money((r.h4 - r.need_normal) * r.cph) : '–'}</td></tr>`).join('')}
    ${oh.map(o => `<tr><td class="mu">${esc(OH_NAMES[o.st] || o.st)}</td><td colspan="3" class="note" style="text-align:left">${o.st === 'restoration' ? 'job-driven; plan from the restoration board' : 'not driven by pieces; held at the 4-week average'}</td><td>${hrs(o.h4)}</td><td></td><td>${hrs(o.h4)}</td><td>${hrs(o.hl)}</td><td></td><td></td></tr>`).join('')}
  </table></div>
  <p class="note">Normal pace is the median week's pieces per hour since November 2025; target pace is the best quarter of weeks. Restoration isn't in the plant total because its work comes by the job, not by the piece.</p></div>
  <div class="card"><h2>Which days <small>share of the plant's hours vs share of retail work coming in, by weekday</small></h2><div class="scroll"><table>
    <tr><th></th>${[1, 2, 3, 4, 5, 6].map(d => `<th>${DOW[d]}</th>`).join('')}</tr>
    <tr><td>Plant hours (last 8 weeks)</td>${[1, 2, 3, 4, 5, 6].map(d => `<td>${whTot ? ((+wh[d] || 0) / whTot * 100).toFixed(0) + '%' : '–'}</td>`).join('')}</tr>
    <tr><td>Retail work in (Customer Orders)</td>${[1, 2, 3, 4, 5, 6].map(d => `<td>${intake[d] != null ? (+intake[d]).toFixed(0) + '%' : '–'}</td>`).join('')}</tr>
    <tr><td>Hours needed by day (normal pace)</td>${[1, 2, 3, 4, 5, 6].map(d => { if (d === 6) return `<td class="mu">as now</td>`; const prev = d === 1 ? (+intake[5] || 0) + (+intake[6] || 0) + (+intake[7] || 0) : (+intake[d - 1] || 0); return `<td>${hrs(needN * prev / 100)}</td>`; }).join('')}</tr>
  </table></div><p class="note">Work dropped off one day is mostly processed the next, so "hours needed by day" follows the previous working day's intake (Friday to Sunday drop-offs land on Monday; Saturday stays as it is now). Commercial work isn't in the intake split yet. Shared, delivery and office hours are on top.</p></div>
  <div class="card"><h2>Stores, week of ${fmtD(P.week_start)} <small>counter hours the forecast sales can carry at ${T.store_wage_pct ?? 25}% against the Employment Hero roster</small></h2><div class="scroll"><table>
    <tr><th>Store</th><th>Forecast retail sales ex GST</th><th>Rostered (EH)</th><th>Worked, avg 4 wks</th><th>Affordable at ${T.store_wage_pct ?? 25}%</th><th>Roster over (+) / under</th><th>$ a week</th></tr>
    ${stores.map(r => { const base = r.rostered ?? r.h4; return `<tr><td>${esc(r.name)}${r.salaried ? `<div class="note">after ${money(r.salaried)} a week of salaried cost</div>` : ''}</td><td>${money(r.sales_fc)}</td><td>${r.rostered != null ? hrs(r.rostered) : '<span class="mu">not rostered yet</span>'}</td><td>${hrs(r.h4)}</td><td><b>${hrs(r.affordable)}</b></td><td>${diff(+base, +r.affordable)}</td><td>${r.cph ? money((base - r.affordable) * r.cph) : '–'}</td></tr>`; }).join('')}
  </table></div><p class="note">Where the week isn't rostered yet, the comparison uses the 4-week average worked. Stores need minimum cover to open, so treat "under" as room, not a target. Hours here are clocked hours; salaried pay is taken off the budget first.</p></div>
  <div class="card"><h2>Standards</h2><div class="row">
    ${Object.keys(T).sort().map(k => `<div><label>${esc(k.replace('pph_normal_', 'Normal pieces/hr: ').replace('pph_target_', 'Target pieces/hr: ').replace('store_wage_pct', 'Store wage % target').replace('plant_wage_pct', 'Plant wage % target').replace('dry_cleaning', 'dry cleaning').replace('wash_fold', 'wash & fold'))}</label><input data-tg="${k}" type="number" step="0.1" value="${T[k]}" style="width:110px"></div>`).join('')}
    <button class="btn ghost" id="tgSave" style="align-self:flex-end">Save standards</button><span id="tgMsg" class="note" style="align-self:flex-end"></span></div></div>`;
  $('#rwk').onchange = () => { location.hash = '#/labour/roster/' + $('#rwk').value; };
  $('#tgSave').onclick = async () => {
    const rows = [...el.querySelectorAll('[data-tg]')].map(i => ({ org_id: S.org.id, key: i.dataset.tg, value: +i.value, updated_at: new Date().toISOString() }));
    const { error } = await sb.from('roster_targets').upsert(rows);
    $('#tgMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.';
    if (!error) lbRoster(el, wk);
  };
}
