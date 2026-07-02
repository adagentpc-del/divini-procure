# 12 Task Queue

Prioritized, actionable backlog. Keep it current: mark done, add follow-ups you
discover. Statuses: `todo` | `in-progress` | `blocked` | `done`.

---

### T1. Wire vendor credential-upload endpoint
- **Priority:** P0
- **Status:** todo
- **Owner:** > TODO(owner)
- **Dependencies:** none (admin review side already exists)
- **Effort:** M
- **Acceptance:** A verified-pending vendor can `POST /me/verification/documents`
  with a credential (file + `credential_type` in
  license|gl_insurance|workers_comp|trade_cert|w9|bond, `expires_at`), creating a
  `vendor_credentials` row with `doc_status='pending'`. The admin review +
  recompute in `routes/verification.ts` then drives the vendor to verified.
- **Related files:** `server/src/routes/verification.ts`,
  `server/src/lib/verificationGate.ts` (REQUIRED_CREDENTIAL_TYPES),
  `db/schema-procure-monetization-v2.sql` (vendor_credentials columns),
  `server/src/storage.ts` / `lib/objectStorage.ts` (file handling).
- **Notes:** Currently no vendor self-serve POST exists; `verification.ts` only
  exposes admin GET review endpoints. The onboarding UX assumes this exists.

### T2. First production deploy
- **Priority:** P0
- **Status:** todo
- **Owner:** > TODO(owner)
- **Dependencies:** prod secrets set, email key set, DNS + Caddy + Docker Postgres ready
- **Effort:** M
- **Acceptance:** diviniprocure.com returns 200; `/api/healthz` is 200 (NOT 401);
  a gated admin route returns 401; register -> verify email -> login works in a
  browser.
- **Related files:** `FIRST-DEPLOY-RUNBOOK.md`, `DEPLOY.md`, `deploy.sh`,
  `db/apply-all.sql`, `.env.local` (server, not committed).
- **Notes:** `rsync` on the Mac; `psql`/`deploy.sh`/`pm2` on the server. Apply
  `apply-all.sql` TWICE on the fresh DB. Never sync `.env.local`.

### T3. Set email key (Resend)
- **Priority:** P0
- **Status:** todo
- **Owner:** > TODO(owner)
- **Dependencies:** Resend account + verified diviniprocure.com domain (SPF/DKIM)
- **Effort:** S
- **Acceptance:** `node server/dist/scripts/send-test-email.js you@example.com`
  reports SENT; a real signup receives its verification email.
- **Related files:** `EMAIL-SETUP.md`, `server/src/lib/email.ts`,
  `server/src/config.ts` (`EMAIL_PROVIDER`/`EMAIL_API_KEY`/`EMAIL_FROM`).
- **Notes:** Without this, register -> verify -> login cannot complete.

### T4. Light up dashboard summary endpoints
- **Priority:** P1
- **Status:** todo
- **Owner:** > TODO(owner)
- **Dependencies:** T1 (success fees recorded), monetization schema applied
- **Effort:** M
- **Acceptance:** `GET /api/me/success-fees` returns the signed-in vendor's accrued
  /billed/paid success fees; `GET /api/admin/monetization-summary` returns MRR +
  success-fee ledger rollups; RFQ "verified vendors only" preference persists.
- **Related files:** `server/src/routes/revenue.ts`,
  `server/src/routes/subscriptions.ts`, `server/src/lib/monetization.ts`,
  `db/schema-procure-monetization-v2.sql` (payment_authorizations success-fee cols),
  the vendor/developer/admin dashboard pages in `src/pages/`.
- **Notes:** These endpoints were not found in `server/src/routes/`; confirm and
  build. Dashboards may currently render placeholders.

### T5. Success-fee money-math QA
- **Priority:** P1
- **Status:** todo
- **Owner:** > TODO(owner)
- **Dependencies:** T1, T2 (a deployed env to award against)
- **Effort:** S
- **Acceptance:** Award on a NEW pair -> 2% of award, capped $2,500, recorded on
  `payment_authorizations` as `accrued`. Award on a grandfathered pair -> 1%
  capped $1,000. Re-award a grandfathered pair stays 1%. A win never consumes a
  bid credit.
- **Related files:** `tests/feeMath.test.ts`, `server/src/routes/award-workflow.ts`,
  `server/src/lib/fee-rules.ts`.
- **Notes:** Unit math is covered by tests; this is the integration/QA pass.

---

> When you finish a task, set its status to `done`, append a line to
> `13_CHANGELOG.md`, and update `10_CURRENT_STATE.md`.
