# Divini Procure

A premium procurement marketplace connecting real estate developers with verified vendors.
Web-first (React + Vite), served by an Express backend with a self-hosted PostgreSQL database.

## Stack
- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Express.js + Node.js (raw SQL via `pg`, no ORM) — `server/`
- **Database:** PostgreSQL — schema in `db/schema.sql`
- **Auth:** Email/password with JWT stored in httpOnly cookie, email verification, forgot/reset — `server/src/routes/auth-native.ts`
- **File storage:** Local disk with HMAC-signed download URLs — `server/src/storage.ts`
- **Mobile:** Capacitor (iOS / Android shell) — see `IOS-APP-STORE-RUNBOOK.md`

## Setup
```bash
npm install
cp .env.example .env   # fill DATABASE_URL, JWT_SECRET, SMTP_*, etc.
npm run dev            # http://localhost:5173
```

## Database
Schema lives in `db/schema.sql` (plain PostgreSQL, no ORM, no RLS).

Core tables: `users`, `companies`, `company_members`, `vendor_profiles`, `vendor_credentials`,
`buildings`, `packages`, `bids`, `bid_line_items`, `bid_revisions`, `threads`, `messages`,
`files`, `reviews`, `notifications`, `subscriptions`, `payouts`.

Apply the schema:
```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/schema-superadmin.sql
```

## iOS
```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios && npm run build && npx cap sync
```
See `IOS-APP-STORE-RUNBOOK.md` for APNs, camera/Files upload, and Apple IAP.
