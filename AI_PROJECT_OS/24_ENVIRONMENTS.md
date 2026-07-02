# 24 Environments

Two environments matter: **dev/sandbox** (permissive, app boots with fallbacks)
and **production** (`NODE_ENV=production`, fail-closed). Config is read from the
server `.env.local` (never committed, never rsynced). Authority: `server/src/config.ts`.

## Required production env

```
NODE_ENV=production
PORT=XXXX                                   # the port Caddy proxies to (deploy.sh assumes 3020)
DATABASE_URL=postgres://aibos:PASS@127.0.0.1:5432/divini_procure
SESSION_SECRET=<strong unique>              # prod THROWS on startup if unset/empty/dev-default
DOWNLOAD_URL_SECRET=<strong unique>         # prod fail-closed (or inherits SESSION_SECRET)
ADMIN_ALLOWED_EMAILS=adagentpc@gmail.com
PUBLIC_APP_URL=https://diviniprocure.com
ALLOWED_ORIGINS=https://diviniprocure.com   # empty in prod => cross-origin denied
EMAIL_PROVIDER=resend                       # REQUIRED for register -> verify -> login
EMAIL_API_KEY=<resend key>
EMAIL_FROM=Divini Procure <noreply@diviniprocure.com>
```

## Monetization V2 flag + constants (defaults in config.ts)

```
PROCURE_MONETIZATION_V2=false               # set true only after a clean deploy + smoke
PROCURE_SUCCESS_FEE_PCT=2
PROCURE_SUCCESS_FEE_CAP_CENTS=250000        # $2,500
PROCURE_GRANDFATHERED_PCT=1
PROCURE_GRANDFATHERED_CAP_CENTS=100000      # $1,000
PROCURE_FREE_BIDS_PER_QUARTER=5
VENDOR_PRO_PRICE_CENTS=14900                # $149/mo
PROCURE_STANDARD_FEE_PCT=10                 # legacy default platform fee (pre-V2 path)
```

## Optional: object storage + encryption

```
STORAGE_PROVIDER=local                      # or s3
# S3_ENDPOINT=...  S3_REGION=...  S3_BUCKET=...
# S3_ACCESS_KEY_ID=...  S3_SECRET_ACCESS_KEY=...
# STORAGE_ENCRYPTION_KEY=<base64 of 32 bytes>   # openssl rand -base64 32; losing it loses files
FILE_STORAGE_DIR=/data/procure-files        # local-disk root when STORAGE_PROVIDER=local
```

## Optional: payments

```
# STRIPE_SECRET_KEY=...   # leave UNSET until ready to move real money;
                          # until then fees/payouts accrue/queue, records correct
```

## Fail-closed behavior (production only)

- Missing/empty/dev-default `SESSION_SECRET` or `DOWNLOAD_URL_SECRET` -> the
  process **throws on startup** (refuses to run insecure).
- Empty `ALLOWED_ORIGINS` -> CORS **denies** cross-origin (same-origin only) + warns.
- These guards are gated on `NODE_ENV=production`, so dev/sandbox still boots with
  the warned fallbacks and typechecks unchanged.

## Dev/sandbox notes

- The app falls back to dev-only secrets (with a one-time warning) so it boots.
- With `EMAIL_PROVIDER`/`EMAIL_API_KEY` unset, email is disabled (calls log +
  report skipped); registration cannot complete to login. Set the key to test the
  full lifecycle.
- Local Postgres in this portfolio commonly runs on `:5433` (Mac), distinct from
  the prod container's internal `:5432`.

## Stale env references (ignore)

`.env.local.example` and the old README still list Authentik OIDC
(`OIDC_*` / `VITE_OIDC_*`) and Supabase keys. These are **not** used by the current
native-auth, self-hosted app. Use the variables above.

> TODO(owner): record the actual production `PORT`, droplet IP/host, and Caddy
> site block once provisioned (kept out of the repo on purpose).
