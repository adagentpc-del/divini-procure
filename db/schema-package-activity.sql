-- ============================================================================
-- Divini Procure - Plan room activity tracking (competitive gap closure,
-- docs/competitive-analysis-2026-08.md gap #6): "granular activity
-- tracking (who viewed/downloaded/bid)... goes beyond document management
-- into bid-engagement transparency for the developer."
-- ----------------------------------------------------------------------------
-- Append-only event log, same shape as agreement_signatures /
-- lien_waiver_signatures / external_payment_records: a factual record of
-- who did what, never edited in place. Two event types: 'viewed' (a vendor
-- opened the package detail page) and 'document_downloaded' (a vendor
-- requested a signed download URL for one of the package's documents).
--
-- Deliberately developer-only visibility (not the vendor's own company):
-- this is competitive intelligence about bid-engagement across ALL
-- vendors on a package, which is the developer's information to have, not
-- any one vendor's. A vendor can already see whether IT viewed/downloaded
-- (that's just its own browsing history); it should not see whether a
-- competing vendor did.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create table if not exists package_activity_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  developer_company_id uuid not null references companies(id) on delete cascade,
  viewer_company_id uuid not null references companies(id) on delete cascade,
  event_type text not null check (event_type in ('viewed', 'document_downloaded')),
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_package_activity_events_package on package_activity_events(package_id);
create index if not exists idx_package_activity_events_developer on package_activity_events(developer_company_id, created_at desc);

-- ============================================================================
-- RLS: SELECT is developer-only (the building's owning company) or admin -
-- this is the developer's engagement intelligence, not the viewing
-- vendor's. INSERT is restricted to logging your OWN view/download
-- (viewer_company_id must be a company you belong to) or admin - a caller
-- can log that it viewed a package, never fabricate that a different
-- company did. No UPDATE/DELETE policy: append-only, a historical record.
-- ============================================================================
alter table package_activity_events enable row level security;
alter table package_activity_events force row level security;

drop policy if exists package_activity_events_select on package_activity_events;
create policy package_activity_events_select on package_activity_events
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists package_activity_events_insert on package_activity_events;
create policy package_activity_events_insert on package_activity_events
  for insert with check (
    viewer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
