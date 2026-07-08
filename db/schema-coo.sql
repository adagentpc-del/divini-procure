-- ============================================================================
-- Divini Procure - AI COO + Business Health + Command Center (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Deterministic executive-intelligence layer for Divini Procure, ported in
-- shape from Divini Partners (db/schema-coo-health.sql + schema-coo-tasks.sql)
-- and mapped to the PROCUREMENT domain. Two tables:
--
--   * business_health_scores: a 0-100 org (company) health score plus the
--     per-dimension breakdown (pipeline / conversion / revenue / delivery /
--     submittals / compliance / relationships) as jsonb. One row is written per
--     recompute so a company keeps a history; the latest row is the current.
--   * coo_tasks: a ranked executive task feed generated from real procurement
--     signals (overdue submittals, late deliveries, packages past deadline with
--     no award, pending grandfathered-relationship reviews, missing docs on
--     awarded bids). score = impact * urgency. Deduped by (company_id, title).
--
-- Everything is computed deterministically in server/src/lib/procure-coo.ts; no
-- external LLM is called. This file is ADDITIVE and IDEMPOTENT (create table if
-- not exists ...). Apply once, AFTER db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-coo.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-coo.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- business health scores (org-level, with history) ----------
create table if not exists business_health_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  score int,
  dimensions jsonb,
  computed_at timestamptz default now()
);

create index if not exists idx_business_health_company on business_health_scores(company_id);

-- ---------- COO task feed (ranked, deduped per company by title) ----------
-- status: open | in_progress | done | dismissed
-- impact / urgency are 1..5 each; score is impact * urgency (1..25).
create table if not exists coo_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  title text,
  detail text,
  category text,
  impact int default 0,
  urgency int default 0,
  score int default 0,
  status text default 'open' check (status in ('open','in_progress','done','dismissed')),
  link text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_coo_tasks_company on coo_tasks(company_id);

-- A company has at most one row per generated task title, so regeneration is an
-- upsert rather than an append (keeps the feed from duplicating on every load).
create unique index if not exists uq_coo_tasks_company_title on coo_tasks(company_id, title);
