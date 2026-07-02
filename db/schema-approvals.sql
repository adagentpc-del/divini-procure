-- ============================================================================
-- Divini Procure — SUBMITTAL & APPROVAL management (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A construction-style submittal workflow on top of a procurement package: a
-- vendor (or the package owner) creates a submittal, then it moves through a
-- linear status lifecycle with a full audit trail. Read/write authorization is
-- enforced in the Express backend (server/src/routes/submittals.ts): the
-- package owner OR the assigned vendor company, mirroring userOwnsPackage +
-- company_members membership. Admins are allowed. Zero em dashes by convention.
--
-- Statuses (linear, with the ability to send back to revision_required):
--   draft -> submitted -> review -> revision_required -> approved
--         -> ordered -> delivered -> installed -> closed
--
-- APPLY (run once on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-approvals.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- One submittal per item/scope being approved. Optionally tied to a single BOQ
-- line item and to the vendor company responsible for it.
create table if not exists submittals (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  line_item_id uuid,
  vendor_company_id uuid references companies(id),
  title text not null,
  type text,
  current_status text not null default 'draft',
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Append-only audit trail: one row per status change (including the initial
-- draft row written at creation), capturing the actor and any comments.
create table if not exists submittal_history (
  id uuid primary key default gen_random_uuid(),
  submittal_id uuid references submittals(id) on delete cascade,
  status text,
  actor text,
  comments text,
  created_at timestamptz default now()
);

create index if not exists idx_submittals_package on submittals(package_id);
create index if not exists idx_submittal_history_submittal on submittal_history(submittal_id);
