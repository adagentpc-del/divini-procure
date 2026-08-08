# Architecture Map

Source of truth for this file is `AI_PROJECT_OS/04_SYSTEM_ARCHITECTURE.md`,
`20_CODEBASE_MAP.md`, `21_DATABASE.md`, `22_APIS_AND_INTEGRATIONS.md`,
`23_DEPLOYMENT.md`, `24_ENVIRONMENTS.md` — that doc set is current, accurate,
and maintained; this file restates it in the ALFY2 pack's required shape and
adds a few facts verified directly against the code during this pass
(marked **[verified 2026-08-08]**). Do not let this file drift from those
source docs — update both together.

## What the platform is

Divini Procure is a B2B construction-procurement marketplace connecting real
estate **developers/buyers** (post projects, receive bids) with
**vendors/suppliers** (browse, bid, get paid off-platform), plus a third
**Capital Partner (investor)** persona that browses developer-hosted capital
raises. No consumer marketplace, no minors, no health data, no schools.

## Component / data-flow map

```
                         ┌───────────────────────────────────────────┐
                         │  Browser (React SPA, Vite build)            │
                         │  src/ — ~75 pages, native session cookie    │
                         └───────────────┬─────────────────────────────┘
                                          │ HTTPS, same-origin in prod
                                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Single Node process (server/src/index.ts → app.ts)                       │
│                                                                            │
│  cors(allowlist) → express.json (2mb) → authMiddleware (session verify)   │
│  → /api/auth/* rate-limited (20/min/IP) → /api router (41 sub-routers +   │
│  inline core routes) → errorHandler → express.static(SPA) → SPA fallback  │
│                                                                            │
│  server/src/lib/ (~30 engines): fees, bid credits, verification gate,     │
│  entitlements, native-auth, storage/crypto, AI/intel, email, rate limit,  │
│  messaging policy, safe-fetch (SSRF guard for outbound URL fetches)       │
└───────┬───────────────────────┬───────────────────┬──────────────────────┘
        │                       │                   │
        ▼                       ▼                   ▼
┌───────────────┐     ┌──────────────────┐   ┌────────────────────────┐
│ PostgreSQL      │     │ File storage      │   │ Third-party services    │
│ divini_procure  │     │ local disk        │   │ Resend (email, live)    │
│ raw SQL via pg  │     │ (default) or S3/  │   │ Stripe (Checkout +      │
│ ~110-159 tables │     │ R2/B2/MinIO, opt. │   │  Connect; key unset =   │
│ no ORM          │     │ AES-256-GCM at    │   │  not live in this env)  │
│ authorization   │     │ rest              │   │ LLM provider (AI-       │
│ enforced in the │     │ signed HMAC       │   │  assisted drafting/     │
│ Express layer,  │     │ download URLs     │   │  extraction/scoring)    │
│ not DB RLS      │     │                   │   │                        │
└───────────────┘     └──────────────────┘   └────────────────────────┘
```

## Hosting topology (production target — per `23_DEPLOYMENT.md`)

```
Internet → Caddy (TLS) → pm2 "divini-procure" (Express API + SPA, one process)
         → Docker Postgres "divini_procure_db"
```
DigitalOcean droplet, deploy loop is `rsync` (Mac) → `deploy.sh` + `psql` +
`pm2` (server console). This session's own working copy runs against a local
Postgres + `node --env-file=.env dist/index.js`, not the production topology —
findings below are evaluated against the **code**, which is what ships to
either environment.

## Environments

Two that matter per `24_ENVIRONMENTS.md`: dev/sandbox (permissive, boots with
warned fallbacks) and production (`NODE_ENV=production`, fail-closed —
process throws on startup if `SESSION_SECRET`/`DOWNLOAD_URL_SECRET` are
unset/default; empty `ALLOWED_ORIGINS` denies all cross-origin requests).
**[verified 2026-08-08]** `server/src/config.ts` and `server/src/pool.ts`
confirm the fail-closed guards and the SSL requirement on the DB pool in
production (`ssl: IS_PROD && !DATABASE_URL.includes("sslmode=disable") ? {rejectUnauthorized:true} : false`).

