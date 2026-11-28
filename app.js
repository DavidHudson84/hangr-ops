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
  const hashErr = new URLSearchParams(location.hash.replace(/^#/, '')).get('error_description');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { if (hashErr) history.replaceState(null, '', location.pathname); return loginView(hashErr ? `That link didn't work (${hashErr}). Ask for a new one, or use Forgot password.` : ''); }
  S.user = session.user;
  const setting = new URLSearchParams(location.search).has('set');
  const { data: sec } = await sb.rpc('security_settings');
  const needMfa = sec?.require_mfa !== false;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  // someone with two-factor already set up proves it before anything else, even to change a password
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return mfaChallengeView();
  if (setting) return setPasswordView();
  if (needMfa && aal?.currentLevel !== 'aal2') return mfaEnrolView();
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
      <button class="btn ghost" type="button" id="fp">Forgot password?</button></div>
      <p class="note">New here? Ask David or your manager for an invite: it arrives by email.</p>
      <p class="note" id="lm">${esc(msg)}</p>
    </form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) $('#lm').innerHTML = `<span class="err">${esc(error.message === 'Invalid login credentials' ? 'Email or password not right.' : error.message === 'Email not confirmed' ? 'Open the invite email first to set up this login.' : error.message)}</span>`;
    else boot();
  };
  $('#fp').onclick = async () => {
    const email = $('#em').value.trim();
    if (!email) { $('#lm').textContent = 'Type your email above first, then press Forgot password.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?set=1' });
    $('#lm').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'If that email has a login, a link to set a new password is on its way. It works for an hour.';
  };
}

/* ---------- set a password (from an invite or reset link) ---------- */
function setPasswordView() {
  $('#hdr').hidden = true;
  app.innerHTML = `<div class="card login"><h2>Set your password</h2><p class="note">For ${esc(S.user.email)}. At least 10 characters; a short sentence works well.</p>
    <form id="spf"><label>New password</label><input id="np1" type="password" autocomplete="new-password" required minlength="10">
    <label>Same again</label><input id="np2" type="password" autocomplete="new-password" required minlength="10">
    <div class="row" style="margin-top:14px"><button class="btn">Save password</button></div><p class="note" id="spm"></p></form></div>`;
  $('#spf').onsubmit = async e => {
    e.preventDefault();
    if ($('#np1').value !== $('#np2').value) return $('#spm').innerHTML = '<span class="err">The two passwords don\'t match.</span>';
    const { error } = await sb.auth.updateUser({ password: $('#np1').value });
    if (error) return $('#spm').innerHTML = `<span class="err">${esc(error.message)}</span>`;
    history.replaceState(null, '', location.pathname); boot();
  };
}

/* ---------- two-factor: an authenticator app code at every sign-in ---------- */
async function mfaEnrolView() {
  $('#hdr').hidden = true;
  app.innerHTML = '<div class="card login"><p>Setting up two-factor…</p></div>';
  const { data: f } = await sb.auth.mfa.listFactors();
  for (const x of (f?.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Hangr Ops ' + new Date().toISOString().slice(0, 16) });
  if (error) { app.innerHTML = `<div class="card login"><p class="err">${esc(error.message)}</p><button class="btn ghost" onclick="signOut()">Sign out</button></div>`; return; }
  app.innerHTML = `<div class="card login" style="max-width:460px"><h2>Turn on two-factor</h2>
    <p>Hangr Ops holds customer details, so every sign-in needs a 6-digit code from your phone as well as your password. One-time setup:</p>
    <ol style="padding-left:18px;line-height:1.6"><li>Install <b>Microsoft Authenticator</b> or <b>Google Authenticator</b> on your phone (free, from the app store).</li>
    <li>In the app, add an account and scan this code:</li></ol>
    <div style="text-align:center"><img src="${data.totp.qr_code}" alt="QR code" style="width:200px;height:200px"></div>
    <p class="note">Can't scan? Choose "enter a setup key" in the app and type: <b style="word-break:break-all">${esc(data.totp.secret)}</b></p>
    <ol start="3" style="padding-left:18px"><li>Type the 6-digit code the app shows:</li></ol>
    <form id="mf"><input id="mc" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required style="font-size:20px;letter-spacing:4px;width:140px">
    <button class="btn" style="margin-left:8px">Turn on</button></form><p class="note" id="mm"></p>
    <p class="note">Signed in as ${esc(S.user.email)} · <a href="#" onclick="signOut();return false">sign out</a></p></div>`;
  $('#mc').focus();
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const { error: ve } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: $('#mc').value.trim() });
    if (ve) return $('#mm').innerHTML = `<span class="err">${esc(ve.message.includes('Invalid') ? 'That code didn\'t match. Codes change every 30 seconds: try the current one.' : ve.message)}</span>`;
    boot();
  };
}
async function mfaChallengeView() {
  $('#hdr').hidden = true;
  const { data: f } = await sb.auth.mfa.listFactors();
  const factor = (f?.totp || []).find(x => x.status === 'verified');
  if (!factor) return mfaEnrolView();
  app.innerHTML = `<div class="card login"><h2>Enter your code</h2><p class="note">The 6-digit code from your authenticator app for Hangr Ops.</p>
    <form id="mf"><input id="mc" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required style="font-size:20px;letter-spacing:4px;width:140px">
    <button class="btn" style="margin-left:8px">Continue</button></form><p class="note" id="mm"></p>
    <p class="note">Lost your phone? Ask David to reset your two-factor. · <a href="#" onclick="signOut();return false">Sign out</a></p></div>`;
  $('#mc').focus();
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: $('#mc').value.trim() });
    if (error) return $('#mm').innerHTML = `<span class="err">${esc(error.message.includes('Invalid') ? 'That code didn\'t match. Codes change every 30 seconds: try the current one.' : error.message)}</span>`;
    boot();
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
    isAdmin() ? sb.from('v_labour_week').select('week_end,cost').eq('store_id', store.id).neq('section', 'alterations').gte('week_end', addDays(wk, -77)).lte('week_end', wk) : Promise.resolve({ data: [] })]);
  const labW = new Map(); for (const r of lab.data || []) labW.set(r.week_end, (labW.get(r.week_end) || 0) + +(r.cost || 0));
  const wageCur = labW.has(wk) && c.retail ? labW.get(wk) / (c.retail / 1.1) : null; // wage % on ex-GST sales
  const wPrior = ser.filter(w => w.week_end <= wk && labW.has(w.week_end) && w.retail).slice(-12);
  const wage12 = wPrior.length ? wPrior.reduce((a, w) => a + labW.get(w.week_end), 0) / (wPrior.reduce((a, w) => a + w.retail, 0) / 1.1) : null;
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
async function customerHistoryCard(id) {
  const { data: h } = await sb.rpc('customer_marketing_history', { p_customer: id });
  if (!h || (!h.texts.length && !h.discounts.length)) return '';
  return `<div class="card"><h2>Marketing history <small>texts received and what followed</small></h2><div class="scroll"><table>
    <tr><th>Sent</th><th>Message</th><th>Result</th><th>Orders</th><th>Sales</th><th>Discount used</th></tr>
    ${h.texts.map(t => `<tr><td>${new Date(t.at).toLocaleDateString('en-AU')}</td><td>${esc(t.template || t.category)}${t.held_back ? ' <span class="chip">held back</span>' : ''}</td>
      <td>${t.orders ? `<span class="up">ordered ${fmtD(t.first_order)}</span>` : `<span class="mu">no order by ${fmtD(t.window_to === 'infinity' ? null : t.window_to)}</span>`}</td>
      <td>${num(t.orders)}</td><td>${money(t.sales, 2)}</td><td>${t.redeemed ? `${esc(t.discounts)} (${money(t.discount, 2)})` : '<span class="mu">–</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">No texts yet</td></tr>'}
  </table></div>
  ${h.discounts.length ? `<h3 style="margin-top:12px">Discounts on their orders</h3><div class="scroll"><table><tr><th>Order date</th><th>Discount</th><th>Off</th><th>Order total</th><th>Store</th><th>Served by</th></tr>
    ${h.discounts.map(x => `<tr><td>${fmtD(x.date)}</td><td>${esc(x.name)}</td><td>${money(x.discount, 2)}</td><td>${money(x.sales, 2)}</td><td>${esc(x.store)}</td><td class="mu">${esc(x.employee || '')}</td></tr>`).join('')}</table></div>` : ''}
  <p class="note">A text is credited with the customer's orders until its window closes (14 days for offers, 21 for win-backs, 28 for welcomes, 7 for collection reminders) or their next text arrives, whichever is first.</p></div>`;
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
  ${isAdmin() ? await customerHistoryCard(id) : ''}
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
    <p class="note">Each week, Monday to Sunday: <b>Sales Incoming by Store, Service and Order</b> (Include discounts ticked) first, then <b>Customer Orders</b>, then <b>Coupons and Discounts</b> (Paid and Active ticked, grouped Store, Discount, Order). Backfill: one whole calendar month per file. A file is only loaded if it's complete and adds up; anything that looks wrong is stopped with the reason. Every loaded period is then locked, so old reports never change; only David can unlock one.</p>
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
    await runFile(f, line, false);
  }
  S.cache = {};
}
async function runFile(f, line, override) {
  const say = m => line.innerHTML = `<b>${esc(f.name)}</b>: ${esc(m)}`;
  try { line.innerHTML = `<b>${esc(f.name)}</b>: ${await loadFile(f, say, override)}`; }
  catch (e) {
    if (e instanceof UploadStop) {
      line.innerHTML = `<b>${esc(f.name)}</b>: ${stopHtml(e, S.platform)}`;
      const b = line.querySelector('[data-override]'); if (b) b.onclick = () => runFile(f, line, true);
    } else {
      const m = String(e.message || e);
      line.innerHTML = `<b>${esc(f.name)}</b>: <span class="err">${esc(m.replace(/^LOCKED:\s*/, ''))}</span>${/^LOCKED/.test(m) ? ' <span class="note">Send David a screenshot.</span>' : ''}`; console.error(e);
    }
  }
}

