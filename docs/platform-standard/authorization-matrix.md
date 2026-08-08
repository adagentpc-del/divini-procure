# Authorization Matrix

Per ALFY2 Section 05. This restates and extends `docs/SECURITY-PRIVACY.md`
(already accurate and current - reused, not re-derived) in the pack's
required shape, and adds live adversarial test results this pass actually
ran against the real running app + database, not just source reading.

## The single fact that shapes this whole section

**UPDATE 2026-08-08: database-level Row-Level Security is now implemented
and verified live, superseding the "too risky to retrofit" judgment
recorded earlier in this engagement.** Per explicit operator direction, RLS
was retrofitted without the large query-layer rewrite originally assumed
necessary, using `node:async_hooks` `AsyncLocalStorage` to propagate the
current request's `{userId, isAdmin}` through the existing ~150
`q()`/`q1()` call sites transparently:

- `server/src/lib/requestContext.ts` - `AsyncLocalStorage` holding
  `{userId, isAdmin}` for the current request.
- `server/src/auth.ts`'s `authMiddleware()` - populates it once per
  request, right after session verification.
- `server/src/pool.ts` - `q()`/`q1()` now wrap every query in its own
  transaction and run `select set_config('app.user_id', $1, true),
  set_config('app.is_admin', $2, true)` immediately after `BEGIN`. The
  `true` (`is_local`) argument scopes the setting to that transaction only,
  auto-discarded at `COMMIT`/`ROLLBACK` - safe with a shared connection
  pool, since a released connection carries no leftover identity into its
  next reuse.
- The handful of `db.ts` functions that already used a raw
  `pool.connect()` transaction (`createCompanyForUser`, `deleteMyAccount`,
  `createBid`) call the same `setRlsContext(client)` helper. A small number
  of identity-less pre-session flows (registration, login, forgot-password,
  verify-email, resend-verification, and the owner-email-transfer flow)
  run under a transaction-local admin-equivalent escalation instead, with
  an inline comment at each site explaining why (there is no "current
  user" yet for the RLS policy to match, and each of these routes is
  already gated by its own app-layer checks - rate limiting, generic
  non-enumerating errors, or `assertMemberOfCompany` before the escalation
  begins).
- Policies: `db/schema-rls.sql`, applied as the last step of
  `db/apply-all.sql`. Every policy-bearing table uses `FORCE ROW LEVEL
  SECURITY` (the app connects as the table-owning role, which Postgres
  exempts from RLS by default unless FORCE is set).

