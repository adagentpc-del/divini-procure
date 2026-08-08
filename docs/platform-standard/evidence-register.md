# Evidence Register

Evidence references for PASS/PARTIAL controls, by section.

## Section 01

| Control ID | Evidence type | Reference |
|---|---|---|
| S01-01 | File | `docs/platform-standard/architecture-map.md` |
| S01-01 | File | `AI_PROJECT_OS/04_SYSTEM_ARCHITECTURE.md`, `20_CODEBASE_MAP.md`, `21_DATABASE.md`, `22_APIS_AND_INTEGRATIONS.md`, `23_DEPLOYMENT.md`, `24_ENVIRONMENTS.md` |
| S01-01 | Code | `server/src/config.ts` (fail-closed prod guards), `server/src/pool.ts` (SSL-in-prod DB pool config) |
| S01-01 | Code | `server/src/lib/stripe.ts:31` `isConfigured()`, `stripe.ts:~297` webhook signature verification; `server/src/lib/stripe-connect.ts:25` `isConfigured()` |
| S01-01 | Config | `.github/workflows/ci.yml` (typecheck + test + report-only `npm audit` gates) |
| S01-02 | Command output | `grep -rln "referral_partners\|partner_commissions" server/src/routes/*.ts` → 5 files, all customer/partner-referral revenue, none securities-adjacent |
| S01-02 | Command output | Search for guardian/minor/health/education/background-check schema tables in `db/schema-*.sql` → none found |
| S01-03 | File | `db/schema-referral-partner-onboarding.sql:37` `account_number text, -- stored as-is; encrypt at rest via STORAGE_ENCRYPTION_KEY if desired` — comment itself concedes the field is not encrypted by that mechanism (`STORAGE_ENCRYPTION_KEY` is documented in `51_SECURITY.md` as encrypting uploaded *files*, not database columns) |
| S01-03 | File | `docs/SECURITY-PRIVACY.md`, `AI_PROJECT_OS/51_SECURITY.md`, `52_COMPLIANCE.md` — existing, current, accurate security/compliance documentation reused rather than re-derived |
| S01-04 | File | `db/schema-investment*.sql`, `src/pages/InvestmentPrograms.tsx:85` (`if (company.kind !== 'buyer') return ... "This page is for developer accounts."`), `src/components/ComplianceDisclaimer.tsx` |
| S01-04 | File | `AI_PROJECT_OS/05_BUSINESS_CONTEXT.md` — "Broader direction (not the current locked scope)" section explicitly excludes the 0.25%-1% investment close fee from the built product |
| S01-04 | Command output | `grep -n "success_fee\|commission\|carry\|placement_fee" server/src/routes/investment*.ts` → no matches (no per-close compensation mechanism exists in code) |
| S01-04 | Code | `db/schema-procure-rev.sql:31` `source text default 'subscription' -- subscription \| transaction \| setup \| enterprise \| manual_adjustment` — confirms referral commissions are customer-referral-based, not capital-referral-based |
| S01-04 | Command output | `grep -rln "card.*element\|CardElement\|stripe.js\|Elements" src/pages/*.tsx` → no matches (supports SAQ A / hosted-Checkout-only PCI posture) |
| S01-04 | Code | `src/pages/LenderPortal.tsx:1-3` header comment — confirms draw-request visibility tool, not lending/credit extension by Divini |

## Section 02

