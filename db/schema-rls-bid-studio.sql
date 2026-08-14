-- ============================================================================
-- Divini Procure - Compliance completion pass: RLS for the Divini Bid Studio
-- satellite tables (db/schema-bid-studio.sql).
--
-- Found while re-verifying the platform against docs/platform-standard's
-- carried-forward "R-18" item (bid_line_items/bid_payment_milestones
-- outside DB-level RLS, real today via app-layer checks only). Re-checking
-- that residual note turned up a bigger gap than the note itself described:
-- bid_payment_milestones is still exactly as flagged, but bid_versions,
-- bid_templates, and bid_template_line_items - three MORE tables added by
-- the same schema-bid-studio.sql migration - also have zero RLS at the
-- database level, confirmed live (pg_class.relrowsecurity = false on all
-- four as of this pass).
--
-- Policy source of truth: server/src/routes/bid-studio.ts's own
-- authorizeDraft()/authorizeViaChild() and the file's header docstring -
-- "a draft belongs to its vendor_company_id. Access = member of that
-- company, or admin - the same single-owner model as Divini Pipeline and
-- Divini Scope Builder (this is the vendor's own workspace for building a
-- bid, not a shared record with the developer until submitted)." This is
-- narrower than bid_line_items_policy in schema-rls-high-risk.sql (which
-- also grants the package's developer company read access, because
-- bid_line_items IS shared with the developer post-submission via
-- quote-comparison.ts) - confirmed by grep that no developer-facing route
-- reads any of these four tables, only bid-studio.ts, exclusively for the
-- bid's own vendor company.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table bid_payment_milestones enable row level security;
alter table bid_payment_milestones force row level security;

drop policy if exists bid_payment_milestones_policy on bid_payment_milestones;
create policy bid_payment_milestones_policy on bid_payment_milestones
  for all using (
    exists (
      select 1 from bids bd
       where bd.id = bid_payment_milestones.bid_id
         and bd.vendor_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

alter table bid_versions enable row level security;
alter table bid_versions force row level security;

drop policy if exists bid_versions_policy on bid_versions;
create policy bid_versions_policy on bid_versions
  for all using (
    exists (
      select 1 from bids bd
       where bd.id = bid_versions.bid_id
         and bd.vendor_company_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );

alter table bid_templates enable row level security;
alter table bid_templates force row level security;

drop policy if exists bid_templates_policy on bid_templates;
create policy bid_templates_policy on bid_templates
  for all using (
    organization_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

alter table bid_template_line_items enable row level security;
alter table bid_template_line_items force row level security;

drop policy if exists bid_template_line_items_policy on bid_template_line_items;
create policy bid_template_line_items_policy on bid_template_line_items
  for all using (
    exists (
      select 1 from bid_templates t
       where t.id = bid_template_line_items.template_id
         and t.organization_id::text = any(array(select current_user_company_ids()))
    )
    or current_user_is_admin()
  );
