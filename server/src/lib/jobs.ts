/**
 * Minimal durable background job queue (db/schema-jobs.sql). See that
 * file's header for why this exists and what it deliberately does NOT
 * replace (the three legacy setInterval jobs in index.ts are untouched).
 *
 * Usage:
 *   registerJobHandler("send_email", async (payload) => { ... });   // once, at startup
 *   await enqueueJob({ jobType: "send_email", payload: {...} });    // from a route
 *   await processDueJobs();                                         // from the poller / admin trigger
 *
 * A handler that throws is a retryable failure: attempts increments,
 * run_after moves out by an exponential backoff, and the job goes back to
 * 'pending' for a later poll - up to max_attempts, after which it is
 * marked 'failed' and left for manual/observability review (never
 * silently dropped, never retried forever).
 *
 * Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";
import { runAsAdmin } from "./requestContext.js";

export interface EnqueueJobInput {
  jobType: string;
  payload: Record<string, unknown>;
  /** Optional dedup key - a second enqueue with the same key is a no-op. */
  idempotencyKey?: string | null;
  maxAttempts?: number;
}

export interface EnqueueJobResult {
  id: string;
  /** True when an existing job with the same idempotencyKey already existed. */
  deduped: boolean;
}

/**
 * jobs is an admin-only table by RLS (db/schema-jobs.sql) since it is a
 * purely internal system queue no user-facing route reads or writes
 * directly - but a route handler (a real, non-admin request context) is
 * exactly where a job gets enqueued from (e.g. award-workflow.ts after a
 * developer confirms an award). Enqueueing is a trusted internal
 * operation the calling route has already fully authorized by reaching
 * this point - it writes no tenant data the caller was not already
 * entitled to generate - so this runs under the same runAsAdmin()
 * escalation used elsewhere in this phase for already-authorized
 * cross-boundary writes (see lib/notify.ts).
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  return runAsAdmin(async () => {
    const inserted = await q1<{ id: string }>(
      `insert into jobs (job_type, payload, idempotency_key, max_attempts)
       values ($1, $2::jsonb, $3, $4)
       on conflict (idempotency_key) where idempotency_key is not null do nothing
       returning id`,
      [input.jobType, JSON.stringify(input.payload ?? {}), input.idempotencyKey ?? null, input.maxAttempts ?? 5],
    );
    if (inserted) return { id: inserted.id, deduped: false };

    // Conflict: an earlier job with this idempotency key already exists.
    const existing = await q1<{ id: string }>(`select id from jobs where idempotency_key = $1`, [
      input.idempotencyKey,
    ]);
    return { id: existing!.id, deduped: true };
  });
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

/** Register the function that executes a given job_type. Call once at startup. */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** 1m, 2m, 4m, 8m, 16m, capped at 30m. */
function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

async function claimOneDueJob(workerId: string): Promise<JobRow | null> {
  return q1<JobRow>(
    `update jobs
        set status = 'running', locked_by = $1, locked_at = now(), updated_at = now()
      where id = (
        select id from jobs
         where status = 'pending' and run_after <= now()
         order by created_at asc
         for update skip locked
         limit 1
      )
      returning id, job_type, payload, attempts, max_attempts`,
    [workerId],
  );
}

export interface ProcessDueJobsResult {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

/**
 * Claim and run up to `limit` due jobs, one at a time. Safe to call
 * concurrently from multiple processes/replicas - SKIP LOCKED guarantees
 * two callers never claim the same row.
 */
export async function processDueJobs(limit = 20): Promise<ProcessDueJobsResult> {
  const workerId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const result: ProcessDueJobsResult = { processed: 0, succeeded: 0, retried: 0, failed: 0 };

  for (let i = 0; i < limit; i++) {
    const job = await claimOneDueJob(workerId);
    if (!job) break;
    result.processed += 1;

    const handler = handlers.get(job.job_type);
    try {
      if (!handler) throw new Error(`no handler registered for job_type '${job.job_type}'`);
      await handler(job.payload);
      await q(`update jobs set status = 'succeeded', updated_at = now() where id = $1`, [job.id]);
      result.succeeded += 1;
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      if (attempts >= job.max_attempts) {
        await q(
          `update jobs set status = 'failed', attempts = $2, last_error = $3, updated_at = now() where id = $1`,
          [job.id, attempts, message],
        );
        result.failed += 1;
        console.error(`[jobs] ${job.job_type} (${job.id}) permanently failed after ${attempts} attempts: ${message}`);
      } else {
        const delayMs = backoffMs(attempts);
        await q(
          `update jobs
              set status = 'pending', attempts = $2, last_error = $3,
                  run_after = now() + ($4 || ' milliseconds')::interval,
                  locked_by = null, locked_at = null, updated_at = now()
            where id = $1`,
          [job.id, attempts, message, String(delayMs)],
        );
        result.retried += 1;
      }
    }
  }

  return result;
}
