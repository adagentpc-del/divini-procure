/**
 * Divini Procure - PLATFORM REVENUE LEDGER admin routes.
 *
 * Self-pathed under /api (mounted with router.use(revenueRouter), no prefix),
 * so the full paths are /api/admin/revenue/... All endpoints are super-admin
 * only. This is the admin view of the accrual ledger that monetization.ts
 * writes: list rows, see accrued-vs-collected totals, and MANUALLY mark a row
 * invoiced / collected / waived / void.
 *
 * IMPORTANT: marking a row 'collected' is a bookkeeping action only. It records
 * that Divini received the money out of band; it NEVER charges a card or moves
 * money through any processor. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { enqueueSplitsForRevenue } from "../lib/split-engine.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// Everything here is super-admin only.
router.use("/admin/revenue", requireAdmin);

const STATUSES = new Set(["accrued", "invoiced", "collected", "waived", "void"]);

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// GET /admin/revenue/summary -> dashboard tile totals.
//   Declared before /:id so "summary" is not captured as an id.
// ---------------------------------------------------------------------------
router.get(
  "/admin/revenue/summary",
  h(async (_req, res) => {
    const t = await q1<{ accrued: string; collected: string; cnt: string }>(
      `select coalesce(sum(fee_cents) filter (where status in ('accrued','invoiced')),0) as accrued,
              coalesce(sum(fee_cents) filter (where status = 'collected'),0)             as collected,
              count(*)                                                                   as cnt
         from platform_revenue`,
    );
    res.json({
      accruedCents: num(t?.accrued),
      collectedCents: num(t?.collected),
      count: num(t?.cnt),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/revenue?status=  -> ledger rows + totals (with company names).
// ---------------------------------------------------------------------------
router.get(
  "/admin/revenue",
  h(async (req, res) => {
    const status = (req.query.status as string) || "";
    const params: unknown[] = [];
    let where = "";
    if (status && STATUSES.has(status)) {
      params.push(status);
      where = `where r.status = $1`;
    }
    const rows = await q<any>(
      `select r.*,
              d.name as developer_name,
              v.name as vendor_name
         from platform_revenue r
         left join companies d on d.id = r.developer_company_id
         left join companies v on v.id = r.vendor_company_id
         ${where}
        order by r.created_at desc
        limit 1000`,
      params,
    );
    const t = await q1<{ accrued: string; collected: string }>(
      `select coalesce(sum(fee_cents) filter (where status in ('accrued','invoiced')),0) as accrued,
              coalesce(sum(fee_cents) filter (where status = 'collected'),0)             as collected
         from platform_revenue`,
    );
    res.json({
      rows,
      totals: {
        accruedCents: num(t?.accrued),
        collectedCents: num(t?.collected),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /admin/revenue/:id { status, notes }
//   The manual "mark collected" step. Moving to 'collected' stamps collected_at;
//   moving away from 'collected' clears it. This is bookkeeping ONLY; it never
//   charges a card or moves money.
// ---------------------------------------------------------------------------
router.patch(
  "/admin/revenue/:id",
  h(async (req, res) => {
    const { status, notes } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (status !== undefined) {
      if (!STATUSES.has(String(status))) {
        return res.status(400).json({ error: "invalid status" });
      }
      add("status", String(status));
      // Stamp / clear collected_at to match the status.
      sets.push(
        String(status) === "collected"
          ? `collected_at = coalesce(collected_at, now())`
          : `collected_at = null`,
      );
    }
    if (notes !== undefined) {
      add("notes", notes === "" ? null : String(notes));
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    const row = await q1<any>(
      `update platform_revenue set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!row) return res.status(404).json({ error: "revenue row not found" });
    // When a fee is marked collected, queue each party's agreed split into the
    // payout rail (idempotent, best-effort; never moves money on its own).
    if (String(status) === "collected" && row?.id) {
      void enqueueSplitsForRevenue(row.id, getAuth(req).email);
    }
    res.json({ revenue: row });
  }),
);

// ---------------------------------------------------------------------------
// GET /me/success-fees -> vendor-facing fee summary for the authenticated company.
// ---------------------------------------------------------------------------
router.get(
  "/me/success-fees",
  requireUser,
  h(async (req, res) => {
    const { companyId } = getAuth(req);
    if (!companyId) {
      return res.json({ owedCents: 0, paidCents: 0, count: 0 });
    }
    const row = await q1<{ owed_cents: string; paid_cents: string; cnt: string }>(
      `SELECT
         COALESCE(SUM(fee_cents) FILTER (WHERE status IN ('accrued','invoiced')), 0) AS owed_cents,
         COALESCE(SUM(fee_cents) FILTER (WHERE status = 'collected'), 0)             AS paid_cents,
         COUNT(*)                                                                     AS cnt
       FROM platform_revenue
       WHERE vendor_company_id = $1`,
      [companyId],
    );
    res.json({
      owedCents: num(row?.owed_cents),
      paidCents: num(row?.paid_cents),
      count: num(row?.cnt),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/monetization-summary -> platform-wide monetization dashboard tile.
// ---------------------------------------------------------------------------
router.get(
  "/admin/monetization-summary",
  requireAdmin,
  h(async (_req, res) => {
    const feeRow = await q1<{ total: string }>(
      `SELECT COALESCE(SUM(fee_cents), 0) AS total
         FROM platform_revenue
        WHERE source_type = 'procurement_fee'`,
    );

    let proSubscribers = 0;
    let proMrrCents = 0;
    try {
      const subRow = await q1<{ cnt: string; mrr: string }>(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cents), 0) AS mrr
           FROM subscriptions
          WHERE status = 'active' AND plan_key ILIKE '%pro%'`,
      );
      proSubscribers = num(subRow?.cnt);
      proMrrCents = num(subRow?.mrr);
    } catch {
      // subscriptions table may not exist yet
    }

    const verRow = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM vendor_credentials
        WHERE doc_status = 'pending'`,
    );

    res.json({
      successFeeTotalCents: num(feeRow?.total),
      proMrrCents,
      proSubscribers,
      verificationQueueCount: num(verRow?.cnt),
    });
  }),
);

export default router;
