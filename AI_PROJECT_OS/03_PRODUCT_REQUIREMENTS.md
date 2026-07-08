# 03 Product Requirements (Monetization V2)

Source of truth: `Divini-Procure-Monetization-Spec.md` (workspace) and the
`PROCURE_MONETIZATION_V2` constants in `server/src/config.ts`. Everything here is
gated behind `PROCURE_MONETIZATION_V2` (default off). Nothing changes for users
until the flag is flipped.

## 1. Pricing and access

| User | Price | Notes |
|---|---|---|
| Developers | Free, forever | Never tax the buyer. Unlimited projects, sourcing, RFQs. |
| Vendors (Free) | Free | Join, build profile, browse projects unlimited. **5 bids per quarter.** |
| Vendors (Pro) | **$149/mo** (`VENDOR_PRO_PRICE_CENTS=14900`) | Unlimited bids, real-time lead alerts, priority/expedited verification, Verified badge, priority matching. |

## 2. Revenue engines

1. **Success fee.** The winning vendor pays **2% of the awarded contract, capped
   at $2,500** (`PROCURE_SUCCESS_FEE_PCT=2`, `PROCURE_SUCCESS_FEE_CAP_CENTS=250000`),
   only on platform-sourced wins. Recorded against the award
   (`payment_authorizations`) when the developer marks the project Awarded.
   Decoupled from the real construction payments.
2. **Grandfathered existing-relationship fee.** For pre-existing developer-vendor
   pairs: **1% capped at $1,000** (`PROCURE_GRANDFATHERED_PCT=1`,
   `PROCURE_GRANDFATHERED_CAP_CENTS=100000`). Per-pair, developer-attested +
   admin-confirmed, protected from automation (the
   `relationship_status = 'grandfathered_2_percent'` logic). Cheaper than standard
   because Divini did not source the relationship.
3. **Vendor Pro subscription.** $149/mo recurring (the MRR engine).
4. **Divini Verified+.** Paid premium verification tier (bonding, financials,
   references, background) = higher-trust badge that wins more bids.
5. **Featured / preferred placement.** Vendor advertising upgrade.

## 3. Bid credits (free tier)

- **5 bids per quarter. No rollover. Annual allotment (20) terminates at the
  12-month mark.** Use-it-or-lose-it each quarter; full reset annually.
  (`PROCURE_FREE_BIDS_PER_QUARTER=5`.)
- **Viewing projects is always free and unlimited.** Only **submitting a bid**
  spends a credit.
- **A win never consumes a credit and is never blocked.**
- **Pro = unlimited** (not metered).

Implemented in `server/src/lib/bidCredits.ts` (pure quarter-key math + DB-backed
`getBidCredits` / `consumeBidCredit`); wired into the bid-submit path in
`server/src/routes.ts`.

## 4. Verification = the gate (developer protection)

A vendor **cannot bid, be matched, be recommended, or message a developer until
verified.** Until then they sit in a sandbox (profile + browse only).

Required to pass (configurable per trade/jurisdiction):
- Contractor/business license (number + state board)
- General liability insurance (COI: carrier, limits, expiry)
- Workers comp (where required)
- Trade certifications for scope
- W-9 / entity; bonding above a deal-size threshold

States: `unverified -> pending -> verified -> expiring_soon -> expired/lapsed ->
rejected/suspended`. Built on the existing `verify_status`.

**Verified state in code:** the canonical verified value is **`approved`** on
`vendor_profiles.verify_status` (the admin credential-review recompute writes
`approved`). `verificationGate.ts` accepts both `approved` and a literal
`verified`. See `14_DECISIONS.md`.

**Expiry tracking + auto-revoke:** credential `expires_at` is stored; the
verification route recomputes status from current credentials, flags
"expiring soon," and on lapse the vendor drops out of Verified and is re-gated.

**Developer controls:** RFPs default to "verified vendors only"; developers see
each vendor's status, coverage limits, and expiry.

**Liability framing:** the badge means "documents collected, checked, and tracked
as of [date], expiring [date]," NOT a guarantee. See `52_COMPLIANCE.md`.

**Monetization fit:** basic verification is **mandatory and free** (never paywall
the safety gate). Pro includes priority/expedited verification; Verified+ is the
paid premium badge.

## 5. Required workflows

1. **Vendor onboarding:** register -> verify email -> upload credentials ->
   verification (sandbox until pass) -> verified -> can bid (5/quarter free or
   unlimited Pro).
2. **Bid:** verified check -> credit check (free tier) -> submit -> decrement.
3. **Award:** developer marks Awarded -> success fee computed and recorded against
   the winning vendor (2% cap $2,500, or grandfathered 1% cap $1,000) ->
   billed to card on file when Stripe is live, else accrued/invoiced.
4. **Credential expiry:** scheduled check -> flag expiring -> on lapse revoke
   Verified + re-gate + notify vendor and any engaged developer.
5. **Upgrade:** free vendor hits the wall or wants alerts/priority -> subscribe Pro.

## 6. Frontend requirements

- Verify-first vendor onboarding (sandbox state until approved); developer signup
  is free and immediate.
- Public pricing page (`src/pages/Pricing.tsx`): Developers Free / Vendors Free
  (5 bids/quarter) / Vendor Pro $149 / Verified+ / Featured. "Only pay when you
  win - 2% capped at $2,500."
- Bid UI: "X of 5 bids left this quarter," block + upsell at 0 (free), unlimited
  for Pro; block + "Get verified" if unverified.
- Vendor dashboard: bid credits remaining, verification status + expiring-soon
  warnings, Pro/Featured upsell, success fees owed/paid.
- Developer dashboard: verified vendor count, "verified only" RFP toggle, vendor
  credential status at a glance.
- Admin: verification queue + expiry monitor, success-fee ledger + MRR,
  Pro/Verified+/Featured management.
- Cards/badges across the app: Verified / Verified+ / Featured.

## 7. Wave plan (as built)

W1 success-fee math; W2 bid credits + verification gate + expiry/revoke;
W3 subscriptions + Featured + Verified+ + lead-alert gating; W4 onboarding +
bid UI + dashboards; W5 pricing page + landing + cards/links/copy; W6 migrate +
flip (not yet done). The build through W5 is complete in the repo behind the flag.

> Open default carried from the spec: basic verification stays free + mandatory;
> grandfathered fee set to 1% capped $1,000 (configurable). Both are env-tunable.
