# 04 System Architecture

## One process, two responsibilities

Divini Procure runs as a **single Node process** that serves both:

1. the **Express `/api` router** (the backend), and
2. the **built Vite SPA** (static files) for every non-API route.

Entry point: `server/src/index.ts` -> `server/src/app.ts`. The app wires
middleware then mounts the router:

```
app.use(cors(...))                 // origin allowlist (deny-by-default in prod)
app.use(express.json({limit:2mb})) // + urlencoded
app.use(authMiddleware())          // verifies the native session cookie / Bearer
app.use("/api/auth", authRateLimit)// per-IP limiter on auth endpoints
app.use("/api", router)            // the API (routes.ts + 41 mounted sub-routers)
app.use("/api", errorHandler)
app.use(express.static(clientDistDir)) // the SPA
app.use(/* SPA fallback to index.html for client routes */)
```

`server/src/routes.ts` imports and mounts the 41 modular routers under
`server/src/routes/*.ts` and also defines core endpoints inline (notably bid
submission, which calls `assertVendorVerified` + `consumeBidCredit`).

## Data layer

- **PostgreSQL** database `divini_procure`. Access is **raw SQL via `pg`** (no
  ORM), through helpers in `server/src/pool.ts` (`q`, `q1`) and `server/src/db.ts`
  (authorization helpers, `ForbiddenError`, etc.).
- Schema is a set of idempotent `.sql` files in `db/`, concatenated parents-first
  into `db/apply-all.sql` (the single source for a first deploy). ~110 tables.
- Authorization is enforced in the Express layer (the Supabase-era RLS was
  removed; `server/src/db.ts` carries the same intent).

## Auth

Native email/password (`server/src/lib/native-auth.ts`,
`server/src/lib/passwordHash.ts` scrypt). Login issues a `jose` HS256 session JWT
(`SESSION_SECRET`) delivered as an httpOnly cookie (`divini_session`, 30-day TTL)
and a Bearer token. Email verification + password reset are token-based with TTLs
in `config.ts`. Email is sent via the Resend HTTP API.

## File storage

Pluggable via `STORAGE_PROVIDER` (`local` default, or `s3`). Default is local
disk under `FILE_STORAGE_DIR`. Optional **AES-256-GCM encryption at rest** when
`STORAGE_ENCRYPTION_KEY` (base64 of 32 bytes) is set
(`server/src/lib/storageCrypto.ts`, `objectStorage.ts`, `s3sigv4.ts`). Downloads
use short-lived HMAC-signed URLs (`DOWNLOAD_URL_SECRET`).

## Hosting topology (production target)

```
Internet
   |
   v
Caddy (TLS, reverse proxy)  diviniprocure.com -> localhost:PORT
   |
   v
pm2-managed Node process "divini-procure"   (Express API + SPA, one process)
   |
   v
Docker Postgres container "divini_procure_db"  (user aibos, db divini_procure)
```

- Hosted on a DigitalOcean droplet (the shared low-stakes box per the user's
  hosting strategy), fronted by Caddy, processes managed by pm2.
- Deploy loop: `rsync` from the Mac, `psql`/`deploy.sh`/`pm2` on the server.
  Never sync `.env.local`. See `23_DEPLOYMENT.md`.

## Mobile

Capacitor managed-webview wrapper (`capacitor.config.ts`, `mobile/`). The native
shell loads the hosted HTTPS site (app.diviniprocure.com flagged as needing
provisioning). Full `@capacitor/*` deps and `cap:*` / `assets:generate` scripts
are in `package.json`. The iOS native build is **Mac-only and pending** (see
`IOS-APP-STORE-RUNBOOK.md`).

## Feature flagging

`PROCURE_MONETIZATION_V2` (`config.ts`) gates the entire V2 money + verification
model server-side; the SPA reads feature flags via `src/lib/features.tsx`. With
the flag off, behavior is identical to the pre-V2 app (no bid limit, gate always
passes). This is the safe rollout pattern.
