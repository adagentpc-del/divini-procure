# Divini Procure — Procurement Graph Data-Readiness Map (Design Proposal)

**Status: DESIGN/AUDIT ONLY. No Procurement Graph, historical pricing intelligence,
predictive vendor scoring, or portfolio intelligence is built or implied by this
document.** Per the Phase 0 freeze, this catalogs what already exists that a real
Procurement Graph would need, and what does not exist yet — nothing more.

## 1. Preserve `lib/procure-moat.ts` — it is not being replaced, it is an input

`procure-moat.ts` already implements three deterministic, real, data-backed
capabilities (verified by reading the file, not assumed): **Divini Score**
(0–100 vendor/developer reputation), **Relationship Graph** (materialized
company-to-company edges), and **War Room** (ranked operational health flags per
project/portfolio — missing documents, overdue submittals, late deliveries,
orphan awards with no approved vendor relationship). All three are pure functions
over existing tables: no LLM, no randomness, same input always produces the same
output.

**This document's position: a future Procurement Graph is moat.ts's natural
successor, not its replacement.** A "graph" in the Procurement Graph sense is a
richer, queryable structure over the same underlying facts moat.ts already
computes flat scores and flag lists from. Concretely:

- `buildRelationshipEdges()` / `relationshipGraph()` **already produce graph edges**
  between companies. A Procurement Graph is this same edge set, extended with edge
  *weights* and *types* the current implementation doesn't yet compute (see §3).
- `diviniScore()`'s five weighted factors (win rate, delivery, submittals, reviews,
  profile completeness) are exactly the kind of per-node feature vector a graph-based
  scoring model would want as its baseline/fallback — a Procurement Graph should
  never be *worse* at explaining a vendor's score than the deterministic version
  already is.
- `warRoom()`'s flags are real-time signals a graph-based "predict which
  relationships are at risk" model would consume as training/validation signal, not
  discard.

Nothing in this phase touched `procure-moat.ts` beyond reading it for this
document. It remains the live, correct, deterministic system it already was.

## 2. What already exists (verified against the schema and route code this session)

| Attribute category | Exists today | Table / source |
|---|---|---|
| Company identity + type | Yes | `companies` (kind: buyer/vendor/investor) |
| Vendor verification tier | Yes | `vendor_profiles.verify_status` (pending/ai-verified/approved/flagged) — this is the exact signal Phase 0 item 20 used to define "qualified"/"Divini Verified" marketplace visibility |
| Vendor services/trades | Yes | `vendor_profiles.services` (text array) |
| Vendor credentials | Yes | `vendor_credentials` (type, scanned confidence, status) |
| Company relationships | Yes | `developer_vendor_relationships` (relationship_status, admin_review_status) — already the edge source for moat.ts's graph |
| Bid history | Yes | `bids`, `bid_line_items`, `bid_revisions` (see item 24's own consolidation doc) |
| Award/procurement outcomes | Yes | `purchase_orders` (now FK-integrity-checked, Phase 0 item 13) |
| Delivery performance | Yes | `deliveries`, `delivery_events`, `delivery_punch_items` |
| Submittal performance | Yes | `submittals`, `submittal_history` |
| Vendor ratings | **Yes, as of Phase 0 item 19** — `reviews` (rater/ratee/package/stars/body) now has a real write path for the first time; previously permanently empty |
| Change order pattern (frequency, size, approval rate per vendor/developer pair) | Data exists (`change_orders`) but **no aggregate/derived field anywhere reads it this way yet** | `change_orders` |
| Payment reliability (how promptly a developer pays) | Partially — `payment_authorizations.authorized_at`/`released_at` exist as raw timestamps, but **no derived "days to pay" or reliability score exists** | `payment_authorizations` |
| Retainage/dispute friction per relationship | Data exists (`retainage_records`, `disputes`) but **no aggregate reads it as a relationship-health signal yet** | `retainage_records`, `disputes` |
| Geographic/regional data | Partial — `buildings.location` and `companies` have no structured geography, only free text (this is exactly why Phase 0 item 21's search treats "location" as a text/trigram field, not a real geo index) | `buildings.location` |
| Pricing history per trade/category | Data exists (`bids.price`, `purchase_orders.amount_cents`) but **no historical-pricing-intelligence aggregation exists at all** — this is explicitly the "historical pricing intelligence" capability the Phase 0 freeze names as NOT to be built yet |
| Cost benchmarking across projects | **Does not exist.** Would need the financial model in the companion proposal (`canonical-procurement-financial-model.md`) as its foundation — a benchmark needs a real "what did this cost, normalized" number, which does not exist in the schema today. |

## 3. What Phase 1 would need to add for a real Procurement Graph (not built here)

1. **Edge weighting.** `developer_vendor_relationships` today is a status
   enum, not a weighted/scored edge. A graph model needs a numeric strength
   (transaction count, dollar volume, recency-decayed) — computable entirely from
   existing `purchase_orders`/`bids` rows, no new source data required.
2. **Edge typing beyond developer↔vendor.** Today's graph is bipartite
   (developer↔vendor via `developer_vendor_relationships`). A richer graph would
   add vendor↔vendor edges (co-bid on the same package — data exists in `bids`,
   never aggregated this way) and package↔package edges (same building, same
   trade category — data exists in `packages`, never aggregated this way).
3. **Time-series, not point-in-time.** `diviniScore()` computes and persists a
   single current score (`vendor_profiles`-adjacent, via `listScores()`). A graph
   model benefits from score *history* — this needs either a new append-only
   `score_history` table or a decision to compute scores retroactively from
   timestamped source rows on demand (the latter is more consistent with this
   codebase's "recompute from source, never trust a cached increment" pattern
   established in the companion financial-model document, §4.1).
4. **The financial model from the companion document.** Cost benchmarking and
   "was this a good price" intelligence cannot exist without `budget_committed`/
   `budget_spent`/`change_order_delta` as real, computed fields first — see
   `canonical-procurement-financial-model.md`.
5. **A real invoice/payment-timing signal**, if Phase 1 decides to build the
   "Invoice submitted" event the financial-model document leaves open (§5 there) —
   currently there is no vendor-initiated timestamp to measure payment speed
   against.

## 4. What this document explicitly does NOT propose

No vector database, no embedding model, no LLM-driven graph construction, no
"Ask Divini" natural-language interface, no predictive scoring model, no cost
benchmarking implementation. Every item in §3 is describable as a deterministic
aggregation over existing (or the companion document's proposed) schema — matching
this codebase's established AI-architecture posture (deterministic-first,
LLM-optional-enrichment, never the reverse) that Phase 0 item 25's investigation
confirmed is already how this system is built, and that this phase was told to
preserve, not weaken.
