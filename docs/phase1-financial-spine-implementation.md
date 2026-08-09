# Divini Procure — Phase 1 Canonical Procurement + Financial Spine (As Built)

**Status: IMPLEMENTED.** This document records what Phase 1 actually built, as
opposed to `docs/canonical-procurement-financial-model.md` (the Phase 0 design
proposal it was built from) and `docs/procurement-graph-readiness.md` (the
data-readiness map it partially fulfills). Where this document and the Phase 0
proposal disagree, this document describes the real, shipped behavior — treat
the proposal as historical context, not current truth.

Audience: a future engineer or AI agent who needs to know, without
reverse-engineering the code, what "committed" means, which table is
authoritative for a given number, and why.

## 1. The lifecycle, as implemented

```
PROJECT (buildings)
  └─ budget_original_cents / budget_current_cents / contingency_cents
     revised only via building_budget_revisions (append-only ledger)
  │
  └─ PACKAGE (packages), one row per trade/scope
       └─ allowance_original_cents / allowance_current_cents
          revised only via package_allowance_revisions (append-only ledger)
       │
       ├─ MARKETPLACE PUBLICATION (packages.visibility - unchanged from Phase 0;
       │    still the same object, not a shadow listing)
       │
       ├─ BID (bids) ── BID REVISION (bid_revisions, now a real write path)
       │     the original submitted bid row is never overwritten; a revision
       │     records previous amount, new amount, submitter, reason, and an
       │     accept/decline decision. bids.price only moves when a revision is
       │     explicitly accepted (via financial-auth's escalateToAdmin, since
       │     bids_update RLS is vendor-only).
       │
       ├─ AWARD (awards) — THE canonical commitment event
       │     one ACTIVE award per package (DB-enforced: awards_one_active_per_package
       │     partial unique index). Captures awarded_amount_cents + the exact
       │     bid_revision_id that was active at award time.
       │     └─ PURCHASE ORDER (purchase_orders.award_id, original_amount_cents)
       │           created transactionally in the same request as the award.
       │
       ├─ AGREEMENT / CONTRACT (agreements.purchase_order_id, contract_amount_cents)
       │     explicit link to the PO, not a merge. Supports PO-before-contract
       │     and contract-before-PO. A contract amount that differs from the
       │     award is surfaced as contractDiscrepancyCents, never silently
       │     substituted for the award amount.
       │
       ├─ CHANGE ORDER (change_orders.purchase_order_id)
       │     draft → submitted → under_review → approved/rejected/cancelled.
       │     Only 'approved' rows affect any financial total. Negative
       │     (deductive) change orders are valid and subtract normally.
       │
       ├─ INVOICE / PAYMENT APPLICATION (invoices, invoice_line_items)
       │     draft → submitted → under_review → approved/rejected → 
       │     partially_paid → paid (or void at any point). approved/rejected/
       │     under_review are developer-only transitions; partially_paid/paid
       │     are SYSTEM-derived (see §5) and cannot be set directly via PATCH.
       │     └─ PAYMENT AUTHORIZATION (payment_authorizations.invoice_id)
       │           existing Phase 0 object, now linked to its invoice.
       │           'released' status = actually paid (platform-recorded).
       │     └─ EXTERNAL PAYMENT RECORD (external_payment_records)
       │           developer-recorded, append-only, distinguishable
       │           provenance ("External / recorded by ...", never claims
       │           Divini processed it or triggers a Stripe payout).
       │
       ├─ RETAINAGE (retainage_records, unchanged table from Phase 0, now the
       │     SOLE source of retainage totals — invoices.retainage_cents is an
       │     informational per-invoice line only, never additive into a
       │     package/project total).
       │
       └─ CLOSEOUT (packages.financially_closed_at/by, final_cost_cents)
             explicit POST /packages/:id/close-financials event. Blocked by
             active change orders, unresolved invoices, outstanding retainage,
             or unresolved disputes. Before closeout, "forecast at completion"
             (== revised commitment) is the number to trust; final_cost_cents
             only becomes authoritative after this event fires.
```

## 2. Canonical definitions

The single source of truth for every formula is the header docblock of
`server/src/lib/financial-model.ts` (pure, no-IO, unit-tested functions) —
read it there rather than here, since duplicating it risks the two drifting.
In summary, the term ladder is:

`ORIGINAL BUDGET/ALLOWANCE → CURRENT BUDGET/ALLOWANCE → ALLOCATED →
UNALLOCATED → COMMITTED (award) → CONTRACTED (agreement, tracked alongside,
never overwriting committed) → APPROVED CHANGE ORDERS → REVISED COMMITMENT →
INVOICED (gross) → APPROVED FOR PAYMENT → PAID → RETAINAGE HELD/RELEASED →
REMAINING COMMITMENT → FORECAST AT COMPLETION → VARIANCE → (at closeout) FINAL
COST.`

No step in this ladder is ever summed with another as if it were a separate
cost (§50 of the governing instruction) — award, PO, and contract are three
views of one commitment event; invoice, approval, and payment are three
stages of one obligation; retainage held vs. released is one balance, not two.

All summary numbers are computed live on read by
`server/src/lib/financial-summary.ts` (`computeProjectFinancialSummary`,
`computePackageFinancialSummary`) from the canonical child rows — there is no
cached/mutable total anywhere in Phase 1 that a write path increments or
decrements in place. This is a deliberately stronger reading of the Phase 0
proposal (which suggested cached columns): the Phase 1 instruction requires
avoiding mutable totals that can silently drift.

## 3. Status transition tables

**Award**: `active` → `cancelled` (cancel blocked once the PO is `fulfilled`).
No `reopen`/`reaward` state machine was invented — cancelling an award frees
the package for a brand-new award (a new `awards` row), and the old row is
preserved as history, never deleted.

**Change order**: `draft → submitted → under_review → approved | rejected |
cancelled`. Transition table enforced server-side (`TRANSITIONS` map in
`change-orders.ts`); only `approved` contributes to any total. Status writes
are compare-and-swap (`UPDATE ... WHERE status = $read_value`) — a losing
concurrent request gets 409, or in the case where its own target status was
already reached by the winner, an idempotent 200 no-op (see the concurrency
note in `tests/integration/change-order-financial.test.ts`).

**Invoice**: `draft → submitted → under_review → approved | rejected`, then
system-derived `partially_paid`/`paid` (never client-settable), or `void` from
any non-terminal state. `recomputeInvoicePaidStatus` (in
`server/src/lib/invoice-status.ts`) derives partially_paid/paid from the sum
of released platform payment authorizations plus external payment records
linked to that invoice — it never treats an authorization that is merely
`authorized` as paid.

**Package closeout**: `null → financially_closed_at (terminal)`. Compare-and-
swap on `financially_closed_at IS NULL`; blocked by any active change order,
unresolved invoice, outstanding retainage, or unresolved dispute, each
checked against real rows in the same transaction that performs the closeout.

## 4. Permissions

Every Phase 1 financial read/write is gated the same way: the developer
company that owns the project (`buildingDeveloperCompany` /
`packageContext` in `server/src/lib/financial-auth.ts`), or the specific
vendor company that is a party to the award/PO/invoice/change order in
question, or admin (`isAdmin`, explicit, never a hidden UI-only gate). A
vendor can see its own award, PO, contract, change orders, invoices,
payments, and retainage — never a competitor's bid, another vendor's
financials on the same package, or (unless a future explicit decision is
made) the developer's internal budget/allowance figures. No new investor-
facing surface was built (freeze respected) — the financial architecture is
shaped so that a future read-only stakeholder view can be added without
restructuring (project/package summaries are already a single service call).

RLS backs every one of these checks at the database level, not just in route
code — see `tests/integration/phase1-rls-coverage.test.ts` for a direct
`pg_class`/`pg_policies` catalog check (not a behavioral proxy) confirming
every new Phase 1 table has row-level security both ENABLED and FORCED.

## 5. Tables added or extended (see `db/schema-*.sql` for full DDL)