| Control ID | Evidence type | Reference |
|---|---|---|
| S02-01 | Files | `src/pages/{Terms,Privacy,Cookies,Accessibility,PaymentPolicy,NonCircumvention,MessagingPolicy}.tsx`; `Terms.tsx:184` incorporates Privacy Policy and Payment Policy by reference |
| S02-02 | Command output | `grep -in "DMCA\|takedown\|acceptable use\|community guideline" src/pages/Terms.tsx` → no matches |
| S02-03 | File (new) | `db/schema-consent-and-audit.sql` — `user_legal_acceptances` table added this pass |
| S02-03 | Code (new) | `server/src/db.ts` `recordLegalAcceptance()`; called from `server/src/routes/auth-native.ts` (registration, `document_type='terms'`) and `server/src/db.ts` `createCompanyForUser` (vendor onboarding, `document_type='vendor_agreement'`) |
| S02-03 | Command output (live) | `select ... from user_legal_acceptances ula join users u ...` after a real Playwright-driven vendor registration returned exactly 2 rows: `vendor_agreement` (source `onboarding`, version `2026-08`) and `terms` (source `register`, version `2025-01`), both with `has_ip = t` |
| S02-04 | File (new) | `server/src/lib/company-validation.ts` — `validateCompanyCreation()`, pure function |
| S02-04 | Code | `server/src/routes.ts` `POST /companies` calls `validateCompanyCreation(req.body)` before creating the company |
| S02-04 | Test (new) | `tests/company-validation.test.ts` — 5 tests, part of the 168/168 passing suite (`npm test`) |
| S02-04 | Command output (live) | `curl -X POST /api/companies -d '{"kind":"vendor","name":"Bypass Test Co"}'` (authenticated, no `vendorAgreementAccepted`) → `400 {"error":"Vendor Agreement must be accepted..."}`; same call with `vendorAgreementAccepted:true` → `201` with a full company object |
| S02-05 | Code | `server/src/routes.ts:275-308` (`/account/delete`, `/account/export`); `server/src/db.ts:515-618` (`deleteMyAccount`, `exportMyData`, `redactRows`, `publicTablesWithColumn`) |
| S02-06 | File | `db/schema-sessions.sql:7` `user_id text not null references users(id) on delete cascade` |
| S02-06 | Code | `server/src/auth.ts:66-79` `verify()` calls `isSessionActive(claims.jti)` on every request, sourced from `user_sessions` |
| S02-07 | File (new) | `docs/platform-standard/data-retention-matrix.md` |
| S02-08 | File | `src/components/CookieBanner.tsx` (banner + `consentGranted()` export) |
| S02-08 | Command output | `grep -rln "consentGranted" src/` → only `CookieBanner.tsx` itself; no other caller found |
| S02-10 | File (new) | `server/src/lib/fieldCrypto.ts`; `tests/fieldCrypto.test.ts` (6 tests: round-trip, null/empty pass-through, random-IV non-determinism, legacy-plaintext fallback, tamper detection) |
| S02-10 | Command output (live) | `select account_number, routing_number, iban from referral_partner_banking ...` → `RFBGMZlS6TDU+...` (base64 of the `DPF1` magic header + IV + tag + ciphertext), not plaintext |
| S02-10 | Command output (live) | `GET /partner/onboarding/banking` (authenticated as the owning partner) → `{"account_number":"****6789","routing_number":"****0021","iban":"****6819", ...}` - correctly masked from the real decrypted values, not the ciphertext |
| S02-11 | Command output (live) | Before fix: `POST /partner/onboarding/agreement/sign` and `POST /partner/onboarding/banking` both returned `500 {"error":"internal error"}` with server log `column "referred_by_partner_id" does not exist`. After fix: both returned `200`. |
| S02-11 | Command output | `grep -rn "referred_by_partner_id" db/*.sql` → no matches anywhere in the schema (confirms this was never a valid column, not a local environment drift) |

## Section 03

