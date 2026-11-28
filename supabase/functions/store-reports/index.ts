// Monday store reports. One email per store for the week just finished, sent once the week's
// Sales Incoming by service and order and Customer Orders are both loaded and locked.
//   {mode:'cron', secret}            pg_cron every 15 min: sends what reports_due() says is due
//   {mode:'render', secret, store_id, week}  scheduler secret only: returns the HTML, sends nothing
//   {mode:'preview', store_id | kind:'marketing' + org_id, week} admin login: returns the email HTML
//   {mode:'test', store_id, week}    admin login: sends it to the logged-in admin only
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP = 'https://ops.hangr.au/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- formatting ----------
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const d = (s: string) => new Date(s + 'T00:00:00Z');
const dLong = (s: string) => { const x = d(s); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const dShort = (s: string) => { const x = d(s); return `${x.getUTCDate()} ${MON[x.getUTCMonth()].slice(0, 3)}`; };
const money = (n: number | null | undefined, dp = 2) => n == null ? '–' : (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (a: number, b: number | null | undefined) => (b ? (a / b - 1) * 100 : null);
const pctTxt = (p: number | null) => p == null ? '–' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const GREEN = '#1f7a3d', RED = '#b42318', INK = '#16202c', MUTE = '#5b6675', LINE = '#e3e7ec', BLUE = '#1f5fa0', GREY = '#b8c3cf';
const col = (p: number | null) => p == null ? MUTE : p >= 0 ? GREEN : RED;
const arrow = (p: number | null) => p == null ? '' : p >= 0 ? '▲' : '▼';
const chg = (a: number, b: number | null | undefined) => { const p = pct(a, b); if (b == null) return '<span style="color:' + MUTE + '">no figure</span>';
  return `<span style="color:${col(p)}">${arrow(p)} ${a - b >= 0 ? '+' : '−'}${money(Math.abs(a - b))} (${pctTxt(p)})</span>`; };
const cell = (s: string, extra = '') => `<td style="padding:7px 8px;border-bottom:1px solid ${LINE};${extra}">${s}</td>`;
const num = (s: string, extra = '') => cell(s, 'text-align:right;white-space:nowrap;' + extra);

type R = any;
function build(r: R, opts: { labour: boolean }) {
  const W = r.weeks as R[], cur = W[W.length - 1], prev = W[W.length - 2];
  const avgs = (r.prev_avg12 as number[]);
  // how many weeks running the 12-week average has moved the same way
  let run = 0; const up = avgs[avgs.length - 1] >= avgs[avgs.length - 2];
  for (let i = avgs.length - 1; i > 0; i--) { if ((avgs[i] >= avgs[i - 1]) === up) run++; else break; }
  const tot12 = W.reduce((t, w) => t + w.sales, 0), totLy = W.reduce((t, w) => t + (w.ly ?? 0), 0);
  const ahead = W.filter(w => w.ly != null && w.sales > w.ly).length, lyWeeks = W.filter(w => w.ly != null).length;
  const pW = pct(cur.sales, prev?.sales), pY = pct(cur.sales, cur.ly), pA = pct(cur.avg12, r.ly_avg12);
  const svc = (r.services as R[]).filter(s => s.sales != null);
  const movers = svc.filter(s => s.avg12 > 50).map(s => ({ ...s, d: s.sales - s.avg12 })).sort((a, b) => b.d - a.d);
  const lift = movers[0], drop = movers[movers.length - 1];
  const c = r.customers || {}, a = r.accounts, lab = opts.labour ? r.labour : null;
  // wages against ex-GST sales (the sales shown stay GST inclusive, as the POS reports them)
  // a store carrying another's sales for labour (Route under Albert Park) uses the combined sales
  // (labour sales also leave out work we don't do ourselves, e.g. Shoe Repairs)
  const labS = lab?.sales != null ? lab.sales : cur.sales, labS12 = lab?.sales12 != null ? lab.sales12 : cur.avg12;
  const wage = lab ? lab.cost / (labS / 1.1) * 100 : null, wage12 = lab ? lab.cost12 / (labS12 / 1.1) * 100 : null;

  const insight: [string, string][] = [
    ['Week on week', `${money(cur.sales)}, ${pW! >= 0 ? 'up' : 'down'} ${money(Math.abs(cur.sales - prev.sales))} (${pctTxt(pW)}) on last week's ${money(prev.sales)}.`],
    ['Same week last year', cur.ly == null ? 'No figure for the same week last year.' : `${pY! >= 0 ? 'Up' : 'Down'} ${money(Math.abs(cur.sales - cur.ly))} (${pctTxt(pY)}) on ${money(cur.ly)} in the week ending ${dShort(r.ly_week_end)} ${d(r.ly_week_end).getUTCFullYear()}.`],
    ['12-week average', `${money(cur.avg12)}, ${pA! >= 0 ? 'up' : 'down'} ${Math.abs(pA ?? 0).toFixed(1)}% on last year's ${money(r.ly_avg12)}, and ${up ? 'rising' : 'falling'} for ${run} week${run === 1 ? '' : 's'} in a row.`],
    ['Last 12 weeks', `Ahead of last year in ${ahead} of ${lyWeeks} weeks; ${money(tot12)} against ${money(totLy)} (${pctTxt(pct(tot12, totLy))}).`],
    ['Discounts', `${money(cur.disc)} (${(cur.disc / (cur.sales + cur.disc) * 100).toFixed(1)}% of full price), against a 12-week average of ${money(cur.disc12)}${cur.disc > cur.disc12 * 1.5 ? '. <b>Well above normal: worth a look.</b>' : '.'}`],
  ];
  if (lift && drop && lift !== drop) insight.push(['Services', `${esc(lift.service)} had the biggest lift on its 12-week average (${lift.d >= 0 ? '+' : '−'}${money(Math.abs(lift.d))}); ${esc(drop.service)} the biggest drop (${drop.d >= 0 ? '+' : '−'}${money(Math.abs(drop.d))}).`]);
  if (c.orders) insight.push(['Customers', `${c.customers} customers placed ${c.orders} orders. ${c.new} were new, and ${c.returning_lapsed} came back after six months or more away.`]);
  if (a && a.account_sales > 0) insight.push(['On account', `${money(a.account_sales)} of the week was account work${a.top?.length ? ` (${a.top.slice(0, 3).map((t: R) => `${esc(t.name)} ${money(t.sales, 0)}`).join(', ')})` : ''}; walk-in customers ${money(a.walkin_sales)}.`]);
  if (lab) insight.push(['Counter wages', `${money(lab.cost)} for ${lab.hours} hours, ${wage!.toFixed(1)}% of sales ex GST${lab.with ? ` with ${esc(lab.with)}` : ''} (12-week ${wage12!.toFixed(1)}%).`]);

  const tile = (label: string, big: string, sub: string) => `<td valign="top" style="width:50%;padding:6px"><div style="border:1px solid ${LINE};border-radius:10px;padding:14px">
    <div style="color:${MUTE};font-size:13px">${label}</div><div style="font-size:24px;font-weight:700;color:${INK};margin:4px 0">${big}</div><div style="font-size:13px">${sub}</div></div></td>`;
  const tiles = [
    tile('vs the same week last year', pctTxt(pY), `${chg(cur.sales, cur.ly)}<br><span style="color:${MUTE}">Last year ${money(cur.ly)}</span>`),
    tile('12-week average', money(cur.avg12), `${chg(cur.avg12, r.ly_avg12)} vs last year<br><span style="color:${up ? GREEN : RED}">${up ? '▲ Rising' : '▼ Falling'} ${run} week${run === 1 ? '' : 's'} running</span>`),
    tile('Discounts this week', money(cur.disc), `<span style="color:${MUTE}">12-week average ${money(cur.disc12)}</span>`),
    lab ? tile('Counter wages', `${wage!.toFixed(1)}%`, `<span style="color:${MUTE}">${money(lab.cost)} · ${lab.hours} hrs · 12-week ${wage12!.toFixed(1)}%</span>`)
        : c.orders ? tile('Customers this week', String(c.customers), `<span style="color:${MUTE}">${c.orders} orders · ${c.new} new · ${c.returning_lapsed} back after 6+ months</span>`) : '<td></td>',
  ];

  const stores = (r.all_stores as R[]).filter(s => s.sales != null);
  const sum = (k: string) => stores.reduce((t, s) => t + (s[k] ?? 0), 0);
  const storeRow = (s: R, bold = false) => `<tr style="${bold ? 'font-weight:700' : s.store === r.store ? 'background:#f1f6fb' : ''}">${cell(esc(s.store))}${num(money(s.sales))}
    ${num(pctTxt(pct(s.sales, s.lw)), `color:${col(pct(s.sales, s.lw))}`)}${num(pctTxt(pct(s.sales, s.ly)), `color:${col(pct(s.sales, s.ly))}`)}${num(money(s.avg12))}${num(pctTxt(pct(s.avg12, s.avg12_ly)), `color:${col(pct(s.avg12, s.avg12_ly))}`)}</tr>`;

  const maxW = Math.max(...W.map(w => Math.max(w.sales, w.ly ?? 0)));
  const bar = (v: number | null, colr: string) => v == null ? '' : `<table cellpadding="0" cellspacing="0" style="width:${Math.max(1, Math.round(v / maxW * 100))}%"><tr><td style="background:${colr};height:7px;line-height:7px;font-size:1px">&nbsp;</td></tr></table>`;
  const weekRows = W.map((w, i) => { const aUp = i === 0 ? avgs[avgs.length - 13] <= w.avg12 : W[i - 1].avg12 <= w.avg12, p = pct(w.sales, w.ly);
    return `<tr style="${i === W.length - 1 ? 'background:#f1f6fb;font-weight:600' : ''}">${cell(dShort(w.we), 'white-space:nowrap')}${num(money(w.sales))}
      ${cell(bar(w.sales, BLUE) + '<div style="height:2px"></div>' + bar(w.ly, GREY), 'width:28%')}${num(money(w.disc))}
      ${num(`<span style="color:${aUp ? GREEN : RED}">${aUp ? '▲' : '▼'}</span> ${money(w.avg12)}`)}${num(money(w.ly))}${num(pctTxt(p), `color:${col(p)}`)}</tr>`; }).join('');

  const svcTot = svc.reduce((t, s) => t + s.sales, 0), top = svc.slice(0, 10), rest = svc.slice(10);
  const svcRow = (s: R) => { const p = pct(s.sales, s.avg12); return `<tr>${cell(esc(s.service))}${num(money(s.sales))}${num(pctTxt(p), `color:${col(p)}`)}${num(String(s.pieces ?? ''))}${num(s.pieces ? money(s.sales / s.pieces) : '–')}${num(svcTot ? (s.sales / svcTot * 100).toFixed(1) + '%' : '')}</tr>`; };
  const restRow = rest.length ? `<tr>${cell(`${rest.length} smaller services`)}${num(money(rest.reduce((t, s) => t + s.sales, 0)))}${num('')}${num(String(rest.reduce((t, s) => t + (s.pieces || 0), 0)))}${num('')}${num((rest.reduce((t, s) => t + s.sales, 0) / svcTot * 100).toFixed(1) + '%')}</tr>` : '';

  const h2 = (t: string, sub = '') => `<div style="font-size:17px;font-weight:700;color:${INK};margin:26px 0 2px">${t}</div>${sub ? `<div style="color:${MUTE};font-size:13px;margin-bottom:8px">${sub}</div>` : ''}`;
  const th = (t: string, right = true) => `<th style="text-align:${right ? 'right' : 'left'};padding:7px 8px;border-bottom:2px solid ${LINE};color:${MUTE};font-weight:600;font-size:12px;white-space:nowrap">${t}</th>`;
  const table = (head: string, body: string) => `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;color:${INK}"><tr>${head}</tr>${body}</table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f8"><div style="max-width:720px;margin:0 auto;background:#fff;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK}">
  <table style="width:100%"><tr><td><div style="letter-spacing:1.5px;font-size:12px;color:${MUTE}">MASTER DRY CLEANERS</div><div style="font-size:22px;font-weight:700">Weekly sales · ${esc(r.store)}</div></td>
  <td style="text-align:right;font-size:13px;color:${MUTE}">Week ending<br><b style="color:${INK}">Sunday ${dLong(r.week_end)}</b></td></tr></table>
  <div style="border:1px solid ${LINE};border-radius:12px;padding:18px;margin-top:16px"><div style="color:${MUTE};font-size:14px">${esc(r.store)} — sales this week</div>
    <div style="font-size:40px;font-weight:700;margin:4px 0">${money(cur.sales)}</div><div style="font-size:14px">${chg(cur.sales, prev.sales)} vs last week</div></div>
  <table style="width:100%;margin:6px -6px 0" cellpadding="0" cellspacing="0"><tr>${tiles[0]}${tiles[1]}</tr><tr>${tiles[2]}${tiles[3]}</tr></table>
  ${h2('Key points', `${esc(r.store)} · week ending ${dShort(r.week_end)} ${d(r.week_end).getUTCFullYear()}`)}
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${insight.map(([k, v]) => `<tr><td valign="top" style="padding:9px 10px 9px 0;border-bottom:1px solid ${LINE};font-weight:600;width:150px">${k}</td><td style="padding:9px 0;border-bottom:1px solid ${LINE};color:#33404f">${v}</td></tr>`).join('')}</table>
  ${h2('Stores this week')}
  ${table(th('Store', false) + th('Sales') + th('vs last week') + th('vs last year') + th('12-week avg') + th('Avg vs last year'),
    stores.map(s => storeRow(s)).join('') + storeRow({ store: 'All stores', sales: sum('sales'), lw: sum('lw'), ly: sum('ly'), avg12: sum('avg12'), avg12_ly: sum('avg12_ly') }, true))}
  ${h2('Last 12 weeks', `<span style="color:${BLUE}">■</span> this year &nbsp; <span style="color:${GREY}">■</span> same week last year · ▲▼ the 12-week average up or down on the week before`)}
  ${table(th('Week ending', false) + th('Sales') + th('', false) + th('Discounts') + th('12-week avg') + th('Last year') + th('vs last year'),
    weekRows + `<tr style="font-weight:700">${cell('Total')}${num(money(tot12))}${cell('')}${num(money(W.reduce((t, w) => t + w.disc, 0)))}${cell('')}${num(money(totLy))}${num(pctTxt(pct(tot12, totLy)), `color:${col(pct(tot12, totLy))}`)}</tr>`)}
  ${h2('Services this week', 'Against each service’s own average over the last 12 weeks')}
  ${table(th('Service', false) + th('Sales') + th('vs 12-wk avg') + th('Pieces') + th('Per piece') + th('Share'), top.map(svcRow).join('') + restRow
    + `<tr style="font-weight:700">${cell('All services')}${num(money(svcTot))}${num('')}${num(String(svc.reduce((t, s) => t + (s.pieces || 0), 0)))}${num('')}${num('100%')}</tr>`)}
  <p style="color:${MUTE};font-size:12px;margin-top:26px;line-height:1.5"><b>How the numbers work.</b> Sales are My Clean POS Sales Incoming for the store, Monday to Sunday, after discounts and including GST. The 12-week average is the last 12 weeks including this one. “Last year” is the same week 52 weeks earlier. Every change is measured against the earlier figure.${lab ? ' Counter wages are Employment Hero hours at each person’s cost per hour (wages and super), without WorkCover, as a share of sales ex GST, leaving out work sent out such as shoe repairs' + (lab.with ? `, counting ${esc(lab.with)} with this store (its sales and its driver)` : '') + '.' : ''} Figures are locked once loaded, so this report won’t change later.</p>
  <p style="font-size:13px"><a href="${APP}#/store/${esc(r.store_code || '')}/${r.week_end}" style="color:${BLUE}">Open ${esc(r.store)} in Hangr Ops</a></p>
  </div></body></html>`;
  const subject = `${r.store} weekly sales, w/e ${dShort(r.week_end)}: ${money(cur.sales, 0)} (${pctTxt(pW)} on last week, ${pctTxt(pY)} on last year)`;
  return { html, subject };
}

// ---------- marketing results: what was sent, what followed, and what the texts actually caused ----------
function buildMarketing(r: R) {
  const T4 = r.totals?.['4w'] || {}, T13 = r.totals?.['13w'] || {};
  const rate = (a: number, b: number) => b ? a / b : null;
  const pc = (x: number | null) => x == null ? '–' : (x * 100).toFixed(1) + '%';
  const extra = (x: R) => x.held >= 20 && x.sent ? (x.sales / x.sent - x.held_sales / x.held) * x.sent : null;
  const roi = (x: R) => { const e = extra(x); return e != null && x.cost > 0 ? e / x.cost : null; };
  const h2 = (t: string, sub = '') => `<div style="font-size:17px;font-weight:700;color:${INK};margin:26px 0 2px">${t}</div>${sub ? `<div style="color:${MUTE};font-size:13px;margin-bottom:8px">${sub}</div>` : ''}`;
  const th = (t: string, right = true) => `<th style="text-align:${right ? 'right' : 'left'};padding:7px 8px;border-bottom:2px solid ${LINE};color:${MUTE};font-weight:600;font-size:12px;white-space:nowrap">${t}</th>`;
  const table = (head: string, body: string) => `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;color:${INK}"><tr>${head}</tr>${body}</table>`;
  const tile = (label: string, big: string, sub: string) => `<td valign="top" style="width:50%;padding:6px"><div style="border:1px solid ${LINE};border-radius:10px;padding:14px">
    <div style="color:${MUTE};font-size:13px">${label}</div><div style="font-size:24px;font-weight:700;color:${INK};margin:4px 0">${big}</div><div style="font-size:13px;color:${MUTE}">${sub}</div></div></td>`;
  const e4 = extra(T4), r4 = roi(T4), live = r.sending?.mode === 'live';
  const lift = (a: number | null, b: number | null) => a == null || b == null ? '' : ` <span style="color:${col(a - b)}">(${a - b >= 0 ? '+' : '−'}${Math.abs((a - b) * 100).toFixed(1)} pts)</span>`;
  const tiles = [
    tile('Texts sent, last 4 weeks', String(T4.sent ?? 0), `${money(T4.cost ?? 0)} in SMS · ${T4.held ?? 0} held back to compare`),
    tile('Ordered after a text', pc(rate(T4.ordered ?? 0, T4.sent ?? 0)), `held back: ${pc(rate(T4.held_ordered ?? 0, T4.held ?? 0))}`),
    tile('Extra sales the texts caused', e4 == null ? '–' : money(e4, 0), e4 == null ? 'needs 20+ customers held back' : `above what the held-back customers spent${r4 != null ? ` · ${money(r4)} back per $1 of SMS` : ''}`),
    tile('Offer discounts redeemed', String(T4.redeemed ?? 0), `${money(T4.discount ?? 0)} given away`),
  ];
  const msgs = (r.messages as R[]) || [];
  const best = msgs.filter(m => extra(m) != null).sort((a, b) => (roi(b) ?? -1e9) - (roi(a) ?? -1e9))[0];
  const lapse = (r.lapse as R[]) || [];
  const topLapse = lapse.filter(l => l.sent >= 20).sort((a, b) => (rate(b.ordered, b.sent) ?? 0) - (rate(a.ordered, a.sent) ?? 0))[0];
  const points: [string, string][] = [];
  if (!T13.sent) points.push(['Texts', live ? 'No marketing texts in the last 13 weeks.' : 'Texts aren’t going out yet: sending is switched off or in test mode in Marketing › Sending. This report fills in once offers go out.']);
  else {
    points.push(['Last 4 weeks', `${T4.sent ?? 0} texts to ${T4.customers ?? 0} customers cost ${money(T4.cost ?? 0)}. ${T4.ordered ?? 0} of them ordered within the window (${pc(rate(T4.ordered ?? 0, T4.sent ?? 0))}), against ${pc(rate(T4.held_ordered ?? 0, T4.held ?? 0))} of the customers held back.`]);
    if (e4 != null) points.push(['What it caused', `${money(e4)} of sales above what would have happened anyway${r4 != null ? `, ${money(r4)} back for every $1 of SMS` : ''}. Discounts given on top: ${money(T4.discount ?? 0)}.`]);
    if (best) points.push(['Best message', `${esc(best.message)}: ${money(extra(best) ?? 0)} extra from ${best.sent} texts${roi(best) != null ? ` (${money(roi(best))} per $1)` : ''}.`]);
    if (topLapse) points.push(['Who responds', `${esc(topLapse.bucket)}: ${pc(rate(topLapse.ordered, topLapse.sent))} ordered after a text.`]);
    if (T13.still_counting) points.push(['Still counting', `${T13.still_counting} recent texts are still inside their window, so their results will grow.`]);
  }
  const mis = r.misuse || {};
  if (mis.flagged) points.push(['Discount checks', `${mis.flagged} discounted orders flagged in the last 4 weeks loaded, ${mis.to_check} still to check, ${mis.confirmed} confirmed misuse (${money(mis.confirmed_amount ?? 0)}).`]);

  const msgRow = (m: R) => { const e = extra(m), ro = roi(m), a = rate(m.ordered, m.sent), b = rate(m.held_ordered, m.held);
    return `<tr>${cell(`${esc(m.message)}<div style="color:${MUTE};font-size:11px">${dShort(m.first_sent)}${m.last_sent !== m.first_sent ? ' – ' + dShort(m.last_sent) : ''}${m.still_counting ? ' · still counting' : ''}</div>`)}
      ${num(String(m.sent))}${num(pc(a) + lift(a, b))}${num(pc(rate(m.redeemed, m.sent)))}${num(money(m.sent ? m.sales / m.sent : 0))}${num(m.held ? money(m.held_sales / m.held) : '–')}
      ${num(e == null ? '<span style="color:' + MUTE + '">too few held back</span>' : `<span style="color:${col(e)}">${money(e, 0)}</span>`)}${num(money(m.cost))}${num(money(m.discount))}${num(ro == null ? '–' : `<b>${money(ro)}</b>`)}</tr>`; };
  const storeRow = (s: R) => { const a = rate(s.ordered, s.sent), b = rate(s.held_ordered, s.held), e = extra(s);
    return `<tr>${cell(esc(s.store))}${num(String(s.sent))}${num(pc(a) + lift(a, b))}${num(money(s.sales, 0))}${num(String(s.redeemed))}${num(e == null ? '–' : `<span style="color:${col(e)}">${money(e, 0)}</span>`)}${num(money(s.cost))}</tr>`; };
  const lapseRow = (l: R) => { const a = rate(l.ordered, l.sent), b = rate(l.held_ordered, l.held);
    return `<tr>${cell(esc(l.bucket))}${num(String(l.sent))}${num(pc(a) + lift(a, b))}${num(money(l.sales, 0))}${num(l.ordered ? money(l.sales / l.ordered) : '–')}</tr>`; };
  const W = (r.weeks as R[]) || [], maxS = Math.max(1, ...W.map(w => w.sales));
  const bar = (v: number) => `<table cellpadding="0" cellspacing="0" style="width:${Math.max(1, Math.round(v / maxS * 100))}%"><tr><td style="background:${BLUE};height:7px;line-height:7px;font-size:1px">&nbsp;</td></tr></table>`;
  const D = (r.discounts as R[]) || [];
  const empty = (n: number, t: string) => `<tr><td colspan="${n}" style="padding:8px;color:${MUTE}">${t}</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f8"><div style="max-width:760px;margin:0 auto;background:#fff;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK}">
  <table style="width:100%"><tr><td><div style="letter-spacing:1.5px;font-size:12px;color:${MUTE}">${esc(String(r.org || '').toUpperCase())}</div><div style="font-size:22px;font-weight:700">Marketing results</div></td>
  <td style="text-align:right;font-size:13px;color:${MUTE}">Week ending<br><b style="color:${INK}">Sunday ${dLong(r.week_end)}</b></td></tr></table>
  ${live ? '' : `<div style="background:#fff7e6;border:1px solid #f3d19c;border-radius:10px;padding:10px 14px;margin-top:14px;font-size:13px">Sending is <b>${esc(r.sending?.mode || 'off')}</b>, so no offers are going to customers yet. Figures below are only what has already gone out.</div>`}
  <table style="width:100%;margin:10px -6px 0" cellpadding="0" cellspacing="0"><tr>${tiles[0]}${tiles[1]}</tr><tr>${tiles[2]}${tiles[3]}</tr></table>
  ${h2('Key points')}
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${points.map(([k, v]) => `<tr><td valign="top" style="padding:9px 10px 9px 0;border-bottom:1px solid ${LINE};font-weight:600;width:150px">${k}</td><td style="padding:9px 0;border-bottom:1px solid ${LINE};color:#33404f">${v}</td></tr>`).join('')}</table>
  ${h2('By message', 'Texts sent in the last 13 weeks · ordered against the customers held back from the same message')}
  ${table(th('Message', false) + th('Sent') + th('Ordered (vs held back)') + th('Redeemed') + th('Sales per text') + th('Per held back') + th('Extra sales') + th('SMS cost') + th('Discount') + th('Per $1 of SMS'),
    msgs.map(msgRow).join('') || empty(10, 'No texts in the last 13 weeks.'))}
  ${h2('By store', 'Last 13 weeks')}
  ${table(th('Store', false) + th('Sent') + th('Ordered (vs held back)') + th('Sales') + th('Redeemed') + th('Extra sales') + th('SMS cost'),
    ((r.stores as R[]) || []).map(storeRow).join('') || empty(7, 'No texts in the last 13 weeks.'))}
  ${h2('Who responds', 'By how long since the customer’s last order when the text went out')}
  ${table(th('Customer', false) + th('Sent') + th('Ordered (vs held back)') + th('Sales') + th('Per order'), lapse.map(lapseRow).join('') || empty(5, 'No texts in the last 13 weeks.'))}
  ${h2('Week by week', 'Texts sent each week and the sales that followed them')}
  ${table(th('Week ending', false) + th('Sent') + th('SMS cost') + th('Sales that followed') + th('', false) + th('Redeemed'),
    W.map(w => `<tr>${cell(dShort(w.we))}${num(String(w.sent))}${num(money(w.cost))}${num(money(w.sales, 0))}${cell(bar(w.sales), 'width:30%')}${num(String(w.redeemed))}</tr>`).join(''))}
  ${h2('Offer and loyalty discounts used', 'Coupons and Discounts report, last 4 weeks loaded · whether the customer had a text in the 30 days before')}
  ${table(th('POS discount', false) + th('Orders') + th('Customers') + th('$ off') + th('Order value') + th('Texted first'),
    D.map(x => `<tr>${cell(esc(x.name) + `<div style="color:${MUTE};font-size:11px">${esc(x.purpose)}</div>`)}${num(String(x.orders))}${num(String(x.customers))}${num(money(x.discount))}${num(money(x.sales, 0))}${num(x.customers ? `${x.texted} (${Math.round(x.texted / x.customers * 100)}%)` : '–')}</tr>`).join('') || empty(6, 'No offer or loyalty discounts loaded for these weeks yet.'))}
  <p style="color:${MUTE};font-size:12px;margin-top:26px;line-height:1.5"><b>How it’s worked out.</b> Each text is credited with the customer’s orders inside its window (14 days for offers, 21 for win-backs, 28 for welcomes, 7 for collection reminders) or until their next text, so no sale counts twice. ${r.sending?.control_pct ?? 10}% of customers are held back from each message and get nothing; they show what would have happened anyway. “Extra sales” is sales per text minus sales per held-back customer, times texts sent, shown once 20+ are held back. “Redeemed” means a discount marked Marketing in Admin › Discounts was used on one of those orders. Sales include GST and are before the cost of the work.</p>
  <p style="font-size:13px"><a href="${APP}#/marketing/results" style="color:${BLUE}">Open Marketing in Hangr Ops</a></p>
  </div></body></html>`;
  const subject = `Marketing results, w/e ${dShort(r.week_end)}: ${T4.sent ?? 0} texts, ${money(T4.sales ?? 0, 0)} followed${e4 != null ? `, ${money(e4, 0)} extra` : ''} (last 4 weeks)`;
  return { html, subject };
}

async function send(key: string, s: R, to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.from_address, to, reply_to: s.reply_to || undefined, subject, html }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `send failed (${res.status})`);
  return body.id as string;
}