| Table | Kind | File |
|---|---|---|
| `buildings.budget_original_cents/current_cents/contingency_cents` | extended | `schema-financial-ledgers.sql` |
| `building_budget_revisions` | new, append-only ledger (SELECT+INSERT RLS only) | `schema-financial-ledgers.sql` |
| `packages.allowance_original_cents/current_cents` | extended | `schema-financial-ledgers.sql` |
| `package_allowance_revisions` | new, append-only ledger | `schema-financial-ledgers.sql` |
| `awards` | new, one active per package (partial unique index) | `schema-awards.sql` |
| `purchase_orders.award_id/original_amount_cents` | extended | `schema-awards.sql` |
| `agreements.purchase_order_id/contract_amount_cents` | extended | `schema-agreement-po-link.sql` |
| `change_orders.purchase_order_id` | extended | `schema-change-order-po-link.sql` |
| `invoices`, `invoice_line_items` | new | `schema-invoices.sql` |
| `payment_authorizations.invoice_id` | extended | `schema-payments.sql` |
| `external_payment_records` | new, append-only | `schema-payments.sql` |
| `packages.financially_closed_at/by/final_cost_cents` | extended | `schema-package-closeout.sql` |

The append-only ledger pattern (`building_budget_revisions`,
`package_allowance_revisions`, `external_payment_records`) enforces
correction-via-new-row at the database level: RLS grants SELECT + INSERT
only, combined with `FORCE ROW LEVEL SECURITY`, so there is no UPDATE/DELETE
path even for the table owner. A budget or allowance figure can never be
silently overwritten — only superseded by a new, attributed revision row.

## 6. Historical data migration stance

Phase 1 did not backfill or fabricate any history. `buildings.budget` (the
Phase 0-identified dead field) is left as-is and untouched by the new
`budget_original_cents`/`budget_current_cents` columns, which start `NULL`
until a developer explicitly records a first budget revision. No existing
row was mutated to synthesize a plausible-looking original amount. This is
intentionally conservative per the governing instruction's historical-data
section: mark absence as absence, never guess.

## 7. A discovered PostgreSQL/RLS constraint (architectural finding, not a bug)

`SELECT ... FOR UPDATE` against a table whose RLS `USING` clause contains an
`EXISTS` subquery into another RLS-protected table (e.g. `bids`, whose policy
checks `packages` → `buildings` → `company_members`) reproducibly returns
zero rows in this environment — even though the identical query without `FOR
UPDATE`, and `FOR UPDATE` against a table with a trivial `USING (true)`
policy (e.g. `packages`), both correctly return the row for the same
session/GUCs. This was root-caused with a standalone side-by-side repro
script (not committed — temporary diagnostic) comparing all four
combinations, and worked around architecturally rather than patched: every
concurrency-sensitive Phase 1 write (bid revision accept, award confirm/
cancel, change order status transition, invoice status transition, package
closeout) uses optimistic compare-and-swap
(`UPDATE ... WHERE status = $expected RETURNING *`, zero rows = a concurrent
request won the race) instead of row locks. This is arguably the more robust
pattern regardless of the RLS finding, but the finding itself is worth
preserving here so a future engineer doesn't reach for `FOR UPDATE` on an
RLS-protected table with a cross-table policy and silently get incorrect
zero-row results.

## 8. Procurement Graph readiness

No graph, scoring, or AI was built (frozen per the governing instruction).
Every Phase 1 event now exists as clean, structured, factually-provenanced
data a future Phase 2 could consume without re-deriving it from scratch:
project attributes, package trade/scope, bid vendor/amount/line-items/
revision history, award amount/vendor/date, change order amount/reason,
final commitment/paid/final cost, and the vendor-relationship facts exposed
by `GET /api/vendor-signals` (`server/src/lib/vendor-signals.ts`) — invited,
responded, bid submitted, shortlisted, awarded, original bid amount, final
award amount, change order value, final cost, completion, repeat-
relationship count. These are facts the system can already prove, not an
opaque score; see `docs/procurement-graph-readiness.md` for the fuller
Phase 0 gap analysis this fulfills.

## 9. Where the tests live

Every route/table above has dedicated integration coverage (allow/deny RLS,
concurrency races, worked-example dollar figures) in `tests/integration/`:
`budget-ledgers.test.ts`, `bid-revisions.test.ts`, `awards.test.ts`,
`agreement-po-link.test.ts`, `change-order-financial.test.ts`,
`invoices.test.ts`, `payments.test.ts`, `financial-summary.test.ts`,
`vendor-signals.test.ts`, `phase1-rls-coverage.test.ts`, plus
`project-health.test.ts` for the updated budget-health component. Pure
formula coverage (zero, positive/negative CO, partial payment, multiple
invoices, retainage, over/under budget, cancelled award, void invoice,
failed payment) is in `tests/financial-model.test.ts`.
