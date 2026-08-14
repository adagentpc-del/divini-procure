-- Divini Procure: Row-Level Security (RLS) policies.
--
-- Defense-in-depth: server/src/db.ts already enforces every one of these
-- rules in application code (confirmed via live adversarial cross-tenant
-- testing - see docs/platform-standard/authorization-matrix.md). RLS adds a
-- second, independent enforcement layer at the database itself, so a single
-- missed ownership check in one route can no longer become a full IDOR.
--
-- HOW THE APP SETS THE SESSION CONTEXT THESE POLICIES DEPEND ON:
--   server/src/lib/requestContext.ts holds the current request's
--   {userId, isAdmin} in an AsyncLocalStorage. server/src/pool.ts's q()/q1()
--   wrap every query in an explicit transaction and run, immediately after
--   BEGIN:
--     select set_config('app.user_id', $1, true), set_config('app.is_admin', $2, true)
--   The third argument (true = "is_local") means this setting is scoped to
--   the current transaction only and is automatically discarded at COMMIT
--   or ROLLBACK - this is what makes it safe to use with a shared
--   connection pool. A connection returned to the pool never carries a
--   previous request's identity into the next one, because there is
--   nothing left to carry: the GUC no longer has a value once that
--   transaction ends.
--
--   The same pattern is used by the handful of multi-statement
--   transactions in db.ts that call pool.connect() directly instead of
--   going through q()/q1() (createCompanyForUser, deleteMyAccount,
--   transferCompanyOwnerEmail, createBid) - each calls the same
--   setRlsContext(client) helper right after BEGIN.
--
--   Background jobs with no HTTP request (the follow-up processor, the
--   marketplace-publication scheduler) have no AsyncLocalStorage context.
--   pool.ts treats a missing context as admin-equivalent for RLS purposes,
--   matching what these jobs already do today (operate across every
--   tenant, unrestricted, by design - they are trusted server-internal
--   batch processes, not user-facing routes).
--
-- IMPORTANT: run as a superuser or the table owner. FORCE ROW LEVEL
-- SECURITY is required on every policy-protected table below because the
-- app connects as the table-owning role, and Postgres exempts table owners
-- from RLS by default unless FORCE is set - a well-known gotcha that would
-- otherwise make every policy here silently a no-op for this app's own
-- connections while looking correctly configured.
--
-- BOOTSTRAPPING: three tables (users, companies, company_members) have a
-- chicken-and-egg problem plain "own row only" policies do not handle:
--   - registration inserts a users row before any session/identity exists;
--   - creating a company inserts a companies row before the creator is a
--     member of anything, and a company_members row for a company that,
--     from the RLS policy's point of view, the creator isn't a member of
--     yet (they're inserting the very row that would make them one);
--   - deleteMyAccount deletes a company only once it has zero members
--     left - by the time that DELETE runs, the acting user's own
--     membership row (for that company) has already been removed in the
--     same transaction, so "is a current member" is no longer true for
--     them either.
-- Each policy below is written to allow exactly these self-service
-- bootstrap/teardown cases without opening the tables up broadly. Every
-- one of these was traced against the actual server/src/db.ts code paths
-- that use it, not written speculatively.
--
-- Zero em dashes by convention.

-- Helper function: returns the company_ids the current user belongs to.
-- Matches the app-layer userCompanyIds(userId) pattern.
create or replace function current_user_company_ids()
returns setof text
language sql
stable
as $$
  select company_id::text
    from company_members
   where user_id = current_setting('app.user_id', true)
$$;

-- Helper function: true when the app layer has already established this
-- connection's identity as an admin (ADMIN_ALLOWED_EMAILS, checked once in
-- auth.ts's computeIsAdmin() and passed down as app.is_admin) OR when no
-- request context exists at all (a trusted server-internal background job
-- - see the file header). Simpler and more precise than re-deriving admin
-- status from an email list inside Postgres: the allow-list check happens
-- in exactly one place (auth.ts), not duplicated into a DB GUC on every query.
create or replace function current_user_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.is_admin', true), '') = 't'
$$;

-- ============================================================================
-- users
-- INSERT: open. Registration (upsertUserForRegistration) happens before any
--   session exists, so there is no "current user" to check yet - the app
--   layer rate-limits and validates registration instead. The ownership-
--   transfer/claim flow (transferCompanyOwnerEmail) also inserts a
--   placeholder row for a target email that is never the acting user;
--   that function is pre-gated at the route layer (owner/admin only,
--   checked via assertMemberOfCompany before the transaction starts) and
--   runs under a transaction-local admin-equivalent context - see below.
-- SELECT/UPDATE/DELETE: your own row, or admin.
-- ============================================================================
alter table users enable row level security;
alter table users force row level security;

drop policy if exists users_own on users;
drop policy if exists users_select on users;
drop policy if exists users_insert on users;
drop policy if exists users_update on users;
drop policy if exists users_delete on users;

create policy users_insert on users
  for insert with check (true);

create policy users_select on users
  for select using (
    id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

create policy users_update on users
  for update using (
    id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

create policy users_delete on users
  for delete using (
    id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

-- ============================================================================
-- companies
-- READ:  any authenticated user (marketplace discovery - confirmed live
--        this engagement as the deliberate, existing product behavior).
-- INSERT: any authenticated connection - onboarding lets any signed-in user
--        create a new company for themselves with no prior membership to
--        check (createCompanyForUser has no such precondition today).
-- UPDATE: members of the company, or admin.
-- DELETE: admin, OR a company with zero remaining members - deleteMyAccount
--        removes the acting user's own company_members row first, then
--        deletes the company only if it is now orphaned, so "is a current
--        member" can no longer be true for the acting user at DELETE time.
-- ============================================================================
alter table companies enable row level security;
alter table companies force row level security;

drop policy if exists companies_select on companies;
create policy companies_select on companies
  for select using (true);

drop policy if exists companies_insert_admin on companies;
drop policy if exists companies_insert on companies;
create policy companies_insert on companies
  for insert with check (true);

drop policy if exists companies_update_member on companies;
create policy companies_update_member on companies
  for update using (
    id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists companies_delete_admin on companies;
drop policy if exists companies_delete on companies;
create policy companies_delete on companies
  for delete using (
    current_user_is_admin()
    or not exists (select 1 from company_members cm where cm.company_id = companies.id)
  );

-- ============================================================================
-- company_members
-- READ/INSERT/UPDATE/DELETE: your own membership row, or admin.
--
-- IMPORTANT: this must NOT reference current_user_company_ids() (which
-- itself selects from company_members). Every real write/read of this
-- table in server/src/db.ts either filters on the acting user's own
-- user_id (createCompanyForUser's self-insert, deleteMyAccount's self-
-- delete, getMyCompany/userOwnsPackage/assertMemberOfCompany's own-row
-- lookups) or already runs under a transaction-local admin escalation
-- (transferCompanyOwnerEmail - see that function). There is no feature
-- today where one user needs to see or write ANOTHER user's membership
-- row directly against this table, so there is no case that needs the
-- "am I a member of this row's company" self-join. Confirmed live: with
-- that self-join present, a plain company-member request (e.g. creating
-- a building right after creating a company) surfaced Postgres error
-- "stack depth limit exceeded" - current_user_company_ids() queries
-- company_members, which re-evaluates this table's own SELECT policy,
-- which calls current_user_company_ids() again, infinitely. Breaking
-- the self-reference here is also what makes current_user_company_ids()
-- itself safe to use (non-recursively) from every OTHER table's policy
-- below (companies, buildings, packages, bids, documents,
-- subscription_entitlements).
-- ============================================================================
alter table company_members enable row level security;
alter table company_members force row level security;

drop policy if exists company_members_select on company_members;
create policy company_members_select on company_members
  for select using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists company_members_insert on company_members;
create policy company_members_insert on company_members
  for insert with check (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists company_members_update on company_members;
create policy company_members_update on company_members
  for update using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists company_members_delete on company_members;
create policy company_members_delete on company_members
  for delete using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

-- ============================================================================
-- buildings
-- READ:  any authenticated user (marketplace discovery, confirmed live).
-- WRITE: only members of the building's owning company.
-- ============================================================================
alter table buildings enable row level security;
alter table buildings force row level security;

drop policy if exists buildings_select on buildings;
create policy buildings_select on buildings
  for select using (true);

drop policy if exists buildings_insert on buildings;
create policy buildings_insert on buildings
  for insert with check (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists buildings_update on buildings;
create policy buildings_update on buildings
  for update using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists buildings_delete on buildings;
create policy buildings_delete on buildings
  for delete using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- packages
-- READ:  any authenticated user (marketplace discovery, confirmed live).
-- WRITE: members of the company that owns the package's building.
-- ============================================================================
alter table packages enable row level security;
alter table packages force row level security;

drop policy if exists packages_select on packages;
create policy packages_select on packages
  for select using (true);

drop policy if exists packages_write on packages;
create policy packages_write on packages
  for all using (
    exists (
      select 1 from buildings b
       where b.id = building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- bids
-- READ:  the vendor who placed the bid OR the building owner, OR admin.
-- WRITE: the vendor company (insert own bids; update own).
-- ============================================================================
alter table bids enable row level security;
alter table bids force row level security;

drop policy if exists bids_select on bids;
create policy bids_select on bids
  for select using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or exists (
      select 1 from packages p
       join buildings b on b.id = p.building_id
       where p.id = bids.package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists bids_insert on bids;
create policy bids_insert on bids
  for insert with check (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists bids_update on bids;
create policy bids_update on bids
  for update using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists bids_delete_admin on bids;
create policy bids_delete_admin on bids
  for delete using (current_user_is_admin());

-- ============================================================================
-- documents
-- READ/WRITE: members of the owning company; admin. Matches the app-layer
-- IDOR-fix checks in db.ts's getDocuments/insertDocument and the signed-URL
-- issuance endpoint, all independently confirmed live this engagement.
-- ============================================================================
alter table documents enable row level security;
alter table documents force row level security;

drop policy if exists documents_policy on documents;
create policy documents_policy on documents
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- subscription_entitlements
-- READ/WRITE: members of the company; admin.
-- ============================================================================
alter table subscription_entitlements enable row level security;
alter table subscription_entitlements force row level security;

drop policy if exists sub_entitlements_policy on subscription_entitlements;
create policy sub_entitlements_policy on subscription_entitlements
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- subscription_tiers: public read (the pricing page is public), admin write.
-- ============================================================================
alter table subscription_tiers enable row level security;
alter table subscription_tiers force row level security;

drop policy if exists sub_tiers_select on subscription_tiers;
create policy sub_tiers_select on subscription_tiers
  for select using (true);

drop policy if exists sub_tiers_write_admin on subscription_tiers;
create policy sub_tiers_write_admin on subscription_tiers
  for all using (current_user_is_admin());

-- ============================================================================
-- vendor_profiles
-- READ:  any (matches companies/buildings/packages - buyer-side matching
--        (procure-moat.ts) and verification-gate checks (verificationGate.ts)
--        both read a VENDOR's profile from a BUYER's session; verify_status
--        is a public "verified" badge, not sensitive data).
-- WRITE: the owning vendor company (createCompanyForUser's self-insert at
--        onboarding, same transaction as the company_members bootstrap row,
--        so current_user_company_ids() already sees it), or admin (every
--        other write - db/../routes/verification.ts's credential-review
--        recompute functions - is behind requireAdmin, confirmed by
--        tracing every real call site, not assumed).
-- ============================================================================
alter table vendor_profiles enable row level security;
alter table vendor_profiles force row level security;

drop policy if exists vendor_profiles_select on vendor_profiles;
create policy vendor_profiles_select on vendor_profiles
  for select using (true);

drop policy if exists vendor_profiles_write on vendor_profiles;
create policy vendor_profiles_write on vendor_profiles
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- package_line_items (bill-of-quantities line items on a package)
-- READ:  any (marketplace discovery - a vendor must see the line items to
--        bid; getLineItems() in db.ts takes no ownership-checked userId).
-- WRITE: members of the company owning the package's building (app-layer
--        already checks this via userOwnsPackage() before every write - see
--        addLineItem/deleteLineItem in db.ts), or admin.
-- ============================================================================
alter table package_line_items enable row level security;
alter table package_line_items force row level security;

drop policy if exists package_line_items_select on package_line_items;
create policy package_line_items_select on package_line_items
  for select using (true);

drop policy if exists package_line_items_write on package_line_items;
create policy package_line_items_write on package_line_items
  for all using (
    exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = package_line_items.package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- bid_items (priced line items on a bid)
-- READ/WRITE: the bidding vendor company, or the package's building owner
--        (buyer-side quote comparison - routes/quote-comparison.ts reads
--        every invited vendor's bid_items from the buyer's own session),
--        or admin. Mirrors the bids table's own visibility rule exactly,
--        via a subquery on bids (not on bid_items itself, so this cannot
--        recurse the way company_members did).
-- ============================================================================
alter table bid_items enable row level security;
alter table bid_items force row level security;

drop policy if exists bid_items_policy on bid_items;
create policy bid_items_policy on bid_items
  for all using (
    exists (
      select 1 from bids bd
       where bd.id = bid_items.bid_id
         and (
           bd.vendor_company_id::text = any(array(select current_user_company_ids()))
           or exists (
             select 1 from packages p
               join buildings b on b.id = p.building_id
              where p.id = bd.package_id
                and b.company_id::text = any(array(select current_user_company_ids()))
           )
         )
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- rfq_questions
-- READ:  any (public Q&A on the marketplace listing - getQuestions() in
--        db.ts takes no ownership-checked userId, matches the header
--        comment's original design intent).
-- INSERT: as your own vendor company (askQuestion() already calls
--        assertMemberOfCompany(userId, vendorCompanyId) before this insert).
-- UPDATE (answer): only the package's building owner (answerQuestion()
--        already checks this via a join before the update).
-- ============================================================================
alter table rfq_questions enable row level security;
alter table rfq_questions force row level security;

drop policy if exists rfq_questions_select on rfq_questions;
create policy rfq_questions_select on rfq_questions
  for select using (true);

drop policy if exists rfq_questions_insert on rfq_questions;
create policy rfq_questions_insert on rfq_questions
  for insert with check (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists rfq_questions_update on rfq_questions;
create policy rfq_questions_update on rfq_questions
  for update using (
    exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = rfq_questions.package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- feature_flags
-- READ:  any authenticated user (GET /feature-flags requires requireUser,
--        not requireAdmin - matches header comment's original design intent).
-- WRITE: admin only (PATCH /feature-flags/:key requires requireAdmin).
-- ============================================================================
alter table feature_flags enable row level security;
alter table feature_flags force row level security;

drop policy if exists feature_flags_select on feature_flags;
create policy feature_flags_select on feature_flags
  for select using (true);

drop policy if exists feature_flags_write_admin on feature_flags;
create policy feature_flags_write_admin on feature_flags
  for all using (current_user_is_admin());
