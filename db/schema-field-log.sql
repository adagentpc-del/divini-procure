-- ============================================================================
-- Divini Procure - Field Log: daily logs and a time clock for field crews
-- (competitive gap #10, docs/competitive-analysis-2026-08.md: "Mobile-first
-- field execution app (daily logs, time clock, photos, punch lists)").
-- Photos (progress_photos, schema-quick-hits.sql) and punch lists
-- (delivery_punch_items, schema-delivery.sql) already exist; this adds the
-- two missing pieces as ordinary mobile-responsive web pages served by the
-- existing app - there is no native mobile build tooling in this
-- environment, so this is not (and does not pretend to be) a native app.
--
-- Scoped to building level, restricted to the vendor with an ACTIVE AWARD at
-- that building (schema-awards.sql) - stricter than progress_photos' "any
-- bid on any package under the building" rule, since "log today's work at
-- this site" implies the vendor actually won work there, not merely bid on
-- something under that building.
--
-- Individual attribution follows the existing convention (progress_photos'
-- uploaded_by_email, delivery_events.actor): a denormalized email string
-- captured at write time, not a normalized crew-roster table - there is no
-- "crew member" concept anywhere else in this codebase to hang one off of,
-- and company_members already allows a vendor company to have more than one
-- individual login.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  logged_by_email text,
  log_date date not null default current_date,
  work_performed text not null,
  crew_count int,
  weather text,
  delays text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_logs_building on daily_logs (building_id, log_date desc);
create index if not exists idx_daily_logs_vendor on daily_logs (vendor_company_id);

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  logged_by_email text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- At most one OPEN (not yet clocked out) time entry per person per site -
-- clocking in twice without clocking out first is a data-entry mistake, not
-- a valid state, and this makes it impossible at the database level rather
-- than just in the route.
create unique index if not exists time_entries_one_open_per_person
  on time_entries (building_id, vendor_company_id, logged_by_email) where clock_out is null;
create index if not exists idx_time_entries_building on time_entries (building_id, clock_in desc);
create index if not exists idx_time_entries_vendor on time_entries (vendor_company_id);

-- ============================================================================
-- RLS: same three-way visibility shape as awards/progress_photos (see their
-- own schema files) - the building owner (developer), the vendor with an
-- ACTIVE AWARD at this building, or admin may read. Only a vendor with an
-- active award there may insert, and only for its own vendor_company_id.
-- Deliberately vendor-write / developer-read-only (unlike delivery punch
-- items, which both parties can write): this is the vendor's crew's log,
-- not a shared task list.
-- ============================================================================

alter table daily_logs enable row level security;
alter table daily_logs force row level security;

drop policy if exists daily_logs_select on daily_logs;
create policy daily_logs_select on daily_logs
  for select using (
    exists (
      select 1 from buildings b
       where b.id = daily_logs.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists daily_logs_insert on daily_logs;
create policy daily_logs_insert on daily_logs
  for insert with check (
    (
      vendor_company_id::text = any(array(select current_user_company_ids()))
      and exists (
        select 1 from awards a
         where a.building_id = daily_logs.building_id
           and a.vendor_company_id = daily_logs.vendor_company_id
           and a.status = 'active'
      )
    )
    or current_user_is_admin()
  );

drop policy if exists daily_logs_delete on daily_logs;
create policy daily_logs_delete on daily_logs
  for delete using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

alter table time_entries enable row level security;
alter table time_entries force row level security;

drop policy if exists time_entries_select on time_entries;
create policy time_entries_select on time_entries
  for select using (
    exists (
      select 1 from buildings b
       where b.id = time_entries.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists time_entries_insert on time_entries;
create policy time_entries_insert on time_entries
  for insert with check (
    (
      vendor_company_id::text = any(array(select current_user_company_ids()))
      and exists (
        select 1 from awards a
         where a.building_id = time_entries.building_id
           and a.vendor_company_id = time_entries.vendor_company_id
           and a.status = 'active'
      )
    )
    or current_user_is_admin()
  );

-- UPDATE is needed for the clock-out step (setting clock_out/notes on an
-- already-inserted row) - narrower than insert, no re-check of the award
-- (a clock-out should always be allowed to complete once a shift is open,
-- even if the award were cancelled mid-shift).
drop policy if exists time_entries_update on time_entries;
create policy time_entries_update on time_entries
  for update using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