## CI/CD

`.github/workflows/ci.yml` — **[verified 2026-08-08]**: runs on every
push/PR — `npm install` (locked), `tsc --noEmit` for both server and SPA,
`npm test` (full suite), then `npm audit --omit=dev` report-only (does not
gate the build). No lint step found. No branch-protection rule is visible
from the repo (that is a GitHub repository setting, not a file — see
Section 03). `.github/dependabot.yml` exists and opens weekly update PRs.

## External integrations (status as of this pass)

| Service | Purpose | Live? |
|---|---|---|
| Resend | Transactional email (verify/reset/notifications) | Wired; requires `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` |
| Stripe (Checkout + Connect) | Subscriptions, success-fee billing, vendor payouts | **[verified 2026-08-08]** `isConfigured()` in `server/src/lib/stripe.ts` / `stripe-connect.ts` gates every call on `STRIPE_SECRET_KEY`; unset in this environment → all Stripe paths degrade to "record-only" / throw `StripeNotConfigured`. User indicated mid-session they are actively wiring a live Stripe connection outside this repo. |
| Stripe webhook | `POST /webhooks/stripe` | **[verified 2026-08-08]** Signature-verified via `STRIPE_WEBHOOK_SECRET` (HMAC-SHA256 over timestamp+payload, hand-rolled — no `stripe` npm SDK dependency), `server/src/lib/stripe.ts` ~line 297. Bad/missing signature → 400 (Stripe-retries-safe, does not silently accept). |
| PayPal | Referenced in the broader multi-app portfolio | Not wired in this app |
| S3-compatible storage | Vendor document storage | Optional; default is local disk, plaintext unless `STORAGE_ENCRYPTION_KEY` set |
| LLM provider | AI-assisted drafting/extraction/scoring (`lib/llm.ts`, `extract.ts`, `procure-coo.ts`) | Wired; see Section 08 |
| Error monitoring (Sentry-style) | — | **Not present.** `src/components/ErrorBoundary.tsx` exists client-side; no server-side error aggregation/alerting. Flagged in `51_SECURITY.md` already. Carried to Section 14. |
| Session-recording / product analytics SDK | — | **Not present** in `package.json` (no Segment/Mixpanel/Amplitude/PostHog/Datadog). Carried to Section 13. |

## Mobile

Capacitor managed-webview wrapper (`capacitor.config.ts`, `mobile/`) loads
the hosted HTTPS site. Per `23_DEPLOYMENT.md`/`IOS-APP-STORE-RUNBOOK.md`, the
iOS native build is Mac-only and **not yet submitted/distributed**. No Android
distribution evidence found. Treated as **CONDITIONAL — not yet applicable**
in the applicability register; re-test before actual store submission
(Section 16).

## Auth model (detail in Section 04)

Native email/password only — no OAuth/social login providers wired
(`server/src/lib/native-auth.ts`, `passwordHash.ts` scrypt). Session = HS256
JWT (`jose`, `SESSION_SECRET`) as an httpOnly cookie (`divini_session`,
30-day TTL) + Bearer token fallback. One canonical user identity per human;
`company_members` links users to one or more `companies` (developer/vendor/
investor), matching the "do not confuse identity with org membership" rule.

## Data layer authorization model (detail in Section 05)

**No database-level Row-Level Security.** `21_DATABASE.md` states this
explicitly: "Authorization is enforced in the Express layer (Supabase RLS was
removed)." This was independently re-confirmed earlier in this engagement
(a prior pass in this same session judged wiring session-scoped RLS too risky
to retrofit onto ~150 direct `pool.query()` call sites without a real
query-layer refactor, and documented the gap rather than guessing at a fix).
This is the single largest architectural fact that shapes Section 05: every
authorization guarantee in this app is a **server-code** guarantee, not a
database one. A single missed ownership check in any route is a full IDOR,
with no RLS backstop. Section 05 audits this by spot-testing routes, not by
inspecting policies (there are none to inspect).
