-- ============================================================================
-- Divini Procure - Lien waiver e-signature + invoice linkage.
-- ----------------------------------------------------------------------------
-- Closes 2 of the 3 real gaps found in this pass's competitive analysis
-- (docs/competitive-analysis-2026-08.md gap #1): "lien waiver management
-- with e-sign" and payment-status visibility. Deliberately does NOT build
-- monetary escrow - PaymentPolicy.tsx and Terms.tsx already explicitly
-- disclaim Divini acting as an escrow agent for funds, and this migration
-- does not contradict that: "payment-status-aware waiver state" (does the
-- linked invoice show as paid, a visible FACT) is not the same claim as
-- "Divini holds your money until you sign" (a custody claim this platform
-- does not make and is not licensed to make). Per the governing Phase 1
-- instruction's own section 30 ("connect waiver status to payment/invoice/
-- PO/vendor/project where applicable; do not redesign the legal-document
-- workflow"), the existing requested -> submitted -> accepted/rejected
-- workflow and waiver_type taxonomy are UNCHANGED.
--
-- e-signature table mirrors agreement_signatures (db/schema-agreements.sql)
-- exactly - same fields, same append-only shape - reusing the one real
-- e-signature pattern this codebase already has (typed name + explicit
-- affirmation checkbox + IP/user-agent + audit jsonb), not inventing a
-- second one.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table lien_waivers add column if not exists invoice_id uuid references invoices(id) on delete set null;
create index if not exists idx_lien_waivers_invoice on lien_waivers(invoice_id);

create table if not exists lien_waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  lien_waiver_id uuid references lien_waivers(id) on delete cascade,
  signer_name text,
  signer_email text,
  signer_company_id uuid,
  signature_text text,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  audit jsonb
);
create index if not exists idx_lien_waiver_signatures_waiver on lien_waiver_signatures(lien_waiver_id);

-- ============================================================================
-- RLS: same visibility as lien_waivers itself (either named company party,
-- or admin). Append-only - SELECT + INSERT only, no UPDATE/DELETE policy -
-- a signature is a legal record, corrected only by superseding with a new
-- waiver/signature, never edited in place. Matches the append-only pattern
-- already established for agreement_signatures, building_budget_revisions,
-- package_allowance_revisions, and external_payment_records.
-- ============================================================================
alter table lien_waiver_signatures enable row level security;
alter table lien_waiver_signatures force row level security;

drop policy if exists lien_waiver_signatures_select on lien_waiver_signatures;
create policy lien_waiver_signatures_select on lien_waiver_signatures
  for select using (
    exists (
      select 1 from lien_waivers w
       where w.id = lien_waiver_signatures.lien_waiver_id
         and (
           w.vendor_company_id::text = any(array(select current_user_company_ids()))
           or w.developer_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );

drop policy if exists lien_waiver_signatures_insert on lien_waiver_signatures;
create policy lien_waiver_signatures_insert on lien_waiver_signatures
  for insert with check (
    exists (
      select 1 from lien_waivers w
       where w.id = lien_waiver_signatures.lien_waiver_id
         and (
           w.vendor_company_id::text = any(array(select current_user_company_ids()))
           or w.developer_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );
