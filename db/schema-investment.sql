-- Divini Procure - DEVELOPER INVESTMENT + INVESTOR MATCHING
-- =========================================================
-- Additive layer that turns the existing developer organization (a company of
-- kind='buyer') into an entity that can ALSO raise capital, and adds an
-- investor identity (keyed by user, no investor company kind required) plus a
-- DETERMINISTIC matching pipeline between investment programs and investors.
--
-- Reuses the existing model: developers are companies(kind='buyer'), projects
-- are buildings(id), users are users(id), membership is company_members. ONE
-- subscription (subscription_entitlements) covers BOTH the procurement profile
-- and the investment profile for a company.
--
-- Compliance posture: AI/deterministic logic may SCORE and SURFACE matches, but
-- it may NOT verify accreditation, approve investors, or publish offerings. All
-- of those remain human/admin actions. Money is stored as integer cents.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-investment.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-investment.sql)
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ONE subscription covers BOTH the procurement profile AND the investment
-- profile for a company. Net-new; does not replace any existing billing.
-- ---------------------------------------------------------------------------
create table if not exists subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  plan text default 'standard',
  procurement_profile boolean default true,
  investment_profile boolean default true,
  seats int default 2,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Seats inside a developer organization. Distinguishes procurement vs
-- investment vs admin seats. Permissions is a free-form jsonb grant blob.
-- ---------------------------------------------------------------------------
create table if not exists developer_seats (
  id uuid primary key default gen_random_uuid(),
  organization_company_id uuid references companies(id) on delete cascade,
  user_id text,
  email text,
  seat_type text check (seat_type in (
    'developer_procurement_seat',
    'developer_investment_seat',
    'developer_admin_seat'
  )),
  permissions jsonb,
  status text default 'active',
  invited_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_company_id, email, seat_type)
);

-- ---------------------------------------------------------------------------
-- A developer organization's investment profile (one per company). This is the
-- top-level capital-raising posture; individual deals live in
-- investment_programs.
-- ---------------------------------------------------------------------------
create table if not exists developer_investment_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  investment_contact_name text,
  investment_contact_email text,
  investment_contact_phone text,
  capital_raising_status text,
  open_to_investors boolean,
  accredited_accepted boolean,
  non_accredited_accepted boolean,
  min_investment_cents bigint,
  max_investment_cents bigint,
  preferred_investor_type text,
  target_raise_cents bigint,
  capital_stack text,
  offering_type text,
  investment_structure text,
  target_returns text,
  hold_period text,
  distribution_schedule text,
  risk_level text,
  markets text[],
  asset_classes text[],
  track_record text,
  nda_required boolean,
  accreditation_required boolean,
  kyc_required boolean,
  qualification_requirements text,
  compliance_notes text,
  status text default 'draft' check (status in (
    'draft','submitted_for_review','needs_edits','approved','active','paused','closed','rejected'
  )),
  admin_review_status text default 'not_required',
  admin_notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- An individual investment program / offering (a deal). Optionally tied to a
-- project (buildings.id). Visibility + status drive what investors can see.
-- ---------------------------------------------------------------------------
create table if not exists investment_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references buildings(id) on delete set null,
  name text,
  program_type text,
  asset_class text,
  location text,
  project_stage text,
  target_raise_cents bigint,
  min_investment_cents bigint,
  max_investment_cents bigint,
  investor_type_accepted text,
  accredited_only boolean,
  non_accredited_accepted boolean,
  offering_type text,
  investment_vehicle text,
  projected_return text,
  preferred_return text,
  equity_multiple text,
  irr_target text,
  hold_period text,
  distribution_schedule text,
  use_of_funds text,
  capital_stack text,
  risk_level text,
  exit_strategy text,
  qualification_requirements text,
  nda_required boolean,
  kyc_required boolean,
  proof_of_funds_required boolean,
  visibility text default 'public_teaser' check (visibility in (
    'public_teaser','approved_investor_preview','nda_required','accredited_only',
    'non_accredited_program','family_office_only','admin_approved_only',
    'private_invite_only','closed'
  )),
  status text default 'draft' check (status in (
    'draft','submitted_for_review','needs_edits','approved','active','paused','closed','rejected'
  )),
  admin_review_status text default 'not_required',
  admin_notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Offering documents attached to a program. May be NDA-gated or
