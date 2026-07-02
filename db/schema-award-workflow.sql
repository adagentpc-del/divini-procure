-- ============================================================================
-- Divini Procure - Award-to-Procurement Workflow (idempotent add-on)
-- ----------------------------------------------------------------------------
-- After a bid is awarded, the developer (the building/package owner) manages
-- the procurement lifecycle that follows the award:
--   1. award confirmation     -> a purchase order is drafted from the bid
--   2. purchase order          -> status draft -> issued -> acknowledged ->
--                                 in_production -> fulfilled (or cancelled)
--   3. payment authorization   -> RECORD ONLY. This system NEVER moves money.
--                                 Each row is a recorded authorization/release
--                                 against a purchase order for audit purposes.
--   4. production/delivery/install -> referenced via the existing deliveries
--                                     system (db/schema-delivery.sql). Not
--                                     rebuilt here.
--   5. closeout + warranty documents -> stored as award_documents rows linked
--                                        to the purchase order.
--
-- Submittals (db/schema-approvals.sql) and deliveries (db/schema-delivery.sql)
-- already exist as separate systems. This add-on links to them by package id;
-- it does NOT duplicate them.
--
-- Money is stored as integer cents (amount_cents bigint). The originating
-- bid's price is dollars (bids.price numeric), so amount_cents = round(price*100).
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-award-workflow.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. Zero em dashes.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- purchase orders (one per awarded bid, draftable) ----------
-- status lifecycle: draft | issued | acknowledged | in_production | fulfilled | cancelled
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete set null,
  package_id uuid,
  building_id uuid,
  developer_company_id uuid,
  vendor_company_id uuid,
  po_number text,
  amount_cents bigint,
  status text default 'draft'
    check (status in ('draft','issued','acknowledged','in_production','fulfilled','cancelled')),
  terms text,
  notes text,
  issued_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- payment authorizations (RECORD ONLY: no fund movement) ----------
-- status lifecycle: pending | authorized | released | void
create table if not exists payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  amount_cents bigint,
  fee_percentage numeric,
  fee_cents bigint,
  payer_type text,
  status text default 'pending'
    check (status in ('pending','authorized','released','void')),
  authorized_by text,
  authorized_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- ---------- closeout / warranty / po / other documents ----------
create table if not exists award_documents (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  doc_kind text check (doc_kind in ('closeout','warranty','po','other')),
  title text,
  url text,
  created_by text,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_purchase_orders_developer on purchase_orders(developer_company_id);
create index if not exists idx_purchase_orders_vendor on purchase_orders(vendor_company_id);
create index if not exists idx_purchase_orders_package on purchase_orders(package_id);
create index if not exists idx_payment_auth_po on payment_authorizations(purchase_order_id);
create index if not exists idx_award_documents_po on award_documents(purchase_order_id);
