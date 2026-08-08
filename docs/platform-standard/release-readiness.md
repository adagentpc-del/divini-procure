# Release Readiness

Cumulative launch status, updated at the end of every section. This is the
single rollup an owner should read to know "are we ready."

## Current state (after Section 02)

**Overall: IN PROGRESS — Sections 01-02 of 18 complete.** Sections past
Baseline Legal/Privacy have not been executed yet, so this is not yet a
launch-readiness verdict.

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
| 08-18 | NOT STARTED | Queued; see task list |

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

## Next section

Section 06 — Database Integrity, Data Lifecycle, Backups & Recovery.
