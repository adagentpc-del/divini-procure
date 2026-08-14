-- ============================================================================
-- Divini Procure - Phase 1 P1-11: Payment lifecycle (platform vs external).
-- ----------------------------------------------------------------------------
-- Distinguishes APPROVED FOR PAYMENT from ACTUALLY PAID (Phase 1 instruction
-- section 27) without fabricating a payment-processing rail this codebase
-- does not have: payment_authorizations (db/schema-award-workflow.sql) has
-- always been RECORD ONLY - no Stripe/ACH transfer ever moves money for the
-- developer-pays-vendor leg, confirmed by reading every real call site this
-- session. Its 'authorized' status already means approved-for-payment;
-- 'released' now means paid, on equal footing with a genuinely new
-- capability this phase adds: external_payment_records, for procurement
-- paid OUTSIDE the platform entirely (section 28 - "Payment method: External
-- / ACH outside platform, Recorded by: Developer admin"). PAID, everywhere
-- in this codebase's financial summaries, means released platform
-- authorizations PLUS external records - never an authorization that is
-- merely 'authorized' (see lib/financial-model.ts paidCents()).
--
-- Both payment_authorizations and external_payment_records get an optional
-- invoice_id, so a specific invoice's paid/partially_paid/paid status can be
-- derived (lib/invoice-status.ts recomputeInvoicePaidStatus()) from whichever
-- rail actually recorded money moving against it - never both summed as if
-- they were separate obligations (Phase 1 instruction section 50: no double
-- counting).
--
-- Idempotent: safe to re-run. Money is integer cents (bigint). Zero em
-- dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

alter table payment_authorizations add column if not exists invoice_id uuid references invoices(id) on delete set null;
create index if not exists idx_payment_authorizations_invoice on payment_authorizations (invoice_id);

create table if not exists external_payment_records (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,
  package_id uuid references packages(id) on delete set null,
  vendor_company_id uuid references companies(id) on delete set null,
  developer_company_id uuid references companies(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  method_detail text,
  paid_date date,
  recorded_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_external_payments_invoice on external_payment_records (invoice_id);
create index if not exists idx_external_payments_po on external_payment_records (purchase_order_id);
create index if not exists idx_external_payments_developer on external_payment_records (developer_company_id);
create index if not exists idx_external_payments_vendor on external_payment_records (vendor_company_id);

-- ============================================================================
-- RLS: developer or vendor may READ (same shape as invoices/purchase_orders);
-- only the DEVELOPER (or admin) may INSERT - an external payment is always
-- something the developer's side is attesting to having paid, never a claim
-- a vendor can make about itself. No UPDATE/DELETE policy: an external
-- payment record is append-only, like the budget/allowance ledgers - a
-- correction is a new record (e.g. a reversal note), never an edit to the
-- original.
-- ============================================================================
alter table external_payment_records enable row level security;
alter table external_payment_records force row level security;

drop policy if exists external_payment_records_select on external_payment_records;
create policy external_payment_records_select on external_payment_records
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists external_payment_records_insert on external_payment_records;
create policy external_payment_records_insert on external_payment_records
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );
