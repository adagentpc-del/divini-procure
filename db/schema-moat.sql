-- ============================================================================
-- Divini Procure - INTELLIGENCE MOAT (Divini Scores + Relationship Graph)
-- ----------------------------------------------------------------------------
-- The compounding-intelligence layer for the procurement domain. Two persisted
-- artifacts back the moat features:
--
--   divini_scores       a per-company 0..100 reputation/health score with the
--                       deterministic factor breakdown that produced it. One
--                       latest row per company (recomputed on demand) plus the
--                       prior rows kept as history (computed_at ordered).
--
--   relationship_edges  a materialized company-to-company graph derived from
--                       real procurement signals (bids, awards, grandfathered
--                       relationships, current engagements). The graph powers
--                       the Relationship Graph view and relationship-breadth
--                       scoring. Upserted by buildRelationshipEdges().
--
-- The War Room is computed live (no table) from the existing schema.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once on the
-- local Postgres at localhost:5433, AFTER db/schema.sql and the other add-ons:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-moat.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Persisted Divini Score per company. entity_kind mirrors companies.kind
-- ('buyer' = developer, 'vendor'). factors holds the deterministic component
-- breakdown that produced the score, so the UI can render the bars without
-- recomputing. New rows are appended on each recompute; the latest (max
-- computed_at) is the current score.
create table if not exists divini_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  entity_kind text,
  score int,
  factors jsonb,
  computed_at timestamptz default now()
);

create index if not exists idx_divini_scores_company on divini_scores(company_id);
create index if not exists idx_divini_scores_computed on divini_scores(computed_at);

-- Company-to-company relationship edges. One canonical row per
-- (from, to, edge_type) triple, upserted on rebuild. weight accumulates signal
-- strength (e.g. number of bids / awards), detail carries the contextual payload.
create table if not exists relationship_edges (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid references companies(id) on delete cascade,
  to_company_id uuid references companies(id) on delete cascade,
  edge_type text,
  weight numeric default 1,
  detail jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (from_company_id, to_company_id, edge_type)
);

create index if not exists idx_relationship_edges_from on relationship_edges(from_company_id);
create index if not exists idx_relationship_edges_to on relationship_edges(to_company_id);
