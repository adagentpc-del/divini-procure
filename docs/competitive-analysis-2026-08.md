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

1. **Lien waiver management with e-sign + escrow-hold-until-payment** — GCPay, Trimble Pay, Textura, Levelset. Nearly universal among payment-focused competitors; Divini's financial spine covers payments/retainage but not the lien-waiver workflow itself. A major US construction-payments compliance gap.
2. **Automated preliminary notice / mechanics-lien filing by jurisdiction** — Levelset. High-friction legal compliance turned into a sticky service; nobody else in this comparison set offers it.
3. **Vendor prequalification & insurance/COI/license compliance tracking** — BuildingConnected (TradeTapp), Avetta, Vertikal RMS, Jones, Billy. Table stakes for enterprise GCs; would meaningfully deepen the Divini Score with hard compliance data rather than only transactional history.
4. **Free/freemium subcontractor-side tier to drive network growth** — BuildingConnected, PlanHub. A GTM gap, not a feature gap: marketplace network effects depend on low-friction, no-cost vendor onboarding.
5. **Bid leveling & side-by-side quote comparison with historical cost benchmarking** — Procore, BuildingConnected, ProcurePro. Divini has quote comparison (`quote-comparison.ts`) but not cross-project historical benchmarking - notably, this is exactly the "cost benchmarking" capability the AI/Procurement Graph freeze explicitly excludes until authorized.
6. **Plan room with granular activity tracking** (who viewed/downloaded/bid) — PlanHub, Procore, BuildingConnected. Goes beyond document management into bid-engagement transparency for the developer.
7. **Deep accounting/ERP integrations** (QuickBooks, Sage, Xero, Viewpoint) — Buildertrend, GCPay, ProcurePro. Commonly cited adoption blocker when a procurement/financial tool doesn't sync with a GC's existing books. **Partially closed (INV-01):** a generic invoices CSV export (`GET /reports/invoices/:buildingId.csv`, docs/accounting-export.md) shaped for import into any accounting system's own generic bill/journal importer. Deliberately NOT a certified/OAuth-connected QuickBooks or Xero integration - that needs developer credentials and a real account to test honestly, which this environment does not have. The invoice model itself (P1-10) also had no frontend at all until INV-01 added it to AwardWorkflow.tsx; before this, invoices were create/read-only via direct API calls.
8. **AI-generated scope-of-work / RFP bundles from plans and specs** — Brickanta, Parspec, Procore AI. A live 2025-26 competitive wedge; strong structural fit for Divini's canonical data spine, but explicitly out of scope under the current AI freeze ("AI package generation" is named directly).
9. **Early-payment / trade-credit financing for subcontractors** — Billd, Briq Cash, and the newly funded subcontractor-payments marketplace. A fintech layer competitors bundle onto payment data; a natural extension of Divini's payments/retainage spine, but a monetization/lending decision, not an engineering one - out of scope under the pricing freeze without explicit authorization.
10. **Mobile-first field execution app** (daily logs, time clock, photos, punch lists) — Buildertrend, Procore, BuildOps. Divini is procurement/financial-centric with no field-execution mobile surface.
11. **Open app marketplace / public API ecosystem** — Procore, Autodesk Construction Cloud, ProcurePro's integration list. Extensibility functions as a moat and reduces switching-cost objections.
12. **"Lessons-learned" vendor knowledge base tied to past project performance** — ProcurePro. A relatively cheap, high-value enrichment of the Divini Score with qualitative post-project data. **Closed:** the existing post-completion review (REV-01) now also captures three optional facts (would rehire / on time / on budget) and a guided "what would you tell the next developer hiring this vendor for similar work" field, each review's originating package's trade category is surfaced alongside it, and a developer viewing bids sees same-category past lessons highlighted first when evaluating a vendor for a similar project. Deliberately NOT folded into the Divini Score's numeric calculation - matching lib/vendor-signals.ts's "facts only, never a score" rule already established this session; the knowledge-base value is in surfacing the actual notes, not another hidden weighting.
13. **Bidirectional reputation: developer/GC payment-behavior transparency**, not just vendor scoring — Levelset's "payment profiles" (which GCs pay late). A differentiated trust signal Divini's two-sided marketplace could uniquely own, since it already sits on the full payment spine (`payment_authorizations`, `external_payment_records`) - this is a natural `procure-moat.ts` extension, same shape as the commitment-weighted edges just built.
14. **Client/investor-facing transparency portal** — Buildertrend's homeowner portal (residential pattern), adaptable to a lightweight investor-visibility view of the frozen Capital Partner module - but any change there needs its own explicit authorization per the standing investor/capital freeze.
15. **Algorithmic discovery, onboarding wizards, richer trust badges** (verified/top-rated/response-time SLAs) — Faire, Thumbtack, Upwork. Adjacent-marketplace UX patterns that would improve marketplace conversion versus a static vendor directory.

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

## Suggested next step

This is a snapshot, not a roadmap. If you want to act on it, the next step
is picking 2-3 items from the non-frozen pool (most likely #1 lien waivers,
#3 vendor prequalification, and #13 bidirectional reputation, given they
build directly on financial/relationship data Divini already has) for a
proper scoping pass before any implementation - matching how the AI layer
work was scoped before it was built.
