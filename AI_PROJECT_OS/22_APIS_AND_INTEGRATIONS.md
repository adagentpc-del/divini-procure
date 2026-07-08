# 22 APIs and Integrations

## Internal API (`/api`)

Served from the single Node process. ~55 routes across 41 modular routers
(`server/src/routes/*.ts`, mounted by `routes.ts`) plus core endpoints defined
inline in `routes.ts`. All `/api` calls pass through `authMiddleware` (native
session); `/api/auth/*` is additionally rate-limited (20/min per IP).

### Health + auth
- `GET /api/healthz` - liveness; MUST be **200** (not 401) when healthy.
- `POST /api/auth/register|verify|login|forgot|resend|reset` - native auth
  (`routes/auth-native.ts`).

### Bids + credits + gate (in `routes.ts`)
- Bid submission - calls `assertVendorVerified(companyId)` (verification gate)
  then `consumeBidCredit(companyId)` (free-tier 5/quarter), then writes the bid.
- `getBidCredits(companyId)` - reports remaining bids for the current quarter.

### Monetization V2
- `routes/award-workflow.ts` - on Award, `computeSuccessFeeCents` records the
  success fee on `payment_authorizations` (when `PROCURE_MONETIZATION_V2` is on).
- `routes/subscriptions.ts` - tiers + Vendor Pro entitlement / subscribe.
- `routes/featured.ts` - Featured placement upsell (buy/cancel).
- `routes/vendor-pricing.ts` - vendor-facing pricing/options.
- `routes/fee-matrix.ts` - admin fee config.
- `routes/grandfathered-fees.ts` - per-pair existing-relationship attest/confirm.
- `routes/verification.ts` - admin credential review, recompute, expiry, revoke.
- `routes/revenue.ts`, `routes/payouts.ts` - revenue + payout ledgers.

### Known-missing endpoints (follow-ups; see `12_TASK_QUEUE.md`)
- `POST /me/verification/documents` (vendor credential upload) - NOT present.
- `GET /api/me/success-fees` - NOT found.
- `GET /api/admin/monetization-summary` - NOT found.
- RFQ "verified vendors only" preference endpoint - NOT found.

> A full route inventory is not enumerated here; grep `router.(get|post|put|patch|delete)`
> across `server/src/routes/` and `routes.ts` for the authoritative list.

## External integrations

| Service | Purpose | Status |
|---|---|---|
| **Resend** (HTTP API) | Transactional email (verify, reset, notifications). REQUIRED for register -> verify -> login. | Wired (`lib/email.ts`); needs `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` set. `diviniprocure.com` shares the Partners Resend account. |
| **Stripe** | Move real money (success-fee billing, Pro subscriptions, Featured). Plan: Stripe Connect (funds settle to vendor; platform takes the application fee). | NOT live. `lib/stripe-connect.ts` exists; `STRIPE_SECRET_KEY` intentionally unset -> fees accrue/queue, records correct. |
| **PayPal** | Referenced in the broader portfolio for payouts. | NOT live in Procure (no Procure-specific PayPal wiring confirmed). |
| **S3-compatible storage** (S3 / Cloudflare R2 / B2 / MinIO) | Object storage for vendor docs, optional AES-256-GCM encryption at rest. | Optional; default is local disk. Config in `config.ts` (`STORAGE_PROVIDER=s3`, `S3_*`, `STORAGE_ENCRYPTION_KEY`); impl in `lib/objectStorage.ts` + `s3sigv4.ts`. |

## Auth contract

Native session: HS256 JWT signed with `SESSION_SECRET`, delivered as the
`divini_session` httpOnly cookie (30-day TTL) and a Bearer token. Admin status is
determined server-side by `ADMIN_ALLOWED_EMAILS` (the `/me` response carries it;
no admin email is baked into the SPA bundle).

## CORS

Origin allowlist from `ALLOWED_ORIGINS` (+ `PUBLIC_APP_URL`). In production an
empty allowlist DENIES cross-origin (same-origin only). Permissive only in dev.
