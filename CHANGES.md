# Divini Procure — migration log (historical)

> This document records the one-time re-platform from Supabase to the current
> self-hosted stack. It is a historical record, not setup instructions.
> See `README.md` for the current architecture.

Procure was a pure client-side Vite SPA talking **directly** to Supabase (auth +
PostgREST + Storage, no backend). It was re-platformed onto a self-hosted Express +
PostgreSQL stack:

| Concern | Before (Supabase) | After (this change) |
|---|---|---|
| Auth | GoTrue (`supabase.auth.*`) | **Native email/password auth** with JWT (httpOnly cookie) — `server/src/routes/auth-native.ts`. (An intermediate Authentik OIDC step was later replaced by native auth.) |
| Data | PostgREST query builder over Postgres + RLS | **Express backend** over **plain Postgres** (`pg`), RLS reimplemented as backend authz |
| Storage | Supabase Storage bucket `project-files` | **Local-disk** uploads + HMAC short-lived signed download URLs |
| Backend | none (SPA → SaaS) | **new `server/` Express app** that also serves the built SPA |

Admin = `adagentpc@gmail.com` (via `ADMIN_ALLOWED_EMAILS`).

---

## 1. Database — `db/schema.sql` (plain Postgres)

> **Super-admin add-on (`db/schema-superadmin.sql`).** The super-admin
> essentials (invite codes, discount codes, referral partners, per-user
> referrals + credits) live in a separate idempotent file
> `db/schema-superadmin.sql` (`create table if not exists ...`). It is applied
> the SAME WAY as `db/schema.sql`, run once AFTER it on the local Postgres:
>
> ```
> psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-superadmin.sql
> ```
>
> `deploy.sh` does NOT apply schema files (it only builds + restarts), so this
> must be psql-applied on the server like the base schema. Re-running is safe.

Ported `supabase/migrations/0001..0003` into one `db/schema.sql`, dropping the
Supabase-specific bits:

- Removed all **RLS** (`enable row level security`) + every `create policy`
  (`auth.uid()` / `auth.jwt()->>'email'`). Authorization now lives in the
  backend (see §3).
- Removed the `storage.buckets` insert + `storage.objects` policies — file
  storage is local disk now.
- Removed the `public.user_company_ids()` `security definer` helper (its logic
  moved into the backend) and the `revoke ... from anon, public` grants.
- Replaced every `references auth.users(id)` (a Supabase-managed table) with a
  plain **`users`** table keyed by the Authentik OIDC `sub` (text). The backend
  upserts the row on first authenticated request. Affected FKs:
  `company_members.user_id`, `bid_revisions.created_by`, `notifications.user_id`,
  `documents.uploaded_by` — all now `text`.

**All other tables/columns/relationships are byte-for-byte the same** as the
migrations, so the data shape is unchanged. Feature-flag seed rows preserved.
Added a few indexes on the common query paths. The DB runs in its OWN database
`divini_procure` on the existing Postgres (`localhost:5433`, user `aibos`).

## 2. Backend — new `server/` (Express + `pg` + `jose`)

Mirrors divinipartner's `api-server` layout (auth mw with `jose`, admin gate,
one process serving SPA + `/api`, `/api/healthz`) but lean and self-contained,
compiled with **`tsc`** (no esbuild bundling). Files:

- `server/src/config.ts` — env contract.
- `server/src/pool.ts` — `pg` Pool + `q`/`q1` helpers.
- `server/src/auth.ts` — **mirror of** `divinipartner .../middlewares/auth.ts`:
  `createRemoteJWKSet` + `jwtVerify` against `OIDC_ISSUER`/`OIDC_JWKS_URL` with
  `OIDC_CLIENT_ID` as audience; `getAuth(req) -> { userId(sub), email, isAdmin }`
  where `isAdmin` = email ∈ `ADMIN_ALLOWED_EMAILS`; `requireUser`/`requireAdmin`.
- `server/src/db.ts` — data access **+ authorization** (the critical work, §3).
- `server/src/storage.ts` — local-disk storage (§4).
- `server/src/routes.ts` — one endpoint per old `db.ts`/`supabase` call (§5).
- `server/src/app.ts` / `index.ts` — CORS + auth mw + `/api` router + static SPA
  + SPA history fallback; listen on `PORT`.

## 3. Authorization model (RLS reimplemented in the backend)

The pivotal RLS primitive was `user_company_ids()` = "the companies the current
user belongs to". `server/src/db.ts` recreates it as `userCompanyIds(userId)`
and gates every operation the same way the policies did. Each db function takes
the **verified** `userId` from the token (never a client-supplied id) and throws
`ForbiddenError` (→ HTTP 403) on violation:

| Resource | Old RLS policy | Backend enforcement |
|---|---|---|
| companies | read any authed; write own (`id ∈ user_company_ids`) | `getMyCompany`; `updateCompany` asserts membership |
| company_members | manage within own companies | created only inside `createCompanyForUser` (owner) |
| vendor_profiles | read any; write own | `getVendorProfile` (read); created on vendor signup |
| buildings | read any; write own-company | `createBuilding` asserts membership; reads scoped to `companyId` |
| packages | read any; write if building owned | `createPackage`/`setPackageStatus` check building ownership via `company_members` join |
| package_line_items | read any; write if package's building owned | `addLineItem`/`deleteLineItem` check ownership |
| bids | read = your bids OR bids on a package you own; vendor write = your company | `getBidsForPackage` returns all to the owner, only-own to a vendor; `submitPricedBid` asserts membership of `vendorCompanyId` |
| bid_items | write only on your own bids | inserted only within `submitPricedBid` (after membership check) |
| rfq_questions | read any; insert as your company; answer = package owner | `askQuestion` asserts membership; `answerQuestion` asserts package ownership |
| documents | read any authed; write own company | `getDocuments` (read); `insertDocument` asserts membership of `company_id` |
| feature_flags | read any authed; **write = admin email** | `GET` open to authed; `PATCH` behind `requireAdmin` |
| account delete | `delete_my_account` RPC | `deleteMyAccount` removes membership(s); deletes orphaned companies; deletes user |

## 4. File storage (local disk; replaces Supabase Storage)

`server/src/storage.ts`:
- Upload endpoint (`POST /api/documents`, multipart via `multer`) writes bytes to
  `FILE_STORAGE_DIR/<companyId>/<packageId|buildingId|misc>/<ts>-<name>` — the
  **same path convention** the old Supabase code used — and inserts the
  `documents` row (after the membership authz check).
- `createSignedUrl(path, 3600)` is replaced by `signDownloadUrl(path)`, which
  returns `/api/documents/download?path=..&exp=..&sig=..` with an **HMAC**
  signature (key `DOWNLOAD_URL_SECRET`) and a 1-hour expiry. `GET
  /api/documents/signed-url?path=` issues it (authed); `GET
  /api/documents/download` verifies the signature/expiry and streams the file —
  the signature is the capability, exactly like a Supabase signed URL. Path
  traversal is rejected.

## 5. Endpoint map (every old `db.ts` / `supabase` call → backend route)

```
GET    /api/healthz                       health
GET    /api/me                            AuthProvider.loadCompany + features isAdmin
POST   /api/companies                     createCompanyForUser (Onboarding)
PATCH  /api/companies/:id                 companies.update (Profile)
POST   /api/account/delete                rpc('delete_my_account')
GET    /api/buildings?companyId=          getBuildings
GET    /api/buildings/:id                 getBuilding
POST   /api/buildings                     buildings.insert (Projects)
GET    /api/buildings/:id/packages        getPackages
POST   /api/buildings/:id/packages        createPackage
GET    /api/packages/open?categories=     getOpenPackages
GET    /api/packages/:id                  getPackage
POST   /api/packages/:id/status           setPackageStatus
GET    /api/packages/:id/line-items       getLineItems
POST   /api/packages/:id/line-items       addLineItem
DELETE /api/line-items/:id                deleteLineItem
GET    /api/bids/mine?companyId=          getMyBids
GET    /api/packages/:id/bids             getBidsForPackage
POST   /api/packages/:id/bids             submitPricedBid
GET    /api/vendor-profiles/:companyId    getVendorProfile
GET    /api/packages/:id/questions        getQuestions
POST   /api/packages/:id/questions        askQuestion
POST   /api/questions/:id/answer          answerQuestion
GET    /api/feature-flags                 feature_flags select
PATCH  /api/feature-flags/:key            feature_flags update (admin only)
GET    /api/documents?packageId|buildingId getDocuments
POST   /api/documents                     storage.upload + documents.insert
GET    /api/documents/signed-url?path=    createSignedUrl
GET    /api/documents/download            signed-URL fetch (streams file)
```

## 6. SPA rewire

- **Deleted** `src/lib/supabase.ts`. **Added** `src/lib/api.ts` (Bearer-token
  fetch wrapper — JSON + multipart helpers) and `src/lib/oidc.ts` (mirror of
  divinipartner's `oidc.ts`: `oidc-client-ts` `UserManager`, PKCE,
  `login/logout/getUser/completeLogin`).
- `src/lib/db.ts` — same function signatures, now calling the backend via
  `src/lib/api.ts` instead of PostgREST/Storage. (`uploadDocument` posts
  multipart; `signedUrl` hits `/documents/signed-url`.) Added `createBuilding`,
  `updateCompany`, `deleteMyAccount`, `getFeatureFlags`, `setFeatureFlag`.
- `src/lib/auth.tsx` — `AuthProvider`/`useAuth` rebuilt on `oidc-client-ts` +
  `GET /api/me`. Exposes a Supabase-`Session`-shaped object (`session.user.id`
  = OIDC sub, `session.user.email`) so page code is unchanged, plus `isAdmin`,
  `signIn`, `signOut`.
- `src/lib/features.tsx` — flags via `getFeatureFlags()`, `isAdmin` from auth
  context (no more email comparison against a client value).
