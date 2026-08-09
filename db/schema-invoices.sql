-- ============================================================================
-- Divini Procure - Phase 1 P1-10: Invoices / Payment Applications.
-- ----------------------------------------------------------------------------
-- The Phase 0 audit found no canonical invoice table anywhere in the schema.
-- This is the minimum durable model the Phase 1 instruction requires - NOT
-- accounting, no schedule-of-values ledger, no tax engine. An invoice links
-- to the exact commitment it draws against (project/package/PO/vendor/
-- developer), carries its own gross/retainage/approved/net figures, and
-- moves through an explicit review lifecycle. Structured line items are
-- supported but optional (a vendor may submit a single lump-sum invoice).
--
-- Money is integer cents (bigint). Status lifecycle:
--   draft -> submitted -> under_review -> approved | rejected -> void
-- 'partially_paid' and 'paid' are NOT set by any direct status PATCH - they
-- are system-derived from linked payments (P1-11: payment_authorizations /
-- external_payment_records with invoice_id set) and only ever written by
-- server/src/routes/invoices.ts's own payment-recording code path, never by
-- a freehand client PATCH. This keeps "paid" meaning what it says: money
-- actually recorded as moved, not a developer's optimistic status change.
--
-- retainage_cents on an invoice is INFORMATIONAL (this invoice's own
-- withheld amount) - the package/project's authoritative running retainage
-- total still comes from retainage_records (Phase 0 item 12), never summed
-- from invoices.retainage_cents, to avoid double counting (Phase 1
-- instruction section 29/50).
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  developer_company_id uuid not null references companies(id) on delete cascade,
  invoice_number text,
  invoice_date date,
  period_start date,
  period_end date,
  gross_amount_cents bigint not null default 0,
  retainage_cents bigint not null default 0,
  approved_amount_cents bigint,
  net_payable_cents bigint,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'partially_paid', 'paid', 'void')),
  over_commitment boolean not null default false,
  file_url text,
  notes text,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  rejected_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  package_line_item_id uuid references package_line_items(id) on delete set null,
  description text,
  cost_code text,
  qty numeric,
  unit text,
  amount_cents bigint not null default 0,
  sort_order int not null default 0
);

create index if not exists idx_invoices_building on invoices (building_id, created_at desc);
create index if not exists idx_invoices_package on invoices (package_id);
create index if not exists idx_invoices_po on invoices (purchase_order_id);
create index if not exists idx_invoices_vendor on invoices (vendor_company_id);
create index if not exists idx_invoices_developer on invoices (developer_company_id);
create index if not exists idx_invoice_line_items_invoice on invoice_line_items (invoice_id, sort_order);

-- ============================================================================
-- RLS: same visibility shape as purchase_orders/awards - developer (member of
-- developer_company_id, or of the company owning the package's building) OR
-- vendor (vendor_company_id) may READ. WRITE (create/edit while draft) is
-- open to either party (a vendor submits its own invoice; a developer may
-- record one on the vendor's behalf, mirroring the external-payment-
-- recording pattern in P1-11) - the route layer restricts approve/reject to
-- the developer only, and the system-derived partially_paid/paid statuses to
-- the payment-recording code path, neither of which RLS itself can express.
-- ============================================================================
alter table invoices enable row level security;
alter table invoices force row level security;

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices
  for select using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists invoices_insert on invoices;
create policy invoices_insert on invoices
  for insert with check (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices
  for update using (
    developer_company_id::text = any(array(select current_user_company_ids()))
    or vendor_company_id::text = any(array(select current_user_company_ids()))
    or current_user_is_admin()
  );

alter table invoice_line_items enable row level security;
alter table invoice_line_items force row level security;

drop policy if exists invoice_line_items_policy on invoice_line_items;
create policy invoice_line_items_policy on invoice_line_items
  for all using (
    exists (
      select 1 from invoices i
       where i.id = invoice_line_items.invoice_id
         and (
           i.developer_company_id::text = any(array(select current_user_company_ids()))
           or i.vendor_company_id::text = any(array(select current_user_company_ids()))
         )
    )
    or current_user_is_admin()
  );
