-- ===========================================================================
-- Divini Procure - PAID TIERS + PAYWALL GATES (v2 monetization)
-- ===========================================================================
-- Additive + idempotent. The developer_pro / investor_qualified tiers already
-- exist; this adds the Family-Office Concierge tier, an investor plan column,
-- and the "who viewed my raise" tracking table. Gating stays inert until a paid
-- tier is assigned (developer via subscription_entitlements, investor via plan).
-- ===========================================================================

-- Family-Office Concierge: white-glove, private, curated (an investor tier).
insert into subscription_tiers
  (key, name, audience, price_cents,
   active_project_limit, bid_package_limit, vendor_invite_limit,
   investment_program_limit, investor_match_limit, seat_limit,
   ai_features, reporting_access, white_glove, sort)
values
  ('family_office_concierge', 'Family Office Concierge', 'investor', 99900,
     0, 0, 0, 0, null, 5, true, true, true, 80)
on conflict (key) do nothing;

-- Investor plan assignment (investors are user-keyed, not company-keyed).
alter table investor_profiles
  add column if not exists plan text default 'free';   -- 'free' | 'premium' (investor_qualified) | 'concierge' (family_office_concierge)

-- "Who viewed my raise" - a Developer Pro analytics surface.
create table if not exists program_views (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  viewer_user_id text,
  viewed_at timestamptz not null default now()
);
create index if not exists program_views_program_idx on program_views(program_id);
create index if not exists program_views_dedup_idx on program_views(program_id, viewer_user_id, viewed_at);
