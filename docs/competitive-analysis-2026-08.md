# Divini Procure — Competitive Marketplace Analysis (2026-08)

External market research (web search), not a codebase audit. Every gap
claim below names the specific competitor(s) that demonstrate it, rather
than asserting a generic "competitors typically offer X." This is a
snapshot for prioritization, not a commitment to build any of it - several
items below would need their own scoping pass (and, for anything touching
payments/compliance/pricing, explicit authorization) before implementation.

## Competitor summaries

| Competitor | Wedge | Notable capabilities Divini's current build doesn't have | Pricing signal |
|---|---|---|---|
| **Procore** (Bid Management + Preconstruction) | Full-lifecycle suite, precon through field to financials | Native AI analytics, large third-party app marketplace/API ecosystem, mobile field tools; owns Levelset | Bid module ~$500+/mo; enterprise bundles much higher |
| **Autodesk BuildingConnected** | Dominant GC↔sub invitation network, free sub directory (network-effect moat) | TradeTapp risk/prequalification scoring, bid leveling, historical bid benchmarking, deep BIM/CAD tie-in | Free basic sub tier; Pro ~$150-300/user/mo |
| **PlanHub** | Free planroom for GCs to maximize sub reach | Granular activity tracking (who viewed/downloaded/bid), unlimited free GC seats | Free for GCs; subs pay $1,999-3,299/yr by geography |
| **BuildOps** | Unified field-service + PM + financials for trade contractors | GPS/skill-based dispatch, work-order-to-invoice in one flow (not a bidding marketplace, but a strong ops-financials UX model) | - |
| **Buildertrend** | Residential/remodeler all-in-one | Homeowner-facing client portal, selections/proposals, warranty tracking | Volume-based, ~$339-1,099/mo, no per-seat charge |
| **GCPay** | Deep AIA-style payment-application automation | Lien waiver templates with 80+ auto-filled fields, escrow-hold of signed waivers until funds release, direct ACH | Overlaps Divini's financial spine but far deeper lien-waiver automation |
| **Trimble Pay / Textura** | Payment management + compliance vault | "Lien Waiver Vault," e-signed waivers, ERP-connected payment ops | Part of Trimble Construction One |
| **Levelset** (owned by Procore) | Lien-rights/compliance-as-a-service | Jurisdiction-aware preliminary notices, mechanics-lien filing, freemium lead-gen, "payment profiles" showing which GCs pay slowly | Freemium + paid filings from $149 |
| **Newer entrants** | AI-native wedges | Brickanta ($8M seed) - AI generates RFP bundles from plans in ~15 min; ProcurePro - full procurement lifecycle + "lessons-learnt" vendor knowledge base; Parspec ($20M Series A) - AI MEP sourcing; CoCrafter - AI scope-matching; an unnamed payments marketplace raised $25M Series A (June 2026) | Validates fintech-plus-marketplace as a funded thesis |
| **Prequalification specialists** | Avetta, Vertikal RMS, Jones, Billy | Standalone COI/insurance/license compliance tracking | Signals GCs pay separately when their core platform lacks this |
| **Adjacent B2B marketplaces** | Faire, Thumbtack/Angi, Upwork/Fiverr, Amazon Business | Net-60 terms, algorithmic discovery, milestone escrow, tiered trust badges, guided RFQ | UX patterns, not construction-specific |

## Ranked gap list (highest priority first)

