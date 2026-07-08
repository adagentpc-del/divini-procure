-- ============================================================================
-- Divini Procure - Change Order Management (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Additive enhancement to the existing schema (db/schema.sql). Layers a change
-- order lifecycle on top of a project (buildings) and, optionally, a package.
-- A developer (the building's owning company) raises a change order against a
-- vendor, capturing cost and schedule impact, and advances it through a review
-- workflow. When investor approval is required the change order also carries an
-- independent investor approval status. Every create and status change appends
-- an immutable change_order_audit row (actor = current user email).
--
--   * change_orders:      one record per change order on a project/package.
--   * change_order_audit: append-only activity log (create + status changes).
--
-- Lifecycle (status):
--   draft -> submitted -> under_review -> approved | rejected | cancelled
--
-- Investor approval (investor_approval_status), independent of status:
--   not_required | pending -> approved | rejected
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-change-orders.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. Integer cents.
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- change order record (per project / optional package) ----------
create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references buildings(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  vendor_company_id uuid,
  developer_company_id uuid,
  co_number text,
  title text,
  description text,
  cost_impact_cents bigint default 0,
  schedule_impact_days int default 0,
  status text default 'draft'
    check (status in ('draft','submitted','under_review','approved','rejected','cancelled')),
  investor_approval_required boolean default false,
  investor_approval_status text default 'not_required'
    check (investor_approval_status in ('not_required','pending','approved','rejected')),
  document_url text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- append-only audit log per change order ----------
create table if not exists change_order_audit (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid references change_orders(id) on delete cascade,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_change_orders_building on change_orders(building_id);
create index if not exists idx_change_orders_developer on change_orders(developer_company_id);
create index if not exists idx_change_order_audit_co on change_order_audit(change_order_id);
