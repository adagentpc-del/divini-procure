-- ============================================================================
-- Divini Procure - Project closeout: final punch list + warranty tracking.
-- ----------------------------------------------------------------------------
-- Fresh competitive scan, 2026-08-17 (docs/competitive-analysis-2026-08.md,
-- gap #17): Buildertrend/Procore/BuildOps all track a final walkthrough
-- punch list and a warranty period as distinct concepts from ordinary
-- project management. Divini already has things that are NOT this:
--   * schema-package-closeout.sql's financially_closed_at/final_cost_cents
--     is a purely FINANCIAL closeout marker (P1-13/P1-18) - no physical
--     walkthrough concept at all.
--   * delivery_punch_items (schema-delivery.sql) are per-DELIVERY material
--     punch items, not a project-level final-walkthrough artifact - and
--     have no RLS at all (a pre-existing gap this file does not touch).
--   * award_documents' 'closeout'/'warranty' doc kinds (award-workflow.ts)
--     are just file attachments (a PDF labeled "warranty"), not a
--     structured, trackable claim workflow.
--
-- Scoped to PACKAGE (matches change_orders/delivery's own granularity -
-- closeout happens per trade, not once for the whole building). The
-- developer raises punch items and warranty claims, and sets warranty
-- terms; the vendor resolves punch items and works claims; the developer
-- verifies a punch item's fix or resolves/denies a claim. Bidirectional,
-- same shape as RFI-01 - RLS defines the row boundary,
-- server/src/routes/closeout.ts enforces the field-level contract per role.
--
-- warranty_start_date/warranty_months/warranty_terms live on `packages`
-- itself (three plain columns), matching schema-package-closeout.sql's own
-- precedent of adding closeout fields directly to packages rather than a
-- one-row-per-package satellite table.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

alter table packages add column if not exists warranty_start_date date;
alter table packages add column if not exists warranty_months int;
alter table packages add column if not exists warranty_terms text;
alter table packages add column if not exists warranty_set_by text;
alter table packages add column if not exists warranty_set_at timestamptz;

create table if not exists closeout_punch_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'verified')),
  raised_by_email text,
  resolved_by_email text,
  resolved_at timestamptz,
  verified_by_email text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_closeout_punch_package on closeout_punch_items (package_id, created_at desc);
create index if not exists idx_closeout_punch_building on closeout_punch_items (building_id);
create index if not exists idx_closeout_punch_vendor on closeout_punch_items (vendor_company_id);

create table if not exists warranty_claims (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'denied')),
  filed_by_email text,
  resolution_notes text,
  resolved_by_email text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_warranty_claims_package on warranty_claims (package_id, created_at desc);
create index if not exists idx_warranty_claims_building on warranty_claims (building_id);
create index if not exists idx_warranty_claims_vendor on warranty_claims (vendor_company_id);

-- ============================================================================
-- RLS: same three-way visibility shape as awards/field-log/rfi - the
-- developer (building owner) sees every vendor's items at that building; a
-- vendor sees only its own company's items. Bidirectional write (the
-- developer raises/verifies items and claims; the vendor resolves punch
-- items and works claims); the field-level contract per role lives in
-- closeout.ts, same split as rfi.ts.
-- ============================================================================

alter table closeout_punch_items enable row level security;
alter table closeout_punch_items force row level security;

drop policy if exists closeout_punch_items_select on closeout_punch_items;
create policy closeout_punch_items_select on closeout_punch_items
  for select using (
    exists (
      select 1 from buildings b
       where b.id = closeout_punch_items.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists closeout_punch_items_insert on closeout_punch_items;
create policy closeout_punch_items_insert on closeout_punch_items
  for insert with check (
    exists (
      select 1 from buildings b
       where b.id = closeout_punch_items.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists closeout_punch_items_update on closeout_punch_items;
create policy closeout_punch_items_update on closeout_punch_items
  for update using (
    exists (
      select 1 from buildings b
       where b.id = closeout_punch_items.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

alter table warranty_claims enable row level security;
alter table warranty_claims force row level security;

drop policy if exists warranty_claims_select on warranty_claims;
create policy warranty_claims_select on warranty_claims
  for select using (
    exists (
      select 1 from buildings b
       where b.id = warranty_claims.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists warranty_claims_insert on warranty_claims;
create policy warranty_claims_insert on warranty_claims
  for insert with check (
    exists (
      select 1 from buildings b
       where b.id = warranty_claims.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists warranty_claims_update on warranty_claims;
create policy warranty_claims_update on warranty_claims
  for update using (
    exists (
      select 1 from buildings b
       where b.id = warranty_claims.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
