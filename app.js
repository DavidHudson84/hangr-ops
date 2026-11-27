/* Hangr Ops — hosted, store by store. Supabase project hangr-ops (pswvmkrtnantiwjoexyq).
   The publishable key below grants nothing on its own: every table is behind RLS. */
const SB_URL = 'https://pswvmkrtnantiwjoexyq.supabase.co';
const SB_KEY = 'sb_publishable_ssdzvsceXUe5nQOIWiTUTA_Gs8QfWdL';
const sb = supabase.createClient(SB_URL, SB_KEY);

const S = { user: null, platform: false, mems: [], orgs: [], org: null, stores: [], services: [], cache: {} };
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, dp = 0) => v == null || isNaN(v) ? '–' : '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = v => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('en-AU', { maximumFractionDigits: 0 });
const pct = (a, b) => (b ? (a / b - 1) : null);
const pctTxt = p => p == null || !isFinite(p) ? '<span class="mu">–</span>' : `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}%</span>`;
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x); };
const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

async function all(q) { // page past PostgREST's 1000-row cap
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) return out; from += 1000;
  }
}

/* ---------- roles ---------- */
const memFor = org => S.mems.filter(m => m.org_id === org);
const isAdmin = () => S.platform || memFor(S.org?.id).some(m => m.role === 'org_admin');
const canUpload = () => isAdmin() || memFor(S.org?.id).some(m => m.role === 'va');
const myStores = () => isAdmin() ? S.stores : S.stores.filter(s => memFor(S.org?.id).some(m => m.store_id === s.id));

/* ---------- auth ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  S.user = session.user;
  const [pa, mem, orgs] = await Promise.all([
    sb.from('platform_admins').select('user_id').eq('user_id', S.user.id),
    sb.from('memberships').select('*').eq('user_id', S.user.id),
    sb.from('orgs').select('*').order('name')]);
  S.platform = (pa.data || []).length > 0; S.mems = mem.data || []; S.orgs = orgs.data || [];
  if (!S.orgs.length) {
    app.innerHTML = `<div class="card login"><h2>Account not active yet</h2><p>You're signed in as ${esc(S.user.email)}, but this login hasn't been given access to a business. Ask David to activate it.</p><button class="btn ghost" onclick="signOut()">Sign out</button></div>`;
    return;
  }
  const saved = localStorageGet('hangr_org');
  await setOrg(S.orgs.find(o => o.id === saved) || S.orgs[0]);
  $('#hdr').hidden = false; $('#who').textContent = S.user.email;
  window.addEventListener('hashchange', route); route();
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { } }

async function setOrg(org) {
  S.org = org; S.cache = {}; localStorageSet('hangr_org', org.id);
  const [st, sv] = await Promise.all([
    sb.from('stores').select('*').eq('org_id', org.id).order('sort'),
    sb.from('services').select('*').eq('org_id', org.id)]);
  S.stores = st.data || []; S.services = sv.data || [];
  const sel = $('#orgSel');
  sel.hidden = S.orgs.length < 2;
  sel.innerHTML = S.orgs.map(o => `<option value="${o.id}" ${o.id === org.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  sel.onchange = async () => { await setOrg(S.orgs.find(o => o.id === sel.value)); location.hash = '#/'; route(); };
  buildNav();
}

function buildNav() {
  const links = [];
  if (isAdmin()) links.push(['#/group', 'Group']);
  myStores().filter(s => s.active).forEach(s => links.push([`#/store/${s.code}`, s.name]));
  if (isAdmin() || myStores().length) links.push(['#/customers', 'Customers']);
  if (isAdmin()) links.push(['#/accounts', 'Accounts']);
  if (isAdmin()) links.push(['#/marketing', 'Marketing']);
  if (isAdmin()) links.push(['#/labour', 'Labour']);
  if (canUpload()) links.push(['#/upload', 'Upload']);
  if (isAdmin()) links.push(['#/admin', 'Admin']);
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('');
}

function loginView(msg = '') {
  $('#hdr').hidden = true;
  app.innerHTML = `<div class="card login">
    <h2>Hangr Ops</h2>
    <form id="lf">
      <label>Email</label><input id="em" type="email" autocomplete="username" required>
      <label>Password</label><input id="pw" type="password" autocomplete="current-password" required minlength="8">
      <div class="row" style="margin-top:14px"><button class="btn">Sign in</button>
      <button class="btn ghost" type="button" id="su">First time? Create login</button></div>
      <p class="note" id="lm">${esc(msg)}</p>
    </form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) $('#lm').innerHTML = `<span class="err">${esc(error.message === 'Email not confirmed' ? 'This login is waiting for David to activate it.' : error.message)}</span>`;
    else boot();
  };
  $('#su').onclick = async () => {
    const email = $('#em').value.trim(), password = $('#pw').value;
    if (!email || password.length < 8) { $('#lm').textContent = 'Enter your email and a password of at least 8 characters, then press Create login.'; return; }
    const tryIn = await sb.auth.signInWithPassword({ email, password });
    if (!tryIn.error) return boot(); // already active: just sign in
    const { error } = await sb.auth.signUp({ email, password });
    $('#lm').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Login created. Ask David to activate it, then sign in.';
  };
}
async function signOut() { await sb.auth.signOut(); location.hash = ''; location.reload(); }
$('#outBtn').onclick = signOut;

/* ---------- data ---------- */
async function weeks() {
  if (!S.cache.weeks) {
    const from = '2022-01-01';
    S.cache.weeks = await all(() => sb.rpc('dash_weeks', { p_org: S.org.id, p_from: from }));
  }
  return S.cache.weeks;
}
async function months() { return S.cache.months ||= await all(() => sb.rpc('dash_months', { p_org: S.org.id })); }
async function tiers() { return S.cache.tiers ||= await all(() => sb.rpc('dash_customer_tiers', { p_org: S.org.id })); }
async function onceOnly() { return S.cache.once ||= (await sb.rpc('dash_once_only', { p_org: S.org.id })).data || []; }

// per store per week, split by channel
function weekMap(rows, storeIds) {
  const m = new Map();
  for (const r of rows) {
    if (storeIds && !storeIds.includes(r.store_id)) continue;
    const k = r.week_end; const o = m.get(k) || { week_end: k, retail: 0, commercial: 0, restoration: 0, other: 0, orders: 0, pieces: 0, r_orders: 0, r_pieces: 0, discounts: 0 };
    o[r.channel] = (o[r.channel] || 0) + Number(r.sales);
    o.orders += Number(r.orders); o.pieces += Number(r.pieces); o.discounts += Number(r.discounts || 0);
    if (r.channel === 'retail') { o.r_orders += Number(r.orders); o.r_pieces += Number(r.pieces); }
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => a.week_end < b.week_end ? -1 : 1);
}
function stats(series, weekEnd, key = 'retail') {
  const i = series.findIndex(w => w.week_end === weekEnd);
  const cur = series[i]; if (!cur) return {};
  const prev12 = series.slice(Math.max(0, i - 12), i);
  const avg12 = prev12.length ? prev12.reduce((a, w) => a + w[key], 0) / prev12.length : null;
  const ly = series.find(w => Math.abs((new Date(w.week_end) - new Date(addDays(weekEnd, -364))) / 864e5) <= 3);
  return { cur, avg12, ly, n12: prev12.length };
}

