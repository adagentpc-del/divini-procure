/**
 * Project Health Score
 * Self-pathed under /project-health.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function getCompanyId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await q1<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

// GET /project-health
router.get(
  "/project-health",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const companyId = await getCompanyId(userId);
    const snapshots = await q<any>(
      `SELECT DISTINCT ON (phs.building_id)
              phs.*,
              b.name AS building_name
         FROM project_health_snapshots phs
         JOIN buildings b ON b.id = phs.building_id
        WHERE b.company_id = $1
        ORDER BY phs.building_id, phs.computed_at DESC`,
      [companyId],
    );
    res.json({ snapshots });
  }),
);

// GET /project-health/:buildingId
router.get(
  "/project-health/:buildingId",
  requireUser,
  h(async (req, res) => {
    const snapshot = await q1<any>(
      `SELECT phs.*
         FROM project_health_snapshots phs
        WHERE phs.building_id = $1
        ORDER BY phs.computed_at DESC
        LIMIT 1`,
      [req.params.buildingId],
    );
    res.json({ snapshot: snapshot ?? null });
  }),
);

// POST /project-health/:buildingId/compute
router.post(
  "/project-health/:buildingId/compute",
  requireUser,
  h(async (req, res) => {
    const { buildingId } = req.params;

    const pkgCount = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM packages WHERE building_id = $1`,
      [buildingId],
    );
    const bidCount = await q1<{ cnt: string }>(
      `SELECT COUNT(DISTINCT package_id) AS cnt FROM bids WHERE package_id IN (SELECT id FROM packages WHERE building_id = $1)`,
      [buildingId],
    );
    const budgetScore =
      Number(pkgCount?.cnt) > 0
        ? Math.min(25, Math.round((Number(bidCount?.cnt) / Math.max(Number(pkgCount?.cnt), 1)) * 25))
        : 10;

    const awardedCount = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM packages WHERE building_id = $1 AND status = $2`,
      [buildingId, "awarded"],
    );
    const scheduleScore =
      Number(pkgCount?.cnt) > 0
        ? Math.min(25, Math.round((Number(awardedCount?.cnt) / Math.max(Number(pkgCount?.cnt), 1)) * 25))
        : 5;

    const verifiedVendors = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM bids b
         JOIN vendor_profiles vp ON vp.company_id = b.company_id
         JOIN packages p ON p.id = b.package_id
        WHERE p.building_id = $1
          AND p.status = 'awarded'
          AND b.status = 'awarded'
          AND vp.verify_status IN ('approved','verified','ai-verified')`,
      [buildingId],
    );
    const totalAwardedVendors = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM bids b
         JOIN packages p ON p.id = b.package_id
        WHERE p.building_id = $1
          AND p.status = 'awarded'
          AND b.status = 'awarded'`,
      [buildingId],
    );
    const vendorScore =
      Number(totalAwardedVendors?.cnt) > 0
        ? Math.min(25, Math.round((Number(verifiedVendors?.cnt) / Math.max(Number(totalAwardedVendors?.cnt), 1)) * 25))
        : 10;

    const docCount = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM documents WHERE building_id = $1`,
      [buildingId],
    );
    const documentationScore = Math.min(25, Math.round((Math.min(Number(docCount?.cnt), 5) / 5) * 25));

    const score = budgetScore + scheduleScore + vendorScore + documentationScore;
    const color = score >= 80 ? "green" : score >= 60 ? "amber" : "red";

    const snapshot = await q1<any>(
      `INSERT INTO project_health_snapshots
         (building_id, score, budget_score, schedule_score, vendor_score, documentation_score, score_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        buildingId,
        score,
        budgetScore,
        scheduleScore,
        vendorScore,
        documentationScore,
        JSON.stringify({ color }),
      ],
    );

    res.json({
      snapshot: {
        score,
        budgetScore,
        scheduleScore,
        vendorScore,
        documentationScore,
        color,
        computedAt: snapshot?.computed_at,
      },
    });
  }),
);

export default router;
