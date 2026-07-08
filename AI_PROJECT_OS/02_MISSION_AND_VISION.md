# 02 Mission and Vision

## Mission

Give real estate developers a trusted, single place to source construction
vendors, run RFQs, compare bids, and award work, where **every vendor on the
platform is licensed, insured, and credential-checked**. Give vendors free access
to active developer deal flow, and only charge when a deal actually happens.

## The wedge

Construction deals are large and margins are thin, so the platform deliberately
does **not** tax payment volume or paywall the buyer. Instead it monetizes:

1. **Access** to verified deal flow (Vendor Pro subscription, Featured placement).
2. **Outcomes** (a capped success fee on the win, never on the gross spend).

The scarce side is the **developer (buyer)**, so developers are free forever and
the burden of monetization sits on the supply side that benefits from the leads.

## The moat: verification as the gate

The strategic moat is that **verification is mandatory and free**, and it gates
everything a vendor can do (bid, be matched, be recommended, message). This lets
the platform credibly promise developers that "everyone here is licensed and
insured," with expiry tracking and automatic re-gating when a credential lapses.
We never paywall the safety gate, because 100% verified supply is the product.

The badge is a documentation-and-tracking claim, not a guarantee: "documents
collected, checked, and tracked as of [date], expiring [date]." Developers retain
due-diligence responsibility. See `52_COMPLIANCE.md`.

## Vision (longer arc)

- Become the **transaction and trust layer for real estate procurement**: vendor
  discovery, RFQ automation, bid comparison, awards, and credential compliance in
  one workflow.
- Layer in capital introductions (developers raising equity/debt) and an
  enterprise procurement OS for large ownership groups. These appear in the
  broader revenue-rebuild and pricing-page material but are **beyond the locked
  V2 scope** below; see `90_FUTURE_IDEAS.md`.

## Scope note (important)

The repo contains two related but distinct monetization write-ups:

- **Monetization V2 (LOCKED, what is built):** developers free; vendors free +
  5 bids/quarter; Vendor Pro $149; success fee 2% capped $2,500 / grandfathered
  1% capped $1,000; verification gate; Verified+ and Featured upsells. Flag
  `PROCURE_MONETIZATION_V2`.
- **Revenue Rebuild / Pricing Page copy (broader, partly aspirational):** adds
  investor capital introductions, enterprise OS pricing, payment spreads, and a
  1% existing / 2% introduced framing. Treat this as **future direction**, not
  current built state, unless the code confirms it.

This OS describes the **built** state (Monetization V2). When in doubt, the code
and the `PROCURE_MONETIZATION_V2` config in `server/src/config.ts` are the truth.
