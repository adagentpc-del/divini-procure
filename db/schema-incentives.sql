-- ===========================================================================
-- Divini Procure - INCENTIVE ENGINE (Intro Credits + Trust Score + Founding)
-- ===========================================================================
-- Additive. Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS). Nothing here changes existing behavior until the PROCURE_INTRO_CREDITS
-- flag is turned on; the tables simply accrue a truthful ledger from day one.
--
-- actor_kind = 'investor' -> actor_id holds the auth user_id (text)
-- actor_kind = 'company'  -> actor_id holds the company id (uuid, stored as text)
-- ===========================================================================

-- ---- Intro Credits ledger (earn +delta / spend -delta) --------------------
create table if not exists intro_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('investor','company')),
  actor_id   text not null,
  delta      integer not null,
  reason     text not null,          -- monthly_grant | founding_bonus | profile_complete | referral | responsiveness | positive_rating | intro_request | admin_adjust
  period_key text,                   -- 'YYYY-MM' for monthly_grant idempotency
  ref_id     text,                   -- optional related entity (program id, intro id, ...)
  created_at timestamptz not null default now()
);
create index if not exists intro_credit_ledger_actor_idx on intro_credit_ledger(actor_kind, actor_id);
create index if not exists intro_credit_ledger_reason_idx on intro_credit_ledger(actor_kind, actor_id, reason);

-- ---- Developer trust profile (the reputation surface LPs vet) --------------
create table if not exists developer_trust_profiles (
  company_id uuid primary key references companies(id) on delete cascade,
  years_operating          integer,
  projects_completed       integer,
  total_value_cents        bigint,
  team_size                integer,
  markets                  text[],
  full_cycle_track_record  boolean default false,   -- shares deals taken start->finish (only ~38% do)
  full_cycle_detail        text,
  co_invests               boolean,                  -- GP puts own capital in (alignment)
  uses_rate_caps           boolean,                  -- floating-rate debt is capped
  preferred_return_structure text,                   -- e.g. 'true pref, no GP catch-up'
  identity_verified        boolean default false,
  entity_verified          boolean default false,
  updated_at               timestamptz not null default now()
);

-- ---- Founding members (scarcity + status) ---------------------------------
create table if not exists founding_members (
  actor_kind text not null check (actor_kind in ('investor','company')),
  actor_id   text not null,
  cohort     text not null,               -- e.g. 'investor-2026', 'developer-2026'
  joined_at  timestamptz not null default now(),
  primary key (actor_kind, actor_id)
);

-- ---- Double opt-in + privacy (additive columns) ---------------------------
alter table investor_introduction_requests
  add column if not exists investor_confirmed  boolean default true,   -- investor initiates => their opt-in
  add column if not exists developer_confirmed  boolean default false, -- set true when the developer approves
  add column if not exists contacts_exchanged_at timestamptz;          -- set when both sides have opted in

alter table investor_profiles
  add column if not exists visibility text default 'private',          -- 'private' (invisible until they raise a hand) | 'discoverable'
  add column if not exists quiet_mode boolean default false;           -- family-office mode: digest only, no browse

-- ---- Peer referrals (refer someone from the other side of the market) ------
-- referral_code == the referrer's user_id (text). One reward per referred user.
create table if not exists user_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id text not null,
  referred_user_id text unique,
  referral_code     text not null,
  rewarded          boolean default false,
  created_at        timestamptz not null default now()
);
create index if not exists user_referrals_referrer_idx on user_referrals(referrer_user_id);
