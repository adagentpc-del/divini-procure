# Applicability Register

Populated per ALFY2 Section 01.D/E. This is a factual-trigger analysis, not a
legal opinion. Anything not a clean N/A is marked `COUNSEL/OWNER REVIEW
REQUIRED` rather than asserted compliant or non-compliant. Re-run this
register whenever the product adds a new capability (e.g. a live investment
success fee, an EU-facing marketing push, an app-store submission).

## Actor / capability inventory (Section 01.B)

| Actor | Data accessed | Actions | Money movement | Comms | Files | Exposure |
|---|---|---|---|---|---|---|
| Anonymous visitor | Public marketing pages, public opportunity teasers | Browse, register | None | None | None | Public |
| Authenticated user | Own profile, own company's data | Login, manage profile | None directly | Platform notifications | Own uploads | Private |
| Developer/buyer company | Own projects, bids received, vendor directory, capital-raise tools (dual-role) | Post projects, review/award bids, pay vendors **off-platform**, optionally run a capital raise | None through platform for construction payment; Stripe Checkout for own subscription | Package Q&A, notifications | Project docs, plans, specs | Private to company members + assigned vendor + admin |
| Vendor/supplier company | Open bid packages matching services, own bids, own credentials | Submit bids (gated on verification + bid credits), upload credentials, subscribe to Vendor Pro | Stripe Checkout for own subscription; receives construction payment **off-platform** | Package Q&A | License/insurance/W-9/bonding docs | Private to company + admin |
| Capital Partner (investor) company | Investment programs matching visibility rule, own watchlist/introductions | Browse deals, request introductions, subscribe | Stripe Checkout for own subscription; **no fund custody or transfer through the platform** | Introduction requests | NDA-gated offering documents (access-logged) | Private to company + admin; NDA/accreditation-gated |
| Administrator (`ADMIN_ALLOWED_EMAILS`) | Cross-tenant: all companies, all financial/verification/investment records | Verify credentials, manage fee rules, review investment programs, impersonate-adjacent admin tooling | Views/edits ledger records; never a payment counterparty | Sees all threads relevant to disputes | All | Full, server-side gated only |
| Referral partner | Own commission ledger | Sign referral agreement (inline e-sign), supply payout banking info | Receives commission payouts (Stripe Connect transfer, when configured) | None in-app | Agreement snapshot | Own records only |
| Guardian/minor, patient/provider, student/school, employer/applicant/tenant | — | — | — | — | — | **Not present in this product.** No actor of this type exists in the codebase (no age-gating, no health-record schema, no education-record schema, no background-check/consumer-report schema found in `db/schema-*.sql`). |

## Data classification (Section 01.C, abridged — full detail in `docs/SECURITY-PRIVACY.md` and `AI_PROJECT_OS/51_SECURITY.md`)

| Data class | Present? | Storage | Notable finding |
|---|---|---|---|
| Auth credentials/tokens | Yes | `users` table, scrypt-hashed passwords, time-limited verify/reset tokens | PASS — see Section 04 |
| Contact info | Yes | `users`, `companies`, `vendor_profiles` | — |
| Profile info | Yes | Company/vendor/investor profile tables | — |
| Precise/approximate location | Partial | Project/building addresses (business addresses, not consumer geolocation) | — |
| IP/device/network signals | Minimal | Referral-partner e-sign audit trail stores IP/user-agent at acceptance (`schema-referral-partner-onboarding.sql`) | Justified (proof of e-sign), not broad fingerprinting |
| Government identifiers | Partial | W-9/EIN-adjacent fields for vendor onboarding and referral-partner banking | See Section 06 finding below |
| Financial/payment data | Yes | Stripe handles card data (Checkout, hosted page — no raw card element found in the SPA); platform DB holds **bank account numbers for referral-partner payouts in plaintext** (`referral_partner_banking.account_number text` — comment says "encrypt at rest via STORAGE_ENCRYPTION_KEY if desired," but `STORAGE_ENCRYPTION_KEY` only encrypts uploaded files, not DB columns — **this field is not actually encrypted by that mechanism**) | **FINDING — carried to Section 06 as P1**: sensitive banking PII stored in cleartext in Postgres. |
| Tax information | Minimal | Referral-partner W-9-adjacent fields | Same as above |
| Health/medical/PHI | **No** | — | Confirms HIPAA N/A |
| Student/education records | **No** | — | Confirms FERPA N/A |
| Background-check/consumer-report data | **No** | — | Confirms FCRA N/A |
| Biometric identifiers | **No** | — | Confirms biometric-privacy-law N/A |
| Minors' data | **No** — no age gate, no product surface directed at children | — | Confirms COPPA N/A |
| Private messages | Yes | `messages`/`threads` tables (package Q&A is the live mechanism; a separate generic thread system exists but is largely unwired — noted in an earlier pass this session) | — |
| Uploaded documents | Yes | Vendor credentials (license, GL insurance, workers comp, trade cert, W-9, bonding), project plans/specs, investment offering documents | Sensitive — see Section 06/07 |
| AI prompts/outputs | Yes | `lib/llm.ts`, `extract.ts`, `procure-coo.ts`, `score-refresh.ts`, `investor-match.ts` | See Section 08 |
| Analytics/behavior data | Minimal | No third-party analytics SDK found; any behavior tracking is first-party/DB-backed only | — |
| Support tickets | Not found as a dedicated system | — | Carried to Section 14 |
| Audit/security logs | Yes | `document_access_log`, `dvr_audit_log`, `change_order_audit`, `fee_rule_audit`, `investment_audit_log` (per `docs/SECURITY-PRIVACY.md`) | Real, evidenced |

## Regulatory / policy applicability decision matrix (Section 01.D)

| Regime | Applies? | Evidence / basis | Required action |
|---|---|---|---|
| HIPAA / HITECH | **N/A** | No PHI, no covered-entity/business-associate relationship; no health data class present (see table above) | None |
| FTC Health Breach Notification Rule | **N/A** | No health app/service | None |
| 42 CFR Part 2 | **N/A** | No substance-use-disorder records | None |
| COPPA | **N/A** | B2B platform, no child-directed content, no age gate needed because no consumer/minor-facing surface exists | None |
| State minor/teen privacy laws | **N/A** | Same basis | None |
| FERPA / PPRA | **N/A** | Not acting for a school; no education records | None |
| FCRA | **N/A** | No consumer reports/background checks used for employment, housing, credit, or insurance decisions. Vendor "verification" is a documents-on-file check by Divini's own team, explicitly framed as non-warranty (`docs/SECURITY-PRIVACY.md`, `ComplianceDisclaimer.tsx`), not a third-party consumer report | None |
| GLBA / FTC Safeguards Rule | **N/A** | Divini is not itself a financial institution extending credit or managing consumer financial accounts; it facilitates B2B commercial procurement and does not custody funds. **[verified 2026-08-08]** `LenderPortal.tsx` is a developer-facing draw-request/lender-access visibility tool (construction loan draws already extended by a third-party lender) — Divini neither originates nor services the loan | None |
| SEC / FINRA / securities laws | **CONDITIONAL — COUNSEL/OWNER REVIEW REQUIRED** | The platform hosts developer-run "investment programs" (capital raises) with NDA-gated, accredited/non-accredited visibility tiers, investor matching, and introduction workflows (`db/schema-investment*.sql`, `InvestmentPrograms.tsx`, `docs/SECURITY-PRIVACY.md`). **[verified 2026-08-08]** No per-close success fee or transaction-based compensation was found in the code for investment-program closings (`partner_commissions.source` values are `subscription\|transaction\|setup\|enterprise\|manual_adjustment` tied to referring *customers to the platform*, not to capital raised) — the broader roadmap doc explicitly flags a 0.25%-1% close fee as **not built**. Absence of transaction-based comp reduces but does not eliminate broker-dealer exposure; merely hosting/facilitating solicitation of securities to investors can itself raise registration questions independent of fee structure. `ComplianceDisclaimer.tsx`/ `Important disclosures` copy on the investor-facing pages already states Divini "does not provide investment, legal, tax, or financial advice," "is not the issuer, broker-dealer, or investment adviser," and "does not negotiate securities on behalf of any party" — this is the right disclaimer *posture*, but it is not a substitute for actual legal analysis of whether the matching/introduction mechanism itself is a regulated activity. | **Do not build a per-close success fee or any transaction-based investor compensation without counsel sign-off first** (this is the single highest-severity applicability item in this register). Keep current architecture (no fee on close) until reviewed. |
| Money transmission / BSA/AML | **N/A, as currently built** | `docs/SECURITY-PRIVACY.md`: "Payment authorizations are recorded only; the platform never moves funds" for construction payments. Stripe Connect transfers exist for **referral-partner commission payouts** — this is Divini paying its own contractors/partners, not custody of third-party customer funds, so it does not itself look like money transmission, but re-review the instant Stripe goes live for real transfers | `COUNSEL REVIEW` once Stripe Connect payouts go live in production (user is actively wiring this outside this repo per this session) |
| PCI DSS | **Applies, minimal scope** | Stripe Checkout (hosted page) is used for subscriptions; no raw card-element/`Elements` usage found in the SPA (`grep` for `CardElement`/`stripe.js` in `src/pages/*.tsx` found nothing) — this keeps the cardholder-data environment out of Divini's own servers, consistent with **SAQ A** eligibility | `OWNER ACTION`: confirm/complete the actual SAQ A attestation with the payment processor once live; not a code task |
| CCPA/CPRA | **CONDITIONAL — COUNSEL REVIEW** | Depends on current statutory thresholds (revenue/record volume) which this pass cannot verify against live business metrics; California users are not blocked | `COUNSEL/OWNER REVIEW REQUIRED` to confirm threshold status; if applicable, `Privacy.tsx` needs the CCPA-specific rights language and the privacy-request architecture in Section 02 needs a "do not sell/share" toggle wired to real data flows |
| Other U.S. state privacy laws | **CONDITIONAL — COUNSEL REVIEW** | Same reasoning; multi-state thresholds are volume/revenue-dependent and outside this pass's visibility | Same as above |
| GDPR / UK GDPR | **Likely N/A today, re-check before any EU marketing push** | No geo-blocking found, but the product is a US-market (Florida governing law per `52_COMPLIANCE.md`) B2B construction marketplace with no evidence of deliberately targeting EU/UK individuals | `COUNSEL REVIEW` only if/when EU/UK marketing or customers are pursued |
| Biometric privacy laws | **N/A** | No biometric data class present | None |
| CAN-SPAM | **Applies** | Transactional email is live via Resend; marketing-email posture audited in Section 10 | See Section 10 |
| TCPA / state telemarketing | **N/A, no SMS/voice found** | No SMS/telephony provider wired in `package.json` or `server/src/lib/` | Re-check if SMS notifications are added |
| ADA / accessibility | **Applies** | Public-facing commercial service; WCAG 2.2 AA is the engineering baseline | Audited in Section 11 |
| Apple App Store | **CONDITIONAL — not yet applicable** | Capacitor iOS shell exists but is Mac-only/pending, not submitted (`23_DEPLOYMENT.md`) | Re-test at actual submission time; Section 16 |
| Google Play | **CONDITIONAL — not yet applicable** | No Android distribution evidence found | Same |
| FDA device/CDS rules | **N/A** | No diagnostic/clinical decision-support function | None |
| Telehealth / professional licensure | **N/A** | Not a clinical platform | None |
| CJIS | **N/A** | No law-enforcement data access | None |
| Export controls (EAR/ITAR) | **N/A, likely** | No defense articles, no controlled technical data, no encryption-export edge case beyond standard TLS/AES | `COUNSEL REVIEW` only if international vendor/investor onboarding expands to sanctioned jurisdictions — no current geo-restriction logic found to confirm/deny this |
| E-SIGN / UETA | **Applies — implemented** | `db/schema-consent-and-audit.sql` (Florida E-SIGN Act `terms_agreed_at` etc., added earlier in this engagement) and the inline e-sign referral-partner agreement (`schema-referral-partner-onboarding.sql`, IP/timestamp/typed-name capture) are real E-SIGN-pattern implementations | PASS — validate consent-versioning depth in Section 02 |
| Marketplace facilitator / sales tax | **CONDITIONAL — COUNSEL REVIEW** | Divini's revenue (subscriptions, success fees) is B2B service revenue, not facilitating retail sale of tangible goods — marketplace-facilitator sales-tax-collection statutes are more commonly triggered by retail marketplaces; applicability to a B2B success-fee SaaS model is a genuine legal question, not a clean N/A | `COUNSEL/OWNER REVIEW REQUIRED` |
| Information returns / 1099 | **CONDITIONAL — applies once Connect payouts go live** | Referral-partner commission payouts via Stripe Connect transfers are payments Divini makes to its own partners for services — 1099-NEC reporting duties are a standard consequence of this once real transfers occur | `OWNER ACTION`: confirm Stripe (or an accountant) handles 1099 issuance for Connect payouts before the first live payout |
| Automatic renewal laws | **Applies** | Vendor Pro ($149/mo) and Capital Partner paid tiers are recurring subscriptions via Stripe | Audited in Section 09; `Subscription.tsx` cancel flow, renewal-notice copy need a legal pass |
| EU AI Act / algorithmic decision rules | **Likely N/A today** | AI features are drafting/extraction assistance and investor-matching scoring, not used for EU-covered high-risk automated decisions (no EU targeting per above) | Re-check if EU marketing begins or if AI matching becomes a sole/binding decision mechanism (currently advisory — human/admin gates every investment/verification approval per `docs/SECURITY-PRIVACY.md`) |
| Employment AI laws | **N/A** | No hiring/employment decision automation | None |
| SOC 2 | **Market-driven, not legally required** | Gap analysis already performed and documented in `AI_PROJECT_OS/52_COMPLIANCE.md` — reuse that, do not re-derive | See certification table below |
| ISO/IEC 27001 | **Market-driven** | No current pursuit found | See below |
| HITRUST | **N/A** | No HIPAA/health context to make this relevant | None |

