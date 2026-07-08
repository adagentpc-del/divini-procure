# 16 Tech Debt

Debt and cleanup owed. None of this blocks shipping, but it raises maintenance
cost over time.

## Documentation drift
- `README.md`, `CHANGES.md`, and `.env.local.example` still describe the
  **Supabase + Authentik OIDC** era. The real stack is native email/password auth
  + raw-SQL Postgres + self-hosted. Rewrite or delete the stale parts.
- `src/lib/oidc.ts` exists alongside native auth (`src/lib/auth.tsx`). Confirm
  whether the OIDC client is still referenced; if dead, remove it.

## Repo hygiene
- ~30+ stale `vite.config.ts.timestamp-*.mjs` files and several `dist*` /
  `dist_*` build-output folders are checked into the repo root. Add to
  `.gitignore` and delete; they bloat rsync and reviews.
- `render.yaml`, `vercel.json`, and `supabase/` migrations reflect abandoned
  deploy targets (the app is self-hosted). Keep only if intentionally retained.

## Backend structure
- `server/src/routes.ts` is a large file that both mounts the 41 sub-routers AND
  defines core endpoints inline (including bid submission). New monetization
  endpoints (credential upload, success-fee summaries) should be added as their
  own modular routers rather than growing `routes.ts`. (Mirrors the Partners
  modular pattern; see `Divini-Procure-Upgrade-Plan.md`.)
- Two related fee modules exist: `lib/fee-rules.ts` + `lib/fee-matrix.ts` and
  routes `fee-matrix.ts` / `grandfathered-fees.ts`. The revenue-rebuild doc plans
  to consolidate these. Confirm which is authoritative before editing fee logic.

## Tests
- Tests cover pure functions only (feeMath, bidCredits math, password hashing).
  There is **no integration test** of the bid-submit gate, the award success-fee
  recording, or the verification recompute. Adding even a thin DB-backed
  integration pass would de-risk the flag flip.

## Storage / payments
- Default storage is local disk, plaintext. For the sensitive vendor docs
  (licenses, COIs, W-9s), move to S3/R2 + encryption-at-rest + versioned backups
  before real volume. The plumbing exists (`STORAGE_PROVIDER=s3`,
  `STORAGE_ENCRYPTION_KEY`); it is an ops/config step.
- Stripe is unset by design; success fees and payouts are accrue/queue-only until
  `STRIPE_SECRET_KEY` is set. The billing path is built but unexercised against a
  live processor.

> Pay debt down opportunistically when you are already in the relevant file.
