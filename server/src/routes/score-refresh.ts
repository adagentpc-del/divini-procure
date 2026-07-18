/**
 * Divini Procure - manual score refresh trigger.
 *
 * Mounted under /api in routes.ts (self-pathing), so the full path is:
 *   POST /api/scores/refresh   { companyId }   recompute + persist (member)
 *
 * There is currently no server-side review-insert path in this codebase
 * (reviews are only read, in lib/procure-moat.ts and routes/intel.ts), so
 * this endpoint is the wiring point for "feedback -> score refresh": once a
 * review/rating write path exists it should call refreshCompanyScores(rateeId)
 * directly; until then a client (or that future write path) can POST here for
 * the ratee company to force a fresh Divini Score + Business Health snapshot.
 *
 * The recompute is best-effort and non-blocking inside refreshCompanyScores:
 * it never throws, so this endpoint always returns 202 once membership passes.
 * Mirrors the existing route conventions: getAuth, requireUser, the h() async
 * wrapper, q1 membership check, ForbiddenError. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError } from "../db.js";
import { q1 } from "../pool.js";
import { refreshCompanyScores } from "../lib/score-refresh.js";
import { scoreRefreshRateLimit } from "../lib/rateLimit.js";

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
// Force a fresh Divini Score + Business Health snapshot for a company.
// Fire-and-forget: returns 202 immediately, recompute runs best-effort.
// ---------------------------------------------------------------------------
router.post(
  "/scores/refresh",
  requireUser,
  scoreRefreshRateLimit,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(body.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await requireMember(auth.userId!, auth.isAdmin, companyId);
    // Non-blocking: do not await, do not let a recompute failure affect the response.
    void refreshCompanyScores(companyId);
    res.status(202).json({ ok: true, companyId });
  }),
);

export default router;
