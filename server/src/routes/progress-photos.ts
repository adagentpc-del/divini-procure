/**
 * Progress Photos
 * Self-pathed under /progress-photos.
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

// GET /progress-photos
router.get(
  "/progress-photos",
  requireUser,
  h(async (req, res) => {
    const { buildingId, phase, investorView } = req.query as Record<string, string>;
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });

    const params: unknown[] = [buildingId];
    const conditions: string[] = ["pp.building_id = $1"];

    if (phase && phase !== "all") {
      params.push(phase);
      conditions.push(`pp.phase = $${params.length}`);
    }
    if (investorView === "true") {
      conditions.push("pp.visible_to_investors = true");
    }

    const photos = await q<any>(
      `SELECT pp.*
         FROM progress_photos pp
        WHERE ${conditions.join(" AND ")}
        ORDER BY pp.taken_at DESC NULLS LAST, pp.created_at DESC`,
      params,
    );
    res.json({ photos });
  }),
);

// POST /progress-photos
router.post(
  "/progress-photos",
  requireUser,
  h(async (req, res) => {
    const { userId, email } = getAuth(req);
    const companyId = await getCompanyId(userId);
    const {
      buildingId,
      storagePath,
      caption,
      phase,
      takenAt,
      isMilestone,
      visibleToInvestors,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!buildingId || !storagePath) {
      return res.status(400).json({ error: "buildingId and storagePath required" });
    }

    const photo = await q1<any>(
      `INSERT INTO progress_photos
         (building_id, uploaded_by_company_id, uploaded_by_email, storage_path, caption, phase, taken_at, is_milestone, visible_to_investors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        buildingId,
        companyId,
        email,
        storagePath,
        caption ?? null,
        phase ?? null,
        takenAt ?? null,
        isMilestone === true,
        visibleToInvestors === true,
      ],
    );
    res.json({ photo });
  }),
);

// PATCH /progress-photos/:id
router.patch(
  "/progress-photos/:id",
  requireUser,
  h(async (req, res) => {
    const { caption, phase, isMilestone, visibleToInvestors, takenAt } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (caption !== undefined) add("caption", caption ?? null);
    if (phase !== undefined) add("phase", phase ?? null);
    if (isMilestone !== undefined) add("is_milestone", Boolean(isMilestone));
    if (visibleToInvestors !== undefined) add("visible_to_investors", Boolean(visibleToInvestors));
    if (takenAt !== undefined) add("taken_at", takenAt ?? null);

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    params.push(req.params.id);
    const photo = await q1<any>(
      `UPDATE progress_photos SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!photo) return res.status(404).json({ error: "not found" });
    res.json({ photo });
  }),
);

// DELETE /progress-photos/:id
router.delete(
  "/progress-photos/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, isAdmin } = getAuth(req);
    const companyId = await getCompanyId(userId);
    const existing = await q1<any>(
      `SELECT id, uploaded_by_company_id FROM progress_photos WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!isAdmin && existing.uploaded_by_company_id !== companyId) {
      return res.status(403).json({ error: "forbidden" });
    }
    await q1<any>(`DELETE FROM progress_photos WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

export default router;
