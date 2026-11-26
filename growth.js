/* Hangr Ops: referral programme and Google reviews (module A3), as Marketing tabs.
   Referrals: every customer has a code (referral_code(id)); a friend quotes it at the counter, staff log it here or
   on the customer's profile, and both get the credit in My Clean POS (a manual POS step; nothing here changes POS).
   The report matches the friend's later orders by mobile. Reviews: asks come from the automated review flow;
   reviews are logged by hand (Google gives no free feed), so the ratio shows whether the asks work. */

async function mkReferrals(el) {
  const { data: R, error } = await sb.rpc('referral_report', { p_org: S.org.id });
  if (error) { el.innerHTML = `<div class="card err">${esc(error.message)}</div>`; return; }
  const rows = R.rows || [], credit = +R.credit || 0;
  const live = rows.filter(r => r.status !== 'void');
  const ordered = live.filter(r => r.referee_orders > 0);
  const sales = live.reduce((a, r) => a + +r.referee_sales, 0);
  const cost = live.reduce((a, r) => a + (+r.referrer_credit || 0) + (+r.referee_credit || 0), 0);
  el.innerHTML = `
  <div class="tiles">
    <div class="tile"><div class="l">Referrals logged</div><div class="v">${live.length}</div><div class="d mu">${R.invites_sent} invite texts sent</div></div>
    <div class="tile"><div class="l">Friends who ordered</div><div class="v">${ordered.length}</div><div class="d mu">matched by mobile since the referral</div></div>
    <div class="tile"><div class="l">Their sales since</div><div class="v">${money(sales)}</div><div class="d mu">inc GST, from Customer Orders</div></div>
    <div class="tile"><div class="l">Credit given</div><div class="v">${money(cost)}</div><div class="d mu">${money(credit)} each way per referral</div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>A customer quoted a code</h2>
      <div class="row"><input id="rfCode" placeholder="Code, e.g. K7QX2M" style="width:150px;text-transform:uppercase"><button class="btn ghost" id="rfFind">Look up</button></div>
      <div id="rfWho" class="note" style="margin-top:6px"></div>
      <div id="rfForm" hidden>
        <div class="row"><input id="rfName" placeholder="Friend's name"><input id="rfMob" placeholder="Friend's mobile"></div>
        <div class="row" style="margin-top:6px"><select id="rfStore">${S.stores.filter(s => s.active).map(s => `<option>${esc(s.name)}</option>`).join('')}</select>
          <input id="rfVal" type="number" placeholder="First order $" style="width:120px"><input id="rfCred" type="number" value="${credit}" style="width:80px" title="credit each way"></div>
        <div class="row" style="margin-top:6px"><button class="btn" id="rfLog">Log referral</button><span id="rfMsg" class="note"></span></div>
      </div></div>
    <div class="card"><h2>Inviting customers</h2>
      <p class="note">Each customer's code shows on their profile. To invite a group, use One-off campaigns with <b>{code}</b> in the message; it fills in each customer's own code. The standard invite (Templates, referral_invite) reads:</p>
      <p style="font-size:13px">"Hi {first_name}, your Master DC referral code is {code}. Share it with a friend - they get $75 off their first order with us, and you get $75 credit on your account too."</p>
      <p class="note">Credit is applied by hand in My Clean POS. Mark each referral Credited once both are done. The default credit each way is set under Sending.</p></div>
  </div>
  <div class="card"><h2>Referrals</h2><div class="scroll"><table>
    <tr><th>Logged</th><th>Referrer</th><th>Code</th><th>Friend</th><th>First order</th><th>Friend's orders since</th><th>Sales since</th><th>Credit each</th><th>Status</th><th style="text-align:left">Note</th></tr>
    ${rows.map(r => `<tr><td>${fmtD(String(r.created_at).slice(0, 10))}</td><td>${esc(r.referrer || '–')}<div class="note">${esc(r.referrer_store || '')}</div></td><td>${esc(r.code || '')}</td>
      <td>${esc(r.referee_name || '–')}<div class="note">${esc(r.referee_mobile || '')}</div></td><td>${r.first_order_value ? money(r.first_order_value, 2) : '–'}<div class="note">${esc(r.first_order_store || '')}</div></td>
      <td>${r.referee_orders}</td><td>${money(r.referee_sales)}</td><td>${money(r.referrer_credit)} / ${money(r.referee_credit)}</td>
      <td><select data-rst="${r.id}">${['logged', 'credited', 'void'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td style="text-align:left;white-space:normal">${esc(r.notes || '')}</td></tr>`).join('') || '<tr><td colspan="10" class="mu">No referrals logged yet.</td></tr>'}
  </table></div></div>`;
  let who = null;
  $('#rfFind').onclick = async () => {
    const code = $('#rfCode').value.trim().toUpperCase(); if (!code) return;
    const { data, error } = await sb.rpc('referral_lookup', { p_org: S.org.id, p_code: code });
    who = data?.[0] || null;
    $('#rfWho').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : who ? `<b>${esc(who.full_name)}</b>, ${esc(who.store || '')} · last order ${fmtD(who.last_order)} · ${who.referrals} referral${who.referrals === 1 ? '' : 's'} so far` : '<span class="dn">No customer has that code.</span>';
    $('#rfForm').hidden = !who;
  };
  $('#rfLog').onclick = async () => {
    if (!who) return;
    const cr = +$('#rfCred').value || 0;
    const { error } = await sb.from('referrals').insert({ org_id: S.org.id, referrer_customer_id: who.customer_id, code: $('#rfCode').value.trim().toUpperCase(),
      referee_name: $('#rfName').value.trim() || null, referee_mobile: $('#rfMob').value.trim() || null, first_order_date: iso(new Date()),
      first_order_store: $('#rfStore').value, first_order_value: +$('#rfVal').value || null, referrer_credit: cr, referee_credit: cr, logged_by: S.user.id });
    if (error) { $('#rfMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    mkReferrals(el);
  };
  el.querySelectorAll('[data-rst]').forEach(s => s.onchange = async () => {
    const { error } = await sb.from('referrals').update({ status: s.value, credited_at: s.value === 'credited' ? new Date().toISOString() : null }).eq('id', s.dataset.rst);
    if (error) alert(error.message);
  });
}

async function mkReviews(el) {
  const [{ data: rep, error }, { data: recent }] = await Promise.all([
    sb.rpc('review_report', { p_org: S.org.id, p_days: 90 }),
    sb.from('reviews_log').select('*').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(50)]);
  if (error) { el.innerHTML = `<div class="card err">${esc(error.message)}</div>`; return; }
  const stores = rep || [], sName = Object.fromEntries(S.stores.map(s => [s.id, s.name]));
  const tot = k => stores.reduce((a, r) => a + (+r[k] || 0), 0);
  el.innerHTML = `
  <div class="tiles">
    <div class="tile"><div class="l">Review asks sent, 90 days</div><div class="v">${num(tot('asks'))}</div><div class="d mu">${num(tot('asks_queued'))} waiting to send</div></div>
    <div class="tile"><div class="l">Reviews logged, 90 days</div><div class="v">${num(tot('reviews'))}</div><div class="d mu">${tot('asks') ? (tot('reviews') / tot('asks') * 100).toFixed(1) + '% of asks' : 'no asks sent yet'}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>By store <small>last 90 days</small></h2><div class="scroll"><table>
    <tr><th>Store</th><th style="text-align:left">Google review link</th><th>Asks sent</th><th>Reviews logged</th><th>Reviews per 100 asks</th><th>Average rating</th></tr>
    ${stores.map(r => `<tr><td>${esc(r.store)}</td><td style="text-align:left"><input data-url="${r.store_id}" value="${esc(r.url || '')}" placeholder="https://g.page/r/…/review" style="width:280px"></td>
      <td>${num(r.asks)}</td><td>${num(r.reviews)}</td><td>${r.asks ? (r.reviews / r.asks * 100).toFixed(1) : '–'}</td><td>${r.avg_rating ?? '–'}</td></tr>`).join('')}
  </table></div><p class="note">The review ask goes out from the automated flows after a collection, only for stores with a link here. A store without a link gets no asks.</p></div>
  <div class="grid g2">
    <div class="card"><h2>Log a review</h2>
      <div class="row"><select id="rvStore">${S.stores.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <select id="rvRating">${[5, 4, 3, 2, 1].map(n => `<option>${n}</option>`).join('')}</select><span class="note">stars</span></div>
      <label>Link to the review (optional)</label><input id="rvLink" style="width:100%">
      <label>Who and notes (optional)</label><input id="rvNote" style="width:100%" placeholder="e.g. Jane S., mentioned the wedding dress">
      <div class="row" style="margin-top:8px"><button class="btn" id="rvLog">Log review</button><span id="rvMsg" class="note"></span></div>
      <p class="note">Google doesn't give us new reviews automatically, so log them as they come in (Google Business Profile app, Reviews). Anything 3 stars or under should get a reply the same day.</p></div>
    <div class="card"><h2>Recent reviews</h2><div class="scroll"><table>
      <tr><th>Logged</th><th>Store</th><th>Stars</th><th style="text-align:left">Notes</th></tr>
      ${(recent || []).map(v => `<tr><td>${fmtD(String(v.created_at).slice(0, 10))}</td><td>${esc(sName[v.store_id] || '')}</td><td class="${v.rating <= 3 ? 'dn' : ''}">${v.rating ?? '–'}</td>
        <td style="text-align:left;white-space:normal">${v.link ? `<a href="${esc(v.link)}" target="_blank" rel="noopener">view</a> ` : ''}${esc(v.notes || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">None logged yet.</td></tr>'}
    </table></div></div>
  </div>`;
  el.querySelectorAll('[data-url]').forEach(i => i.onchange = async () => {
    const v = i.value.trim();
    if (v && !/^https:\/\//.test(v)) { alert('The link must start with https://'); return; }
    const { error } = await sb.from('stores').update({ google_review_url: v || null }).eq('id', i.dataset.url);
    if (error) alert(error.message);
  });
  $('#rvLog').onclick = async () => {
    const link = $('#rvLink').value.trim();
    if (link && !/^https:\/\//.test(link)) { $('#rvMsg').innerHTML = '<span class="err">The link must start with https://</span>'; return; }
    const { error } = await sb.from('reviews_log').insert({ org_id: S.org.id, store_id: $('#rvStore').value, rating: +$('#rvRating').value, link: link || null, notes: $('#rvNote').value.trim() || null, logged_by: S.user.id });
    if (error) { $('#rvMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    mkReviews(el);
  };
}
