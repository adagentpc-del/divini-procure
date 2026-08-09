/**
 * Regression coverage for Phase 0 item 17: the durable background job
 * queue (db/schema-jobs.sql, server/src/lib/jobs.ts). Exercises the real
 * compiled queue against a real Postgres database - enqueue, claim,
 * succeed, retry-with-backoff, permanent failure, idempotent enqueue, and
 * the "no duplicate execution" property SKIP LOCKED is supposed to
 * guarantee under concurrent claimers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

async function freshJobsModule() {
  // lib/jobs.ts keeps its handler registry as module-level state, so each
  // test registers its own uniquely-named job_type rather than sharing one
  // (avoids cross-test interference without needing to reset the module).
  return import("../../server/dist/lib/jobs.js");
}

test("jobs: a queued job is claimed and marked succeeded", async () => {
  const { enqueueJob, registerJobHandler, processDueJobs } = await freshJobsModule();
  const jobType = `test_succeed_${Date.now()}`;
  let invocations = 0;
  registerJobHandler(jobType, async () => {
    invocations += 1;
  });

  const { id } = await enqueueJob({ jobType, payload: { hello: "world" } });
  const result = await processDueJobs();
  assert.ok(result.processed >= 1);
  assert.ok(result.succeeded >= 1);
  assert.equal(invocations, 1);

  const { q1 } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const row = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q1<{ status: string; payload: any }>(`select status, payload from jobs where id = $1`, [id]),
  );
  assert.equal(row?.status, "succeeded");
  assert.deepEqual(row?.payload, { hello: "world" });
});

test("jobs: a failing handler retries with backoff, then permanently fails after max_attempts", async () => {
  const { enqueueJob, registerJobHandler, processDueJobs } = await freshJobsModule();
  const { q, q1 } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const admin = <T,>(fn: () => Promise<T>) => runWithRequestContext({ userId: null, isAdmin: true, email: null }, fn);

  const jobType = `test_fail_${Date.now()}`;
  let attempts = 0;
  registerJobHandler(jobType, async () => {
    attempts += 1;
    throw new Error(`synthetic failure #${attempts}`);
  });

  const { id } = await enqueueJob({ jobType, payload: {}, maxAttempts: 2 });

  const first = await processDueJobs();
  assert.ok(first.retried >= 1, "first failure must retry, not permanently fail");
  let row = await admin(() => q1<{ status: string; attempts: number; run_after: string }>(
    `select status, attempts, run_after from jobs where id = $1`,
    [id],
  ));
  assert.equal(row?.status, "pending");
  assert.equal(row?.attempts, 1);
  assert.ok(new Date(row!.run_after).getTime() > Date.now(), "backoff must push run_after into the future");

  // Force it due now so the test does not wait for the real backoff delay.
  await admin(() => q(`update jobs set run_after = now() where id = $1`, [id]));

  const second = await processDueJobs();
  assert.ok(second.failed >= 1, "second failure must exceed max_attempts=2 and permanently fail");
  row = await admin(() => q1<{ status: string; attempts: number; last_error: string }>(
    `select status, attempts, last_error from jobs where id = $1`,
    [id],
  ));
  assert.equal(row?.status, "failed");
  assert.equal(row?.attempts, 2);
  assert.match(row!.last_error, /synthetic failure #2/);
  assert.equal(attempts, 2, "the handler must not run again once permanently failed");

  const third = await processDueJobs();
  assert.equal(attempts, 2, "a permanently-failed job must not be picked up again");
});

test("jobs: enqueueing with the same idempotency key twice creates only one row", async () => {
  const { enqueueJob } = await freshJobsModule();
  const key = `dedup-test-${Date.now()}`;
  const first = await enqueueJob({ jobType: "noop_for_dedup_test", payload: { n: 1 }, idempotencyKey: key });
  const second = await enqueueJob({ jobType: "noop_for_dedup_test", payload: { n: 2 }, idempotencyKey: key });
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.id, second.id, "the second enqueue must resolve to the SAME job row, not a new one");

  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ id: string }>(`select id from jobs where idempotency_key = $1`, [key]),
  );
  assert.equal(rows.length, 1, "there must be exactly one job row for this idempotency key");
});

test("jobs: two concurrent processDueJobs() calls never both execute the same job (SKIP LOCKED)", async () => {
  const { enqueueJob, registerJobHandler, processDueJobs } = await freshJobsModule();
  const jobType = `test_concurrent_${Date.now()}`;
  let invocations = 0;
  registerJobHandler(jobType, async () => {
    invocations += 1;
    // Hold the "running" state a moment so both concurrent callers are
    // genuinely racing to claim work, not trivially serialized.
    await new Promise((r) => setTimeout(r, 50));
  });

  await enqueueJob({ jobType, payload: {} });

  const [a, b] = await Promise.all([processDueJobs(), processDueJobs()]);
  assert.equal(invocations, 1, "exactly one of the two concurrent callers must have claimed and run the job");
  assert.equal((a.succeeded + b.succeeded), 1);
});
