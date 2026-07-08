# Divini Procure - AI Guardrails

Divini Procure uses AI/automation only to assist, draft, match, summarize, and
flag. It never makes binding decisions, never verifies legal/financial status,
and never gives advice. These guardrails are enforced by keeping the relevant
actions on human-gated, deterministic paths.

## AI / automation MUST NOT

- Provide investment, legal, tax, or financial advice.
- Verify or assert accreditation, qualified-purchaser status, KYC, or AML status.
- Approve, verify, or onboard vendors.
- Award bids or select a winning vendor.
- Create, change, or override fee rules (including the grandfathered 2% rule).
- Publish investment opportunities or mark a program active/approved.
- Grant access to restricted or NDA-gated materials.
- Represent projected returns as guaranteed, or use "invest now" style language.

## AI / automation MAY

- Recommend vendor/product matches and surface alternatives (deterministic
  scoring; results are suggestions only).
- Draft bid packages, quote normalizations, outreach, follow-ups, and reports.
- Compute and surface scores, readiness, risk flags, and KPI summaries.
- Match investors to programs by score and eligibility (surfacing only; never
  granting access or asserting suitability).
- Summarize activity and assemble briefings from existing platform data.

## How the guardrails are enforced

- The grandfathered 2% fee only takes effect on explicit admin approval; no
  automation writes `relationship_status = grandfathered_2_percent`.
- Vendor approval, investor approval, program publication, accreditation/KYC/AML
  statuses, and introductions are all set only by admin or the responsible human
  party through dedicated endpoints.
- Matching engines return scores, labels, and eligibility reasons; they do not
  change records or unlock materials.
- Investor-facing language is constrained to "Request access", "Request
  information", and "Request introduction". The teaser API constrains the CTA to
  this allow-list server-side.
- Optional LLM features are feature-flagged off by default, are manually
  triggered, and are used for drafting/summarizing only.

## Required disclaimers (shown in investment surfaces)

- Divini Procure does not provide investment, legal, tax, or financial advice.
- Investment opportunities are provided by third-party developers or sponsors.
- Investor eligibility, accreditation, suitability, and offering compliance must
  be verified before access to restricted materials.
- Not all opportunities are available to all investors.
- All investment materials must be reviewed and approved by the
  developer/sponsor and their legal/compliance team.

> Guardrails are technical and procedural controls, not a substitute for legal
> and compliance review.
