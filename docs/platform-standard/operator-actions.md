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
| OA-07 | 02 | Draft and publish a DMCA notice-and-takedown process and AUP/Community Guidelines content; decide whether to register a DMCA designated agent with the U.S. Copyright Office | Legal drafting + a federal registration filing, not engineering | R-06 |
| OA-08 | 02 | Decide the retention period and legal-hold policy for each data category in `docs/platform-standard/data-retention-matrix.md`, then fund the engineering work to enforce it automatically | Business/legal policy decision that must precede the Section 06 implementation | R-08 |
