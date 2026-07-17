-- ============================================================================
-- Divini Procure — Bid status and bid_recommendations CHECK constraints
-- ----------------------------------------------------------------------------
-- Adds 'withdrawn' and 'rejected' to the bids.status CHECK so vendors can
-- retract bids and admins can disqualify them without corrupting the
-- quote-comparison engine (which already filters them out at query time).
--
-- Also adds a CHECK constraint to bid_recommendations.status so only known
-- workflow states can be stored.
--
-- Re-runnable: ALTER TABLE ... DROP CONSTRAINT IF EXISTS first, then re-add.
-- ============================================================================

-- 1. bids.status -- drop old constraint, re-create with extended value list
alter table bids
  drop constraint if exists bids_status_check;

alter table bids
  add constraint bids_status_check
    check (status in (
      'draft',
      'submitted',
      'shortlisted',
      'rebid',
      'awarded',
      'revision',
      'withdrawn',
      'rejected'
    ));

-- 2. bid_recommendations.status -- constrain to known workflow values
alter table bid_recommendations
  drop constraint if exists bid_recommendations_status_check;

alter table bid_recommendations
  add constraint bid_recommendations_status_check
    check (status in (
      'draft',
      'recommended',
      'awarded',
      'declined'
    ));
