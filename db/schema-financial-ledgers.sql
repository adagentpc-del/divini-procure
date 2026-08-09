-- ============================================================================
-- Divini Procure - Phase 1: Project Budget + Package Allowance Ledgers.
-- ----------------------------------------------------------------------------
-- The Phase 0 audit found `buildings.budget` effectively dead: a single
-- numeric column, developer-entered, never reconciled against anything, that
-- an UPDATE could silently overwrite with no history. This file replaces that
-- with a typed, historically-honest ledger at both the project (buildings)
-- and package levels, per the Phase 1 instruction: "A user must not be able
-- to change $30,000,000 to $35,000,000 and erase the fact that the project
-- originally had a $30M budget."
--
-- `buildings.budget` (legacy numeric, dollars) is left in place, untouched -
-- no blind backfill into the new typed cents columns (Phase 0's own design
-- proposal explicitly left this as a Phase 1 decision to make "with real data
-- in front of them, not guessed here"; this migration still declines to guess
-- it, since a numeric dollar figure with no recorded provenance cannot be
-- safely asserted to be an "original" budget). New projects/packages start
-- their ledger at zero revisions until a developer explicitly records an
-- original budget/allowance via the Phase 1 API.
--
-- Both revision tables are APPEND-ONLY by design: RLS grants SELECT + INSERT
-- only (no UPDATE/DELETE policy is defined, and both tables FORCE row level
-- security, so every role - including the owning company - is denied UPDATE/
-- DELETE by default). A correction is a new revision row, never an edit to an
-- old one. Money is integer cents (bigint), matching the rest of the Phase 0/1
-- money-handling code. Idempotent: safe to re-run. Zero em dashes.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- project (building) budget: typed columns + revision history ----
alter table buildings add column if not exists budget_original_cents bigint;
alter table buildings add column if not exists budget_current_cents bigint;
alter table buildings add column if not exists contingency_cents bigint;

create table if not exists building_budget_revisions (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  revision_number int not null,
  previous_amount_cents bigint,
  new_amount_cents bigint not null,
  contingency_cents bigint,
  reason text,
  actor_user_id text,
  actor_email text,
  created_at timestamptz not null default now(),
  unique (building_id, revision_number)
);
create index if not exists idx_building_budget_revisions_building
  on building_budget_revisions(building_id, revision_number);

-- ---------- package allowance: typed columns + revision history ------------
-- packages.budget_min/budget_max remain the pre-existing developer estimate
-- RANGE ("Estimate" per the Phase 1 spec's package financial model, section
-- 10) - a separate concept from the canonical allowance ledger below, kept
-- side by side rather than merged, since a range estimate and a single
-- approved allowance answer different questions.
alter table packages add column if not exists allowance_original_cents bigint;
alter table packages add column if not exists allowance_current_cents bigint;

create table if not exists package_allowance_revisions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  revision_number int not null,
  previous_amount_cents bigint,
  new_amount_cents bigint not null,
  reason text,
  actor_user_id text,
  actor_email text,
  created_at timestamptz not null default now(),
  unique (package_id, revision_number)
);
create index if not exists idx_package_allowance_revisions_package
  on package_allowance_revisions(package_id, revision_number);

-- ============================================================================
-- RLS - append-only: SELECT + INSERT for the project's developer company (or
-- admin); no UPDATE/DELETE policy anywhere, so FORCE ROW LEVEL SECURITY denies
-- both to every role, including the owning company itself and the table
-- owner. Mirrors buildings_write / packages_write's own company-membership
-- join pattern (db/schema-rls.sql).
-- ============================================================================
alter table building_budget_revisions enable row level security;
alter table building_budget_revisions force row level security;

drop policy if exists building_budget_revisions_select on building_budget_revisions;
create policy building_budget_revisions_select on building_budget_revisions
  for select using (
    exists (
      select 1 from buildings b
       where b.id = building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists building_budget_revisions_insert on building_budget_revisions;
create policy building_budget_revisions_insert on building_budget_revisions
  for insert with check (
    exists (
      select 1 from buildings b
       where b.id = building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

alter table package_allowance_revisions enable row level security;
alter table package_allowance_revisions force row level security;

drop policy if exists package_allowance_revisions_select on package_allowance_revisions;
create policy package_allowance_revisions_select on package_allowance_revisions
  for select using (
    exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists package_allowance_revisions_insert on package_allowance_revisions;
create policy package_allowance_revisions_insert on package_allowance_revisions
  for insert with check (
    exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );
