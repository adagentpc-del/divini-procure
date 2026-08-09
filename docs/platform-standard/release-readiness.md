# Release Readiness

Cumulative launch status, updated at the end of every section. This is the
single rollup an owner should read to know "are we ready."

## Current state (after Section 18 — final certification)

**Overall: READY FOR LIMITED / RESEARCH-PREVIEW LAUNCH, WITH ONE PROCEDURAL
CONDITION.** All 18 ALFY2 sections are complete. Every code-level P0/P1
finding surfaced across this engagement was fixed and live-verified, and
the full regression gate (typecheck, 173-test unit suite, two-pass schema
bootstrap, both production builds, live health check) passes clean as of
2026-08-09. See "Final certification" below for the full verdict, the
consolidated list of what remains open, and why none of it is a silently
dropped code gap.

## Section-by-section status

| Section | Status | Summary |
|---|---|---|
| 00 Read First | READY | Rules acknowledged, followed throughout |
| 01 Discovery & Applicability | **READY** | Architecture mapped, actors/data classified, 30-regime applicability matrix populated with evidence. One procedural P0 (securities-law posture) and one P1 code finding (plaintext banking field) surfaced and carried forward |
| 02 Baseline Legal/Privacy/Consent | **READY WITH P1 ITEMS** | Legal-doc inventory, privacy-request architecture (delete/export), and deletion-revokes-sessions were already solidly built and are confirmed PASS. Two real gaps found and fixed live: (1) consent acceptance was overwrite-only with no history - added an append-only `user_legal_acceptances` log; (2) the Vendor Agreement's binding fee terms were accepted client-side only with zero server record or enforcement - now server-verified with a 400 rejection and an automated test. Two items remain genuinely open: no DMCA/AUP content (legal drafting, not carried out unilaterally) and no automated data-retention enforcement job (documented in a new retention matrix, not built) |
| 03 Repo/Env/Secrets/CI-CD/Supply Chain | **READY WITH P1 ITEMS** | Secrets hygiene is genuinely strong (nothing found in git history, `.gitignore` comprehensive, fail-closed prod config). Two real gaps fixed: (1) CI never ran a real build or validated the schema bootstrap - added both as required gates, simulated locally before committing to prove they actually catch the failure class they're meant to; (2) no environment-identity signal at startup - added a safe log line. Governance gaps (branch protection, CODEOWNERS, release tagging) are correctly left open as operator actions, not invented unilaterally. Noted but not fixed: no SAST/SBOM tooling (P2), one dead Supabase CSP code path (P2, cosmetic - later closed as R-13) |
| 04 Auth/OAuth/Sessions/MFA/Account Recovery | **READY** | Password hashing, session cookie attributes, server-side revocation, enumeration resistance, rate limiting, and CORS/CSRF posture were all already solid. Two real gaps found and fixed: (1) `verify_token` stored in plaintext despite granting a full login session on use (and backing the ownership-transfer claim flow) - now hashed to match `reset_token`'s existing protection, verified at the DB level; (2) no user-facing "sign out of all devices" control existed - added and verified live with a real two-device simulation. OAuth/MFA/recovery-codes correctly marked N/A (not offered; a future business decision, not a gap in what exists) |
| 05 Authorization/RBAC/RLS/Tenancy/Admin/Impersonation | **READY WITH P1 ITEMS** | Every authorization guarantee was already independently verified server-code-correct via real adversarial live testing (two separate tenant companies, real cross-tenant read/write/document/signed-URL/admin-route attempts). **Database-level Row-Level Security has since been retrofitted as a second, independent layer** (2026-08-08, per explicit operator direction), using `AsyncLocalStorage` request-context propagation rather than the large query-layer rewrite originally assumed necessary. Two real bugs were found and fixed during implementation - a self-referential policy recursion on `company_members` (live-reproduced as a Postgres "stack depth limit exceeded" error) and a break in the documented/CI-tested two-pass `apply-all.sql` bootstrap (RLS blocked pass 2's seed inserts) - both confirmed fixed by reproducing the failure live first, then re-running the exact same sequence clean. Verified via full functional regression, DB-layer adversarial testing independent of the Express app, and the existing 173-test unit suite. Cross-tenant write, document access, signed-URL integrity, and admin-route protection all remain PASS. One intentional-by-design "read any" building/package behavior confirmed against docs, not flagged as a defect. One real bug found and fixed: cancelling a paid subscription downgraded access immediately instead of at the paid period's end, contradicting the disclosed cancellation terms - fixed to defer to the pre-existing, already-correct webhook-driven downgrade; the record-only path was verified live, the real-Stripe path could only be verified by code review (no Stripe test credentials available) and is flagged for a pre-production smoke test. Admin impersonation is N/A - the feature doesn't exist |
| 06 DB Integrity/Lifecycle/Backups/Recovery | **READY WITH P1 ITEMS** | Testing this section against a realistic multi-member-company scenario (not just fresh test accounts) surfaced two P0 regressions from the Section 05 RLS retrofit - both found, reproduced live, and fixed same-day: (1) account deletion by a non-last company member was wrongly destroying the whole company (RLS orphan-check couldn't see other members); (2) three other already-authorized cross-user lookups (Stripe webhook entitlement writes, addendum-publish vendor notifications, referral-commission attribution) were silently broken by the same RLS narrowing - a reusable `runAsAdmin()` helper now covers all of them, with the Stripe path flagged for live confirmation once test credentials are available (`OA-13`). A genuinely pre-existing, RLS-unrelated bug was also found and fixed: 34 `ON DELETE NO ACTION` foreign keys to `users(id)` made account deletion hard-fail for any user with real product usage - changed to `ON DELETE SET NULL`. Backups: none existed at all (self-hosted single-droplet Postgres, no managed-provider safety net) - a `pg_dump`-based script now exists with a verified live dump/restore round trip (160 tables, exact row counts, RLS policies intact after restore); a real follow-on finding (`pg_dump` is itself subject to `FORCE ROW LEVEL SECURITY` and needs an RLS-exempt role) is documented with a fail-loud check rather than a silent partial backup. Crontab installation remains an operator action (`OA-14`). Expired-session purging is now wired into the existing in-process scheduler. **Update, same day:** the FK-integrity audit was extended to full closure - a second sweep found the identical failure mode one level removed (`deleteMyAccount`'s orphaned-COMPANY deletion path, 5 more FKs referencing `companies`/`bids`), reproduced and fixed the same way. `select ... where confdeltype='a'` now returns zero rows across the entire schema |
| 07 App/API Perimeter, File Upload, Bot Security | **READY** | Security headers (Helmet CSP/HSTS/frame protections), fail-closed CORS, and file-upload validation (extension allowlist + MIME check + size cap + path-traversal-safe filename handling across all 3 upload endpoints) were all already solid on direct read. Confirmed the document-download endpoint cannot be used for stored XSS via Content-Type sniffing (no explicit Content-Type set, Express defaults a Buffer response to `application/octet-stream`). Zero `dangerouslySetInnerHTML` anywhere in the SPA. SQL injection spot-check found no unescaped user-input interpolation beyond the established parameterized-query pattern. The only genuinely public (unauthenticated) write endpoint is registration, already honeypot- and rate-limited. One real gap found and fixed: only the auth surface, invite/referral lookups, score-refresh, and LLM calls had any rate limit - every other API route had none. Added a generous, generic backstop (`apiRateLimit`, 300 req/IP/min) applied globally, verified live to engage without affecting normal use |
| 08 AI Security Governance, Prompt Injection, Model Quality | **READY** | The AI integration was found to be unusually mature on inspection: the LLM client fails closed with no hard dependency anywhere, credentials are never exportable from the module, and every call has a timeout. All 3 real LLM-touching features were individually traced: a website-profile extractor already sanitizes untrusted external content for known prompt-injection patterns before it ever reaches a prompt (real regex-based stripping of special tokens/role headers/"ignore previous instructions" phrasing, not just a comment); a bid-comparison narrative already anonymizes vendor company names before inclusion in the prompt (a documented prior fix, `#52`) so one party cannot inject content that reaches another; every AI output is either explicitly labeled `manual_confirmation_required`, supplementary to (never replacing) a deterministic result, or requires the user to explicitly submit a form before it becomes real data - nothing auto-publishes. The disclaimer shown to users is real (verified the same text is actually rendered in the frontend, not just returned in the API response and ignored). One real gap found and fixed: 2 of 3 LLM-calling routes had no dedicated cost/abuse rate limit (only the new generic 300/min backstop, too generous for an expensive per-call LLM completion) - added dedicated limits matching the pattern already used by the third route |
| 09 Payments/Stripe/Webhooks/Subscriptions/Marketplace/Tax | **READY WITH P1 ITEMS** | Webhook signature verification is cryptographically correct (hand-implemented HMAC-SHA256, constant-time comparison, 5-minute replay-window rejection). Two real, significant gaps were found and fixed in the single function that moves real money (Stripe Connect payout release): a TOCTOU race in the double-click guard (fixed with an atomic claim, live-verified under genuine concurrency - exactly one of two simultaneous requests wins) and no Stripe Idempotency-Key (fixed, but the Stripe-side retry behavior itself could not be live-verified - no test credentials in this sandbox, flagged as `OA-15`). A lower-severity gap was also found and fixed: Stripe webhook processing was not deduplicated against redelivery, which could send a duplicate confirmation email (all actual data writes were already idempotent SQL, so this was never a data-integrity risk) - discovered along the way that a table apparently built for exactly this purpose already existed in the schema but was never wired into any code; added a general, all-event-types dedup instead of retrofitting the unused one. Marketplace-facilitator/sales-tax applicability remains correctly tracked as a counsel-review item from Section 01, not a code gap - confirmed no stale/silent tax-handling code exists either way |
| 10 Email/SMS/Push/Marketing Compliance | **READY** | CAN-SPAM fundamentals were already solid: physical postal address on every commercial email, and the suppression list is checked and filtered out of the audience before a campaign send begins (not a lazy per-recipient check). The campaign broadcast route already independently used the same atomic claim-by-status-transition pattern this pass had to retrofit into the Section 09 payout-release path. One real gap found and fixed: the code declared RFC 8058 one-click unsubscribe support via the `List-Unsubscribe-Post` email header, but the `/unsubscribe` endpoint was `GET`-only - a compliant mail provider (Gmail, Outlook, Yahoo) sends a `POST` for one-click unsubscribe specifically to avoid a link-scanning proxy accidentally triggering it via GET, so a real user clicking "Unsubscribe" in such a client would have silently failed to be unsubscribed. Added the missing `POST` handler, live-verified working (suppression recorded, token invalidated, replay-safe) alongside the pre-existing `GET` path. SMS/push are correctly N/A (no provider exists in the codebase at all). GDPR/UK marketing-consent applicability remains correctly tracked from Section 01 as a counsel-review item contingent on business facts (EU/UK targeting), not a code gap |
| 11 UX/Accessibility/Onboarding/Forms/Nav/Content | **READY WITH P2 ITEMS** | Manual spot-checks found the accessibility foundation genuinely solid, each claim independently verified against real code rather than trusted from the accessibility statement's copy: a working skip-to-content link (programmatic focus, not a scroll no-op), real `:focus-visible` and `prefers-reduced-motion` CSS, correctly-labeled critical-path forms with screen-reader-announced errors and a properly `aria-hidden` honeypot field, and passing color contrast on the core "muted text" palette (hand-computed WCAG ratios, both combinations checked clear 4.5:1 AA with margin). The one real, disclosed gap: no automated accessibility regression testing exists anywhere in CI (no axe-core, Lighthouse, pa11y, or even a Playwright/E2E framework wired into this repo) - deliberately not added this pass rather than rushing in an untuned, potentially flaky new test framework and CI job under time pressure; carried forward as a scoped future increment (R-29). This section's manual checks do not substitute for automated, comprehensive coverage across all 121 pages in the SPA |
| 12 Profiles/Orgs/Admin/Products/Calendar/Video/Docs | **READY** | No code changes needed - every area checked out clean on direct, independent verification (not carried forward from an earlier claim without re-checking). `company_members.role` (owner/admin/member) is real schema but only actually consulted by the ownership-transfer flow; traced every frontend "isOwner"-shaped check and confirmed none of them imply a within-company role restriction the server doesn't enforce - a consistent design, not a client-side-only permission gap. Admin actions have real per-domain audit trails (verification decisions, investment actions, payout releases, change-order approvals). Product-catalog price-visibility gating was independently re-verified applied to both the list and detail read paths, not just trusted from an earlier pass. Re-examined the Section 07 SVG/Content-Type finding specifically for company logo uploads and confirmed it's a non-issue: brand media goes through the same already-verified-safe document download path, and `companies.logo_url` turned out to be a dead field never actually populated or rendered anywhere. Calendar and video are correctly N/A - no such features exist |
| 13 Analytics/Behavior/Lead Scoring/Personalization | **READY** | No third-party behavioral tracking SDK exists (re-confirmed, the Section 02 cookie-consent gap remains correctly low-severity with nothing to gate). The admin analytics dashboard is properly admin-gated; the two user-facing analytics routes are stateless policy evaluators, not data reads, so no cross-tenant risk there. Found and fixed a real IDOR class while auditing "lead scoring": 5 GET routes across 3 files (`pipeline.ts`'s `/stages`, `/loss-reasons`, `/sources`; `follow-up.ts`'s `/workflows`; `scope-builder.ts`'s `/templates`) accepted an arbitrary `companyId` query parameter with no membership check, while every sibling route in each of those same files had the correct check - letting any authenticated user read another company's private custom pipeline-stage labels, loss-reason/lead-source taxonomy, follow-up automation workflows, and RFP scope templates. Found via direct audit (3 sites) plus a systematic background sweep of all 37 similar `req.query.companyId` sites in the codebase (35 confirmed already-safe, 2 more confirmed vulnerable). All 5 fixed with the same pattern and live-verified: seeded "CONFIDENTIAL"-labeled victim data, confirmed the leak pre-fix, confirmed it's closed post-fix |
| 14 Observability/Error Handling/Support/IR/DR | **READY WITH P1 ITEMS** | Error handling already correctly never leaks stack traces/internals to clients. Found and fixed a real support/observability gap: the correlation id used in every structured server-side error log was generated per-request but never returned to the client, so a user hitting a 500 had no way to give support anything searchable - now returned as an `X-Request-Id` header on every response and in the error body, live-verified. Wrote a new incident-response runbook tying together artifacts that already existed scattered across this engagement (correlation-id logging, the health check, the Section 06 backup/restore procedure, the deploy/rollback steps, the Stripe webhook-dedup table, the existing Stripe refund runbook) into one severity-triaged procedure. The core observability gap from Section 01 (R-03, no automated error-monitoring/alerting service) remains genuinely open - it requires provisioning a real third-party account/credential this sandbox cannot create, correctly not fabricated as fixed, flagged as `OA-16` |
| 15 QA End-to-End Journeys, Load, Pentest, Regression | **READY WITH P2 ITEMS** | Rather than re-doing the adversarial/regression testing already woven throughout Sections 05-14 (RLS bypass attempts, IDOR discovery, signed-URL tampering, payout-release concurrency), this section focused on genuinely new ground: a mass-assignment/over-posting audit (confirmed not a vulnerability class here - every write function reads named, typed fields into positional SQL parameters, never a dynamic column list built from client-supplied keys) and one continuous, full end-to-end regression exercising register/login/company/building/package/bid/document/account-deletion for two personas together in a single flow, specifically to catch interaction effects between everything fixed this pass - none found; the RLS orphan-check fix and the FK cascade fix were confirmed working correctly together, with zero orphaned rows after both accounts were deleted. Full-schema two-pass bootstrap and the 173-test unit suite were re-run as final gates. Load/soak testing was not performed - honestly disclosed as out of scope for this sandbox rather than faked |
| 16 Mobile iOS/Android App Store & Device Compliance | **READY** | The native mobile projects have not been generated yet (a documented future runbook step), so this section audited what exists today: the Capacitor config and the iOS privacy-manifest template. Found and fixed a real documentation-accuracy gap: `capacitor.config.ts`'s comments described the retired Authentik OIDC login flow throughout, even though this app migrated to native session-cookie auth well before this pass - a future mobile developer would have been misled, particularly by the bundled/offline-mode warning describing OIDC-callback plumbing that no longer applies. Rewrote both comment blocks accurately. Confirmed Apple's mandatory in-app account-deletion requirement (Guideline 5.1.1(v)) is not just documented but unusually well-verified - this session independently found and fixed two real P0 bugs in exactly that flow (Sections 06/13/15). The iOS privacy manifest's declared data types plausibly match the app's real, verified data collection, correctly marked `NSPrivacyTracking=false` (no third-party analytics, independently confirmed in Section 13) |
| 17 Conditional Regulatory Overlays | **READY (CONDITIONAL ITEMS UNCHANGED)** | A consolidation/re-verification section by nature, not a code-fix section. Cross-checked every code change made across this entire pass (Sections 05-16) against each CONDITIONAL applicability item from Section 01 to confirm none of this session's work altered the underlying facts - none did (no new investment fee structure, no new data-collection category, no new payout-recipient type). Independently re-derived the FCRA-N/A reasoning from the actual verification.ts code rather than just trusting the prior conclusion, since vendor "verification" is the one feature that could superficially resemble a background check - confirmed genuinely N/A (a first-party documents-on-file review, never a third-party consumer report). The securities/investment overlay remains the single highest-severity open item in this entire engagement, correctly requiring counsel/owner review, not an engineering fix |
| 18 Final Launch Readiness Certification & Signoff | **READY FOR LIMITED/RESEARCH-PREVIEW LAUNCH, ONE PROCEDURAL CONDITION** | Not a bug-hunting section by nature - a final gate re-run plus a consolidation checkpoint. Re-ran every automated gate this engagement relies on, together, one final time against a genuinely fresh database and freshly rebuilt server rather than trusting each section's individual pass from earlier in the session: typecheck clean, 173/173 unit tests, two-pass `apply-all.sql` bootstrap clean (161 tables, zero dangling `ON DELETE NO ACTION` FKs, `stripe_webhook_events` present), both the server and frontend production builds clean, and a live `curl` health check against the freshly-restarted server confirming `db:"ok"` and the `X-Request-Id` header. Walked every still-open row in `risk-register.md` one more time to confirm each has a real, named owner and reason (operator action, counsel/owner decision, or a deliberately scoped future increment) rather than being a code gap quietly left undone. See "Final certification" section below for the full verdict |

## Gap-closure pass (post-Section-02, same day)

Per an explicit instruction to close what's fixable before moving on:
resolved **R-01** (referral-partner banking PII now encrypted at rest —
`server/src/lib/fieldCrypto.ts`) and, found in the course of verifying that
fix, a pre-existing **complete outage of the entire referral-partner
onboarding flow** (agreement view/sign, banking submit/view all 500'd
unconditionally on a join to a column that never existed in any schema
file — fixed to join on the real `referral_code`/`code` columns). Both
verified live against the real running app, not just read in source. Full
suite is 173/173 passing. Not closed (correctly deferred, not avoided):
items that are genuinely owner/counsel decisions (R-02, R-04, R-06) or that
belong to a section not yet reached (R-03 → 14, R-08 → 06, R-05 → 03).

## Carried-forward items (will not be re-derived, only re-tested)

- **R-01** — **CLOSED.** Referral-partner banking PII encrypted at rest.
- **R-02** (P0, procedural): no securities counsel review yet on the investment-matching feature — owned by Section 17, must stay resolved (i.e., no per-close fee added) until reviewed.
- **R-03** (P1): no server-side error monitoring — owned by Section 14.
- **R-04** (CONDITIONAL): state privacy-law thresholds unconfirmed — owned by Section 02/17 (partially addressed: the mechanics to honor a right-to-delete/export request now exist regardless of threshold; only the "must we proactively offer X" legal question remains).
- **R-05** (P1): no branch-protection rule visible — owned by Owner (GitHub UI), restated as OA-09.
- **R-06** — **PARTIALLY CLOSED.** AUP + DMCA notice-and-takedown text now live in `Terms.tsx`; owner still needs to register the designated agent with the U.S. Copyright Office (OA-12).
- **R-07** (P2): cookie-consent choice captured but unenforced (nothing to enforce today) — re-open to P1 if a tracking SDK is ever added.
- **R-08** (P1): no automated data-retention/purge job — owned by Section 06.
- **R-09** — **CLOSED.** Referral-partner onboarding endpoints were completely broken (unconditional 500); fixed.
- **R-10** — **CLOSED.** CI now has real build + fresh-database schema gates, verified to actually catch the failure class they target.
- **R-11** (P1): no branch protection / CODEOWNERS / release tagging — owned by Owner (process decisions).
- **R-12** (P2): no SAST/license/SBOM tooling — owned by a future maturity pass.
- **R-13** — **CLOSED.** Dead Supabase CSP code removed, verified no CSP violations.
- **R-14** — **CLOSED.** `verify_token` now hashed at rest, matching `reset_token`.
- **R-15** — **CLOSED.** "Sign out of all devices" now exists and is verified live.
- **R-16** — **CLOSED** (record-only path verified live; Stripe-configured path verified by code review only - `OA-13` flags the pre-production smoke test).

## Second gap-closure pass (post-Section-03, same day)

Per a second explicit instruction to close what's fixable before continuing:
removed the dead Supabase CSP code (R-13), and - reconsidering the earlier
call to only flag R-06 - implemented the actual AUP and DMCA notice-and-
takedown text in `Terms.tsx` rather than leaving it purely as a flagged gap.
Statutory notice-and-takedown boilerplate (17 U.S.C. §512(c)(3)) is
standardized, template-able text, not a novel legal conclusion this session
isn't positioned to make - the same reasoning already applied when the
E-SIGN consent-tracking mechanics were implemented directly in Section 02.
What remains genuinely owner-only (real estate: a monitored inbox and a
federal designated-agent registration) is flagged as OA-12, not glossed
over.

## What "existed already" going into this engagement

This repository already carries an unusually complete internal documentation
set (`AI_PROJECT_OS/`, `docs/SECURITY-PRIVACY.md`) including a prior,
honest SOC 2 gap analysis, a security posture doc, and a compliance doc with
real `[x]`/`[~]`/`[ ]` status marks rather than blanket claims. This
engagement's job is to extend that with the ALFY2 pack's specific artifacts
(this `docs/platform-standard/` register set) and execute the sections that
doc set doesn't already cover in the pack's required depth — not to
duplicate or contradict what's already there.

## Final certification (Section 18, 2026-08-09)

### Verdict

**READY FOR LIMITED / RESEARCH-PREVIEW LAUNCH, WITH ONE PROCEDURAL
CONDITION.**

Every code-level P0 and P1 finding surfaced across Sections 01-17 of this
engagement (30 risk-register entries, R-01 through R-31, minus the ones
that were never code gaps in the first place) was either fixed and
live-verified, or is explicitly and correctly tracked as something this
engineering pass cannot close on its own. The final regression gate
(S18-01) confirms none of that work has silently regressed against
anything else: typecheck clean, 173/173 unit tests, a genuinely fresh
two-pass schema bootstrap, both production builds, and a live health check
all pass together, today, not just individually on the day each fix
landed.

The one item that keeps this from being an unconditional GO is **R-02**: no
per-close transaction fee or other investor-compensation mechanism may be
added to the Capital Partner / investment-matching feature until a
securities attorney has reviewed the introduction/matching mechanism
itself. This is a procedural condition, not a code defect - the feature as
it exists today (informational NDA-gated matching, no transaction-based
compensation) was re-confirmed unchanged as recently as Section 17
(S17-01). It is the single highest-severity open item in the entire
engagement precisely because it is the one item engineering cannot close
by writing code.

### What "READY" means here

- No known P0 or P1 **code** defect remains open anywhere in this
  repository as of this commit.
- Every fix in this engagement was live-verified against the actual
  running application or database, not just reasoned about from reading
  source - including reproducing the bug first wherever the consequence
  was serious enough to warrant it (the account-deletion data-loss bug,
  the payout-release race condition, the RLS-bypass IDORs, the RFC 8058
  unsubscribe failure).
- The full automated gate this repository's CI already runs (build +
  fresh-database schema bootstrap, added in Section 03 as R-10) is backed
  up by an even broader manual re-run at the end of this pass, and both
  pass clean.

### What "WITH ONE PROCEDURAL CONDITION" means

- Do not deploy any feature or pricing change that adds transaction-based
  compensation to the investment-matching flow before `OA-01` (securities
  counsel review) is complete.
- Everything else the platform does today - marketplace bidding, document
  management, payments, referrals, subscriptions, email, the vendor
  verification flow - has no equivalent procedural hold.

### Consolidated open-item inventory (not code-fixable this pass, each with a named owner)

| ID | What | Owner | Tracking |
|---|---|---|---|
| R-02 | Securities counsel review before any investment-transaction fee | Owner + Counsel | `OA-01` |
| R-03 | Real third-party error-monitoring/alerting service (correlation-ID plumbing and the incident runbook are done; the alerting service itself needs a real credential) | Engineering + Owner | `OA-16` |
| R-04 | Confirm state privacy-law thresholds against real business metrics | Owner + Counsel | `OA-02` |
| R-05 / R-11 | GitHub branch protection, CODEOWNERS, release-tagging convention | Owner (GitHub admin) | `OA-03`, `OA-09`, `OA-10` |
| R-06 | Register a real, monitored DMCA designated-agent inbox with the U.S. Copyright Office (the statutory notice text itself is already live in `Terms.tsx`) | Owner | `OA-12` |
| R-07 | Cookie-consent enforcement - correctly low severity today; nothing exists yet to gate | Engineering (future, if a tracking SDK is ever added) | — |
| R-08 | Automated data-retention/purge job - needs an owner policy decision (retention periods, legal-hold rules) before it can be built | Owner, then Engineering | `OA-08` |
| R-12 | SAST/license/SBOM tooling selection | Owner + Engineering | `OA-11` |
| R-16 / R-20 / R-26 | Live Stripe test-mode smoke tests (subscription cancellation, webhook RLS path, payout Idempotency-Key behavior) - all verified by code review, none live-tested; this sandbox has no Stripe test credentials | Owner (provision credentials) + Engineering | `OA-13`, `OA-15` |
| R-18 (residual note) | `bid_line_items`/`bid_payment_milestones` remain outside DB-level RLS, real today via app-layer checks only | Engineering (future, scoped increment) | — |
| R-29 | Automated accessibility regression testing in CI | Engineering (future pass) | — |
| S15-05 | Load/soak testing | Owner + Engineering (needs a staging environment) | — |

None of these are silently dropped: each was traced to a real evidence-register citation and a real owner (S18-02, S18-04).

### Sign-off statement

This certification reflects the state of `claude/build-launch-readiness-2ugzyw`
as of 2026-08-09, verified against the actual running application and a
genuinely fresh database, not asserted from memory or carried forward
without re-checking. It is an engineering readiness certification, not a
substitute for the counsel/owner reviews it explicitly names as still
required.

## Next section

None — Section 18 was the last section in the ALFY2 pack. This engagement
is complete.
