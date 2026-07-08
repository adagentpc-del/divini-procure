-- ============================================================================
-- Divini Procure - PLATFORM REVENUE LEDGER schema (idempotent)
-- ----------------------------------------------------------------------------
-- The accrual ledger for Divini's own platform revenue. When a developer
-- awards a bid and authorizes a payment, the correct fee (grandfathered /
-- matrix / standard) is resolved and a platform_revenue row is RECORDED here at
-- status 'accrued'. This table RECORDS and ACCRUES revenue; it NEVER charges a
-- card or moves money. An admin later marks a row 'invoiced'/'collected'/etc by
-- hand. Re-running this file is safe (create table if not exists ...).
--
-- Apply once, AFTER db/schema.sql and db/schema-award-workflow.sql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-revenue.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-revenue.sql)
--
-- Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- platform revenue (the accrual ledger) ----------
-- One row per accrued revenue event. source_type tells you where it came from
-- (a procurement fee on a payment authorization, a capital-introduction fee, a
-- subscription, or a manual entry). base_cents is the amount the fee was
-- computed on; fee_cents is what Divini accrues. fee_source / payer_type carry
-- the fee-matrix resolution context so the ledger is self-explaining. status
-- moves accrued -> invoiced -> collected (or waived / void) by ADMIN action
-- only; nothing here auto-charges. payment_authorization_id is the idempotency
-- key for procurement fees (one accrual per authorization).
create table if not exists platform_revenue (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'procurement_fee'
    check (source_type in ('procurement_fee','capital_introduction','subscription','manual')),
  developer_company_id uuid,
  vendor_company_id uuid,
  purchase_order_id uuid,
  payment_authorization_id uuid,
  program_id uuid,
  base_cents bigint,
  fee_percentage numeric,
  fee_cents bigint,
  fee_source text,
  payer_type text,
  status text not null default 'accrued'
    check (status in ('accrued','invoiced','collected','waived','void')),
  collected_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists platform_revenue_status_idx on platform_revenue (status);
create index if not exists platform_revenue_developer_idx on platform_revenue (developer_company_id);
-- One accrual per payment authorization (idempotency for procurement fees).
create unique index if not exists platform_revenue_payment_auth_uniq
  on platform_revenue (payment_authorization_id)
  where payment_authorization_id is not null;
