-- Investor Watchlist (saved search criteria + deal alerts)
-- -----------------------------------------------------------------------
-- Backs server/src/routes/watchlist.ts. Never checked into db/ before now;
-- only db/schema-watchlist-userid-fix.sql existed, which ALTERs a table
-- this file was supposed to CREATE first. On a fresh database that left
-- investor_watchlist (and the fix migration) both failing outright, and
-- the whole watchlist feature broken. Found via a from-scratch apply-all.sql
-- bootstrap test; see AI_PROJECT_OS/13_CHANGELOG.md.
--
-- One row per saved search a Capital Partner (investor) creates; the
-- /watchlist/matches endpoint matches these criteria against active
-- investment_programs. Idempotent: safe to re-run.

create table if not exists investor_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  asset_class text,
  location text,
  min_target_return numeric,
  max_min_investment_cents bigint,
  investor_type text,
  label text,
  notify_email boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_investor_watchlist_user on investor_watchlist (user_id);
