# 13 Changelog

Append new entries at the top. Each entry: what, why, files, risks, next.
(The repo also has a separate `CHANGES.md`, but it is stale: it still describes
the Authentik/Supabase era and does not reflect Monetization V2.)

---

## 2026-08-03 (9) - Marketplace publication: visibility, scheduling, and urgency

**What.** Implements the master spec's "marketplace publication" sections
(20-25) on top of the pre-existing `packages` table, rather than a new
parallel listing system. Before this slice, a package with `status='open'`
was already visible to every vendor via `getOpenPackages()` with no
visibility tiers, no validation gate, no scheduling, and no urgency
concept - `POST /packages/:id/status` was the entire "publish" mechanism.
This adds all four, matching the spec's "one controlled submission action,
never automatic" framing.

- **A real correctness bug caught before it shipped**: the natural way to
  add a `visibility` column defaults it to `'private_draft'`, but Postgres
  backfills that default onto every EXISTING row too - which would have
  instantly hidden every already-published package from the marketplace
  the moment this migration ran, since the new `getOpenPackages()` filter
  also checks visibility. Caught in review before writing the route logic;
  fixed by defaulting `visibility` to `'public_marketplace'` instead, so
  every package already open (and every package created through the
  unchanged legacy `createPackage()` path, which still defaults status to
  `'open'`) stays exactly as visible as it always was. `status` remains the
  master gate on whether a package is listed at all; `visibility` only
  narrows WHO can see it once status allows listing.
- **A second bug caught in self-review**: the publish-readiness "has
  documents" check only counted `documents.package_id`, but Divini
  Blueprint's `create-package` action (previous slice) links documents
  through `blueprint_document_package_links` only, never sets
  `documents.package_id` - so a Blueprint-originated package would always
  report "no documents attached" even with several linked. Fixed by
  unioning both sources in `readinessFor()`.
- **Validation gate** (`server/src/lib/marketplace-validation.ts`, pure, 8
  tests): a fixed, hedge-free checklist - visibility chosen, bid due date
  present, question deadline not after the bid due date, review
  acknowledgment given are BLOCKING errors; missing scope or documents are
  WARNINGS only, per the spec's own "do not prevent all bidding if
  documents are incomplete" rule. `POST /packages/:id/publish` always runs
  this first and refuses with the exact errors on failure - it never
  publishes silently.
- **Urgency, gated by a configurable monthly limit**: reuses the existing
  subscription-tier entitlement engine (`server/src/lib/entitlements.ts`)
  rather than a hardcoded number - `urgentListingMonthlyLimit()` /
  `urgentListingsUsedThisMonth()` / `checkUrgentListingLimit()` follow the
  exact override-wins-else-tier-default pattern already used for every
  other limit there. This codebase's real developer tier ladder is
  `developer_free` / `developer_pro` / `developer_enterprise` (not the
  master spec's five-tier Explorer/Starter/Growth/Professional/Enterprise
  naming), so the spec's limits are adapted onto these three: free =
  unavailable (0/month), pro = 5/month, enterprise = unlimited by default
  (contract-defined per company via the existing override column). Usage is
  counted by PUBLISH time, not creation or urgency-flagging time, since the
  limit is about how many urgent listings actually go live in a month.
- **Scheduling with no external cron**: `publish_at` keeps a package in
  draft; a new 5-minute interval in `server/src/index.ts` (same
  in-process pattern as Divini Follow-Up Desk) calls
  `publishDueScheduledPackages()`, which RE-VALIDATES each due package
  (visibility/dates/urgency limit can all have changed since it was
  scheduled) and skips - never force-publishes - anything no longer ready,
  logging why.
- **Publication snapshot**: publishing writes `publication_snapshot`
  (a locked jsonb copy of the package at that moment) so the listing
  content the spec calls for stays fixed even as the working record keeps
  evolving afterward.
- **Batch publish**: `POST /packages/publish-batch` applies shared
  publication settings to a list of packages then attempts each
  independently - one package's validation failure or urgent-limit
  rejection never blocks the others (spec section 25).
- Frontend: `src/pages/PackageDetail.tsx` gains an owner-only "Marketplace
  publication" panel - status/visibility/urgency badges, the live readiness
  checklist (errors block, warnings do not), the urgent-listing usage
  counter, visibility/urgency/date/NDA fields, the spec's exact
  human-review acknowledgment checkbox, and Save / Publish (or
  Save & Schedule, when a future publish date is set) actions.
