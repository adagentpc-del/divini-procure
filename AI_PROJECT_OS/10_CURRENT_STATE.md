# 10 Current State

**Last updated:** 2026-06-24
**Live:** No. Never deployed. Target: diviniprocure.com (first deploy pending).

## Build status (green)

- Server typecheck: `npx tsc -p server/tsconfig.json --noEmit` -> **0 errors**.
- SPA typecheck: `npx tsc -p tsconfig.json --noEmit` -> **0 errors**.
- Tests: `npm test` -> **39 tests passing, 0 failing** (node:test runner;
  `tests/feeMath.test.ts`, `tests/bidCredits.test.ts`, `tests/passwordHash.test.ts`).
- CI: `.github/workflows/ci.yml` runs both typechecks + `npm test` on push/PR.

## Recently completed

**Monetization V2 (W1-W5), all behind `PROCURE_MONETIZATION_V2` (flag NOT flipped):**
- Success-fee math: `lib/feeMath.ts` (`successFeeCents`), `lib/fee-rules.ts`
  (`computeSuccessFeeCents`), wired into `routes/award-workflow.ts` (records
  award_cents / success_fee_* on `payment_authorizations` at Award).
- Bid credits: `lib/bidCredits.ts` (5/quarter, no rollover, Pro unlimited);
  enforced in the bid-submit path in `routes.ts`.
- Verification gate: `lib/verificationGate.ts` blocks bid/match/message when a
  vendor is not verified; `routes/verification.ts` does admin credential review,
  recompute, expiry tracking, and auto-revoke.
- Subscriptions / Pro / Verified+ / Featured: `lib/entitlements.ts`,
  `routes/subscriptions.ts`, `routes/featured.ts`, `db/featured.ts`,
  `schema-procure-monetization-v2.sql` (tier seeds).
- Onboarding, pricing page (`src/pages/Pricing.tsx`), vendor/developer/admin
  dashboards, badges (`src/components/VendorBadges.tsx`, `FeeBadge.tsx`).
- Security hardening: fail-closed prod secrets, deny-by-default CORS, auth rate
  limiting, optional encryption-at-rest. See `51_SECURITY.md`.
- Legal: Terms + Payment + Non-Circumvention + Privacy + Messaging policy pages.
- Object storage + encryption (S3-compatible optional; local default).
- Tests + CI; consolidated `db/apply-all.sql` (~110 tables); FIRST-DEPLOY-RUNBOOK.

## Blockers / not done

- **Not deployed.** Needs the first production deploy + production env + an email
  API key (register -> verify -> login cannot complete without email).
- **Vendor credential-upload endpoint is an assumed-but-not-fully-wired
  follow-up.** `routes/verification.ts` has admin review + recompute + auto-revoke,
  but there is **no vendor self-serve `POST /me/verification/documents`** endpoint
  to store `credential_type` + `expires_at` + `doc_status`. Verify in code before
  building onboarding flows that depend on it.
- **A few dashboard summary endpoints are assumed but not present:** no
  `/api/me/success-fees`, `/api/admin/monetization-summary`, or `rfq-preferences`
  endpoint was found under `server/src/routes/`. Treat these as follow-ups.
- **`verify_status` uses `'approved'` as the verified state.** The gate accepts
  both `approved` and literal `verified`. Do not assume a `'verified'` row exists.

## Priorities (now)

1. Wire the vendor credential-upload endpoint (`POST /me/verification/documents`).
2. First production deploy (`FIRST-DEPLOY-RUNBOOK.md`).
3. Set the email key so the account lifecycle works.
4. Light up the dashboard summary endpoints.
5. QA the success-fee money math end to end.

## Recommended next task

**Wire the vendor credential-upload endpoint, then do the first production deploy.**

## Completion estimate

- Web app: **~75-80%** complete.
- iOS: **~30%** (config + privacy manifest + Capacitor deps ready; native build
  Mac-only and pending).
- Monetization V2 is built end to end behind the flag but **the flag has not been
  flipped** and the app has not shipped.

> Keep this file current. Update the date, build status, blockers, and completion
> whenever you make a state-changing change.
