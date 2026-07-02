# 01 Project Overview

## What it is

**Divini Procure** is a construction-procurement marketplace that connects
**real estate developers (buyers)** with **construction vendors and suppliers
(sellers)**. Developers post projects and request bids; vendors build a verified
profile, browse projects, and bid. The platform monetizes **access and outcomes**
(a success fee on awarded work plus optional vendor upgrades), not payment volume.
Payments for the construction work itself do NOT flow through the platform.

Target domain: **diviniprocure.com**. The app is **not yet deployed** (it has
never been live); the first production deploy is the immediate operational goal.

## Stack at a glance

- **Frontend:** Vite + React 18 + TypeScript single-page app (`src/`).
- **Backend:** Express 4 + raw SQL over `pg` (no ORM), TypeScript (`server/src/`).
  Both the API and the built SPA are served from **one Node process**.
- **Database:** PostgreSQL, database name `divini_procure`. Roughly **110 tables**
  (the consolidated `db/apply-all.sql` reports 112 `create table` statements
  across ~40 schema files).
- **Auth:** **native email/password** (register -> verify email -> login), scrypt
  password hashing, a `jose` HS256 session JWT delivered as an httpOnly cookie and
  a Bearer token. (This replaced an earlier Authentik OIDC design; some older
  docs and `.env.local.example` still mention OIDC and are stale.)
- **API surface:** ~55 routes. There are **41 modular routers** under
  `server/src/routes/` mounted by `server/src/routes.ts`, plus core endpoints
  (including bid submission) defined directly in `routes.ts`.
- **Mobile:** Capacitor managed-webview wrapper for iOS/Android (config present;
  native build pending, Mac-only).

## Monetization model (headline)

Gated behind the `PROCURE_MONETIZATION_V2` flag (default off):

- **Developers: free, forever.** Never tax the buyer.
- **Vendors: free** to join + browse, with **5 bids per quarter** (no rollover,
  20/year terminating annually). **Vendor Pro $149/mo** = unlimited bids + alerts
  + priority verification.
- **Success fee:** the winning vendor pays **2% of the award, capped at $2,500**,
  on platform-sourced wins. **Grandfathered** existing-relationship pairs pay
  **1% capped at $1,000**.
- **Verification is a free, mandatory gate**: a vendor cannot bid, be matched, be
  recommended, or message a developer until verified.
- Upsells: **Divini Verified+** (premium verification badge) and **Featured**
  placement.

See `05_BUSINESS_CONTEXT.md` and `03_PRODUCT_REQUIREMENTS.md` for the full model.

## Relationship to Divini Partners

Procure is the sibling of **Divini Partners** (an events-partnership marketplace,
already live at divinipartners.com). They share the same stack and many of the
same engines; Procure ports patterns from Partners (claim/invite, referral,
featured placement, pricing model). Mapping rule when porting: Partners
`organizations` -> Procure `companies`. See `Divini-Procure-Upgrade-Plan.md` in
the workspace for the full port map.

## Where to look next

- Current build status and what to do next: `10_CURRENT_STATE.md`.
- How it runs: `04_SYSTEM_ARCHITECTURE.md`.
- The code layout: `20_CODEBASE_MAP.md`.
