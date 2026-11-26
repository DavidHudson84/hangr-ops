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
- Read policies on sales, customers, customer_orders and commentary use `store_id in (select visible_store_ids())`
  (evaluated once per query). Per-row helper calls timed out on 132k orders; don't go back to them.
  `orgs.orders_as_of` holds the latest order date (set by `refresh_customer_stats`) so `v_customers` needn't scan orders.

## Marketing (module A2, built 26 Nov 2026)
- Every SMS is a row in `sms_sends`, created only by `app.queue_sms` (renders the template, adds the
  "- MasterDC Reply STOP to opt out." footer, checks mobile, opt-outs, do-not-contact and account customers,
  holds back `control_pct`% as `held`). Statuses: pending (awaiting campaign approval) > queued > sending > sent/failed/suppressed.
- Edge Function `sms-send` (pg_cron `hangr-sms-send`, every 5 min, secret header from `internal_secrets`) sends due
  `queued` rows through Twilio only when `sms_settings.mode` is `test` (test_mobile only) or `live`, inside
  quiet hours, never Sunday. Needs Edge Function secrets TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.
  `sms-inbound` is the Twilio reply webhook (STOP/START, signature checked).
- pg_cron `hangr-daily` runs `app.daily_job()` once per Melbourne day after 08:30: `run_flows` (onboarding,
  lapsing, winback, uncollected, review; each switched on by its `campaigns` kind='flow' row being 'approved') and
  `loyalty_prepare` (last month's $200 draw + free-order picks per loyalty_enabled store). Both refuse to act when
  `orgs.orders_as_of` is more than 10 days old.
- Offer calendar `offer_cycles` (six a year, variants vip/casual/lapsed, `max_days` audience window): `offer_preview`,
  `offer_approve` (queues four quadrant waves). One-off: `campaign_preview` / `campaign_create` (pending) /
  `campaign_approve` / `campaign_cancel`. Results: `v_sms_outcomes`, `sms_results` (orders within 30 days, sent vs held back).
- Marketing cap: `marketing_cap_per_month` (2) marketing texts in any 30 days; flows pause 14 days either side of an offer text.

## Labour (module B2, built 26 Nov 2026; admin only, `labour.js`)
- Data from AIOS `scripts/hangr_ops/labour_pull.py` (Employment Hero, read-only) and `finance_pull.py` (Xero 41450 Dr Drapes
  Revenue + restoration income accounts, read-only; DrapesQuotePro `hangr_drd_weekly` RPC) into `fin_weekly`, daily 6:15am.
- `v_labour_week` (Mon-Sun, labelled by the Sunday like sales). `services.section` maps POS services to plant streams
  (shirts, dry_cleaning, wash_fold, restoration, none); DRAFT until David confirms. Labour sections dc_production + pressing = dry_cleaning stream.
- Tabs: Plant (stream hours, labour, sales, pieces/hr, labour/piece, wage %), Stores (counter labour vs retail sales, rostered),
  Dr Drapes (weekly on Drapr finished value from 19 Jul 2026, 4- and 12-week rolling on Xero billed), Sections.
- Sections: person's home section (`labour_staff`, home_source 'manual' sticks), single-shift moves in `labour_shift_overrides`
  (kept across the daily window replace because they key on the EH timesheet id), location mapping + `signed_off`.
  Nothing writes back to Employment Hero.
- Store screen's Counter wage % tile reads `v_labour_week` (admins only; RLS hides labour from store managers).
