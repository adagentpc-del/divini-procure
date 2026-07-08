# 15 Known Issues

Bugs, gaps, and sharp edges. Confirm against the code before acting; this list is
a pointer, not a guarantee.

## Gaps (functional)

- **No vendor credential-upload endpoint.** `routes/verification.ts` exposes admin
  review + recompute + auto-revoke, but there is no vendor self-serve
  `POST /me/verification/documents` to store `credential_type` + `expires_at` +
  `doc_status`. The verify-first onboarding UX assumes it. (T1 in `12_TASK_QUEUE.md`.)
- **Missing dashboard summary endpoints.** `/api/me/success-fees`,
  `/api/admin/monetization-summary`, and an RFQ "verified vendors only" preference
  endpoint were not found under `server/src/routes/`. Dashboards may render
  placeholders. (T4 in `12_TASK_QUEUE.md`.)

## Sharp edges (will bite if assumed wrong)

- **Verified state is `'approved'`, not `'verified'`.** Querying for a literal
  `verify_status='verified'` row will return nothing. Use the gate helpers in
  `lib/verificationGate.ts` (which accept both).
- **The flag is off by default.** With `PROCURE_MONETIZATION_V2` unset/false, the
  bid limit and verification gate do nothing and all the V2 UI/copy may look
  inert. Set the flag in a test env to exercise V2 behavior.
- **Email is required for the account lifecycle.** With no `EMAIL_PROVIDER=resend`
  + `EMAIL_API_KEY`, registration "succeeds" but no verification email is sent, so
  users can never log in. Easy to misread as a broken auth flow.
- **`/api/healthz` must be 200, not 401.** If a self-pathed router gates
  everything, healthz returns 401 and the deploy looks healthy when it is not.
  The runbooks call this out explicitly.
- **Prod fail-closed secrets.** In `NODE_ENV=production` the process THROWS on
  startup if `SESSION_SECRET` or `DOWNLOAD_URL_SECRET` is unset/empty/dev-default.
  This is intended, but a missing secret looks like a crash, not a config error.
- **Stale docs.** The repo `README.md` and `CHANGES.md` and `.env.local.example`
  still reference Supabase / Authentik OIDC. The real stack is native auth +
  raw-SQL Postgres. Trust `config.ts`, `FIRST-DEPLOY-RUNBOOK.md`, and this OS.

## Housekeeping

- Dozens of stale `dist_*` folders and `vite.config.ts.timestamp-*.mjs` files
  clutter the repo root (cosmetic; slows rsync). Safe to ignore/clean.

> When you fix one of these, remove it here and note it in `13_CHANGELOG.md`.
