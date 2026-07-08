-- ============================================================================
-- Divini Procure — CURRENT ENGAGEMENTS tracker (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A lightweight "what you have going on" log so existing vendors / developers /
-- investors can record and track the work they already have in flight, separate
-- from formal procurement packages/bids. Company-scoped via company_members.
--
-- APPLY (run once on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-engagements.sql
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists current_engagements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  created_by text references users(id),
  title text not null,
  type text,
  status text default 'active',
  counterparty text,
  value_cents bigint,
  location text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_current_engagements_company on current_engagements(company_id);
