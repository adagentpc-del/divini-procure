# 05 Business Context

Source: `Divini-Procure-Monetization-Spec.md`, `Divini-Procure-Pricing-Page-Copy.md`,
`Divini-Procure-Revenue-Rebuild.md` (workspace), confirmed against
`server/src/config.ts`.

## The market

Procure connects **real estate developers (buyers, the scarce side)** with
**construction vendors/suppliers (sellers)**. Construction deals are large and
margins thin, so the platform monetizes **access + outcomes, not payment volume**.
Payments for the construction work itself do NOT flow through the platform.

## The locked model (Monetization V2)

| User | Price | Notes |
|---|---|---|
| Developers | Free, forever | Never tax the buyer. A developer-premium tier is parked ~1 year out. |
| Vendors (Free) | Free | Profile + unlimited browse + **5 bids/quarter**. |
| Vendors (Pro) | $149/mo | Unlimited bids, real-time alerts, priority verification, Verified badge, priority matching. |

### Revenue engines
1. **Success fee** - 2% of the award, capped $2,500, on platform-sourced wins,
   billed to the winning vendor at Award.
2. **Grandfathered existing-relationship fee** - 1% capped $1,000 for pre-existing
   pairs (per-pair, developer-attested + admin-confirmed, automation-protected).
3. **Vendor Pro subscription** - $149/mo recurring (MRR).
4. **Divini Verified+** - paid premium verification badge.
5. **Featured / preferred placement** - vendor advertising upgrade.

### Why these numbers
- Success fee is on the **win, not the gross**, and **capped**, so a large
  construction award never carries a punitive fee. Example: 2% of a $1M award is
  $20,000 uncapped, but capped to $2,500.
- Grandfathered pairs pay less (1% / $1,000) because Divini did not source the
  relationship. "We didn't create the relationship, we protect it."
- Developers are free because the buyer is the scarce, attract-at-all-costs side.

## Tiers seeded in the DB

`db/schema-procure-monetization-v2.sql` seeds `subscription_tiers`:

| key | name | audience | price_cents |
|---|---|---|---|
| developer_free | Developer | developer | 0 |
| vendor_free | Vendor Free | vendor | 0 |
| vendor_pro | Vendor Pro | vendor | 14900 |
| verified_plus | Divini Verified+ | vendor | 4900 |
| vendor_featured | Featured Vendor | vendor | 9900 |

(Featured price in `vendor_featured` defaults to 9900 cents; the public pricing
copy floats a $199-$499/mo range as the eventual band. Verified+ seeded at $49.)

## Broader direction (not the current locked scope)

The `Divini-Procure-Revenue-Rebuild.md` and `Divini-Procure-Pricing-Page-Copy.md`
documents describe a larger model: 1% existing / 2% introduced framing, investor
**capital introductions** (0.25%-1% success fee on a close), an **Enterprise
Procurement OS** (from $499/mo), and **payment spreads**. These are roadmap, not
the built V2 state. Build against V2 unless explicitly directed otherwise, and
confirm any of these against the code before treating them as live.

## Payments posture

Real money does not move until `STRIPE_SECRET_KEY` is set. Until then, fees and
payouts are **accrued/queue-only** and the records remain correct. The intended
live setup uses Stripe Connect so funds settle to the vendor and the platform
takes only the application fee, reinforcing the "we do not hold funds" posture in
the legal pages. See `52_COMPLIANCE.md`.

## Admin / ownership

Sole super-admin and account owner email: **adagentpc@gmail.com**
(`ADMIN_ALLOWED_EMAILS` is the server-side authority for admin status).
