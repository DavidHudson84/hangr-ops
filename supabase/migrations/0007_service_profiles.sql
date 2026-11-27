-- 0007 service profiles (28 Nov 2026)
-- Sales Incoming "by service by order" report (two tabs: Sales Incoming + Flat) -> order_lines,
-- one row per POS receipt x service. Rolled up per customer into customer_services by marketing group
-- (services.offer_group). Offers and one-off campaigns can be tagged with a group; nobody gets an
-- offer for the same group within sms_settings.service_repeat_days.

alter table services add column if not exists offer_group text
  check (offer_group in ('shirts','dry_cleaning','household','wash_fold','repairs','curtains','formal','shoes_leather'));
update services set offer_group = m.g from (values
  ('Shirts','shirts'),('Shirts Route','shirts'),
  ('Dry Cleaning','dry_cleaning'),('Dry Cleaning Route','dry_cleaning'),('Dryclean','dry_cleaning'),('Press Only','dry_cleaning'),('Agency','dry_cleaning'),
  ('Household','household'),('Household OUT','household'),
  ('Linen/Wash Fold','wash_fold'),
  ('Repairs','repairs'),('Mending','repairs'),
  ('Curtains / Drapes','curtains'),('DRAPES','curtains'),
  ('Wedding','formal'),('Dress Hire','formal'),('Costumes','formal'),('Traditional Wear','formal'),
  ('Leather','shoes_leather'),('Shoe Repairs','shoes_leather'),('Shoe Repai','shoes_leather'),('sneaker laundry','shoes_leather')
) m(n,g) where services.name = m.n and services.offer_group is null;

alter table offer_library add column if not exists service_group text;
update offer_library set service_group = case slot when 2 then 'household' when 3 then 'repairs' when 4 then 'curtains' when 6 then 'formal' end
 where service_group is null;
alter table sms_sends add column if not exists service_group text;
create index if not exists sms_sends_cust_group on sms_sends(customer_id, service_group) where service_group is not null;
alter table sms_settings add column if not exists service_repeat_days int not null default 350;
alter table orgs add column if not exists services_from date, add column if not exists services_to date;

create table if not exists order_lines (
  org_id uuid not null references orgs on delete cascade,
  store_id uuid not null references stores,
  receipt text not null,            -- POS receipt id (uuid in the order link); unique per order
  order_no text,                    -- docket number, unique per store
  service text not null,
  sales numeric not null default 0,
  pieces int not null default 0,
  order_date date,
  order_time time,
  status text,
  customer_id uuid references customers on delete set null,
  upload_id uuid references uploads on delete set null,
  primary key (org_id, receipt, service));
create index if not exists order_lines_cust on order_lines(customer_id);
create index if not exists order_lines_store_date on order_lines(store_id, order_date);
alter table order_lines enable row level security;
drop policy if exists order_lines_read on order_lines;
create policy order_lines_read on order_lines for select using (store_id in (select visible_store_ids()));

create table if not exists customer_services (
  org_id uuid not null, store_id uuid not null, customer_id uuid not null references customers on delete cascade,
  grp text not null, orders int not null, sales numeric not null, first_used date, last_used date,
  primary key (customer_id, grp));
create index if not exists customer_services_org_grp on customer_services(org_id, grp, last_used);
alter table customer_services enable row level security;
drop policy if exists customer_services_read on customer_services;
create policy customer_services_read on customer_services for select using (store_id in (select visible_store_ids()));
revoke insert, update, delete, truncate on order_lines, customer_services from anon, authenticated;
revoke all on order_lines, customer_services from anon;