/* ---------- charts ---------- */
function barChart(series, key, avgKey, h = 160, note) {
  if (!series.length) return '<p class="note">No data yet.</p>';
  const W = 900, pad = 34, max = Math.max(...series.map(s => s[key])) * 1.1 || 1, bw = (W - pad) / series.length;
  let bars = '', line = '';
  series.forEach((s, i) => {
    const bh = (s[key] / max) * (h - 24);
    bars += `<rect x="${pad + i * bw + 1}" y="${h - 18 - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" fill="#2E75B6" opacity=".85"><title>${fmtD(s.week_end)}: ${money(s[key], max < 1000 ? 2 : 0)}</title></rect>`;
    if (avgKey && s[avgKey] != null) line += `${line ? 'L' : 'M'}${pad + i * bw + bw / 2},${h - 18 - (s[avgKey] / max) * (h - 24)}`;
    if (i % Math.ceil(series.length / 8) === 0) bars += `<text x="${pad + i * bw}" y="${h - 4}">${fmtD(s.week_end)}</text>`;
  });
  const ticks = [0, .5, 1].map(f => `<text x="0" y="${h - 18 - f * (h - 24) + 4}">${max < 1000 ? money(max * f) : money(max * f / 1000) + 'k'}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">${ticks}${bars}${line ? `<path d="${line}" fill="none" stroke="#1F3864" stroke-width="2"/>` : ''}</svg>
    ${avgKey ? `<p class="note">${note || 'Bars are weekly sales; the dark line is the 12-week rolling average.'}</p>` : ''}`;
}
function withRolling(series, key) {
  return series.map((s, i) => { const p = series.slice(Math.max(0, i - 11), i + 1); return { ...s, avg: p.length >= 4 ? p.reduce((a, x) => a + x[key], 0) / p.length : null }; });
}

/* ---------- $ per order ---------- */
// retail $/order this week vs last week, prior 12-week average (sum/sum) and the same week last year
function aovStats(series, wk) {
  const i = series.findIndex(w => w.week_end === wk), cur = series[i];
  const a = w => w && w.r_orders ? w.retail / w.r_orders : null;
  const p = series.slice(Math.max(0, i - 12), i).filter(w => w.r_orders);
  const ly = series.find(w => Math.abs((new Date(w.week_end) - new Date(addDays(wk, -364))) / 864e5) <= 3);
  return { cur: a(cur), last: i > 0 ? a(series[i - 1]) : null, avg12: p.length ? p.reduce((s, w) => s + w.retail, 0) / p.reduce((s, w) => s + w.r_orders, 0) : null,
    ly: a(ly), ppo: cur && cur.r_orders ? cur.r_pieces / cur.r_orders : null };
}
async function tickets() { return S.cache.tickets ||= await all(() => sb.rpc('dash_ticket_weeks', { p_org: S.org.id, p_from: '2023-01-01' })); }
// real tickets per week for these stores, shaped like weekMap rows so aovStats works on it
async function ticketSeries(storeIds) {
  const m = new Map();
  for (const r of await tickets()) {
    if (!storeIds.includes(r.store_id)) continue;
    const o = m.get(r.week_end) || { week_end: r.week_end, retail: 0, r_orders: 0, r_pieces: 0 };
    o.retail += +r.sales; o.r_orders += +r.orders; m.set(r.week_end, o);
  }
  return [...m.values()].sort((a, b) => a.week_end < b.week_end ? -1 : 1);
}
async function orderMix() { return S.cache.mix ||= (await sb.rpc('dash_order_mix', { p_org: S.org.id })).data || []; }
async function aovCard(siSeries, wk, storeIds) {
  const series = await ticketSeries(storeIds);
  const lastT = series.length ? series[series.length - 1].week_end : null;
  if (!series.length) return '';
  const wkT = series.some(w => w.week_end === wk) ? wk : lastT;
  const A = aovStats(series, wkT);
  const si = siSeries.find(w => w.week_end === wkT);
  A.ppo = si && A.cur ? si.r_pieces / series.find(w => w.week_end === wkT).r_orders : null;
  const aovSer = series.filter(w => w.r_orders && w.week_end <= wkT).slice(-52).map(w => ({ week_end: w.week_end, aov: w.retail / w.r_orders }));
  const mix = (await orderMix()).filter(r => storeIds.includes(r.store_id));
  const agg = (kind, period) => { const m = new Map(); for (const r of mix.filter(r => r.kind === kind && r.period === period)) { const o = m.get(r.label) || { label: r.label, sort: r.sort, orders: 0, sales: 0 }; o.orders += +r.orders; o.sales += +r.sales; m.set(r.label, o); } return [...m.values()].sort((a, b) => a.sort - b.sort); };
  const cur = agg('band', 'cur'), ly = agg('band', 'ly'), tiers = agg('tier', 'cur');
  const tot = a => a.reduce((s, r) => ({ o: s.o + r.orders, s: s.s + r.sales }), { o: 0, s: 0 });
  const tc = tot(cur), tl = tot(ly);
  const under30 = cur.filter(r => r.sort <= 2).reduce((s, r) => s + r.orders, 0);
  const tile = (l, v, d) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  return `<div class="card"><h2>Average retail order <small>real tickets from Customer Orders, week ending ${fmtD(wkT)}${wkT !== wk ? ` (Customer Orders are loaded to ${fmtD(lastT)})` : ''}</small></h2>
    <div class="tiles">
      ${tile('$ per ticket', money(A.cur, 2), `<span class="mu">${A.ppo ? A.ppo.toFixed(2) + ' pieces per ticket' : ''}</span>`)}
      ${tile('vs last week', money(A.last, 2), pctTxt(pct(A.cur, A.last)))}
      ${tile('vs 12-week average', money(A.avg12, 2), pctTxt(pct(A.cur, A.avg12)))}
      ${tile('vs same week last year', money(A.ly, 2), pctTxt(pct(A.cur, A.ly)))}
    </div>
    <div style="margin-top:10px">${barChart(withRolling(aovSer, 'aov'), 'aov', 'avg', 130, 'Bars are $ per retail ticket each week; the dark line is the 12-week rolling average. Account customers are left out.')}</div>
    ${cur.length ? `<h2 style="margin-top:14px">Order sizes <small>retail orders, last 12 weeks of Customer Orders loaded vs the same 12 weeks a year earlier</small></h2>
    <div class="grid g2"><div class="scroll"><table>
      <tr><th>Order value</th><th>Orders</th><th>% of orders</th><th>Last year</th><th>% of sales</th></tr>
      ${cur.map(r => { const l = ly.find(x => x.label === r.label); return `<tr><td>${esc(r.label)}</td><td>${num(r.orders)}</td><td>${(r.orders / tc.o * 100).toFixed(1)}%</td><td class="mu">${l && tl.o ? (l.orders / tl.o * 100).toFixed(1) + '%' : '–'}</td><td>${(r.sales / tc.s * 100).toFixed(1)}%</td></tr>`; }).join('')}
      <tr class="tot"><td>Average order</td><td>${num(tc.o)}</td><td>${money(tc.s / tc.o, 2)}</td><td class="mu">${tl.o ? money(tl.s / tl.o, 2) : '–'}</td><td></td></tr>
    </table></div>
    <div><table><tr><th>Customer tier</th><th>Orders</th><th>$ per order</th></tr>
      ${tiers.map(r => `<tr><td>${esc(r.label)}</td><td>${num(r.orders)}</td><td>${money(r.sales / r.orders, 2)}</td></tr>`).join('')}</table>
      <p class="note">${(under30 / tc.o * 100).toFixed(0)}% of retail orders are under $30. Adding one more garment to those orders is the quickest way to lift the average. The ideas to test are in the plan.</p></div></div>` : ''}
  </div>`;
}

/* ---------- routing ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', location.hash === a.getAttribute('href') || location.hash.startsWith(a.getAttribute('href') + '/')));
  const go = (fn, ...a) => fn(...a).catch(e => { app.innerHTML = `<div class="card err">Something went wrong: ${esc(e.message || e)}</div>`; console.error(e); });
  if (h[0] === 'store' && h[1]) return go(storeView, h[1], h[2]);
  if (h[0] === 'upload' && canUpload()) return go(uploadView);
  if (h[0] === 'marketing' && isAdmin()) return go(marketingView, h[1]);
  if (h[0] === 'accounts' && isAdmin()) return go(accountsView, h[1]);
  if (h[0] === 'labour' && isAdmin()) return go(labourView, h[1], h[2]);
  if (h[0] === 'customers') return go(customersView, h[1] ? decodeURIComponent(h[1]) : '');
  if (h[0] === 'customer' && h[1]) return go(customerView, h[1]);
  if (h[0] === 'admin' && isAdmin()) return go(adminView);
  if (h[0] === 'group' && isAdmin()) return go(groupView, h[1]);
  if (isAdmin()) return go(groupView);
  const s = myStores()[0]; if (s) { location.hash = `#/store/${s.code}`; return; }
  if (canUpload()) { location.hash = '#/upload'; return; }
  app.innerHTML = '<div class="card">No store assigned to this login yet.</div>';
}

function weekPicker(series, sel, onPick) {
  const opts = series.slice().reverse().slice(0, 104).map(w => `<option value="${w.week_end}" ${w.week_end === sel ? 'selected' : ''}>Week ending ${fmtD(w.week_end)}</option>`).join('');
  setTimeout(() => { const el = $('#wk'); if (el) el.onchange = () => onPick(el.value); });
  return `<select id="wk">${opts}</select>`;
}

/* ---------- group ---------- */
async function groupView(weekSel) {
  app.innerHTML = '<p class="note">Loading group…</p>';
  const rows = await weeks();
  const stores = S.stores.filter(s => s.in_group);
  const group = weekMap(rows, stores.map(s => s.id));
  if (!group.length) { app.innerHTML = '<div class="card">No sales loaded yet. Use Upload to add Sales Incoming exports.</div>'; return; }
  const wk = weekSel || group[group.length - 1].week_end;
  const g = stats(group, wk);
  const gc = stats(group, wk, 'commercial');
  const per = stores.map(s => {
    const ser = weekMap(rows, [s.id]); const st = stats(ser, wk); const sc = stats(ser, wk, 'commercial');
    return { s, st, sc };
  }).filter(x => x.st.cur || x.s.active);
  const tot = g.cur;
  const gT = aovStats(await ticketSeries(stores.map(s => s.id)), wk);
  for (const x of per) x.av = aovStats(await ticketSeries([x.s.id]), wk);
  app.innerHTML = `
  <div class="row" style="margin-bottom:12px"><h2 style="margin:0;font-size:18px">${esc(S.org.name)}: group</h2><span class="sp"></span>${weekPicker(group, wk, v => groupView(v))}</div>
  <div class="tiles">
    <div class="tile"><div class="l">Retail sales</div><div class="v">${money(tot.retail)}</div><div class="d">${pctTxt(pct(tot.retail, g.avg12))} vs 12-wk avg · ${pctTxt(g.ly ? pct(tot.retail, g.ly.retail) : null)} vs LY</div></div>
    <div class="tile"><div class="l">Commercial (on account)</div><div class="v">${money(tot.commercial)}</div><div class="d">${pctTxt(pct(tot.commercial, gc.avg12))} vs 12-wk avg</div></div>
    <div class="tile"><div class="l">Restoration</div><div class="v">${money(tot.restoration)}</div><div class="d mu">through the stores' POS</div></div>
    <div class="tile"><div class="l">Retail service lines</div><div class="v">${num(tot.r_orders)}</div><div class="d">${gT.cur ? `${money(gT.cur, 2)} per ticket · ${pctTxt(pct(gT.cur, gT.avg12))} vs 12-wk` : '<span class="mu">ticket data not loaded for this week</span>'}</div></div>
    <div class="tile"><div class="l">Retail pieces</div><div class="v">${num(tot.r_pieces)}</div><div class="d mu">${money(tot.retail / tot.r_pieces, 2)} per piece</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Stores <small>retail sales, week ending ${fmtD(wk)}</small></h2><div class="scroll"><table>
    <tr><th>Store</th><th>Retail</th><th>12-wk avg</th><th>vs avg</th><th>vs LY</th><th>Lines</th><th>$/ticket</th><th>vs 12-wk</th><th>vs LY</th><th>Pcs/line</th><th>$/piece</th><th>Commercial</th></tr>
    ${per.map(({ s, st, sc, av }) => {
    const c = st.cur || { retail: 0, r_orders: 0, r_pieces: 0, commercial: 0 };
    return `<tr class="click" onclick="location.hash='#/store/${s.code}/${wk}'"><td>${esc(s.name)} ${s.channel !== 'retail' ? `<span class="chip">${s.channel}</span>` : ''}</td>
      <td>${money(c.retail)}</td><td>${money(st.avg12)}</td><td>${pctTxt(pct(c.retail, st.avg12))}</td><td>${pctTxt(st.ly ? pct(c.retail, st.ly.retail) : null)}</td>
      <td>${num(c.r_orders)}</td><td>${av.cur ? money(av.cur, 2) : '–'}</td><td>${pctTxt(pct(av.cur, av.avg12))}</td><td>${pctTxt(pct(av.cur, av.ly))}</td><td>${c.r_orders ? (c.r_pieces / c.r_orders).toFixed(2) : '–'}</td><td>${c.r_pieces ? money(c.retail / c.r_pieces, 2) : '–'}</td>
      <td>${money(c.commercial)}</td></tr>`;
  }).join('')}
    <tr class="tot"><td>Group</td><td>${money(tot.retail)}</td><td>${money(g.avg12)}</td><td>${pctTxt(pct(tot.retail, g.avg12))}</td><td>${pctTxt(g.ly ? pct(tot.retail, g.ly.retail) : null)}</td><td>${num(tot.r_orders)}</td><td>${gT.cur ? money(gT.cur, 2) : '–'}</td><td>${pctTxt(pct(gT.cur, gT.avg12))}</td><td>${pctTxt(pct(gT.cur, gT.ly))}</td><td>${(tot.r_pieces / tot.r_orders).toFixed(2)}</td><td>${money(tot.retail / tot.r_pieces, 2)}</td><td>${money(tot.commercial)}</td></tr>
  </table></div><p class="note">Retail and commercial are split by POS service (Admin › Services). Orders are as Sales Incoming counts them (each service on a ticket counts once); $/ticket is the real average ticket from Customer Orders. "vs LY" fills in once last year's weeks are loaded.</p></div>
  ${await aovCard(group, wk, stores.map(s => s.id))}
  <div class="card"><h2>Group retail sales by week</h2>${barChart(withRolling(group.slice(-52), 'retail'), 'retail', 'avg')}</div>
  <div class="card"><h2>Commercial by week <small>on-account work booked through the stores</small></h2>${barChart(withRolling(group.slice(-52), 'commercial'), 'commercial', 'avg', 120)}</div>
  ${await customersSummaryCard(stores.map(s => s.id), true)}`;
}

async function customersSummaryCard(storeIds, perStore) {
  const t = (await tiers()).filter(r => storeIds.includes(r.store_id) && !r.is_commercial);
  const o = (await onceOnly()).filter(r => storeIds.includes(r.store_id));
  const order = ['VIP', 'Regular', 'Casual', 'Lapsed'];
  const count = (ids, tier) => t.filter(r => ids.includes(r.store_id) && r.tier === tier).reduce((a, r) => a + Number(r.customers), 0);
  const one = ids => { const x = o.filter(r => ids.includes(r.store_id)); const a = x.reduce((s, r) => s + Number(r.one_visit), 0), b = x.reduce((s, r) => s + Number(r.total), 0); return b ? `${num(a)} <span class="mu">(${(a / b * 100).toFixed(0)}%)</span>` : '–'; };
  const lines = perStore ? S.stores.filter(s => storeIds.includes(s.id) && s.channel === 'retail').map(s => [s.name, [s.id]]) : [];
  lines.push(['Total', storeIds]);
  return `<div class="card"><h2>Retail customers <small>account customers excluded · Lapsed = no order for 180+ days</small></h2><div class="scroll"><table>
    <tr><th>Store</th>${order.map(x => `<th>${x}</th>`).join('')}<th>Visited once only</th></tr>
    ${lines.map(([n, ids]) => `<tr class="${n === 'Total' ? 'tot' : ''}"><td>${esc(n)}</td>${order.map(x => `<td>${num(count(ids, x))}</td>`).join('')}<td>${one(ids)}</td></tr>`).join('')}
  </table></div></div>`;
}

/* ---------- store ---------- */
async function storeView(code, weekSel) {
  const store = S.stores.find(s => s.code === code);
  if (!store || !myStores().includes(store)) { app.innerHTML = '<div class="card">This store isn\'t available to your login.</div>'; return; }
  app.innerHTML = `<p class="note">Loading ${esc(store.name)}…</p>`;
  const rows = await weeks();
  const ser = weekMap(rows, [store.id]);
  if (!ser.length) { app.innerHTML = `<div class="card">No sales loaded for ${esc(store.name)} yet.</div>`; return; }
  const wk = weekSel || ser[ser.length - 1].week_end;
  const st = stats(ser, wk), c = st.cur || {};
  const [svc, mon, best, fresh, drift, comm, lab] = await Promise.all([
    sb.from('v_sales_week').select('service,channel,sales_gross,orders,pieces,week_end').eq('store_id', store.id).gte('week_end', addDays(wk, -84)).lte('week_end', wk),
    months(),
    sb.from('v_customers').select('full_name,mobile,lifetime_spend,spend_12m,orders_12m,last_order,tier,days_since').eq('store_id', store.id).eq('is_commercial', false).order('spend_12m', { ascending: false }).limit(15),
    sb.from('v_customers').select('full_name,mobile,first_order,lifetime_spend,order_count').eq('store_id', store.id).eq('is_commercial', false).not('first_order', 'is', null).gt('order_count', 0).order('first_order', { ascending: false }).limit(15),
    sb.from('v_customers').select('full_name,mobile,lifetime_spend,last_order,days_since,tier,order_count').eq('store_id', store.id).eq('is_commercial', false).gte('lifetime_spend', 500).gte('days_since', 45).lte('days_since', 180).order('lifetime_spend', { ascending: false }).limit(15),
    sb.from('commentary').select('*').eq('store_id', store.id).eq('week_end', wk).maybeSingle(),
    isAdmin() ? sb.from('v_labour_week').select('week_end,cost').eq('store_id', store.id).gte('week_end', addDays(wk, -77)).lte('week_end', wk) : Promise.resolve({ data: [] })]);
  const labW = new Map(); for (const r of lab.data || []) labW.set(r.week_end, (labW.get(r.week_end) || 0) + +(r.cost || 0));
  const wageCur = labW.has(wk) && c.retail ? labW.get(wk) / c.retail : null;
  const wPrior = ser.filter(w => w.week_end <= wk && labW.has(w.week_end) && w.retail).slice(-12);
  const wage12 = wPrior.length ? wPrior.reduce((a, w) => a + labW.get(w.week_end), 0) / wPrior.reduce((a, w) => a + w.retail, 0) : null;
  // services: this week vs prior 12-week average
  const sv = new Map();
  for (const r of svc.data || []) {
    const o = sv.get(r.service) || { service: r.service, channel: r.channel, cur: 0, orders: 0, pieces: 0, prior: 0, n: new Set() };
    if (r.week_end === wk) { o.cur += +r.sales_gross; o.orders += +r.orders; o.pieces += +r.pieces; } else { o.prior += +r.sales_gross; o.pOrders = (o.pOrders || 0) + +r.orders; o.n.add(r.week_end); }
    sv.set(r.service, o);
  }
  const priorWeeks = new Set((svc.data || []).filter(r => r.week_end !== wk).map(r => r.week_end)).size || 1;
  const svList = [...sv.values()].filter(x => x.cur || x.prior).sort((a, b) => b.cur - a.cur);
  const mm = new Map();
  for (const r of mon.filter(r => r.store_id === store.id)) { const o = mm.get(r.month_start) || { m: r.month_start, retail: 0, commercial: 0, restoration: 0, other: 0 }; o[r.channel] += +r.sales; mm.set(r.month_start, o); }
  const mlist = [...mm.values()].sort((a, b) => a.m < b.m ? 1 : -1).slice(0, 13);
  const asOf = (best.data || [])[0] ? null : null;
  app.innerHTML = `
  <div class="row" style="margin-bottom:12px"><h2 style="margin:0;font-size:18px">${esc(store.name)}</h2><span class="sp"></span>${weekPicker(ser, wk, v => storeView(code, v))}</div>
  <div class="tiles">
    <div class="tile"><div class="l">Retail sales</div><div class="v">${money(c.retail)}</div><div class="d">${pctTxt(pct(c.retail, st.avg12))} vs 12-wk avg (${money(st.avg12)})</div></div>
    <div class="tile"><div class="l">vs same week last year</div><div class="v">${st.ly ? money(st.ly.retail) : '–'}</div><div class="d">${pctTxt(st.ly ? pct(c.retail, st.ly.retail) : null)}</div></div>
    <div class="tile"><div class="l">Service lines</div><div class="v">${num(c.r_orders)}</div><div class="d mu">service lines; see Average retail order below</div></div>
    <div class="tile"><div class="l">Pieces</div><div class="v">${num(c.r_pieces)}</div><div class="d mu">${c.r_pieces ? money(c.retail / c.r_pieces, 2) : '–'} per piece · ${c.r_orders ? (c.r_pieces / c.r_orders).toFixed(2) : '–'} per line</div></div>
    <div class="tile"><div class="l">Commercial booked here</div><div class="v">${money(c.commercial)}</div><div class="d mu">on-account work, not in retail</div></div>
    <div class="tile"><div class="l">Counter wage %</div><div class="v">${wageCur != null ? (wageCur * 100).toFixed(1) + '%' : '<span class="mu">–</span>'}</div><div class="d mu">${wage12 != null ? `12-wk ${(wage12 * 100).toFixed(1)}% · ` : ''}${labW.has(wk) ? money(labW.get(wk)) + ' labour' : 'no labour data this week'}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Retail sales by week</h2>${barChart(withRolling(ser.slice(-52), 'retail'), 'retail', 'avg')}</div>
  ${await aovCard(ser, wk, [store.id])}
  <div class="grid g2">
    <div class="card"><h2>Services <small>week ending ${fmtD(wk)} vs its prior 12-week average</small></h2><div class="scroll"><table>
      <tr><th>Service</th><th>Sales</th><th>12-wk avg</th><th>vs avg</th><th>Orders</th><th>$/order (this service)</th><th>12-wk</th><th>Pieces</th><th>$/piece</th></tr>
      ${svList.map(x => { const avg = x.prior / priorWeeks; return `<tr><td>${esc(x.service)} ${x.channel !== 'retail' ? `<span class="chip">${x.channel}</span>` : ''}</td><td>${money(x.cur)}</td><td>${money(avg)}</td><td>${pctTxt(pct(x.cur, avg))}</td><td>${num(x.orders)}</td><td>${x.orders ? money(x.cur / x.orders, 2) : '–'}</td><td class="mu">${x.pOrders ? money(x.prior / x.pOrders, 2) : '–'}</td><td>${num(x.pieces)}</td><td>${x.pieces ? money(x.cur / x.pieces, 2) : '–'}</td></tr>`; }).join('')}
    </table></div></div>
    <div class="card"><h2>Monthly</h2><div class="scroll"><table>
      <tr><th>Month</th><th>Retail</th><th>vs LY</th><th>Commercial</th></tr>
      ${mlist.map(m => { const ly = mm.get(m.m.replace(/^\d{4}/, y => y - 1)); return `<tr><td>${new Date(m.m + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}</td><td>${money(m.retail)}</td><td>${pctTxt(ly ? pct(m.retail, ly.retail) : null)}</td><td>${money(m.commercial)}</td></tr>`; }).join('')}
    </table></div></div>
  </div>
  ${await customersSummaryCard([store.id], false)}
  <div class="grid g2">
    ${custTable('Best customers, last 12 months', best.data, ['full_name', 'spend_12m', 'orders_12m', 'last_order'], ['Customer', 'Spend 12m', 'Orders', 'Last order'])}
    ${custTable('Drifting: $500+ lifetime, 45 to 180 days since last order', drift.data, ['full_name', 'lifetime_spend', 'days_since', 'mobile'], ['Customer', 'Lifetime', 'Days', 'Mobile'])}
    ${custTable('Newest customers', fresh.data, ['full_name', 'first_order', 'order_count', 'lifetime_spend'], ['Customer', 'First order', 'Orders', 'Spend'])}
    <div class="card"><h2>Commentary <small>week ending ${fmtD(wk)}</small></h2>
      <textarea id="cm" placeholder="What happened this week? Staffing, weather, a big account, a complaint…">${esc(comm.data?.body || '')}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="cmSave">Save</button><span class="note" id="cmMsg">${comm.data ? `Last saved by ${esc(comm.data.author_name || '')} ${new Date(comm.data.updated_at).toLocaleString('en-AU')}` : ''}</span></div></div>
  </div>`;
  $('#cmSave').onclick = async () => {
    const { error } = await sb.from('commentary').upsert({ org_id: S.org.id, store_id: store.id, week_end: wk, body: $('#cm').value, author: S.user.id, author_name: S.user.email, updated_at: new Date().toISOString() });
    $('#cmMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.';
  };
}
function custTable(title, rows, cols, heads) {
  const f = (k, v) => /spend/.test(k) ? money(v) : /order$|first_order|last_order/.test(k) && typeof v === 'string' && v.includes('-') ? fmtD(v) : v ?? '–';
  return `<div class="card"><h2>${esc(title)}</h2><div class="scroll"><table><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>
    ${(rows || []).map(r => `<tr>${cols.map(k => `<td>${esc(f(k, r[k]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="mu">None</td></tr>`}</table></div></div>`;
}

/* ---------- customers ---------- */
async function customersView(q) {
  const ids = myStores().map(s => s.id);
  app.innerHTML = `<div class="card"><h2>Customers</h2>
    <form id="cs" class="row"><input id="cq" placeholder="Name, mobile or email" value="${esc(q)}" style="flex:1;min-width:220px">
    <select id="cst"><option value="">All my stores</option>${myStores().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <select id="ctier"><option value="">Any tier</option>${['VIP', 'Regular', 'Casual', 'Lapsed'].map(t => `<option>${t}</option>`).join('')}</select>
    <label style="display:flex;gap:4px;align-items:center;margin:0"><input type="checkbox" id="ccom"> account customers only</label>
    <button class="btn">Search</button></form><div id="cres" style="margin-top:10px"></div></div>`;
  const run = async () => {
    const t = $('#cq').value.trim();
    let qb = sb.from('v_customers').select('id,full_name,mobile,email,store_id,tier,last_order,order_count,lifetime_spend,spend_12m,is_commercial').eq('org_id', S.org.id).in('store_id', $('#cst').value ? [$('#cst').value] : ids);
    if (t) { const d = t.replace(/\D/g, ''); qb = d.length >= 6 ? qb.ilike('mobile', `%${d.slice(-8)}%`) : qb.or(`full_name.ilike.%${t.replace(/[,()%]/g, ' ')}%,email.ilike.%${t.replace(/[,()%]/g, ' ')}%`); }
    if ($('#ctier').value) qb = qb.eq('tier', $('#ctier').value);
    if ($('#ccom').checked) qb = qb.eq('is_commercial', true);
    const { data, error } = await qb.order('spend_12m', { ascending: false }).limit(100);
    if (error) { $('#cres').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    const sn = id => S.stores.find(s => s.id === id)?.name || '';
    $('#cres').innerHTML = `<div class="scroll"><table><tr><th>Customer</th><th>Store</th><th>Tier</th><th>Mobile</th><th>Last order</th><th>Orders</th><th>Spend 12m</th><th>Lifetime</th></tr>
      ${data.map(c => `<tr class="click" onclick="location.hash='#/customer/${c.id}'"><td>${esc(c.full_name)} ${c.is_commercial ? '<span class="chip">account</span>' : ''}</td><td>${esc(sn(c.store_id))}</td><td>${c.tier}</td><td>${esc(c.mobile || '')}</td><td>${fmtD(c.last_order)}</td><td>${num(c.order_count)}</td><td>${money(c.spend_12m)}</td><td>${money(c.lifetime_spend)}</td></tr>`).join('') || '<tr><td colspan="8" class="mu">No matches</td></tr>'}
    </table></div><p class="note">Showing up to 100, highest 12-month spend first.</p>`;
  };
  $('#cs').onsubmit = e => { e.preventDefault(); run(); };
  run();
}

const SVC_GROUPS = { shirts: 'Shirts', dry_cleaning: 'Dry cleaning', household: 'Household (doonas, blankets)', wash_fold: 'Wash & fold', repairs: 'Repairs & alterations', curtains: 'Curtains', formal: 'Wedding & formal', shoes_leather: 'Shoes & leather' };
async function serviceCard(id) {
  const [{ data: rows }, { data: org }] = await Promise.all([
    sb.from('customer_services').select('grp,orders,sales,first_used,last_used').eq('customer_id', id),
    sb.from('orgs').select('services_from,services_to').eq('id', S.org.id).maybeSingle()]);
  if (!org?.services_from) return '';
  const by = Object.fromEntries((rows || []).map(r => [r.grp, r]));
  return `<div class="card"><h2>Services used <small>orders from ${fmtD(org.services_from)} to ${fmtD(org.services_to)}</small></h2><div class="scroll"><table>
    <tr><th>Service</th><th>Orders</th><th>Spend</th><th>First</th><th>Last</th></tr>
    ${Object.entries(SVC_GROUPS).map(([g, n]) => { const r = by[g]; return r ? `<tr><td>${n}</td><td>${num(r.orders)}</td><td>${money(r.sales)}</td><td>${fmtD(r.first_used)}</td><td>${fmtD(r.last_used)}</td></tr>`
      : `<tr class="mu"><td>${n}</td><td colspan="4">never</td></tr>`; }).join('')}
  </table></div><p class="note">From the Sales Incoming by service and order uploads. An order with two services counts under both.</p></div>`;
}
async function customerView(id) {
  const [{ data: c }, { data: orders }] = await Promise.all([
    sb.from('v_customers').select('*').eq('id', id).maybeSingle(),
    sb.from('customer_orders').select('order_date,order_time,status,picked_up_date,sales,pieces').eq('customer_id', id).order('order_date', { ascending: false }).limit(200)]);
  if (!c) { app.innerHTML = '<div class="card">Customer not found, or not in your store.</div>'; return; }
  const gaps = []; const ds = (orders || []).map(o => o.order_date).sort();
  for (let i = 1; i < ds.length; i++) gaps.push((new Date(ds[i]) - new Date(ds[i - 1])) / 864e5);
  const typical = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
  app.innerHTML = `<div class="row" style="margin-bottom:12px"><a href="#/customers">‹ Customers</a></div>
  <div class="card"><h2>${esc(c.full_name)} ${c.is_commercial ? '<span class="chip">account customer</span>' : ''} <small>${esc(S.stores.find(s => s.id === c.store_id)?.name || '')} · ${c.tier}</small></h2>
    <div class="tiles">
      <div class="tile"><div class="l">Lifetime spend</div><div class="v">${money(c.lifetime_spend)}</div><div class="d mu">${num(c.order_count)} orders since ${fmtD(c.first_order)}</div></div>
      <div class="tile"><div class="l">Last 12 months</div><div class="v">${money(c.spend_12m)}</div><div class="d mu">${num(c.orders_12m)} orders</div></div>
      <div class="tile"><div class="l">Last order</div><div class="v">${fmtD(c.last_order)}</div><div class="d mu">${c.days_since ?? '–'} days before latest data</div></div>
      <div class="tile"><div class="l">Usual gap between orders</div><div class="v">${typical != null ? Math.round(typical) + ' days' : '–'}</div><div class="d mu">${typical && c.days_since > typical * 1.5 ? '<span class="dn">overdue</span>' : ''}</div></div>
    </div>
    <p>${esc(c.mobile || '')} ${c.email ? '· ' + esc(c.email) : ''} ${c.account_type ? '· POS charge type ' + esc(c.account_type) : ''}</p>
    ${isAdmin() ? `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="isCom" ${c.is_commercial ? 'checked' : ''}> Account (commercial) customer: leave out of retail customer counts and marketing</label>` : ''}
  </div>
  ${await serviceCard(id)}
  ${isAdmin() ? await customerMarketingCard(c) : ''}
  <div class="card"><h2>Orders <small>latest 200</small></h2><div class="scroll"><table><tr><th>Date</th><th>Time</th><th>Status</th><th>Picked up</th><th>Pieces</th><th>Total</th></tr>
    ${(orders || []).map(o => `<tr><td>${fmtD(o.order_date)}</td><td>${o.order_time ? o.order_time.slice(0, 5) : ''}</td><td>${esc(o.status || '')}</td><td>${fmtD(o.picked_up_date)}</td><td>${num(o.pieces)}</td><td>${money(o.sales, 2)}</td></tr>`).join('')}
  </table></div></div>`;
  if (isAdmin()) wireCustomerMarketing(c);
  const cb = $('#isCom'); if (cb) cb.onchange = async () => {
    const { error } = await sb.from('customers').update({ is_commercial: cb.checked, commercial_source: 'manual' }).eq('id', id);
    if (error) alert(error.message); S.cache = {};
  };
}

/* ---------- upload ---------- */
async function uploadView() {
  const { data: ups } = await sb.from('uploads').select('*').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(25);
  const { data: aliases } = await sb.from('store_aliases').select('*').eq('org_id', S.org.id);
  S.aliases = aliases || [];
  app.innerHTML = `
  <div class="card"><h2>Upload My Clean POS exports</h2>
    <p>Drop in any number of <b>Sales Incoming</b> or <b>Customer Orders</b> Excel files. Each file is checked, then loaded. Loading the same file twice is safe: it replaces what was there, it never adds twice.</p>
    <div class="drop" id="drop">Drop .xlsx files here, or <label style="display:inline;color:var(--blue);cursor:pointer"><input type="file" id="fi" accept=".xlsx,.xls" multiple hidden>choose files</label></div>
    <div class="log" id="log"></div>
    <p class="note">Sales Incoming: one day, one week (Monday to Sunday) or one calendar month per file. Customer Orders: any date range; it replaces every order for those stores in that range. Sales Incoming by service and order (the export with the Flat tab): any date range; each order is replaced by its receipt, so overlapping files never double up. It builds each customer's service profile.</p>
  </div>
  <div class="card"><h2>Recent uploads</h2><div class="scroll"><table><tr><th>When</th><th>File</th><th>Type</th><th>Covers</th><th>Rows</th><th>Status</th></tr>
    ${(ups || []).map(u => `<tr><td>${new Date(u.created_at).toLocaleString('en-AU')}</td><td>${esc(u.file_name)}</td><td>${u.kind}${u.grain ? ' · ' + u.grain : ''}</td><td>${u.date_from ? fmtD(u.date_from) + ' – ' + fmtD(u.date_to) : '–'}</td><td>${num(u.rows_in)}</td><td>${u.status}</td></tr>`).join('')}
  </table></div></div>`;
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); };
  $('#fi').onchange = e => handleFiles([...e.target.files]);
}

async function handleFiles(files) {
  for (const f of files) {
    const line = document.createElement('div'); line.textContent = `${f.name}: reading…`; $('#log').prepend(line);
    try { line.innerHTML = `<b>${esc(f.name)}</b>: ${await loadFile(f, m => line.innerHTML = `<b>${esc(f.name)}</b>: ${esc(m)}`)}`; }
    catch (e) { line.innerHTML = `<b>${esc(f.name)}</b>: <span class="err">${esc(e.message || e)}</span>`; console.error(e); }
  }
  S.cache = {};
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return iso(v);
  if (typeof v === 'number') return iso(new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4));
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(new Date(y, MON[m[2].toLowerCase()], +m[1])); }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return iso(new Date(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i); if (!m) return null;
  let h = +m[1]; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
function storeFor(posName) {
  const n = String(posName || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const a = S.aliases.find(x => x.alias.replace(/\s+/g, ' ').toLowerCase() === n);
  if (a) return a.store_id ? S.stores.find(s => s.id === a.store_id) : 'ignore';
  return S.stores.find(s => s.name.toLowerCase() === n || s.code === n) || null;
}
const toNum = v => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isFinite(x) ? x : 0; };

async function loadFile(file, say) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // blank cells come through as "" in some exports; treat them as empty
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
    .map(r => r.map(v => (typeof v === 'string' && v.trim() === '') ? null : v));
  const title = String(grid[0]?.[0] || '');
  const dm = String(grid[1]?.[0] || '').match(/Date:\s*(.+?)\s+to\s+(.+)$/i);
  if (!dm) throw new Error('Not a My Clean POS export (expected a "Date: … to …" line under the title).');
  const from = parseDate(dm[1]), to = parseDate(dm[2]);
  if (!from || !to) throw new Error(`Couldn't read the date range "${dm[0]}".`);
  const head = (grid[3] || []).map(h => String(h ?? '').trim().toLowerCase());
  if (wb.SheetNames.includes('Flat') && head.includes('service') && head.includes('order')) return loadServiceOrders(wb, file, from, to, say);
  const isOrders = head.includes('start date');
  const unknown = new Set();
  if (!isOrders) {
    const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
    const fromD = new Date(from + 'T00:00:00'), toD = new Date(to + 'T00:00:00');
    let grain, end = to;
    if (days === 1) grain = 'day';
    else if (days === 7) { grain = 'week'; const dow = toD.getDay(); end = addDays(to, (7 - dow) % 7); } // label by the Sunday
    else if (fromD.getDate() === 1 && addDays(to, 1).endsWith('-01') && days >= 28) grain = 'month';
    else throw new Error(`This file covers ${days} days (${fmtD(from)} to ${fmtD(to)}). Export one day, one week or one calendar month.`);
    const col = n => head.findIndex(h => n.includes(h));
    const c = { service: col(['service']), sales: col(['$ sales', 'sales']), disc: col(['$ discounts', 'discounts']), orders: col(['# order', '# orders', 'orders']), pieces: col(['# pieces', 'pieces']) };
    if (c.service < 0 || c.sales < 0) throw new Error('Couldn\'t find the Service and $ Sales columns.');
    const rows = []; let store = null;
    for (const r of grid.slice(4)) {
      if (r[0] && !r[c.service]) { store = storeFor(r[0]); if (!store) unknown.add(r[0]); continue; }
      if (!r[c.service] || !store || store === 'ignore') continue;
      rows.push({ store: store.name, grain, period_end: grain === 'month' ? to : end, service: String(r[c.service]).trim(), sales_gross: Math.round(toNum(r[c.sales]) * 100) / 100, discounts: c.disc >= 0 ? Math.round(toNum(r[c.disc]) * 100) / 100 : 0, orders: Math.round(toNum(r[c.orders])), pieces: Math.round(toNum(r[c.pieces])) });
    }
    if (unknown.size) throw new Error(`Unknown store name(s): ${[...unknown].join(', ')}. Add them in Admin › Stores, then upload again.`);
    if (!rows.length) throw new Error('No service rows found.');
    say(`Sales Incoming, ${grain} ${fmtD(from)} – ${fmtD(to)}, ${rows.length} rows. Loading…`);
    const res = await pushUpload('sales', file.name, grain, from, to, [...new Set(rows.map(r => r.store))], rows, 'ingest_sales', say);
    return `loaded ${res} sales rows (${grain}, ${fmtD(from)} – ${fmtD(to)}). <span class="up">Done.</span>`;
  }
  // Customer Orders
  const first = n => head.indexOf(n), after = (n, i) => head.indexOf(n, i + 1);
  const ix = { phone: first('phone'), email: first('email'), firstOrder: first('first order'), acctRef: first('account ref no.'), pieces: first('# pieces'), start: first('start date'), time: first('start time'), status: first('status'), picked: first('picked up date'), voided: first('voided date'), total: first('total price'), acctType: first('account charge type') };
  ix.name2 = first('name'); ix.phone2 = after('phone', ix.name2 - 1); ix.email2 = after('email', ix.name2 - 1);
  if (ix.start < 0 || ix.total < 0) throw new Error('Couldn\'t find the Start Date and Total Price columns.');
  const rows = []; let store = null, cust = null, voided = 0;
  for (const r of grid.slice(4)) {
    if (r[0] && r[ix.start] == null) { store = storeFor(r[0]); if (!store) unknown.add(r[0]); cust = null; continue; }
    if (!store || store === 'ignore') continue;
    if (r[1] && r[ix.start] == null) { cust = { name: String(r[1]).trim(), phone: r[ix.phone], email: r[ix.email], first: parseDate(r[ix.firstOrder]), ref: r[ix.acctRef], type: r[ix.acctType] }; continue; }
    if (r[ix.start] == null || r[ix.total] == null) continue;
    if (r[ix.voided] != null) { voided++; continue; }
    const sales = Math.round(toNum(r[ix.total]) * 100) / 100; if (sales <= 0) continue;
    const name = String(r[ix.name2] || cust?.name || '').trim(); if (!name) continue;
    const [last, firstN] = name.includes(',') ? name.split(',').map(x => x.trim()) : [name, ''];
    rows.push({ store: store.name, cust_key: `${store.name}::${name}`.replace(/ /g, '_').toLowerCase().slice(0, 100), full_name: name, first_name: firstN || null, last_name: last || null,
      mobile: String(r[ix.phone2] ?? cust?.phone ?? '').trim() || null, email: String(r[ix.email2] ?? cust?.email ?? '').trim() || null,
      account_ref: cust?.ref ? String(cust.ref) : null, account_type: cust?.type ? String(cust.type) : null, pos_first_order: cust?.first || null,
      order_date: parseDate(r[ix.start]), order_time: parseTime(r[ix.time]), status: r[ix.status] ? String(r[ix.status]) : null, picked_up_date: parseDate(r[ix.picked]), sales, pieces: Math.round(toNum(r[ix.pieces])) });
  }
  if (unknown.size) throw new Error(`Unknown store name(s): ${[...unknown].join(', ')}. Add them in Admin › Stores, then upload again.`);
  if (!rows.length) throw new Error('No orders found.');
  const stores = [...new Set(rows.map(r => r.store))];
  say(`Customer Orders ${fmtD(from)} – ${fmtD(to)}, ${num(rows.length)} orders across ${stores.length} stores (${voided} voided skipped). Loading…`);
  const n = await pushUpload('orders', file.name, null, from, to, stores, rows, 'ingest_orders', say);
  return `loaded ${num(n)} orders, ${fmtD(from)} – ${fmtD(to)}, ${stores.join(', ')}. <span class="up">Done.</span>`;
}

// Sales Incoming by service and order: tab 1 = store > service > order lines, tab "Flat" = each order with its customer.
// The two join on the POS receipt id inside each order's link. One row per receipt x service goes to order_lines.
function receiptOf(cell) {
  const f = String(cell?.f || cell?.l?.Target || '');
  const m = f.match(/receipt\/([0-9a-f-]{36})/i) || f.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}
async function loadServiceOrders(wb, file, from, to, say) {
  const ws = wb.Sheets[wb.SheetNames[0]], fl = wb.Sheets['Flat'];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (sh, r, c) => sh[XLSX.utils.encode_cell({ r, c })];
  const val = (sh, r, c) => { const v = cell(sh, r, c)?.v; return (typeof v === 'string' && v.trim() === '') ? null : v ?? null; };
  const hd = []; for (let c = 0; c <= range.e.c; c++) hd.push(String(val(ws, 3, c) ?? '').trim().toLowerCase());
  const ci = n => hd.indexOf(n);
  const c = { order: ci('order'), sales: ci('$ sales'), pieces: ci('# pieces'), service: ci('service'), orders: ci('# order'), disc: ci('$ discounts') };
  if (c.order < 0 || c.sales < 0 || c.service < 0) throw new Error('Couldn\'t find the Order, $ Sales and Service columns.');
  // customers from the Flat tab
  const fr = XLSX.utils.decode_range(fl['!ref']), fh = [];
  for (let k = 0; k <= fr.e.c; k++) fh.push(String(val(fl, 3, k) ?? '').trim().toLowerCase());
  const fi = n => fh.indexOf(n);
  const f = { order: fi('order number'), store: fi('store'), name: fi('account'), phone: fi('phone'), email: fi('email'), date: fi('order date'), time: fi('order time'), status: fi('status') };
  if (f.order < 0 || f.name < 0 || f.date < 0) throw new Error('The Flat tab is missing Order Number, Account or Order Date.');
  const who = {};
  for (let r = 4; r <= fr.e.r; r++) {
    const id = receiptOf(cell(fl, r, f.order)); if (!id || who[id]) continue;
    who[id] = { no: String(val(fl, r, f.order) ?? (String(cell(fl, r, f.order)?.f || '').match(/,\s*"([^"]+)"\)/) || [])[1] ?? ''), store: val(fl, r, f.store), name: String(val(fl, r, f.name) ?? '').trim(), mobile: String(val(fl, r, f.phone) ?? '').replace(/\s/g, '') || null,
      email: String(val(fl, r, f.email) ?? '').trim() || null, date: parseDate(val(fl, r, f.date)), time: parseTime(val(fl, r, f.time)), status: val(fl, r, f.status) };
  }
  const rows = [], totals = [], unknown = new Set(); let store = null, svc = null, missing = 0;
  for (let r = 4; r <= range.e.r; r++) {
    const a = val(ws, r, 0), b = val(ws, r, 1);
    if (a) { store = /^total$/i.test(String(a).trim()) ? 'ignore' : storeFor(a); if (!store) unknown.add(a); continue; }
    if (b) { svc = String(b).trim();
      if (store && store !== 'ignore') totals.push({ store: store.name, service: svc, sales_gross: Math.round(toNum(val(ws, r, c.sales)) * 100) / 100,
        discounts: c.disc >= 0 ? Math.round(toNum(val(ws, r, c.disc)) * 100) / 100 : 0, orders: c.orders >= 0 ? Math.round(toNum(val(ws, r, c.orders))) : 0, pieces: Math.round(toNum(val(ws, r, c.pieces))) });
      continue; }
    const id = receiptOf(cell(ws, r, c.order)); if (!id || !store || store === 'ignore' || !svc) continue;
    const w = who[id]; if (!w) { missing++; continue; }
    const name = w.name, [last, firstN] = name.includes(',') ? name.split(',').map(x => x.trim()) : [name, ''];
    rows.push({ store: store.name, receipt: id, order_no: w.no, service: svc, sales: Math.round(toNum(val(ws, r, c.sales)) * 100) / 100, pieces: Math.round(toNum(val(ws, r, c.pieces))),
      order_date: w.date, order_time: w.time, status: w.status ? String(w.status) : null,
      cust_key: name ? `${store.name}::${name}`.replace(/ /g, '_').toLowerCase().slice(0, 100) : null, full_name: name || null, first_name: firstN || null, last_name: last || null, mobile: w.mobile, email: w.email });
  }
  if (unknown.size) throw new Error(`Unknown store name(s): ${[...unknown].join(', ')}. Add them in Admin › Stores, then upload again.`);
  if (!rows.length) throw new Error('No order lines found. Is the order number column a link in this export?');
  if (missing > rows.length * 0.02) throw new Error(`${missing} order lines aren't on the Flat tab. Export both tabs from the same run and try again.`);
  const stores = [...new Set(rows.map(r => r.store))], orders = new Set(rows.map(r => r.receipt)).size;
  say(`Sales by service and order ${fmtD(from)} – ${fmtD(to)}, ${num(orders)} orders, ${num(rows.length)} service lines. Loading…`);
  // the same file stands in for plain Sales Incoming when it is a Monday-Sunday week or a calendar month
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, fromD = new Date(from + 'T00:00:00');
  const grain = days === 7 && fromD.getDay() === 1 ? 'week' : (fromD.getDate() === 1 && addDays(to, 1).endsWith('-01') && days >= 28 ? 'month' : null);
  let tot = null;
  const n = await pushUpload('services', file.name, grain, from, to, stores, rows, 'ingest_order_lines', say, async uid => {
    if (!grain) return;
    const { data, error } = await sb.rpc('ingest_service_totals', { p_upload: uid, p_rows: totals }); if (error) throw error; tot = data; });
  let msg = '';
  if (!grain) msg = ` <span class="dn">Sales totals not loaded: this file runs ${fmtD(from)} to ${fmtD(to)}. For sales, export Monday to Sunday or a whole calendar month.</span>`;
  else if (tot) {
    if (tot.stores_written?.length) msg += ` Sales totals loaded for ${tot.stores_written.length} store(s).`;
    const off = (tot.checked || []).filter(x => Math.abs(x.diff) > 1);
    if (tot.checked?.length) msg += off.length ? ` <span class="dn">Sales differ from the Sales Incoming already loaded: ${off.map(x => `${esc(x.store)} ${money(x.diff)}`).join(', ')}. Sales Incoming figures kept.</span>`
      : ` Sales match the Sales Incoming already loaded for ${tot.checked.length} store(s).`;
  }
  return `loaded ${num(n)} service lines on ${num(orders)} orders, ${fmtD(from)} – ${fmtD(to)}. Customer service profiles updated.${msg} <span class="up">Done.</span>`;
}

async function pushUpload(kind, fileName, grain, from, to, stores, rows, fn, say, beforeFinish) {
  const { data: uid, error } = await sb.rpc('upload_begin', { p_org: S.org.id, p_kind: kind, p_file: fileName, p_grain: grain, p_from: from, p_to: to, p_stores: stores });
  if (error) throw error;
  let n = 0;
  for (let i = 0; i < rows.length; i += 3000) {
    const { data, error: e } = await sb.rpc(fn, { p_upload: uid, p_rows: rows.slice(i, i + 3000) });
    if (e) throw e;
    n += data.inserted ?? data.upserted ?? 0; say(`loading… ${num(Math.min(i + 3000, rows.length))} of ${num(rows.length)}`);
  }
  if (beforeFinish) await beforeFinish(uid);
  const { error: e2 } = await sb.rpc('upload_finish', { p_upload: uid }); if (e2) throw e2;
  return n;
}

/* ---------- admin ---------- */
async function adminView() {
  const [mem, inv] = await Promise.all([
    sb.from('memberships').select('*').eq('org_id', S.org.id),
    sb.from('invites').select('*').eq('org_id', S.org.id).is('used_at', null)]);
  const storeName = id => S.stores.find(s => s.id === id)?.name || '';
  const svc = S.services.slice().sort((a, b) => a.channel.localeCompare(b.channel) || a.name.localeCompare(b.name));
  app.innerHTML = `
  <div class="card"><h2>People with access to ${esc(S.org.name)}</h2><div class="scroll"><table>
    <tr><th>Name</th><th>Role</th><th>Store</th><th></th></tr>
    ${(mem.data || []).map(m => `<tr><td>${esc(m.full_name || m.user_id)}</td><td>${roleName(m.role)}</td><td>${esc(storeName(m.store_id))}</td><td><button class="btn ghost" data-rm="${m.id}" style="padding:2px 8px">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="mu">Only platform owners so far.</td></tr>'}
    ${(inv.data || []).map(i => `<tr><td>${esc(i.full_name || '')} <span class="mu">${esc(i.email)}</span></td><td>${roleName(i.role)}</td><td>${esc(storeName(i.store_id))}</td><td class="mu">invited, not signed up</td></tr>`).join('')}
  </table></div>
  <h2 style="margin-top:16px">Invite someone</h2>
  <div class="row"><input id="iName" placeholder="Name"><input id="iEmail" type="email" placeholder="Email">
    <select id="iRole"><option value="store_manager">Store manager (one store)</option><option value="va">Uploads only (VA)</option><option value="org_admin">Admin (everything)</option></select>
    <select id="iStore">${S.stores.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <button class="btn" id="iGo">Invite</button></div>
  <p class="note">They then open this site, enter that email with a password and press "First time? Create login". Until email sending is set up, David activates each new login.</p><p id="iMsg"></p></div>

  <div class="card"><h2>Services <small>which POS services count as retail, commercial or restoration</small></h2><div class="scroll"><table>
    <tr><th>Service</th><th>Counts as</th><th>Marketing group</th></tr>
    ${svc.map(s => `<tr><td>${esc(s.name)}</td><td><select data-svc="${esc(s.name)}">${['retail', 'commercial', 'restoration', 'other'].map(c => `<option ${c === s.channel ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><select data-grp="${esc(s.name)}"><option value="">none</option>${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}" ${g === s.offer_group ? 'selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('')}
  </table></div><p class="note">"Other" is left out of every total (tickets, re-dos, zero lines). Marketing group decides which service a customer counts as using for targeted offers (DRAFT, set 28 Nov 2026); profiles rebuild at the next service upload. Changes apply straight away.</p></div>

  <div class="card"><h2>Stores</h2><div class="scroll"><table><tr><th>Store</th><th>Type</th><th>Active</th></tr>
    ${S.stores.map(s => `<tr><td>${esc(s.name)}</td><td>${s.channel}</td><td>${s.active ? 'Yes' : 'No'}</td></tr>`).join('')}</table></div>
    ${S.platform ? '<p class="note">New business for the consulting arm: ask Claude to add it (one org, its stores and its POS names).</p>' : ''}</div>`;
  $('#iRole').onchange = () => $('#iStore').hidden = $('#iRole').value !== 'store_manager';
  $('#iGo').onclick = async () => {
    const role = $('#iRole').value, email = $('#iEmail').value.trim();
    if (!email) return;
    const { error } = await sb.from('invites').insert({ org_id: S.org.id, email, role, full_name: $('#iName').value.trim() || null, store_id: role === 'store_manager' ? $('#iStore').value : null });
    $('#iMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Invited.'; if (!error) adminView();
  };
  app.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (confirm('Remove this person\'s access?')) { await sb.from('memberships').delete().eq('id', b.dataset.rm); adminView(); } });
  app.querySelectorAll('[data-grp]').forEach(el => el.onchange = async () => {
    const { error } = await sb.from('services').update({ offer_group: el.value || null }).eq('org_id', S.org.id).eq('name', el.dataset.grp);
    if (error) alert(error.message); else S.services.find(s => s.name === el.dataset.grp).offer_group = el.value || null;
  });
  app.querySelectorAll('[data-svc]').forEach(el => el.onchange = async () => {
    const { error } = await sb.from('services').update({ channel: el.value, confirmed: true }).eq('org_id', S.org.id).eq('name', el.dataset.svc);
    if (error) alert(error.message); else { S.services.find(s => s.name === el.dataset.svc).channel = el.value; S.cache = {}; }
  });
}
const roleName = r => ({ org_admin: 'Admin', store_manager: 'Store manager', va: 'Uploads only', platform: 'Owner' }[r] || r);

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') loginView(); });
boot();