**Real bug found and fixed during implementation, worth recording:** the
first draft of `current_user_company_ids()` (a helper selecting a user's
`company_id`s from `company_members`) was itself called from
`company_members`'s own SELECT/INSERT/UPDATE/DELETE policies, producing
infinite self-recursion - reproduced live as Postgres error "stack depth
limit exceeded" on the very first `POST /buildings` after registration.
Fixed by checking every real read/write of `company_members` in `db.ts`
(none of them need to see another user's membership row - each filters on
the acting user's own `user_id`, or already runs escalated) and narrowing
those four policies to `user_id = current_setting('app.user_id') OR
current_user_is_admin()`, removing the self-referential disjunct entirely.
See `db/schema-rls.sql`'s own comment on `company_members` for the full
trace.

**Second bug found and fixed:** `db/apply-all.sql` is documented
(`23_DEPLOYMENT.md`) and CI-tested to be applied **twice** against the same
database. Once RLS is force-enabled by the first pass, the file's own
re-runnable seed `INSERT`s (`subscription_tiers`, admin-write-only under
RLS) failed on the second pass with no admin context available. Fixed by
setting `select set_config('app.is_admin', 't', false);` (session-scoped,
not transaction-local) at the very top of `apply-all.sql` - running this
file at all is itself a trusted, admin-equivalent DBA/deploy operation, not
a live user request. Verified by actually running the two-pass sequence
locally against a fresh database twice, both before (reproduced the
failure) and after (clean exit 0) this fix.

RLS here is explicitly **defense-in-depth**, not a replacement for the
Express-layer checks below (`db.ts` already enforces every one of these
rules in application code, confirmed via the adversarial cross-tenant
testing in this document). What RLS adds: a single missed ownership check
in one future route can no longer become a full IDOR, because the database
itself also refuses the row. This was proven, not assumed - see "RLS
adversarial verification" below.

## Roles / actors

See `applicability-register.md`'s actor table for the full inventory
(developer/buyer, vendor, Capital Partner/investor, admin, referral
partner). Recap of the authorization-relevant facts:

- **Company identity, not user identity, is the tenancy boundary.** A
  `users` row authenticates a human; `company_members` links that human to
  one or more `companies` with a `role` (`owner`/`admin`/member). Every
  resource is ultimately owned by a `company_id`.
- **Admin is a global, server-side-only flag**, not a per-resource role: it
  derives from `ADMIN_ALLOWED_EMAILS` on every request, never trusted from
  the client, never baked into the shipped bundle.
- **No admin impersonation / view-as feature exists.** `grep -rln
  "impersonat"` across `server/src` and `src` found nothing (the one hit in
  the whole repo is the word "impersonate" inside the new AUP text in
  `Terms.tsx`, an unrelated coincidence). The entire "Admin impersonation"
  audit subsection (banner, audit trail, `admin_impersonation_sessions`) is
  **N/A** - there is no capability to audit.
- **No guardian/minor relationship exists** (confirmed in Section 01).

## Resource visibility model (the actual design intent, confirmed against live behavior this pass)

| Resource | Anonymous | Any authed user | Company member (owner) | Assigned vendor/counterparty | Admin | Enforcement point |
|---|---|---|---|---|---|---|
| Public marketing pages, teasers | Read | Read | Read | Read | Read | No auth required by design |
| Companies (basic profile) | — | Read | Read + write own | — | Read + write | `docs/SECURITY-PRIVACY.md`: "any authed user (marketplace discovery)" |
| Buildings/projects | — | **Read** (by design) | Read + write own | — | Read + write | **[verified live 2026-08-08]**: an unrelated company's session read a building it doesn't own via `GET /buildings/:id` (200, full data) - confirmed intentional marketplace-discovery design, not a bug, matching `21_DATABASE.md`'s documented original RLS intent ("buildings: read any; write only own-company") |
| Packages (bid postings) | — | **Read** (by design) | Read + write own | Read (to bid) | Read + write | Same intentional public-marketplace design; write correctly blocked - see adversarial test below |
| Bids | — | — | Read own (as buyer) | Read/write own (as bidder) | Read | Not tested this pass in detail; the earlier award-workflow phase of this engagement already function-tested the full bid lifecycle |
| Documents (plans, specs, credentials) | — | — | Read/write own company's | Read if assigned to the package | Read | **[verified live 2026-08-08]**: cross-tenant list (`GET /documents?buildingId=`) and cross-tenant signed-URL issuance (`GET /documents/signed-url`) both correctly returned `403` for an unrelated company |
| Signed download URLs (issued) | — | — | — | — | — | The URL itself is the capability once issued (standard presigned-URL pattern, matches S3/Supabase) - **[verified live]** a validly-issued URL worked regardless of the caller's session, a bit-flipped signature was rejected (`403`), an expired timestamp was rejected (`403`) |
| Investment programs (offering docs) | — | Gated by visibility rule | Read/write own (developer) | Read if `accredited_only`/`nda_required` conditions met | Read | Per `docs/SECURITY-PRIVACY.md`: NDA-gated docs withheld until a signed `nda_records` row exists; not re-tested live this pass (out of scope for this section's time budget - the existing document is detailed and was not contradicted by anything found) |
| Vendor/investor pricing tiers | — | Varies by `price_visibility` (`public`/`trade`/`developer`/`admin_only`) | — | — | Read all | Per `docs/SECURITY-PRIVACY.md`, already product-audited earlier this session (`ProductCatalog.tsx` correctly nulls hidden prices server-side) |
| Admin-only routes (fee config, verification review, revenue) | — | — | — | — | Read/write | **[verified live 2026-08-08]**: a non-admin session got `403 {"error":"forbidden"}` from a real admin endpoint |
| Referral-partner banking PII | — | — | Owning partner (masked only) | — | Read (masked) | Encrypted at rest as of Section 01/02's gap closure (R-01); no endpoint returns the unmasked value to anyone, including admin |

## Adversarial tests executed live this pass

All run against the real running server + Postgres, two genuinely separate
companies/sessions ("Tenant A", "Tenant B"), not read from source alone.

| Test | Result | Notes |
|---|---|---|
| Cross-tenant read: `GET /buildings/:id` for another company's building | `200`, full data returned | **Confirmed intentional** - matches documented "read any" marketplace-discovery design, not a defect |
| Cross-tenant write: `POST /buildings/:id/packages` on another company's building | `403 {"error":"not the owner of this building"}` | PASS |
| Cross-tenant document list: `GET /documents?buildingId=` for another company's building | `403 {"error":"not a member of the company that owns this building"}` | PASS |
| Cross-tenant signed-URL issuance: `GET /documents/signed-url?path=` for another company's document | `403 {"error":"access denied"}` | PASS - the code's own comment names this exact IDOR scenario |
| Signed URL, valid: `GET /documents/download?path=&exp=&sig=` from an unrelated company's session | `200`, file content returned | **Correct by design** - the signature is the capability, matching every standard presigned-URL system; the real checkpoint (issuance) is gated, confirmed above |
| Signed URL, tampered signature (one hex char flipped) | `403 {"error":"invalid or expired link"}` | PASS |
| Signed URL, expired `exp` timestamp (with a syntactically plausible signature) | `403 {"error":"invalid or expired link"}` | PASS |
| Non-admin session against a real admin-only endpoint (`GET /admin/subscriptions`) | `403 {"error":"forbidden"}` | PASS |
| Forged `isAdmin: true` in a request body against an admin action | Route required a different path shape and 404'd before authz was even reached; the forged field was never consulted anywhere in the codebase (admin status is resolved server-side from `ADMIN_ALLOWED_EMAILS` only - confirmed by code, not just this one probe) | PASS |
| Ownership field forgery: creating a company with a bogus/missing `company_id`-shaped field | Server correctly rejected with "not a member of this company" rather than crashing or defaulting to allow | PASS (defensive) |

## Entitlement correctness (the "cancelled subscription retaining premium authority" scenario)

This adversarial scenario, explicitly named in the pack's validation
matrix, led to a real finding - not in the direction of over-privilege, but
under-privilege caused by the same class of bug:

**`POST /subscriptions/cancel` was downgrading `tier_key` to the free tier
immediately**, in the same request as the cancel click, even for a real
Stripe-billed subscription - directly contradicting the UI's own promise
("You will keep access until the end of your current billing period") and
cutting off access the user had already paid for. The correct mechanism
already existed and was correct: `customer.subscription.deleted` and
`customer.subscription.updated` (status `canceled`/`unpaid`) webhook
handlers both call the same downgrade function at the real Stripe-billed
period boundary. The cancel-button handler just didn't defer to it.

**Fixed**: when a real Stripe subscription exists, the cancel route now
only calls `stripe.cancelSubscription(id, atPeriodEnd=true)` and marks
`subscription_status='cancel_at_period_end'`, leaving `tier_key` and
`stripe_subscription_id` untouched so the existing webhook can find the
company and do the real downgrade later. The immediate-downgrade path is
preserved only for the case that actually needs it: no live Stripe
subscription to defer to (record-only / Stripe-not-configured mode).

**Verified live** (record-only path only - see limitation below): assigned
a real Vendor Pro tier record-only, confirmed `tier_key=vendor_pro` in the
database, called `/subscriptions/cancel`, confirmed immediate downgrade to
`tier_key=vendor_free, subscription_status=cancelled` - correct for this
branch since there is no real billing period to honor. **Limitation
disclosed**: the new deferred branch (`stripe.isConfigured()===true`)
could not be exercised end-to-end in this sandbox, which has no live
Stripe test credentials. It was verified by direct code reading of both
the modified cancel handler and the pre-existing, unmodified webhook
handler it now defers to, and the underlying `stripe.cancelSubscription(id,
true)` call (unchanged code, already used the correct `cancel_at_period_end`
Stripe API parameter). Flagged for a live Stripe-test-mode smoke test before
this specific path ships to production - see operator-actions.md.

## RLS/data-layer controls (Section 05's "for each table" requirement)

Service-role/superuser DB credentials are confirmed server-process-only
(`DATABASE_URL` is a server env var, never sent to the client; no
client-side Postgres connection exists anywhere in `src/`).

Per-table policy summary (`db/schema-rls.sql`; all `FORCE ROW LEVEL
SECURITY`):

| Table | Read | Write |
|---|---|---|
| `users` | own row, or admin | INSERT open (registration, pre-session by design); UPDATE/DELETE own row, or admin |
| `companies` | any (marketplace discovery, matches app-layer design) | INSERT open (onboarding has no prior-membership precondition); UPDATE own company or admin; DELETE admin, or a now-orphaned company with zero members (matches `deleteMyAccount`'s own-membership-removed-first order) |
| `company_members` | own row, or admin | own row, or admin (see recursion bug writeup above for why this is intentionally narrower than "any teammate") |
| `buildings` | any (marketplace discovery) | owning company's members, or admin |
| `packages` | any (marketplace discovery) | members of the company owning the package's building, or admin |
| `bids` | the bidding vendor, or the package's building owner, or admin | INSERT/UPDATE as your own vendor company; DELETE admin only |
| `documents` | owning company's members, or admin | owning company's members, or admin |
| `subscription_entitlements` | owning company's members, or admin | owning company's members, or admin |
| `subscription_tiers` | any (pricing page is public) | admin only |

### RLS adversarial verification (live, 2026-08-08, DB layer directly - not via the app)

Ran with two real accounts created this pass (a buyer and a vendor, in
separate companies), setting the RLS session GUCs directly in `psql` to
simulate each identity **without going through the Express app at all** -
this is what actually proves RLS is a second, independent layer rather
than inert policy text that happens not to break anything:

| Test | Result |
|---|---|
| Buyer identity selects own uploaded `documents` row directly | Row returned |
| Vendor identity (not a member of the buyer's company) selects that same `documents` row directly | 0 rows - blocked by RLS itself, not the app |
| Vendor identity selects the buyer's `users` row (`email`, `password_hash`) directly | 0 rows |
| Vendor identity selects the buyer's `company_members` row directly | 0 rows |

### Full functional regression under RLS (live, 2026-08-08)

register -> verify -> login -> `/auth/me` -> create buyer company ->
create building -> create package -> marketplace discovery
(`GET /packages/open`, unauthenticated-of-that-company session) -> create
vendor company -> submit bid as vendor -> buyer reads bid on own package
(cross-tenant read via legitimate building-ownership path) -> vendor reads
own bid -> upload document as buyer -> list documents -> issue signed URL
for own document -> vendor requests signed URL for buyer's document (403,
correctly denied) -> delete account (own `company_members` row removed,
then the now-orphaned company deleted, then the `users` row deleted) - all
passed. Full server unit suite (173 tests) also passes unchanged.
