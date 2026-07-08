# 42 Automations

Scheduled / automated jobs and the hooks that exist for them. Note: the repo has
the **logic** for several recurring jobs but does **not** wire a scheduler in the
single Node process today. Confirm before assuming a cron is running.

## Credential expiry + auto-revoke (built logic, no scheduler yet)

- **What:** flip any vendor whose verification has lapsed out of Verified and
  re-gate them; mark expired credentials `doc_status='expired'`; the recompute is
  derived from current credentials (source of truth).
- **Where:** `recomputeExpiringVerifications()` in `server/src/routes/verification.ts`
  (documented as "nightly/worker callable"). "Expiring soon" detection is in
  `lib/verificationGate.ts` (`missingOrExpiring`, soonDays window).
- **Status:** the function exists and is callable, but no cron/worker invokes it
  on a schedule in this repo. To activate, call it from a scheduled job
  (system cron hitting an admin endpoint, a pm2 cron, or a worker loop).
- **Follow-up:** wire a daily trigger before relying on auto-revoke in production.

## Bid-credit reset (implicit, no job needed)

- Free-tier bid credits reset by **period key** (`2026Q3`), not by a job: a new
  quarter is simply a new `vendor_bid_credits` row starting at 0
  (`lib/bidCredits.ts`). No scheduled reset is required; the annual allotment
  terminates naturally because old quarter rows are never reused.

## Success-fee billing (event-driven, queue until Stripe)

- Triggered by the developer marking a project **Awarded**
  (`routes/award-workflow.ts`), not by a schedule. The fee is recorded
  `accrued` on `payment_authorizations`. Actual charging waits for
  `STRIPE_SECRET_KEY`; until then it stays accrued/queue-only.

## Email (event-driven)

- Transactional email (verify, reset, notifications) is sent inline on the
  triggering action via Resend (`lib/email.ts`). No batch/digest scheduler is
  wired, though the V2 spec calls for Pro = real-time vs free = digest lead
  alerts (a follow-up, not built as a scheduled job).

## Optional AI refresh (on-demand)

- `lib/score-refresh.ts` / `routes/score-refresh.ts` recompute scores; these are
  invoked on demand, not on a fixed schedule.

## CI (automated on push)

- `.github/workflows/ci.yml` runs server tsc + SPA tsc + `npm test` on every push
  and PR. This is the only fully wired automation in the repo.

> TODO(owner): decide where recurring jobs run (system cron on the droplet vs a
> pm2 cron vs an external scheduler) and wire `recomputeExpiringVerifications`
> (daily) plus any lead-alert digest before the V2 flag flip.
