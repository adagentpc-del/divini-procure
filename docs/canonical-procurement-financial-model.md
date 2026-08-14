# Divini Procure — Canonical Procurement + Financial Model (Design Proposal)

**Status: PROPOSAL ONLY. Not implemented in Phase 0.** Per the Phase 0 instruction
set, this document is a design deliverable for approval, not a build. It exists so
Phase 1's real budget/financial engine has an actual target to build toward instead
of being invented from scratch under time pressure, and so nothing built in Phase 0
accidentally forecloses on it.

Written from direct knowledge of the live schema and every route that reads/writes
it, gained while implementing Phase 0 items 2–21 (in particular: the retainage↔PO
linkage fix, the PO foreign-key integrity pass, the RLS pass across the money
tables, and the marketplace visibility/search work). Nothing below is speculative
about what currently exists — every claim about current state was verified against
`db/apply-all.sql` and the relevant route file this session.

## 1. The architectural win this design must not undo

`packages.visibility` (`db/schema-marketplace-publication.sql`) makes marketplace
publication a **property of the procurement package object**, not a separate
listing row in a separate table. A package is simultaneously "the thing a developer
is trying to buy" and "the thing a vendor sees in the marketplace" — there is no
`marketplace_listings` table shadowing `packages`, no risk of the two drifting out
of sync, no dual-write. **This design keeps that property.** Financial state below
is added as columns on the existing `packages`/`buildings` rows (or a tightly-owned
satellite table keyed 1:1 or 1:many off them), never as a parallel "financial
project" object that could disagree with the procurement object about what the
project even is.

## 2. Current state (what exists today, verified)

| Concept | Table | What it actually has |
|---|---|---|
| Project | `buildings` | `budget` (numeric, single field, developer-entered, never reconciled against anything) |
| Package | `packages` | `budget_min`, `budget_max` (a range estimate); `status` (draft/open/shortlisting/awarded/closed) |
| Bid | `bids` | `price`, `awarded` (bool), `status` |
| Award | `purchase_orders` | `amount_cents`, `status` (draft→issued→acknowledged→in_production→fulfilled/cancelled), FK-integrity now enforced (Phase 0 item 13) |
| Payment record | `payment_authorizations` | RECORD ONLY — `amount_cents`, `fee_cents`, `status` (pending/authorized/released/void). **Never moves money.** |
| Change order | `change_orders` | `cost_impact_cents`, `status` (draft→submitted→under_review→approved/rejected/cancelled) |
| Retainage | `retainage_records` | `contract_amount_cents`, `retainage_held_cents`, `retainage_released_cents`, now `purchase_order_id` (Phase 0 item 12) |
| Lender draw | `draw_requests` | `total_contract_value_cents` — a **building-level** aggregate that is developer-typed, not computed from real POs (documented gap, see §6) |
| Platform revenue | `platform_revenue` | Divini's own fee accrual ledger — not a project/package financial field, orthogonal to this model |

**What does not exist today, at any level:** a single number anywhere in the
schema that answers "what has this project actually committed to spend" or "what
has this package actually spent, including approved change orders, against what
budget." `ProjectHealthBadge`'s "budget score" (renamed to "Bid Participation" in
Phase 0 item 7 specifically *because* it was never a real budget number) is the
clearest evidence this gap has real, user-visible consequences today.

## 3. Proposed financial state fields

### 3.1 Package-level (the real source of truth; project-level rolls up from this)

New columns on `packages` (additive, nullable, no migration risk to existing rows):

```
budget_committed_cents   bigint   -- sum of active (non-cancelled) PO.amount_cents for this package
budget_spent_cents       bigint   -- sum of payment_authorizations where status='authorized' or 'released'
                                      for POs under this package
change_order_delta_cents bigint   -- sum of change_orders.cost_impact_cents where status='approved'
                                      for this package
financial_status         text     -- 'unbudgeted' | 'within_budget' | 'over_budget' | 'no_award_yet'
                                      (derived, see §4.3 — a label, not a separate source of truth)
```

These are **computed/cached columns**, not developer-entered. The actual source of
truth is always the underlying rows (`purchase_orders`, `payment_authorizations`,
`change_orders`); these columns exist purely so a package list/detail view doesn't
need four joins and an aggregate on every render. They are recomputed by the event
propagation in §4, never edited directly by a user or API caller.

