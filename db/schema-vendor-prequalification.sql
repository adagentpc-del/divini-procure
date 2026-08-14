-- ============================================================================
-- Divini Procure - Vendor prequalification: license tracking + cross-company
-- compliance visibility (competitive gap #3, docs/competitive-analysis-2026-08.md).
-- ----------------------------------------------------------------------------
-- Closes the "insurance/COI/license compliance tracking" half of gap #3 as a
-- FACTS-ONLY feature, mirroring lib/vendor-signals.ts's explicit design rule
-- ("do not create an opaque AI vendor score... capture factual signals").
-- Deliberately does NOT fold compliance into the Divini Score in
-- lib/procure-moat.ts: that score's 100 points are already fully allocated
-- across five existing factors, and silently reweighting it would change
-- every existing vendor's score platform-wide - a bigger call than a single
-- gap-closure pass should make unilaterally. Compliance is surfaced as its
-- own explicit fact set instead (see lib/prequalification.ts).
--
-- vendor_licenses mirrors coi_certificates (schema-coi.sql) exactly - same
-- shape, same lifecycle (active/expired/suspended), same building-optional
-- linkage. license_type is free text, not an enum, because trade/business
-- license categories vary by jurisdiction far more than insurance types do.
--
-- license_requirements mirrors coi_requirements exactly (building-scoped
-- minimum requirements a developer sets).
--
-- RLS: base ownership is identical to coi_certificates (owning company or
-- admin may read/write). This migration ALSO adds one new ADDITIVE select
-- policy to coi_certificates itself, and an equivalent one on
-- vendor_licenses: a developer company may READ (never write) a vendor's
-- certificates/licenses once a real relationship exists between them (the
-- vendor has bid on or been invited to one of that developer's packages) -
-- the same two-party relationship rule already used by vendor-signals.ts
-- and financial-summary.ts. Without this, "vendor prequalification" would
-- be meaningless: today a developer cannot see a bidding vendor's COI
-- status at all (coi_certificates_policy only ever permitted the owning
-- company or admin). This does not weaken write protection - insert/
-- update/delete remain gated by the original owner-or-admin policy only.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create table if not exists vendor_licenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,
  license_type text not null,
  license_number text,
  issuing_authority text,
  jurisdiction text,
  effective_date date,
  expiry_date date not null,
  storage_path text,
  status text not null default 'active' check (status in ('active','expired','suspended')),
  verified_by text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists license_requirements (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  license_type text not null,
  required boolean not null default true,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_vendor_licenses_company on vendor_licenses(company_id);
create index if not exists idx_vendor_licenses_expiry on vendor_licenses(expiry_date);
create index if not exists idx_vendor_licenses_building on vendor_licenses(building_id);
create index if not exists idx_license_requirements_building on license_requirements(building_id);

-- ============================================================================
-- vendor_licenses RLS
-- ============================================================================
alter table vendor_licenses enable row level security;
alter table vendor_licenses force row level security;

drop policy if exists vendor_licenses_owner_policy on vendor_licenses;
create policy vendor_licenses_owner_policy on vendor_licenses
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists vendor_licenses_relationship_select on vendor_licenses;
create policy vendor_licenses_relationship_select on vendor_licenses
  for select using (
    exists (
      select 1 from packages p
       join buildings b on b.id = p.building_id
      where b.company_id::text = any(array(select current_user_company_ids()))
        and (
          exists (select 1 from bids bd where bd.package_id = p.id and bd.vendor_company_id = vendor_licenses.company_id)
          or exists (select 1 from bid_invites bi where bi.package_id = p.id and bi.vendor_company_id = vendor_licenses.company_id)
        )
    )
  );

alter table license_requirements enable row level security;
alter table license_requirements force row level security;

drop policy if exists license_requirements_select on license_requirements;
create policy license_requirements_select on license_requirements
  for select using (true);

drop policy if exists license_requirements_write on license_requirements;
create policy license_requirements_write on license_requirements
  for all using (
    exists (
      select 1 from buildings b
       where b.id = license_requirements.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- coi_certificates: additive relationship-based SELECT policy (see header).
-- The pre-existing coi_certificates_policy ("for all", owner-or-admin) is
-- untouched, so write access is unchanged; this is purely an additional
-- read path for a genuinely related developer.
-- ============================================================================
drop policy if exists coi_certificates_relationship_select on coi_certificates;
create policy coi_certificates_relationship_select on coi_certificates
  for select using (
    exists (
      select 1 from packages p
       join buildings b on b.id = p.building_id
      where b.company_id::text = any(array(select current_user_company_ids()))
        and (
          exists (select 1 from bids bd where bd.package_id = p.id and bd.vendor_company_id = coi_certificates.company_id)
          or exists (select 1 from bid_invites bi where bi.package_id = p.id and bi.vendor_company_id = coi_certificates.company_id)
        )
    )
  );
