-- =====================================================================
-- Divini Procure - Monetization V2 (transaction-marketplace model)
-- ---------------------------------------------------------------------
-- Net-new + additive + idempotent. Backs:
--   * Free vendors get 5 bids per quarter (no rollover; 20/year terminating
--     annually). Usage tracked in vendor_bid_credits; enforcement in
--     lib/bidCredits.ts. A win never consumes a credit; Pro = unlimited.
--   * PLATFORM FEE on platform-sourced awards billed to the winning vendor:
--     5% capped $25,000 standard, 2% capped $10,000 existing-relationship,
--     PLUS a separate 0.1% platform infrastructure fee capped $1,500 always
--     shown as its own line item. Both are resolved from the fee_rules matrix
--     (db/schema-fee-matrix.sql), never hard-coded, and always recorded
--     (not flag-gated) on payment_authorizations.
--   * Verification GATE: a vendor cannot bid / match / message / be recommended
--     until verify_status = 'verified'. Credential expiry tracked + auto-revoke.
--   * Vendor Pro $149/mo, Verified+ and Featured upsells (subscription_tiers +
--     vendor_featured).
-- Everything is gated by the PROCURE_MONETIZATION_V2 flag at the app layer; the
-- schema is harmless additive structure.
-- Zero em dashes by convention.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Free-tier bid credits (per company per quarter) ----------
-- One row per company per period_key (e.g. '2026Q3'). No rollover: a new
-- quarter is a new row starting at 0. The app enforces the per-quarter limit
-- and the annual termination; this table just records usage for audit.
create table if not exists vendor_bid_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  period_key text not null,                 -- e.g. 2026Q3
  used int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (company_id, period_key)
);
create index if not exists idx_vendor_bid_credits_company on vendor_bid_credits(company_id);

-- ---------- Featured vendor placement (advertising upsell) ----------
create table if not exists vendor_featured (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  status text not null default 'active'
    check (status in ('active','cancelled','expired')),
  price_cents bigint not null default 9900,
  started_at timestamptz default now(),
  current_period_end timestamptz,
  processor_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists uq_vendor_featured_company_active
  on vendor_featured(company_id) where status = 'active';

-- ---------- Verification: credential expiry + gate ----------
-- vendor_credentials already exists (license/insurance/compliance docs). Add
-- expiry + a per-credential type + status so the gate can require current docs.
alter table if exists vendor_credentials add column if not exists credential_type text;   -- license|gl_insurance|workers_comp|trade_cert|w9|bond
alter table if exists vendor_credentials add column if not exists expires_at timestamptz;  -- coverage/license expiry
alter table if exists vendor_credentials add column if not exists doc_status text default 'pending'
  check (doc_status in ('pending','approved','rejected','expired'));

-- vendor_profiles.verify_status already exists; add quick-gate timestamps.
alter table if exists vendor_profiles add column if not exists verified_at timestamptz;
alter table if exists vendor_profiles add column if not exists verification_expires_at timestamptz; -- earliest credential expiry

-- ---------- Platform fee on awards (payment_authorizations) ----------
-- Columns keep their original "success_fee_*" names for backward compatibility
-- with existing readers, but now hold the SINGLE unified platform fee (5%
-- capped $25,000 standard; 2% capped $10,000 existing-relationship), always
-- resolved from the fee_rules matrix (db/schema-fee-matrix.sql), not a
-- hard-coded constant.
alter table if exists payment_authorizations add column if not exists award_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_pct numeric;
alter table if exists payment_authorizations add column if not exists success_fee_cap_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_grandfathered boolean default false;
alter table if exists payment_authorizations add column if not exists success_fee_status text default 'accrued'
  check (success_fee_status in ('accrued','invoiced','billed','paid','waived','void'));

-- ---------- Platform infrastructure fee on awards (payment_authorizations) --
-- Always a separate line item (0.1% capped $1,500), never merged into the
-- platform fee above and never labeled as a payment-processor fee. Resolved
-- from the fee_rules matrix (rule_type = 'platform_infrastructure_fee').
alter table if exists payment_authorizations add column if not exists service_buffer_pct numeric;
alter table if exists payment_authorizations add column if not exists service_buffer_cap_cents bigint;
alter table if exists payment_authorizations add column if not exists service_buffer_cents bigint;

-- ---------- Tier catalogue seeds (idempotent; never overwrite admin edits) ----------
-- subscription_tiers exists (key, name, audience, price_cents, *_limit, seat_limit, ai_features...).
-- A NULL limit means unlimited. Free-tier bid limit is enforced via bid credits,
-- not a tier column, since it is per-quarter.
insert into subscription_tiers (key, name, audience, price_cents, seat_limit, ai_features)
values
  ('developer_free', 'Developer', 'developer', 0, 5, true),
  ('vendor_free',    'Vendor Free', 'vendor', 0, 2, false),
  ('vendor_pro',     'Vendor Pro', 'vendor', 14900, 5, true),
  ('verified_plus',  'Divini Verified+', 'vendor', 4900, 2, false),
  ('vendor_featured','Featured Vendor', 'vendor', 9900, 2, false)
on conflict (key) do nothing;
