-- ============================================================================
-- Divini Procure - developer API platform (competitive gap closure,
-- docs/competitive-analysis-2026-08.md gap #11): "open app marketplace /
-- public API ecosystem... extensibility functions as a moat."
-- ----------------------------------------------------------------------------
-- Personal-access-token model (same shape as a GitHub PAT or Stripe API
-- key), not a separate authorization system: a key is bound to the
-- COMPANY MEMBER who created it and, when presented, authenticates as
-- that exact user - same RLS visibility, same admin flag, same
-- everything. This means every existing route works over the API with
-- zero per-route changes, and a key can never see or do more than its
-- creator could through the normal app. `scopes` is an additional,
-- optional narrowing a key's owner can apply (e.g. issue a read-only key
-- for a reporting integration) - it restricts, it never expands.
--
-- key_hash stores sha256(raw key) only, same rationale as password/
-- session-token storage elsewhere in this schema (db.ts's hashToken()):
-- a database breach must not hand out directly-usable credentials.
-- key_prefix (the first 12 characters of the raw key, e.g.
-- "dvp_live_ab12") is stored in the clear so the owning company can tell
-- keys apart in a list without ever seeing the full secret again after
-- creation - the same pattern Stripe/GitHub/AWS use for token lists.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  created_by_user_id text not null references users(id) on delete cascade,
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  scopes text[] not null default array['read','write'],
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists idx_api_keys_hash on api_keys(key_hash);
create index if not exists idx_api_keys_company on api_keys(company_id);

-- ============================================================================
-- RLS: same shape as every other company-scoped table this session
-- (owning company's members, or admin). The pre-auth lookup-by-hash that
-- authenticates an incoming request (lib/api-keys.ts's verifyApiKey) runs
-- admin-equivalent, same justification as db.ts's q1AsPreAuth() - there
-- is no session yet for a "your own company" policy to match against;
-- the key IS the credential establishing the session.
-- ============================================================================
alter table api_keys enable row level security;
alter table api_keys force row level security;

drop policy if exists api_keys_policy on api_keys;
create policy api_keys_policy on api_keys
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
