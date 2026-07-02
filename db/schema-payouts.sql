-- ============================================================================
-- Divini Procure - STRIPE CONNECT PAYOUT RAIL schema (idempotent)
-- ----------------------------------------------------------------------------
-- The disbursement rail. A recipient (referral partner, client, vendor, or any
-- profile) connects a bank account via a STRIPE-HOSTED onboarding link; we store
-- ONLY the Stripe Connect account id (acct_...), boolean status flags, and the
-- bank last4 that Stripe returns. We NEVER store a raw bank account or routing
-- number; the numbers live with Stripe (the licensed money transmitter).
--
-- When a platform_revenue row is collected, the agreed split for each party is
-- computed and a payout_instructions row is queued. An admin/owner RELEASES a
-- split with one click; only then does the server INSTRUCT Stripe to transfer
-- the funds to the recipient's bank. NOTHING here moves money on its own; the
-- live transfer is gated on a configured Stripe key AND payouts_enabled.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql, db/schema-revenue.sql, db/schema-superadmin.sql, the same way:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-payouts.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-payouts.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- connect accounts (Stripe Connect onboarding state) ----------
-- One row per payout recipient owner. owner_kind tells you whether the bank
-- belongs to a company (vendor/client/developer profile), an investor user, or
-- a referral partner. stripe_account_id is the ONLY Stripe identifier we keep
-- (acct_...). charges_enabled / payouts_enabled / details_submitted mirror the
-- Stripe account capability flags; payouts_enabled is the gate that must be true
-- before any release attempts a transfer. bank_last4 is the masked tail Stripe
-- returns for display only. We store NO raw bank account or routing numbers.
create table if not exists connect_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_kind text check (owner_kind in ('company','investor','referral_partner')),
  owner_company_id uuid,
  owner_user_id text,
  owner_referral_partner_id uuid,
  stripe_account_id text,
  status text default 'not_started'
    check (status in ('not_started','onboarding','restricted','enabled','disabled')),
  charges_enabled boolean default false,
  payouts_enabled boolean default false,
  details_submitted boolean default false,
  bank_last4 text,
  country text,
  default_currency text default 'usd',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (owner_kind, owner_company_id, owner_user_id, owner_referral_partner_id)
);
create index if not exists connect_accounts_company_idx on connect_accounts (owner_company_id);

-- ---------- payout instructions (the disbursement queue) ----------
-- One row per recipient split for a revenue event. basis_cents is the amount the
-- split was computed on (typically the platform fee), split_percentage is the
-- agreed share, amount_cents is what the recipient is owed. status flows
-- pending -> ready (when the recipient has a payouts-enabled connect account) ->
-- releasing -> paid, or blocked / failed / held / canceled. stripe_transfer_id
-- is the id of the Stripe transfer once a release succeeds. Nothing here moves
-- money; the transfer is instructed only from the 1-click release route.
create table if not exists payout_instructions (
  id uuid primary key default gen_random_uuid(),
  source_revenue_id uuid,
  payment_authorization_id uuid,
  purchase_order_id uuid,
  recipient_kind text check (recipient_kind in ('referral_partner','client','vendor','profile')),
  recipient_company_id uuid,
  recipient_user_id text,
  recipient_referral_partner_id uuid,
  connect_account_id uuid references connect_accounts(id) on delete set null,
  basis_cents bigint,
  split_percentage numeric,
  amount_cents bigint,
  currency text default 'usd',
  status text default 'pending'
    check (status in ('pending','ready','releasing','paid','failed','blocked','held','canceled')),
  stripe_transfer_id text,
  failure_reason text,
  released_by text,
  released_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists payout_instructions_status_idx on payout_instructions (status);

-- ---------- payout audit (append-only action log) ----------
-- Every connect/onboard/queue/release/block/fail/hold/cancel action appends a
-- row here so the disbursement trail is fully auditable.
create table if not exists payout_audit (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz default now()
);
create index if not exists payout_audit_instruction_idx on payout_audit (instruction_id);
