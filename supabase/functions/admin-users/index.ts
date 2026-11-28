// People admin for Hangr Ops. The caller's own login (with two-factor) must be an admin of the org;
// resetting someone's two-factor is for the platform owner only. Emails (invite, password reset) go
// through Supabase Auth, which sends them via the Resend SMTP settings.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!, SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SITE = 'https://ops.hangr.au/?set=1';
const ROLES = ['org_admin', 'store_manager', 'va'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
type R = any;

async function allUsers(svc: R) {
  const out: R[] = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    out.push(...data.users); if (data.users.length < 200) break;
  }
  return out;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const svc = createClient(URL_, SRK);
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  let p: R = {}; try { p = await req.json(); } catch { /* empty */ }
  try {
    const { data: u } = await user.auth.getUser(); if (!u?.user) return json({ error: 'Sign in first.' }, 401);
    const org = p.org_id;
    const { data: okAdmin } = await user.rpc('is_org_admin', { p_org: org });
    if (!okAdmin) return json({ error: 'Only an admin of this business can manage people (with two-factor on).' }, 403);
    const { data: owner } = await user.rpc('is_platform_admin');
    const email = String(p.email || '').trim().toLowerCase();

    if (p.action === 'list') {
      const [{ data: mem }, { data: inv }, users] = await Promise.all([
        svc.from('memberships').select('*').eq('org_id', org),
        svc.from('invites').select('*').eq('org_id', org).is('used_at', null),
        allUsers(svc)]);
      const byId = new Map(users.map((x: R) => [x.id, x])), byEmail = new Map(users.map((x: R) => [String(x.email).toLowerCase(), x]));
      const { data: pa } = await svc.from('platform_admins').select('user_id');
      const info = (x: R) => x ? { user_id: x.id, email: x.email, last_sign_in: x.last_sign_in_at, confirmed: !!x.email_confirmed_at,
        two_factor: (x.factors || []).some((f: R) => f.status === 'verified') } : null;
      return json({
        owners: (pa || []).map((r: R) => ({ ...info(byId.get(r.user_id)), role: 'platform' })),
        members: (mem || []).map((m: R) => ({ ...m, ...info(byId.get(m.user_id)) })),
        invites: (inv || []).map((i: R) => ({ ...i, ...info(byEmail.get(String(i.email).toLowerCase())) })),
        can_reset_2fa: !!owner });
    }

    if (p.action === 'invite') {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: 'That isn’t an email address.' }, 400);
      if (!ROLES.includes(p.role)) return json({ error: 'Unknown role.' }, 400);
      if (p.role === 'store_manager' && !p.store_id) return json({ error: 'Pick the store.' }, 400);
      await svc.from('invites').delete().eq('org_id', org).ilike('email', email).is('used_at', null);
      const { error: ie } = await svc.from('invites').insert({ org_id: org, email, role: p.role, full_name: p.full_name || null, store_id: p.role === 'store_manager' ? p.store_id : null });
      if (ie) throw ie;
      const existing = (await allUsers(svc)).find((x: R) => String(x.email).toLowerCase() === email);
      if (existing?.email_confirmed_at) {  // already has a login: give access now
        await svc.rpc('apply_invite_now', { p_uid: existing.id, p_email: email });
        return json({ ok: true, message: `${email} already had a login, so they have access now.` });
      }
      const { error } = await svc.auth.admin.inviteUserByEmail(email, { redirectTo: SITE, data: { full_name: p.full_name || null } });
      if (error) return json({ ok: true, message: `Invite saved, but the email didn’t send: ${error.message}` });
      return json({ ok: true, message: `Invite emailed to ${email}.` });
    }

    if (p.action === 'resend') {
      const existing = (await allUsers(svc)).find((x: R) => String(x.email).toLowerCase() === email);
      if (existing?.email_confirmed_at) {
        const { error } = await svc.auth.resetPasswordForEmail(email, { redirectTo: SITE });
        return error ? json({ error: error.message }, 400) : json({ ok: true, message: `${email} already set up a login; sent a password reset instead.` });
      }
      if (existing) await svc.auth.admin.deleteUser(existing.id);  // an unaccepted invite: start it again
      const { error } = await svc.auth.admin.inviteUserByEmail(email, { redirectTo: SITE });
      return error ? json({ error: error.message }, 400) : json({ ok: true, message: `Invite emailed again to ${email}.` });
    }

    if (p.action === 'reset_password') {
      const { error } = await svc.auth.resetPasswordForEmail(email, { redirectTo: SITE });
      return error ? json({ error: error.message }, 400) : json({ ok: true, message: `Password reset emailed to ${email}.` });
    }

    if (p.action === 'set_role') {
      if (!ROLES.includes(p.role)) return json({ error: 'Unknown role.' }, 400);
      const { error } = await svc.from('memberships').update({ role: p.role, store_id: p.role === 'store_manager' ? p.store_id : null }).eq('id', p.membership_id).eq('org_id', org);
      return error ? json({ error: error.message }, 400) : json({ ok: true, message: 'Role changed.' });
    }

    if (p.action === 'remove') {
      if (p.membership_id) await svc.from('memberships').delete().eq('id', p.membership_id).eq('org_id', org);
      if (p.invite_id) await svc.from('invites').delete().eq('id', p.invite_id).eq('org_id', org);
      return json({ ok: true, message: 'Access removed.' });
    }

    if (p.action === 'reset_2fa') {
      if (!owner) return json({ error: 'Only David can reset someone’s two-factor.' }, 403);
      const { data: mem } = await svc.from('memberships').select('user_id').eq('org_id', org).eq('user_id', p.user_id).maybeSingle();
      if (!mem) return json({ error: 'That person isn’t in this business.' }, 400);
      const { data: f, error } = await svc.auth.admin.mfa.listFactors({ userId: p.user_id }); if (error) throw error;
      for (const x of f.factors || []) await svc.auth.admin.mfa.deleteFactor({ id: x.id, userId: p.user_id });
      return json({ ok: true, message: 'Two-factor reset. They’ll set it up again at their next sign-in.' });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
