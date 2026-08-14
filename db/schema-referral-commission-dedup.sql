-- Divini Procure - Phase 0 financial-integrity fix: referral commission
-- double-payout prevention.
--
-- PROBLEM (found by the master audit, R-financial-integrity): the same
-- underlying referral-commission obligation could be computed and paid
-- through two entirely independent rails with no shared identity:
--   Rail A (bookkeeping): maybeRecordReferralCommission() (lib/monetization.ts)
--     inserts a partner_commissions row when a platform fee is recorded,
--     later rolled up per-period into partner_payouts and marked paid by an
--     admin typing in commission_paid_cents (no processor call - "record
--     that this was paid via wire/check", per that file's own comments).
--   Rail B (real money): enqueueSplitsForRevenue() (lib/split-engine.ts)
--     independently RE-DERIVES the same referral-partner split from the
--     same platform_revenue row when its status moves to 'collected', and
--     queues a payout_instructions row that a real Stripe Connect transfer
--     later pays.
-- Neither rail had any reference to the other, so an admin could mark a
-- partner_payouts period "paid" (Rail A) and separately release the
-- corresponding payout_instructions row via Stripe (Rail B) for the exact
-- same commission, paying the partner twice.
--
-- FIX: partner_commissions now carries platform_revenue_id, the same
-- platform_revenue.id both rails already key off (Rail B's
-- payout_instructions.source_revenue_id already references it - no new
-- column needed there). A partial unique index makes Rail A idempotent
-- against itself (calling maybeRecordReferralCommission twice for the same
-- platform_revenue event can no longer create two commission rows). The
-- application-layer guards (server/src/lib/monetization.ts,
-- server/src/routes/partner-rev.ts, server/src/routes/payouts.ts) use this
-- column to refuse marking a commission paid on either rail once the other
-- rail has already paid it. No commission percentage, fee structure, or
-- referral economics changes here - purely financial integrity.
-- Zero em dashes by convention.

alter table partner_commissions
  add column if not exists platform_revenue_id uuid references platform_revenue(id) on delete set null;

create unique index if not exists partner_commissions_platform_revenue_uidx
  on partner_commissions (platform_revenue_id)
  where platform_revenue_id is not null;

create index if not exists partner_commissions_platform_revenue_idx
  on partner_commissions (platform_revenue_id);
