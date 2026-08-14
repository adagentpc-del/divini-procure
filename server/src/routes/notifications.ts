/**
 * In-app notifications: read + mark-read.
 *
 * The `notifications` table (db/schema.sql) has been written to since
 * early in this project (routes/follow-up.ts, routes/blueprint.ts, and now
 * lib/notify.ts's award/bid-invite fan-out - see those files), but until
 * this route existed nothing ever READ it back: no GET, no mark-read, no
 * frontend surface. This is the minimal real read/mark-read workflow
 * Phase 0 calls for - not a new notification architecture, just exposing
 * the existing table. RLS (db/schema-notifications-rls.sql) is the actual
 * tenant boundary here (own row only, or admin); the WHERE clauses below
 * are redundant with it by design, matching this codebase's established
 * defense-in-depth pattern elsewhere.
 *
 * No frontend UI is wired to these endpoints in this pass - deliberately
 * out of Phase 0 scope (see item 27's "no feature creep" list; a bell
 * icon / notification center is a real but separate piece of work). The
 * backend contract is real and tested; documented as pending frontend
 * work in the Phase 0 completion report.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// GET /notifications?unreadOnly=true&limit=50
router.get(
  "/notifications",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const unreadOnly = String(req.query.unreadOnly || "") === "true";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const rows = await q<any>(
      `select * from notifications
        where user_id = $1 ${unreadOnly ? "and read = false" : ""}
        order by created_at desc
        limit $2`,
      [userId, limit],
    );
    const unreadCount = await q1<{ n: string }>(
      `select count(*) as n from notifications where user_id = $1 and read = false`,
      [userId],
    );
    res.json({ notifications: rows, unreadCount: Number(unreadCount?.n ?? 0) });
  }),
);

// PATCH /notifications/:id/read
router.patch(
  "/notifications/:id/read",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const row = await q1<any>(
      `update notifications set read = true where id = $1 and user_id = $2 returning *`,
      [req.params.id, userId],
    );
    if (!row) return res.status(404).json({ error: "notification not found" });
    res.json({ notification: row });
  }),
);

// POST /notifications/read-all
router.post(
  "/notifications/read-all",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const rows = await q<{ id: string }>(
      `update notifications set read = true where user_id = $1 and read = false returning id`,
      [userId],
    );
    res.json({ ok: true, updated: rows.length });
  }),
);

export default router;
