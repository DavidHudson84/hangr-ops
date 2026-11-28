/* Hangr Ops: Marketing (admin). Offer calendar, automated flows, $200 draw / free order, one-off campaigns,
   queue and results, opt-outs, templates. Every send path ends in sms_sends; the sms-send function only sends
   while Settings > mode is test or live. */

const MK_TABS = [['report', 'Report'], ['offers', 'Offers'], ['flows', 'Automated flows'], ['loyalty', '$200 draw & free order'], ['referrals', 'Referrals'], ['reviews', 'Reviews'], ['campaigns', 'One-off campaigns'], ['test', 'Test texts'], ['programs', 'Yearly & reminders'], ['results', 'Queue & results'], ['checks', 'Discount checks'], ['optouts', 'Opt-outs'], ['templates', 'Templates'], ['settings', 'Sending']];
// real SMS parts: any emoji or curly quote makes the whole text 70 per part (67 split); ~^{}[]\|€ count double in plain text
const GSM = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà~^{}\[\]\\|€]*$/;
const segs = t => { const n = [...t].length; if (!GSM.test(t)) return n <= 70 ? 1 : Math.ceil(n / 67); const m = n + (t.match(/[~^{}\[\]\\|€]/g) || []).length; return m <= 160 ? 1 : Math.ceil(m / 153); };
let FOOT = ' David from Master Dry Cleaners here. Reply STOP to opt out.';  // intro + opt-out, reset from Sending settings below
const statusChip = s => `<span class="chip" style="${s === 'approved' || s === 'queued' || s === 'confirmed' ? 'background:#e6f4ea;color:#127a3d' : s === 'cancelled' ? 'background:#fdecea;color:#b42318' : ''}">${esc(s)}</span>`;

async function marketingView(tab = 'offers') {
  const { data: set } = await sb.from('sms_settings').select('*').eq('org_id', S.org.id).maybeSingle();
  S.sms = set; if (set) FOOT = ' ' + (set.header || '') + ' ' + (set.footer || '');
  const asof = (await sb.from('orgs').select('orders_as_of').eq('id', S.org.id).single()).data?.orders_as_of;
  const stale = !asof || (Date.now() - new Date(asof)) / 864e5 > 10;
  app.innerHTML = `
  <div class="row ph"><h1 class="pt"><small>Marketing</small>${esc((MK_TABS.find(t => t[0] === tab) || MK_TABS[1])[1])}</h1><span class="sp"></span>
    <span class="chip" style="${set?.mode === 'live' ? 'background:#e6f4ea;color:#127a3d' : set?.mode === 'test' ? 'background:#fff4e5;color:#b54708' : 'background:#fdecea;color:#b42318'}">Sending: ${set?.mode === 'live' ? 'LIVE' : set?.mode === 'test' ? 'test number only' : 'OFF'}</span>
    <span class="chip ${stale ? '' : ''}" style="${stale ? 'background:#fdecea;color:#b42318' : ''}">Orders loaded to ${fmtD(asof)}</span></div>
  ${stale ? '<div class="card" style="border-color:#f3c5c0"><b>Order data is out of date.</b> The automated flows and the monthly draw wait until Customer Orders are uploaded to within the last 10 days, so they never act on old information.</div>' : ''}
  <div id="mk"></div>`;
  const fn = { offers: mkOffers, flows: mkFlows, loyalty: mkLoyalty, referrals: mkReferrals, reviews: mkReviews, campaigns: mkCampaigns, test: mkTest, programs: mkPrograms, results: mkResults, report: mkReport, checks: mkChecks, optouts: mkOptouts, templates: mkTemplates, settings: mkSettings }[tab] || mkOffers;
  await fn($('#mk'));
}