// one report, either kind: a store's week or the org's marketing results
async function makeReport(client: R, svc: R, q: { kind?: string; store_id?: string; org_id?: string; week?: string | null; labour?: boolean }) {
  if (q.kind === 'marketing') {
    const { data: r, error } = await client.rpc('marketing_report', { p_org: q.org_id, p_week: q.week || null }); if (error) throw error;
    return { ...buildMarketing(r), week_end: r.week_end, org_id: q.org_id, store_id: null };
  }
  const { data: r, error } = await client.rpc('store_week_report', { p_store: q.store_id, p_week: q.week || null }); if (error) throw error;
  const { data: st } = await svc.from('stores').select('code,org_id').eq('id', q.store_id).single();
  return { ...build({ ...r, store_code: st?.code }, { labour: q.labour ?? true }), week_end: r.week_end, org_id: st?.org_id, store_id: q.store_id };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const svc = createClient(URL_, SRK);
  let p: R = {}; try { p = await req.json(); } catch { /* empty */ }
  try {
    if (p.mode === 'render') {  // the scheduler's secret only: the email HTML, nothing sent
      const { data: s } = await svc.rpc('report_settings_for', { p_secret: p.secret || '' });
      if (!s) return json({ error: 'not allowed' }, 401);
      const rep = await makeReport(svc, svc, p);
      return json({ html: rep.html, subject: rep.subject });
    }
    if (p.mode === 'cron') {
      const { data: s } = await svc.rpc('report_settings_for', { p_secret: p.secret || '' });
      if (!s) return json({ error: 'not allowed' }, 401);
      const { data: due, error } = await svc.rpc('reports_due'); if (error) throw error;
      const out = [];
      for (const d0 of due || []) {
        let rep: R;
        try { rep = await makeReport(svc, svc, { kind: d0.kind, store_id: d0.store_id, org_id: d0.org_id, week: d0.week_end, labour: d0.include_labour }); }
        catch (err) { out.push({ store: d0.store, error: String((err as Error).message || err) }); continue; }
        try {
          if (!s.resend_key) throw new Error('No Resend key set yet');
          const id = await send(s.resend_key, s, d0.recipients, rep.subject, rep.html);
          await svc.from('report_runs').insert({ schedule_id: d0.schedule_id, org_id: d0.org_id, store_id: d0.store_id, week_end: d0.week_end, status: 'sent', sent_to: d0.recipients, provider_id: id });
          out.push({ store: d0.store, sent: d0.recipients.length });
        } catch (err) {
          await svc.from('report_runs').insert({ schedule_id: d0.schedule_id, org_id: d0.org_id, store_id: d0.store_id, week_end: d0.week_end, status: 'failed', sent_to: d0.recipients, error: String((err as Error).message || err) });
          out.push({ store: d0.store, error: String((err as Error).message || err) });
        }
      }
      // Tuesday from noon: one note to David if any switched-on report is still waiting on uploads
      const { data: w } = await svc.rpc('reports_waiting');
      if (w?.length && s.resend_key) {
        const body = `<p>These Monday store reports for the week ending ${dLong(w[0].week_end)} haven't gone out, because the week's uploads aren't in yet:</p><ul>${w.map((x: R) => `<li>${esc(x.store)}: ${esc(x.missing)}</li>`).join('')}</ul><p>They'll send by themselves as soon as Huward's two files are loaded (until Wednesday). <a href="${APP}#/upload">Upload screen</a></p>`;
        const { error: le } = await svc.from('report_runs').insert({ org_id: w[0].org_id, store_id: w[0].store_id, week_end: w[0].week_end, kind: 'waiting', status: 'sent', sent_to: s.alert_to });
        if (!le) await send(s.resend_key, s, s.alert_to, `Store reports waiting on uploads, w/e ${dShort(w[0].week_end)}`, body);
      }
      return json({ ok: true, out });
    }
    // admin actions: the caller's own login decides what they can see
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await user.auth.getUser(); if (!u?.user) return json({ error: 'log in first' }, 401);
    const schQ = svc.from('report_schedules').select('id,include_labour');
    const { data: sch } = await (p.kind === 'marketing' ? schQ.eq('org_id', p.org_id).eq('kind', 'marketing') : schQ.eq('store_id', p.store_id)).maybeSingle();
    const rep = await makeReport(user, svc, { ...p, labour: p.labour ?? sch?.include_labour ?? true });
    if (p.mode === 'preview') return json({ html: rep.html, subject: rep.subject });
    if (p.mode === 'test') {
      const { data: s } = await svc.rpc('report_settings_service');
      if (!s?.resend_key) return json({ error: 'The sending key isn’t set up yet.' }, 400);
      const to = [u.user.email!];
      const id = await send(s.resend_key, s, to, '[Test] ' + rep.subject, rep.html);
      await svc.from('report_runs').insert({ schedule_id: sch?.id, org_id: rep.org_id, store_id: rep.store_id, week_end: rep.week_end, kind: 'test', status: 'sent', sent_to: to, provider_id: id });
      return json({ ok: true, to });
    }
    return json({ error: 'unknown mode' }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
