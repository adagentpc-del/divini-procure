# Authorization Matrix

Per ALFY2 Section 05. This restates and extends `docs/SECURITY-PRIVACY.md`
(already accurate and current - reused, not re-derived) in the pack's
required shape, and adds live adversarial test results this pass actually
ran against the real running app + database, not just source reading.

## The single fact that shapes this whole section

**There is no database-level Row-Level Security.** `21_DATABASE.md` states
this explicitly: RLS was removed when the app moved off Supabase to native
auth; authorization is enforced entirely in the Express layer. This was
independently re-confirmed and judged too risky to retrofit without a real
query-layer refactor earlier in this engagement (~150 direct `pool.query()`
call sites, no per-request transaction wrapping). **Every authorization
guarantee in this app is a server-code guarantee.** A missed ownership
check in any one route is a full IDOR with no database backstop. This
section audits by adversarial live testing of representative routes, not
by inspecting policies - there are none to inspect.

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

Given there is no RLS to inspect, this requirement is satisfied by the
adversarial route-level testing above rather than a policy-by-policy
review. Service-role/superuser DB credentials are confirmed server-process-only
(`DATABASE_URL` is a server env var, never sent to the client; no client-side
Postgres connection exists anywhere in `src/`).
