-- ============================================================================
-- Divini Procure - RFI (Request for Information) workflow.
-- ----------------------------------------------------------------------------
-- Fresh competitive scan, 2026-08-17 (docs/competitive-analysis-2026-08.md):
-- a tracked, assignable RFI log is table stakes across every general-purpose
-- competitor (Procore, Autodesk Construction Cloud, Buildertrend all treat
-- this as baseline project-communication infrastructure) and was entirely
-- absent from this codebase - there was no RFI concept anywhere.
--
-- An RFI is a question raised by a VENDOR holding an ACTIVE award at a
-- building, addressed to the DEVELOPER (the building's owning company).
-- Optionally scoped to a specific package (the trade the question concerns);
-- always scoped to a building. Lifecycle: open -> answered -> closed.
--
-- RLS follows the same three-way visibility shape as awards/field-log: the
-- developer sees every vendor's RFIs at its building; a vendor sees only its
-- own company's RFIs - one vendor's question must not leak to a different
-- vendor working the same building under a different package, same
-- reasoning as daily_logs (schema-field-log.sql).
--
-- Unlike field-log (vendor-write / developer-read-only), this is
-- bidirectional: the vendor asks and may close its own RFI; only the
-- developer (or admin) may write the answer. The RLS UPDATE policy below is
-- deliberately broad (either side may touch the row) - which FIELDS each
-- role may actually set is an app-layer contract in
-- server/src/routes/rfi.ts, matching change-orders.ts's EDITABLE_FIELDS
-- convention. RLS is the visibility/row boundary, not the field contract.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists rfis (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  developer_company_id uuid references companies(id) on delete set null,
  rfi_number text,
  subject text not null,
  question text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer text,
  answered_by_email text,
  answered_at timestamptz,
  due_date date,
  asked_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rfis_building on rfis (building_id, created_at desc);
create index if not exists idx_rfis_package on rfis (package_id);
create index if not exists idx_rfis_vendor on rfis (vendor_company_id);
create index if not exists idx_rfis_developer on rfis (developer_company_id);

-- A per-building RFI_NUMBER sequence, deliberately NOT derived from
-- `select count(*) from rfis where building_id = ...` at insert time: that
-- count runs under the INSERTING vendor's own RLS context, which (correctly)
-- only shows that vendor's own rows - so a second vendor's first RFI at a
-- building where a different vendor already has one would also count as 0
-- and collide on "RFI-1". This table is a dedicated, atomic counter shared
-- across every vendor at the building, immune to that RLS scoping.
create table if not exists rfi_counters (
  building_id uuid primary key references buildings(id) on delete cascade,
  next_number int not null default 1
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table rfis enable row level security;
alter table rfis force row level security;

drop policy if exists rfis_select on rfis;
create policy rfis_select on rfis
  for select using (
    exists (
      select 1 from buildings b
       where b.id = rfis.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists rfis_insert on rfis;
create policy rfis_insert on rfis
  for insert with check (
    (
      vendor_company_id::text = any(array(select current_user_company_ids()))
      and exists (
        select 1 from awards a
         where a.building_id = rfis.building_id
           and a.vendor_company_id = rfis.vendor_company_id
           and a.status = 'active'
      )
    )
    or current_user_is_admin()
  );

drop policy if exists rfis_update on rfis;
create policy rfis_update on rfis
  for update using (
    exists (
      select 1 from buildings b
       where b.id = rfis.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- rfi_counters RLS: writable (insert or bump) by any vendor that could also
-- create an RFI at this building (active award), or admin - the same
-- authorization boundary as rfis_insert, since bumping this counter only
-- ever happens as part of creating one.
alter table rfi_counters enable row level security;
alter table rfi_counters force row level security;

drop policy if exists rfi_counters_write on rfi_counters;
create policy rfi_counters_write on rfi_counters
  for all using (
    exists (
      select 1 from awards a
       where a.building_id = rfi_counters.building_id
         and a.vendor_company_id::text = any(array(select current_user_company_ids()))
         and a.status = 'active'
    )
    or current_user_is_admin()
  )
  with check (
    exists (
      select 1 from awards a
       where a.building_id = rfi_counters.building_id
         and a.vendor_company_id::text = any(array(select current_user_company_ids()))
         and a.status = 'active'
    )
    or current_user_is_admin()
  );
