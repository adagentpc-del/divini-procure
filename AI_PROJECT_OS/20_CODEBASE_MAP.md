# 20 Codebase Map

Where everything lives. Paths are relative to the repo root
(`sites/divini-procure`). Confirm details in the actual files.

## Entry points

- `server/src/index.ts` - process entry; starts the HTTP server.
- `server/src/app.ts` - Express app: CORS, JSON body, `authMiddleware`, auth rate
  limiter, mounts `/api` router, serves the built SPA + SPA fallback.
- `server/src/routes.ts` - imports and mounts the 41 modular routers AND defines
  core endpoints inline (notably **bid submission**, which calls
  `assertVendorVerified` + `consumeBidCredit` + reports `getBidCredits`).
- `src/main.tsx` -> `src/App.tsx` - SPA entry + routing.

## Backend (`server/src/`)

### Core
- `config.ts` - all env/config: secrets (fail-closed in prod), storage, email,
  and the `PROCURE_MONETIZATION_V2` flag + success-fee/bid constants.
- `pool.ts` - `pg` pool + `q` / `q1` query helpers.
- `db.ts` - authorization helpers, `ForbiddenError`, query intent.
- `auth.ts` - native session middleware (cookie / Bearer verify).
- `storage.ts` - file storage entry; `lib/objectStorage.ts` does the work.

### `server/src/lib/` (engines, ~30 files)
- **Money/fees:** `feeMath.ts` (pure: `successFeeCents`, `feeCentsFromPercentage`,
  `resolveFeeRule`), `fee-rules.ts` (`computeSuccessFeeCents`, `resolveFee`),
  `fee-matrix.ts`, `monetization.ts`, `relationships.ts`, `split-engine.ts`,
  `stripe-connect.ts`.
- **Bid credits / gate:** `bidCredits.ts` (5/quarter, pure helpers + DB),
  `verificationGate.ts` (`assertVendorVerified`, `getVendorVerification`,
  `REQUIRED_CREDENTIAL_TYPES`).
- **Entitlements:** `entitlements.ts`, `entitlement-guard.ts`.
- **Auth:** `native-auth.ts`, `passwordHash.ts` (scrypt).
- **Storage/crypto:** `objectStorage.ts`, `storageCrypto.ts`, `s3sigv4.ts`.
- **AI/intel:** `llm.ts`, `extract.ts`, `procure-coo.ts`, `procure-moat.ts`,
  `score-refresh.ts`, `investor-match.ts`.
- **Misc:** `email.ts`, `rateLimit.ts`, `messaging-policy.ts`,
  `project-access.ts`, `agreement-templates.ts`, `csv.ts`/`csv-parse.ts`,
  `safe-fetch.ts`.

### `server/src/routes/` (41 modular routers)
Key ones for the V2 model:
- `award-workflow.ts` - records the success fee on Award.
- `verification.ts` - admin credential review, recompute, expiry, auto-revoke.
  (Vendor self-serve upload endpoint is a TODO; see `12_TASK_QUEUE.md`.)
- `subscriptions.ts`, `vendor-pricing.ts`, `featured.ts` - Pro/Featured/Verified+.
- `fee-matrix.ts`, `grandfathered-fees.ts` - fee config + grandfathered pairs.
- `revenue.ts`, `payouts.ts`, `partner-rev.ts` - revenue + payout ledgers.
- `auth-native.ts` - register/verify/login/forgot/reset.
Others: `onboarding*`, `products`, `quote-comparison`, `submittals`, `delivery`,
`change-orders`, `engagements`, `project-roles`, `project-templates`, `crm`,
`campaigns`, `agreements`, `split-terms`, `intel`, `moat`, `procure-coo`,
`analytics`, `reports`, `admin-extra`, `admin-tasks`, `investment*`,
`teasers-profiles`, `profile-collateral`, `public-capture`, `rfq-assist`,
`score-refresh`, `csv-import`, `vendor-import`.

### `server/src/db/`
- `featured.ts` - Featured placement data access. (Most data access is inline SQL
  in the route/lib files via `pool.ts`, not a per-table db layer.)

### `server/src/scripts/`
- `send-test-email.ts` - standalone email transport test.

## Frontend (`src/`)

- `pages/` (~75 pages): `Landing`, `Pricing`, `Login`/`Register`/`VerifyEmail`/
  `ForgotPassword`/`ResetPassword`, `Onboarding`, `Projects`/`BuildingDetail`/
  `PackageDetail`, `MyBids`/`SearchBids`, `AwardWorkflow`, `QuoteComparison`,
  `Submittals`, `DeliveryTracking`, `ChangeOrders`, role dashboards
  (`GcDashboard`, `DesignerDashboard`, `InvestorDashboard`, `CooDashboard`,
  `IntelDashboard`, `WarRoom`), Admin pages (`AdminVerification`, `AdminRevenue`,
  `AdminSubscriptions`, `AdminFeeMatrix`, `AdminRelationships`, `AdminFeatures`,
  `AdminPayouts`, `AdminCRM`, `AdminCampaigns`, `AdminInvites`,
  `AdminDiscountCodes`, `AdminReferralPartners`, `AdminTasks`, etc.), legal pages
  (`Terms`, `PaymentPolicy`, `NonCircumvention`, `Privacy`, `MessagingPolicy`).
- `pages/dashboards/SuperAdminDashboard.tsx`.
- `components/`: `VendorBadges.tsx`, `FeeBadge.tsx`, `ExistingRelationshipCheckbox.tsx`,
  `ComplianceDisclaimer.tsx`, `DocumentPanel.tsx`, `MatchCard.tsx`, `Shell.tsx`.
- `lib/`: `api.ts` (fetch client), `auth.tsx` (session context), `features.tsx`
  (feature flags), `monetization.ts`, `db.ts`, `oidc.ts` (legacy).

## Database (`db/`)
- `apply-all.sql` - consolidated, idempotent, parents-first (~110 tables). Single
  source for a first deploy (run twice on a fresh DB).
- ~40 `schema-*.sql` source files (one per feature area). See `21_DATABASE.md`.

## Config / build
- `package.json` (SPA + Capacitor), `server/package.json` (API), `vite.config.ts`,
  `tsconfig.json`, `server/tsconfig.json`, `capacitor.config.ts`, `deploy.sh`,
  `.github/workflows/ci.yml`.
