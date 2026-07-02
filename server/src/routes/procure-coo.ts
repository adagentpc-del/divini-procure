/**
 * Divini Procure - AI COO + Business Health + Command Center routes.
 *
 * Mounted under /api in routes.ts (self-pathing), so the full paths are:
 *   GET   /api/coo/briefing?companyId=        daily executive briefing (member)
 *   GET   /api/coo/tasks?companyId=           ranked task feed, recomputed (member)
 *   PATCH /api/coo/tasks/:id                  { companyId, status } set disposition
 *   GET   /api/business-health?companyId=     compute + store + return health (member)
 *   POST  /api/command-center                 { companyId, question } -> answer
 *   GET   /api/admin/coo/overview             portfolio rollup (admin only)
 *
 * DETERMINISTIC: every payload is computed in lib/procure-coo.ts from live data;
 * no external LLM is called. Member endpoints assert company_members membership
 * (ForbiddenError -> 403) so a caller only ever sees its own company's material.
 * Mirrors the existing route conventions: getAuth, the h() async wrapper, q1
 * membership check, ForbiddenError. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError } from "../db.js";
import { q1 } from "../pool.js";
import {
  businessHealth,
  cooTasks,
  setCooTaskStatus,
  dailyBriefing,
  commandCenter,
  adminCooOverview,
} from "../lib/procure-coo.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Assert the signed-in user is a member of the company (admins bypass). */
async function requireMember(userId: string, isAdmin: boolean, companyId: string): Promise<void> {
  if (isAdmin) return;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  if (!row) throw new ForbiddenError("not a member of this company");
}

const router = Router();

// ---------------------------------------------------------------------------
// Daily executive briefing
// ---------------------------------------------------------------------------
router.get(
  "/coo/briefing",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    res.json({ briefing: await dailyBriefing(companyId) });
  }),
);

// ---------------------------------------------------------------------------
// COO task feed (recompute then return)
// ---------------------------------------------------------------------------
router.get(
  "/coo/tasks",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    res.json({ tasks: await cooTasks(companyId) });
  }),
);

router.patch(
  "/coo/tasks/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(body.companyId || "");
    const status = String(body.status || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!["open", "in_progress", "done", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "status must be open | in_progress | done | dismissed" });
    }
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    const task = await setCooTaskStatus(companyId, req.params.id, status);
    if (!task) return res.status(404).json({ error: "task not found" });
    res.json({ task });
  }),
);

// ---------------------------------------------------------------------------
// Business health (compute + store + return)
// ---------------------------------------------------------------------------
router.get(
  "/business-health",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    res.json(await businessHealth(companyId));
  }),
);

// ---------------------------------------------------------------------------
// Command center (deterministic canned Q&A)
// ---------------------------------------------------------------------------
router.post(
  "/command-center",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(body.companyId || "");
    const question = String(body.question || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!question) return res.status(400).json({ error: "question required" });
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    res.json(await commandCenter(companyId, question));
  }),
);

// ===========================================================================
// ADMIN: portfolio rollup across all companies
// ===========================================================================
router.get(
  "/admin/coo/overview",
  requireAdmin,
  h(async (_req, res) => {
    res.json(await adminCooOverview());
  }),
);

export default router;
