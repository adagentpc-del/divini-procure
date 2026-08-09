-- ============================================================================
-- Divini Procure - Phase 1 P1-08: Agreement <-> Purchase Order linkage.
-- ----------------------------------------------------------------------------
-- The Phase 0 audit found agreements disconnected from purchase orders - no
-- column anywhere let a PO reference "its" governing contract, or an
-- agreement know which procurement relationship it actually governs beyond
-- the loose project_id/relationship_id it already carried. This does NOT
-- merge agreements and purchase_orders into one object (Phase 1 instruction
-- section 19 explicitly: "Do NOT necessarily merge... establish explicit
-- relationship"); it adds the missing foreign key plus the contract's own
-- recorded amount, which may legitimately differ from the award/PO amount
-- (section 20) - see lib/financial-model.ts's contractDiscrepancyCents().
--
-- The link is stored on agreements (not purchase_orders) because an
-- agreement always belongs to exactly one PO when linked, while a PO's
-- "governing agreement" is naturally queried the other direction
-- (select * from agreements where purchase_order_id = $1) - no denormalized
-- column needed on purchase_orders. Nullable and set post-hoc: the Phase 1
-- instruction explicitly allows a PO to exist before a contract is signed,
-- or a contract before final PO issuance, whichever order this workflow
-- actually happens in for a given deal - this file does not assume either
-- order and does not fabricate a link for an ambiguous historical agreement.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table agreements add column if not exists purchase_order_id uuid references purchase_orders(id) on delete set null;
alter table agreements add column if not exists contract_amount_cents bigint;

create index if not exists idx_agreements_purchase_order on agreements (purchase_order_id);