- **Deferred, not built in this slice**: vendor notification on publish
  (the spec's "notify matched vendors" step). This codebase does not yet
  have a general "new listing matches this vendor's saved trade/geography
  criteria, send an alert" mechanism to hook into - Divini Blueprint's
  addendum publish (previous slice) notifies vendors because it already
  has a concrete audience (existing `bid_invites`/`bids` rows on the
  affected package); a brand-new listing has no such audience yet.
  Building that properly means vendor-matching/saved-search infrastructure
  this slice does not attempt to fake. Pause/close/reopen/extend/clone
  listing controls (spec section 21) also remain out of scope beyond the
  pre-existing `POST /packages/:id/status`.

**Files.** `db/schema-marketplace-publication.sql` (new, synced into
`db/apply-all.sql` right after the subscriptions block, since it extends
`subscription_tiers`/`subscription_entitlements`), `server/src/lib/
marketplace-validation.ts`, `server/src/lib/entitlements.ts` (extended),
`server/src/routes/marketplace-publication.ts` (new, mounted at
`/api/marketplace`), `server/src/db.ts` (`getOpenPackages` visibility
filter), `server/src/index.ts` (the scheduler interval),
`src/pages/PackageDetail.tsx` (extended), `tests/marketplace-
validation.test.ts` (8 tests).

**Permissions.** Same single-owner model as the rest of this build: a
package's owning organization is resolved through
`packages -> buildings -> company_id`; access = member of that company, or
admin. `GET /marketplace/urgent-limit` is scoped the same way.

**Tests completed.** 8 new unit tests (validation gate, pure, no DB), full
suite 115/115 passing. Both server and SPA typecheck clean. Self-review
caught the two real bugs described above before commit. **Not tested
against a live database or in a browser** - same sandbox limitation as
every prior slice this session.

---

## 2026-08-03 (8) - Divini Blueprint: revision linking and addendum publishing (Phase 2 slice)

**What.** Continues the CAD/Drawing/Plan/Specification/Bid Intelligence spec
into its Phase 2 "revision and addendum management" section, closing a gap
left by the previous slice: `documents.parent_document_id` /
`revision_number` / `revision_label` existed in the schema but nothing
populated or read them. This adds a deterministic filename-based revision
suggester, explicit user-confirmed revision linking, and a full
draft -> review -> published addendum workflow that notifies vendors and
tracks acknowledgment - all on top of the existing `documents`, `packages`,
and `bid_invites`/`bids` tables rather than new parallel structures.

- **Revision suggestion is filename-pattern only, never automatic**
  (`server/src/lib/revision-matcher.ts`, pure, 8 tests): strips common
  revision/version/addendum tokens (`rev2`, `v3`, `addendum 1`, ...) and
  compares normalized base names. An exact match after stripping is
  "medium" confidence; a substring relationship is "low"; nothing is ever
  auto-linked - `GET /blueprint/documents/:id/suggest-revision-of` only
  returns suggestions, and `POST .../link-revision` requires the user to
  pick one explicitly.
- **Cycle-safety, a real bug caught and fixed in self-review**: the first
  draft of `link-revision` only rejected linking a document as a revision
  of itself, not a longer cycle (e.g. A -> B, then later B -> A) - which
  would have made the `WITH RECURSIVE` chain-lookup query in
  `GET /blueprint/documents/:id/revisions` loop forever against a real
  database. Fixed two ways: `link-revision` now walks the proposed
  parent's full ancestor chain and rejects any link that would close a
  loop, and the recursive query itself carries a `visited` array guard as
  defense in depth against a cycle introduced any other way.
- **Addenda** (`document_addenda`, `document_addendum_acknowledgments`):
  draft -> review -> published, the same "structural fields are only
  editable before the record leaves draft-like status" invariant used by
  change-orders and Divini Bid Studio elsewhere in this build - a
  published addendum can never be edited again. `affected_package_ids` is
  derived automatically from the selected documents' own `package_id` and
  any `blueprint_document_package_links` rows, never hand-typed.
  `POST /addenda/:id/publish` (gated on `status = 'review'`) finds every
  vendor company with a `bid_invites` or `bids` row on an affected
  package, writes an acknowledgment row per company, notifies every member
  of that company with an in-app `notifications` row, and best-effort
  emails them via the existing gracefully-degrading `lib/email.ts`.
  `POST /addenda/:id/acknowledge` is vendor-side: a user may only
  acknowledge on behalf of a company that actually has a notified
  acknowledgment row, never an arbitrary company id.
- **Honesty boundary maintained**: no content-level diffing ("changed
  dimensions", "changed specifications") is claimed anywhere - this
  codebase cannot read document content, so revision matching is a
  filename suggestion and addendum authorship (what changed, why) is
  entirely user-written.
- Frontend: `src/pages/Blueprint.tsx` now shows, per document, a
  "Check for revision of..." action with inline suggestion buttons; a
  checkbox per document plus a new Addenda card to draft, review, and
  publish; and, for vendor-role companies, the page renders an entirely
  different view (`isVendor` branch) listing addenda published to that
  company with an Acknowledge action. Vendor nav entry added in
  `src/components/Shell.tsx`.

**Files.** `db/schema-blueprint-addenda.sql` (new, synced into
`db/apply-all.sql` right after `schema-blueprint.sql`),
`server/src/lib/revision-matcher.ts`, `server/src/routes/blueprint.ts`
(extended, not a new file), `src/pages/Blueprint.tsx` (extended),
`src/components/Shell.tsx` (vendor nav entry),
`tests/revision-matcher.test.ts` (8 tests).

**Permissions.** Same single-owner model as the rest of Blueprint for
everything on the developer/owner side (addendum belongs to one
`organization_id`; member-of-company or admin). The acknowledge endpoint
is deliberately NOT gated by that same organization check, since the
acknowledging party is a different company (the vendor) than the
addendum's owner - it is instead gated by an existing, already-notified
`document_addendum_acknowledgments` row for one of the caller's own
companies, which prevents both cross-tenant reads and acknowledging on
behalf of a company never actually notified.

**Tests completed.** 8 new unit tests (revision matcher, pure, no DB), full
suite 107/107 passing. Both server and SPA typecheck clean. Self-review
re-read of the new `blueprint.ts` routes caught the revision-cycle bug
described above before commit. **Not tested against a live database or in
a browser** - same sandbox limitation as every prior slice this session.

---

## 2026-08-03 (7) - Divini Blueprint (Slice 5, folding in the CAD/Drawing/Plan/Spec/Bid Intelligence spec)

**What.** A document-intelligence module answering the "CAD, Drawing, Plan,
Specification, and Bid Intelligence" master spec, scoped honestly to what
this codebase can actually do. It classifies every uploaded project
document, suggests likely trade bid packages from that classification, and
optionally drafts a narrative project-summary from an LLM if one is
configured - then lets the user turn accepted suggestions into a real
Divini Scope Builder scope, a real bid package, or a real Divini Pipeline
opportunity. Nothing is ever auto-published; every suggestion requires an
explicit user action to become a real record.

- **Honesty boundary, load-bearing for this whole slice**: this codebase
  has no PDF-parsing, OCR, or CAD-conversion library (confirmed by grep and
  package.json before writing a line of this). The spec calls for reading
  DWG/IFC/RVT content, extracting square footage from drawings, indexing
  sheet numbers, etc. - none of that is technically possible here without
  a third-party conversion/parsing service this deployment doesn't have.
  Rather than fabricate that capability, `document-classifier.ts`
  classifies by **filename and extension only** and is contractually
  incapable of returning "high" confidence anywhere in the module (tested
  explicitly). The optional AI-summary step never receives file bytes,
  only classification counts and text the user typed themselves, and its
  system prompt explicitly forbids inventing quantities, dimensions, or
  material choices. Every summary field carries its own confidence
  (high/medium/low/`manual_confirmation_required`) and source note; the
  required disclaimer ("AI-generated preliminary project information...")
  is returned by the API and rendered verbatim in the UI.
- **Extends, does not duplicate**: uploads reuse the existing
  `POST /api/documents` endpoint (multer, extension/MIME allowlists,
  path-traversal-safe storage keys, pluggable local/S3 storage) - this
  slice only adds classification columns and review workflow on top.
  Accepted trade suggestions create rows in the *existing* `packages`,
  `scope_instances`, and `pipeline_opportunities` tables (Divini Scope
  Builder / Divini Pipeline integration points), not new parallel tables.
- **Deterministic trade suggestion engine** (`server/src/lib/trade-suggester.ts`,
  pure, 8 tests): a fixed discipline-to-trade lookup (e.g. `structural` ->
  both Concrete and Structural Steel), confidence capped at medium (2+
  supporting documents) or low (1), sorted by supporting-document count.
- **Review-before-create gate**: `POST /trade-suggestions/:id/create-package`
  and `.../create-scope` both require `status === 'accepted'` first and
  reject a second create against the same suggestion - mirrors the
  draft-only-editable / explicit-approval pattern used everywhere else in
  this build.
- Covers Phase 1 of the spec's own implementation-priority section (secure
  upload, classification, trade detection, draft bid-package generation,
  editing, with marketplace publishing/scheduling/urgency deferred - see
  below). Phase 2/3 items (specification/CSI-division indexing, CAD
  viewer, budget import/reconciliation, quantity takeoffs, revision and
  addendum workflow, scheduled/urgent marketplace publication, vendor
  matching) are **not built in this slice** and would need their own pass;
  none of them are safe to fake without either a real parsing/CAD service
  or an explicit decision to keep them manual-entry-only.

**Files.** `db/schema-blueprint.sql` (new, synced into `db/apply-all.sql`
after scope-builder/bid-studio/follow-up-desk and before award-workflow,
since it references `packages` and `scope_instances`),
`server/src/lib/document-classifier.ts`, `server/src/lib/trade-suggester.ts`,
`server/src/routes/blueprint.ts` (mounted at `/api/blueprint` in
`server/src/routes.ts`), `src/pages/Blueprint.tsx`, nav entry in
`src/components/Shell.tsx` (buyer Quick Actions), route in `src/App.tsx`,
`tests/document-classifier.test.ts` (10 tests), `tests/trade-suggester.test.ts`
(8 tests).

**Permissions.** A document/run/suggestion belongs to exactly one
`organization_id` (via the linked building's `company_id`); access =
member of that company, or admin - the same single-owner model used by
Pipeline, Scope Builder, Bid Studio, and Follow-Up Desk.

**Tests completed.** 18 new unit tests (10 classifier + 8 suggester), all
pure with no DB, all passing; full suite is 99/99. Both server and SPA
typecheck clean (the SPA's pre-existing `PartnerOnboarding.tsx` errors are
unrelated to this change, confirmed via `git log` on that file predating
this session). Self-review re-read of `blueprint.ts` was performed
specifically checking every SQL column reference against the actual table
definitions (`documents`, `buildings`, `packages`, `scope_instances`,
`pipeline_opportunities`, `pipeline_stage_history`) - no bugs found this
pass. **Not tested against a live database or in a browser** - same
sandbox limitation as every prior slice this session (no Docker, no
`DATABASE_URL`, nothing listening on 5432/5433).

---

## 2026-08-03 (6) - Divini Follow-Up Desk (Slice 4 of the Divini deterministic business tools)

**What.** A rules-based reminder/workflow engine covering the highest-value
cases across the three tools built so far: a Divini Pipeline opportunity
with no activity in 14 days, an unfinished Divini Bid Studio draft, a
submitted bid expiring within 3 days, and a vendor credential (license/
insurance/etc, from the existing verification system) expiring within 30
days. Every workflow's WORDING comes from a fixed template with
`{{merge_field}}` substitution (`server/src/lib/follow-up-scheduling.ts`
`renderTemplate`) and every CONDITION is a named, deterministic check
against the linked record's current state (`conditionMet()` in
`follow-up.ts`) - nothing generated.

- **No cron dependency**: this is a persistent Node process
  (`app.listen`), not serverless, so `server/src/index.ts` runs the engine
  on a real 15-minute `setInterval` in-process. Also triggerable on demand
  via `POST /api/follow-up/process-due` (admin) for testing or an external
  cron if a deployment prefers that instead.
- **Deterministic scheduling** (`server/src/lib/follow-up-scheduling.ts`,
  pure, zero IO, 9 tests): `addDelay()` supports business-day-aware delays
  (skips Saturday/Sunday); `renderTemplate()` does plain `{{key}}`
  substitution and leaves an unmatched token visibly broken rather than
  silently dropping it; `isApproaching`/`isStale` are the two date-window
  checks every seeded condition is built from.
- **User controls**, per the spec's Layer 4 requirements: pause, resume,
  stop any active enrollment (`PATCH /follow-up/enrollments/:id`); enroll a
  specific record into a workflow on demand
  (`POST /follow-up/enroll`, idempotent per workflow+record); full action
  history per enrollment (`GET /follow-up/actions`).
- **Manual approval gate**: a step with `requires_approval=true` pauses the
  enrollment and marks its action `awaiting_approval` rather than sending -
  `POST /follow-up/actions/:id/approve` executes it and resumes the
  sequence. None of the 4 seeded workflows use this yet, but the mechanism
  is real and tested by inspection (see bugs below).

**Two real bugs caught in self-review, fixed before commit** (both in the
approval-gate path, which none of the seeded workflows exercise, so neither
would have surfaced until a custom `requires_approval` workflow was
created):
1. The first draft fell through and advanced the enrollment past a
   `requires_approval` step regardless of whether it had actually been
   approved - the gated message would never send, but the workflow would
   silently move on as if it had. Fixed by pausing the enrollment instead of
   advancing, and adding the missing `/approve` endpoint that executes the
   action and resumes the sequence.
2. Once that was fixed, the action row itself was still never updated from
   `pending` to `awaiting_approval` - so the new approve endpoint's own
   status check would have permanently rejected every approval attempt.
   Caught on the same re-read; fixed with the missing `UPDATE`.

**Files.** `db/schema-follow-up-desk.sql` (new, synced into
`db/apply-all.sql`), `server/src/lib/follow-up-scheduling.ts`,
`server/src/routes/follow-up.ts` (mounted at `/api/follow-up`),
`server/src/index.ts` (the interval), `src/pages/FollowUpDesk.tsx`, nav
entries in `src/components/Shell.tsx` (buyer + vendor), route in
`src/App.tsx`, `tests/follow-up-scheduling.test.ts` (9 new tests, all
pure - no DB).

**Permissions.** An enrollment belongs to exactly one `organization_id`;
access = member of that company, or admin. `POST /process-due` is
admin-only (it processes every organization's due enrollments at once).

**Tests completed.** Unit tests only (9, all passing) for the pure
scheduling/template functions. Server and SPA typecheck clean. **Not
tested against a live database or in a browser** - same sandbox limitation
as the previous three slices (no Docker, no `DATABASE_URL`, nothing on
5432/5433). The condition-evaluation and action-execution logic in
`follow-up.ts` (DB-dependent, not pure) was checked by careful manual
re-read only, which is exactly how the two bugs above were found - this
underlines that a real database run is still needed before considering any
of these four slices actually verified.

**Deferred.** Slice 5 (Divini Profit Map). No automatic enrollment yet - a
Pipeline opportunity, Bid Studio draft, Scope Builder scope, or vendor
credential does not auto-enroll itself into its workflow on creation; a
user (or a future hook in those three route files) must call
`POST /follow-up/enroll` explicitly. No entitlement gating (workflow
automation is a Plus/Pro feature per the spec's plan table; every org
currently gets it for free).

---

## 2026-08-03 (5) - Divini Bid Studio (Slice 3 of the Divini deterministic business tools)

**What.** A structured draft-build-then-submit workflow for a vendor's bid,
extending the EXISTING `bids`/`bid_line_items` tables (`db/schema.sql`)
rather than duplicating them - the existing simple submission path
(`POST /api/packages/:id/bids` -> `submitPricedBid`) and the separate
`bid_items`/`package_line_items` BOQ-pricing feature are both untouched and
keep working. Bid Studio is an alternate path for a vendor who wants: line
items with optional upgrades (buyer can include/exclude), tax/discount/
deposit, a payment schedule (`bid_payment_milestones`), assumptions/
exclusions/terms, an expiration date, versioned drafts (`bid_versions`,
immutable snapshots), and reusable templates (`bid_templates` +
`bid_template_line_items`, "save as template" / "apply template" actions).

- **Deterministic totals** (`server/src/lib/bid-totals.ts`, pure, zero IO,
  10 tests): subtotal = sum of qty x unit price for included line items (an
  optional line item counts only if explicitly selected); total = subtotal
  minus discount plus tax, never negative; deposit is either an explicit
  amount or a percentage of the total. This is the one place in the codebase
  that converts the existing DOLLAR-denominated `bids.price`/
  `bid_line_items.unit_price` columns into integer CENTS, matching the
  money convention used everywhere else built this session.
- **Deterministic readiness score**, same checklist pattern as the previous
  two slices: has a line item, total > 0, expiration set, terms set, deposit
  terms set, assumptions/exclusions listed - 100 points, always shown with
  its breakdown, never a gate beyond basic input validation (at least one
  line item and a positive total are required to submit - that's input
  validation, not a business judgment about the bid).
- **On submit**, the computed total is written into the existing
  `bids.price` column (dollars) alongside the new cents-based breakdown
  columns, so award-workflow.ts, quote-compare, `bid_recommendations`, and
  purchase-order creation all keep reading the same field they always have.

**A real bug caught in self-review, fixed before commit.** The first draft
let a vendor edit line items, milestones, or tax/discount/deposit on a bid
AFTER it was already submitted - since `total_cents`/`price` are only
recomputed at submit time, this would have silently desynced the stored
total from the underlying line items. Found the existing convention for
this in `change-orders.ts` ("fields are only editable while draft") and
added the same guard (`draftEditBlockReason`) to every mutation endpoint.
Also matched the `toTextArray()` + `::text[]`-cast pattern from
`products.ts` for the `exclusions` array field, same as the Scope Builder
fix last commit.

**Files.** `db/schema-bid-studio.sql` (new, additive ALTERs + new tables,
synced into `db/apply-all.sql`), `server/src/lib/bid-totals.ts`,
`server/src/routes/bid-studio.ts` (mounted at `/api/bid-studio`),
`src/pages/BidStudio.tsx`, nav entry in `src/components/Shell.tsx` (vendor
Workspace section), route in `src/App.tsx`,
`tests/bid-totals.test.ts` (10 new tests, all pure - no DB).

**Permissions.** Same single-owner model as Pipeline and Scope Builder: a
draft belongs to its `vendor_company_id`; access = member of that company,
or admin. This is the vendor's own workspace for building a bid, not a
shared record with the developer until submitted.

**Tests completed.** Unit tests only (10, all passing) for the pure totals/
readiness functions. Server and SPA typecheck clean. **Not tested against a
live database or in a browser** - same sandbox limitation as the previous
two slices (no Docker, no `DATABASE_URL`, nothing on 5432/5433). Verified by
careful manual read of the SQL and route logic; still needs a real
`apply-all.sql` run + UI smoke test.

**Known gap, not fixed this pass.** The frontend doesn't yet hide the
line-item edit/remove controls once a bid is submitted - the backend
correctly rejects the request (400, "only a draft can be edited"), but the
UI will show a now-disabled-looking action without explaining why until the
user clicks it. Cosmetic, not a data-integrity issue.

**Deferred.** Slice 4 (Divini Follow-Up Desk), Slice 5 (Divini Profit Map).
No entitlement gating yet. No integration yet with Divini Scope Builder's
line items (a published scope's structured fields don't auto-populate a Bid
Studio draft's line items) - `bids.scope_instance_id` exists as a link but
nothing reads it yet.

---

## 2026-08-03 (4) - Divini Scope Builder (Slice 2 of the Divini deterministic business tools)

**What.** Structured, trade-specific requirement definitions for a bid
package - typed fields (text/number/quantity/date/boolean/select/multiselect)
from a reusable template, not a free-text blob. Five global default templates
seeded (electrical, plumbing, HVAC, concrete, general labor), each with a
handful of trade-specific fields (e.g. electrical: square footage, panel
amperage, circuit count, permit-pulled-by); an organization can define its
own custom template via `POST /scope/templates`.

- Every scope carries six standard narrative sections that apply regardless
  of trade: site conditions, access restrictions, delivery requirements,
  install requirements, exclusions (list), acceptance criteria (list), and
  change-order rules.
- **Deterministic completeness score** (`server/src/lib/scope-completeness.ts`,
  pure, zero IO, 8 tests): required template fields answered count for 40 of
  100 points (proportional), the six standard sections split the remaining
  60. Never a gate on publishing - informational only, shown with its
  positives/missing breakdown, per spec requirement 6 ("never make binding
  decisions for the user").
- **Publishing takes an immutable snapshot** (`scope_versions`, one row per
  publish/republish, never updated) and syncs the scope into
  `packages.requirements` (text[]) as readable lines - the first real writer
  of that column, which `server/src/routes/intel.ts`'s vendor-package
  matching already reads. This is the "publish scope into the RFP" step from
  the spec, scoped to what already exists (package requirements) rather than
  inventing a new RFP/contract document type.
- `scope_change_events` is an append-only log (created/field_updated/
  published/republished/archived) - the audit trail for what changed and
  when.

**Files.** `db/schema-scope-builder.sql` (new, synced into `db/apply-all.sql`),
`server/src/lib/scope-completeness.ts`, `server/src/routes/scope-builder.ts`
(mounted at `/api/scope`), `src/pages/ScopeBuilder.tsx`, nav entry in
`src/components/Shell.tsx` (buyer Procurement section only - this is a
developer/procurement-side tool), route in `src/App.tsx`,
`tests/scope-completeness.test.ts` (8 new tests, all pure - no DB).

**A real bug caught in self-review, fixed before commit.** The first draft of
the `PATCH /scope/instances/:id` route passed JS arrays (`exclusions`,
`acceptanceCriteria`) straight into a parameterized query bound to a
`text[]` column with no explicit cast and no input normalization. Found the
existing precedent in `server/src/routes/products.ts` (`toTextArray()` +
explicit `::text[]` casts) and matched it - added the same helper and casts
here and in the `packages.requirements` write.

**Permissions.** Same model as Divini Pipeline: a `scope_instance` belongs to
exactly one `organization_id`; access = member of that company, or admin.
Global templates (`organization_id` null) are readable by any signed-in
user; an org's own custom templates are scoped to its members.

**Tests completed.** Unit tests only (8, all passing) for the pure
completeness function. Server and SPA typecheck clean. **Not tested against
a live database or in a browser** - same sandbox limitation as Divini
Pipeline (no Docker, no `DATABASE_URL`, nothing on 5432/5433). Verified by
careful manual read of the SQL and route logic only; still needs a real
`apply-all.sql` run + UI smoke test.

**Deferred.** Slice 3 (Divini Bid Studio), Slice 4 (Divini Follow-Up Desk),
Slice 5 (Divini Profit Map). No entitlement gating yet (every org gets
unlimited custom templates and scopes). The "publish into quote request /
proposal / contract" steps beyond `packages.requirements` are not built -
Bid Studio (Slice 3) is where a scope would actually flow into a vendor-
facing bid form.

---

## 2026-08-03 (3) - Divini Pipeline (Slice 1 of the Divini deterministic business tools spec)

**What.** First build from the "Divini deterministic business tools" spec
(construction-domain adaptation: no LLM dependency, branded tools, deterministic
scoring, structured data capture). Divini Pipeline is a user-facing sales/
procurement CRM, distinct from the existing `crm_records` (`db/schema-crm.sql`),
which is Divini's own INTERNAL pipeline for signing up customers - Divini
Pipeline is what a vendor or developer uses to run their OWN funnel:
- **Vendor profile_type**: bid opportunities pursued, stage new -> reviewing ->
  qualified -> info_needed -> bid_in_progress -> bid_submitted -> negotiation ->
  awarded/lost.
- **Developer profile_type**: vendor-sourcing funnel per package, stage new ->
  reviewing -> info_needed -> sourcing_vendors -> bids_in -> comparing ->
  negotiation -> awarded/lost.
- One shared schema/engine serves both profile types (stage definitions are
  org-customizable with a seeded global default per profile type), per the
  spec's "reusable shared engine, not a duplicate per profile" principle.
- **Deterministic readiness score** (`server/src/lib/pipeline-score.ts`, pure,
  zero IO): 8 fixed-point factors (estimated value, next action + date,
  expected close date, category, linked to a real bid/package, client contact
  on file, recent activity within 14 days, an open non-overdue task) summing to
  exactly 100. Never a prediction - always shown with the exact positives/
  missing list that produced it, per spec requirement 8 ("clearly show how
  every output was calculated").
- Full CRUD: opportunities, append-only stage history (never overwritten,
  audit trail for time-in-stage), activities (call/email/note/meeting/
  site_visit), tasks, tags, org-configurable loss reasons and lead sources.
- Stage transitions into a stage flagged `is_won`/`is_lost` automatically set
  `status`/`won_at`/`lost_at` - `status` has no direct free-form write path,
  it only ever derives from a real stage transition.

**Files.** `db/schema-pipeline.sql` (new, synced into `db/apply-all.sql`),
`server/src/lib/pipeline-score.ts`, `server/src/routes/pipeline.ts` (mounted
at `/api/pipeline` in `routes.ts`), `src/pages/Pipeline.tsx`, nav entries in
`src/components/Shell.tsx` (buyer + vendor Quick Actions/Workspace), route in
`src/App.tsx`, `tests/pipeline-score.test.ts` (8 new tests, all pure - no DB).

**Permissions.** An opportunity belongs to exactly one `organization_id`
(unlike a purchase order, this is not a shared record between two companies).
Access = member of that company, or admin.

**Tests completed.** Unit tests only (8, all passing) for the pure scoring
function - exact-100 factor sum, empty-input zero score, recency threshold
boundary, overdue-vs-no-task distinction, both-required next-action check.
Server and SPA typecheck clean. **Not tested**: no live Postgres is available
in this sandbox (checked - no Docker, no `DATABASE_URL`, nothing listening on
5432/5433), so the schema and routes were not exercised against a real
database or verified in a browser. Reviewed the SQL and route logic carefully
by hand as the only available substitute; this still needs a real
apply-all.sql run + manual UI smoke test before considering it verified.

**Deferred (per the spec's own build order).** Slice 2 (Divini Scope Builder),
Slice 3 (Divini Bid Studio), Slice 4 (Divini Follow-Up Desk), Slice 5 (Divini
Profit Map), and the rest of the 12-slice roadmap. Entitlement gating
(Free/Plus/Pro limits on opportunity count, custom stages, automation) is not
implemented yet - every org currently gets the full feature set.

---

## 2026-08-03 (2) - Capital Partner module: rename + compliance boundary + tier ladder

**What.** Product-facing rename of "Investor"/"Investment" to "Capital
Partner"/"Capital" across ~35 files (nav, page headings, form labels, toasts,
admin UIs, the compliance disclaimer, the English i18n source string).
Deliberately did NOT rename: route paths (`/investor`, `/investment-profile`,
...), the `companies.kind`/`subscription_tiers.audience`/permission-level
enum values (all stay `'investor'` at the database level - "historical
database fields," per instruction), or file names.

- **Compliance boundary audit**: confirmed no waterfall/IRR, capital-call, or
  distribution engine exists (correct, per spec); removed the one thing that
  did cross the line - a dormant `capital_introduction` fee-rule type (2%,
  "for investor matching") in the `fee_rules` matrix. It was never actually
  invoked by any route, but its existence was itself a "success fee for
  capital introduction" capability the spec forbids. Removed from
  `FEE_RULE_TYPES`, the DB check constraints, the seed data (with a `delete`
  for any already-seeded row), and the two admin UIs that listed it
  (`AdminFeeMatrix.tsx`, `AdminRevenue.tsx`, which also picked up the
  `platform_infrastructure_fee` type that was missing from their pickers).
- **Capital Partner subscription tiers**: replaced `investor_basic` ($0) /
  `investor_qualified` ($499/mo) / `family_office_concierge` ($999/mo) with
  the spec's four-tier ladder in `subscription_tiers`: `capital_partner_free`
  ($0), `capital_partner_professional` ($49/mo), `capital_partner_institutional`
  ($149/mo), `capital_partner_enterprise` (custom, null price). Also updated
  the separate, actually-live `investor_profiles.plan` admin-assignment
  mechanism (`free`/`premium`/`concierge` -> `free`/`professional`/
  `institutional`/`enterprise`) with a defensive migration for any
  already-set legacy value.
- Added a `VISIBILITY_LABEL` display-only map in `InvestmentPrograms.tsx` so
  wire values like `approved_investor_preview` (a real DB enum, left
  unrenamed) render as "approved capital partner preview" without touching
  the underlying value.

**Files.** ~35 files across `src/pages/`, `src/components/`, plus
`server/src/lib/{entitlements,fee-matrix,monetization}.ts`,
`server/src/routes/subscriptions.ts`, `db/schema-{fee-matrix,revenue,
subscriptions,tiers-monetization}.sql`, `db/apply-all.sql`.

**Risks / not done.**
- **Pipeline stage vocabulary NOT remapped.** The spec's new stages
  (Potential Match, Invited, Access Requested, Access Granted, Reviewing,
  Questions Submitted, Due Diligence, Meeting Scheduled, Following, Closed,
  Archived) do not exist yet; the app still uses the old
  `investor_introduction_requests.pipeline_status` values (`matched`,
  `intro_approved`, `nda_required`, ...), which don't map 1:1. This needs a
  deliberate follow-up (label map at minimum, or a real stage migration),
  not a same-turn text rename.
- **Dormant capital-commitment tracking still exists**, separate from the
  fee I removed: `investor_introduction_requests` has a `soft_commitment`
  pipeline status and a `committed_amount_cents` column, and
  `AdminAnalytics.tsx` has a "Capital committed / Capital closed" KPI section
  reading from them (`server/src/routes/analytics.ts`). Nothing currently
  writes to these (always renders $0 in practice), but their existence is
  schema-level "capital commitment" capability the spec says not to build.
  Flagged, not removed - removing needs a deliberate decision, not a
  drive-by deletion during a rename pass.
- **12 non-English i18n locale files** (`src/i18n/locales/{es,fr,de,...}.ts`)
  still have the old translated string for `roleInvestor`; only the English
  source was updated. Translation is a separate task.

**Next.** Decide on the pipeline-stage remap and the dormant
commitment-tracking removal; translate `roleInvestor` into the other 12
locales.

---

## 2026-08-03 - Unified platform fee model (single source of truth), always-on

**What.** Replaced the three competing fee models (legacy uncapped 10%/2%,
flag-gated Monetization V2's 2%-capped-$2,500/1%-capped-$1,000) with ONE
database-driven model, always active (not flag-gated):
- Standard platform fee: 5%, capped at $25,000.
- Existing-relationship (grandfathered) fee: 2%, capped at $10,000.
- Platform infrastructure fee: 0.1%, capped at $1,500, always its own line
  item, never merged into the platform fee or labeled as a processor fee.
- All three are resolved from the `fee_rules` database table
  (`db/schema-fee-matrix.sql`, extended with a `cap_cents` column and a new
  `platform_infrastructure_fee` rule type), with `config.ts` env constants as
  the fallback default when no row exists yet. A developer- or vendor-scoped
  `fee_rules` row is an enterprise custom fee schedule.
- `payment_authorizations` gained `service_buffer_pct/cap_cents/cents`
  columns alongside the existing `success_fee_*` ones (now holding the
  unified platform fee, not a separate V2-only number).
- `platform_revenue` now allows one ledger row per authorization PER fee type
  (`source_type` in `procurement_fee`/`infrastructure_fee`/...), fixing a
  latent bug where the old auto-resolve path wrote an orphaned ledger row
  with a null `payment_authorization_id` on every award.
- `AwardWorkflow.tsx` payment-authorization rows now have a "View breakdown"
  toggle showing the full invoice (project amount, platform fee, platform
  infrastructure fee, processing fee, taxes, total) and vendor payout (gross,
  platform fee, processing allocation, infrastructure fee allocation, net)
  line items.
- Removed the now-dead legacy fee functions (`computeFeeCents`,
  `computeSuccessFeeCents`, `computeServiceBufferCents`); `fee-matrix.ts`'s
  `resolveContextFee` is the only remaining place a fee amount is computed.

**Why.** Three parallel fee models with no single source of truth was
flagged in the launch-readiness audit as a real risk; asked directly to
consolidate on one model with the new percentages/caps above.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,
fee-matrix,monetization}.ts`, `server/src/routes/award-workflow.ts`,
`db/{schema-fee-matrix,schema-revenue,schema-procure-monetization-v2,
apply-all}.sql`, `src/lib/monetization.ts`, `src/pages/{Pricing,Landing,
Onboarding,AdminConsole,AwardWorkflow}.tsx`, `tests/feeMath.test.ts`.

**Risks.** A pre-existing local/dev DB that already ran the old `fee_rules`
seed (10%, uncapped) is migrated forward by an `update` statement scoped to
rows that still exactly match the old seed values, never an admin edit.
Payment processing fee display is a placeholder ("passed through at charge
time") since no live processor charge is wired yet (Stripe is accrual-only
per `16_TECH_DEBT.md`).

**Next.** QA the new caps end-to-end once a production DB exists; consider
extending the admin fee matrix UI (`AdminFeeMatrix.tsx`) to surface
`cap_cents` for editing (currently DB/API-only).

---

## 2026-06-24 - Monetization V2 build (W1-W5), behind PROCURE_MONETIZATION_V2

**What.** Built the transaction-marketplace money + verification model, flag-gated.
- W1 success-fee math: `successFeeCents` (`lib/feeMath.ts`), `computeSuccessFeeCents`
  (`lib/fee-rules.ts`); env constants in `config.ts`
  (`PROCURE_SUCCESS_FEE_PCT=2`, cap 250000; grandfathered 1%, cap 100000).
- W2 bid credits + verification gate: `lib/bidCredits.ts` (5/quarter, no rollover),
  `lib/verificationGate.ts`; wired into bid submit in `routes.ts`; credential
  expiry tracking + auto-revoke in `routes/verification.ts`.
- W3 subscriptions + Featured + Verified+: `lib/entitlements.ts`,
  `routes/subscriptions.ts`, `routes/featured.ts`, `db/featured.ts`.
- W4 onboarding + bid UI + dashboards (`src/pages/`).
- W5 pricing page (`src/pages/Pricing.tsx`), landing, badges
  (`src/components/VendorBadges.tsx`, `FeeBadge.tsx`).
- Award wiring: `routes/award-workflow.ts` records success fee on
  `payment_authorizations` at Award.

**Why.** Monetize access + outcomes (capped success fee + vendor upgrades), never
the buyer, with verification as the trust moat. See `05_BUSINESS_CONTEXT.md`.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,bidCredits,
verificationGate,entitlements,monetization,relationships}.ts`,
`server/src/db/featured.ts`, `server/src/routes/{award-workflow,verification,
subscriptions,featured,fee-matrix,vendor-pricing,grandfathered-fees}.ts`,
`db/schema-procure-monetization-v2.sql`, many `src/pages/` + `src/components/`.

**Risks.** Flag not yet flipped; vendor credential-upload endpoint and some
dashboard summary endpoints are follow-ups (see `12_TASK_QUEUE.md`). `verify_status`
verified value is `approved`.

**Next.** Wire credential upload, first deploy, set email key, flip the flag.

---

## 2026-06-24 - Security hardening + first-deploy readiness

**What.** Prod fail-closed `SESSION_SECRET` / `DOWNLOAD_URL_SECRET`; deny-by-default
CORS when the allowlist is empty in prod; per-IP auth rate limiting (20/min on
`/api/auth`); created `db/apply-all.sql` (~110 tables, parents-first, idempotent);
rewrote `DEPLOY.md` to the real self-hosted loop; created `FIRST-DEPLOY-RUNBOOK.md`;
scrubbed stale Supabase keys/URLs.

**Why.** Make a misconfigured prod box refuse to start rather than run insecure;
make a first deploy reproducible.

**Files.** `server/src/config.ts`, `server/src/app.ts`, `server/src/lib/rateLimit.ts`,
`db/apply-all.sql`, `DEPLOY.md`, `FIRST-DEPLOY-RUNBOOK.md`, `README.md`.

**Risks.** Prod now requires the secrets to be set before first boot.

**Next.** Set prod env, deploy.

---

## 2026-06-24 - Legal pages, object storage + encryption, tests + CI

**What.** Terms + Payment + Non-Circumvention + Messaging policy pages (Privacy
already existed). Pluggable object storage (`local`|`s3`) with optional AES-256-GCM
encryption at rest. node:test suite (feeMath incl success fee, bidCredits,
passwordHash) -> 39 tests; `.github/workflows/ci.yml` (tsc + test).

**Files.** `src/pages/{Terms,PaymentPolicy,NonCircumvention,MessagingPolicy}.tsx`,
`server/src/lib/{objectStorage,storageCrypto,s3sigv4}.ts`, `tests/*.test.ts`,
`.github/workflows/ci.yml`, `OBJECT-STORAGE.md`.

**Risks.** Storage encryption key, if set, must be preserved (losing it loses files).

**Next.** Manual QA of upload/download + decryption in a deployed env.

---

> Older history (Authentik/Supabase, gap-closure waves, the six-system batch,
> grandfathered 2% fee, super-admin port) predates this OS and lives in the repo
> `CHANGES.md` and the workspace planning docs.
