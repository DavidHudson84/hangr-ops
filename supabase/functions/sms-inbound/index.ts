// sms-inbound: Twilio "A message comes in" webhook for the reply number.
// STOP / UNSUBSCRIBE / CANCEL / END / QUIT / OPT OUT adds the number to sms_suppression for every org
// that sends from that number. START / UNSTOP removes it. Requests are checked against Twilio's signature.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const PUBLIC_URL = Deno.env.get("HANGR_INBOUND_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-inbound`; // must match the URL set in Twilio

async function validSignature(sig: string | null, params: URLSearchParams) {
  if (!sig || !TOKEN || !PUBLIC_URL) return false;
  const data = PUBLIC_URL + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...mac)) === sig;
}
const twiml = (msg = "") => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });

Deno.serve(async (req) => {
  const params = new URLSearchParams(await req.text());
  if (!(await validSignature(req.headers.get("x-twilio-signature"), params))) return new Response("forbidden", { status: 403 });
  const from = params.get("From") ?? "", to = params.get("To") ?? "", body = (params.get("Body") ?? "").trim().toUpperCase();
  const { data: orgs } = await sb.from("sms_settings").select("org_id").eq("from_number", to);
  const ids = (orgs ?? []).map((o) => o.org_id);
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPT ?OUT)\b/.test(body)) {
    for (const org_id of ids) await sb.from("sms_suppression").upsert({ org_id, mobile: from, reason: `Replied ${body.slice(0, 20)}`, source: "sms-inbound" });
    return twiml(); // Twilio's own opt-out handling sends the confirmation
  }
  if (/^(START|UNSTOP|YES)\b/.test(body)) {
    for (const org_id of ids) await sb.from("sms_suppression").delete().eq("org_id", org_id).eq("mobile", from);
    return twiml();
  }
  return twiml();
});
