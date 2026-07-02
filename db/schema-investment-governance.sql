-- Divini Procure - INVESTMENT GOVERNANCE (broker / permissions / compliance)
-- =========================================================================
-- ADDITIVE governance layer that sits ALONGSIDE the existing investment system
-- (schema-investment.sql). It does NOT modify any existing table. It adds:
--
--   broker_profiles        a capital-introducer / broker / advisor identity,
--                          admin-reviewed before it is approved.
--   investor_permissions   explicit, admin-granted permission LEVELS that tie an
--                          existing investor_profiles row (optionally a specific
--                          investment_programs row) to a capability level.
--   program_compliance     per-program legal + compliance review state, sponsor
--                          disclosure, offering exemption, and a restricted
--                          materials flag. One row per program.
--   document_access_log    an append-only audit trail of who viewed which
--                          offering / governance document and when.
--
-- Compliance posture (mirrors the existing layer): AI / automation may NEVER
-- verify accreditation, approve investors / brokers, or publish offerings. Every
-- status here defaults to a pending / not-started state and only an admin/human
-- action advances it. No "invest now" semantics; access is "request access".
--
-- Foreign keys are intentionally LOOSE (no hard references to investor_profiles /
-- investment_programs) so this file is safe to apply independently and in any
-- order relative to schema-investment.sql. The route layer enforces linkage.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-investment-governance.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- BROKER / CAPITAL INTRODUCER identity. Keyed by user (one profile per user).
-- License status is self-reported and admin-confirmed; AI never sets it to a
-- verified value. status starts at pending_review.
-- ---------------------------------------------------------------------------
create table if not exists broker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique,
  company_id uuid,
  broker_type text check (broker_type in (
    'capital_introducer','broker','advisor','referral_partner','family_office_rep'
  )),
  license_status text default 'not_provided',
  license_number text,
  investor_network_type text,
  compliance_notes text,
  rev_share_terms text,
  status text default 'pending_review' check (status in (
    'pending_review','approved','restricted','rejected'
  )),
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- INVESTOR PERMISSION LEVELS. An admin grants an explicit capability level to
-- an investor, optionally scoped to a single program. Never auto-granted.
--   investor_basic    public teaser / educational only
--   investor_budget   may see budget / sizing detail
--   investor_approval may participate in approval / private review flows
--   owner_full        full owner-equivalent visibility
--   asset_manager     asset-manager visibility across a program
-- ---------------------------------------------------------------------------
create table if not exists investor_permissions (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid,
  program_id uuid,
  level text check (level in (
    'investor_basic','investor_budget','investor_approval','owner_full','asset_manager'
  )),
  granted_by text,
  notes text,
  created_at timestamptz default now(),
  unique (investor_id, program_id, level)
);

-- ---------------------------------------------------------------------------
-- PER-PROGRAM COMPLIANCE. One row per program. Legal + compliance review states
-- start at not_started and only an admin advances them. restricted_materials
-- gates whether offering materials may be surfaced at all.
-- ---------------------------------------------------------------------------
create table if not exists program_compliance (
  id uuid primary key default gen_random_uuid(),
  program_id uuid unique,
  legal_review_status text default 'not_started' check (legal_review_status in (
    'not_started','in_review','cleared','flagged'
  )),
  compliance_review_status text default 'not_started' check (compliance_review_status in (
    'not_started','in_review','cleared','flagged'
  )),
  sponsor_disclosure text,
  offering_exemption_type text,
  restricted_materials boolean default false,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- DOCUMENT ACCESS LOG. Append-only audit trail. Written whenever a viewer opens
-- an offering / governance document. Never updated or deleted by the app.
-- ---------------------------------------------------------------------------
create table if not exists document_access_log (
  id uuid primary key default gen_random_uuid(),
  doc_type text,
  doc_id uuid,
  program_id uuid,
  viewer_user_id text,
  viewer_email text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes on the obvious lookup columns.
-- ---------------------------------------------------------------------------
create index if not exists idx_broker_profiles_user on broker_profiles (user_id);
create index if not exists idx_investor_permissions_investor on investor_permissions (investor_id);
create index if not exists idx_program_compliance_program on program_compliance (program_id);
create index if not exists idx_document_access_log_program on document_access_log (program_id);