1. **Lien waiver management with e-sign + escrow-hold-until-payment** — GCPay, Trimble Pay, Textura, Levelset. Nearly universal among payment-focused competitors; Divini's financial spine covers payments/retainage but not the lien-waiver workflow itself. A major US construction-payments compliance gap. **Closed (LW-01, LW-02):** e-signature and invoice linkage, plus the signing UI.
2. **Automated preliminary notice / mechanics-lien filing by jurisdiction** — Levelset. High-friction legal compliance turned into a sticky service; nobody else in this comparison set offers it. **Still blocked:** needs real per-jurisdiction legal filing data/rules this environment can't source or validate honestly.
3. **Vendor prequalification & insurance/COI/license compliance tracking** — BuildingConnected (TradeTapp), Avetta, Vertikal RMS, Jones, Billy. Table stakes for enterprise GCs; would meaningfully deepen the Divini Score with hard compliance data rather than only transactional history. **Closed (VQ-01):** license tracking + compliance snapshot.
4. **Free/freemium subcontractor-side tier to drive network growth** — BuildingConnected, PlanHub. A GTM gap, not a feature gap: marketplace network effects depend on low-friction, no-cost vendor onboarding. **Closed (VD-01), pricing/tiering itself untouched:** investigation found the free tier already exists and is already marketed accurately (`Pricing.tsx`/`Landing.tsx` already say "free to join," account creation has no payment gate, 5 free bids/quarter). The actual gap was that the "free, mandatory" verification step (`lib/verificationGate.ts`) had no working self-serve path: `POST /me/verification/documents` existed but referenced `vendor_credentials.file_key`/`file_name`/`type` columns that were never added to the schema (or, for `type`, never populated) - a genuine bug that 500'd on every real call, with no frontend ever wired to it and a dead `/app/settings/documents` link in the onboarding checklist pointing nowhere. Fixed: added the missing columns (`db/schema-verification.sql`), fixed the insert, added a self-serve `GET /me/verification/documents` listing endpoint, and built the actual upload UI (`Profile.tsx`) plus fixed the dead checklist link. No pricing numbers, tier definitions, or billing logic touched - this makes the existing free tier's mandatory gate actually reachable, which is what "low-friction, no-cost onboarding" requires in practice.
5. **Bid leveling & side-by-side quote comparison with historical cost benchmarking** — Procore, BuildingConnected, ProcurePro. Divini has quote comparison (`quote-comparison.ts`) but not cross-project historical benchmarking - notably, this is exactly the "cost benchmarking" capability the AI/Procurement Graph freeze explicitly excludes until authorized. **Still frozen.**
6. **Plan room with granular activity tracking** (who viewed/downloaded/bid) — PlanHub, Procore, BuildingConnected. Goes beyond document management into bid-engagement transparency for the developer. **Closed (PA-01, DOC-01):** who-viewed tracking, plus the document-visibility fix that unblocked download tracking for bidding vendors.
7. **Deep accounting/ERP integrations** (QuickBooks, Sage, Xero, Viewpoint) — Buildertrend, GCPay, ProcurePro. Commonly cited adoption blocker when a procurement/financial tool doesn't sync with a GC's existing books. **Partially closed (INV-01):** a generic invoices CSV export (`GET /reports/invoices/:buildingId.csv`, docs/accounting-export.md) shaped for import into any accounting system's own generic bill/journal importer. Deliberately NOT a certified/OAuth-connected QuickBooks or Xero integration - that needs developer credentials and a real account to test honestly, which this environment does not have. The invoice model itself (P1-10) also had no frontend at all until INV-01 added it to AwardWorkflow.tsx; before this, invoices were create/read-only via direct API calls. **Still open:** the certified OAuth integrations themselves remain undone and untestable here.
8. **AI-generated scope-of-work / RFP bundles from plans and specs** — Brickanta, Parspec, Procore AI. A live 2025-26 competitive wedge; strong structural fit for Divini's canonical data spine, but explicitly out of scope under the current AI freeze ("AI package generation" is named directly). **Still frozen.**
9. **Early-payment / trade-credit financing for subcontractors** — Billd, Briq Cash, and the newly funded subcontractor-payments marketplace. A fintech layer competitors bundle onto payment data; a natural extension of Divini's payments/retainage spine, but a monetization/lending decision, not an engineering one - out of scope under the pricing freeze without explicit authorization. **Still frozen.**
10. **Mobile-first field execution app** (daily logs, time clock, photos, punch lists) — Buildertrend, Procore, BuildOps. Divini is procurement/financial-centric with no field-execution mobile surface. **Closed as far as this environment honestly can (FL-01):** photos (`ProgressPhotos.tsx`) and punch lists (`DeliveryTracking.tsx`) already existed; FL-01 adds the two missing pieces - daily logs and a time clock (`FieldLog.tsx`, `server/src/routes/field-log.ts`, `db/schema-field-log.sql`) - as mobile-responsive web pages inside the existing app, verified in-browser at phone width. A real installable native app remains out of reach - Capacitor is wired up (`capacitor.config.ts`) but no native project is scaffolded and this environment has no Xcode/Android SDK to build or test one. Scoped to a building where the vendor holds an ACTIVE award (stricter than progress_photos' "any bid" rule); vendor-write / developer-read-only, and RLS keeps two different vendors working at the same building (under different packages) from ever seeing each other's field log - unlike progress_photos' deliberately shared visibility, tested explicitly.
11. **Open app marketplace / public API ecosystem** — Procore, Autodesk Construction Cloud, ProcurePro's integration list. Extensibility functions as a moat and reduces switching-cost objections. **Closed as far as this environment honestly can (API-01 + DEV-01):** developer API platform with personal-access-token keys, real rate limits, and a key-management UI - but that UI (`/api-keys`) was gated behind login and the marketing site never mentioned an API existed, so the "reduces switching-cost objections" value (a prospect sees real extensibility before committing) wasn't actually landing. DEV-01 adds a public, pre-signup `/developers` page (linked from `Landing.tsx` and `Pricing.tsx`) documenting the real platform: auth model, scopes, rate limits, and the same representative endpoint table `docs/api-platform.md` maintains. Deliberately does NOT fabricate a third-party app directory, OAuth-on-behalf-of-another-company, a listing/review process, or webhooks - none of those exist (no real developer ecosystem to list in this environment), and the page says so explicitly rather than implying otherwise. A genuine "other companies list their integrations here" marketplace remains out of reach without a real third-party developer base.
12. **"Lessons-learned" vendor knowledge base tied to past project performance** — ProcurePro. A relatively cheap, high-value enrichment of the Divini Score with qualitative post-project data. **Closed:** the existing post-completion review (REV-01) now also captures three optional facts (would rehire / on time / on budget) and a guided "what would you tell the next developer hiring this vendor for similar work" field, each review's originating package's trade category is surfaced alongside it, and a developer viewing bids sees same-category past lessons highlighted first when evaluating a vendor for a similar project. Deliberately NOT folded into the Divini Score's numeric calculation - matching lib/vendor-signals.ts's "facts only, never a score" rule already established this session; the knowledge-base value is in surfacing the actual notes, not another hidden weighting.
13. **Bidirectional reputation: developer/GC payment-behavior transparency**, not just vendor scoring — Levelset's "payment profiles" (which GCs pay late). A differentiated trust signal Divini's two-sided marketplace could uniquely own, since it already sits on the full payment spine (`payment_authorizations`, `external_payment_records`) - this is a natural `procure-moat.ts` extension, same shape as the commitment-weighted edges just built. **Closed (PR-01).**
14. **Client/investor-facing transparency portal** — Buildertrend's homeowner portal (residential pattern), adaptable to a lightweight investor-visibility view of the frozen Capital Partner module - but any change there needs its own explicit authorization per the standing investor/capital freeze. **Still frozen.**
15. **Algorithmic discovery, onboarding wizards, richer trust badges** (verified/top-rated/response-time SLAs) — Faire, Thumbtack, Upwork. Adjacent-marketplace UX patterns that would improve marketplace conversion versus a static vendor directory. **Closed (VB-01):** a "Trust" column on the developer's bid-comparison table (the actual vendor-discovery surface in this codebase - there is no separate vendor directory/browse page) now shows real, wired badges instead of the dormant `VendorBadges` mockup component: a Verified badge sourced from `vendor_profiles.verify_status = 'approved'` (matching `marketplace-visibility.ts`'s own definition of "the public verified badge"), a Top-rated badge as a disclosed, fixed threshold on the same average-stars/review-count data `ReviewBadge` already shows (>=4.5 stars, >=3 reviews - not a new weighted model), and a plain "Responds in ~Xd" fact computed from the gap between a Procurement-Intelligence invite (`bid_invites.created_at`) and that vendor's first bid on the same package (`lib/response-time.ts`, deliberately public/aggregate like `payment-reputation.ts`). Deliberately NOT folded into the Divini Score - same "facts only, never a score" rule.

