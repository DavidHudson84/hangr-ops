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

## Org chart and role cards (module B4, 26 Nov 2026; admin only, `roles.js`)
- Labour > Org chart (`#/labour/org`) and one role card per position (`#/labour/role/<id>`).
- `positions`: code, title, area, labour section, store, reports_to, fte (what the job needs), award, purpose, responsibilities[], standards[], kpis[{label,target,metric}], source, status draft/approved, sort.
- `position_holders`: position, EH employee id, share (split someone across two positions). No pay detail stored.
- `v_staff_cost` (security invoker over admin-only `labour_rates`): cost and paid hours a week per person over the last ~9 weeks of pay runs.
- KPI `metric` keys show live figures: `plant`, `stream:<shirts|dry_cleaning|wash_fold|restoration>`, `store:<code>`, `drd`, `yoy:<retail|commercial|restoration|dr_drapes>`, `yoy:retail:<ALP|SED|WER|BUT|KIN>`.
- Seeded 26 Nov 2026 as DRAFT from the OneDrive PDs; FTE seeded from paid hours. Flags: vacant, paid hours >15% over FTE, anyone paid over 45 h/wk, staff paid but in no position.
- Staff and store managers can't see cards yet (RLS is admin only).
- Holders can be off-payroll (`position_holders.eh_employee_id` null, `ext_name`, `ext_cost_pw`). Holder rows are keyed by `id`.
- Plan changes: `positions.plan_fte`, `plan_rate`, `plan_note`; the org chart costs them and shows wage % against 12-week Xero sales (`sales_yoy`). Apply copies plan_fte into fte.

## Account health (module A3, 26 Nov 2026; admin only, `accounts.js`)
- `fin_account_weekly` (week_end, Xero contact_id, stream commercial/restoration/dr_drapes, amount ex GST, invoices) loaded by AIOS `scripts/hangr_ops/finance_pull.py` through `ingest_accounts` (loader key); `accounts` holds name, segment, owner, watch, note (screen edits stick; the loader only fills blanks).
- `account_health(p_org, p_key)`: recent 4 weeks vs the prior 12 (8 vs 24 when billed in fewer than 10 of the last 26 weeks) and vs last year. Statuses: stopped, down (<75%), new (first invoice in 16 weeks), up (>125%), steady, dormant; down/up need a usual of $500+ per window.


## Referrals and reviews (module A3, 26 Nov 2026; `growth.js`, Marketing tabs)
- Referrals: code = `referral_code(customer id)` (indexed); `referral_lookup` (RLS-respecting) finds the referrer; staff log on the tab or the customer profile; `referral_report` matches the friend's later orders by mobile (`au_mobile`). Credit each way is `sms_settings.referral_credit` (75, matching the referral_invite template); credit is applied by hand in My Clean POS, then marked Credited. One-off campaigns now fill `{code}` and `{review_url}` per customer.
- Reviews: `review_report` = review_request texts sent vs reviews logged per store (90 days); Google links editable per store (no link = no asks). Reviews are logged by hand.
- Status `lost` added to account_health: $2,000+ in 52 weeks, nothing in the recent or prior window.
- Laptop Hangr retirement: AIOS `scripts/hangr_ops/parity_check.py` (daily in labour_pull.cmd, `parity_weeks` RPC) writes `outputs/hangr-ops/parity.md`; steps in `outputs/hangr-ops/local-retirement.md`. At 26 Nov 2026 all 72 weeks match; blocked only on uploads resuming.

## $ per order (26 Nov 2026)
- Sales Incoming "orders" are service lines (each service on a ticket counts once, ~1.45 per real ticket), so never quote
  sales / those orders as the average order. The average ticket comes from Customer Orders: `dash_ticket_weeks` (retail
  customers, not Void, sales > 0, weeks labelled by the Sunday). `dash_order_mix` gives size bands (last 12 weeks loaded vs
  the same 12 weeks a year earlier) and $ per ticket by customer tier.
- Group and store screens: "Average retail order" card ($ per ticket vs last week, 12-week average, same week last year,
  weekly chart, size bands, tiers); group store table has $/ticket with vs 12-wk and vs LY.

