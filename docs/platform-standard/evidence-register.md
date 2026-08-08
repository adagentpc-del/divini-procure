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
