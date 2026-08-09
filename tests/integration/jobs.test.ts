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

// The `jobs` table is genuinely shared across every integration test file
// (that is the whole point of a durable, cross-process queue) - other
// suites in this repo (award-workflow/intel invite flows) enqueue real
// 'send_email' jobs but never drain them, since draining is this file's
// job to test. Running the full suite back to back leaves a real backlog
// of old pending rows sitting ahead of this file's freshly-enqueued jobs
// in claim order (oldest first). Drain everything before this file's own
// tests run so each test starts against a (mostly) empty queue, same as
// it would standalone.
test.before(async () => {
  const { processDueJobs, registerJobHandler } = await import("../../server/dist/lib/jobs.js");
  await import("../../server/dist/jobs/handlers.js"); // real send_email handler, so backlog drains cleanly
  registerJobHandler("noop_for_dedup_test", async () => {}); // a prior run's dedup-test rows, if any
  for (let i = 0; i < 20; i++) {
    const result = await processDueJobs(500);
    if (result.processed === 0) break;
  }
});

test("jobs: a queued job is claimed and marked succeeded", async () => {
  const { enqueueJob, registerJobHandler, processDueJobs } = await freshJobsModule();
  const jobType = `test_succeed_${Date.now()}`;
  let invocations = 0;
  registerJobHandler(jobType, async () => {
    invocations += 1;
  });

  const { id } = await enqueueJob({ jobType, payload: { hello: "world" } });
  // A single processDueJobs() call drains up to `limit` due jobs across
  // the WHOLE shared queue, not just this test's own row - other suites
  // may have left (or be concurrently leaving) unrelated jobs in the
  // queue, which this test does not control and must not assume away.
  // Loop until this test's own target row resolves, rather than trusting
  // the aggregate counters from a single call.
  let status = "pending";
  for (let i = 0; i < 20 && status === "pending"; i++) {
    await processDueJobs(200);
    const { q1 } = await import("../../server/dist/pool.js");
    const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
    const row = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
      q1<{ status: string }>(`select status from jobs where id = $1`, [id]),
    );
    status = row?.status ?? "pending";
  }
  assert.equal(status, "succeeded");
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

  // Drain until THIS job specifically leaves 'pending' with attempts=1 (a
  // retry), tolerating unrelated jobs elsewhere in the shared queue.
  let row: { status: string; attempts: number; run_after: string } | null = null;
  for (let i = 0; i < 20; i++) {
    await processDueJobs(200);
    row = await admin(() => q1<{ status: string; attempts: number; run_after: string }>(
      `select status, attempts, run_after from jobs where id = $1`,
      [id],
    ));
    if (row && (row.status !== "pending" || row.attempts >= 1)) break;
  }
  assert.equal(row?.status, "pending");
  assert.equal(row?.attempts, 1);
  assert.ok(new Date(row!.run_after).getTime() > Date.now(), "backoff must push run_after into the future");

  // Force it due now so the test does not wait for the real backoff delay.
  await admin(() => q(`update jobs set run_after = now() where id = $1`, [id]));

  for (let i = 0; i < 20; i++) {
    await processDueJobs(200);
    row = await admin(() => q1<{ status: string; attempts: number; run_after: string }>(
      `select status, attempts, run_after from jobs where id = $1`,
      [id],
    ));
    if (row && row.status !== "pending") break;
  }
  const finalRow = await admin(() =>
    q1<{ status: string; attempts: number; last_error: string }>(
      `select status, attempts, last_error from jobs where id = $1`,
      [id],
    ),
  );
  assert.equal(finalRow?.status, "failed");
  assert.equal(finalRow?.attempts, 2);
  assert.match(finalRow!.last_error, /synthetic failure #2/);
  assert.equal(attempts, 2, "the handler must not run again once permanently failed");

  await processDueJobs(200);
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

  // Fire pairs of concurrent claimers repeatedly until this test's own
  // job has actually been claimed by SOMEONE (the shared queue may also
  // contain unrelated jobs from other suites, which a single round may
  // exhaust its `limit` on before ever reaching this one). The property
  // under test - SKIP LOCKED preventing a double-claim - holds
  // regardless of how many rounds it takes: invocations must never
  // exceed 1 at any point.
  for (let i = 0; i < 10 && invocations === 0; i++) {
    await Promise.all([processDueJobs(200), processDueJobs(200)]);
    assert.ok(invocations <= 1, "invocations must never exceed 1, even mid-loop, across any number of concurrent rounds");
  }
  assert.equal(invocations, 1, "exactly one of the concurrent callers must have claimed and run the job");
});
