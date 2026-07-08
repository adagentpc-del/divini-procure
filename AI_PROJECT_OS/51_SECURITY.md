# 51 Security

Source: `Divini-Security-and-iOS-Hardening-Summary.md`, `server/src/config.ts`,
`server/src/app.ts`, `server/src/lib/rateLimit.ts`.

## Posture: fail closed in production

In `NODE_ENV=production` the app refuses to run insecure:

- **`SESSION_SECRET`** - the session JWT signing key. In production the process
  **THROWS on startup** if it is unset, empty, or still the dev fallback. (Dev
  keeps the fallback + a one-time warning.)
- **`DOWNLOAD_URL_SECRET`** - signs short-lived download URLs. Same prod
  fail-closed guard (inherits `SESSION_SECRET` if not set explicitly, but never
  the dev fallback in prod).
- **CORS** - the origin allowlist comes from `ALLOWED_ORIGINS` (+ `PUBLIC_APP_URL`).
  An **empty allowlist in production DENIES cross-origin** (same-origin only) and
  logs a warning. Permissive only in dev.

## Authentication

- Native email/password: register -> verify email -> login. Passwords hashed with
  **scrypt** (`lib/passwordHash.ts`).
- Session = `jose` **HS256 JWT** signed with `SESSION_SECRET`, delivered as the
  `divini_session` httpOnly cookie (30-day TTL) and a Bearer token.
- Email-verification and password-reset tokens are time-limited (24h verify, 1h
  reset).
- **Admin authority is server-side only:** admin status derives from
  `ADMIN_ALLOWED_EMAILS` via the `/me` response. No admin email is baked into the
  shipped SPA bundle.

## Rate limiting

A per-IP limiter (**20 req/min**) is applied to `/api/auth/*` (login, register,
forgot, resend, verify) -> 429 + Retry-After (`lib/rateLimit.ts`, mounted in
`app.ts`). Single-process; front with an edge/WAF for multi-replica.

## File storage + encryption at rest

- Default: local disk under `FILE_STORAGE_DIR`, plaintext.
- Optional: S3-compatible storage (`STORAGE_PROVIDER=s3`) and **AES-256-GCM
  encryption at rest** when `STORAGE_ENCRYPTION_KEY` (base64 of exactly 32 bytes)
  is set (`lib/storageCrypto.ts`). Losing the key loses the files.
- Downloads use HMAC-signed, short-lived URLs (forge-proof via
  `DOWNLOAD_URL_SECRET`); tampering or expiry -> 403.

## Sensitive data

Vendor credential documents (licenses, COIs, W-9s, bonding) are sensitive. For
real volume, move to S3/R2 + encryption + versioned backups (the plumbing exists;
it is a config/ops step). See `16_TECH_DEBT.md`.

## Outbound fetch safety

Server-side fetches (e.g. website extraction for onboarding) go through
`lib/safe-fetch.ts` to constrain what the server will retrieve.

## Pre-deploy security checklist

- [ ] Set strong unique `SESSION_SECRET` and `DOWNLOAD_URL_SECRET`.
- [ ] Set `ALLOWED_ORIGINS`/`PUBLIC_APP_URL` (else cross-origin is denied in prod).
- [ ] Set `ADMIN_ALLOWED_EMAILS` (adagentpc@gmail.com).
- [ ] Leave `STRIPE_SECRET_KEY` unset until ready to move money.
- [ ] Consider `STORAGE_PROVIDER=s3` + `STORAGE_ENCRYPTION_KEY` for vendor docs.
- [ ] Confirm `/api/healthz` is 200 and a gated admin route is 401 post-deploy.

> TODO(owner): no structured error monitoring (Sentry-style) or centralized
> audit log review is wired yet; add when ready (noted in the go-live runbook).