| Control ID | Evidence type | Reference |
|---|---|---|
| S03-01 | Command output | `find . -iname CODEOWNERS` → none; `git tag` → empty; `grep '"version"' package.json server/package.json` → both `0.1.0` |
| S03-02 | File (new) | `server/src/index.ts` `logEnvironmentIdentity()` |
| S03-02 | Command output (live) | Server restart log: `[divini-procure] environment=development db_host=localhost db_name=divini_procure` |
| S03-03 | Command output | `grep -rohE "process\.env\.[A-Z_0-9]+" server/src/ \| sort -u` → 55 distinct variables (full list retained in this session's working notes, not reproduced here per rule 5 - names only, no values) |
| S03-04 | File | `.gitignore` (root) - `.env`, `.env.*`, `!.env.example`, `!.env.local.example`, `*.pem`, `*.key`, `serviceAccount*.json` |
| S03-04 | Command output | `git check-ignore -v server/.env` → matched by `.gitignore:16`; `git ls-files \| grep -iE "\.(env\|pem\|key\|p12\|pfx)$"` → no output; `git log --all -p \| grep -iE "sk_live_\|AKIA[0-9A-Z]{16}\|AIza..."` → only doc references to variable names |
| S03-05 | File | `.github/dependabot.yml`; `package-lock.json`, `server/package-lock.json` |
| S03-06 | Code | `server/src/app.ts:65-74` |
| S03-06 | Command output | `grep -rl "supabase" src/` → no matches |
| S03-07 | File (modified) | `.github/workflows/ci.yml` - added "Build SPA" step + new `db-schema` job |
| S03-07 | Command output (live simulation) | Fresh Postgres DB (`create database divini_ci_test`), two-pass `psql -v ON_ERROR_STOP=1 -f db/apply-all.sql`: pass 1 exit 0 / 0 errors, pass 2 exit 0 / 0 errors, final `select count(*) from information_schema.tables where table_schema='public'` = 160 (gate threshold is 100) |

## Section 04

| Control ID | Evidence type | Reference |
|---|---|---|
| S04-02 | Code | `server/src/lib/passwordHash.ts` |
| S04-03 | Code | `server/src/routes/auth-native.ts` `setSessionCookie`/`clearSessionCookie` |
| S04-04 | Code | `server/src/auth.ts:66-79` `verify()`; `db/schema-sessions.sql:7` cascade FK |
| S04-05 | File (new) | `server/src/db.ts` `hashToken()`, applied in `getUserByVerifyToken`, `getUserByResetToken`, `upsertUserForRegistration`, `setVerifyToken`, `setResetToken`, `transferCompanyOwnerEmail` |
| S04-05 | Command output (live) | Direct DB-level script (`node --env-file=.env` against the compiled `server/dist/db.js`): registered a real user via `upsertUserForRegistration`, confirmed `select verify_token from users where id=$1` returned `sha256(rawToken)` byte-for-byte, confirmed `getUserByVerifyToken(rawToken)` found the user, confirmed `getUserByVerifyToken(storedHashValue)` returned `null` (proves a DB-breach reader cannot use the stored value directly) |
| S04-06 | File (new) | `server/src/routes.ts` `POST /account/sessions/revoke-all`; `src/lib/db.ts` `signOutAllDevices()`; `src/pages/Profile.tsx` "Security" card |
| S04-06 | Command output (live) | Two curl-driven sessions (separate cookie jars) both `200` on `/auth/me`; after device 1 called `/account/sessions/revoke-all`, both devices returned `401` on the next `/auth/me` call |
| S04-07 | Code | `server/src/routes/auth-native.ts` `GENERIC = "Incorrect email or password."`; `/auth/forgot` and `/auth/resend-verification` handlers |
| S04-08 | Code | `server/src/lib/rateLimit.ts` exports wired into each route in `auth-native.ts` |
| S04-09 | Code | `server/src/app.ts:98-107` `cors({credentials: true, origin(...)})` |

## Section 05

| Control ID | Evidence type | Reference |
|---|---|---|
| S05-01 | File (new) | `docs/platform-standard/authorization-matrix.md`; `docs/SECURITY-PRIVACY.md` (reused) |
| S05-02 | Command output (live) | Two-tenant curl test: `POST /buildings/:id/packages` on Tenant A's building using Tenant B's session → `403 {"error":"not the owner of this building"}` |
| S05-03 | Command output (live) | `GET /documents?buildingId=<A's building>` and `GET /documents/signed-url?path=<A's doc>` both from Tenant B's session → `403` |
| S05-04 | Command output (live) | Valid signed URL → `200` + file content; bit-flipped `sig` → `403`; `exp` in the past → `403` |
| S05-05 | Command output (live) | `GET /admin/subscriptions` from a non-admin session → `403 {"error":"forbidden"}` |
| S05-06 | Command output (live) | `GET /buildings/:id` for Tenant A's building using Tenant B's session → `200`, full record |
| S05-07 | Command output | `grep -rln "impersonat" server/src src` → only an unrelated AUP-text match in `Terms.tsx` |
| S05-08 | Code | `server/src/routes/subscriptions.ts` `/subscriptions/cancel` (modified), `customer.subscription.deleted`/`.updated` webhook cases (unmodified, already correct) |
| S05-08 | Command output (live) | Record-only branch: assigned `vendor_pro` record-only, confirmed `tier_key=vendor_pro` in DB, called `/subscriptions/cancel`, confirmed `tier_key=vendor_free, subscription_status=cancelled` immediately (correct for this branch) |
| S05-09 | Code (new) | `server/src/lib/requestContext.ts`; `server/src/auth.ts` (`authMiddleware`); `server/src/pool.ts` (`setRlsContext`, `queryWithContext`); `server/src/db.ts` (`upsertUserForRegistration`, `q1AsPreAuth`, `qAsPreAuth`, and the 4 `pool.connect()` sites); `db/schema-rls.sql` |
| S05-09 | Command output (live) | Full functional regression via `curl` against the real running server + Postgres: register → verify (direct DB flip, local email disabled) → login → `/auth/me` → create buyer company → create building → create package → `GET /packages/open` (marketplace discovery) → create vendor company → submit bid → buyer reads bid on own package → vendor reads own bid → upload document → list documents → issue signed URL → vendor requests signed URL for buyer's document (`403`, correctly denied) → delete account (membership removed, orphaned company deleted, user row deleted) - all as expected |
| S05-09 | Command output (live) | Adversarial DB-layer test: `psql` session with `set_config('app.user_id', '<vendor id>', true)` directly selecting the buyer's `documents`/`users`/`company_members` rows → `0 rows` each time, independent of the Express app entirely |
| S05-09 | Command output (live) | `npm test` (repo root) → `1..173`, `# pass 173`, `# fail 0` after all RLS changes |
| S05-10 | Command output (live) | Pre-fix: `POST /buildings` immediately after registration → server log `"message":"stack depth limit exceeded"` at `assertMemberOfCompany`. Post-fix (policy narrowed, see `db/schema-rls.sql`'s `company_members` comment): same request → `201` |
| S05-11 | Command output (live) | Pre-fix: `psql -f db/apply-all.sql` run twice against a fresh `divini_rls_test` database → pass 1 `exit 0`, pass 2 `ERROR: new row violates row-level security policy for table "subscription_tiers"`, `exit 3`. Post-fix (`set_config('app.is_admin','t',false)` added near the top of `apply-all.sql`): both passes `exit 0`, `select count(*) from information_schema.tables where table_schema='public'` = 160 |