- Pages: `Login.tsx` → "Sign in with Divini SSO" (OIDC redirect, no
  email/password). New `AuthCallback.tsx` (`/auth/callback`) completes PKCE.
  `ResetPassword.tsx` → informational (password reset is Authentik's job).
  `Projects.tsx`/`Profile.tsx`/`AdminFeatures.tsx` switched from direct
  `supabase.*` to `db.ts` helpers. `App.tsx` adds the `/auth/callback` route.
- `package.json` — removed `@supabase/supabase-js`; added `oidc-client-ts`;
  added `build:server` / `build:all` / `start` scripts. `vite.config.ts` honours
  `BASE_PATH`. `src/vite-env.d.ts` types the `VITE_OIDC_*` vars.

## 7. Build / deploy

- `render.yaml` (new, repo root) — single Node web service: `pnpm build` (SPA) +
  `server` build, copy `dist → server/dist/public`, `start` =
  `node server/dist/index.js`; `healthCheckPath: /api/healthz`; persistent disk
  for `/data/procure-files`. Mirrors divinipartner's render.yaml approach.
- `.env.local.example` — rewritten for the unified contract (DATABASE_URL, OIDC
  backend + `VITE_OIDC_*` frontend, ADMIN_ALLOWED_EMAILS, FILE_STORAGE_DIR,
  DOWNLOAD_URL_SECRET, PORT, PUBLIC_APP_URL, BASE_PATH).

---

## Verification done in this sandbox

- **SPA builds clean**: `pnpm install` (oidc-client-ts resolved from cache) +
  `pnpm run build` (`tsc && vite build`) succeeds — 0 type errors, 57 modules,
  `dist/` produced. The SPA → backend rewire type-checks end to end.
- **All `supabase`/`@supabase` imports removed** from `src/` (only a doc comment
  mentions the word).
- **Backend**: every `server/src/*.ts` file **parses clean** (TS parser, 0
  syntax errors) and all relative imports use the required `.js` extensions for
  NodeNext. A full `tsc` type-check of the backend **could NOT be run here**
  because the new deps (`express`, `pg`, `jose`, `cors`, `multer` + their
  `@types`) are **not in the local store and the sandbox has no npm network**.
  `pnpm --dir server install` will fetch them on the networked server, after
  which `pnpm run build:server` (plain `tsc`) compiles it.
- **Build wiring verified**: the `dist → server/dist/public` copy step runs OK.

## Couldn't verify (no live DB / no network here)

- Backend `tsc` compile (needs the npm deps above — install on a networked box).
- Runtime against a real Postgres (no DB reachable from the sandbox) and a real
  Authentik tenant (OIDC login round-trip).

---

## LIVE-SETUP checklist

1. **Database**
   ```bash
   createdb -h localhost -p 5433 -U aibos divini_procure
   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema.sql
   ```
2. **Authentik** — create an OIDC application + provider named **`divini-procure`**:
   - Redirect URI: `https://<app-host>/auth/callback` (and `http://localhost:8080/auth/callback` for local).
   - Note the **client id**, **issuer** (`.../application/o/divini-procure/`) and
     **JWKS** (`.../application/o/divini-procure/jwks/`).
   - Ensure the `email` claim is released (scope `email`).
   - Confirm `adagentpc@gmail.com` is a user that can access the app.
3. **Env** — copy `.env.local.example` → `.env.local`, fill `DATABASE_URL`,
   `OIDC_*`, `VITE_OIDC_*`, `ADMIN_ALLOWED_EMAILS=adagentpc@gmail.com`,
   `FILE_STORAGE_DIR`, `DOWNLOAD_URL_SECRET`, `PUBLIC_APP_URL`, `PORT`.
4. **Build + run**
   ```bash
   pnpm install && pnpm run build
   pnpm run build:server
   rm -rf server/dist/public && cp -r dist server/dist/public
   mkdir -p "$FILE_STORAGE_DIR"
   pnpm run start        # serves SPA + API on :$PORT
   ```
   (Or deploy via `render.yaml`.)
5. **Smoke tests**
   - `curl http://localhost:$PORT/api/healthz` → `{ "ok": true, ... }`.
   - **OIDC login**: open the app → "Sign in with Divini SSO" → Authentik →
     back to `/auth/callback` → `/onboarding` (new user) or `/app`.
   - **Create under the new authz**: as a buyer, create a company (Onboarding),
     a project (Projects), a package (BuildingDetail). As a *different* vendor
     account, submit a bid on that package (PackageDetail) → confirm the buyer
     sees the bid and the vendor sees only their own.
   - **File upload + download**: on a package, upload a document (CAD/PDF) →
     confirm it lands under `FILE_STORAGE_DIR/<companyId>/<packageId>/…`, then
     click it → the signed `/api/documents/download` link streams the file; wait
     >1h (or tamper the `sig`) → 403.
   - **Admin**: sign in as `adagentpc@gmail.com` → `/admin/features` toggles a
     flag (PATCH succeeds); a non-admin gets 403 on the same PATCH.
```
