-- ===========================================================================
-- Divini Procure - PAID TIERS + PAYWALL GATES (v2 monetization)
-- ===========================================================================
-- Additive + idempotent. The developer_pro / capital_partner_* tiers are
-- seeded in db/schema-subscriptions.sql; this adds the individual Capital
-- Partner plan column and the "who viewed my raise" tracking table. Gating
-- stays inert until a paid tier is assigned (developer via
-- subscription_entitlements, capital partner via plan).
-- ===========================================================================

-- Capital Partner plan assignment (capital partners are user-keyed, not
-- company-keyed, since an individual/family office signs in as themself, not
-- as an organization). Mirrors the subscription_tiers Capital Partner ladder
-- (free / professional $49mo / institutional $149mo / enterprise custom) as a
-- simple label on the user's own investor_profiles row.
alter table investor_profiles
  add column if not exists plan text default 'free';   -- 'free' | 'professional' | 'institutional' | 'enterprise'

-- Defensive re-run: migrate a pre-existing row still on a retired plan value
-- forward to its closest current equivalent.
update investor_profiles set plan = 'professional' where plan = 'premium';
update investor_profiles set plan = 'enterprise' where plan = 'concierge';

-- "Who viewed my raise" - a Developer Pro analytics surface.
create table if not exists program_views (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  viewer_user_id text,
  viewed_at timestamptz not null default now()
);
create index if not exists program_views_program_idx on program_views(program_id);
create index if not exists program_views_dedup_idx on program_views(program_id, viewer_user_id, viewed_at);
