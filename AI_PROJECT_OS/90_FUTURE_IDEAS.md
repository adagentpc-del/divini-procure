# 90 Future Ideas

Parked ideas and roadmap beyond the current locked Monetization V2 scope. Nothing
here is built or committed unless the code says so. Sourced from the workspace
planning docs (`Divini-Procure-Revenue-Rebuild.md`,
`Divini-Procure-Pricing-Page-Copy.md`, `Divini-Procure-Upgrade-Plan.md`).

## Revenue model extensions (Revenue Rebuild)

- **Capital introductions.** Introduce equity/debt/family-office capital to
  developers raising; success fee 0.25%-1% on a close (e.g. $10M raise at 0.5% =
  $50,000, paid on close). Tables/routes sketched in the rebuild doc (`capital.ts`,
  `transaction_fees`, `platform_revenue` source `capital_introduction`).
- **Enterprise Procurement OS.** From $499/mo for large developers/ownership
  groups: workflow automation, approval routing, budget tracking, dashboards,
  vendor scorecards, spend analytics, ERP integrations, custom reporting.
- **Payment spreads.** Capture a spread on settlement when payments flow through
  (`split-engine.ts`, `payment_spreads`). Only if the "we do not hold funds"
  posture changes.
- **Investor role end to end.** Investor onboarding, matching to deal flow, NDA +
  pipeline, compliance. Partially present (`routes/investment*.ts`,
  `InvestorDashboard`, `InvestorOnboarding`).
- **1% existing / 2% introduced reframing** of the fee across the platform copy
  (the broader pricing-page model). Reconcile with the V2 success-fee model before
  adopting.

## Super-admin + growth (Upgrade Plan port from Partners)

- Invite / claim profile (unclaimed_profiles, discovered_businesses, invites).
- Discount codes (net-new), referral partners + links + configurable revenue
  share, end-user referral links + platform credits. (Some admin pages already
  exist: `AdminDiscountCodes`, `AdminReferralPartners`, `AdminInvites`.)
- Full SuperAdminDashboard depth (`pages/dashboards/SuperAdminDashboard.tsx` is a
  shell).

## Procurement OS depth (the 15-upgrade addendum)

Quote comparison scoring engine, sample-management state machine, formal
submittal/approval workflow, delivery/install tracking, unified communication
center, email automation + triggers, AI procurement assistant
(`lib/llm.ts`/`extract.ts`), guided developer/vendor/designer onboarding. Several
of these exist as partials (see the upgrade-plan status table).

## Platform / ops

- Developer-premium tier (parked ~1 year out per the monetization spec).
- Real-time vs digest lead alerts (Pro = immediate, free = digest) as a wired
  scheduled job.
- Move object storage to S3/R2 + encryption + versioned backups for vendor docs.
- Structured logging / error monitoring (Sentry-style).
- Integration tests + a richer CI gate.
- iOS + Android native builds shipped (config is ready; build is Mac-only).

## How to use this file

When one of these graduates from idea to active work, move it into
`12_TASK_QUEUE.md` with acceptance criteria, record the decision in
`14_DECISIONS.md`, and update `11_ACTIVE_SPRINT.md` / `10_CURRENT_STATE.md`.

> TODO(owner): prioritize this list against the post-launch roadmap once Procure
> is live and the V2 flag is flipped.
