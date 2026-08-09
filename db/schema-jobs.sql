-- Divini Procure - Phase 0 item 17: minimal durable background job
-- foundation.
--
-- Before this, every scheduled task (routes/follow-up.ts's
-- processDueFollowUps, routes/marketplace-publication.ts's
-- publishDueScheduledPackages, db.ts's purgeExpiredSessions) ran as a bare
-- in-process setInterval in index.ts: no durable record of what ran, no
-- attempt/failure tracking, no retry policy, and - critically - no
-- protection against two replicas of this process both firing the same
-- interval and doing the same work twice. That has been fine so far
-- because none of those three jobs is currently at risk of duplicate
-- side effects severe enough to justify a rewrite (see this file's
-- companion, lib/jobs.ts, and the Phase 0 completion report for exactly
-- what remains out of scope here) - so none of the three existing jobs
-- were touched.
--
-- What DOES move onto this queue in this pass: the outbound EMAIL send
-- (the actual external HTTP call to the Resend API) for the two
-- notification call sites added earlier in this same phase (award
-- confirmation, bid invitation - see routes/award-workflow.ts and
-- routes/intel.ts). That was the highest-risk synchronous operation on
-- a financially-important request path added this phase: an unbounded,
-- awaited, per-recipient loop of third-party HTTP calls sitting between
-- "the award was recorded" and "the developer gets their response". The
-- in-app notification row (fast, local, no external dependency) stays
-- synchronous; only the slow/unreliable external call is queued.
--
-- Claiming a job uses `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP
-- LOCKED) RETURNING *` in a single statement - the standard Postgres
-- pattern for "at most one worker, across any number of replicas, ever
-- claims a given row", with no separate distributed lock system needed.
-- This is what makes "no duplicate execution across replicas" true here
-- in a way the three legacy setInterval jobs cannot claim.
--
-- Zero em dashes by convention.

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Optional caller-supplied dedup key (e.g. "award-email:<purchase_order_id>").
  -- A second enqueue with the same key is a silent no-op, not a duplicate row.
  idempotency_key text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_idempotency_key_uidx
  on jobs (idempotency_key) where idempotency_key is not null;

create index if not exists jobs_due_idx
  on jobs (run_after) where status = 'pending';

-- Internal system table: no user-facing route ever reads or writes it
-- directly (the poller and the one admin trigger route both run
-- admin-equivalent - see lib/jobs.ts). RLS still applied for the same
-- defense-in-depth reason as every other table in this phase - deny by
-- default rather than relying solely on "nothing happens to query this
-- as a normal user" being permanently true.
alter table jobs enable row level security;
alter table jobs force row level security;

drop policy if exists jobs_admin_only on jobs;
create policy jobs_admin_only on jobs
  for all using (current_user_is_admin());
