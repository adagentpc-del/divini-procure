/**
 * Intelligence Moat routes for Divini Procure. Mounted under /api.
 *
 * Three deterministic moat surfaces mapped to the procurement domain:
 *   - Divini Score  : per-company 0..100 reputation/health score + breakdown.
 *   - War Room      : per-project / per-portfolio ranked health flags.
 *   - Relationship  : company-to-company graph (nodes + edges).
 *
 * Authorization: every member-facing read is scoped to a company the caller
 * belongs to (company_members) OR the caller is an admin. Admin-only endpoints
 * use requireAdmin. The rebuild + leaderboard are admin-only.
 *
 * Endpoints:
 *   GET  /divini-score/:companyId              (member of company, or admin)
 *   GET  /war-room?projectId=                  (member of the project's company)
 *   GET  /war-room?companyId=                  (member of company)
 *   GET  /relationship/graph?companyId=        (member of company, or admin)
 *   POST /admin/relationship-edges/rebuild     (admin)
 *   GET  /admin/divini-scores                  (admin)
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q1 } from "../pool.js";
import {
  diviniScore,
  listScores,
  buildRelationshipEdges,
  relationshipGraph,
  warRoom,
  portfolioWarRoom,
} from "../lib/procure-moat.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** Throw ForbiddenError unless the caller is an admin or a member of companyId. */
async function assertMember(req: Request, companyId: string): Promise<void> {
  const auth = getAuth(req);
  if (auth.isAdmin) return;
  const ok = await q1("select 1 from company_members where user_id = $1 and company_id = $2", [
    auth.userId,
    companyId,
  ]);
  if (!ok) throw new ForbiddenError("not a member of this company");
}

// ---------------------------------------------------------------------------
// GET /divini-score/:companyId  -> compute + persist + return
// ---------------------------------------------------------------------------
router.get(
  "/divini-score/:companyId",
  requireUser,
  h(async (req, res) => {
    const companyId = req.params.companyId;
    await assertMember(req, companyId);
    const result = await diviniScore(companyId);
    if (!result) throw new NotFoundError("company not found");
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /war-room?projectId=  (one project)  OR  ?companyId=  (portfolio)
// ---------------------------------------------------------------------------
router.get(
  "/war-room",
  requireUser,
  h(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const companyId = req.query.companyId ? String(req.query.companyId) : "";

    if (projectId) {
      // Resolve the owning company, then assert membership against it.
      const owner = await q1<{ company_id: string | null }>(
        "select company_id from buildings where id = $1",
        [projectId],
      );
      if (!owner) throw new NotFoundError("project not found");
      if (!owner.company_id) throw new ForbiddenError("project has no owner");
      await assertMember(req, owner.company_id);
      const room = await warRoom(projectId);
      if (!room) throw new NotFoundError("project not found");
      return res.json({ scope: "project", ...room });
    }

    if (companyId) {
      await assertMember(req, companyId);
      const room = await portfolioWarRoom(companyId);
      return res.json({ scope: "portfolio", ...room });
    }

    return res.status(400).json({ error: "projectId or companyId required" });
  }),
);

// ---------------------------------------------------------------------------
// GET /relationship/graph?companyId=
// ---------------------------------------------------------------------------
router.get(
  "/relationship/graph",
  requireUser,
  h(async (req, res) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : "";
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(req, companyId);
    const graph = await relationshipGraph(companyId);
    if (!graph) throw new NotFoundError("company not found");
    res.json(graph);
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/relationship-edges/rebuild  (admin)
// ---------------------------------------------------------------------------
router.post(
  "/admin/relationship-edges/rebuild",
  requireAdmin,
  h(async (_req, res) => {
    const count = await buildRelationshipEdges();
    res.json({ ok: true, edges: count });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/divini-scores  (admin leaderboard)
// ---------------------------------------------------------------------------
router.get(
  "/admin/divini-scores",
  requireAdmin,
  h(async (req, res) => {
    const entityKind = req.query.entityKind ? String(req.query.entityKind) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ scores: await listScores(entityKind, limit) });
  }),
);

export default router;
