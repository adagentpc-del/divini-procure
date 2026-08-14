-- ============================================================================
-- Divini Procure - Phase 1 P1-09: Change Order <-> Purchase Order linkage.
-- ----------------------------------------------------------------------------
-- change_orders already links to building_id/package_id/vendor_company_id/
-- developer_company_id (db/schema-change-orders.sql); the Phase 1 instruction
-- also requires a PO link ("every CO must link to: project, package, PO,
-- vendor, contract/agreement where applicable") so a change order's cost
-- impact can be attributed to the exact commitment it revises. Nullable: a
-- change order can be raised before a package has an active award/PO (or
-- against a package that never goes through one), so this is never
-- back-filled or fabricated for an ambiguous case - only set when
-- server/src/routes/change-orders.ts can resolve a real active award's PO at
-- creation time.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table change_orders add column if not exists purchase_order_id uuid references purchase_orders(id) on delete set null;
create index if not exists idx_change_orders_purchase_order on change_orders (purchase_order_id);
