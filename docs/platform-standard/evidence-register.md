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
| S05-13 | Command output (live) | Pre-fix: 2-member company, member A (document uploader) deletes account → `{"ok":true}` but `select id from companies where id=...` and `select id from documents where id=...` both return 0 rows (wrongly destroyed), member B's row also gone. Post-fix (`select set_config('app.is_admin','t',true)` added to `deleteMyAccount`): same sequence → company, member B, and the document (with `uploaded_by` unaffected at this point) all correctly survive |
| S05-14 | Code | `server/src/lib/requestContext.ts` (`runAsAdmin`, new); `server/src/routes/subscriptions.ts` (`/webhooks/stripe` handler wrapped); `server/src/routes/blueprint.ts` (addendum-notify `company_members` lookup wrapped); `server/src/lib/monetization.ts` (`maybeRecordReferralCommission`'s partner-attribution query wrapped) |
| S06-01 | Command output (live) | Pre-fix: same 2-member-company/document-uploader scenario as S05-13, but with S05-13's fix already applied (company survives) → `POST /account/delete` → `500`, server log `"message":"update or delete on table \"users\" violates foreign key constraint \"documents_uploaded_by_fkey\""`. Post-fix (`db/schema-user-fk-cascade-fix.sql` applied): same request → `{"ok":true}`; `select uploaded_by from documents where id=...` → `null` (row survives); `select id from users where id=...` → 0 rows (genuinely deleted) |
| S06-01 | Command output (live) | `select conrelid::regclass, conname, a.attname from pg_constraint ... where confrelid='users'::regclass and confdeltype='a'` → 34 rows across 17 tables, all pre-confirmed nullable (`attnotnull` check → 0 rows) before writing the fix |
| S06-04 | Command output (live) | Second sweep after S06-01: `select ... where confdeltype='a' and confrelid != 'users'::regclass` → 5 more rows (`deliveries`, `submittals`, `progress_photos`, `dispute_messages`, `bid_recommendations`, referencing `companies`/`bids`). Reproduced directly: solo vendor company + 1 submittal row → `delete from companies` → `ERROR: ... violates foreign key constraint "submittals_vendor_company_id_fkey"`. Post-fix (2 columns relaxed to nullable + all 5 changed to `ON DELETE SET NULL`): identical sequence → company deletes cleanly, submittal survives with `vendor_company_id = null`. Final check: `select conrelid, conname from pg_constraint where contype='f' and confdeltype='a'` → **0 rows, whole schema** |
| S06-02 | Command output (live) | `pg_dump` as the actual owning role (`divini`, FORCE RLS set, not exempt) → `ERROR: query would be affected by row-level security policy for table "bid_items"`. Same command as the real Postgres superuser (`postgres`) → succeeds, writes a 914K custom-format dump |
| S06-02 | Command output (live) | Full restore round trip: `pg_restore` the superuser-taken dump into a fresh database → `select count(*) from information_schema.tables` matches (160 = 160); `select count(*) from users` matches (38 = 38); `select count(*) from pg_policies where tablename='users'` on the restored copy → 4 (RLS policies survived the restore intact) |
| S06-03 | Code | `server/src/index.ts` (`purgeExpiredSessions` import + hourly `setInterval`, matching the existing `processDueFollowUps`/`publishDueScheduledPackages` pattern) |
| S06-04 | Command output (live) | Full sweep: `grep -rn "company_members" server/src --include=*.ts` (~50 matches) manually triaged into "own-row filter" (safe, majority) vs "cross-user lookup" (the 4 fixed: `deleteMyAccount`, Stripe webhook, blueprint addendum notify, referral commission) vs "already admin-gated" (verified safe without changes: `follow-up.ts`'s notify-target resolver, `split-engine.ts`'s commission computation - both confirmed behind `requireAdmin` or a truly-absent background-job context) |

## Section 07

| Control ID | Evidence type | Reference |
|---|---|---|
| S07-01 | Code | `server/src/app.ts` `helmet()` config |
| S07-02 | Code | `server/src/app.ts` CORS origin callback (same evidence already used in Section 04) |
| S07-03 | Code | `server/src/routes.ts` (documents upload), `server/src/routes/onboarding.ts` (brand media), `server/src/routes/rfq-assist.ts` (spec/CAD) - all 3 `multer` configs |
| S07-04 | Code | `server/src/routes.ts` `GET /documents/download` - no explicit `Content-Type` set |
| S07-05 | Command output | `grep -rn "dangerouslySetInnerHTML" src` → 0 matches |
| S07-06 | Command output | `grep -rn "query(\`.*\${" server/src --include=*.ts` filtered for unescaped user-input interpolation → 0 matches beyond known-safe patterns |
| S07-07 | Command output | `grep -rln "router.post" server/src/routes*.ts \| xargs grep -L "requireUser\|requireAdmin"` → 0 files; manual read of `public-capture.ts` confirmed its 2 public endpoints are `GET`-only lookups |
| S07-08 | Code (new) | `server/src/lib/rateLimit.ts` (`apiRateLimit`, new); `server/src/app.ts` (mounted globally on `/api`) |
| S07-08 | Command output (live) | 5 sequential `GET /api/healthz` → all `200`. 305-request rapid-fire loop against `GET /api/packages/open` → `429` at request 295 (consistent with `max: 300`). `npm test` (repo root) → `1..173`, `# pass 173`, `# fail 0` after the change |

## Section 08

| Control ID | Evidence type | Reference |
|---|---|---|
| S08-01 | Code | `server/src/lib/llm.ts` (`llmEnabled`, `LLM_API_KEY` not exported, per-call timeouts) |
| S08-02 | Code | `server/src/lib/extract.ts` (`sanitizeForLlm`, the grounding `system` prompt, `onboarding.ts`'s human-review-before-submit flow) |
| S08-03 | Code | `server/src/routes/intel.ts` (`vendorLabel` anonymization, `#52` comment referencing the original fix) |
| S08-04 | Code | `server/src/routes/blueprint.ts` (`confidence: "manual_confirmation_required"`), `server/src/routes/intel.ts` (narrative is supplementary to the deterministic `stats`/`recommended_bid_id` fields), `server/src/routes/onboarding.ts` (`/onboarding/extract` only returns a suggestion; `POST /companies` is the actual, separately-submitted write) |
| S08-05 | Code | `src/pages/Blueprint.tsx` (`DISCLAIMER` constant, verbatim match to the server's), `src/pages/PackageDetail.tsx`, `src/pages/Terms.tsx` (AI-disclosure section) |
| S08-06 | Code (new) | `server/src/routes/onboarding.ts` (`extractLlmLimit`, 20/hour); `server/src/routes/blueprint.ts` (`analyzeLlmLimit`, 60/hour) |
| S08-06 | Command output (live) | Typecheck clean; server rebuilt and restarted, `GET /api/healthz` → `200`; `npm test` (repo root) → `1..173`, `# pass 173`, `# fail 0` |

## Section 09

| Control ID | Evidence type | Reference |
|---|---|---|
| S09-01 | Code | `server/src/lib/stripe.ts` `constructWebhookEvent` |
| S09-02 | Code (new) | `server/src/routes/payouts.ts` (atomic `UPDATE ... WHERE status IN (...) RETURNING *` claim, replacing the prior SELECT-then-UPDATE) |
| S09-02 | Command output (live) | Two genuinely concurrent (backgrounded shell, launched together, `wait`ed together) atomic claim attempts against the same test `payout_instructions` row → one `UPDATE 1` (row returned), one `UPDATE 0` (zero rows, no row returned) |
| S09-03 | Code (new) | `server/src/lib/stripe-connect.ts` (`stripePost`'s `Idempotency-Key` header, `createTransfer`'s `idempotencyKey` param); `server/src/routes/payouts.ts` (`payout-release-<id>` as the stable key) |
| S09-04 | Code (new) | `db/schema-stripe-billing.sql` (`stripe_webhook_events` table); `server/src/routes/subscriptions.ts` (claim-and-skip at the top of the webhook handler, inside `runAsAdmin`) |
| S09-04 | Command output (live) | Direct SQL: `insert into stripe_webhook_events (event_id, event_type) values ('evt_test_dedup_123', ...) on conflict do nothing returning event_id` → row returned first time, `0 rows` on an identical second insert |
| S09-04 | Command output (live) | Two-pass `apply-all.sql` against a fresh database → both passes `exit 0`; `npm test` (repo root) → `1..173`, `# pass 173`, `# fail 0` |
| S09-05 | Code | `grep -rn "automatic_tax\|tax_rate" server/src/lib/stripe.ts` → 0 matches (consistent with the applicability register's CONDITIONAL/counsel-review status, not a silent gap) |

## Section 10

| Control ID | Evidence type | Reference |
|---|---|---|
| S10-01 | Code | `server/src/lib/email.ts` `wrapHtml` (physical address, 15 U.S.C. 7704(a)(5)(A)(iii) comment) |
| S10-02 | Code | `server/src/routes/campaigns.ts` (suppression query + filter, before the send loop begins) |
| S10-03 | Code (new) | `server/src/routes/campaigns.ts` (`unsubscribeByToken` shared helper; `router.post("/unsubscribe", ...)`, new) |
| S10-03 | Command output (live) | `POST /api/unsubscribe?token=test_token_abc123` (with `List-Unsubscribe=One-Click` body) → `200`; `select email, source from email_suppressions` → `unsub-test@example.com \| campaign_link`; `select unsubscribe_token from campaign_recipients` for that row → empty (invalidated); a replayed POST with the same token → `200` (idempotent no-op, not an error); `GET /api/unsubscribe?token=<fresh>` → still renders the confirmation page correctly. `npm test` (repo root) → `1..173`, `# pass 173`, `# fail 0` |
| S10-04 | Code | `server/src/routes/campaigns.ts` (`UPDATE email_campaigns ... WHERE status = 'test_sent' RETURNING *`) |
| S10-05 | Command output | `grep -rln "twilio\|SMS\|sendSms\|push notification\|VAPID" server/src` → 0 matches |
| S10-06 | Code | `docs/platform-standard/applicability-register.md` line 63; `server/src/routes/campaigns.ts`'s `resolveSegment` (no EU/UK-specific branching either way) |

## Section 11

| Control ID | Evidence type | Reference |
|---|---|---|
| S11-01 | Code | `src/App.tsx` `SkipToContent` (`tabindex="-1"` + `.focus()` on the real `<main>`) |
| S11-02 | Code | `src/theme.css` lines 107-108 (`:focus-visible`), line 124 (`prefers-reduced-motion`) |
| S11-03 | Code | `src/pages/Register.tsx` (label/id pairs, `role="alert" aria-live="assertive"`, `aria-hidden` honeypot) |
| S11-04 | Code | `src/pages/Accessibility.tsx` cross-referenced against S11-01/S11-02/S11-03's actual implementations |
| S11-05 | Calculation | Hand-computed WCAG relative-luminance contrast from `src/theme.css`'s hex values: `--muted` (#6b655c) on white ≈ 6.16:1; on `--ivory` (#f7f4ee) ≈ 5.61:1 - both clear the 4.5:1 AA threshold |
| S11-06 | Command output | `grep -rn "axe\|lighthouse\|pa11y" package.json .github/workflows/*.yml` → 0 matches; `grep -n "playwright" package.json` → 0 matches |

## Section 12

| Control ID | Evidence type | Reference |
|---|---|---|
| S12-01 | Command output | `grep -n "role.*owner\|role.*admin" server/src/db.ts` → 3 matches, all inside `transferCompanyOwnerEmail`; `grep -rn "isOwner" src --include=*.tsx` → every match traced to the buyer/vendor building-ownership meaning, never within-company role |
| S12-02 | Code | `server/src/routes/verification.ts`, `investment.ts`, `payouts.ts`, `change-orders.ts` (`async function audit(...)`) |
| S12-03 | Code | `server/src/routes/products.ts` (`shapeForViewer` applied via `.map()` in the list endpoint at line ~203, and directly in the detail endpoint at line ~432) |
| S12-04 | Command output | `grep -rn "logo_url" server/src --include=*.ts` → 0 matches (never read or written server-side); `grep -rn "logo_url" src --include=*.tsx` → 1 match, a type declaration only, never rendered |
| S12-05 | Command output | `find server/src/routes -iname "*calendar*" -o -iname "*video*"` → 0 matches |

## Section 13

| Control ID | Evidence type | Reference |
|---|---|---|
| S13-01 | Command output | `grep -rln "google-analytics\|gtag\|mixpanel\|segment\.io\|amplitude\|posthog" src` → 0 matches |
| S13-02 | Code | `server/src/routes/analytics.ts` (admin-only data route vs. the two stateless `requireUser` policy-evaluation routes) |
| S13-03 | Code (new) | `server/src/routes/pipeline.ts` (`/stages`, `/loss-reasons`, `/sources` - membership check added) |
| S13-03 | Command output (live) | Seeded `pipeline_loss_reasons`/`pipeline_sources` rows for a victim company with `CONFIDENTIAL: ...` labels; an unrelated authenticated user's `GET .../loss-reasons?companyId=<victim>` and `.../sources?companyId=<victim>` both returned the confidential rows pre-fix, and correctly returned only global defaults post-fix |
| S13-04 | Code (new) | `server/src/routes/follow-up.ts` (`/workflows`), `server/src/routes/scope-builder.ts` (`/templates`) - membership checks added, matching every sibling route in each file |
| S13-04 | Command output (live) | Seeded a victim company's `follow_up_workflows` row ("CONFIDENTIAL: internal escalation workflow") and `scope_templates` row ("CONFIDENTIAL: proprietary RFP template"); an unrelated authenticated user's requests to both endpoints with `companyId=<victim>` returned only global defaults post-fix, confirming the leak is closed |
| S13-04 | Command output | Full 173-test suite re-verified clean after all 5 fixes |

## Section 14

| Control ID | Evidence type | Reference |
|---|---|---|
| S14-01 | Code | `server/src/routes.ts` `errorHandler` |
| S14-02 | Code (new) | `server/src/app.ts` (`res.setHeader("X-Request-Id", ...)`); `server/src/routes.ts` (`requestId` in the 500 JSON body) |
| S14-02 | Command output (live) | `curl -s -i http://localhost:8080/api/healthz \| grep -i x-request-id` → present; `curl -s -i .../documents/download?path=nonexistent \| grep -i "x-request-id\|HTTP"` → `403` with `X-Request-Id` present |
| S14-03 | Command output | `GET /api/healthz` used and correctly reflected real state throughout this entire engagement's live testing (dozens of restarts across Sections 05-14) |
| S14-04 | Code (new) | `docs/runbook-incident-response.md` |
| S14-05 | Code | `docs/platform-standard/risk-register.md` R-03 (updated status) |
| S14-06 | Command output | `grep -rn "support@" src/pages/*.tsx` → consistent across `Accessibility.tsx`, `Cookies.tsx`, `NonCircumvention.tsx`, `PaymentPolicy.tsx`, `Profile.tsx`, `Subscription.tsx` |
