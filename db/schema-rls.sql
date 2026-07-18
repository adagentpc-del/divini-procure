-- Divini Procure: Row-Level Security (RLS) policies.
--
-- These policies mirror the authorization logic in server/src/db.ts.
-- They are a defense-in-depth layer: the app layer already enforces all these
-- rules, but RLS ensures that even a misconfigured or buggy route cannot leak
-- data or write across company boundaries at the database level.
--
-- IMPORTANT: run as a superuser or the table owner. The policies use
-- current_setting('app.user_id', true) which is set by the application on each
-- connection via:
--   await pool.query("select set_config('app.user_id', $1, true)", [userId])
-- This is a per-transaction setting (the third param = true), so it is safe
-- with connection pooling.
--
-- For now, these policies are defined but the tables are set to FORCE ROW
-- SECURITY only after the app layer sets the GUC. A superuser connection
-- (DATABASE_URL with a superuser role) bypasses RLS, which is intentional for
-- admin operations and migrations.
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

-- Helper function: true when current user is the admin.
-- Mirrors ADMIN_ALLOWED_EMAILS check (hardcoded here for the DB layer;
-- in practice the app layer enforces this before reaching the DB).
create or replace function current_user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from users
     where id = current_setting('app.user_id', true)
       and email = any(string_to_array(
             coalesce(current_setting('app.admin_emails', true), ''),
             ','
           ))
  )
$$;

-- ============================================================================
-- companies
-- READ:  any authenticated user (marketplace discovery).
-- WRITE: only members of the company being written.
-- ============================================================================
alter table companies enable row level security;
alter table companies force row level security;

drop policy if exists companies_select on companies;
create policy companies_select on companies
  for select using (true);  -- any authed connection may read

drop policy if exists companies_insert_admin on companies;
create policy companies_insert_admin on companies
  for insert with check (current_user_is_admin());

drop policy if exists companies_update_member on companies;
create policy companies_update_member on companies
  for update using (
    id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists companies_delete_admin on companies;
create policy companies_delete_admin on companies
  for delete using (current_user_is_admin());

-- ============================================================================
-- company_members
-- READ:  your own memberships.
-- WRITE: admin, or a current member of the same company (to invite others).
-- ============================================================================
alter table company_members enable row level security;
alter table company_members force row level security;

drop policy if exists company_members_select on company_members;
create policy company_members_select on company_members
  for select using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists company_members_insert on company_members;
create policy company_members_insert on company_members
  for insert with check (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists company_members_update on company_members;
create policy company_members_update on company_members
  for update using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists company_members_delete on company_members;
create policy company_members_delete on company_members
  for delete using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- buildings
-- READ:  any authenticated user.
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
-- READ:  any authenticated user.
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
-- READ:  the vendor who placed the bid OR the building owner.
-- WRITE: the vendor company (insert own bids; update own drafts).
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
-- READ:  members of the owning company; admin.
-- WRITE: members of the owning company; admin.
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
-- subscription_tiers: public read, admin write.
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
-- users: users can only read/write their own row.
-- ============================================================================
alter table users enable row level security;
alter table users force row level security;

drop policy if exists users_own on users;
create policy users_own on users
  for all using (
    id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );
