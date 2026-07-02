-- ============================================================================
-- Divini Procure - PER-PARTY SPLIT TERMS schema (idempotent)
-- ----------------------------------------------------------------------------
-- The AGREED disbursement-share terms for any party (referral partner, client,
-- vendor, developer profile, or other) on a given revenue context. The payout
-- split engine (server/src/lib/split-engine.ts) reads ACTIVE rows here when a
-- platform_revenue row is collected and produces one payout_instructions row
-- per matching term, feeding the 1-click payout queue.
--
-- A term scopes itself by developer_company_id and/or vendor_company_id and/or
-- program_id. basis says what the share is computed on: 'fee' (the platform fee,
-- fee_cents) or 'payment' (the gross payment base, base_cents). The amount is
-- percentage of that basis, or a fixed flat_cents. Conservative by design: a
-- term only produces a split where it is active AND has a real recipient AND a
-- positive amount. We never invent a split.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql, db/schema-revenue.sql, db/schema-payouts.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-split-terms.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-split-terms.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- split terms (agreed per-party share rules) ----------
-- One row per agreed share for one recipient on one revenue context. The
-- recipient is identified by recipient_kind plus the relevant id column
-- (company / user / referral partner). basis 'fee' computes on fee_cents,
-- 'payment' on base_cents. percentage is a share of the basis; flat_cents is a
-- fixed amount (used when percentage is null). active gates whether the engine
-- reads it.
create table if not exists split_terms (
  id uuid primary key default gen_random_uuid(),
  recipient_kind text check (recipient_kind in ('referral_partner','client','vendor','profile','other')),
  recipient_company_id uuid,
  recipient_user_id text,
  recipient_referral_partner_id uuid,
  developer_company_id uuid,
  vendor_company_id uuid,
  program_id uuid,
  basis text check (basis in ('fee','payment')) default 'fee',
  percentage numeric,
  flat_cents bigint,
  active boolean default true,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists split_terms_developer_idx on split_terms (developer_company_id);
create index if not exists split_terms_active_idx on split_terms (active);
