# Divini Procure — Bid Data Consolidation Plan (Design Proposal)

**Status: DOCUMENTATION ONLY. No migration, merge, or code change is proposed or
implied by this document.** Written per the Phase 0 instruction to document how
`bid_items`, `bid_line_items`, and `bid_revisions` should be consolidated in
Phase 1 without any historical data loss, after tracing every real caller of each
table this session.

## 1. What each table actually is (traced from the live route code, not guessed)

### `bid_items` — the STRUCTURED response table
```sql
create table bid_items (
  id uuid primary key,
  bid_id uuid references bids(id) on delete cascade,
  line_item_id uuid references package_line_items(id) on delete cascade,
  unit_price numeric, qty numeric, amount numeric, note text
);
```
A vendor's priced response to a **specific line item the buyer already defined**
on the package's bill of quantities (`package_line_items`). Present since the
original schema. RLS-protected (`schema-rls.sql`) mirroring `bids`' own visibility
(bidding vendor or the package's building owner).

### `bid_line_items` — the FREEFORM authoring table
```sql
-- original (db/schema.sql):
create table bid_line_items (
  id uuid primary key, bid_id uuid references bids(id) on delete cascade,
  name text, qty numeric default 1, unit_price numeric
);
-- extended additively by db/schema-bid-studio.sql:
alter table bid_line_items add column description text;
alter table bid_line_items add column category text;
alter table bid_line_items add column optional boolean default false;
alter table bid_line_items add column selected boolean default true;
alter table bid_line_items add column sort_order int default 0;
```
A vendor **freely authors its own line items** (no FK to any buyer-defined
schema) — name, qty, unit price, plus (after the Bid Studio extension) a
description, category, optional/selected flags, and manual ordering. Present
since the original schema; substantially extended when Bid Studio (a full
line-item bid-building UX, `routes/bid-studio.ts`) was added on top of it. Now
also RLS-protected as of Phase 0 item 14 (this phase), mirroring `bid_items`'
own policy exactly.

### `bid_revisions` — NOT a line-item table at all
```sql
create table bid_revisions (
  id uuid primary key, bid_id uuid references bids(id) on delete cascade,
  proposed jsonb not null,
  status text default 'pending' check (status in ('pending','accepted','declined')),
  created_by text references users(id), created_at timestamptz default now()
);
```
A **proposed change to an existing bid** (arbitrary JSON payload — could be a
price change, a scope change, anything the negotiation flow proposes), with an
accept/decline workflow. This is orthogonal to the other two tables, not a third
competing representation of the same concept, and does **not** need
consolidating with them — it needs its own review (see §4) but for a different
reason.

## 2. Which UX uses which (traced, not assumed)

| Table | Real callers this session confirmed |
|---|---|
| `bid_items` | `routes/quote-comparison.ts` (buyer-side comparison — **preferred/primary** when present, per that route's own comment: "bid_items is the live priced-bid table") |
| `bid_line_items` | `routes/bid-studio.ts` (vendor-side authoring UX — create/update/delete/reorder line items), `lib/bid-totals.ts` (computes a bid's total from these rows), `routes/intel.ts`, `routes/quote-comparison.ts` (**fallback** when no `bid_items` rows exist — that route's own comment: "Fallback to the standalone bid_line_items table if no priced bid_items") |
| `bid_revisions` | Negotiation/counter-proposal flow (not deeply traced this session — flagged for Phase 1's own audit before any change) |

**The system already has a canonical-selection rule, just not a canonical table**:
`quote-comparison.ts` — the one place both representations are read for the SAME
purpose (comparing vendor bids side by side) — already prefers `bid_items` and
falls back to `bid_line_items`. This existing preference is strong evidence for
which one Phase 1 should treat as canonical **going forward**, without requiring
new design judgment.

## 3. Why two tables exist (a hypothesis worth stating, not a fact)

Structurally, `bid_items` (tied to `package_line_items`) represents "the buyer
defined a bill of quantities; every vendor bids against the exact same items,"
which is precisely what apples-to-apples comparison needs. `bid_line_items`
(freeform) represents "the vendor has no predefined schema to bid against, or
Bid Studio's richer authoring UX wants full control over its own line items
(descriptions, categories, optional add-alternates, custom ordering)." These are
plausibly **two legitimately different bidding modes** — package-defined BOQ vs.
vendor-authored freeform bid — not simply "an old table and a new table that
should have been one from the start." **Phase 1 should confirm this with product,
not assume it from the schema alone** before deciding whether to merge or keep
both with an explicit `bid_pricing_mode` distinction.

## 4. Historical data (confirmed, not assumed)

Both `bid_items` and `bid_line_items` are live, populated tables with real
historical bids — this document does not propose or perform any migration, so no
verification of row counts was needed or done. **Any Phase 1 consolidation must
preserve every existing row in both tables** — per this phase's own migration
discipline (established across items 12 and 13 this session: never silently merge
or deduplicate money-adjacent records, always add new linkage/columns rather than
rewriting history).

## 5. Consolidation options for Phase 1 to choose between (not decided here)

**Option A — Formalize the existing preference, no schema change.** Keep both
tables exactly as they are; codify `quote-comparison.ts`'s existing
prefer-`bid_items`-fallback-to-`bid_line_items` logic as the documented, explicit
rule everywhere a bid's line items are read (`bid-totals.ts`, `intel.ts`, any
future caller), rather than leaving each caller to independently decide. Lowest
risk, zero migration, but leaves two tables to reason about forever.

**Option B — Merge into one table with a `source` discriminator.** Add a
`source` column (`'structured'` referencing `package_line_items` vs
`'freeform'`) to a single unified table, migrate `bid_items` rows in with
`source='structured'` and their existing `line_item_id`, migrate `bid_line_items`
rows in with `source='freeform'` and `line_item_id=null`, keep every other
existing column from both (union of columns, nullable where not applicable to a
given source). Every consumer reads one table. Requires a real migration with
rollback tested against production-shaped data first (per item 29's migration
discipline) and a decision on what happens to Bid Studio's `sort_order`/
`optional`/`selected` columns for `bid_items`-sourced rows (they'd need sensible
defaults, since structured rows never had them).

**Option C — Keep both, but make Bid Studio start from a package's
`package_line_items` when they exist**, i.e., have the vendor-authoring UX
default to structured mode when the buyer provided a BOQ, and only fall back to
freeform `bid_line_items` when the package has no `package_line_items` at all.
This narrows *future* bids toward one path without touching historical data,
while leaving the schema-level consolidation (Option A or B) as a separate later
decision.

This document takes no position on which option Phase 1 should choose — that is
a product decision (does Divini want two legitimately different bidding modes,
or one unified model) that this phase was not asked to make and should not make
by default via schema design.

## 6. `bid_revisions` — separate concern, flagged not resolved

`bid_revisions.proposed` is an arbitrary JSONB blob with no defined shape
anywhere in the code this session traced. Before Phase 1 touches it, a full
inventory of every distinct shape actually stored in production `proposed`
values should be run (not guessed) — this is exactly the kind of "historical
data existence" check item 29's migration discipline requires before any schema
change, and was out of scope to perform in Phase 0.
