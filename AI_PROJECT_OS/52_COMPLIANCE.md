# 52 Compliance

## Legal pages (in the SPA, `src/pages/`)

- `Terms.tsx` - Terms of Service.
- `PaymentPolicy.tsx` - payment / fee policy (the success-fee + grandfathered fee
  framing; "we do not hold funds").
- `NonCircumvention.tsx` - non-circumvention (protects platform-sourced
  introductions from being taken off-platform; ties to the success-fee model).
- `Privacy.tsx` - Privacy Policy.
- `MessagingPolicy.tsx` - messaging policy (`lib/messaging-policy.ts` backs the
  in-app messaging rules; messaging is gated on verification).

> TODO(owner): counsel review of Terms + the policies is still open per the
> go-live runbook (governing law indicated as Florida, liability cap,
> arbitration/class waiver, consumer-protection nuance). Confirm before launch.

## Verification = documentation, not a guarantee

The core compliance posture of the product. The Verified badge means **"documents
collected, checked, and tracked as of [date], expiring [date]"** - it is NOT a
warranty of the vendor's work, license validity, or coverage adequacy.

- Developers retain due-diligence responsibility.
- The platform does not guarantee work quality or coverage.
- This framing is surfaced in-app via `src/components/ComplianceDisclaimer.tsx`
  and must stay consistent with the Terms.

## Credential / insurance handling

- Required credentials: contractor/business license, general liability insurance
  (COI with carrier/limits/expiry), workers comp (where required), trade certs,
  W-9/entity, bonding above a deal-size threshold.
- Expiry is tracked per credential (`vendor_credentials.expires_at`); the system
  flags "expiring soon" and **auto-revokes** Verified on lapse, re-gating the
  vendor until re-upload. This is a developer-protection feature, not just hygiene.
- Required types gated in code: license, gl_insurance, trade_cert
  (`REQUIRED_CREDENTIAL_TYPES` in `lib/verificationGate.ts`).

## Payments / money-transmitter posture

- The platform does **not** custody the construction payments ("we do not hold
  funds"). It records and bills its fee only.
- Intended live setup: **Stripe Connect** so funds settle directly to the vendor
  and the platform takes only the application fee. Until `STRIPE_SECRET_KEY` is
  set, fees accrue/queue and records stay correct.
- This "not a party to the transaction" posture must match the Payment Policy and
  Terms language. See `14_DECISIONS.md` D9.

## Non-circumvention

Because the success fee depends on platform-sourced introductions, the
non-circumvention policy is load-bearing: it discourages parties introduced
through Divini from moving the relationship off-platform to avoid the fee. The
grandfathered path is the honest carve-out for relationships that pre-date Divini.

## iOS / App Store compliance (for the mobile track)

- In-app **account deletion** must be reachable (Apple guideline 5.1.1(v)).
- Privacy manifest `mobile/PrivacyInfo.xcprivacy` declares collected data types
  (all tracking=false) + required-reason API declarations.
- Decide **IAP vs external purchase** for paid placements/subscriptions (Featured,
  Vendor Pro) to avoid rejection. See `IOS-APP-STORE-RUNBOOK.md`.

## Data handling

- Vendor documents are sensitive (licenses, COIs, W-9s). See `51_SECURITY.md` for
  encryption-at-rest and signed-download handling.

> TODO(owner): no formal data-retention / data-subject-request (GDPR/CCPA) process
> is documented. Define retention for vendor docs and a deletion path tied to the
> in-app account deletion requirement.