## Certification / attestation classification (Section 01.E)

| Certification | Legally required? | Contractually required? | Market-driven? | Current status | Gap | Recommended timing |
|---|---|---|---|---|---|---|
| SOC 2 Type I/II | No | Not yet (no customer contract found requiring it) | Yes, eventually for enterprise developer/vendor accounts | Gap analysis done (`52_COMPLIANCE.md`); CC6 strongest, CC1/CC2/CC9 weakest (org/policy work, not code) | Written policies, incident response plan, formal risk-assessment cadence, log aggregation | Type I realistic after the `[ ]` items in `52_COMPLIANCE.md` are closed; Type II only after 3-12 months of the controls actually running |
| ISO/IEC 27001 | No | No | Possible later | Not pursued | Full ISMS | Not recommended before SOC 2 |
| PCI DSS SAQ A | Contractually (card networks, via Stripe) | Yes, once processing live payments | — | Likely SAQ-A-eligible (Checkout-only, no raw card handling found) | Formal SAQ A attestation not yet filed | `OWNER ACTION` before/at Stripe go-live |
| Penetration test | No | Increasingly expected by enterprise customers | Yes | Not performed (this pass is a code-level audit, not a third-party pentest) | Full external pentest | Recommended before large enterprise contracts; not a launch blocker for current stage |
| HITRUST | No | No | No | N/A | N/A | Not applicable |
| Apple/Google developer account | Yes, if distributing | — | — | Not yet provisioned (iOS Mac-only track pending) | Developer account, app review prep | At Section 16 execution time |

