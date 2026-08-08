# Operator Actions

Actions requiring credentials, vendor consoles, legal review, business
decisions, or production access — nothing here is a code task.

| Action ID | Section | What's needed | Why it's blocked from being a code fix | Requested by |
|---|---|---|---|---|
| OA-01 | 01 | Securities-law review of the Capital Partner / investment-programs feature (matching, introductions, NDA-gated offering materials) | Requires a licensed securities attorney's judgment, not engineering | R-02 |
| OA-02 | 01 | Confirm current CCPA/CPRA and other state privacy-law statutory thresholds against actual business metrics (revenue, records processed) | Requires business data this engineering pass has no visibility into, plus current-law verification | R-04 |
| OA-03 | 01 | Enable "require pull request review before merge" branch-protection rule on the default branch in GitHub repository settings | A GitHub repository setting, not a repo file | R-05 |
| OA-04 | 01 | Decide whether to keep collecting referral-partner banking info directly (and fund the encryption work in R-01) or migrate that collection to Stripe Connect's own onboarding flow (already partially wired in `stripe-connect.ts`) | Architectural/vendor decision with cost and UX tradeoffs | R-01 |
| OA-05 | 01 | Confirm SAQ A (or higher, if scope changes) PCI attestation is actually filed with the payment processor once Stripe goes live for real charges | Filing happens in Stripe's own dashboard/process, not this repo | Applicability register, PCI DSS row |
| OA-06 | 01 | Confirm who handles 1099-NEC issuance for Stripe Connect referral-partner payouts before the first live payout (Stripe itself can do this for Connect accounts, but it must be explicitly configured) | Tax/accounting decision + Stripe dashboard configuration | Applicability register, Information returns / 1099 row |
