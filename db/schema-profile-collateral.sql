-- Divini Procure - PROFILE COLLATERAL: pitch decks / marketing collateral +
-- custom programs / offerings shown on a company profile.
-- =========================================================================
-- Additive layer that lets ANY company (a real-estate developer / buyer OR a
-- vendor) attach uploaded pitch decks / marketing collateral and publish custom
-- programs / offerings on its profile. This complements (does NOT duplicate) the
-- existing teasers-profiles layer:
--
--   * opportunity_teasers       -> investment-compliance-constrained teasers
--                                  (CTA limited to request access / info / intro).
--   * developer_public_profiles -> the developer's public bio / markets.
--   * THIS FILE                  -> general uploaded collateral + general custom
--                                  offerings with a free-form CTA, for buyers AND
--                                  vendors.
--
-- Decks REUSE the existing documents pipeline: a profile_decks row references a
-- documents.storage_path that was created by the standard POST /api/documents
-- multipart upload, and downloads use the same signed-url path. We do not invent
-- new storage here.
--
-- Idempotent: safe to re-run. Apply via psql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-profile-collateral.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. PROFILE DECKS
-- A pitch deck / marketing collateral file attached to a company profile. The
-- bytes live on disk under documents.storage_path (uploaded via the standard
-- documents pipeline); this row carries the public-facing title, visibility and
-- ordering. is_public controls whether it surfaces on the public profile.
-- ---------------------------------------------------------------------------
create table if not exists profile_decks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  storage_path text not null,
  title text,
  description text,
  file_name text,
  is_public boolean default true,
  sort int default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. PROFILE PROGRAMS / OFFERINGS
-- A custom program / offering a company publishes on its profile: a title, a
-- short summary, longer details, free-form price / terms text, and a call to
-- action. active controls public visibility; sort controls ordering. This is a
-- general marketing offering and is NOT investment-compliance-constrained the
-- way opportunity_teasers are.
-- ---------------------------------------------------------------------------
create table if not exists profile_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  title text,
  summary text,
  details text,
  price_terms text,
  cta_label text,
  cta_url text,
  active boolean default true,
  sort int default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_profile_decks_company_id on profile_decks (company_id);
create index if not exists idx_profile_programs_company_id on profile_programs (company_id);
