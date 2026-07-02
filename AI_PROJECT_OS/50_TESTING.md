# 50 Testing

## Test runner

The Node built-in test runner (`node:test`), invoked via:

```
npm test
# -> node --experimental-strip-types --test "tests/**/*.test.ts"
```

`--experimental-strip-types` runs the TypeScript tests directly (no build step),
which is why some modules expose **pure helpers with no `.js`-specifier imports**
so they are testable under strip-types.

## Current suite (39 tests, all passing)

- `tests/feeMath.test.ts` (~19 tests) - the pure fee arithmetic, **including the
  V2 success fee**: percentage math, rounding to cents, the cap
  (e.g. 2% of $1M capped at $2,500), grandfathered rate/cap, and `resolveFeeRule`
  (grandfathered protection, standard fallback).
- `tests/bidCredits.test.ts` (~13 tests) - the pure quarter-key + limit helpers:
  `periodKeyFor` (UTC quarter boundaries), `remainingBids`, `isOverLimit`,
  unlimited (null limit) handling.
- `tests/passwordHash.test.ts` (~7 tests) - scrypt hash + verify: round-trip,
  rejects wrong/malformed/empty, case-sensitivity.

## Coverage gaps (see `16_TECH_DEBT.md`)

Only **pure functions** are tested. There is no DB-backed/integration test of:
- the bid-submit gate path (verification + credit consumption) in `routes.ts`,
- the award success-fee recording in `routes/award-workflow.ts`,
- the verification recompute / auto-revoke in `routes/verification.ts`.
Adding a thin integration pass would de-risk the V2 flag flip.

## Manual QA checklist (before flipping PROCURE_MONETIZATION_V2)

1. **Verify-first onboarding.** A new vendor lands in a sandbox ("get verified to
   bid"); upload credentials -> admin approves -> `verify_status='approved'` ->
   bidding/matching/messaging unlock.
2. **Bid-credit wall.** As a free vendor, submit bids until "0 of 5 left this
   quarter," confirm the next submit is blocked with a Pro upsell; viewing
   projects stays free; a Pro vendor is never metered.
3. **Verification gate.** An unverified vendor cannot submit a bid, be matched, or
   message a developer.
4. **Award success fee.** Award a NEW pair -> 2% of award capped $2,500 recorded
   `accrued` on `payment_authorizations`. Award a grandfathered pair -> 1% capped
   $1,000; re-award stays 1%. A win never consumes a bid credit.
5. **Account lifecycle.** Register -> receive verify email -> verify -> login
   (proves `EMAIL_PROVIDER`/`EMAIL_API_KEY` are set).
6. **Files.** Upload a vendor doc; the signed download link works and expires;
   decrypts if `STORAGE_ENCRYPTION_KEY` is set.
7. **Auth rate limit.** Rapid repeated logins return 429 with Retry-After.
8. **Legal pages.** /terms, /payment-policy, /non-circumvention, /privacy,
   /messaging-policy all load.

## Rule

Add a test for any new **pure** logic, and keep all three checks (server tsc, SPA
tsc, `npm test`) green before declaring a change done.
