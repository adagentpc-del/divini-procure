-- Divini Procure - Phase 0 RLS extension: the procurement-financial and
-- legal-document tables.
--
-- db/schema-rls.sql already covers the core tenancy tables (users,
-- companies, company_members, buildings, packages, bids, documents,
-- subscription_entitlements, subscription_tiers, vendor_profiles,
-- package_line_items, bid_items, rfq_questions, feature_flags). Note: the
-- billing/plan table `subscriptions` itself (as opposed to
-- subscription_entitlements/subscription_tiers) is NOT among these and has
-- no DB-level RLS as of this writing - a compliance-completion pass
-- (2026-08-14, docs/platform-standard/release-readiness.md) found this
-- comment previously named it in error. It relies on app-layer
-- authorization only, same as most of this schema; flagged as a candidate
-- for a future scoped RLS extension, not fixed here (see that doc's
-- "What remains open" section for why a broad RLS retrofit across the
-- ~130 tables without it is deliberately not attempted in one pass).
-- This file adds the same defense-in-depth
-- layer to the tables this phase's audit flagged as high-risk and
-- previously had NO row-level security at all: purchase orders, payment
-- authorizations, platform revenue, payout instructions, agreements +
-- signatures, change orders, disputes, retainage + lien waivers, progress
-- photos, COI records, referral-partner financial records, and the
-- remaining procurement-package/bid satellite tables.
--
-- Every policy below was written by reading the actual route code that
-- reads/writes that table (server/src/routes/*.ts) and matching its real
-- authorization logic, not written speculatively - see the per-table
-- comments for exactly which route/function each policy mirrors. Where a
-- table is written to by more than one legitimate party (e.g. both the
-- developer and vendor company on a change order, or a counterparty who
-- signs an agreement by verified email without being a member of the
-- party company), the policy allows exactly those parties, no one else.
--
-- current_user_email(): a new helper, backed by a new "app.user_email" GUC.
-- Needed because agreements.ts's isCounterparty() authorizes a signer by
-- their VERIFIED SESSION EMAIL (server/src/auth.ts's auth.email, never
-- client-supplied) against agreements.counterparty_email - a real,
-- external-signer access path that company membership alone cannot
-- express. server/src/lib/requestContext.ts, auth.ts, and pool.ts were
-- extended to carry and set this GUC the same way app.user_id/app.is_admin
-- already are (transaction-local via set_config(..., true), so it never
-- survives past COMMIT/ROLLBACK and never leaks between pooled
-- connections - identical safety property to the existing two).
--
-- Same FORCE ROW LEVEL SECURITY requirement as schema-rls.sql (the app
-- connects as the table-owning role, which Postgres exempts from RLS
-- unless FORCE is set).
--
-- Zero em dashes by convention.

create or replace function current_user_email()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.user_email', true), '')
$$;

-- ============================================================================
-- purchase_orders
-- READ:  developer (member of developer_company_id, or of the company that
--        owns the package's building) OR the vendor (vendor_company_id) OR
--        admin. Mirrors award-workflow.ts's authorizePoRead().
-- WRITE: the developer only (or admin). Mirrors authorizePoWrite() - a
--        vendor may read but never mutate a purchase order.
-- ============================================================================
alter table purchase_orders enable row level security;
alter table purchase_orders force row level security;

drop policy if exists purchase_orders_select on purchase_orders;
create policy purchase_orders_select on purchase_orders
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or exists (
      select 1 from packages p
        join buildings b on b.id = p.building_id
       where p.id = purchase_orders.package_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists purchase_orders_insert on purchase_orders;
create policy purchase_orders_insert on purchase_orders
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists purchase_orders_update on purchase_orders;
create policy purchase_orders_update on purchase_orders
  for update using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists purchase_orders_delete_admin on purchase_orders;
create policy purchase_orders_delete_admin on purchase_orders
  for delete using (current_user_is_admin());

-- ============================================================================
-- payment_authorizations, award_documents
-- Both are RECORD-ONLY satellites of a purchase order with no owning-company
-- column of their own. Visibility/write mirrors the parent PO exactly:
--   - payment_authorizations: written only via authorizePoWrite (developer
--     or admin); read via authorizePoRead (developer or vendor or admin).
--   - award_documents: written AND read via authorizePoRead - both the
--     developer and the assigned vendor may upload a closeout/warranty doc.
-- ============================================================================
alter table payment_authorizations enable row level security;
alter table payment_authorizations force row level security;

drop policy if exists payment_authorizations_select on payment_authorizations;
create policy payment_authorizations_select on payment_authorizations
  for select using (
    exists (
      select 1 from purchase_orders po
       where po.id = payment_authorizations.purchase_order_id
         and (
           po.developer_company_id::text = any(array(select current_user_company_ids()))
           or po.vendor_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );

drop policy if exists payment_authorizations_write on payment_authorizations;
create policy payment_authorizations_write on payment_authorizations
  for all using (
    exists (
      select 1 from purchase_orders po
       where po.id = payment_authorizations.purchase_order_id
         and po.developer_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

alter table award_documents enable row level security;
alter table award_documents force row level security;

drop policy if exists award_documents_policy on award_documents;
create policy award_documents_policy on award_documents
  for all using (
    exists (
      select 1 from purchase_orders po
       where po.id = award_documents.purchase_order_id
         and (
           po.developer_company_id::text = any(array(select current_user_company_ids()))
           or po.vendor_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- platform_revenue
-- READ:  the developer or vendor named on the row (GET /me/success-fees in
--        revenue.ts is a real vendor-facing route scoped to
--        vendor_company_id), or admin.
-- WRITE: admin, PLUS the developer that owns the purchase order this accrual
--        is for - award-workflow.ts's resolveAndRecordFee() inserts/updates
--        platform_revenue directly from the developer's own payment-auth
--        request (already gated by authorizePoWrite before it runs), not
--        from an admin route. Vendors never write this table.
-- ============================================================================
alter table platform_revenue enable row level security;
alter table platform_revenue force row level security;

drop policy if exists platform_revenue_select on platform_revenue;
create policy platform_revenue_select on platform_revenue
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists platform_revenue_write on platform_revenue;
create policy platform_revenue_write on platform_revenue
  for all using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- payout_instructions
-- READ:  the recipient (recipient_company_id or recipient_user_id), or
--        admin. Mirrors payouts.ts's GET /payouts/mine.
-- WRITE: admin only. Every real INSERT (lib/split-engine.ts) and every
--        status-transition UPDATE (release/fail/block) runs behind
--        router.use("/admin/payouts", requireAdmin) in payouts.ts, or
--        behind the equally admin-gated /admin/revenue "mark collected"
--        path in revenue.ts - traced both call sites, neither is reachable
--        by a non-admin request. The one non-admin-triggered UPDATE
--        (payouts.ts's GET /payouts/connect/status promoting a recipient's
--        own pending instructions to 'ready' after a successful Stripe
--        onboarding refresh) is scoped through connect_accounts, which the
--        recipient already owns - allowed via the connect_account_id join.
-- ============================================================================
alter table payout_instructions enable row level security;
alter table payout_instructions force row level security;

drop policy if exists payout_instructions_select on payout_instructions;
create policy payout_instructions_select on payout_instructions
  for select using (
    recipient_company_id::text = any(array(select current_user_company_ids()))
    or recipient_user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists payout_instructions_insert_admin on payout_instructions;
create policy payout_instructions_insert_admin on payout_instructions
  for insert with check (current_user_is_admin());

drop policy if exists payout_instructions_update on payout_instructions;
create policy payout_instructions_update on payout_instructions
  for update using (
    current_user_is_admin()
    or exists (
      select 1 from connect_accounts ca
       where ca.id = payout_instructions.connect_account_id
         and ca.owner_company_id::text = any(array(select current_user_company_ids()))
    )
  );

drop policy if exists payout_instructions_delete_admin on payout_instructions;
create policy payout_instructions_delete_admin on payout_instructions
  for delete using (current_user_is_admin());

-- ============================================================================
-- connect_accounts
-- READ/WRITE: the owning company (owner_company_id) or the owning user
--        (owner_user_id, the investor case), or admin. Mirrors
--        payouts.ts's isMemberOf()-gated self-service routes exactly.
--        Referral-partner-owned accounts (owner_referral_partner_id) have
--        no session-derived identity to check today - the one existing
--        route that reads them by referralPartnerId (GET
--        /payouts/connect/status) never verified the caller was actually
--        that partner, an app-layer gap outside this file's scope. This
--        RLS layer intentionally does NOT special-case that column, which
--        closes the gap for non-admin callers rather than reproducing it.
-- ============================================================================
alter table connect_accounts enable row level security;
alter table connect_accounts force row level security;

drop policy if exists connect_accounts_policy on connect_accounts;
create policy connect_accounts_policy on connect_accounts
  for all using (
    owner_company_id::text = any(array(select current_user_company_ids()))
    or owner_user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

-- ============================================================================
-- partner_commissions, partner_payouts
-- WRITE: admin only - partner-rev.ts is entirely router.use(requireAdmin),
--        and monetization.ts's only non-admin-route insert
--        (maybeRecordReferralCommission) already wraps its write in
--        runAsAdmin() (see that function - unrelated to this file).
-- READ:  admin, PLUS a company that IS the referral partner (via
--        referral_partners.company_id) - lib/procure-coo.ts's COO
--        dashboard surfaces a company's own referral earnings from this
--        exact join (requireUser, not requireAdmin).
-- ============================================================================
alter table partner_commissions enable row level security;
alter table partner_commissions force row level security;

drop policy if exists partner_commissions_select on partner_commissions;
create policy partner_commissions_select on partner_commissions
  for select using (
    exists (
      select 1 from referral_partners rp
       where rp.id = partner_commissions.partner_id
         and rp.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists partner_commissions_write_admin on partner_commissions;
create policy partner_commissions_write_admin on partner_commissions
  for insert with check (current_user_is_admin());

drop policy if exists partner_commissions_update_admin on partner_commissions;
create policy partner_commissions_update_admin on partner_commissions
  for update using (current_user_is_admin());

drop policy if exists partner_commissions_delete_admin on partner_commissions;
create policy partner_commissions_delete_admin on partner_commissions
  for delete using (current_user_is_admin());

alter table partner_payouts enable row level security;
alter table partner_payouts force row level security;

drop policy if exists partner_payouts_select on partner_payouts;
create policy partner_payouts_select on partner_payouts
  for select using (
    exists (
      select 1 from referral_partners rp
       where rp.id = partner_payouts.partner_id
         and rp.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists partner_payouts_write_admin on partner_payouts;
create policy partner_payouts_write_admin on partner_payouts
  for all using (current_user_is_admin());

-- ============================================================================
-- agreements
-- READ/UPDATE: a member of party_company_id, OR the verified counterparty
--        (session email = counterparty_email - agreements.ts's
--        isCounterparty(), used by /sign, /view, and the party-or-
--        counterparty read gate), OR admin.
-- INSERT: a member of party_company_id only (POST /agreements requires
--        assertMember on partyCompanyId) OR admin.
-- ============================================================================
alter table agreements enable row level security;
alter table agreements force row level security;

drop policy if exists agreements_select on agreements;
create policy agreements_select on agreements
  for select using (
    party_company_id::text = any(array(select current_user_company_ids()))
    or (counterparty_email is not null and lower(counterparty_email) = lower(current_user_email()))
    or current_user_is_admin()
  );

drop policy if exists agreements_insert on agreements;
create policy agreements_insert on agreements
  for insert with check (
    party_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists agreements_update on agreements;
create policy agreements_update on agreements
  for update using (
    party_company_id::text = any(array(select current_user_company_ids()))
    or (counterparty_email is not null and lower(counterparty_email) = lower(current_user_email()))
    or current_user_is_admin()
  );

drop policy if exists agreements_delete_admin on agreements;
create policy agreements_delete_admin on agreements
  for delete using (current_user_is_admin());

-- ============================================================================
-- agreement_signatures
-- READ/INSERT: a party to the underlying agreement (party_company_id member
--        OR verified counterparty email), matching /sign's own check. A
--        counterparty-only signer has no signer_company_id, so this MUST be
--        checked via the parent agreement, not a column on this table.
-- ============================================================================
alter table agreement_signatures enable row level security;
alter table agreement_signatures force row level security;

drop policy if exists agreement_signatures_policy on agreement_signatures;
create policy agreement_signatures_policy on agreement_signatures
  for all using (
    exists (
      select 1 from agreements ag
       where ag.id = agreement_signatures.agreement_id
         and (
           ag.party_company_id::text = any(array(select current_user_company_ids()))
           or (ag.counterparty_email is not null and lower(ag.counterparty_email) = lower(current_user_email()))
         )
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- change_orders
-- READ:  developer (developer_company_id member) OR vendor
--        (vendor_company_id member) OR admin. Mirrors change-orders.ts's
--        authorizeRead().
-- WRITE: developer only (or admin) - mirrors authorizeWrite(). A vendor may
--        read but never mutate a change order at the DB layer either.
-- ============================================================================
alter table change_orders enable row level security;
alter table change_orders force row level security;

drop policy if exists change_orders_select on change_orders;
create policy change_orders_select on change_orders
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists change_orders_write on change_orders;
create policy change_orders_write on change_orders
  for all using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- change_order_audit
-- READ:  same visibility as the parent change order (developer or vendor).
-- INSERT: developer only (or admin) - every real insert (change-orders.ts's
--        audit() helper) runs immediately after a successful
--        authorizeWrite(), never from a vendor-initiated request.
-- Append-only in the app (no UPDATE/DELETE route exists); no update/delete
-- policy is defined, so RLS denies both by default.
-- ============================================================================
alter table change_order_audit enable row level security;
alter table change_order_audit force row level security;

drop policy if exists change_order_audit_select on change_order_audit;
create policy change_order_audit_select on change_order_audit
  for select using (
    exists (
      select 1 from change_orders co
       where co.id = change_order_audit.change_order_id
         and (
           co.developer_company_id::text = any(array(select current_user_company_ids()))
           or co.vendor_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );

drop policy if exists change_order_audit_insert on change_order_audit;
create policy change_order_audit_insert on change_order_audit
  for insert with check (
    exists (
      select 1 from change_orders co
       where co.id = change_order_audit.change_order_id
         and co.developer_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- disputes
-- READ/UPDATE: filed_by_company_id or against_company_id member, or admin -
--        mirrors disputes.ts's isParty check used by GET/PATCH /disputes/:id.
-- INSERT: filed_by_company_id must be a company the caller belongs to (POST
--        /disputes always inserts the caller's OWN company as
--        filed_by_company_id via getCompanyId()). against_company_id is
--        deliberately NOT membership-checked here - filing a dispute
--        against an unrelated company you are transacting with is the
--        entire point of the feature, matching the route's own behavior
--        (which never checks the caller belongs to against_company_id).
-- ============================================================================
alter table disputes enable row level security;
alter table disputes force row level security;

drop policy if exists disputes_select on disputes;
create policy disputes_select on disputes
  for select using (
    filed_by_company_id::text = any(array(select current_user_company_ids()))
    or against_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists disputes_insert on disputes;
create policy disputes_insert on disputes
  for insert with check (
    filed_by_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists disputes_update on disputes;
create policy disputes_update on disputes
  for update using (
    filed_by_company_id::text = any(array(select current_user_company_ids()))
    or against_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- dispute_messages
-- READ:  a party to the parent dispute may see every message they are
--        author of AND every message marked is_visible_to_both; admin sees
--        everything (including internal admin_note rows) - mirrors
--        disputes.ts's GET /disputes/:id message query exactly (its
--        `AND m.is_visible_to_both = true` clause for non-admins).
-- INSERT: a party to the parent dispute, with author_company_id forced to
--        be a company the caller belongs to (matches the route always
--        inserting the caller's OWN companyId as author_company_id).
-- ============================================================================
alter table dispute_messages enable row level security;
alter table dispute_messages force row level security;

drop policy if exists dispute_messages_select on dispute_messages;
create policy dispute_messages_select on dispute_messages
  for select using (
    current_user_is_admin()
    or (
      is_visible_to_both = true
      and exists (
        select 1 from disputes d
         where d.id = dispute_messages.dispute_id
           and (
             d.filed_by_company_id::text = any(array(select current_user_company_ids()))
             or d.against_company_id::text = any(array(select current_user_company_ids()))
           )
      )
    )
    or author_company_id::text = any(array(select current_user_company_ids()))
  );

drop policy if exists dispute_messages_insert on dispute_messages;
create policy dispute_messages_insert on dispute_messages
  for insert with check (
    author_company_id::text = any(array(select current_user_company_ids()))
    and exists (
      select 1 from disputes d
       where d.id = dispute_messages.dispute_id
         and (
           d.filed_by_company_id::text = any(array(select current_user_company_ids()))
           or d.against_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- retainage_records
-- READ/UPDATE: vendor_company_id or developer_company_id member, or admin -
--        mirrors retainage.ts's GET/PATCH /retainage checks exactly.
-- INSERT: developer_company_id member only (or admin) - mirrors
--        assertCanCreateAgainstBuilding(), which requires the caller be a
--        member of the BUILDING's owning company (== developerCompanyId),
--        never the vendor.
-- ============================================================================
alter table retainage_records enable row level security;
alter table retainage_records force row level security;

drop policy if exists retainage_records_select on retainage_records;
create policy retainage_records_select on retainage_records
  for select using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists retainage_records_insert on retainage_records;
create policy retainage_records_insert on retainage_records
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists retainage_records_update on retainage_records;
create policy retainage_records_update on retainage_records
  for update using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- lien_waivers
-- Same shape as retainage_records: read/update open to both named
-- companies (retainage.ts's PATCH /lien-waivers/:id allows either party to
-- act, with the specific transition - e.g. only the developer may accept -
-- enforced at the app layer, same as it already was before this phase's
-- P0-04 fix); insert restricted to the developer via
-- assertCanCreateAgainstBuilding().
-- ============================================================================
alter table lien_waivers enable row level security;
alter table lien_waivers force row level security;

drop policy if exists lien_waivers_select on lien_waivers;
create policy lien_waivers_select on lien_waivers
  for select using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists lien_waivers_insert on lien_waivers;
create policy lien_waivers_insert on lien_waivers
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists lien_waivers_update on lien_waivers;
create policy lien_waivers_update on lien_waivers
  for update using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- progress_photos
-- READ/INSERT: the building owner OR an assigned vendor (a company with a
--        bid on any package under the building), mirroring this phase's
--        own P0-03 fix (progress-photos.ts's assertCanAccessBuilding()).
-- UPDATE/DELETE: the uploading company only (uploaded_by_company_id), or
--        admin - narrower than read, matching the PATCH/DELETE routes'
--        own stricter check.
-- ============================================================================
alter table progress_photos enable row level security;
alter table progress_photos force row level security;

drop policy if exists progress_photos_select on progress_photos;
create policy progress_photos_select on progress_photos
  for select using (
    exists (
      select 1 from buildings b
       where b.id = progress_photos.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or exists (
      select 1 from bids bd
        join packages p on p.id = bd.package_id
       where p.building_id = progress_photos.building_id
         and bd.vendor_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists progress_photos_insert on progress_photos;
create policy progress_photos_insert on progress_photos
  for insert with check (
    exists (
      select 1 from buildings b
       where b.id = progress_photos.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or exists (
      select 1 from bids bd
        join packages p on p.id = bd.package_id
       where p.building_id = progress_photos.building_id
         and bd.vendor_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

drop policy if exists progress_photos_update on progress_photos;
create policy progress_photos_update on progress_photos
  for update using (
    uploaded_by_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists progress_photos_delete on progress_photos;
create policy progress_photos_delete on progress_photos
  for delete using (
    uploaded_by_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- coi_certificates
-- READ/WRITE: the owning company (company_id), or admin - mirrors coi.ts's
--        isMember()-gated GET/POST/PATCH/DELETE /coi routes exactly.
--        GET /coi/summary's broader cross-company aggregate-count read (no
--        buildingId ownership check at all) is a separate, pre-existing
--        app-layer gap - and is currently unreferenced by the frontend
--        (verified: no caller anywhere in src/). RLS intentionally does
--        NOT reproduce that gap; it is documented, not carried forward.
-- ============================================================================
alter table coi_certificates enable row level security;
alter table coi_certificates force row level security;

drop policy if exists coi_certificates_policy on coi_certificates;
create policy coi_certificates_policy on coi_certificates
  for all using (
    company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

-- ============================================================================
-- coi_requirements (min-coverage requirements a developer sets for a
-- building's vendors). No route in the app currently reads or writes this
-- table (verified: zero references outside its own schema file) - RLS is
-- added anyway per this table's inclusion in the explicit "COI records"
-- high-risk category, using the same visibility model as the other
-- building-scoped satellite tables (packages, package_line_items): public
-- read (a vendor must be able to see the insurance bar before bidding),
-- write restricted to the building's owning company or admin.
-- ============================================================================
alter table coi_requirements enable row level security;
alter table coi_requirements force row level security;

drop policy if exists coi_requirements_select on coi_requirements;
create policy coi_requirements_select on coi_requirements
  for select using (true);

drop policy if exists coi_requirements_write on coi_requirements;
create policy coi_requirements_write on coi_requirements
  for all using (
    exists (
      select 1 from buildings b
       where b.id = coi_requirements.building_id
         and b.company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

-- ============================================================================
-- bid_line_items, bid_revisions (bid satellite tables; bid_items itself
-- already covered by schema-rls.sql). Same visibility as the parent bid:
-- the bidding vendor OR the package's building owner, mirroring bids_select
-- / bid_items_policy exactly, via a join on bids (not on these tables
-- themselves, so this cannot recurse).
-- ============================================================================
alter table bid_line_items enable row level security;
alter table bid_line_items force row level security;

drop policy if exists bid_line_items_policy on bid_line_items;
create policy bid_line_items_policy on bid_line_items
  for all using (
    exists (
      select 1 from bids bd
       where bd.id = bid_line_items.bid_id
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

alter table bid_revisions enable row level security;
alter table bid_revisions force row level security;

drop policy if exists bid_revisions_policy on bid_revisions;
create policy bid_revisions_policy on bid_revisions
  for all using (
    exists (
      select 1 from bids bd
       where bd.id = bid_revisions.bid_id
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
-- bid_invites
-- READ:  the invited vendor (vendor_company_id) OR the inviting developer
--        (developer_company_id) OR admin.
-- INSERT/UPDATE: the developer only (intel.ts's POST /intel/invite-vendor
--        upserts with ON CONFLICT DO UPDATE, always gated on the caller
--        being a member of the package's developer company) OR admin.
-- ============================================================================
alter table bid_invites enable row level security;
alter table bid_invites force row level security;

drop policy if exists bid_invites_select on bid_invites;
create policy bid_invites_select on bid_invites
  for select using (
    vendor_company_id::text = any(array(select current_user_company_ids()))
    or developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists bid_invites_write on bid_invites;
create policy bid_invites_write on bid_invites
  for all using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
