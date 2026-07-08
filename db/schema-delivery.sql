-- ============================================================================
-- Divini Procure — Delivery & Installation Tracking (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Enhancement to the existing schema (db/schema.sql). Adds a delivery/install
-- lifecycle on top of awarded packages so the buyer and the assigned vendor can
-- track Production -> Shipped -> Delivered -> Installing -> Installed -> Complete,
-- record the relevant dates, keep a punch list, and read an events log.
--
--   * deliveries:           one delivery record per package/vendor pairing.
--   * delivery_punch_items: open/resolved punch list items per delivery.
--   * delivery_events:      append-only activity log (every status/date change).
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-delivery.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- delivery record (per package / vendor) ----------
-- status lifecycle: in_production | shipped | delivered | installing | installed | complete | delayed
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id),
  submittal_id uuid,
  production_status text default 'not_started',
  shipping_status text default 'not_shipped',
  ship_date date,
  expected_delivery date,
  delivery_date date,
  install_date date,
  completion_date date,
  status text default 'in_production',
  notes text,
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- punch list items per delivery ----------
create table if not exists delivery_punch_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references deliveries(id) on delete cascade,
  description text,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- ---------- append-only events log per delivery ----------
create table if not exists delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references deliveries(id) on delete cascade,
  label text,
  actor text,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_deliveries_package on deliveries(package_id);
create index if not exists idx_delivery_punch_delivery on delivery_punch_items(delivery_id);
create index if not exists idx_delivery_events_delivery on delivery_events(delivery_id);
