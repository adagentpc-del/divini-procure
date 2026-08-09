/**
 * Project Health Score
 * Self-pathed under /project-health.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { computeProjectFinancialSummary } from "../lib/financial-summary.js";
import type { BudgetHealth } from "../lib/financial-model.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function getCompanyId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await q1<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
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

    // Phase 1 P1-16: `budget_score` now finally represents actual budget
    // health, using the real project financial rollup (lib/financial-
    // summary.ts) - deterministic, transparent rules over real numbers
    // (forecast vs. current budget, contingency remaining, package
    // overages), never a predictive model. Before Phase 1 this column held
    // a bid-PARTICIPATION-rate proxy (Phase 0 honesty pass: correctly
    // relabeled on the frontend, but never a real financial calculation,
    // because no project/package budget rollup existed yet). That proxy is
    // superseded now that one does.
    const financialSummary = await computeProjectFinancialSummary(buildingId);
    const budgetHealth: BudgetHealth = financialSummary?.budgetHealth ?? "unbudgeted";
    const BUDGET_HEALTH_SCORE: Record<BudgetHealth, number> = {
      healthy: 25,
      at_risk: 15,
      over_budget: 5,
      unbudgeted: 10,
    };
    const budgetScore = BUDGET_HEALTH_SCORE[budgetHealth];

    const pkgCount = await q1<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM packages WHERE building_id = $1`,
      [buildingId],
    );
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
         JOIN vendor_profiles vp ON vp.company_id = b.vendor_company_id
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
        JSON.stringify({
          color,
          budgetHealth,
          forecastAtCompletionCents: financialSummary?.forecastAtCompletionCents ?? null,
          budgetCurrentCents: financialSummary?.budgetCurrentCents ?? null,
          varianceCents: financialSummary?.varianceCents ?? null,
        }),
      ],
    );

    res.json({
      snapshot: {
        score,
        budgetScore,
        budgetHealth,
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