/* ---------- upload checks: nothing loads unless the file is clean ---------- */
// hard = wrong for everyone; soft = looks wrong, only David can load it anyway; warn = loads, but worth knowing
class UploadStop extends Error { constructor(hard, soft, warn) { super('stopped'); this.hard = hard; this.soft = soft; this.warn = warn; } }
const pctOff = (a, b) => Math.round((a / b - 1) * 100);
function periodOf(from, to) {
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, f = new Date(from + 'T00:00:00');
  if (days === 7 && f.getDay() === 1) return 'week';
  if (f.getDate() === 1 && addDays(to, 1).endsWith('-01') && days >= 28) return 'month';
  if (days === 1) return 'day';
  return null;
}
const periodName = (grain, to) => grain === 'week' ? `the week ending ${fmtD(to)}` : grain === 'month' ? new Date(to + 'T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : fmtD(to);
function periodChecks(hard, from, to, grain, allowDay) {
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  if (!grain || (grain === 'day' && !allowDay))
    hard.push(`This file runs ${fmtD(from)} to ${fmtD(to)} (${days} day${days === 1 ? '' : 's'}). A weekly file must run <b>Monday to Sunday</b>, and a backfill file must be <b>one whole calendar month</b>. Change the dates and export again.`);
  if (to >= iso(new Date())) hard.push(`This file runs to ${fmtD(to)}, which isn't over yet, so its figures would be incomplete. Export it once the ${grain === 'month' ? 'month' : 'week'} has finished (on Monday for a week).`);
}
// f.stores: Map(store name -> { sales, discounts, orders }) for sales-type files; f.orders: same shape for Customer Orders
async function uploadGate(kind, grain, from, to, f, override) {
  const hard = [...(f.hard || [])], soft = [...(f.soft || [])], warn = [...(f.warn || [])];
  if (!hard.length) {
    const { data: ck, error } = await sb.rpc('upload_check', { p_org: S.org.id, p_kind: kind, p_grain: grain, p_from: from, p_to: to });
    if (error) throw error;
    const inFile = new Set(f.stores.keys()), when = periodName(grain, to);
    const missing = (ck.expected || []).filter(n => !inFile.has(n));
    if (missing.length) soft.push(`<b>${missing.map(esc).join(', ')}</b> ${missing.length === 1 ? "isn't" : "aren't"} in this file, but traded in the weeks before. Check every store is selected on the filter screen and export again. If a store has closed, tell David.`);
    const ex = new Map((ck.existing || []).map(e => [e.store, e]));
    if (kind === 'discounts') {
      if (ck.locked && ex.size) {
        const same = [...ex].every(([n, e]) => f.stores.has(n) && f.stores.get(n).lines === e.lines && Math.abs(f.stores.get(n).discount - e.discount) <= 0.5);
        if (same) return { already: true };
        hard.push(`Discounts for ${when} are already loaded and <b>locked</b>, and this file is different (${[...ex].map(([n, e]) => `${esc(n)}: ${num(e.lines)} discounted orders locked, ${num(f.stores.get(n)?.lines || 0)} in this file`).join('; ')}). Don't upload it. Send David a screenshot: only he can unlock it.`);
      }
    } else if (kind !== 'orders') {
      if (ck.locked) {
        const off = [...f.stores].filter(([n, v]) => ex.has(n) && (Math.abs(v.sales - ex.get(n).sales) > 0.5 || (ex.get(n).discounts && Math.abs(v.discounts - ex.get(n).discounts) > 0.5)));
        const gone = [...ex.keys()].filter(n => !inFile.has(n));
        if (off.length || gone.length) hard.push(`Sales for ${when} are already loaded and <b>locked</b>, and this file is different: ${[...off.map(([n, v]) => `${esc(n)} locked at ${money(ex.get(n).sales)} sales / ${money(ex.get(n).discounts)} discounts, this file ${money(v.sales)} / ${money(v.discounts)}`), ...gone.map(n => `${esc(n)} is locked but missing from this file`)].join('; ')}. The POS has changed since that period was loaded (an order edited, voided or discounted after it closed). Don't upload it. Send David a screenshot: only he can unlock a period.`);
      } else if (ex.size) {
        const off = [...f.stores].filter(([n, v]) => ex.has(n) && Math.abs(v.sales - ex.get(n).sales) > 0.5);
        if (off.length) warn.push(`David unlocked ${when}. This file replaces: ${off.map(([n, v]) => `${esc(n)} ${money(ex.get(n).sales)} → ${money(v.sales)}`).join(', ')}.`);
      }
      const hist = new Map((ck.history || []).map(h => [h.store, h])), lim = grain === 'month' ? 40 : 50, need = grain === 'month' ? 2 : 3;
      const swing = [...f.stores].filter(([n, v]) => { const h = hist.get(n); return h && h.periods >= need && h.avg >= 500 && Math.abs(pctOff(v.sales, h.avg)) > lim; });
      if (swing.length) soft.push(`${swing.map(([n, v]) => { const h = hist.get(n), p = pctOff(v.sales, h.avg); return `<b>${esc(n)}</b> is ${Math.abs(p)}% ${p > 0 ? 'up on' : 'down on'} its average for the ${grain === 'month' ? 'previous months' : 'last 4 weeks'} (${money(v.sales)} against ${money(h.avg)})`; }).join('; ')}. Check the dates and the store selection. If the file is right, send David a screenshot so he can approve it.`);
      if (f.discCol && f.stores.size && [...f.stores.values()].every(v => !v.discounts)) soft.push('Every store shows $0 discounts. Check <b>Include discounts</b> is ticked on the filter screen and export again.');
    } else {
      if (ck.locked && ex.size) {
        const same = [...ex].every(([n, e]) => f.stores.has(n) && f.stores.get(n).orders === e.orders && Math.abs(f.stores.get(n).sales - e.sales) <= 1);
        if (same) return { already: true };
        hard.push(`Customer Orders for ${fmtD(from)} to ${fmtD(to)} are already loaded and <b>locked</b>, and this file is different (${[...ex].filter(([n, e]) => !f.stores.has(n) || f.stores.get(n).orders !== e.orders).map(([n, e]) => `${esc(n)}: ${num(e.orders)} orders locked, ${num(f.stores.get(n)?.orders || 0)} in this file`).join('; ') || 'order totals differ'}). Orders have been changed in the POS since. Don't upload it. Send David a screenshot: only he can unlock it.`);
      }
      const ps = new Map((ck.period_sales || []).map(p => [p.store, p.sales]));
      if (!ps.size && grain) soft.push(`The Sales Incoming by service and order for ${when} isn't loaded yet. Upload that file first, then this one, so the two can be checked against each other.`);
      else {
        const off = [...f.stores].filter(([n, v]) => ps.has(n) && ps.get(n) > 500 && Math.abs(pctOff(v.sales, ps.get(n))) > 15);
        if (off.length) soft.push(`Customer Orders don't line up with the sales already loaded for ${when}: ${off.map(([n, v]) => `${esc(n)} orders ${money(v.sales)}, sales ${money(ps.get(n))} (${Math.abs(pctOff(v.sales, ps.get(n)))}% apart)`).join('; ')}. They're normally within a few per cent. Check the dates and stores match the sales file and export again.`);
      }
    }
  }
  if (hard.length || (soft.length && !override)) throw new UploadStop(hard, soft, warn);
  return { warn };
}
function stopHtml(e, canOverride) {
  const li = (a, cls) => a.map(x => `<li class="${cls}">${x}</li>`).join('');
  return `<span class="dn"><b>Not loaded.</b></span><ul style="margin:4px 0 4px 18px">${li(e.hard, 'dn')}${li(e.soft, 'dn')}${li(e.warn, 'mu')}</ul>`
    + (e.hard.length ? '<span class="note">Nothing was loaded. Fix the file and upload it again.</span>'
      : canOverride ? '<button class="btn" data-override>I\'ve checked it: load anyway</button>'
      : '<span class="note">Nothing was loaded. Send David a screenshot of this message.</span>');
}
const warnHtml = w => w?.length ? ` <span class="mu">${w.join(' ')}</span>` : '';


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

async function loadFile(file, say, override = false) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // blank cells come through as "" in some exports; treat them as empty
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
    .map(r => r.map(v => (typeof v === 'string' && v.trim() === '') ? null : v));
  const title = String(grid[0]?.[0] || '');
  const dm = String(grid[1]?.[0] || '').match(/Date:\s*(.+?)\s+to\s+(.+)$/i);
  if (!dm) throw new UploadStop(["This isn't a My Clean POS export we can read. Export <b>Sales Incoming</b> grouped by Store, Service and Order (it has a second tab called Flat), or <b>Customer Orders</b>, as .xlsx, and upload it without opening or editing it."], [], []);
  const from = parseDate(dm[1]), to = parseDate(dm[2]);
  if (!from || !to) throw new Error(`Couldn't read the date range "${dm[0]}".`);
  const head = (grid[3] || []).map(h => String(h ?? '').trim().toLowerCase());
  if (/coupons and discounts/i.test(title)) return loadDiscounts(wb, file, from, to, say, override);
  const isCustOrders = head.includes('first order') || head.includes('last order');
  if (!isCustOrders && wb.SheetNames.includes('Flat') && head.includes('service') && head.includes('order')) return loadServiceOrders(wb, file, from, to, say, override);
  if (!isCustOrders && wb.SheetNames.includes('Flat') && !head.includes('service')) throw new UploadStop(["This Sales Incoming wasn't grouped by <b>Store, Service and Order</b>. Tick all three groupings on the filter screen and export again."], [], []);
  const isOrders = isCustOrders || head.includes('start date');
  const unknown = new Set();
  if (!isOrders) {
    const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
    const fromD = new Date(from + 'T00:00:00'), toD = new Date(to + 'T00:00:00');
    let grain, end = to;
    if (days === 1) grain = 'day';
    else if (days === 7) { grain = 'week'; const dow = toD.getDay(); end = addDays(to, (7 - dow) % 7); } // label by the Sunday
    else if (fromD.getDate() === 1 && addDays(to, 1).endsWith('-01') && days >= 28) grain = 'month';
    else grain = null;
    const ph = []; periodChecks(ph, from, to, grain, true); if (ph.length) throw new UploadStop(ph, [], []);
    const col = n => head.findIndex(h => n.includes(h));
    const c = { service: col(['service']), sales: col(['$ sales', 'sales']), disc: col(['$ discounts', 'discounts']), orders: col(['# order', '# orders', 'orders']), pieces: col(['# pieces', 'pieces']) };
    if (c.service < 0 || c.sales < 0) throw new Error('Couldn\'t find the Service and $ Sales columns.');
    const rows = []; let store = null;
    for (const r of grid.slice(4)) {
      if (r[0] && !r[c.service]) { store = storeFor(r[0]); if (!store) unknown.add(r[0]); continue; }
      if (!r[c.service] || !store || store === 'ignore') continue;
      rows.push({ store: store.name, grain, period_end: grain === 'month' ? to : end, service: String(r[c.service]).trim(), sales_gross: Math.round(toNum(r[c.sales]) * 100) / 100, discounts: c.disc >= 0 ? Math.round(toNum(r[c.disc]) * 100) / 100 : 0, orders: Math.round(toNum(r[c.orders])), pieces: Math.round(toNum(r[c.pieces])) });
    }
    if (unknown.size) throw new UploadStop([`This file has a store Hangr Ops doesn't know: <b>${[...unknown].map(esc).join(', ')}</b>. Send David a screenshot so he can add it.`], [], []);
    if (!rows.length) throw new UploadStop(['This file has no sales lines in it. Check the dates and stores on the filter screen and export again.'], [], []);
    const st = new Map(); for (const r of rows) { const v = st.get(r.store) || { sales: 0, discounts: 0, orders: 0 }; v.sales += r.sales_gross; v.discounts += r.discounts; st.set(r.store, v); }
    const g = await uploadGate('sales', grain, from, to, { stores: st, discCol: c.disc >= 0, soft: ["This is the plain <b>Sales Incoming</b>, which we no longer use. Export Sales Incoming grouped by <b>Store, Service and Order</b>, with Include discounts ticked, instead."] }, override);
    say(`Sales Incoming, ${grain} ${fmtD(from)} – ${fmtD(to)}, ${rows.length} rows. Loading…`);
    const res = await pushUpload('sales', file.name, grain, from, to, [...new Set(rows.map(r => r.store))], rows, 'ingest_sales', say);
    return `loaded ${res} sales rows (${grain}, ${fmtD(from)} – ${fmtD(to)}).${warnHtml(g.warn)} Locked. <span class="up">Done.</span>`;
  }
  // Customer Orders
  const first = n => head.indexOf(n), after = (n, i) => head.indexOf(n, i + 1);
  const ix = { phone: first('phone'), email: first('email'), firstOrder: first('first order'), acctRef: first('account ref no.'), pieces: first('# pieces'), start: first('start date'), time: first('start time'), status: first('status'), picked: first('picked up date'), voided: first('voided date'), total: first('total price'), acctType: first('account charge type') };
  ix.name2 = first('name'); ix.phone2 = after('phone', ix.name2 - 1); ix.email2 = after('email', ix.name2 - 1);
  if (ix.start < 0 || ix.total < 0) throw new UploadStop(["This Customer Orders file is missing the Start Date or Total Price column. Export Customer Orders again with the standard columns and upload it without editing."], [], []);
  const ograin = periodOf(from, to), oph = []; periodChecks(oph, from, to, ograin === 'day' ? null : ograin, false); if (oph.length) throw new UploadStop(oph, [], []);
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
  if (unknown.size) throw new UploadStop([`This file has a store Hangr Ops doesn't know: <b>${[...unknown].map(esc).join(', ')}</b>. Send David a screenshot so he can add it.`], [], []);
  if (!rows.length) throw new UploadStop(['This file has no orders in it. Check the dates and stores on the filter screen and export again.'], [], []);
  const stores = [...new Set(rows.map(r => r.store))];
  const ost = new Map(); for (const r of rows) { const v = ost.get(r.store) || { sales: 0, orders: 0 }; v.sales += r.sales; v.orders++; ost.set(r.store, v); }
  const og = await uploadGate('orders', ograin, from, to, { stores: ost }, override);
  if (og.already) return `already loaded and locked for ${fmtD(from)} – ${fmtD(to)}, and this file matches it. Nothing to do. <span class="up">Done.</span>`;
  say(`Customer Orders ${fmtD(from)} – ${fmtD(to)}, ${num(rows.length)} orders across ${stores.length} stores (${voided} voided skipped). Loading…`);
  const n = await pushUpload('orders', file.name, null, from, to, stores, rows, 'ingest_orders', say);
  return `loaded ${num(n)} orders, ${fmtD(from)} – ${fmtD(to)}, ${stores.join(', ')}.${warnHtml(og.warn)} Locked. <span class="up">Done.</span>`;
}

