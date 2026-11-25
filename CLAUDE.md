# CLAUDE.md: Hangr Ops

Owner David Hudson, not a coder. Australian spelling. Plan: AIOS `plans/2026-11-25-mdc-profit-rebuild.md` (module A).

- `index.html` + `app.js`, no build step. supabase-js and SheetJS from CDNs.
- Tenancy: `orgs` > `stores` (+ `store_aliases` mapping POS store names; null store_id = ignore) > `memberships`
  (org_admin, store_manager with store_id, va). `platform_admins` = David across every org. Access helpers:
  `is_platform_admin()`, `is_org_admin(org)`, `can_see_store(org, store)`, `can_upload(org)`.
- Logins: add a row to `invites`; the person signs up; the `hangr_apply_invite` trigger on auth.users grants it
  once the email is confirmed. No SMTP yet, so confirm by hand:
  `update auth.users set email_confirmed_at = now() where email = '…' and email_confirmed_at is null;`
- Data: `sales` (store x service x day/week/month; weeks labelled by the Sunday), `customers`
  (`cust_key` = `store name::POS name`, lower case, underscores; same rule as the old local Hangr),
  `customer_orders`, `services` (channel retail/commercial/restoration/other; drives every split), `commentary`, `uploads`.
- Views `v_sales_week` (week rows, else days rolled up), `v_sales_month`, `v_customers` (tier, quadrant, days_since
  relative to the latest order loaded). Dashboard RPCs `dash_*` are security invoker, so RLS applies.
- Commercial flag on customers: POS "Account Charge Type" ARPer Batch / ARPer Order = commercial
  (`commercial_source='pos_account'`); `manual` overrides are never overwritten.
- Scripted loads: AIOS `scripts/hangr_ops/` with `HANGR_OPS_LOADER_KEY` from AIOS `.env`.
- Schema changes were applied through the Supabase MCP (migrations 0001-0006); dump the live schema before any rebuild.
