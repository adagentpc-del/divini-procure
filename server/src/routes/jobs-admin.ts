/**
 * Admin surface for the background job queue (db/schema-jobs.sql,
 * lib/jobs.ts). Mirrors routes/follow-up.ts's POST /follow-up/process-due
 * pattern: same job-processing function the setInterval poller in
 * index.ts calls, exposed for on-demand triggering (testing, or an
 * external cron in an environment that prefers that to an in-process
 * interval) and for basic observability into what is stuck/failed.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../auth.js";
import { q } from "../pool.js";
import { processDueJobs } from "../lib/jobs.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.post(
  "/admin/jobs/process-due",
  requireAdmin,
  h(async (_req, res) => {
    const result = await processDueJobs();
    res.json(result);
  }),
);

// GET /admin/jobs?status=failed - basic observability, not a full admin UI.
router.get(
  "/admin/jobs",
  requireAdmin,
  h(async (req, res) => {
    const status = (req.query.status as string) || "";
    const params: unknown[] = [];
    let where = "";
    if (status) {
      params.push(status);
      where = "where status = $1";
    }
    const rows = await q<any>(
      `select id, job_type, status, attempts, max_attempts, run_after, last_error, created_at, updated_at
         from jobs
         ${where}
        order by created_at desc
        limit 200`,
      params,
    );
    res.json({ jobs: rows });
  }),
);

export default router;