## How this maps onto Divini's standing freezes

Several high-value gaps above are directly named in the current freezes and
are **not** implicitly authorized by this analysis:

- **AI freeze**: #5 (cost benchmarking), #8 (AI-generated RFP/scope) are
  explicitly frozen capabilities. The Procurement Graph and Ask Divini work
  already in progress this session builds the *foundation* those would
  need, per `docs/ai-layer-design.md` - it does not build the features
  themselves.
- **Pricing/monetization freeze**: #9 (trade-credit financing) is a lending/
  monetization decision, not an engineering one.
- **Investor/capital freeze**: #14 touches the frozen Capital Partner module.

Gaps #1-4, #6-7, #10-13, and #15 are ordinary product/engineering work with
no freeze conflict - the natural pool to prioritize from next.

**Status as of this update:** #1, #3, #4, #6, #10, #11, #12, #13, #15 are
closed (#10 as far as this environment honestly can - see its own entry
above for the native-app caveat); #7 is partially closed (the certified
OAuth integration itself remains out of reach here); #2 is a deliberate
skip, not a scoping gap - it would require either real, verified per-
state legal data (a compliance/liability decision, not an engineering
one) or fabricating legal content, and the call was made to do neither
without that real input; #5, #8, #9, #14 remain frozen, with no freeze
lifted this pass. Every gap this environment can honestly build without
fabricating data or crossing a freeze has now shipped.