-- accredited-only; the route layer enforces who can fetch them.
-- ---------------------------------------------------------------------------
create table if not exists offering_documents (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  company_id uuid,
  doc_type text check (doc_type in ('deck','offering_memo','track_record','other')),
  title text,
  url text,
  nda_gated boolean default false,
  accredited_only boolean default false,
  uploaded_by text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor identity (keyed by user). access_level + status + admin_review
-- gate what an investor may see. PII is masked to developers until intro.
-- ---------------------------------------------------------------------------
create table if not exists investor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique,
  company_id uuid,
  full_name text,
  entity_name text,
  email text,
  phone text,
  location text,
  investor_type text,
  accreditation_status text,
  entity_type text,
  website text,
  preferred_contact text,
  status text default 'starter_profile',
  access_level text default 'public_teaser_only',
  admin_review_status text default 'pending_review',
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor matching preferences (drives deterministic scoring).
-- ---------------------------------------------------------------------------
create table if not exists investor_preferences (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid unique references investor_profiles(id) on delete cascade,
  asset_classes text[],
  markets text[],
  min_investment_cents bigint,
  max_investment_cents bigint,
  total_allocation_cents bigint,
  preferred_deal_size_cents bigint,
  preferred_hold_period text,
  target_return text,
  risk_tolerance text,
  income_vs_growth text,
  liquidity_preference text,
  preferred_structure text,
  deal_types text[],
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor self-reported qualification + admin verification status. AI must
-- never set the *_verification / kyc / aml status to anything verified.
-- ---------------------------------------------------------------------------
create table if not exists investor_qualification_records (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investor_profiles(id) on delete cascade,
  accredited text,
  non_accredited boolean,
  qualified_purchaser text,
  family_office boolean,
  proof_of_funds boolean,
  kyc_completed boolean,
  nda_willing boolean,
  can_review_private boolean,
  education_interest boolean,
  investment_experience text,
  jurisdiction text,
  suitability_notes text,
  accreditation_verification_status text default 'not_verified',
  kyc_status text default 'not_started',
  aml_status text default 'not_started',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists investor_documents (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investor_profiles(id) on delete cascade,
  doc_type text,
  url text,
  status text default 'uploaded',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Introduction requests: an investor asks to be introduced to a program. The
-- developer (or admin) approves/declines. pipeline_status tracks the deal flow.
-- ---------------------------------------------------------------------------
create table if not exists investor_introduction_requests (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  investor_id uuid references investor_profiles(id) on delete cascade,
  status text default 'requested' check (status in (
    'requested','approved','declined','info_requested','nda_required','intro_made'
  )),
  pipeline_status text default 'matched',
  developer_notes text,
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (program_id, investor_id)
);

create table if not exists nda_records (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete set null,
  investor_id uuid references investor_profiles(id) on delete cascade,
  signer_name text,
  signed_at timestamptz default now(),
  ip text,
  audit jsonb
);

create table if not exists compliance_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text,
  subject_id uuid,
  flag text,
  level text,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  resolved boolean default false
);

create table if not exists investment_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text,
  actor_email text,
  action text,
  subject_type text,
  subject_id uuid,
  detail jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes on the obvious foreign keys + lookup columns.
-- ---------------------------------------------------------------------------
create index if not exists idx_dev_seats_org on developer_seats (organization_company_id);
create index if not exists idx_dev_seats_user on developer_seats (user_id);
create index if not exists idx_inv_profiles_company on developer_investment_profiles (company_id);
create index if not exists idx_inv_programs_company on investment_programs (company_id);
create index if not exists idx_inv_programs_project on investment_programs (project_id);
create index if not exists idx_inv_programs_status on investment_programs (status);
create index if not exists idx_inv_programs_visibility on investment_programs (visibility);
create index if not exists idx_offering_docs_program on offering_documents (program_id);
create index if not exists idx_investor_profiles_user on investor_profiles (user_id);
create index if not exists idx_investor_prefs_investor on investor_preferences (investor_id);
create index if not exists idx_investor_qual_investor on investor_qualification_records (investor_id);
create index if not exists idx_investor_docs_investor on investor_documents (investor_id);
create index if not exists idx_intro_requests_program on investor_introduction_requests (program_id);
create index if not exists idx_intro_requests_investor on investor_introduction_requests (investor_id);
create index if not exists idx_nda_records_program on nda_records (program_id);
create index if not exists idx_nda_records_investor on nda_records (investor_id);
create index if not exists idx_compliance_flags_subject on compliance_flags (subject_type, subject_id);
create index if not exists idx_inv_audit_subject on investment_audit_log (subject_type, subject_id);
