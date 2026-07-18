/**
 * Investor Watchlist + Deal Alerts
 * Self-pathed under /watchlist.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// GET /watchlist/matches — declare BEFORE /:id
router.get(
  "/watchlist/matches",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const items = await q<any>(
      `SELECT * FROM investor_watchlist WHERE user_id = $1`,
      [userId],
    );
    if (!items.length) return res.json({ matches: [] });

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      for (const item of items) {
        const sub: string[] = [];
        if (item.asset_class) {
          params.push(item.asset_class);
          sub.push(`LOWER(ip.asset_class) = LOWER($${params.length})`);
        }
        if (item.location) {
          params.push(`%${item.location}%`);
          sub.push(`(b.city ILIKE $${params.length} OR b.address ILIKE $${params.length})`);
        }
        if (item.min_target_return != null) {
          params.push(item.min_target_return);
          sub.push(`ip.preferred_return >= $${params.length}`);
        }
        if (item.max_min_investment_cents != null) {
          params.push(item.max_min_investment_cents);
          sub.push(`ip.minimum_investment_cents <= $${params.length}`);
        }
        if (sub.length) conditions.push(`(${sub.join(" AND ")})`);
      }

      const whereClause = conditions.length ? `AND (${conditions.join(" OR ")})` : "";

      const matches = await q<any>(
        `SELECT ip.id,
                ip.name,
                c.name AS developer_name,
                ip.asset_class,
                b.city AS location,
                ip.preferred_return,
                ip.minimum_investment_cents
           FROM investment_programs ip
           JOIN buildings b ON b.id = ip.building_id
           JOIN companies c ON c.id = ip.company_id
          WHERE ip.status = 'active'
          ${whereClause}
          LIMIT 20`,
        params,
      );
      res.json({ matches });
    } catch {
      res.json({ matches: [] });
    }
  }),
);

// GET /watchlist  (#62: paginated via ?limit=&offset= to avoid unbounded result sets)
router.get(
  "/watchlist",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const items = await q<any>(
      `SELECT * FROM investor_watchlist WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const countRow = await q1<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM investor_watchlist WHERE user_id = $1`,
      [userId],
    );
    res.json({ items, total: countRow?.n ?? 0, limit, offset });
  }),
);

// POST /watchlist
router.post(
  "/watchlist",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const {
      assetClass,
      location,
      minTargetReturn,
      maxMinInvestmentCents,
      investorType,
      label,
      notifyEmail,
    } = (req.body ?? {}) as Record<string, unknown>;

    const item = await q1<any>(
      `INSERT INTO investor_watchlist
         (user_id, asset_class, location, min_target_return, max_min_investment_cents, investor_type, label, notify_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        assetClass ?? null,
        location ?? null,
        minTargetReturn ?? null,
        maxMinInvestmentCents ?? null,
        investorType ?? null,
        label ?? null,
        notifyEmail !== false,
      ],
    );
    res.json({ item });
  }),
);

// DELETE /watchlist/:id
router.delete(
  "/watchlist/:id",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const row = await q1<any>(
      `DELETE FROM investor_watchlist WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, userId],
    );
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  }),
);

export default router;
