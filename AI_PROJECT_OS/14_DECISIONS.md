# 14 Decisions

Locked architectural and business decisions. Do NOT silently reverse these. If a
task requires changing one, call it out and record the new decision here.

---

### D1. Success fee on the win, not the gross
The platform charges a fee on the **awarded contract** (a win), not on payment
volume or total spend. Construction deal sizes are huge and margins thin, so
taxing gross would be punitive and uncompetitive.
- **Why:** monetize outcomes/access, never payment flow. Payments do not flow
  through the platform.
- **Where:** `lib/feeMath.ts` (`successFeeCents`), `routes/award-workflow.ts`.

### D2. The success fee is capped
2% of the award **capped at $2,500** (grandfathered 1% **capped $1,000**). A large
award never carries a scary fee.
- **Why:** keep the fee fair and predictable on big deals.
- **Where:** `config.ts` constants; `computeSuccessFeeCents` in `fee-rules.ts`.

### D3. Developers are free, forever
The buyer (the scarce side) is never taxed. A developer-premium tier is parked
roughly a year out.
- **Why:** attract and protect the demand side at all costs.

### D4. Verification is the gate
A vendor cannot bid, be matched, be recommended, or message a developer until
verified. Basic verification is **mandatory and free** (never paywalled).
- **Why:** 100% verified supply is the product and the developer-protection moat.
- **Where:** `lib/verificationGate.ts`, bid-submit path in `routes.ts`,
  `routes/verification.ts`.

### D5. `'approved'` is the verified state
The canonical verified value on `vendor_profiles.verify_status` is **`approved`**
(the admin credential-review recompute writes it; the live CHECK constraint allows
`pending|ai-verified|approved|flagged`). The gate accepts both `approved` and a
literal `verified` for forward-compatibility.
- **Why:** reuse the existing verify_status machinery without a constraint change.
- **Where:** `verificationGate.ts` (`VERIFIED_STATUSES = {verified, approved}`).

### D6. Free tier = 5 bids/quarter, no rollover
Free vendors get 5 NEW bid submissions per calendar quarter (20/year, terminating
annually). No rollover. Viewing is always free; only submitting a bid spends a
credit; a win never consumes one; Pro is unlimited.
- **Why:** create an upgrade wall without blocking discovery or wins.
- **Where:** `lib/bidCredits.ts`, `config.ts` (`PROCURE_FREE_BIDS_PER_QUARTER=5`).

### D7. Grandfathered protection
Pre-existing developer-vendor pairs get the lower 1%/$1,000 fee, per-pair,
developer-attested + admin-confirmed, and **protected from automation**. Only an
explicit admin override may change a grandfathered pair.
- **Why:** "we didn't create the relationship, we protect it." Honest, defensible.
- **Where:** `relationship_status='grandfathered_2_percent'` logic in
  `feeMath.ts`/`fee-rules.ts`; `routes/grandfathered-fees.ts`; AdminRelationships.

### D8. Flag-gated rollout
The entire V2 money + verification model is behind `PROCURE_MONETIZATION_V2`
(default off). With the flag off the app behaves exactly as before. The flag is
flipped only after a clean deploy + smoke test.
- **Why:** ship safely; decouple build from launch.
- **Where:** `config.ts`; gates throughout the lib + routes.

### D9. Payments do NOT flow through the platform
The platform records and bills fees but does not custody the construction
payments. When Stripe goes live, the plan is Stripe Connect (funds settle to the
vendor; platform takes only the application fee). Until `STRIPE_SECRET_KEY` is set,
fees accrue/queue and records stay correct.
- **Why:** avoid money-transmitter posture; "we do not hold funds."

### D10. Self-hosted, native auth, raw SQL
Single Node process (Express API + Vite SPA), Docker Postgres, Caddy + pm2 on a
droplet; native email/password auth (replacing Authentik OIDC); raw `pg` SQL (no
ORM); local-disk storage by default. Not Vercel/Supabase (the old README is stale).
- **Why:** simple, owned, cheap to run on the shared droplet.

> Add new decisions below with date, the decision, the why, and where it lives.