### 3.2 Project-level (`buildings`)

New columns on `buildings`:

```
budget_total_cents        bigint  -- developer-entered ceiling (replaces the current
                                       untyped `budget` numeric field — same concept,
                                       correct type)
budget_committed_cents     bigint  -- sum of packages.budget_committed_cents for this building
budget_spent_cents         bigint  -- sum of packages.budget_spent_cents for this building
```

This is the number `draw_requests.total_contract_value_cents` should reference
instead of being independently developer-typed (see §6 — explicitly **not** fixed
in Phase 0, since it is exactly the "real budget engine" this phase was told not to
build).

### 3.3 What this deliberately does NOT include

- No "predicted final cost" / forecasting field — that's a Procurement Graph /
  predictive-intelligence concern (item 23), not a bookkeeping concern.
- No multi-currency support — the entire schema is single-currency (`usd` hardcoded
  in `payout_instructions.currency`); out of scope to introduce here.
- No retroactive backfill of historical `buildings.budget` values into
  `budget_total_cents` — that is a data migration decision for whoever implements
  this, made with real data in front of them, not guessed here.

## 4. Event propagation semantics

Every event below already happens somewhere in the existing route code (this is
Phase 0's own audit trail: award-workflow.ts, retainage.ts, change-orders.ts). What
is proposed is which of the new §3 fields each event recomputes, and the **rule**
that makes this safe: **every recompute is a pure aggregate query over the
authoritative child rows, re-run from scratch, never an incremental += that could
drift.** This matches the existing codebase's own established pattern (e.g.
`retainage_held_cents = round(contract_amount_cents * retainage_pct / 100)`,
computed fresh, not accumulated).

