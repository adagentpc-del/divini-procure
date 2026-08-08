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
| 03 Repo/Env/Secrets/CI-CD/Supply Chain | **READY WITH P1 ITEMS** | Secrets hygiene is genuinely strong (nothing found in git history, `.gitignore` comprehensive, fail-closed prod config). Two real gaps fixed: (1) CI never ran a real build or validated the schema bootstrap - added both as required gates, simulated locally before committing to prove they actually catch the failure class they're meant to; (2) no environment-identity signal at startup - added a safe log line. Governance gaps (branch protection, CODEOWNERS, release tagging) are correctly left open as operator actions, not invented unilaterally. Noted but not fixed: no SAST/SBOM tooling (P2), one dead Supabase CSP code path (P2, cosmetic) |
| 04-18 | NOT STARTED | Queued; see task list |

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
- **R-06** (P1): no DMCA/AUP content — owned by Owner/Counsel, not an engineering task.
- **R-07** (P2): cookie-consent choice captured but unenforced (nothing to enforce today) — re-open to P1 if a tracking SDK is ever added.
- **R-08** (P1): no automated data-retention/purge job — owned by Section 06.
- **R-09** — **CLOSED.** Referral-partner onboarding endpoints were completely broken (unconditional 500); fixed.
- **R-10** — **CLOSED.** CI now has real build + fresh-database schema gates, verified to actually catch the failure class they target.
- **R-11** (P1): no branch protection / CODEOWNERS / release tagging — owned by Owner (process decisions).
- **R-12** (P2): no SAST/license/SBOM tooling — owned by a future maturity pass.
- **R-13** (P2): dead Supabase CSP code — cosmetic, deliberately untouched inside this section.

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

Section 04 — Authentication, OAuth, Sessions, MFA & Account Recovery.