/* ---------- offer calendar ---------- */
// Six-offer library, rotated: customers sit in six fixed groups and each group gets a different library offer
// each period, moving one along every period (offer_slot in the database). Periods are offer_cycles rows.
const VAR_NAMES = { vip: 'VIP and Regular', casual: 'Casual', lapsed: 'Lapsed (180-365 days)' };
async function mkOffers(el) {
  const [{ data: lib }, { data: cycles }] = await Promise.all([
    sb.from('offer_library').select('*').eq('org_id', S.org.id).order('slot'),
    sb.from('offer_cycles').select('*').eq('org_id', S.org.id).order('starts_on')]);
  const per = cycles || [];
  // which offer each group gets in a period (same rule as app.offer_slot)
  const slotFor = (i, g) => ((i + g) % 6) + 1;
  el.innerHTML = `<div class="card"><h2>How it works</h2>
    <p class="note">Customers are split into six fixed groups. Each period every group gets a different offer from the six below, and each period the groups move on to the next offer, so six offers are always running at once and nobody gets the same offer twice in a row. Within a period, texts go out in six waves on six sending days in a row (the gap is set in Sending), one group and one offer per wave, so the counters see one offer at a time and each wave's response can be read on its own. 10% are held back to measure what each offer won. Customers whose average ticket is under the cut-off get the low-spender offer every period instead. Nothing is queued until you approve a period.</p></div>
  <div class="card"><h2>The six offers</h2>
    ${(lib || []).map(o => `<div class="card" style="margin:10px 0" id="ol-${o.slot}">
      <div class="row"><b>Offer ${o.slot}: </b><input data-name value="${esc(o.name)}" style="flex:1;max-width:420px"><span class="note">${esc(o.note || '')}</span></div>
      <div class="row"><label style="margin:0">Promotes</label><select data-group><option value="">no one service (whole order)</option>${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}" ${g === o.service_group ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="note">Anyone sent an offer for this service in the last ${S.sms?.service_repeat_days ?? 350} days is skipped.</span></div>
      ${['vip', 'casual', 'lapsed'].map(v => { const b = o.variants?.[v]?.body || ''; return `<label>${VAR_NAMES[v]} <span class="note" data-cnt="${o.slot}-${v}">${b.length + FOOT.length} chars · ${segs(b + FOOT)} SMS</span></label>
        <textarea data-var="${v}" style="min-height:48px">${esc(b)}</textarea>`; }).join('')}
      <details style="margin-top:8px" ${o.variants_b && Object.values(o.variants_b).some(x => x?.body) ? 'open' : ''}><summary><b>A/B test: version B</b> <span class="note">${o.ab_label ? 'testing: ' + esc(o.ab_label) : 'optional: leave blank for no test'}</span></summary>
        <p class="note">Write version B to change one thing only (e.g. *** emphasis, a $ amount instead of a %, no intro). Half of this offer's customers get A and half get B, picked at random, with the 10% hold-back as usual. Leave a tier blank and everyone in that tier gets A.</p>
        <label>What B tests</label><input data-ablabel value="${esc(o.ab_label || '')}" placeholder="e.g. *** emphasis" style="width:260px">
        ${['vip', 'casual', 'lapsed'].map(v => { const b = o.variants_b?.[v]?.body || ''; return `<label>${VAR_NAMES[v]}, version B <span class="note" data-cnt="${o.slot}-b${v}">${b ? `${b.length + FOOT.length} chars · ${segs(b + FOOT)} SMS` : ''}</span></label>
          <textarea data-varb="${v}" style="min-height:44px" placeholder="blank = no test for this tier">${esc(b)}</textarea>`; }).join('')}
      </details>
      <div class="row"><button class="btn ghost" data-save="${o.slot}">Save offer ${o.slot}</button><span id="os-${o.slot}" class="note"></span></div>
    </div>`).join('')}
    <p class="note">Placeholders: {first_name}, {store}, {ends} (the end of the period). The intro and opt-out line are added automatically. Changes apply to periods not yet approved.</p></div>
  <div class="card" id="abRes"></div>
  <div class="card" id="ol-low"><h2>Low spenders <small>average ticket under $${S.sms?.low_spender_cutoff ?? 30}; every period, instead of the rotation</small></h2>
    <label>Message <span class="note" data-cnt="low-x">${(S.sms?.low_spender_body || '').length + FOOT.length} chars · ${segs((S.sms?.low_spender_body || '') + FOOT)} SMS</span></label>
    <textarea data-var="x" id="lowBody" style="min-height:48px">${esc(S.sms?.low_spender_body || '')}</textarea>
    <div class="row"><label style="margin:0">Cut-off $</label><input id="lowCut" type="number" value="${S.sms?.low_spender_cutoff ?? 30}" style="width:80px"><button class="btn ghost" id="lowSave">Save</button><span id="os-low" class="note"></span></div></div>
  <div class="card"><h2>Periods</h2><div class="scroll"><table>
    <tr><th>Period</th><th>Status</th>${[0, 1, 2, 3, 4, 5].map(g => `<th>Group ${g + 1}</th>`).join('')}<th></th></tr>
    ${per.map((c, i) => `<tr><td>${fmtD(c.starts_on)} – ${fmtD(c.ends_on)}</td><td>${statusChip(c.status)}</td>
      ${[0, 1, 2, 3, 4, 5].map(g => `<td class="mu">${g === 0 ? '' : ''}${slotFor(i, g)}</td>`).join('')}
      <td style="text-align:left">${c.status === 'draft' ? `<button class="btn ghost" style="padding:2px 8px" data-prev="${c.id}">Preview</button> <button class="btn" style="padding:2px 8px" data-appr="${c.id}">Approve and queue</button>` : ''}
        ${c.status === 'queued' ? `<button class="btn ghost" style="padding:2px 8px" data-cancel="${c.campaign_id}">Cancel unsent</button>` : ''}</td></tr>
      <tr><td colspan="9" id="op-${c.id}" class="note" style="text-align:left;white-space:normal"></td></tr>`).join('')}
  </table></div><p class="note">The group columns show which offer number each group gets that period.</p></div>`;
  el.querySelectorAll('textarea[data-var]').forEach(t => t.oninput = () => { const id = t.closest('.card').id.slice(3); const n = el.querySelector(`[data-cnt="${id}-${t.dataset.var}"]`); n.textContent = `${t.value.length + FOOT.length} chars · ${segs(t.value + FOOT)} SMS`; });
  el.querySelectorAll('textarea[data-varb]').forEach(t => t.oninput = () => { const id = t.closest('.card').id.slice(3); const n = el.querySelector(`[data-cnt="${id}-b${t.dataset.varb}"]`); n.textContent = t.value ? `${t.value.length + FOOT.length} chars · ${segs(t.value + FOOT)} SMS` : ''; });
  el.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const card = $('#ol-' + b.dataset.save), v = {};
    card.querySelectorAll('textarea[data-var]').forEach(t => v[t.dataset.var] = { body: t.value.trim() });
    const vb = {}; card.querySelectorAll('textarea[data-varb]').forEach(t => { if (t.value.trim()) vb[t.dataset.varb] = { body: t.value.trim() }; });
    const hasB = Object.keys(vb).length > 0, label = card.querySelector('[data-ablabel]').value.trim();
    if (hasB && !label) { $('#os-' + b.dataset.save).innerHTML = '<span class="err">Say what version B tests, so the results make sense.</span>'; return; }
    const { error } = await sb.from('offer_library').update({ name: card.querySelector('[data-name]').value.trim(), variants: v, variants_b: hasB ? vb : null, ab_label: hasB ? label : null, service_group: card.querySelector('[data-group]').value || null, updated_at: new Date().toISOString() }).eq('org_id', S.org.id).eq('slot', +b.dataset.save);
    $('#os-' + b.dataset.save).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.';
  });
  abResults($('#abRes'));
  $('#lowSave').onclick = async () => {
    const { error } = await sb.from('sms_settings').update({ low_spender_body: $('#lowBody').value.trim(), low_spender_cutoff: +$('#lowCut').value || 30 }).eq('org_id', S.org.id);
    $('#os-low').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.';
  };
  el.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
    const id = b.dataset.prev; $('#op-' + id).textContent = 'Working it out…';
    const { data, error } = await sb.rpc('offer_preview', { p_cycle: id });
    $('#op-' + id).innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : `${num(data.total)} customers: ${Object.entries(data.by_offer || {}).map(([k, v]) => `${esc(k)} ${num(v)}`).join(' · ')} · low spenders ${num(data.low_spenders)}. Waves: ${Object.entries(data.by_wave || {}).map(([k, v]) => `${k}: ${num(v)}`).join(' · ')}. About ${money(data.est_cost)} after the ${data.held_back_pct}% hold-back.`;
  });
  el.querySelectorAll('[data-appr]').forEach(b => b.onclick = async () => {
    const id = b.dataset.appr;
    if (!confirm('Approve this period and queue every wave with the six offers as they stand? Messages only leave while Sending is on.')) return;
    $('#op-' + id).textContent = 'Queuing…';
    const { data, error } = await sb.rpc('offer_approve', { p_cycle: id });
    if (error) { $('#op-' + id).innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    alert(`Queued ${data.queued} messages (${data.skipped_cap} skipped: already had 2 marketing texts that month).`); marketingView('offers');
  });
  el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { if (!confirm('Cancel every message in this period that hasn\'t gone yet?')) return; const { data } = await sb.rpc('campaign_cancel', { p_campaign: b.dataset.cancel }); alert(`${data} messages cancelled.`); marketingView('offers'); });
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
  const { data: camps } = await sb.from('campaigns').select('*').eq('org_id', S.org.id).in('kind', ['custom', 'announcement']).order('created_at', { ascending: false }).limit(20);
  const retail = S.stores.filter(s => s.channel === 'retail' && s.active);
  el.innerHTML = `<div class="card"><h2>Build a one-off campaign</h2>
    <div class="row"><label style="margin:0;color:var(--ink)"><input type="radio" name="cType" value="offer" checked> <b>Marketing</b>: an offer or promotion (10% held back to measure, counts towards the 2-a-month limit)</label></div>
    <div class="row"><label style="margin:0;color:var(--ink)"><input type="radio" name="cType" value="announcement"> <b>Customer announcement</b>: news for customers, e.g. Christmas hours, a price change, a new service (goes to everyone selected, nobody held back, doesn't count as marketing; opt-outs are still never texted)</label></div>
    <label>Name</label><input id="cName" style="width:100%" placeholder="e.g. Christmas opening hours">
    <label>Message <span class="note" id="cCnt"></span></label><textarea id="cBody" placeholder="Hi {first_name}, …  {store} is the customer's store. The opt-out line is added automatically."></textarea>
    <div class="row" style="margin-top:6px">
      <div><label>Stores</label>${retail.map(s => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cSt" value="${s.id}"> ${esc(s.name)}</label>`).join('')}</div></div>
    <div class="row"><div><label>Tiers</label>${['VIP', 'Regular', 'Casual', 'Lapsed'].map(t => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cTi" value="${t}"> ${t}</label>`).join('')}</div>
      <div><label>Surnames</label>${['A-F', 'G-L', 'M-R', 'S-Z'].map(t => `<label style="display:inline-block;margin-right:8px;color:var(--ink)"><input type="checkbox" class="cQu" value="${t}"> ${t}</label>`).join('')}</div>
      <div><label>Last order within (days)</label><input id="cMax" type="number" value="365" style="width:90px"></div>
      <div><label>Average ticket under $</label><input id="cAvgMax" type="number" placeholder="any" style="width:90px"></div>
      <div><label>Average ticket $ or more</label><input id="cAvgMin" type="number" placeholder="any" style="width:90px"></div>
      <div><label>At most</label><input id="cLim" type="number" placeholder="no limit" style="width:100px"></div></div>
    <div class="row" style="margin-top:6px">${[['cUse', 'Has used any of'], ['cNever', 'Has never used'], ['cOnly', 'Uses only']].map(([k, l]) => `<div><label>${l}</label><select id="${k}" multiple size="4" style="min-width:190px">${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}">${n}</option>`).join('')}</select></div>`).join('')}
      <div><label>Service history to look at (days)</label><input id="cSvcDays" type="number" value="365" style="width:90px">
        <label>This campaign promotes</label><select id="cTag"><option value="">no one service</option>${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}">${n}</option>`).join('')}</select></div></div>
    <p class="note">Service boxes: hold Ctrl to pick more than one. Any service filter leaves out customers with no service history in that window. "Promotes" tags every text with that service, and skips anyone offered it in the last ${S.sms?.service_repeat_days ?? 350} days.</p>
    <div id="cMix"></div>
    <div class="row" style="margin-top:10px"><button class="btn ghost" id="cPrev">Preview</button><button class="btn" id="cMake">Create for approval</button><span id="cMsg" class="note"></span></div>
    <p class="note">Blank boxes mean everyone. Average ticket is the customer's spend per order over the last 12 months (lifetime if they haven't ordered this year). Account customers, opt-outs, do-not-contact and anyone already at 2 marketing texts this month are left out. 10% are held back to measure results.</p></div>
  <div class="card"><h2>Campaigns</h2><div class="scroll"><table><tr><th>Created</th><th>Name</th><th>Message</th><th>Status</th><th></th></tr>
    ${(camps || []).map(c => `<tr><td>${new Date(c.created_at).toLocaleDateString('en-AU')}</td><td>${esc(c.name)}${c.kind === 'announcement' ? ' <span class="chip">announcement</span>' : ''}${c.starts_on ? `<div class="mu" style="font-size:12px">goes out ${fmtD(c.starts_on)}${c.program_id ? ' · yearly' : ''}</div>` : ''}</td><td style="white-space:normal;text-align:left;max-width:380px">${esc(c.body || '')}</td><td>${statusChip(c.status)}</td>
      <td>${c.status === 'draft' ? `<button class="btn" style="padding:2px 8px" data-ok="${c.id}">Approve and send</button> ` : ''}${['draft', 'approved'].includes(c.status) ? `<button class="btn ghost" style="padding:2px 8px" data-x="${c.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mu">None yet</td></tr>'}</table></div></div>`;
  const isAnn = () => el.querySelector('input[name="cType"]:checked').value === 'announcement';
  const filt = () => ({ ...(isAnn() ? { announcement: true } : {}), stores: [...el.querySelectorAll('.cSt:checked')].map(x => x.value), tiers: [...el.querySelectorAll('.cTi:checked')].map(x => x.value), quadrants: [...el.querySelectorAll('.cQu:checked')].map(x => x.value), max_days: +$('#cMax').value || 365, ...($('#cLim').value ? { limit: +$('#cLim').value } : {}), ...($('#cAvgMax').value ? { max_avg_ticket: +$('#cAvgMax').value } : {}), ...($('#cAvgMin').value ? { min_avg_ticket: +$('#cAvgMin').value } : {}), ...svcFilt() });
  const pick = id => [...$('#' + id).selectedOptions].map(o => o.value);
  const svcFilt = () => { const o = {}, u = pick('cUse'), nv = pick('cNever'), on = pick('cOnly');
    if (u.length) o.uses = u; if (nv.length) o.never_uses = nv; if (on.length) o.only_uses = on;
    if (u.length || nv.length || on.length) o.service_days = +$('#cSvcDays').value || 365;
    if ($('#cTag').value) o.service_tag = $('#cTag').value; return o; };
  serviceMixCard($('#cMix'));
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
  const rr = (res || []).map(r => { const a = r.sent ? r.sent_sales / r.sent : 0, h = r.held ? r.held_sales / r.held : 0, inc = r.held >= 20 ? (a - h) * r.sent : null;
    return { ...r, perSent: a, perHeld: h, inc, roi: inc != null && r.cost > 0 ? inc / r.cost : null }; });
  const tot = rr.reduce((t, r) => ({ sent: t.sent + r.sent, sales: t.sales + +r.sent_sales, cost: t.cost + +r.cost, red: t.red + +r.sent_redeemed, inc: t.inc + (r.inc || 0), disc: t.disc + +r.discount_given }), { sent: 0, sales: 0, cost: 0, red: 0, inc: 0, disc: 0 });
  const pc = (x, n) => n ? (x / n * 100).toFixed(1) + '%' : '–';
  el.innerHTML = `<div class="card"><h2>Did it work? <small>last 180 days · each text against the customers held back from it</small></h2>
    <div class="grid g4" style="margin-bottom:10px">
      <div class="tile"><div class="l">Texts sent</div><div class="v">${num(tot.sent)}</div><div class="d">${money(tot.cost, 2)} in SMS</div></div>
      <div class="tile"><div class="l">Sales that followed</div><div class="v">${money(tot.sales)}</div><div class="d">orders inside each text's window</div></div>
      <div class="tile"><div class="l">Extra sales the texts caused</div><div class="v">${money(tot.inc)}</div><div class="d">above what the held-back group spent</div></div>
      <div class="tile"><div class="l">Offer discounts redeemed</div><div class="v">${num(tot.red)}</div><div class="d">${money(tot.disc, 2)} given away</div></div></div>
    <div class="scroll"><table>
    <tr><th>Message</th><th>Sent</th><th>Ordered</th><th>Redeemed offer</th><th>Held back</th><th>Held back ordered</th><th>Sales per text</th><th>Sales per held back</th><th>Extra sales</th><th>SMS cost</th><th>Discount given</th><th>Return per $1 of SMS</th></tr>
    ${rr.map(r => `<tr><td>${esc(r.template_key || r.category)}<div class="mu" style="font-size:12px">from ${fmtD(String(r.first_at).slice(0, 10))}</div></td><td>${num(r.sent)}</td><td>${pc(r.sent_ordered, r.sent)}</td><td>${pc(r.sent_redeemed, r.sent)}</td>
      <td>${num(r.held)}</td><td>${pc(r.held_ordered, r.held)}</td><td>${money(r.perSent, 2)}</td><td>${r.held ? money(r.perHeld, 2) : '–'}</td>
      <td>${r.inc == null ? '<span class="mu">too few held back</span>' : `<span class="${r.inc >= 0 ? 'up' : 'dn'}">${money(r.inc)}</span>`}</td><td>${money(r.cost, 2)}</td><td>${money(r.discount_given, 2)}</td>
      <td>${r.roi == null ? '–' : `<b>${money(r.roi, 2)}</b>`}</td></tr>`).join('') || '<tr><td colspan="12" class="mu">Nothing sent yet</td></tr>'}
  </table></div><p class="note"><b>How it's worked out.</b> Each text is credited with the customer's orders inside its window (14 days for offers, 21 for win-backs, 28 for welcomes, 7 for collection reminders), or until their next text, so no sale is counted twice. "Redeemed offer" means a discount set up as Marketing in Admin › Discounts was used on one of those orders. "Extra sales" is sales per text minus sales per held-back customer, times texts sent: the honest number, because the held-back customers show what would have happened anyway. It needs 20+ held back before it's shown. Sales include GST; take off discounts given and the cost of the work for margin.</p></div>
  <div class="card" id="discUse"></div>
  <div class="card"><h2>Waiting to go</h2><div class="scroll"><table><tr><th>When</th><th>Type</th><th>Messages</th></tr>
    ${Object.entries(qb).map(([k, v]) => { const [d, c] = k.split('|'); return `<tr><td>${esc(d)}</td><td>${esc(c)}</td><td>${num(v)}</td></tr>`; }).join('') || '<tr><td colspan="3" class="mu">Queue is empty</td></tr>'}</table></div></div>
  <div class="card"><h2>Latest activity</h2><div class="scroll"><table><tr><th>When</th><th>Type</th><th>Mobile</th><th>Status</th><th>Note</th></tr>
    ${(recent || []).map(r => `<tr><td>${new Date(r.sent_at || r.created_at).toLocaleString('en-AU')}</td><td>${esc(r.template_key || r.category)}</td><td>${r.customer_id ? `<a href="#/customer/${r.customer_id}">${esc(r.mobile)}</a>` : esc(r.mobile)}</td><td>${statusChip(r.status)}</td><td class="mu">${esc(r.error || '')}</td></tr>`).join('')}</table></div></div>`;
  discountUseCard($('#discUse'));
}
async function discountUseCard(el) {
  const to = iso(new Date()), from = addDays(to, -91);
  const { data: d } = await sb.rpc('discount_report', { p_org: S.org.id, p_from: from, p_to: to });
  if (!d || !d.by_discount.length) { el.innerHTML = '<h2>Discounts used</h2><p class="note">Upload the weekly Coupons and Discounts report to see which offers were redeemed, by whom and where.</p>'; return; }
  const purpose = Object.fromEntries(PURPOSES);
  const stores = [...new Set(d.by_store.map(x => x.store))], names = d.by_discount.map(x => x.name);
  const cellFor = (st, n) => { const x = d.by_store.find(y => y.store === st && y.name === n); return x ? `${num(x.orders)} · ${money(x.discount)}` : '<span class="mu">–</span>'; };
  el.innerHTML = `<h2>Discounts used <small>last 13 weeks loaded · orders paid</small></h2><div class="scroll"><table>
    <tr><th>POS discount</th><th>For</th><th>Orders</th><th>Customers</th><th>Off</th><th>Order value</th><th>Avg off</th><th>Customers texted in the 30 days before</th></tr>
    ${d.by_discount.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(purpose[x.purpose] || x.purpose)}</td><td>${num(x.orders)}</td><td>${num(x.customers)}${x.unmatched ? ` <span class="mu">(${num(x.unmatched)} orders not matched yet)</span>` : ''}</td>
      <td>${money(x.discount, 2)}</td><td>${money(x.sales, 2)}</td><td>${x.orders ? money(x.discount / x.orders, 2) : '–'}</td><td>${x.customers ? `${num(x.texted_customers)} (${(x.texted_customers / x.customers * 100).toFixed(0)}%)` : '–'}</td></tr>`).join('')}
  </table></div>
  <h3 style="margin-top:12px">By store <small>orders · $ off</small></h3><div class="scroll"><table><tr><th>POS discount</th>${stores.map(s => `<th>${esc(s)}</th>`).join('')}</tr>
    ${names.map(n => `<tr><td>${esc(n)}</td>${stores.map(st => `<td>${cellFor(st, n)}</td>`).join('')}</tr>`).join('')}</table></div>
  <p class="note">Orders are matched to customers through the Sales Incoming by service and order upload; older orders match as Huward's backfill lands. Set what each discount is for in Admin › Discounts.</p>`;
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
      <div><label>Marketing texts per customer per month</label><input id="sCap" type="number" value="${s.marketing_cap_per_month ?? 2}" style="width:80px"></div><div><label>Held back to measure (%)</label><input id="sCtl" type="number" value="${s.control_pct ?? 10}" style="width:80px"></div>
      <div><label>Referral credit each way ($)</label><input id="sRef" type="number" value="${s.referral_credit ?? 75}" style="width:80px"></div>
      <div><label>Days before the same service can be offered again</label><input id="sRep" type="number" value="${s.service_repeat_days ?? 350}" style="width:80px"></div>
      <div><label>Intro after the greeting (every text)</label><input id="sHead" value="${esc(s.header || '')}" style="width:300px" placeholder="David from Master Dry Cleaners here."></div>
      <div><label>Opt-out line</label><input id="sFoot" value="${esc(s.footer || '')}" style="width:220px"></div>
      <div><label>Marketing starts at drop-off number</label><input id="sVis" type="number" min="1" max="10" value="${s.marketing_min_visits ?? 3}" style="width:70px"></div>
      <div><label>…for customers who first came in within (days, 0 = everyone)</label><input id="sNew" type="number" min="0" value="${s.marketing_new_days ?? 120}" style="width:80px"></div>
      <div><label>Days between the six offer waves (0 = all at once)</label><input id="sWave" type="number" min="0" max="14" value="${s.offer_wave_days ?? 1}" style="width:80px"></div></div>
    <p class="note">Never on Sundays. ${money(s.cost_per_sms, 3)} per SMS part.</p>
    <div class="row"><button class="btn" id="sSave">Save</button><span id="sMsg" class="note"></span></div></div>`;
  $('#sMode').value = s.mode || 'off';
  $('#sSave').onclick = async () => {
    const mode = $('#sMode').value;
    if (mode === 'live' && s.mode !== 'live' && !confirm('Turn on live sending? Everything queued and due will start going to customers within 5 minutes (sending hours only).')) return;
    const { error } = await sb.from('sms_settings').update({ mode, test_mobile: $('#sTest').value.trim() || null, sender_id: $('#sSender').value.trim(), quiet_start: $('#sStart').value, quiet_end: $('#sEnd').value, marketing_cap_per_month: +$('#sCap').value, control_pct: +$('#sCtl').value, referral_credit: +$('#sRef').value || 0, service_repeat_days: +$('#sRep').value || 350, offer_wave_days: Math.max(0, Math.min(14, +$('#sWave').value || 0)), header: $('#sHead').value.trim(), marketing_min_visits: Math.max(1, +$('#sVis').value || 3), marketing_new_days: Math.max(0, +$('#sNew').value || 0), footer: $('#sFoot').value.trim() || 'Reply STOP to opt out.', updated_at: new Date().toISOString() }).eq('org_id', S.org.id);
    $('#sMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : 'Saved.'; if (!error) marketingView('settings');
  };
}

/* ---------- customer page extras: texts, referral code, do-not-contact ---------- */
async function customerMarketingCard(c) {
  if (!S.sms) S.sms = (await sb.from('sms_settings').select('*').eq('org_id', S.org.id).maybeSingle()).data;
  const credit = +(S.sms?.referral_credit ?? 75);
  const [{ data: texts }, { data: dnc }, { data: code }] = await Promise.all([
    sb.from('sms_sends').select('created_at,sent_at,template_key,category,status,body').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(20),
    sb.from('do_not_contact').select('reason').eq('customer_id', c.id).maybeSingle(),
    sb.rpc('referral_code', { p_customer: c.id })]);
  return `<div class="card"><h2>Marketing</h2>
    <p>Referral code <b>${esc(code || '')}</b> · ${dnc ? `<span class="dn">Do not contact</span> (${esc(dnc.reason || '')}) <button class="btn ghost" style="padding:2px 8px" id="dncOff">Remove</button>` : `<button class="btn ghost" style="padding:2px 8px" id="dncOn">Do not contact</button>`}</p>
    <div class="scroll"><table><tr><th>When</th><th>Message</th><th>Status</th></tr>
    ${(texts || []).map(t => `<tr><td>${new Date(t.sent_at || t.created_at).toLocaleDateString('en-AU')}</td><td style="white-space:normal;text-align:left">${esc(t.body)}</td><td>${statusChip(t.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="mu">No texts yet</td></tr>'}</table></div>
    <h2 style="margin-top:12px">Log a referral they made</h2>
    <div class="row"><input id="rName" placeholder="Friend's name"><input id="rMob" placeholder="Friend's mobile"><input id="rVal" type="number" placeholder="First order $" style="width:120px"><button class="btn ghost" id="rLog">Log (${money(credit)} each)</button><span id="rMsg" class="note"></span></div></div>`;
}
function wireCustomerMarketing(c) {
  const on = $('#dncOn'), off = $('#dncOff');
  if (on) on.onclick = async () => { const reason = prompt('Why? (e.g. asked not to be marketed to)'); if (reason == null) return; await sb.from('do_not_contact').insert({ org_id: S.org.id, customer_id: c.id, reason, logged_by: S.user.email }); customerView(c.id); };
  if (off) off.onclick = async () => { await sb.from('do_not_contact').delete().eq('org_id', S.org.id).eq('customer_id', c.id); customerView(c.id); };
  const r = $('#rLog'); if (r) r.onclick = async () => {
    const { data: code } = await sb.rpc('referral_code', { p_customer: c.id });
    const { error } = await sb.from('referrals').insert({ org_id: S.org.id, referrer_customer_id: c.id, code, referee_name: $('#rName').value.trim() || null, referee_mobile: $('#rMob').value.trim() || null, first_order_value: +$('#rVal').value || null, first_order_date: iso(new Date()), first_order_store: S.stores.find(s => s.id === c.store_id)?.name || null,
      referrer_credit: +(S.sms?.referral_credit ?? 75), referee_credit: +(S.sms?.referral_credit ?? 75), logged_by: S.user.id });
    $('#rMsg').innerHTML = error ? `<span class="err">${esc(error.message)}</span>` : `Logged. Apply ${money(S.sms?.referral_credit ?? 75)} credit to both in the POS.`;
  };
}

/* ---------- service mix: who uses what (from Sales Incoming by service and order) ---------- */
async function serviceMixCard(el) {
  const { data, error } = await sb.rpc('service_mix', { p_org: S.org.id, p_days: 365 });
  if (error) { el.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
  if (!data?.from) { el.innerHTML = '<p class="note">No service history yet. Upload Sales Incoming by service and order to build it.</p>'; return; }
  const st = [...new Set(data.rows.map(r => r.store_id))], sn = id => (S.stores.find(s => s.id === id)?.name || '').replace(/^Master Dry Cleaners\s*-\s*/i, '');
  const cell = (g, id) => { const rs = data.rows.filter(r => r.grp === g && (!id || r.store_id === id)); const u = rs.reduce((a, r) => a + r.used, 0), n = rs.reduce((a, r) => a + r.not_used, 0);
    return `<td>${num(u)} <span class="mu">/ ${num(n)}</span></td>`; };
  el.innerHTML = `<div class="card" style="margin:10px 0"><h2>Service mix <small>${num(data.profiles)} retail customers with orders ${fmtD(data.from)} to ${fmtD(data.to)}</small></h2><div class="scroll"><table>
    <tr><th>Service</th><th>All stores</th>${st.map(id => `<th>${esc(sn(id))}</th>`).join('')}</tr>
    ${Object.entries(SVC_GROUPS).map(([g, n]) => `<tr><td>${n}</td>${cell(g)}${st.map(id => cell(g, id)).join('')}</tr>`).join('')}
  </table></div><p class="note">Used / <span class="mu">never used</span>, counting only customers who appear in the service history. It means more as the history grows.</p></div>`;
}

/* ---------- discount checks: every discounted order against the rules for that discount ---------- */
const POS_RECEIPT = 'https://master.pos.mydrycleaning.com.au/api/v1.0/order/receipt/';
const FLAG_TXT = { full: '100% off', over_pct: 'bigger % than allowed', over_amount: 'more $ off than allowed', wrong_pct: 'not the set %',
  under_min: 'order under the minimum', recent_customer: 'customer ordered too recently', customer_unknown: 'customer not matched yet', added_later: 'added after drop-off' };
async function mkChecks(el, weeks = 4) {
  const to = iso(new Date()), from = addDays(to, -7 * weeks);
  const { data: d, error } = await sb.rpc('discount_checks', { p_org: S.org.id, p_from: from, p_to: to });
  if (error) { el.innerHTML = `<div class="card err">${esc(error.message)}</div>`; return; }
  if (!d?.periods?.length) { el.innerHTML = '<div class="card"><h2>Discount checks</h2><p class="note">Upload the weekly Coupons and Discounts report to start the checks.</p></div>'; return; }
  const flagged = d.flagged, serious = flagged.filter(f => f.flags.some(x => ['full', 'added_later', 'over_amount', 'over_pct', 'wrong_pct'].includes(x)));
  const cnt = k => flagged.filter(f => f.flags.includes(k)).length;
  const chips = f => f.flags.map(x => `<span class="chip" style="${['full', 'added_later'].includes(x) ? 'background:#fde2e1;color:#b42318' : x === 'customer_unknown' ? '' : 'background:#fff1d6;color:#8a5300'}">${FLAG_TXT[x] || x}</span>`).join(' ');
  const norm = Object.fromEntries(d.store_norms.map(s => [s.store, s.counter_avg_pct]));
  el.innerHTML = `<div class="card"><h2>Discount checks <small>discounted orders paid in the last <select id="ckW">${[1, 4, 13, 26].map(w => `<option ${w === weeks ? 'selected' : ''} value="${w}">${w} week${w > 1 ? 's' : ''}</option>`).join('')}</select> of loaded weeks</small></h2>
    <div class="grid g4" style="margin-bottom:10px">
      <div class="tile"><div class="l">100% off</div><div class="v ${cnt('full') ? 'dn' : ''}">${num(cnt('full'))}</div><div class="d">whole order free</div></div>
      <div class="tile"><div class="l">Added after drop-off</div><div class="v ${cnt('added_later') ? 'dn' : ''}">${num(cnt('added_later'))}</div><div class="d">discount bigger at payment than when the order came in</div></div>
      <div class="tile"><div class="l">Over the limit</div><div class="v">${num(flagged.filter(f => f.flags.some(x => ['over_pct', 'over_amount', 'wrong_pct'].includes(x))).length)}</div><div class="d">more % or $ than that discount allows</div></div>
      <div class="tile"><div class="l">SMS offer misused</div><div class="v">${num(flagged.filter(f => f.flags.some(x => ['under_min', 'recent_customer'].includes(x))).length)}</div><div class="d">under $30, or ordered in the last 60 days</div></div></div>
    <p class="note">Rules per discount are set in Admin › Discounts. "Added after drop-off" compares the discount when the order was taken (Sales Incoming by service and order) with the discount at payment (Coupons and Discounts); it can only see orders collected in a later week than they came in. Payment type (cash or card) isn't in these reports, so cash isn't shown.</p></div>

  <div class="card"><h2>By staff member <small>whose name is on the order</small></h2><div class="scroll"><table>
    <tr><th>Staff</th><th>Store</th><th>Orders taken</th><th>Discounted</th><th>$ off</th><th>Counter discounts</th><th>Avg counter %</th><th>Store avg %</th><th>Flagged</th><th>Still to check</th><th>Confirmed misuse</th><th>100% off</th><th>Added later</th></tr>
    ${d.by_employee.map(e => { const hi = e.counter_avg_pct != null && norm[e.store] != null && e.counter_avg_pct > norm[e.store] * 1.5;
      return `<tr><td><b>${esc(e.employee || '?')}</b></td><td>${esc(e.store)}</td><td>${e.orders_taken ? num(e.orders_taken) : '<span class="mu">–</span>'}</td><td>${num(e.discounted)}${e.orders_taken ? ` <span class="mu">(${(e.discounted / e.orders_taken * 100).toFixed(0)}%)</span>` : ''}</td>
      <td>${money(e.discount, 2)}</td><td>${num(e.counter_orders)} · ${money(e.counter_discount, 2)}</td><td class="${hi ? 'dn' : ''}">${e.counter_avg_pct == null ? '–' : e.counter_avg_pct + '%'}</td><td class="mu">${norm[e.store] == null ? '–' : norm[e.store] + '%'}</td>
      <td class="${e.flagged ? 'dn' : ''}">${num(e.flagged)}</td><td>${num(e.to_check)}</td><td class="${e.misuse ? 'dn' : ''}"><b>${num(e.misuse)}</b>${e.misuse ? ` · ${money(e.misuse_amount, 2)}` : ''}</td><td class="${e.full_off ? 'dn' : ''}">${num(e.full_off)}</td><td class="${e.added_later ? 'dn' : ''}">${num(e.added_later)}</td></tr>`; }).join('')}
  </table></div><p class="note">Red average: this person's counter discounts are 50% bigger than their store's average. "Orders taken" fills in from the Sales Incoming by service and order uploads.</p></div>

  <div class="card"><h2>Flagged orders <small>${num(flagged.length)} · ${num(serious.length)} serious</small></h2>
    <div class="row"><label style="margin:0"><input type="checkbox" id="ckSer"> Hide "customer not matched yet"</label>
      <label style="margin:0 0 0 14px"><input type="checkbox" id="ckOk" checked> Hide orders checked and OK</label></div>
    <div class="scroll"><table id="ckT"><tr><th>Order date</th><th>Store</th><th>Order</th><th>Discount</th><th>Off</th><th>Full price</th><th>%</th><th>Staff</th><th>Customer</th><th>Last order before</th><th>Why</th><th>What you found</th></tr>
    ${flagged.map((f, i) => `<tr data-only-unknown="${f.flags.length === 1 && f.flags[0] === 'customer_unknown' ? 1 : 0}" data-ok="${f.outcome === 'ok' ? 1 : 0}"><td>${fmtD(f.date)}</td><td>${esc(f.store)}</td>
      <td><a href="${POS_RECEIPT}${esc(f.receipt)}" target="_blank" rel="noopener" title="Open in My Clean POS">${esc(f.order_no || 'open')}</a></td><td>${esc(f.discount_name)}</td>
      <td>${money(f.discount, 2)}</td><td>${money(f.full_price, 2)}</td><td>${f.pct ?? '–'}%</td><td>${esc(f.employee || '')}</td>
      <td>${f.customer_id ? `<a href="#/customer/${f.customer_id}">${esc(f.customer || '')}</a>` : '<span class="mu">not matched</span>'}</td><td>${f.prev_order ? fmtD(f.prev_order) : '<span class="mu">–</span>'}</td><td>${chips(f)}</td>
      <td style="min-width:230px"><select data-rv="${i}"><option value="">Not checked</option>${[['checking', 'Checking'], ['ok', 'OK, allowed'], ['misuse', 'Misuse']].map(([v, n]) => `<option value="${v}" ${v === f.outcome ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <input data-rn="${i}" placeholder="note, e.g. what the trail showed" value="${esc(f.note || '')}" style="width:100%;margin-top:4px">
        ${f.reviewed_by ? `<div class="mu" style="font-size:11px">${esc(f.reviewed_by)} · ${new Date(f.reviewed_at).toLocaleDateString('en-AU')}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="12" class="mu">Nothing flagged</td></tr>'}
    </table></div><p class="note">The order number opens the order in My Clean POS (sign in there first) so you can read its trail: who added the discount and when. Record what you found; confirmed misuse is counted against the staff member above.</p></div>`;
  $('#ckW').onchange = () => mkChecks(el, +$('#ckW').value);
  const hide = () => el.querySelectorAll('#ckT tr[data-ok]').forEach(tr => tr.hidden = ($('#ckSer').checked && tr.dataset.onlyUnknown === '1') || ($('#ckOk').checked && tr.dataset.ok === '1'));
  $('#ckSer').onchange = hide; $('#ckOk').onchange = hide; hide();
  const saveRv = async i => { const f = flagged[i], outcome = el.querySelector(`[data-rv="${i}"]`).value, note = el.querySelector(`[data-rn="${i}"]`).value.trim();
    const q = outcome ? sb.from('discount_reviews').upsert({ org_id: S.org.id, receipt: f.receipt, discount_name: f.discount_name, outcome, note: note || null, reviewed_by: S.user.id, reviewed_email: S.user.email, reviewed_at: new Date().toISOString() })
      : sb.from('discount_reviews').delete().eq('receipt', f.receipt).eq('discount_name', f.discount_name);
    const { error } = await q; if (error) alert(error.message); };
  el.querySelectorAll('[data-rv]').forEach(x => x.onchange = () => saveRv(+x.dataset.rv));
  el.querySelectorAll('[data-rn]').forEach(x => x.onchange = () => { const sel = el.querySelector(`[data-rv="${x.dataset.rn}"]`); if (!sel.value) sel.value = 'checking'; saveRv(+x.dataset.rn); });
}

/* ---------- the weekly marketing results report (same as the Monday email) ---------- */
async function mkReport(el, week) {
  const weeks = []; { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 7) % 7 || 7)); for (let i = 0; i < 26; i++) { weeks.push(iso(d)); d.setDate(d.getDate() - 7); } }
  week = week || weeks[0];
  el.innerHTML = `<div class="card"><h2>Marketing results <small>week ending <select id="mrW">${weeks.map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>${fmtD(w)}</option>`).join('')}</select></small></h2>
    <p class="note">The same report goes out by email on Mondays when it's switched on in Admin › Monday reports. <button class="btn ghost" id="mrT">Email it to me</button> <span id="mrM"></span></p>
    <iframe id="mrF" style="width:100%;height:1500px;border:1px solid var(--line);border-radius:8px"></iframe></div>`;
  $('#mrW').onchange = () => mkReport(el, $('#mrW').value);
  const { data, error } = await sb.functions.invoke('store-reports', { body: { mode: 'preview', kind: 'marketing', org_id: S.org.id, week } });
  if (error || data?.error) { $('#mrM').innerHTML = `<span class="err">${esc(data?.error || error.message)}</span>`; return; }
  $('#mrF').srcdoc = data.html;
  $('#mrT').onclick = async () => { $('#mrM').textContent = 'Sending…';
    const { data: t, error: e } = await sb.functions.invoke('store-reports', { body: { mode: 'test', kind: 'marketing', org_id: S.org.id, week } });
    $('#mrM').innerHTML = e || t?.error ? `<span class="err">${esc(t?.error || e.message)}</span>` : `<span class="up">Sent to ${esc(t.to.join(', '))}.</span>`; };
}

/* ---------- yearly campaigns and service reminders ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function mkPrograms(el, openId) {
  const { data: progs } = await sb.from('marketing_programs').select('*').eq('org_id', S.org.id).order('kind').order('name');
  const row = p => `<tr><td><b>${esc(p.name)}</b><div class="mu" style="font-size:12px">${p.kind === 'yearly'
      ? `every ${p.start_day} ${MONTHS[p.start_month - 1]}, runs ${p.run_days} days, draft ${p.prepare_days} days ahead`
      : `${p.after_days} days after their last ${esc(SVC_GROUPS[p.service_grp] || p.service_grp)}${p.months?.length ? ', only in ' + p.months.map(x => MONTHS[x - 1]).join(' ') : ''}`}</div></td>
    <td style="white-space:normal;max-width:420px">${esc(p.body)}${p.note ? `<div class="mu" style="font-size:12px">${esc(p.note)}</div>` : ''}</td>
    <td><label style="margin:0"><input type="checkbox" data-on="${p.id}" ${p.enabled ? 'checked' : ''}> ${p.enabled ? 'On' : 'Off'}</label></td>
    <td style="white-space:nowrap"><button class="btn ghost" data-ed="${p.id}">Edit</button> <button class="btn ghost" data-pv="${p.id}">Check</button>${p.kind === 'yearly' ? ` <button class="btn ghost" data-now="${p.id}">Prepare now</button>` : ''}</td></tr>
    <tr><td colspan="4" id="pd-${p.id}" class="note" style="padding-top:0"></td></tr>`;
  el.innerHTML = `<div class="card"><h2>Yearly campaigns <small>same dates every year; a draft is made ahead for you to approve</small></h2>
    <div class="scroll"><table><tr><th>Campaign</th><th>Message</th><th>On</th><th></th></tr>${(progs || []).filter(p => p.kind === 'yearly').map(row).join('') || '<tr><td colspan="4" class="mu">None yet</td></tr>'}</table></div>
    <p class="note">When it's switched on, Hangr Ops builds this year's draft the set number of days before the start date and it waits under One-off campaigns for you to approve. Nothing goes until you do, and it goes out on its start date. {ends} becomes the end date.</p></div>
  <div class="card"><h2>Service reminders <small>an automated flow off each customer's own service history</small></h2>
    <div class="scroll"><table><tr><th>Reminder</th><th>Message</th><th>On</th><th></th></tr>${(progs || []).filter(p => p.kind === 'reminder').map(row).join('') || '<tr><td colspan="4" class="mu">None yet</td></tr>'}</table></div>
    <p class="note">Checked every morning with the other flows. A customer gets it once their last use of that service is the set number of days ago (and only in the chosen months), never twice within the repeat window. Switching it on is your approval of the wording. Reminders need the service history from Huward's Sales Incoming by service and order uploads, so they fill out as the backfill lands.</p></div>
  <div class="card"><h2>Add one</h2><div class="row"><button class="btn ghost" id="pAddY">New yearly campaign</button><button class="btn ghost" id="pAddR">New service reminder</button></div></div>
  <div class="card" id="pEdit" hidden></div>
  <p class="note">All of these use the same rules as everything else: 10% held back to measure, at most ${S.sms?.marketing_cap_per_month ?? 2} marketing texts a customer a month, ${S.sms?.flow_pause_days ?? 14} days clear of the six-offer waves, account customers, opt-outs and do-not-contact left out. Results show under Marketing › Report.</p>`;
  const msg = (id, t) => el.querySelector('#pd-' + id).innerHTML = t;
  el.querySelectorAll('[data-on]').forEach(x => x.onchange = async () => {
    if (x.checked && !confirm('Switch this on? That approves its wording to go to customers once Sending is live.')) { x.checked = false; return; }
    const { error } = await sb.rpc('program_switch', { p_program: x.dataset.on, p_on: x.checked }); if (error) alert(error.message); mkPrograms(el); });
  el.querySelectorAll('[data-pv]').forEach(b => b.onclick = async () => { msg(b.dataset.pv, 'Checking…');
    const { data: d, error } = await sb.rpc('program_preview', { p_program: b.dataset.pv });
    msg(b.dataset.pv, error ? `<span class="err">${esc(error.message)}</span>` : d.starts_on ? `Next start ${fmtD(d.starts_on)}: about ${num(d.audience)} customers, about ${money(d.est_cost)} of SMS after the hold-back.`
      : `Due today: ${num(d.due_now)} · in the next 30 days: ${num(d.next_30_days)} · customers with this service in their history: ${num(d.with_history)} (history to ${fmtD(d.history_to)}).`); });
  el.querySelectorAll('[data-now]').forEach(b => b.onclick = async () => {
    if (!confirm("Make this year's draft now? It will wait under One-off campaigns for approval.")) return;
    msg(b.dataset.now, 'Building…');
    const { data: d, error } = await sb.rpc('program_prepare_now', { p_program: b.dataset.now });
    msg(b.dataset.now, error ? `<span class="err">${esc(error.message)}</span>` : d.already ? 'This year\'s draft already exists: see One-off campaigns.' : `Draft made: ${num(d.messages)} messages for ${fmtD(d.starts_on)}. Approve it under One-off campaigns.`); });
  const edit = p => {
    const e = $('#pEdit'); e.hidden = false; const y = p.kind === 'yearly';
    e.innerHTML = `<h2>${p.id ? 'Edit' : 'New'} ${y ? 'yearly campaign' : 'service reminder'}</h2>
      <label>Name</label><input id="pN" value="${esc(p.name || '')}" style="width:100%">
      <label>Message</label><textarea id="pB" rows="3" style="width:100%">${esc(p.body || '')}</textarea>
      <p class="note">Use {first_name}, {store}${y ? ', {ends}' : ''}. Opt-out wording is added automatically. <span id="pLen"></span></p>
      ${y ? `<div class="row"><div><label>Starts (day / month)</label><input id="pD" type="number" min="1" max="28" value="${p.start_day || 1}" style="width:60px">
          <select id="pM">${MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === p.start_month ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div><label>Runs (days)</label><input id="pRun" type="number" value="${p.run_days || 21}" style="width:70px"></div>
          <div><label>Draft made (days ahead)</label><input id="pPrep" type="number" value="${p.prepare_days || 14}" style="width:70px"></div>
          <div><label>Customers who ordered in the last (days)</label><input id="pMax" type="number" value="${p.filters?.max_days ?? 730}" style="width:80px"></div></div>`
        : `<div class="row"><div><label>Watches</label><select id="pG">${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}" ${g === p.service_grp ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div><label>Days after last use</label><input id="pA" type="number" value="${p.after_days || 330}" style="width:70px"></div>
          <div><label>Not again within (days)</label><input id="pRp" type="number" value="${p.repeat_days || 300}" style="width:70px"></div>
          <div><label>Only in these months (blank = any)</label>${MONTHS.map((n, i) => `<label style="display:inline-block;margin-right:6px;color:var(--ink)"><input type="checkbox" class="pMo" value="${i + 1}" ${(p.months || []).includes(i + 1) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>`}
      <div class="row"><div><label>Promotes (for results and the repeat rule)</label><select id="pT"><option value="">no one service</option>${Object.entries(SVC_GROUPS).map(([g, n]) => `<option value="${g}" ${g === p.service_tag ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div><label>POS discount staff use for it</label><input id="pPos" value="${esc(p.pos_discount || '')}" placeholder="e.g. Offer – Curtains 15%"></div></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="pSave">Save</button><button class="btn ghost" id="pCancel">Close</button>${p.id ? '<button class="btn ghost" id="pDel" style="margin-left:auto">Delete</button>' : ''}<span id="pMsg" class="note"></span></div>
      ${p.enabled ? '<p class="note">Saving switches it off again so you can re-approve the new wording.</p>' : ''}`;
    const len = () => { const n = $('#pB').value.length + 30; $('#pLen').textContent = `About ${n} characters with the opt-out: ${n <= 160 ? '1 text' : Math.ceil(n / 153) + ' texts each (costs more)'}.`; };
    $('#pB').oninput = len; len();
    $('#pCancel').onclick = () => { e.hidden = true; };
    if ($('#pDel')) $('#pDel').onclick = async () => { if (!confirm('Delete this?')) return; await sb.from('marketing_programs').delete().eq('id', p.id); mkPrograms(el); };
    $('#pSave').onclick = async () => {
      const rec = { org_id: S.org.id, kind: p.kind, name: $('#pN').value.trim(), body: $('#pB').value.trim(), service_tag: $('#pT').value || null, pos_discount: $('#pPos').value.trim() || null,
        enabled: false, approved_by: null, approved_at: null, updated_at: new Date().toISOString() };
      if (!rec.name || !rec.body) { $('#pMsg').innerHTML = '<span class="err">Give it a name and a message.</span>'; return; }
      if (y) Object.assign(rec, { start_day: +$('#pD').value || 1, start_month: +$('#pM').value, run_days: +$('#pRun').value || 21, prepare_days: +$('#pPrep').value || 14, filters: { ...(p.filters || {}), max_days: +$('#pMax').value || 730 } });
      else Object.assign(rec, { service_grp: $('#pG').value, after_days: +$('#pA').value || 330, repeat_days: +$('#pRp').value || 300, months: [...el.querySelectorAll('.pMo:checked')].map(x => +x.value) });
      const { error } = p.id ? await sb.from('marketing_programs').update(rec).eq('id', p.id) : await sb.from('marketing_programs').insert(rec);
      if (error) $('#pMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; else mkPrograms(el);
    };
    e.scrollIntoView({ behavior: 'smooth' });
  };
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => edit(progs.find(p => p.id === b.dataset.ed)));
  $('#pAddY').onclick = () => edit({ kind: 'yearly', filters: { max_days: 730 } });
  $('#pAddR').onclick = () => edit({ kind: 'reminder', filters: {} });
}

/* ---------- test texts: send any wording to any mobile, exactly as a customer would get it ---------- */
async function mkTest(el) {
  const { data: cat } = await sb.rpc('message_catalogue', { p_org: S.org.id });
  const groups = [...new Set((cat || []).map(x => x.grp))];
  const retail = S.stores.filter(s => s.channel === 'retail' && s.active);
  const { data: recent } = await sb.from('sms_sends').select('created_at,sent_at,mobile,status,error,body').eq('org_id', S.org.id).eq('category', 'test').order('created_at', { ascending: false }).limit(10);
  el.innerHTML = `<div class="card"><h2>Send a test text <small>see exactly what a customer would get</small></h2>
    <label>Start from a message (or just type below)</label>
    <select id="tPick" style="width:100%"><option value="">Choose a message…</option>${groups.map(g => `<optgroup label="${esc(g)}">${(cat || []).filter(x => x.grp === g).map((x, i) => `<option value="${esc(x.body)}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
    <label>Message</label><textarea id="tBody" rows="4" style="width:100%" placeholder="Hi {first_name}, …"></textarea>
    <div class="row"><div><label>Pretend the customer is called</label><input id="tName" value="Jen" style="width:120px"></div>
      <div><label>at store</label><select id="tStore">${retail.map(s => `<option>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label>Send to mobile</label><input id="tMob" value="${esc(S.sms?.test_mobile || '')}" placeholder="04xx xxx xxx" style="width:150px"></div>
      <div style="align-self:flex-end"><button class="btn" id="tGo">Send test</button></div></div>
    <p class="note" id="tLen"></p><p id="tMsg"></p>
    <p class="note">{first_name}, {store}, {ends} (30 days from today), {code}, {review_url}, {ready_date} and {month} are filled in with sample values, and the opt-out line is added, so the length shown is the real one. Test texts go out within 5 minutes, between ${(S.sms?.quiet_start || '09:00').slice(0, 5)} and ${(S.sms?.quiet_end || '19:00').slice(0, 5)}, not on Sundays, even while Sending is in test mode. Up to 20 an hour.</p></div>
  <div class="card"><h2>Recent test texts</h2><div class="scroll"><table><tr><th>Sent</th><th>To</th><th>Status</th><th>Text</th></tr>
    ${(recent || []).map(r => `<tr><td>${new Date(r.sent_at || r.created_at).toLocaleString('en-AU')}</td><td>${esc(r.mobile)}</td><td>${statusChip(r.status)}${r.error ? ` <span class="mu">${esc(r.error)}</span>` : ''}</td><td style="white-space:normal;max-width:480px">${esc(r.body)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">None yet</td></tr>'}</table></div></div>`;
  const len = () => { const t = $('#tBody').value, n = t.length + FOOT.length; $('#tLen').textContent = t ? `About ${n} characters with the opt-out line (before names fill in): ${segs(t + FOOT)} text${segs(t + FOOT) > 1 ? 's' : ''} each.` : ''; };
  $('#tPick').onchange = () => { if ($('#tPick').value) { $('#tBody').value = $('#tPick').value; len(); } };
  $('#tBody').oninput = len;
  $('#tGo').onclick = async () => {
    $('#tMsg').textContent = 'Sending…';
    const { data, error } = await sb.rpc('send_test_sms', { p_org: S.org.id, p_mobile: $('#tMob').value, p_body: $('#tBody').value, p_first_name: $('#tName').value.trim() || 'Jen', p_store: $('#tStore').value });
    if (error) { $('#tMsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
    $('#tMsg').innerHTML = `<span class="up">Queued to ${esc(data.to)}${data.in_hours ? ', arriving within 5 minutes' : ', and it goes at the start of the next sending window'}.</span> ${data.length} characters, ${data.texts} text${data.texts > 1 ? 's' : ''}:<div class="card" style="margin-top:6px;white-space:pre-wrap">${esc(data.body)}</div>`;
  };
}

/* ---------- A/B wording tests: version A against version B ---------- */
async function abResults(el) {
  const { data } = await sb.rpc('offer_ab_results', { p_org: S.org.id });
  if (!data?.length) { el.innerHTML = '<h2>A/B wording tests</h2><p class="note">No tests sent yet. Add a version B to an offer above; results appear here once its cycle goes out.</p>'; return; }
  const key = r => `${r.cycle}|${r.slot}`, groups = [...new Set(data.map(key))];
  const pc = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '–';
  const verdict = (A, B) => {
    if (!A || !B || A.sent < 100 || B.sent < 100) return '<span class="mu">too early: needs 100+ texts each</span>';
    const pa = A.ordered / A.sent, pb = B.ordered / B.sent, p = (A.ordered + B.ordered) / (A.sent + B.sent);
    const z = Math.abs(pa - pb) / Math.sqrt(p * (1 - p) * (1 / A.sent + 1 / B.sent) || 1);
    const win = pb > pa ? 'B' : 'A';
    return z >= 1.96 ? `<b class="up">${win} wins</b> (${pc(Math.max(A.ordered / A.sent, B.ordered / B.sent) * 100, 100)} vs ${pc(Math.min(A.ordered / A.sent, B.ordered / B.sent) * 100, 100)} ordered)` : '<span class="mu">no clear winner yet</span>';
  };
  el.innerHTML = `<h2>A/B wording tests <small>version A against version B, each against the customers held back</small></h2><div class="scroll"><table>
    <tr><th>Cycle · offer</th><th>Testing</th><th>Version</th><th>Sent</th><th>Ordered</th><th>Redeemed</th><th>Sales per text</th><th>Opted out</th><th>Result</th></tr>
    ${groups.map(g => { const rows = data.filter(r => key(r) === g), A = rows.find(r => r.ab === 'A'), B = rows.find(r => r.ab === 'B'), f = rows[0];
      return rows.map((r, i) => `<tr><td>${i ? '' : `${esc(f.cycle)}<div class="mu" style="font-size:12px">${f.slot}. ${esc(f.offer || '')}</div>`}</td><td>${i ? '' : esc(f.ab_label || '')}</td><td><b>${r.ab}</b></td>
        <td>${num(r.sent)}</td><td>${pc(r.ordered, r.sent)}</td><td>${pc(r.redeemed, r.sent)}</td><td>${r.sent ? money(r.sales / r.sent, 2) : '–'}</td><td>${pc(r.opted_out, r.sent)}</td>
        <td>${i ? '' : verdict(A, B)}${i || !f.still_counting ? '' : '<div class="mu" style="font-size:12px">still counting</div>'}</td></tr>`).join(''); }).join('')}
  </table></div><p class="note">"Wins" means the gap in the share who ordered is bigger than chance would explain (95% confidence). Keep the winner as version A and test the next idea as B.</p>`;
}
