-- ============================================================================
-- Divini Procure - MARKETPLACE PUBLICATION, SCHEDULING, AND URGENCY
-- ----------------------------------------------------------------------------
-- Extends the pre-existing `packages` table (create/list/status already live
-- in server/src/routes.ts, server/src/db.ts) rather than a new parallel
-- listing system. Today a package with status='open' is already visible to
-- every vendor via getOpenPackages() - there is no visibility tier, no
-- validation gate, no scheduling, and no urgency concept. This adds all four,
-- per the CAD/Drawing/Plan/Specification/Bid Intelligence master spec's
-- "marketplace publication" sections (20-25):
--
--   visibility           - who can see the listing once published (private
--                           draft through public marketplace)
--   publish_at            - an optional future timestamp; status stays
--                           'draft' until server/src/index.ts's interval
--                           sweep flips it to 'open' at the scheduled time
--   published_at / published_by / publication_snapshot
--                          - the moment and identity of the actual publish
--                            action, plus a locked jsonb snapshot of the key
--                            fields at that moment (spec: "lock a
--                            publication snapshot, preserve editable
--                            working version")
--   urgency                - standard/priority/urgent/emergency, gated by a
--                            per-tier monthly limit (see below)
--   question_deadline, site_visit_at, response_required_by, nda_required
--                          - the remaining scheduling/qualification fields
--                            server/src/routes/marketplace-publication.ts
--                            validates before allowing publish
--   terms_acknowledged_by/at
--                          - the spec's required human-review acknowledgment
--                            (section 30) before a package can go live
--
-- Urgent-listing limits reuse the EXISTING, configurable subscription tier
-- engine (server/src/lib/entitlements.ts, subscription_tiers /
-- subscription_entitlements) rather than a hardcoded number - a new
-- urgent_listing_monthly_limit column on both tables, following the exact
-- override-wins-else-tier-default pattern already used for every other
-- limit in that engine. This codebase's actual developer tier ladder is
-- developer_free / developer_pro / developer_enterprise (not the master
-- spec's five-tier Explorer/Starter/Growth/Professional/Enterprise naming),
-- so the spec's limits are adapted onto these three: free = unavailable (0),
-- pro = a generous monthly allowance, enterprise = unlimited by default
-- (contract-defined via a per-company override, same as every other
-- enterprise limit in this engine).
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

-- Default is 'public_marketplace', NOT 'private_draft': the pre-existing
-- createPackage() defaults a package's status straight to 'open' (publicly
-- listed) unless the caller passes a status, and getOpenPackages() is being
-- narrowed below to also filter on visibility. Defaulting visibility to
-- 'public_marketplace' keeps every already-open package, and every package
-- created through that unchanged legacy path, exactly as visible as it is
-- today. A package's status ('draft' vs 'open'/'shortlisting') remains the
-- real gate on whether it is listed at all; visibility only narrows WHO can
-- see it once status allows listing in the first place. Callers that want
-- the new draft-first review-then-publish flow (Divini Blueprint's
-- create-package, or the new PATCH .../publication endpoint) set
-- visibility explicitly.
alter table if exists packages add column if not exists visibility text not null default 'public_marketplace'
  check (visibility in (
    'private_draft', 'organization_only', 'selected_team', 'invite_only',
    'preferred_vendors', 'qualified_vendors', 'divini_verified',
    'public_marketplace', 'private_group', 'hidden_scheduled'
  ));
alter table if exists packages add column if not exists publish_at timestamptz;
alter table if exists packages add column if not exists published_at timestamptz;
alter table if exists packages add column if not exists published_by text references users(id);
alter table if exists packages add column if not exists publication_snapshot jsonb;
alter table if exists packages add column if not exists question_deadline timestamptz;
alter table if exists packages add column if not exists site_visit_at timestamptz;
alter table if exists packages add column if not exists response_required_by timestamptz;
alter table if exists packages add column if not exists nda_required boolean not null default false;
alter table if exists packages add column if not exists urgency text not null default 'standard'
  check (urgency in ('standard', 'priority', 'urgent', 'emergency'));
alter table if exists packages add column if not exists urgency_reason text;
alter table if exists packages add column if not exists terms_acknowledged_by text references users(id);
alter table if exists packages add column if not exists terms_acknowledged_at timestamptz;

create index if not exists idx_packages_publish_at on packages (publish_at) where publish_at is not null;
create index if not exists idx_packages_urgency on packages (urgency) where urgency <> 'standard';

alter table if exists subscription_tiers add column if not exists urgent_listing_monthly_limit int;
alter table if exists subscription_entitlements add column if not exists urgent_listing_monthly_limit int;

-- Seed the developer tiers' urgent-listing allowance. Re-runnable: only
-- touches rows that have not already been given a value, so an admin's
-- later per-company override or a manually adjusted tier default is never
-- clobbered by re-applying this file.
update subscription_tiers set urgent_listing_monthly_limit = 0
  where key = 'developer_free' and urgent_listing_monthly_limit is null;
update subscription_tiers set urgent_listing_monthly_limit = 5
  where key = 'developer_pro' and urgent_listing_monthly_limit is null;
-- developer_enterprise stays NULL = unlimited by default (contract-defined
-- per the spec; an admin can still set a specific per-company override).