## Suggested next step (superseded below - see the 2026-08-17 fresh scan)

This is a snapshot, not a roadmap. What remains is either genuinely
external (real per-jurisdiction lien-notice data for #2, real third-party
OAuth developer credentials for #7's remaining half, real native mobile
build tooling for #10's remaining half) or behind a freeze the user has
not lifted (#5/#8 AI, #9 pricing, #14 investor - each would need its own
explicit go-ahead, same as #4 needed). Otherwise, treat this analysis as
done and look for value elsewhere (hardening, cleanup, or a fresh
competitive scan later as the market moves).

## Fresh competitive scan (2026-08-17)

Re-ran external market research from scratch rather than re-reading the
snapshot above, per the user's explicit choice of "fresh scan" over
"hardening" or "lift a freeze." Same rules as the original pass: named
competitor demonstrating the gap, no generic "competitors typically
offer X" claims, and the three standing freezes (pricing, AI/Procurement
Graph, investor/Capital Partner) still apply undisturbed - nothing below
is implicitly authorized to touch them.

New signal since the 2026-08 baseline:

- **Procore** shipped agentic AI coworkers in 2026 (Datagrid acquisition,
  a "Connected Common Data Environment," a natural-language RFI-drafting
  agent). Squarely inside the existing AI freeze (#5/#8) - reaffirms it
  stays frozen, does not open new unfrozen scope.
- **Siteline** (subcontractor billing/pay-app automation), **SubBase**
  ($7M Series A, material-procurement RFQ + real-time budget drawdown +
  AI invoice reconciliation), and a new **subcontractor payments
  marketplace** ($25M Series A) all reinforce the existing financial-spine
  and lien-waiver gaps already closed (#1, #7) rather than surfacing a
  new one - Divini's purchase-order/delivery/invoice chain already covers
  SubBase's core loop.
- **SuretyBind** (launched Dec 2025) digitizes surety bond issuance;
  subcontractor default insurance (SDI) is a live 2026 GC risk-transfer
  trend. A genuinely new category, not covered by the original 15-item
  list - see #18 below.
- Change order management and RFI workflow both remain baseline
  "table stakes" per every 2026 buyer's-guide surveyed (Procore, Autodesk
  Construction Cloud, and purpose-built tools alike) - a codebase check
  found Divini already has change orders (`ChangeOrders.tsx`,
  `schema-change-orders.sql`) but had **no RFI concept anywhere** - not a
  partial implementation, not a dead code path, genuinely absent. See #16.
- A codebase check for "closeout" found `schema-package-closeout.sql`
  covers only the FINANCIAL closeout marker (`financially_closed_at`,
  `final_cost_cents` - P1-13/P1-18). There is no physical final-walkthrough
  punch list or warranty-period tracking - distinct from
  `delivery_punch_items` (schema-delivery.sql), which are per-delivery
  material punch items, not a project-level closeout artifact. See #17.

### New ranked gaps (continuing the numbering above)

16. **RFI (Request for Information) tracked workflow** — Procore, Autodesk
    Construction Cloud, and effectively every project-management-adjacent
    competitor surveyed treat a logged, assignable, response-tracked RFI
    queue as baseline infrastructure. Entirely absent from this codebase.
    **Closed (RFI-01):** `rfis` table (`db/schema-rfi.sql`), bidirectional
    workflow - a vendor holding an ACTIVE award raises a question
    (optionally scoped to a package), the developer answers it, either
    side can close it, lifecycle open -> answered -> closed. RLS mirrors
    field-log's three-way shape (developer sees all vendors' RFIs at its
    building; a vendor sees only its own - one vendor's question never
    leaks to a different vendor at the same building under a different
    package). Unlike field-log, this is bidirectional: the vendor may
    close its own RFI but never answer it; only the developer (or admin)
    writes the answer - enforced at the app-layer field-contract level
    (`server/src/routes/rfi.ts`), matching `change-orders.ts`'s
    EDITABLE_FIELDS convention, since RLS alone only draws the row
    boundary, not the per-field one. Sequential per-building numbering
    (`RFI-1`, `RFI-2`, ...) uses a dedicated `rfi_counters` table rather
    than `count(*)` specifically because a plain count at insert time runs
    under the inserting vendor's own RLS-scoped view of `rfis` and would
    collide across different vendors' first RFI at the same building -
    caught by this session's own integration test before it ever reached
    review.
17. **Project closeout: final punch list + warranty tracking** —
    Buildertrend (warranty tracking), Procore, BuildOps. Distinct from the
    existing financial closeout marker (`financially_closed_at` -
    P1-13/P1-18) and from delivery-level punch items
    (`delivery_punch_items` - per-delivery material items, and notably
    with no RLS at all, a pre-existing gap this closure did not touch).
    Also distinct from `award_documents`' `closeout`/`warranty` doc kinds
    (`AwardWorkflow.tsx`), which are just file attachments (a PDF labeled
    "warranty"), not a structured, trackable workflow. **Closed
    (CO-01):** scoped to PACKAGE (matching `change_orders`/`deliveries`'
    own granularity - closeout happens per trade). `warranty_start_date`/
    `warranty_months`/`warranty_terms` added directly to `packages`
    (matching `schema-package-closeout.sql`'s own precedent of plain
    columns over a satellite table); `closeout_punch_items` (three-state:
    open -> resolved -> verified, so the developer confirms a vendor's
    claimed fix rather than trusting it unverified) and `warranty_claims`
    (open -> in_progress -> resolved/denied) as new RLS-protected tables,
    RLS mirroring the awards/field-log/RFI three-way shape - a vendor
    never sees another vendor's punch items or claims at the same
    building. Bidirectional like RFI-01: the developer raises items/
    claims and sets warranty terms; the vendor resolves items and works
    claims; only the developer verifies a fix or denies a claim - a
    vendor can never verify its own fix or deny its own claim, enforced
    at the app-layer field-contract level (`server/src/routes/closeout.ts`).
    New `src/pages/Closeout.tsx`, dual-role like `Rfi.tsx`.
18. **Digital surety bond / subcontractor default insurance (SDI)
    facilitation** — SuretyBind (launched Dec 2025), general 2026 SDI
    uptake for GC risk transfer on CM-at-risk work. **Blocked, external:**
    real bond/SDI issuance requires an underwriting partner integration
    this environment has no credentials for - same shape as #7's
    remaining OAuth-accounting half and #2's jurisdiction lien-notice
    data. A facilitation-only UI with no real underwriter behind it would
    misrepresent a compliance/risk product as functional; not attempted.

**Status as of this update:** #16 (RFI-01) and #17 (CO-01) closed. #18 is
a deliberate skip for the same reason as #2 and #7's remaining half - real
external credentials/data this environment does not have, not a scoping or
engineering gap. No freeze touched. With #16 and #17 closed, every gap
this fresh scan surfaced that can be honestly built without fabricating
data or crossing a freeze has shipped.
