# Divini Procure — backend (Express + Postgres + Authentik OIDC)

This is the API + static-SPA server for Divini Procure. It mirrors the
divinipartner `api-server` patterns (Authentik OIDC verification via `jose`,
`ADMIN_ALLOWED_EMAILS` admin gate, one Node process serving the built SPA + the
`/api` router) but is a lean, self-contained service that talks to a plain
Postgres database with the `pg` driver and stores files on local disk.

## Layout

- `src/config.ts` — env contract (DATABASE_URL, OIDC_*, FILE_STORAGE_DIR, …).
- `src/pool.ts` — `pg` connection pool + `q`/`q1` helpers.
- `src/auth.ts` — Authentik OIDC token verification (`createRemoteJWKSet` +
  `jwtVerify`), `getAuth(req)`, `requireUser`/`requireAdmin` guards.
- `src/db.ts` — data access **and authorization** (reimplements the Supabase RLS
  intent: company-membership scoping + the admin-email gate).
- `src/storage.ts` — local-disk uploads + HMAC short-lived signed download URLs
  (replaces Supabase Storage `upload`/`createSignedUrl`).
- `src/routes.ts` — one endpoint per old `db.ts` call; `/api/healthz`.
- `src/app.ts` / `src/index.ts` — Express app (CORS, auth mw, API, static SPA,
  SPA history fallback) + listen.

## Build & run

From the repo root (`sites/divini-procure`):

```bash
pnpm install                 # SPA deps
pnpm run build               # build the Vite SPA -> dist/
pnpm run build:server        # install + tsc the backend -> server/dist/
rm -rf server/dist/public && cp -r dist server/dist/public
pnpm run start               # node server/dist/index.js  (serves SPA + API)
```

Or use the single `render.yaml` blueprint at the repo root (build + start).

> Note: the backend depends on `express`, `pg`, `jose`, `cors`, `multer`. These
> must be fetched from the npm registry on first install (a networked machine).
