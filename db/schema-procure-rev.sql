-- ============================================================================
-- Divini Procure - REFERRAL REVENUE / COMMISSION + PAYOUT schema (idempotent)
-- ----------------------------------------------------------------------------
-- Enhancement on top of the EXISTING referral_partners table (see
-- db/schema-superadmin.sql). Brings Procure's referral revenue-share up to the
-- Divini Partners admin level: a PROFIT-BASED commission ledger plus payout
-- tracking/management. Ported in shape from Divini Partners' rev-partner /
-- rev-payout schemas, mapped to Procure's `companies` (not `organizations`).
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql and db/schema-superadmin.sql, the same way:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-procure-rev.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-procure-rev.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- partner commissions (the profit-based ledger) ----------
-- One row per earning event attributed to a referral partner. The commission is
-- a share of Divini's PROFIT on the event (platform_fee - processing_cost),
-- NEVER a share of the gross invoice. net_profit_cents and commission_cents are
-- computed server-side at insert time from the partner's revenue_share_pct /
-- commission_type. Rows can be excluded from a payout roll-up without deletion.
create table if not exists partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references referral_partners(id) on delete cascade,
  referred_company_id uuid references companies(id) on delete set null,
  source text default 'subscription',          -- subscription | transaction | setup | enterprise | manual_adjustment
  gross_cents bigint default 0,                 -- original invoice (reference only)
  platform_fee_cents bigint default 0,          -- platform fee we collected
  processing_cost_cents bigint default 0,       -- processing cost we paid
  net_profit_cents bigint default 0,            -- max(0, platform_fee - processing_cost)
  commission_cents bigint default 0,            -- net_profit * share% (or flat)
  status text default 'pending',                -- pending | approved | paid | held | disputed
  excluded boolean default false,               -- excluded from payout roll-up
  created_at timestamptz default now()
);
create index if not exists partner_commissions_partner_idx on partner_commissions (partner_id);

-- ---------- partner payouts (period roll-up + disbursement tracking) ----------
-- A payout is a per-partner, per-period roll-up of non-excluded commissions.
-- commission_owed_cents = sum(commission_cents) + manual_adjustment_cents.
-- This table RECORDS and TRACKS payouts; it never moves money.
create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references referral_partners(id) on delete cascade,
  period text,                                  -- free-text period label, e.g. '2026-06'
  gross_volume_cents bigint default 0,
  platform_fees_cents bigint default 0,
  processing_costs_cents bigint default 0,
  net_profit_cents bigint default 0,
  commission_pct numeric,
  commission_owed_cents bigint default 0,
  commission_paid_cents bigint default 0,
  manual_adjustment_cents bigint default 0,
  status text default 'pending',                -- pending | approved | scheduled | paid | held | disputed | cancelled
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists partner_payouts_partner_idx on partner_payouts (partner_id);
