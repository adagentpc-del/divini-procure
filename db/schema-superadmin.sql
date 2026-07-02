-- ============================================================================
-- Divini Procure — SUPER-ADMIN ESSENTIALS schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Ported from Divini Partners' admin/referral engine, mapped to Procure's
-- `companies` (not `organizations`) and `users` (OIDC sub text id) model.
--
-- This file is ADDITIVE and IDEMPOTENT (create table if not exists ...). It is
-- applied the SAME WAY as db/schema.sql — run once against the local Postgres
-- AFTER db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-superadmin.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-superadmin.sql)
--
-- Re-running it is safe. See CHANGES.md / DEPLOY.md.
-- Zero em dashes below this line by convention of the ported routers.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- invite codes ----------
-- Admin-generated invitations to onboard a buyer/vendor company. The `code`
-- powers a public claim link (PUBLIC_APP_URL + /join/:code).
create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  email text,
  company_kind text,                 -- 'buyer' | 'vendor' (advisory; not enforced)
  status text default 'pending',     -- pending | claimed | revoked
  created_by text,                   -- admin email
  claimed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists invite_codes_status_idx on invite_codes (status);

-- ---------- discount codes ----------
create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  kind text default 'percent',       -- percent | flat
  value numeric default 0,
  max_uses int,                      -- null = unlimited
  uses int default 0,
  status text default 'active',      -- active | disabled
  applies_to text,                   -- e.g. 'subscription' | 'all'
  expires_at timestamptz,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists discount_codes_status_idx on discount_codes (status);

-- ---------- referral partners ----------
-- A business partner who refers customers in exchange for a revenue share or a
-- flat fee. `company_id` is nullable so a partner need not be a registered
-- company. revenue_share_pct is fully editable post-create (PATCH).
create table if not exists referral_partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  name text not null,
  partner_email text,
  referral_code text unique not null,
  referral_link text,
  commission_type text default 'percent',  -- percent | flat
  revenue_share_pct numeric,                -- when commission_type = percent
  flat_fee_cents bigint,                    -- when commission_type = flat
  applies_to text,
  status text default 'active',             -- active | disabled
  terms text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists referral_partners_status_idx on referral_partners (status);

-- ---------- per-user referral codes + referrals + credits ----------
create table if not exists referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id text unique references users(id) on delete cascade,
  code text unique not null,
  created_at timestamptz default now()
);

create table if not exists user_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id text references users(id) on delete cascade,
  referred_email text,
  code text,
  status text default 'pending',     -- pending | converted
  created_at timestamptz default now(),
  converted_at timestamptz
);
create index if not exists user_referrals_referrer_idx on user_referrals (referrer_user_id);

create table if not exists platform_credits (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  amount_cents bigint not null default 0,
  kind text default 'earned',        -- earned | redeemed | expired | pending
  reason text,
  created_at timestamptz default now()
);
create index if not exists platform_credits_user_idx on platform_credits (user_id);