## Output gate (Section 01.F)

**Later sections required, conditional-applicable, or N/A, based on the above:**

| Section | Status |
|---|---|
| 02 Baseline legal/privacy/consent | REQUIRED |
| 03 Repo/env/secrets/CI-CD | REQUIRED |
| 04 Auth/OAuth/sessions/MFA | REQUIRED (no OAuth providers exist — that sub-scope is N/A within the section) |
| 05 Authorization/RBAC/RLS/tenancy | REQUIRED (RLS itself N/A — architecturally removed; audit is of app-layer authorization instead) |
| 06 DB integrity/lifecycle/backups | REQUIRED |
| 07 App/API perimeter/file upload/bot | REQUIRED |
| 08 AI security governance | REQUIRED — AI is live in the product |
| 09 Payments/Stripe/webhooks/tax | REQUIRED |
| 10 Email/SMS/push/marketing | REQUIRED for email; SMS/push sub-scope N/A (no provider wired) |
| 11 UX/accessibility/onboarding | REQUIRED |
| 12 Profiles/orgs/admin/products/calendar/video/docs | REQUIRED; calendar/video sub-scope likely N/A pending confirmation in that section |
| 13 Analytics/behavior/personalization | REQUIRED to audit (even to confirm the current minimal state), not required to build |
| 14 Observability/incident response/DR | REQUIRED |
| 15 QA end-to-end/load/pentest/regression | REQUIRED |
| 16 Mobile app store | CONDITIONAL-APPLICABLE — audit readiness now, full execution gated on actual submission |
| 17 Conditional regulatory overlays | CONDITIONAL-APPLICABLE — **only** the securities/investment overlay and the multi-state-privacy-threshold overlay carry forward from this register; HIPAA/COPPA/FERPA/FCRA/biometric/GDPR sub-sections are N/A and must be skipped, not built |
| 18 Final certification & signoff | REQUIRED (always last) |

## P0 blockers identified in this section

None that are code-fixable blockers to *starting* later sections. The one
item that is a **launch blocker in spirit** is procedural, not technical:
**do not add a per-close investment success fee or any transaction-based
investor compensation before counsel reviews the securities-law posture** —
the current no-fee-on-close architecture is what keeps that risk low today.