## Targeting by average ticket (26 Nov 2026)
- `app.audience` filters `max_avg_ticket` / `min_avg_ticket` (spend_12m / orders_12m, else lifetime). Offer cycles have
  `filters` (merged into the audience in `offer_preview` / `offer_approve`): Dec 2026 cycle has `{"min_avg_ticket": 30}`.
- David's rule: low spenders (average ticket under $30) get "20% off 3 or more items" (campaign "Low spenders: 20% off 3+ items",
  draft, valid to 31 Jan 2027); higher spenders keep the regular offers. Garment-specific offers are too hard at the counter.
- `sms_results` also returns sent_orders, held_orders, held_sales so Results shows $/ticket sent vs held back.

## Offer rotation (26 Nov 2026)
- `offer_library` holds six offers (slot 1-6, variants vip/casual/lapsed). `offer_cycles` rows are now just periods.
- Customers sit in six fixed groups (`app.offer_group` = hash of customer id mod 6). In period i (order by starts_on,
  `app.cycle_no_in_seq`) group g gets offer ((i + g) mod 6) + 1 (`app.offer_slot`), so six offers run at once and each
  customer moves through all six. Template key `offer_s{slot}_{variant}`. `offer_cycles.variants` is no longer used.
- David's offer rules: % off and item counts only, no $ amounts; name items only for big-ticket work (doonas, blankets,
  curtains, trouser hems; wedding/evening gowns added as offer 6); doonas and blankets 40% off for every tier.
- Low spenders (sms_settings.low_spender_cutoff, default $30) get sms_settings.low_spender_body in every period instead of
  the rotation (template key offer_low). The Dec 2026 one-off low-spender campaign was cancelled (26 Nov 2026).
- 26 Nov 2026: David is not yet sure about the marketing; every period stays draft until he says otherwise.

## Service profiles (28 Nov 2026; migration 0007)
- Upload: My Clean POS "Sales Incoming" run by service and order. Two tabs: tab 1 store > service > one row per order (order number is a
  HYPERLINK to `.../order/receipt/<uuid>`), tab "Flat" one row per order/sub-order with Account (POS name), Phone, Email, Order Date.
  Detected by the Flat tab (before the Customer Orders check, because tab 1 also has a Start Date column). Joined on the receipt uuid.
  `ingest_order_lines` -> `order_lines` (receipt x service; re-loading replaces each receipt, so any date range and overlaps are safe).
  Customer match: cust_key (store name::POS name, same as Customer Orders), else same mobile at that store, else a new customer.
  AIOS `scripts/hangr_ops/service_orders.py` does the same from the command line (loader key).
- `services.offer_group` (DRAFT mapping, editable in Admin > Services): shirts, dry_cleaning, household, wash_fold, repairs, curtains,
  formal, shoes_leather; null = not a marketing service (commercial, restoration, re-dos). `app.refresh_service_stats` rebuilds
  `customer_services` (customer x group: orders, spend, first/last used) at every services upload. `orgs.services_from/to` = periods covered.
