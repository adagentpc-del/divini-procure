-- ---------------------------------------------------------------------------
-- Subscription Tiers + Entitlements for Divini Procure.
--
-- Net-new + ADDITIVE. This file:
--   1. Creates `subscription_tiers`: the catalogue of plans (developer / vendor
--      / investor audiences) with per-tier feature flags + usage limits. A NULL
--      limit means UNLIMITED.
--   2. Seeds a sensible default set of tiers (idempotent on the `key`).
--   3. EXTENDS the pre-existing `subscription_entitlements` table (created by
--      db/schema-investment.sql) with the columns that record a company's
--      assigned tier and its EFFECTIVE limits. It NEVER recreates or redefines
--      that table; only `alter table ... add column if not exists`.
--
-- Money is stored as integer cents. UUIDs via gen_random_uuid().
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-subscriptions.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-subscriptions.sql)
-- Zero em dashes by convention.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- The plan catalogue. One row per purchasable tier. A NULL *_limit column means
-- UNLIMITED for that resource. price_cents is the recurring price in cents.
-- ---------------------------------------------------------------------------
create table if not exists subscription_tiers (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text,
  audience text check (audience in ('developer', 'vendor', 'investor')),
  price_cents bigint default 0,
  active_project_limit int,
  bid_package_limit int,
  vendor_invite_limit int,
  investment_program_limit int,
  investor_match_limit int,
  seat_limit int default 2,
  ai_features boolean default false,
  reporting_access boolean default false,
  white_glove boolean default false,
  sort int default 0,
  created_at timestamptz default now()
);

create index if not exists subscription_tiers_audience_idx on subscription_tiers (audience);

-- ---------------------------------------------------------------------------
-- Default tier seeds. Free tiers are small; pro tiers generous; enterprise /
-- qualified tiers unlimited (NULL limit). Re-runnable: on conflict do nothing.
-- ---------------------------------------------------------------------------
insert into subscription_tiers
  (key, name, audience, price_cents,
   active_project_limit, bid_package_limit, vendor_invite_limit,
   investment_program_limit, investor_match_limit, seat_limit,
   ai_features, reporting_access, white_glove, sort)
values
  -- Developer (buyer) tiers
  ('developer_free',       'Developer Free',       'developer',       0,
     1,    3,    5,    0,    0,    2,   false, false, false, 10),
  ('developer_pro',        'Developer Pro',        'developer',   29900,
     10,   50,   50,   3,    25,   10,  true,  true,  false, 20),
  ('developer_enterprise', 'Developer Enterprise', 'developer',  149900,
     null, null, null, null, null, null, true, true,  true,  30),

  -- Vendor tiers
  ('vendor_free',          'Vendor Free',          'vendor',          0,
     null, null, 0,    0,    0,    2,   false, false, false, 40),
  ('vendor_pro',           'Vendor Pro',           'vendor',      14900,
     null, null, 25,   0,    0,    10,  true,  true,  false, 50),

  -- Investor tiers
  ('investor_basic',       'Investor Basic',       'investor',        0,
     0,    0,    0,    0,    10,   2,   false, false, false, 60),
  ('investor_qualified',   'Investor Qualified',   'investor',    49900,
     0,    0,    0,    0,    null, 5,   true,  true,  false, 70)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- EXTEND the pre-existing subscription_entitlements table (do NOT recreate).
-- These columns record the assigned tier_key plus the EFFECTIVE per-resource
-- limits + feature flags for the company. When an override column is NULL the
-- application falls back to the tier default. updated_at already exists on the
-- base table; the add-if-not-exists is harmless.
-- ---------------------------------------------------------------------------
alter table subscription_entitlements add column if not exists tier_key text;
alter table subscription_entitlements add column if not exists audience text;
alter table subscription_entitlements add column if not exists ai_features boolean default false;
alter table subscription_entitlements add column if not exists reporting_access boolean default false;
alter table subscription_entitlements add column if not exists white_glove boolean default false;
alter table subscription_entitlements add column if not exists active_project_limit int;
alter table subscription_entitlements add column if not exists bid_package_limit int;
alter table subscription_entitlements add column if not exists vendor_invite_limit int;
alter table subscription_entitlements add column if not exists investment_program_limit int;
alter table subscription_entitlements add column if not exists investor_match_limit int;
alter table subscription_entitlements add column if not exists seat_limit int;
alter table subscription_entitlements add column if not exists updated_at timestamptz default now();

create index if not exists subscription_entitlements_tier_idx on subscription_entitlements (tier_key);
