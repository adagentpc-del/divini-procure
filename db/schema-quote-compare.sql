-- ============================================================================
-- Divini Procure — Quote Comparison Engine (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Enhancement to the existing schema (db/schema.sql). Adds:
--   * bid_recommendations: the buyer's saved comparison decision per package.
--   * comparison columns on `bids` (lead_time_days, freight_cents, warranty_text,
--     install_cents, scope_notes) so vendors/buyers can capture apples-to-apples
--     dimensions beyond price.
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-quote-compare.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- comparison dimensions on bids (add only if missing) ----------
alter table bids add column if not exists lead_time_days int;
alter table bids add column if not exists freight_cents bigint;
alter table bids add column if not exists warranty_text text;
alter table bids add column if not exists install_cents bigint;
alter table bids add column if not exists scope_notes text;

-- ---------- buyer's recommendation / award decision per package ----------
create table if not exists bid_recommendations (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  selected_bid_id uuid references bids(id),
  notes text,
  status text default 'draft',
  decided_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One recommendation row per package (upsert target).
create unique index if not exists uniq_bid_recommendations_package
  on bid_recommendations(package_id);