- Targeting: `app.audience` filters `uses`, `never_uses`, `only_uses` (arrays of groups) over `service_days` (default 365); any of
  them limits the audience to customers with service history in that window. `service_tag` = the group a campaign promotes; skips
  anyone with an `sms_sends.service_group` = tag within `sms_settings.service_repeat_days` (350, so last year's same offer can go again).
- `offer_library.service_group` tags the six offers (2 household, 3 repairs, 4 curtains, 6 formal); `offer_approve` skips customers
  offered that group within the repeat window (`skipped_repeat`) and stamps `sms_sends.service_group`. `campaign_create` stamps it too.
- Screens: customer page "Services used"; Marketing > One-off campaigns has the service filters, the "promotes" tag and a Service mix
  table (`service_mix` RPC, retail stores only); Admin > Services has the marketing group column; Sending has the repeat days.


**Two weekly reports, not three (28 Nov 2026, migration 0008).** A Sales Incoming by service and order upload covering Monday to Sunday or a whole calendar month also fills `sales` (per-service totals, via `ingest_service_totals`), so plain Sales Incoming is retired. It never overwrites a period plain Sales Incoming already loaded; there it compares and the Upload screen shows any difference. The report has no discounts column, so `sales.discounts` is 0 for weeks it loads (not shown on any screen). It includes Master Textile Restoration, which plain Sales Incoming left out. A Sun-Sat or other odd period loads profiles only.

## Upload checks and locked periods (28 Nov 2026, migration 0009)

Nothing loads unless the file is clean. `uploadGate()` in app.js runs before any write and sorts problems into
**hard** (wrong for everyone: wrong report or grouping, not Monday-Sunday / whole month, period not finished,
Include discounts not ticked, tabs from different runs, orders missing from Flat, order lines not adding up to
their service line / services to their store line / stores to the Total line, no Total line, unknown store,
or a **locked** period whose figures differ) and **soft** (looks wrong: a store that traded in the prior 9 weeks
is missing, a store more than 50% off its 4-week average (40% off 3 months for a month file), every store $0
discounts, Customer Orders more than 15% off that period's sales or uploaded before the sales file, plain Sales
Incoming at all). Soft stops tell the VA to send David a screenshot; the platform owner gets "load anyway".
Unknown Service lines are only a note. Facts come from the `upload_check` RPC (existing figures, lock, 4-period
history, expected stores, period sales).

**Locks.** `data_locks` (kind sales by grain+period_end, or orders by date range). `upload_finish` locks what each
upload loaded; everything loaded before 28 Nov was locked per week, month and order month. Rule: data already in a
locked period can't change; an empty slot in a locked range can still be filled (so backfill works). Enforced in the
database too: `upload_begin` refuses orders over a locked range that holds orders, `ingest_sales` refuses locked
periods, `ingest_service_totals` only compares. `unlock_period(lock, reason)` is platform-owner only (Admin >
Locked figures); the next clean upload re-locks. Order lines (service profiles) are not locked: they replace by
receipt. Routing: Customer Orders also has a Flat tab and a Service column; it is recognised by First/Last Order.

## Monday store reports (28 Nov 2026, migrations 0010-0012)

One email per store (Albert Park, Seddon, Werribee, Butler, Route, South Kingsville) for the week just finished,
modelled on Huward's "Summary Report for Weekly Average Sales" PDF: sales vs last week / same week last year /
12-week average (incl. this week) and its run of weeks rising or falling, discounts vs 12-week average, key points,
all stores side by side, the 12 weeks with bars against last year, services this week vs each service's 12-week
average, customers (Customer Orders: served, new, back after 6+ months), on-account vs walk-in from order_lines
(e.g. DRYZ at Butler), and counter wages % for shopfronts (v_labour_daily section store_service; per-schedule toggle).
Figures match Huward's PDF to the cent; Butler includes DRYZ (shown as account work) where his excludes it.

Pieces: `store_week_report(store, week)` (service_role or org admin only), `report_schedules` (recipients, send day,
send-after time, on/off, include wages; Admin > Monday store reports, with Preview and "Send me a test"),
`report_runs` (log), `reports_due()` (enabled, on/after send day+time and up to 2 days late, the week's sales locked
and a Customer Orders upload covering the week, not yet sent), `reports_waiting()` (Tuesday 12pm, one note to David).
Edge Function `store-reports` (verify_jwt off; modes cron/render need `app.report_settings.cron_secret`,
preview/test need an admin login). pg_cron `hangr-store-reports` every 15 min. Sent through Resend from
reports@hangr.au (domain verified), reply-to David; the key lives in `app.report_settings.resend_key`, never the repo.
All six schedules start OFF with only David as recipient.
**Exclusions (migrations 0013-0015):** `report_exclusions` takes an account out of a store's report in every week so
comparisons are like for like; DRYZ at Butler (ended Nov 2026) is the first. `app.excluded_sales(store, week)` uses
order_lines (Sales Incoming basis) where the week is loaded, else Customer Orders. The store shows as "The Butler excl.
DRYZ". Services this week still include DRYZ's lines until it stops trading. Resend key ("hangr-ops store reports",
send-only, hangr.au only) created 28 Nov 2026 and stored in `app.report_settings`; six test emails sent to David that day.
