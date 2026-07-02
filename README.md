# Divini Procure

A premium procurement marketplace connecting real estate developers with verified vendors.
Web-first (React + Vite), packaged for iOS/Android with Capacitor, on a Supabase backend.

## Stack
- React + Vite + TypeScript
- Supabase (Postgres, Auth, Storage, Edge Functions, Realtime)
- Capacitor (iOS / Android shell) — see `../IOS_BUILD_PLAN.md`

## Live backend
- Project: **Divini Procure** (self-hosted Postgres (no Supabase))
- API URL: `(removed - self-hosted, no Supabase)`
- Dashboard: (removed)

## Setup
```bash
npm install
cp .env.example .env   # values are already filled for this project
npm run dev            # http://localhost:5173
```
The starter `App.tsx` connects to Supabase and shows row counts for the core tables.

## Database
Schema lives in `supabase/migrations/`:
- `0001_init.sql` — all tables, RLS policies, storage buckets
- `0002_harden_rls_and_storage.sql` — RLS/storage hardening

Core tables: `companies`, `company_members`, `vendor_profiles`, `vendor_credentials`,
`buildings`, `packages`, `bids`, `bid_line_items`, `bid_revisions`, `threads`, `messages`,
`files`, `reviews`, `notifications`, `subscriptions`, `payouts`.
Buckets: `logos` (public), `project-files` (private), `vendor-docs` (private).

RLS is scoped by company membership via `user_company_ids()`. Review policies before launch.

## iOS
```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios && npm run build && npx cap sync
```
See `../IOS_BUILD_PLAN.md` for push (APNs), camera/Files upload, and Apple IAP for the vendor subscription.

## Roadmap
The full prototype UI (`../divini_procure_prototype.html`) is the design reference to port into components.
