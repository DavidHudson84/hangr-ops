// sms-send: sends queued SMS through Twilio. Triggered every 5 minutes by pg_cron (hangr-sms-send).
// Rules: nothing leaves unless sms_settings.mode is 'test' (only to test_mobile) or 'live';
// only inside quiet hours (Melbourne time), never on days_off; suppression and do-not-contact
// are re-checked at the moment of sending. Control-group rows are never queued, so never sent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

function melbourneNow() {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dow, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

async function twilio(to: string, from: string, body: string) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${j.code ?? r.status}: ${j.message ?? "Twilio error"}`);
  return j as { sid: string; num_segments?: string };
}

Deno.serve(async (req) => {
  // the cron secret lives in internal_secrets (service role only); pg_cron sends it in this header
  const { data: sec } = await sb.from("internal_secrets").select("value").eq("key", "cron").maybeSingle();
  if (!sec?.value || req.headers.get("x-hangr-cron") !== sec.value) return new Response("forbidden", { status: 403 });
  const out: Record<string, unknown>[] = [];
  const { data: settings } = await sb.from("sms_settings").select("*").neq("mode", "off");
  for (const s of settings ?? []) {
    const { dow, hm } = melbourneNow();
    if ((s.days_off ?? []).includes(dow) || hm < s.quiet_start.slice(0, 5) || hm >= s.quiet_end.slice(0, 5)) {
      out.push({ org: s.org_id, skipped: "outside sending hours" }); continue;
    }
    if (!SID || !TOKEN) { out.push({ org: s.org_id, skipped: "Twilio keys not set" }); continue; }
    let q = sb.from("sms_sends").select("id,mobile,body,customer_id,is_marketing").eq("org_id", s.org_id).eq("status", "queued")
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`).order("scheduled_for", { ascending: true, nullsFirst: true }).limit(150);
    if (s.mode === "test") q = q.eq("mobile", s.test_mobile ?? "none");
    const { data: rows } = await q;
    let sent = 0, failed = 0, suppressed = 0;
    for (const m of rows ?? []) {
      // claim the row so two runs can't double send
      const { data: claimed } = await sb.from("sms_sends").update({ status: "sending" }).eq("id", m.id).eq("status", "queued").select("id");
      if (!claimed?.length) continue;
      const [{ data: sup }, { data: dnc }] = await Promise.all([
        sb.from("sms_suppression").select("mobile").eq("org_id", s.org_id).eq("mobile", m.mobile).maybeSingle(),
        m.customer_id && m.is_marketing ? sb.from("do_not_contact").select("customer_id").eq("org_id", s.org_id).eq("customer_id", m.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (sup || dnc) { await sb.from("sms_sends").update({ status: "suppressed", error: sup ? "opted out" : "do not contact" }).eq("id", m.id); suppressed++; continue; }
      try {
        const r = await twilio(m.mobile, s.sender_id || s.from_number, m.body);
        const segs = Number(r.num_segments ?? 1) || 1;
        await sb.from("sms_sends").update({ status: "sent", provider: "twilio", provider_sid: r.sid, sent_at: new Date().toISOString(), cost: s.cost_per_sms * segs, error: null }).eq("id", m.id);
        sent++;
      } catch (e) {
        await sb.from("sms_sends").update({ status: "failed", provider: "twilio", error: String((e as Error).message).slice(0, 300) }).eq("id", m.id);
        failed++;
      }
    }
    out.push({ org: s.org_id, mode: s.mode, sent, failed, suppressed });
  }
  return Response.json(out);
});
