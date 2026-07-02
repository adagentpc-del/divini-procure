# 13 Changelog

Append new entries at the top. Each entry: what, why, files, risks, next.
(The repo also has a separate `CHANGES.md`, but it is stale: it still describes
the Authentik/Supabase era and does not reflect Monetization V2.)

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
