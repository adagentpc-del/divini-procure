-- Divini Procure - Phase 0 financial source-of-truth fix.
--
-- retainage_records.contract_amount_cents was a freehand number re-entered
-- by whoever created the record, with no reference back to the awarded
-- Purchase Order (purchase_orders.amount_cents) that is the actual
-- canonical contract value for that vendor/package - inviting silent drift
-- between "what the PO says the contract is worth" and "what retainage is
-- computed against". This adds an explicit, nullable link to the PO where
-- one can be resolved (server/src/routes/retainage.ts populates it on
-- create when a matching awarded PO exists for the package + vendor), and
-- keeps contract_amount_cents as-is - this is additive, not a rewrite of
-- historical data, and does not change the retainage percentage/held/
-- released math at all.
--
-- draw_requests.total_contract_value_cents is NOT given the same treatment
-- here: it is a building-LEVEL aggregate (the developer's overall
-- construction contract value for the whole project), not a single
-- vendor/package relationship - the only correct canonical source for it
-- would be a real sum-of-purchase-orders budget rollup, which is exactly
-- the budget/financial engine this phase is explicitly not building.
-- Documented as remaining Phase 1 work in the Phase 0 completion report.
-- Zero em dashes by convention.

alter table retainage_records
  add column if not exists purchase_order_id uuid references purchase_orders(id) on delete set null;

create index if not exists retainage_records_purchase_order_idx on retainage_records (purchase_order_id);
