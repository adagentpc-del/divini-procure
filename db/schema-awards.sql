-- ============================================================================
-- Divini Procure - Phase 1 P1-06/P1-07: Awards (canonical commitment event).
-- ----------------------------------------------------------------------------
-- The Phase 0 audit found the financial trail dead-ends at "award": a bid
-- gets marked awarded=true and a purchase_orders row is drafted, but there is
-- no independent, canonical AWARD record - "committed" had no single event
-- backing it, and nothing prevented a package from silently accumulating a
-- second award if the workflow were ever called twice with a different bid.
--
-- This file adds that canonical record. AWARD IS THE COMMITMENT EVENT (Phase
-- 1 instruction section 9's "define exactly which event creates commitment" -
-- this is that decision, made once, applied everywhere downstream): the
-- moment award-workflow.ts's POST /award/confirm succeeds, awards.
-- awarded_amount_cents becomes the package's committed amount, locked at that
-- value forever (change orders adjust the REVISED commitment on top of it,
-- never this original figure - see docs/canonical-financial-model.md).
--
-- ONE ACTIVE AWARD PER PACKAGE is enforced at the database level, not just in
-- application code (Phase 1 instruction section 40: "use database
-- constraints where appropriate"): a partial unique index on
-- (package_id) WHERE status = 'active' makes a second concurrent award
-- attempt fail atomically, no race window. Cancelling an award (status ->
-- 'cancelled') frees the package to be awarded again - a real, deliberate
-- product action (section 17: award / cancel / reopen / re-award), never
-- destructive: cancelled awards are kept forever, not deleted.
--
-- purchase_orders.award_id links every PO back to the award that created it,
-- and purchase_orders.original_amount_cents freezes the amount at PO-creation
-- time (== the award's amount) separately from amount_cents, which today
-- remains equal to it (see award-workflow.ts's PATCH: amount is never in the
-- whitelist of freehand-editable fields) - the split exists so a future PO-
-- level adjustment mechanism has an original to diff against without any
-- schema change.
--
-- Idempotent: safe to re-run. Money is integer cents (bigint). Zero em
-- dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  bid_id uuid not null references bids(id) on delete restrict,
  building_id uuid references buildings(id) on delete set null,
  vendor_company_id uuid references companies(id) on delete set null,
  developer_company_id uuid references companies(id) on delete set null,
  awarded_amount_cents bigint not null,
  awarded_bid_revision_id uuid references bid_revisions(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_reason text,
  cancelled_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE award per package, enforced atomically by Postgres itself.
create unique index if not exists awards_one_active_per_package
  on awards (package_id) where status = 'active';
create index if not exists idx_awards_package on awards (package_id, created_at desc);
create index if not exists idx_awards_bid on awards (bid_id);
create index if not exists idx_awards_developer on awards (developer_company_id);
create index if not exists idx_awards_vendor on awards (vendor_company_id);

alter table purchase_orders add column if not exists award_id uuid references awards(id) on delete set null;
alter table purchase_orders add column if not exists original_amount_cents bigint;
create index if not exists idx_purchase_orders_award on purchase_orders (award_id);

-- ============================================================================
-- RLS: same visibility as purchase_orders (schema-rls-high-risk.sql) - the
-- developer (member of developer_company_id, or of the company that owns the
-- package's building) OR the vendor (vendor_company_id) may READ; only the
-- developer (or admin) may WRITE (create/cancel an award). A vendor sees the
-- award it won but can never create or cancel one.
-- ============================================================================
alter table awards enable row level security;
alter table awards force row level security;

drop policy if exists awards_select on awards;
create policy awards_select on awards
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = awards.package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists awards_insert on awards;
create policy awards_insert on awards
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists awards_update on awards;
create policy awards_update on awards
  for update using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
