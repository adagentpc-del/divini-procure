-- ============================================================================
-- Divini Procure -- Developer onboarding enhancement (idempotent).
-- ----------------------------------------------------------------------------
-- Adds the richer real-estate-DEVELOPER profile fields to `companies` and makes
-- the `documents` table able to attach brand media (logo/images/deck/brochure)
-- to a company via company_id + category.
--
-- Safe to re-run: every statement is guarded with "if not exists".
--
-- APPLY (manual, on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-developer-onboarding.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- companies: richer developer profile ----------
alter table companies add column if not exists website text;
alter table companies add column if not exists description text;
alter table companies add column if not exists state text;            -- distinct from existing region
alter table companies add column if not exists ownership_group text;
alter table companies add column if not exists development_team text;
alter table companies add column if not exists asset_types text[] default '{}';
alter table companies add column if not exists headquarters text;      -- optional, distinct from street

-- ---------- documents: allow company-level brand media + a category ----------
-- (documents already has company_id in the base schema, but keep this guarded so
--  this file is self-sufficient even against older databases.)
alter table documents add column if not exists company_id uuid references companies(id) on delete cascade;
alter table documents add column if not exists category text;          -- logo|image|deck|brochure|other

create index if not exists idx_documents_company on documents(company_id);
create index if not exists idx_documents_category on documents(category);
