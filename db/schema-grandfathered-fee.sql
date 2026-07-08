-- Divini Procure - GRANDFATHERED EXISTING-RELATIONSHIP FEE
-- =========================================================
-- Tracks a SPECIFIC developer (buyer company) <-> vendor company relationship
-- and, when the developer attests the relationship pre-existed Divini Procure
-- (already under contract, already working together, already in active
-- negotiations, or already selected/shortlisted), grandfathers THAT pair into a
-- 2% payment-authorization fee forever. The 2% applies ONLY to that one
-- developer-vendor pair, never globally to the vendor and never to other
-- developers.
--
-- Extends the EXISTING model: developers are companies(kind='buyer'),
-- vendors are companies(kind='vendor'), projects are buildings(id). This does
-- NOT touch referral_partners / partner_commissions (those stay as-is).
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-grandfathered-fee.sql
-- Zero em dashes by convention.

create table if not exists developer_vendor_relationships (
  id uuid primary key default gen_random_uuid(),
  developer_company_id uuid not null references companies(id) on delete cascade,
  vendor_company_id    uuid not null references companies(id) on delete cascade,
  project_id           uuid references buildings(id) on delete set null,

  -- no_prior_relationship | existing_relationship_claimed |
  -- existing_relationship_under_review | grandfathered_2_percent |
  -- standard_fee | disputed | inactive
  relationship_status  text not null default 'no_prior_relationship',

  -- developer attestation that the relationship pre-existed the platform
  existing_relationship_confirmed boolean default false,
  -- active_contract | active_negotiation | already_working_together |
  -- already_selected_or_shortlisted | prior_vendor_relationship | other
  existing_relationship_type      text,
  existing_relationship_confirmed_by text references users(id) on delete set null,
  existing_relationship_confirmed_at timestamptz,
  existing_relationship_notes     text,
  supporting_document_url         text,

  -- granular pre-platform flags (one or more may be true)
  active_contract_before_platform              boolean default false,
  active_negotiations_before_platform          boolean default false,
  already_working_together_before_platform     boolean default false,
  already_selected_or_shortlisted_before_platform boolean default false,

  -- grandfathered 2% fee state (relationship-specific, forever)
  grandfathered_fee_eligible        boolean default false,
  grandfathered_fee_percentage      numeric not null default 2.00,
  grandfathered_fee_applies_forever boolean default true,
  grandfathered_fee_started_at      timestamptz,

  -- standard fee captured for contrast/reporting (nullable; resolved from
  -- platform settings at calc time when null)
  standard_fee_percentage numeric,

  -- developer_checkbox | admin_override | contract_upload | negotiation_proof |
  -- legacy_relationship | manual_adjustment
  fee_rule_source text,

  -- not_required | pending_review | approved | rejected | needs_more_info
  admin_review_status text not null default 'not_required',
  admin_reviewed_by   text references users(id) on delete set null,
  admin_reviewed_at   timestamptz,
  admin_notes         text,

  audit_log_id uuid,
  created_by   text references users(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),

  -- one canonical relationship row per developer-vendor pair
  unique (developer_company_id, vendor_company_id)
);

create index if not exists dvr_developer_idx on developer_vendor_relationships(developer_company_id);
create index if not exists dvr_vendor_idx    on developer_vendor_relationships(vendor_company_id);
create index if not exists dvr_review_idx    on developer_vendor_relationships(admin_review_status);
create index if not exists dvr_status_idx    on developer_vendor_relationships(relationship_status);

-- Append-only audit trail for every relationship/fee event.
create table if not exists dvr_audit_log (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid references developer_vendor_relationships(id) on delete cascade,
  developer_company_id uuid,
  vendor_company_id    uuid,
  actor_user_id text,
  actor_email   text,
  -- relationship_created | existing_relationship_confirmed | status_change |
  -- admin_review | fee_override | fee_change | document_uploaded | disputed |
  -- deactivated
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists dvr_audit_rel_idx on dvr_audit_log(relationship_id);

-- Safety: ensure columns exist if an older partial version of the table was
-- created previously (no-ops when already present).
alter table developer_vendor_relationships add column if not exists project_id uuid references buildings(id) on delete set null;
alter table developer_vendor_relationships add column if not exists supporting_document_url text;
alter table developer_vendor_relationships add column if not exists standard_fee_percentage numeric;
alter table developer_vendor_relationships add column if not exists fee_rule_source text;
alter table developer_vendor_relationships add column if not exists admin_reviewed_by text;
alter table developer_vendor_relationships add column if not exists admin_reviewed_at timestamptz;