| Event | Where it already happens | What recomputes |
|---|---|---|
| **Bid submitted** | `POST /packages/:id/bids` | Nothing financial. A bid is a proposal, not a commitment. |
| **Bid revised** | `bid_revisions` insert (existing) | Nothing financial — same reasoning. |
| **Bid awarded** | `POST /award/confirm` (award-workflow.ts) | Creates `purchase_orders` row (already does). **New:** recompute `packages.budget_committed_cents` for this package (sum of active POs) and cascade to `buildings.budget_committed_cents`. |
| **PO created** | Same as award (a PO is always created via award today — no standalone "create PO" path exists) | Same recompute as above; this is the SAME event, not a second one. |
| **PO status → cancelled** | `PATCH /award/purchase-orders/:id` | Recompute `budget_committed_cents` (a cancelled PO drops out of the "active" sum) at both levels. |
| **Contract executed** | No dedicated event exists today — the closest analog is an `agreements` row reaching `status='signed'` (Phase 0 item 2's fixed e-signature flow), OR a PO reaching `status='issued'`. **Recommendation for Phase 1: treat PO `status='issued'` as "contract executed" for financial-state purposes** — it is already the point at which the developer has committed, matches `award_documents.doc_kind='po'`, and does not require inventing a new status value. | Recompute `budget_committed_cents` (no change from award, already counted) plus set `financial_status` from `unbudgeted`/`no_award_yet` to `within_budget`/`over_budget` per §4.3. |
| **Change order proposed** | `POST /change-orders` (draft status) | Nothing financial yet — a draft CO is a proposal. |
| **Change order approved** | `PATCH /change-orders/:id` status→approved | Recompute `packages.change_order_delta_cents` (sum of approved COs) and re-derive `financial_status` (budget comparison now includes the delta). Cascade to `buildings`. |
| **Invoice submitted** | **Does not exist as a concept today.** `payment_authorizations` is the closest analog but is explicitly RECORD ONLY and is created by the developer (via `POST /award/purchase-orders/:id/payment-auth`), not submitted by the vendor. Phase 1 should decide whether to build a real vendor-submitted-invoice flow or keep payment_authorizations developer-initiated — **this document takes no position**, since inventing that UX is out of Phase 0 scope. | N/A until decided. |
| **Invoice/payment authorization approved** | `payment_authorizations.status → 'authorized'` (existing) | Recompute `packages.budget_spent_cents` (sum of authorized+released payment_authorizations for this package's POs). Cascade to `buildings`. |
| **Payment recorded** | `payment_authorizations.status → 'released'` (existing — still RECORD ONLY, no real money movement; distinct from the `payout_instructions`/Stripe rail, which pays *recipients*, not the developer→vendor contract relationship) | Same recompute as "authorized" (released is already counted in `budget_spent_cents`'s definition above — authorized and released are both "spent" from the developer's budget perspective, since the platform fee/vendor payment obligation exists either way). |
| **Retainage held** | `POST /retainage` (existing, Phase 0 item 12 already links it to the PO) | No new recompute — retainage is a **subset** of `budget_spent_cents`/`budget_committed_cents`, not additive to them (the retained amount was already counted as part of the PO/payment amount; retainage just tracks how much of it is temporarily withheld). |
| **Retainage released** | `PATCH /retainage/:id` action=release (existing) | No new recompute for the same reason — this changes `retainage_held_cents`/`retainage_released_cents` internally to `retainage_records`, which is orthogonal to the package/project budget rollup. |

### 4.1 Why recompute-from-scratch, not incremental

The codebase already has one incremental-counter near-miss worth learning from:
`split-engine.ts`'s `enqueueSplitsForRevenue` (fixed for observability in Phase 0
item 18) returned a hardcoded `{created: 0}` on partial failure instead of the real
partial count — exactly the class of bug that incremental counters invite. A pure
`SELECT sum(...) FROM purchase_orders WHERE package_id = $1 AND status != 'cancelled'`
re-run on every event cannot drift, cannot double-count a retry, and cannot lose an
update if a write fails partway. The cost (one aggregate query per event instead of
an in-place increment) is negligible at this data volume and buys correctness for
free — this is the same reasoning that makes `retainage_held_cents` already computed
fresh rather than accumulated.

### 4.2 Where this hooks in (mechanically)

Every event in the table above already writes through `award-workflow.ts`,
`retainage.ts`, or `change-orders.ts`. The recompute is a small helper —
`recomputePackageFinancials(packageId)` and `recomputeBuildingFinancials(buildingId)`
— called at the end of each write, inside the same logical unit of work (not a
separate background job; these are cheap aggregate queries, not expensive
computation, so there's no latency reason to defer them the way Phase 0 item 17
deferred outbound email). This keeps the model simple: the cached columns are
always consistent with their source rows by the time the triggering request
responds, with no eventual-consistency window to reason about.

### 4.3 `financial_status` derivation (a label, not a new source of truth)

```
if no active PO for this package:        'no_award_yet'
elif budget_committed + change_order_delta
     > budget_max (packages.budget_max):  'over_budget'
elif budget_max is null:                  'unbudgeted'   -- nothing to compare against
else:                                      'within_budget'
```

This intentionally mirrors the "smallest honest correction" precedent Phase 0 item
7 already set for `ProjectHealthBadge` — a label computed from real committed/change-
order numbers, never a placeholder pretending to be more sophisticated than it is.

## 5. What this design explicitly leaves to Phase 1 to decide

- Whether `payment_authorizations` gains a real vendor-facing "submit invoice"
  action, or stays developer-initiated (§4's "Invoice submitted" row).
- Whether `draw_requests.total_contract_value_cents` should be migrated to
  reference `buildings.budget_committed_cents` directly, and what to do with
  historical draw requests that already recorded a (possibly different) manually-
  typed value — Phase 0 item 12's own retainage-linkage precedent (link going
  forward, never silently rewrite history) should apply here too.
- The exact backfill/migration strategy for existing `buildings.budget` /
  `packages.budget_min`/`budget_max` rows into the new typed columns.
- Whether `financial_status` needs per-tenant visibility rules beyond what already
  exists (e.g., should a bidding vendor see the developer's budget-vs-committed
  comparison? Today vendors never see `budget_max` at all in the marketplace
  browse — this document does not propose changing that).

## 6. Explicitly NOT proposed here

Per the Phase 0 freeze, this is architecture only. No pricing model, no fee
percentage, no subscription-tier change, and no implementation is proposed or
implied by this document. `draw_requests`' disconnect from real PO data (flagged
in Phase 0 item 12's commit) is named here as the concrete first consumer this
model would fix, but fixing it is Phase 1 work.
