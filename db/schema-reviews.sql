-- Divini Procure - Phase 0 item 19: the smallest real write path for the
-- existing `reviews` table (db/schema.sql).
--
-- reviews has existed since the original schema and is a REAL, already-
-- wired input to vendor reputation: lib/procure-moat.ts's diviniScore()
-- gives a vendor up to 15 of 100 points from `avg(stars) from reviews
-- where ratee_company_id = $1`, and the same table is read by
-- procure-coo.ts, verification.ts, score-refresh.ts, and intel.ts. But
-- nothing anywhere in the codebase ever INSERTs a row - the entire
-- reputation signal has been permanently zero since day one, not because
-- the feature doesn't exist, but because only its read side was ever
-- built. This is completing an already-half-built feature, not inventing
-- a new one - matching this phase's "implement the smallest write path
-- IF a legitimate completed-transaction review point already exists"
-- instruction exactly.
--
-- Scope: a DEVELOPER may rate a VENDOR once per package, and only after
-- a real completed relationship (a purchase order for that exact
-- package + vendor pair reached status 'fulfilled' - the most precise
-- per-vendor completion signal that exists in the schema, more specific
-- than packages.status='closed', which reflects the whole package's
-- fate, not this vendor's). No vendor-rates-developer direction, no
-- public API for arbitrary company pairs, no reply/response feature -
-- exactly what the existing scoring code already assumes, nothing more.
--
-- Zero em dashes by convention.

alter table reviews add column if not exists updated_at timestamptz not null default now();

-- M-01 gap #12 ("lessons-learned vendor knowledge base tied to past project
-- performance" - ProcurePro): structured, factual fields alongside the
-- freeform stars/body a developer already leaves - never a derived score,
-- matching lib/vendor-signals.ts's "facts only, never a score" rule. Each
-- is a plain yes/no/unanswered (null) the rater optionally sets, plus one
-- guided text field distinct from the general `body` comment, specifically
-- prompting "what would you tell the next developer hiring this vendor for
-- similar work" - the actual knowledge-base content, not just a rating.
-- The trade category itself is not duplicated onto reviews - it is read via
-- reviews.package_id -> packages.category at query time (routes/reviews.ts),
-- so it can never drift from the package it actually came from.
alter table reviews add column if not exists would_rehire boolean;
alter table reviews add column if not exists on_time boolean;
alter table reviews add column if not exists on_budget boolean;
alter table reviews add column if not exists lessons_learned text;

-- Anti-duplicate: one review per (rater, ratee, package) triple. An edit
-- goes through UPDATE, not a second INSERT.
create unique index if not exists reviews_rater_ratee_package_uidx
  on reviews (rater_company_id, ratee_company_id, package_id);

create index if not exists reviews_ratee_idx on reviews (ratee_company_id);

-- READ: public, matching the existing marketplace-transparency pattern for
-- vendor reputation data (companies/vendor_profiles/packages are all
-- public-read for the same reason - a buyer must be able to evaluate a
-- vendor before ever transacting with them).
-- WRITE: the rater's own company (server-derives + verifies this - see
-- routes/reviews.ts), or admin.
alter table reviews enable row level security;
alter table reviews force row level security;

drop policy if exists reviews_select on reviews;
create policy reviews_select on reviews
  for select using (true);

drop policy if exists reviews_insert on reviews;
create policy reviews_insert on reviews
  for insert with check (
    rater_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists reviews_update on reviews;
create policy reviews_update on reviews
  for update using (
    rater_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists reviews_delete on reviews;
create policy reviews_delete on reviews
  for delete using (
    rater_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
