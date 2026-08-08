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
