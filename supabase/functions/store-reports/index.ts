// Monday store reports. One email per store for the week just finished, sent once the week's
// Sales Incoming by service and order and Customer Orders are both loaded and locked.
//   {mode:'cron', secret}            pg_cron every 15 min: sends what reports_due() says is due
//   {mode:'render', secret, store_id, week}  scheduler secret only: returns the HTML, sends nothing
//   {mode:'preview', store_id, week} admin login: returns the email HTML
//   {mode:'test', store_id, week}    admin login: sends it to the logged-in admin only
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP = 'https://davidhudson84.github.io/hangr-ops/';
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
  const wage = lab ? lab.cost / cur.sales * 100 : null, wage12 = lab ? lab.cost12 / cur.avg12 * 100 : null;

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
  if (lab) insight.push(['Counter wages', `${money(lab.cost)} for ${lab.hours} hours, ${wage!.toFixed(1)}% of sales (12-week ${wage12!.toFixed(1)}%).`]);

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
  <p style="color:${MUTE};font-size:12px;margin-top:26px;line-height:1.5"><b>How the numbers work.</b> Sales are My Clean POS Sales Incoming for the store, Monday to Sunday, after discounts and including GST. The 12-week average is the last 12 weeks including this one. “Last year” is the same week 52 weeks earlier. Every change is measured against the earlier figure.${lab ? ' Counter wages are Employment Hero hours at each person’s cost per hour (wages and super), without WorkCover.' : ''} Figures are locked once loaded, so this report won’t change later.</p>
  <p style="font-size:13px"><a href="${APP}#/store/${esc(r.store_code || '')}/${r.week_end}" style="color:${BLUE}">Open ${esc(r.store)} in Hangr Ops</a></p>
  </div></body></html>`;
  const subject = `${r.store} weekly sales, w/e ${dShort(r.week_end)}: ${money(cur.sales, 0)} (${pctTxt(pW)} on last week, ${pctTxt(pY)} on last year)`;
  return { html, subject };
}

async function send(key: string, s: R, to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.from_address, to, reply_to: s.reply_to || undefined, subject, html }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `send failed (${res.status})`);
  return body.id as string;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const svc = createClient(URL_, SRK);
  let p: R = {}; try { p = await req.json(); } catch { /* empty */ }
  try {
    if (p.mode === 'render') {  // the scheduler's secret only: the email HTML for a store and week, nothing sent
      const { data: s } = await svc.rpc('report_settings_for', { p_secret: p.secret || '' });
      if (!s) return json({ error: 'not allowed' }, 401);
      const { data: r, error } = await svc.rpc('store_week_report', { p_store: p.store_id, p_week: p.week || null }); if (error) throw error;
      const { data: st } = await svc.from('stores').select('code').eq('id', p.store_id).single();
      return json(build({ ...r, store_code: st?.code }, { labour: p.labour ?? true }));
    }
    if (p.mode === 'cron') {
      const { data: s } = await svc.rpc('report_settings_for', { p_secret: p.secret || '' });
      if (!s) return json({ error: 'not allowed' }, 401);
      const { data: due, error } = await svc.rpc('reports_due'); if (error) throw error;
      const out = [];
      for (const d0 of due || []) {
        const { data: r, error: e } = await svc.rpc('store_week_report', { p_store: d0.store_id, p_week: d0.week_end }); if (e) throw e;
        const { data: st } = await svc.from('stores').select('code,org_id').eq('id', d0.store_id).single();
        const { html, subject } = build({ ...r, store_code: st?.code }, { labour: d0.include_labour });
        try {
          if (!s.resend_key) throw new Error('No Resend key set yet');
          const id = await send(s.resend_key, s, d0.recipients, subject, html);
          await svc.from('report_runs').insert({ schedule_id: d0.schedule_id, org_id: st!.org_id, store_id: d0.store_id, week_end: d0.week_end, status: 'sent', sent_to: d0.recipients, provider_id: id });
          out.push({ store: d0.store, sent: d0.recipients.length });
        } catch (err) {
          await svc.from('report_runs').insert({ schedule_id: d0.schedule_id, org_id: st!.org_id, store_id: d0.store_id, week_end: d0.week_end, status: 'failed', sent_to: d0.recipients, error: String((err as Error).message || err) });
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
    const { data: r, error } = await user.rpc('store_week_report', { p_store: p.store_id, p_week: p.week || null }); if (error) throw error;
    const { data: st } = await svc.from('stores').select('code,org_id').eq('id', p.store_id).single();
    const { data: sch } = await svc.from('report_schedules').select('id,include_labour').eq('store_id', p.store_id).maybeSingle();
    const { html, subject } = build({ ...r, store_code: st?.code }, { labour: p.labour ?? sch?.include_labour ?? true });
    if (p.mode === 'preview') return json({ html, subject });
    if (p.mode === 'test') {
      const { data: s } = await svc.rpc('report_settings_service');
      if (!s?.resend_key) return json({ error: 'The sending key isn’t set up yet.' }, 400);
      const to = [u.user.email!];
      const id = await send(s.resend_key, s, to, '[Test] ' + subject, html);
      await svc.from('report_runs').insert({ schedule_id: sch?.id, org_id: st!.org_id, store_id: p.store_id, week_end: r.week_end, kind: 'test', status: 'sent', sent_to: to, provider_id: id });
      return json({ ok: true, to });
    }
    return json({ error: 'unknown mode' }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