// Sales Incoming by service and order: tab 1 = store > service > order lines, tab "Flat" = each order with its customer.
// The two join on the POS receipt id inside each order's link. One row per receipt x service goes to order_lines.
function receiptOf(cell) {
  const f = String(cell?.f || cell?.l?.Target || '');
  const m = f.match(/receipt\/([0-9a-f-]{36})/i) || f.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}
async function loadServiceOrders(wb, file, from, to, say, override) {
  const ws = wb.Sheets[wb.SheetNames[0]], fl = wb.Sheets['Flat'];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (sh, r, c) => sh[XLSX.utils.encode_cell({ r, c })];
  const val = (sh, r, c) => { const v = cell(sh, r, c)?.v; return (typeof v === 'string' && v.trim() === '') ? null : v ?? null; };
  const hd = []; for (let c = 0; c <= range.e.c; c++) hd.push(String(val(ws, 3, c) ?? '').trim().toLowerCase());
  const ci = n => hd.indexOf(n);
  const c = { order: ci('order'), sales: ci('$ sales'), pieces: ci('# pieces'), service: ci('service'), orders: ci('# order'), disc: ci('$ discounts'), emp: ci('employee') };
  if (c.order < 0 || c.sales < 0 || c.service < 0 || c.pieces < 0 || c.orders < 0) throw new UploadStop(["This file is missing some of the standard columns (Order, $ Sales, # Order, # Pieces, Service). Export it again straight from the POS and upload it without opening or editing it."], [], []);
  const hard = [], soft = [], warn = [];
  const grain = periodOf(from, to); periodChecks(hard, from, to, grain === 'day' ? null : grain, false);
  if (c.disc < 0) hard.push("The <b>$ Discounts</b> column is missing, so <b>Include discounts</b> wasn't ticked. Tick it on the filter screen and export again.");
  const flatDate = String(fl?.A2?.v ?? '').trim(), mainDate = String(ws.A2?.v ?? '').trim();
  if (flatDate !== mainDate) hard.push(`The two tabs come from different runs (the first tab says "${esc(mainDate)}", the Flat tab says "${esc(flatDate)}"). Export once and upload that file as it is.`);
  // customers from the Flat tab
  const fr = XLSX.utils.decode_range(fl['!ref']), fh = [];
  for (let k = 0; k <= fr.e.c; k++) fh.push(String(val(fl, 3, k) ?? '').trim().toLowerCase());
  const fi = n => fh.indexOf(n);
  const f = { pickup: fi('pickup employee'), order: fi('order number'), store: fi('store'), name: fi('account'), phone: fi('phone'), email: fi('email'), date: fi('order date'), time: fi('order time'), status: fi('status') };
  if (f.order < 0 || f.name < 0 || f.date < 0) throw new Error('The Flat tab is missing Order Number, Account or Order Date.');
  const who = {};
  for (let r = 4; r <= fr.e.r; r++) {
    const id = receiptOf(cell(fl, r, f.order)); if (!id || who[id]) continue;
    who[id] = { pickup: f.pickup >= 0 && val(fl, r, f.pickup) ? String(val(fl, r, f.pickup)).trim() : null, no: String(val(fl, r, f.order) ?? (String(cell(fl, r, f.order)?.f || '').match(/,\s*"([^"]+)"\)/) || [])[1] ?? ''), store: val(fl, r, f.store), name: String(val(fl, r, f.name) ?? '').trim(), mobile: String(val(fl, r, f.phone) ?? '').replace(/\s/g, '') || null,
      email: String(val(fl, r, f.email) ?? '').trim() || null, date: parseDate(val(fl, r, f.date)), time: parseTime(val(fl, r, f.time)), status: val(fl, r, f.status) };
  }
  const rows = [], totals = [], unknown = new Set(); let store = null, svc = null, missing = 0;
  // every line must add up: order lines to their service row, services to their store row, stores to the Total row
  const blocks = [], q = (sh, r, k) => k >= 0 ? toNum(val(sh, r, k)) : 0; let sb_ = null, vb = null, grand = null;
  for (let r = 4; r <= range.e.r; r++) {
    const a = val(ws, r, 0), b = val(ws, r, 1);
    if (a) { const isTot = /^total$/i.test(String(a).trim()); store = isTot ? 'ignore' : storeFor(a); if (!store) unknown.add(a);
      const row = { name: String(a).trim(), sales: q(ws, r, c.sales), disc: q(ws, r, c.disc), orders: q(ws, r, c.orders), svcs: [] };
      if (isTot) grand = row; else { sb_ = row; blocks.push(row); } vb = null; continue; }
    if (b) { vb = { name: String(b).trim(), sales: q(ws, r, c.sales), disc: q(ws, r, c.disc), orders: q(ws, r, c.orders), pieces: q(ws, r, c.pieces), lines: [] }; sb_?.svcs.push(vb); }
    else if (vb) { const id = receiptOf(cell(ws, r, c.order)); if (id) vb.lines.push({ id, sales: q(ws, r, c.sales), disc: q(ws, r, c.disc), pieces: q(ws, r, c.pieces) }); }
    if (b) { svc = String(b).trim();
      if (store && store !== 'ignore') totals.push({ store: store.name, service: svc, sales_gross: Math.round(toNum(val(ws, r, c.sales)) * 100) / 100,
        discounts: c.disc >= 0 ? Math.round(toNum(val(ws, r, c.disc)) * 100) / 100 : 0, orders: c.orders >= 0 ? Math.round(toNum(val(ws, r, c.orders))) : 0, pieces: Math.round(toNum(val(ws, r, c.pieces))) });
      continue; }
    const id = receiptOf(cell(ws, r, c.order)); if (!id || !store || store === 'ignore' || !svc) continue;
    const w = who[id]; if (!w) { missing++; continue; }
    const name = w.name, [last, firstN] = name.includes(',') ? name.split(',').map(x => x.trim()) : [name, ''];
    rows.push({ discount: c.disc >= 0 ? Math.round(toNum(val(ws, r, c.disc)) * 100) / 100 : null, employee: c.emp >= 0 && val(ws, r, c.emp) ? String(val(ws, r, c.emp)).trim() : null, pickup_employee: w.pickup, store: store.name, receipt: id, order_no: w.no, service: svc, sales: Math.round(toNum(val(ws, r, c.sales)) * 100) / 100, pieces: Math.round(toNum(val(ws, r, c.pieces))),
      order_date: w.date, order_time: w.time, status: w.status ? String(w.status) : null,
      cust_key: name ? `${store.name}::${name}`.replace(/ /g, '_').toLowerCase().slice(0, 100) : null, full_name: name || null, first_name: firstN || null, last_name: last || null, mobile: w.mobile, email: w.email });
  }
  if (unknown.size) hard.push(`This file has a store Hangr Ops doesn't know: <b>${[...unknown].map(esc).join(', ')}</b>. Send David a screenshot so he can add it.`);
  if (!rows.length) hard.push("This file has no orders in it, or the order numbers aren't links. Export it again straight from the POS, as .xlsx, and don't open and re-save it first.");
  if (missing) hard.push(`${num(missing)} order lines on the first tab aren't on the Flat tab, so the file is incomplete. Export again and upload it without editing.`);
  const bad = [], cents = x => Math.round(x * 100);
  for (const s of blocks) {
    for (const v of s.svcs) {
      const ls = v.lines.reduce((t, l) => t + l.sales, 0), ld = v.lines.reduce((t, l) => t + l.disc, 0), lp = v.lines.reduce((t, l) => t + l.pieces, 0), lo = new Set(v.lines.map(l => l.id)).size;
      if (Math.abs(cents(ls) - cents(v.sales)) > 2 || Math.abs(cents(ld) - cents(v.disc)) > 2 || lo !== Math.round(v.orders) || Math.round(lp) !== Math.round(v.pieces))
        bad.push(`${esc(s.name)} › ${esc(v.name)}: the total line says ${money(v.sales)} on ${num(v.orders)} orders, but its orders add up to ${money(ls)} on ${num(lo)}`);
    }
    const ss = s.svcs.reduce((t, v) => t + v.sales, 0);
    if (Math.abs(ss - s.sales) > 0.1) bad.push(`${esc(s.name)}: the store line says ${money(s.sales)}, but its services add up to ${money(ss)}`);
  }
  if (!grand) hard.push('There is no Total line at the bottom of the first tab, so the file may have been cut short. Export it again.');
  else { const gs = blocks.reduce((t, s) => t + s.sales, 0); if (Math.abs(gs - grand.sales) > 0.5) bad.push(`the Total line says ${money(grand.sales)}, but the stores add up to ${money(gs)}`); }
  if (bad.length && rows.length && !missing) hard.push(`The file doesn't add up, so it may have been edited or cut short: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? ` and ${bad.length - 5} more` : ''}. Export it again and upload it without opening or editing it.`);
  const unk = rows.filter(r => /^unknown service$/i.test(r.service));
  if (unk.length) warn.push(`${num(unk.length)} lines (${money(unk.reduce((t, r) => t + r.sales, 0))}) at ${[...new Set(unk.map(r => r.store))].map(esc).join(', ')} have no service (Unknown Service). They load, but don't count towards customer profiles.`);
  const sst = new Map(); for (const t of totals) { const v = sst.get(t.store) || { sales: 0, discounts: 0, orders: 0 }; v.sales += t.sales_gross; v.discounts += t.discounts; sst.set(t.store, v); }
  const g = await uploadGate('services', grain, from, to, { stores: sst, discCol: c.disc >= 0, hard, soft, warn }, override);
  const stores = [...new Set(rows.map(r => r.store))], orders = new Set(rows.map(r => r.receipt)).size;
  say(`Sales by service and order ${fmtD(from)} – ${fmtD(to)}, ${num(orders)} orders, ${num(rows.length)} service lines. Loading…`);
  let tot = null;
  const n = await pushUpload('services', file.name, grain, from, to, stores, rows, 'ingest_order_lines', say, async uid => {
    if (!grain) return;
    const { data, error } = await sb.rpc('ingest_service_totals', { p_upload: uid, p_rows: totals }); if (error) throw error; tot = data; });
  let msg = '';
  if (tot) {
    if (tot.stores_written?.length) msg += ` Sales totals loaded for ${tot.stores_written.length} store(s).`;
    if (tot.checked?.length) msg += ` Sales match the figures already locked for ${tot.checked.length} store(s).`;
  }
  return `loaded ${num(n)} service lines on ${num(orders)} orders, ${fmtD(from)} – ${fmtD(to)}. Customer service profiles updated.${msg}${warnHtml(g.warn)} Locked. <span class="up">Done.</span>`;
}

// Coupons and Discounts (Paid, grouped Store > Discount > Order). The POS's own subtotals for percentage discounts
// are wrong (multiplied by the number of orders), so totals come from the order lines; pieces are what must agree.
async function loadDiscounts(wb, file, from, to, say, override) {
  const ws = wb.Sheets[wb.SheetNames[0]], range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const val = (r, c) => { const v = cell(r, c)?.v; return (typeof v === 'string' && v.trim() === '') ? null : v ?? null; };
  const hd = []; for (let c = 0; c <= range.e.c; c++) hd.push(String(val(3, c) ?? '').trim().toLowerCase());
  const ci = n => hd.indexOf(n);
  const c = { order: ci('order'), disc: ci('$ discounts'), sales: ci('$ sales'), orders: ci('# order'), pieces: ci('# pieces'), start: ci('start date'), status: ci('status'), emp: ci('employee') };
  if (c.order < 0 || c.disc < 0 || c.sales < 0 || c.pieces < 0) throw new UploadStop(["This Coupons and Discounts file is missing some of the standard columns. Group it by <b>Store, Discount and Order</b>, export again and upload it without editing."], [], []);
  const hard = [], soft = [], warn = [];
  const grain = periodOf(from, to); periodChecks(hard, from, to, grain === 'day' ? null : grain, false);
  const rows = [], blocks = [], unknown = new Set(); let store = null, d = null, total = false, nolink = 0;
  for (let r = 4; r <= range.e.r; r++) {
    const a = val(r, 0), b = val(r, 1);
    if (a) { if (/^total$/i.test(String(a).trim())) { total = true; store = 'ignore'; continue; } store = storeFor(a); if (!store) unknown.add(a); d = null; continue; }
    if (b) { d = { store: store?.name || String(a), name: String(b).trim(), pieces: toNum(val(r, c.pieces)), orders: toNum(val(r, c.orders)), lines: [] }; blocks.push(d); continue; }
    if (!d || !store || store === 'ignore') continue;
    const id = receiptOf(cell(r, c.order)); if (!id) { nolink++; continue; }
    const line = { store: store.name, receipt: id, order_no: String(cell(r, c.order)?.v || ((String(cell(r, c.order)?.f || '').match(/,\s*"([^"]+)"\)/) || [])[1] ?? '')),
      discount_name: d.name, discount: Math.round(toNum(val(r, c.disc)) * 100) / 100, sales: Math.round(toNum(val(r, c.sales)) * 100) / 100,
      pieces: Math.round(toNum(val(r, c.pieces))), start_date: parseDate(val(r, c.start)), status: val(r, c.status) ? String(val(r, c.status)) : null, employee: val(r, c.emp) ? String(val(r, c.emp)) : null };
    d.lines.push(line); if (line.discount !== 0) rows.push(line);
  }
  if (unknown.size) hard.push(`This file has a store Hangr Ops doesn't know: <b>${[...unknown].map(esc).join(', ')}</b>. Send David a screenshot so he can add it.`);
  if (nolink) hard.push(`${num(nolink)} orders have no receipt link, so the file has been opened and re-saved, or edited. Export again and upload it as it comes from the POS.`);
  if (!total) hard.push('There is no Total line at the bottom, so the file may have been cut short. Export it again.');
  const bad = blocks.filter(b => Math.round(b.lines.reduce((t, l) => t + l.pieces, 0)) !== Math.round(b.pieces) || (!/^freeflow/i.test(b.name) && b.orders && b.lines.length !== Math.round(b.orders)));
  if (bad.length && !nolink) hard.push(`The file doesn't add up for ${bad.slice(0, 4).map(b => `${esc(b.store)} › ${esc(b.name)}`).join('; ')}: its orders don't match its total line. Export again and upload without editing.`);
  if (!blocks.length) hard.push('This file has no discounts in it. Check the dates, tick Paid and Active, and export again.');
  const known = new Set((await sb.from('discount_types').select('name,purpose').eq('org_id', S.org.id)).data?.filter(x => x.purpose !== 'unsorted').map(x => x.name) || []);
  const fresh = [...new Set(blocks.map(b => b.name))].filter(n => !known.has(n));
  if (fresh.length) warn.push(`New discount name${fresh.length > 1 ? 's' : ''}: ${fresh.map(esc).join(', ')}. David sets what ${fresh.length > 1 ? 'they are' : 'it is'} for in Admin › Discounts.`);
  const st = new Map(); for (const r of rows) { const v = st.get(r.store) || { lines: 0, discount: 0 }; v.lines++; v.discount += r.discount; st.set(r.store, v); }
  for (const b of blocks) if (!st.has(b.store)) st.set(b.store, { lines: 0, discount: 0 });
  const g = await uploadGate('discounts', grain, from, to, { stores: st, hard, soft, warn }, override);
  if (g.already) return `already loaded and locked for ${fmtD(from)} – ${fmtD(to)}, and this file matches it. Nothing to do. <span class="up">Done.</span>`;
  say(`Coupons and Discounts ${fmtD(from)} – ${fmtD(to)}, ${num(rows.length)} discounted orders. Loading…`);
  const n = await pushUpload('discounts', file.name, grain, from, to, [...st.keys()], rows, 'ingest_discounts', say);
  const tot = rows.reduce((t, r) => t + r.discount, 0);
  return `loaded ${num(n)} discounted orders (${money(tot, 2)} off), ${fmtD(from)} – ${fmtD(to)}.${warnHtml(g.warn)} Locked. <span class="up">Done.</span>`;
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
  const svc = S.services.slice().sort((a, b) => a.channel.localeCompare(b.channel) || a.name.localeCompare(b.name));
  app.innerHTML = `
  <div class="card" id="people"></div>

  <div class="card"><h2>Services <small>which POS services count as retail, commercial or restoration</small></h2><div class="scroll"><table>
    <tr><th>Service</th><th>Counts as</th><th>Marketing group</th></tr>
    ${svc.map(s => `<tr><td>${esc(s.name)}</td><td><select data-svc="${esc(s.name)}">${['retail', 'commercial', 'restoration', 'other'].map(c => `<option ${c === s.channel ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><select data-grp="${esc(s.name)}"><option value="">none</option>${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}" ${g === s.offer_group ? 'selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('')}
  </table></div><p class="note">"Other" is left out of every total (tickets, re-dos, zero lines). Marketing group decides which service a customer counts as using for targeted offers (DRAFT, set 28 Nov 2026); profiles rebuild at the next service upload. Changes apply straight away.</p></div>

  <div class="card"><h2>Stores</h2><div class="scroll"><table><tr><th>Store</th><th>Type</th><th>Active</th></tr>
    ${S.stores.map(s => `<tr><td>${esc(s.name)}</td><td>${s.channel}</td><td>${s.active ? 'Yes' : 'No'}</td></tr>`).join('')}</table></div>
    ${S.platform ? '<p class="note">New business for the consulting arm: ask Claude to add it (one org, its stores and its POS names).</p>' : ''}</div>
  <div class="card" id="discountTypes"></div>
  <div class="card" id="reports"></div>
  <div class="card" id="locks"></div>`;
  peopleCard($('#people'));
  discountTypesCard($('#discountTypes'));
  reportsCard($('#reports'));
  locksCard($('#locks'));
  app.querySelectorAll('[data-grp]').forEach(el => el.onchange = async () => {
    const { error } = await sb.from('services').update({ offer_group: el.value || null }).eq('org_id', S.org.id).eq('name', el.dataset.grp);
    if (error) alert(error.message); else S.services.find(s => s.name === el.dataset.grp).offer_group = el.value || null;
  });
  app.querySelectorAll('[data-svc]').forEach(el => el.onchange = async () => {
    const { error } = await sb.from('services').update({ channel: el.value, confirmed: true }).eq('org_id', S.org.id).eq('name', el.dataset.svc);
    if (error) alert(error.message); else { S.services.find(s => s.name === el.dataset.svc).channel = el.value; S.cache = {}; }
  });
}
/* ---------- discounts: what each POS discount is for ---------- */
const PURPOSES = [['marketing', 'Marketing offer (texts, flyers)'], ['loyalty', 'Loyalty / VIP'], ['counter', 'Counter discount (staff discretion)'], ['staff', 'Staff discount'], ['other', 'Other'], ['unsorted', 'Not set yet']];
async function discountTypesCard(el) {
  const [{ data: dt }, { data: lib }] = await Promise.all([
    sb.from('discount_types').select('*').eq('org_id', S.org.id).order('name'),
    sb.from('offer_library').select('slot,name').eq('org_id', S.org.id).order('slot')]);
  el.innerHTML = `<h2>Discounts <small>what each POS discount is for</small></h2>
    <p class="note">Each discount the counter uses in My Clean POS appears here once a Coupons and Discounts report is uploaded. Marketing ones are matched to the texts a customer received, so every offer shows who redeemed it. Give each offer its own POS discount (e.g. "Doona offer 20%") so results don't mix.</p>
    <div class="scroll"><table><tr><th>POS discount</th><th>What it's for</th><th>Offer it belongs to</th><th>Most % off</th><th>Most $ off</th><th>Set %</th><th>Order at least $</th><th>No order in last (days)</th><th>Note</th></tr>
    ${(dt || []).map(d => `<tr><td><b>${esc(d.name)}</b></td>
      <td><select data-dp="${esc(d.name)}">${PURPOSES.map(([v, n]) => `<option value="${v}" ${v === d.purpose ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><select data-ds="${esc(d.name)}"><option value="">none</option>${(lib || []).map(o => `<option value="${o.slot}" ${o.slot === d.offer_slot ? 'selected' : ''}>${o.slot}. ${esc(o.name)}</option>`).join('')}</select></td>
      ${['max_pct', 'max_amount', 'expected_pct', 'min_order', 'min_gap_days'].map(k => `<td><input type="number" step="any" data-rule="${k}" data-rn="${esc(d.name)}" value="${d[k] ?? ''}" style="width:70px"></td>`).join('')}
      <td class="mu">${esc(d.note || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="mu">None yet: upload a Coupons and Discounts report.</td></tr>'}</table></div>
    <p class="note">Rules drive Marketing › Discount checks. Leave a box blank for no rule. Any discount that takes the whole order to $0 is always flagged. "Order at least" is the price before the discount.</p>`;
  const save = async (name, patch) => { const { error } = await sb.from('discount_types').update({ ...patch, note: null, updated_at: new Date().toISOString() }).eq('org_id', S.org.id).eq('name', name); if (error) alert(error.message); };
  el.querySelectorAll('[data-dp]').forEach(x => x.onchange = () => save(x.dataset.dp, { purpose: x.value }));
  el.querySelectorAll('[data-ds]').forEach(x => x.onchange = () => save(x.dataset.ds, { offer_slot: x.value ? +x.value : null }));
  el.querySelectorAll('[data-rule]').forEach(x => x.onchange = () => save(x.dataset.rn, { [x.dataset.rule]: x.value === '' ? null : +x.value }));
}

/* ---------- people: invite by email, roles, password resets, two-factor ---------- */
async function peopleCall(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body: { org_id: S.org.id, ...body } });
  if (error || data?.error) throw new Error(data?.error || error.message);
  return data;
}
async function peopleCard(el, note = '') {
  el.innerHTML = `<h2>People with access to ${esc(S.org.name)}</h2><p class="note">Loading…</p>`;
  let d; try { d = await peopleCall({ action: 'list' }); } catch (e) { el.innerHTML = `<h2>People</h2><p class="err">${esc(e.message)}</p>`; return; }
  const storeName = id => S.stores.find(s => s.id === id)?.name || '';
  const when = t => t ? new Date(t).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '<span class="mu">never</span>';
  const tf = x => x.two_factor ? '<span class="up">on</span>' : '<span class="dn">not yet</span>';
  const roleSel = (m) => `<select data-role="${m.id}">${[['org_admin', 'Admin'], ['store_manager', 'Store manager'], ['va', 'Uploads only']].map(([v, n]) => `<option value="${v}" ${v === m.role ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select data-rstore="${m.id}" ${m.role === 'store_manager' ? '' : 'hidden'}>${S.stores.filter(s => s.active).map(s => `<option value="${s.id}" ${s.id === m.store_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  el.innerHTML = `<h2>People with access to ${esc(S.org.name)}</h2>
    <div class="scroll"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Two-factor</th><th>Last sign-in</th><th></th></tr>
    ${d.owners.map(o => `<tr><td>Owner</td><td>${esc(o.email || '')}</td><td>Owner (every business)</td><td>${tf(o)}</td><td>${when(o.last_sign_in)}</td><td></td></tr>`).join('')}
    ${d.members.map(m => `<tr><td>${esc(m.full_name || '')}</td><td>${esc(m.email || '')}</td><td>${roleSel(m)}</td><td>${tf(m)}</td><td>${when(m.last_sign_in)}</td>
      <td style="white-space:nowrap"><button class="btn ghost" data-reset="${esc(m.email || '')}">Reset password</button>
      ${d.can_reset_2fa && m.two_factor ? `<button class="btn ghost" data-r2fa="${m.user_id}">Reset two-factor</button>` : ''}
      <button class="btn ghost" data-rm="${m.id}">Remove</button></td></tr>`).join('')}
    ${d.invites.map(i => `<tr><td>${esc(i.full_name || '')}</td><td>${esc(i.email)}</td><td>${roleName(i.role)}${i.store_id ? ' · ' + esc(storeName(i.store_id)) : ''}</td><td class="mu">–</td><td class="mu">invited, not set up yet</td>
      <td style="white-space:nowrap"><button class="btn ghost" data-resend="${esc(i.email)}">Send invite again</button> <button class="btn ghost" data-rminv="${i.id}">Cancel</button></td></tr>`).join('')}
    </table></div>
    <h3 style="margin-top:14px">Invite someone</h3>
    <div class="row"><input id="iName" placeholder="Name"><input id="iEmail" type="email" placeholder="Email" style="width:220px">
      <select id="iRole"><option value="store_manager">Store manager (one store)</option><option value="va">Uploads only (VA)</option><option value="org_admin">Admin (everything)</option></select>
      <select id="iStore">${S.stores.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <button class="btn" id="iGo">Send invite</button></div>
    <p class="note">They get an email from Hangr Ops with a link to set their password, then set up two-factor on their phone. Store managers see only their store. Invite links work for 24 hours; "Send invite again" makes a fresh one.</p>
    <p id="iMsg">${note}</p>`;
  const say = (m, bad) => el.querySelector('#iMsg').innerHTML = bad ? `<span class="err">${esc(m)}</span>` : `<span class="up">${esc(m)}</span>`;
  const run = async (body, confirmMsg) => { if (confirmMsg && !confirm(confirmMsg)) return; try { const r = await peopleCall(body); peopleCard(el, `<span class="up">${esc(r.message || 'Done.')}</span>`); } catch (e) { say(e.message, true); } };
  el.querySelector('#iRole').onchange = () => el.querySelector('#iStore').hidden = el.querySelector('#iRole').value !== 'store_manager';
  el.querySelector('#iGo').onclick = () => { const role = el.querySelector('#iRole').value;
    run({ action: 'invite', email: el.querySelector('#iEmail').value, full_name: el.querySelector('#iName').value.trim(), role, store_id: role === 'store_manager' ? el.querySelector('#iStore').value : null }); };
  el.querySelectorAll('[data-role]').forEach(sel => sel.onchange = () => { const st = el.querySelector(`[data-rstore="${sel.dataset.role}"]`); st.hidden = sel.value !== 'store_manager';
    run({ action: 'set_role', membership_id: sel.dataset.role, role: sel.value, store_id: st.value }); });
  el.querySelectorAll('[data-rstore]').forEach(st => st.onchange = () => run({ action: 'set_role', membership_id: st.dataset.rstore, role: 'store_manager', store_id: st.value }));
  el.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => run({ action: 'reset_password', email: b.dataset.reset }, `Email a password reset link to ${b.dataset.reset}?`));
  el.querySelectorAll('[data-r2fa]').forEach(b => b.onclick = () => run({ action: 'reset_2fa', user_id: b.dataset.r2fa }, 'Reset their two-factor? They\'ll set it up again with their phone at the next sign-in.'));
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => run({ action: 'remove', membership_id: b.dataset.rm }, 'Remove this person\'s access?'));
  el.querySelectorAll('[data-rminv]').forEach(b => b.onclick = () => run({ action: 'remove', invite_id: b.dataset.rminv }, 'Cancel this invite?'));
  el.querySelectorAll('[data-resend]').forEach(b => b.onclick = () => run({ action: 'resend', email: b.dataset.resend }));
}

/* ---------- Monday store reports: who gets which store, and when ---------- */
const REPORT_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
async function reportsCard(el) {
  const [{ data: sch }, { data: runs }] = await Promise.all([
    sb.from('report_schedules').select('*').eq('org_id', S.org.id),
    sb.from('report_runs').select('*').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(60)]);
  const name = id => id ? (S.stores.find(s => s.id === id)?.name || '?') : 'Marketing results', sort = id => id ? (S.stores.find(s => s.id === id)?.sort ?? 99) : 999;
  const last = id => (runs || []).find(r => (r.store_id || null) === (id || null) && r.kind !== 'waiting');
  const rows = (sch || []).sort((a, b) => sort(a.store_id) - sort(b.store_id));
  el.innerHTML = `<h2>Monday reports <small>one email per store, plus marketing results, for the week just finished</small></h2>
    <p class="note">Each report goes once the week's two uploads (Sales Incoming by service and order, then Customer Orders) are loaded and locked, at or after the time set here. If they're late it still sends when they land, up to two days after. If anything is still waiting at 12pm Tuesday, David gets one note. Sent from reports@hangr.au; replies come to David. Separate addresses with commas.</p>
    <div class="scroll"><table><tr><th>Store</th><th>Send to</th><th>Day</th><th>From</th><th>Counter wages</th><th>On</th><th>Last sent</th><th></th></tr>
    ${rows.map(r => { const l = last(r.store_id); return `<tr data-sch="${r.id}">
      <td><b>${esc(name(r.store_id))}</b></td>
      <td><input data-f="to" value="${esc((r.recipients || []).join(', '))}" style="width:280px"></td>
      <td><select data-f="dow">${REPORT_DOW.map((d, i) => `<option value="${i}" ${i === r.send_dow ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
      <td><input data-f="at" type="time" value="${String(r.send_after).slice(0, 5)}" style="width:100px"></td>
      <td>${r.kind === 'marketing' ? '<span class="mu">–</span>' : `<input data-f="lab" type="checkbox" ${r.include_labour ? 'checked' : ''}>`}</td>
      <td><input data-f="on" type="checkbox" ${r.enabled ? 'checked' : ''}></td>
      <td class="mu">${l ? `${l.kind === 'test' ? 'test · ' : ''}${l.status === 'sent' ? '' : '<span class="dn">failed</span> · '}${new Date(l.created_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}${l.error ? ` <span class="dn">${esc(l.error)}</span>` : ''}` : '–'}</td>
      <td style="white-space:nowrap"><button class="btn" data-save>Save</button> <button class="btn ghost" data-prev>Preview</button> <button class="btn ghost" data-test>Send me a test</button></td></tr>`; }).join('')}
    </table></div><div id="repMsg" class="note"></div><div id="repPrev"></div>`;
  const msg = m => el.querySelector('#repMsg').innerHTML = m;
  el.querySelectorAll('tr[data-sch]').forEach(tr => {
    const id = tr.dataset.sch, row = rows.find(r => r.id === id), f = k => tr.querySelector(`[data-f="${k}"]`);
    tr.querySelector('[data-save]').onclick = async () => {
      const to = f('to').value.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      const bad = to.filter(x => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x));
      if (bad.length) return msg(`<span class="dn">Not an email address: ${esc(bad.join(', '))}</span>`);
      if (f('on').checked && !to.length) return msg('<span class="dn">Add at least one address before switching it on.</span>');
      const { error } = await sb.from('report_schedules').update({ recipients: to, send_dow: +f('dow').value, send_after: f('at').value || '16:00', include_labour: f('lab') ? f('lab').checked : false, enabled: f('on').checked, updated_at: new Date().toISOString() }).eq('id', id);
      msg(error ? `<span class="dn">${esc(error.message)}</span>` : `<span class="up">Saved ${esc(name(row.store_id))}.</span>`);
    };
    tr.querySelector('[data-prev]').onclick = async () => {
      msg('Building preview…');
      const { data, error } = await sb.functions.invoke('store-reports', { body: { mode: 'preview', kind: row.kind, org_id: S.org.id, store_id: row.store_id, labour: f('lab') ? f('lab').checked : false } });
      if (error || data?.error) return msg(`<span class="dn">${esc(data?.error || error.message)}</span>`);
      msg(`<b>Subject:</b> ${esc(data.subject)}`);
      el.querySelector('#repPrev').innerHTML = '<iframe style="width:100%;height:900px;border:1px solid var(--line);border-radius:8px;margin-top:8px"></iframe>';
      el.querySelector('#repPrev iframe').srcdoc = data.html;
    };
    tr.querySelector('[data-test]').onclick = async () => {
      msg('Sending a test to you…');
      const { data, error } = await sb.functions.invoke('store-reports', { body: { mode: 'test', kind: row.kind, org_id: S.org.id, store_id: row.store_id, labour: f('lab') ? f('lab').checked : false } });
      msg(error || data?.error ? `<span class="dn">${esc(data?.error || error.message)}</span>` : `<span class="up">Test sent to ${esc(data.to.join(', '))}.</span>`);
    };
  });
}

/* ---------- locked figures: every upload locks what it loaded; only David unlocks ---------- */
async function locksCard(el, kind = 'sales') {
  const [{ data: act }, { data: un }] = await Promise.all([
    sb.from('data_locks').select('*').eq('org_id', S.org.id).eq('kind', kind).is('unlocked_at', null).order('date_to', { ascending: false }).limit(60),
    sb.from('data_locks').select('*').eq('org_id', S.org.id).not('unlocked_at', 'is', null).order('unlocked_at', { ascending: false }).limit(10)]);
  const what = l => l.kind === 'sales' ? `${l.grain === 'month' ? new Date(l.date_to + 'T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : (l.grain === 'week' ? 'week ending ' : '') + fmtD(l.date_to)}` : `${fmtD(l.date_from)} – ${fmtD(l.date_to)}`;
  el.innerHTML = `<h2>Locked figures <small>${kind === 'sales' ? 'sales by week and month' : 'customer orders'}</small></h2>
    <div class="row"><button class="btn ${kind === 'sales' ? '' : 'ghost'}" data-lk="sales">Sales</button><button class="btn ${kind === 'orders' ? '' : 'ghost'}" data-lk="orders">Customer orders</button></div>
    <p class="note">Every upload locks the period it loaded, so a report on an old week always shows the same figures. An upload that would change a locked period is refused. ${S.platform ? 'Unlock a period only to reload it on purpose; the next clean upload locks it again.' : 'Only David can unlock a period.'}</p>
    <div class="scroll"><table><tr><th>Period</th><th>Locked</th><th>How</th>${S.platform ? '<th>Unlock</th>' : ''}</tr>
    ${(act || []).map(l => `<tr><td>${what(l)}${l.kind === 'sales' ? ` <span class="chip">${l.grain}</span>` : ''}</td><td>${new Date(l.locked_at).toLocaleDateString('en-AU')}</td><td class="mu">${esc(l.note || 'upload')}</td>
      ${S.platform ? `<td><input data-why="${l.id}" placeholder="reason" style="width:160px"> <button class="btn ghost" data-unlock="${l.id}">Unlock</button></td>` : ''}</tr>`).join('')}
    </table></div>
    ${(un || []).length ? `<h3 style="margin-top:12px">Recently unlocked</h3><div class="scroll"><table><tr><th>Period</th><th>Unlocked</th><th>Reason</th></tr>${un.map(l => `<tr><td>${l.kind}: ${what(l)}</td><td>${new Date(l.unlocked_at).toLocaleString('en-AU')}</td><td>${esc(l.unlock_reason || '')}</td></tr>`).join('')}</table></div>` : ''}`;
  el.querySelectorAll('[data-lk]').forEach(b => b.onclick = () => locksCard(el, b.dataset.lk));
  el.querySelectorAll('[data-unlock]').forEach(b => b.onclick = async () => {
    const why = el.querySelector(`[data-why="${b.dataset.unlock}"]`).value.trim();
    if (!why) { alert('Give a reason for unlocking.'); return; }
    const { error } = await sb.rpc('unlock_period', { p_lock: b.dataset.unlock, p_reason: why });
    if (error) alert(error.message); else locksCard(el, kind);
  });
}
const roleName = r => ({ org_admin: 'Admin', store_manager: 'Store manager', va: 'Uploads only', platform: 'Owner' }[r] || r);

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') loginView(); });
boot();
