-- Divini Procure - OPPORTUNITY TEASERS + PUBLIC/PRIVATE DEVELOPER PROFILES +
-- EVENT-SPACE / VENUE BRIDGE PROFILES
-- =========================================================================
-- Additive layer on top of the existing model (companies, buildings=projects,
-- investment_programs, company_members). Three concerns:
--
--   1. opportunity_teasers: a PUBLIC-SAFE summary of an investment program a
--      developer wants to surface to the marketplace. Teasers must NEVER carry
--      "invest now" language; the call to action is a request for access /
--      information / introduction. Restricted program financials never live
--      here; only the deliberately public ranges the developer stores on the
--      teaser itself.
--
--   2. developer_public_profiles: the PUBLIC face of a developer company. The
--      private side (subscriptions, internal fees, deal pipeline, investor
--      financials) stays in its existing tables and is never exposed here.
--
--   3. event_space_profiles: a bridge profile letting a developer surface an
--      event space / venue tied to a project, linking out to Divini Partners
--      for venue and sponsorship workflows.
--
-- Money is not stored here; teasers carry human-readable RANGE strings only, so
-- no exact restricted figures leak. Idempotent: safe to re-run. Apply via psql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-teasers-profiles.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. OPPORTUNITY TEASERS
-- A public-safe teaser derived from an investment program. request_cta is the
-- only call to action and is constrained to non-solicitation language.
-- ---------------------------------------------------------------------------
create table if not exists opportunity_teasers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  company_id uuid,
  headline text,
  asset_class text,
  market text,
  target_raise_range text,
  min_investment_range text,
  investor_type text,
  accredited_required boolean default true,
  nda_required boolean default false,
  public_highlights text[],
  request_cta text default 'Request introduction',
  is_public boolean default false,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. DEVELOPER PUBLIC PROFILES
-- One PUBLIC profile per developer company. Private posture stays elsewhere.
-- ---------------------------------------------------------------------------
create table if not exists developer_public_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  bio text,
  markets text[],
  asset_classes text[],
  completed_projects text,
  public_opportunities boolean default true,
  is_public boolean default true,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 3. EVENT-SPACE / VENUE BRIDGE PROFILES
-- A developer surfaces an event space / venue, optionally tied to a project.
-- venue_profile_link bridges out to Divini Partners.
-- ---------------------------------------------------------------------------
create table if not exists event_space_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references buildings(id) on delete set null,
  name text,
  event_space_available boolean default true,
  capacity int,
  photos text[],
  venue_profile_link text,
  preferred_vendors text[],
  procurement_needs text,
  sponsorship_opportunities text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_opportunity_teasers_program_id
  on opportunity_teasers (program_id);
create index if not exists idx_developer_public_profiles_company_id
  on developer_public_profiles (company_id);
create index if not exists idx_event_space_profiles_company_id
  on event_space_profiles (company_id);