create or replace function app.refresh_service_stats(p_org uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  delete from customer_services where org_id = p_org;
  insert into customer_services(org_id, store_id, customer_id, grp, orders, sales, first_used, last_used)
  select l.org_id, c.store_id, l.customer_id, s.offer_group, count(distinct l.receipt), sum(l.sales), min(l.order_date), max(l.order_date)
    from order_lines l join services s on s.org_id = l.org_id and s.name = l.service
    join customers c on c.id = l.customer_id
   where l.org_id = p_org and s.offer_group is not null and (l.sales > 0 or l.pieces > 0)
   group by 1, 2, 3, 4;
  update orgs set services_from = x.f, services_to = x.t
    from (select min(order_date) f, max(order_date) t from order_lines where org_id = p_org) x where orgs.id = p_org;
end $$;

create or replace function public.ingest_order_lines(p_upload uuid, p_rows jsonb, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare u uploads; v_n int; v_new int; v_unknown text[];
begin
  select * into u from uploads where id = p_upload and status = 'open';
  if not found then raise exception 'upload not open'; end if;
  perform app.check_upload(u.org_id, p_key);

  create temp table _l on commit drop as
  select x.*, lower(x.cust_key) ckey, (app.resolve_store(u.org_id, x.store)).*, null::uuid cid
    from jsonb_to_recordset(p_rows) as x(store text, receipt text, order_no text, service text, sales numeric, pieces int,
         order_date date, order_time time, status text, cust_key text, full_name text, first_name text, last_name text, mobile text, email text);
  select coalesce(array_agg(distinct store), '{}') into v_unknown from _l where not known;
  delete from _l where store_id is null or coalesce(receipt,'') = '';

  -- 1 same customer key as Customer Orders (store + POS name)
  update _l l set cid = c.id from customers c where c.org_id = u.org_id and c.cust_key = l.ckey;
  -- 2 same mobile at the same store (most recent customer)
  update _l l set cid = m.id from (
    select distinct on (l2.ckey) l2.ckey, c.id from _l l2 join customers c on c.org_id = u.org_id and c.store_id = l2.store_id
       and au_mobile(c.mobile) = au_mobile(l2.mobile)
     where l2.cid is null and au_mobile(l2.mobile) is not null order by l2.ckey, c.last_order desc nulls last) m
   where l.cid is null and l.ckey = m.ckey;
  -- 3 otherwise a new customer (Customer Orders fills in their orders later)
  insert into customers(org_id, store_id, cust_key, full_name, first_name, last_name, mobile, email)
  select distinct on (ckey) u.org_id, store_id, ckey, full_name, first_name, last_name, nullif(mobile,''), nullif(email,'')
    from _l where cid is null and coalesce(ckey,'') <> ''
  on conflict (org_id, cust_key) do nothing;
  get diagnostics v_new = row_count;
  update _l l set cid = c.id from customers c where l.cid is null and c.org_id = u.org_id and c.cust_key = l.ckey;

  delete from order_lines o where o.org_id = u.org_id and o.receipt in (select receipt from _l);
  insert into order_lines(org_id, store_id, receipt, order_no, service, sales, pieces, order_date, order_time, status, customer_id, upload_id)
  select u.org_id, min(store_id::text)::uuid, receipt, min(order_no), trim(service), sum(coalesce(sales,0)), sum(coalesce(pieces,0)),
         min(order_date), min(order_time), min(status), (array_agg(cid))[1], p_upload
    from _l where coalesce(trim(service),'') <> '' group by receipt, trim(service);
  get diagnostics v_n = row_count;
  insert into services(org_id, name, channel) select distinct u.org_id, trim(service), 'other' from _l
   where coalesce(trim(service),'') <> '' on conflict do nothing;
  update uploads set rows_in = rows_in + v_n where id = p_upload;
  return jsonb_build_object('inserted', v_n, 'new_customers', v_new, 'unknown_stores', to_jsonb(v_unknown));
end $$;
grant execute on function public.ingest_order_lines(uuid, jsonb, text) to authenticated, anon;

create or replace function public.upload_finish(p_upload uuid, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare u uploads;
begin
  select * into u from uploads where id = p_upload and status = 'open';
  if not found then raise exception 'upload not open'; end if;
  perform app.check_upload(u.org_id, p_key);
  if u.kind in ('orders','customers') then perform app.refresh_customer_stats(u.org_id); end if;
  if u.kind = 'services' then perform app.refresh_service_stats(u.org_id); end if;
  update uploads set status = 'done', finished_at = now() where id = p_upload;
  return jsonb_build_object('rows', u.rows_in);
end $$;

-- has this customer been sent (or held back from) an offer for this service group recently?
create or replace function app.had_service_offer(p_customer uuid, p_group text, p_at timestamptz, p_days int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_group is not null and exists (select 1 from sms_sends x where x.customer_id = p_customer and x.service_group = p_group
     and x.status not in ('failed','suppressed','cancelled')
     and coalesce(x.scheduled_for, x.created_at) > p_at - make_interval(days => p_days))
$$;

-- audience gains service filters:
--   uses / never_uses / only_uses: arrays of offer groups, over the last service_days (default 365) of order lines;
--   any of them limits the audience to customers with at least one order line in that window.
--   service_tag: the group this campaign promotes; leaves out anyone offered it within service_repeat_days.
create or replace function app.audience(p_org uuid, p_filters jsonb)
returns table(customer_id uuid, store_id uuid, tier text, quadrant text, variant text)
language sql stable security definer set search_path = public as $$
  with prm as (select coalesce((p_filters->>'service_days')::int, 365) sd,
                      (select coalesce(service_repeat_days, 350) from sms_settings where org_id = p_org) rd,
                      (p_filters ? 'uses' and jsonb_array_length(p_filters->'uses') > 0) f_u,
                      (p_filters ? 'never_uses' and jsonb_array_length(p_filters->'never_uses') > 0) f_n,
                      (p_filters ? 'only_uses' and jsonb_array_length(p_filters->'only_uses') > 0) f_o,
                      (select services_to from orgs where id = p_org) asof)
  select v.id, v.store_id, v.tier, v.quadrant,
         case when v.tier in ('VIP','Regular') then 'vip' when v.tier = 'Lapsed' then 'lapsed' else 'casual' end
    from v_customers v join stores st on st.id = v.store_id and st.channel = 'retail' and st.active
   cross join prm
   cross join lateral (select case when v.orders_12m > 0 then v.spend_12m / v.orders_12m
                                   else v.lifetime_spend / nullif(v.order_count, 0) end as avg_ticket) t
   where v.org_id = p_org and not v.is_commercial and au_mobile(v.mobile) is not null
     and v.last_order is not null
     and v.days_since <= coalesce((p_filters->>'max_days')::int, 730)
     and v.days_since >= coalesce((p_filters->>'min_days')::int, 0)
     and (p_filters->>'max_avg_ticket' is null or t.avg_ticket < (p_filters->>'max_avg_ticket')::numeric)
     and (p_filters->>'min_avg_ticket' is null or t.avg_ticket >= (p_filters->>'min_avg_ticket')::numeric)
     and (p_filters->'stores' is null or jsonb_array_length(p_filters->'stores') = 0 or v.store_id::text in (select jsonb_array_elements_text(p_filters->'stores')))
     and (p_filters->'tiers' is null or jsonb_array_length(p_filters->'tiers') = 0 or v.tier in (select jsonb_array_elements_text(p_filters->'tiers')))
     and (p_filters->'quadrants' is null or jsonb_array_length(p_filters->'quadrants') = 0 or v.quadrant in (select jsonb_array_elements_text(p_filters->'quadrants')))
     and not exists (select 1 from sms_suppression x where x.org_id = p_org and x.mobile = au_mobile(v.mobile))
     and not exists (select 1 from do_not_contact d where d.org_id = p_org and d.customer_id = v.id)
     and (not (f_u or f_n or f_o) or exists (select 1 from customer_services cs where cs.customer_id = v.id and cs.last_used > asof - sd))
     and (not f_u or exists (select 1 from customer_services cs where cs.customer_id = v.id and cs.last_used > asof - sd
            and cs.grp in (select jsonb_array_elements_text(p_filters->'uses'))))
     and (not f_n or not exists (select 1 from customer_services cs where cs.customer_id = v.id and cs.last_used > asof - sd
            and cs.grp in (select jsonb_array_elements_text(p_filters->'never_uses'))))
     and (not f_o or not exists (select 1 from customer_services cs where cs.customer_id = v.id and cs.last_used > asof - sd
            and cs.grp not in (select jsonb_array_elements_text(p_filters->'only_uses'))))
     and (p_filters->>'service_tag' is null or not app.had_service_offer(v.id, p_filters->>'service_tag', now(), rd))
$$;

create or replace function public.campaign_create(p_org uuid, p_name text, p_filters jsonb, p_body text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare s sms_settings; camp uuid; a record; v text; n int := 0; lim int := coalesce((p_filters->>'limit')::int, 100000);
begin
  if not is_org_admin(p_org) then raise exception 'admins only'; end if;
  select * into s from sms_settings where org_id = p_org;
  insert into campaigns(org_id, kind, name, status, body, segment, created_by) values (p_org, 'custom', p_name, 'draft', p_body, p_filters, auth.uid()) returning id into camp;
  for a in select * from app.audience(p_org, p_filters) order by random() loop
    exit when n >= lim;
    if app.marketing_count(a.customer_id, now()) >= s.marketing_cap_per_month then continue; end if;
    v := app.queue_sms(p_org, a.customer_id, null, p_body, 'campaign', true, camp, null,
      jsonb_build_object('code', public.referral_code(a.customer_id),
        'review_url', coalesce((select st.google_review_url from customers c join stores st on st.id = c.store_id where c.id = a.customer_id), '')),
      null, 'pending');
    n := n + 1;
  end loop;
  if p_filters->>'service_tag' is not null then
    update sms_sends set service_group = p_filters->>'service_tag' where campaign_id = camp;
  end if;
  return camp;
end $$;

create or replace function public.offer_approve(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare c offer_cycles; s sms_settings; camp uuid; a record; v text; n int := 0; nl int := 0; skipped int := 0; rep int := 0;
        at timestamptz; body text; slot int; lib jsonb; grp jsonb; f jsonb;
begin
  select * into c from offer_cycles where id = p_cycle;
  if not is_org_admin(c.org_id) then raise exception 'admins only'; end if;
  if c.status <> 'draft' then raise exception 'this period is already %', c.status; end if;
  select jsonb_object_agg(l.slot::text, l.variants), jsonb_object_agg(l.slot::text, l.service_group) into lib, grp
    from offer_library l where l.org_id = c.org_id;
  if (select count(*) from offer_library l where l.org_id = c.org_id and l.variants ?& array['vip','casual','lapsed']
        and not exists (select 1 from jsonb_each(l.variants) e where coalesce(e.value->>'body','') = '')) < 6 then
    raise exception 'all six offers need a message for VIP/Regular, Casual and Lapsed';
  end if;
  select * into s from sms_settings where org_id = c.org_id;
  insert into campaigns(org_id, kind, name, status, approved_by, approved_at, notes)
  values (c.org_id, 'offer_cycle', 'Offers ' || to_char(c.starts_on, 'Mon YYYY') || ' to ' || to_char(c.ends_on, 'Mon YYYY'), 'approved', auth.uid(), now(), c.margin_floor_note)
  returning id into camp;
  f := jsonb_build_object('max_days', c.max_days) || (coalesce(c.filters, '{}') - 'min_avg_ticket' - 'max_avg_ticket');
  for a in select * from app.audience(c.org_id, f || jsonb_build_object('min_avg_ticket', s.low_spender_cutoff)) loop
    at := app.wave_start(c, a.quadrant);
    if app.marketing_count(a.customer_id, at) >= s.marketing_cap_per_month then skipped := skipped + 1; continue; end if;
    slot := app.offer_slot(c, a.customer_id);
    if app.had_service_offer(a.customer_id, grp->>slot::text, at, s.service_repeat_days) then rep := rep + 1; continue; end if;
    body := replace(lib->slot::text->a.variant->>'body', '{ends}', to_char(c.ends_on, 'FMDD Mon'));
    v := app.queue_sms(c.org_id, a.customer_id, 'offer_s' || slot || '_' || a.variant, body, 'offer', true, camp, at);
    n := n + 1;
  end loop;
  for a in select * from app.audience(c.org_id, f || jsonb_build_object('max_avg_ticket', s.low_spender_cutoff)) loop
    at := app.wave_start(c, a.quadrant);
    if app.marketing_count(a.customer_id, at) >= s.marketing_cap_per_month then skipped := skipped + 1; continue; end if;
    body := replace(s.low_spender_body, '{ends}', to_char(c.ends_on, 'FMDD Mon'));
    v := app.queue_sms(c.org_id, a.customer_id, 'offer_low', body, 'offer', true, camp, at);
    nl := nl + 1;
  end loop;
  update sms_sends x set service_group = l.service_group from offer_library l
   where x.campaign_id = camp and l.org_id = c.org_id and l.service_group is not null and x.template_key like 'offer_s' || l.slot || '\_%';
  update offer_cycles set status = 'queued', campaign_id = camp, approved_by = auth.uid(), approved_at = now() where id = p_cycle;
  return jsonb_build_object('queued', n + nl, 'low_spenders', nl, 'skipped_cap', skipped, 'skipped_repeat', rep, 'campaign', camp);
end $$;

-- service mix for the Marketing screen: per store and group, customers who used it in the window,
-- and retail customers with a profile who did not
create or replace function public.service_mix(p_org uuid, p_days int default 365)
returns jsonb language sql stable security invoker set search_path = public as $$
  with asof as (select services_from f, services_to t from orgs where id = p_org),
  prof as (select cs.customer_id, cs.store_id, cs.grp from customer_services cs join customers c on c.id = cs.customer_id
             join stores st on st.id = cs.store_id and st.channel = 'retail' and st.active cross join asof
            where cs.org_id = p_org and not c.is_commercial and cs.last_used > asof.t - p_days),
  base as (select distinct customer_id, store_id from prof)
  select jsonb_build_object('from', (select f from asof), 'to', (select t from asof),
    'profiles', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(r) from (
       select b.store_id, g.grp, count(*) filter (where p.customer_id is not null) used, count(*) filter (where p.customer_id is null) not_used
         from base b cross join (select distinct offer_group grp from services where org_id = p_org and offer_group is not null) g
         left join prof p on p.customer_id = b.customer_id and p.grp = g.grp
        group by 1, 2) r), '[]'))
$$;
grant execute on function public.service_mix(uuid, int) to authenticated;

-- follow-ups applied the same day:
-- 0007b ingest_order_lines builds cust_key server-side (lower(store name || '::' || POS name), spaces to _) when the loader sends none
-- 0007c uploads.kind allows 'services'
-- 0007d orgs.services_from/to = the periods the service uploads cover (old orders collected in a period carry earlier dates)
alter table uploads drop constraint if exists uploads_kind_check;
alter table uploads add constraint uploads_kind_check check (kind in ('sales','orders','customers','services'));

-- 0008_service_totals (28 Nov 2026): public.ingest_service_totals(p_upload, p_rows, p_key).
-- A "by service and order" upload covering Mon-Sun or a calendar month also writes per-service totals
-- into sales (grain week/month, period_end = date_to), so plain Sales Incoming is no longer needed.
-- Where a plain Sales Incoming upload already holds that store and period it only compares and returns
-- the difference (checked w/e 22 Nov 2026: every store to the cent). A later plain upload still replaces it.
