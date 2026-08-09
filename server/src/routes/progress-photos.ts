/**
 * Progress Photos
 * Self-pathed under /progress-photos.
 *
 * Authorization (Phase 0 fix - previously POST/PATCH/GET had none at all,
 * trusting a client-supplied buildingId): mirrors the established
 * assertCanAccessPackage() pattern already used by delivery.ts/submittals.ts,
 * lifted to the building level since photos are building-scoped rather than
 * package-scoped -
 *   - the building owner (a member of the company that owns the building)
 *   - OR an assigned vendor (a member of a company with a bid on ANY package
 *     under that building)
 *   - OR a super-admin (ADMIN_ALLOWED_EMAILS, via getAuth().isAdmin)
 * View/create both require this check. Edit/delete are further restricted to
 * the original uploader's company (or admin) - matching the DELETE route's
 * pre-existing, correct check - so a building owner cannot silently alter a
 * vendor's own photo caption/investor-visibility and vice versa.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";

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

/**
 * Authorize a user against a building: the building owner, an assigned
 * vendor (member of a company with a bid on any package under this
 * building), or a super-admin. Throws NotFoundError when the building does
 * not exist, ForbiddenError otherwise.
 */
async function assertCanAccessBuilding(req: Request, buildingId: string): Promise<void> {
  const auth = getAuth(req);
  const building = await q1<{ id: string }>(`select id from buildings where id = $1`, [
    buildingId,
  ]);
  if (!building) throw new NotFoundError("building not found");
  if (auth.isAdmin) return;

  const owned = await q1(
    `select 1 from buildings b
       join company_members cm on cm.company_id = b.company_id
      where b.id = $1 and cm.user_id = $2`,
    [buildingId, auth.userId],
  );
  if (owned) return;

  const vendor = await q1(
    `select 1 from bids bd
       join packages p on p.id = bd.package_id
       join company_members cm on cm.company_id = bd.vendor_company_id
      where p.building_id = $1 and cm.user_id = $2`,
    [buildingId, auth.userId],
  );
  if (vendor) return;

  throw new ForbiddenError("not the owner or an assigned vendor of this building");
}

// GET /progress-photos
router.get(
  "/progress-photos",
  requireUser,
  h(async (req, res) => {
    const { buildingId, phase, investorView } = req.query as Record<string, string>;
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await assertCanAccessBuilding(req, buildingId);

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
    const {
      buildingId,
      storagePath,
      caption,
      phase,
      takenAt,
      isMilestone,
      visibleToInvestors,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!buildingId || typeof buildingId !== "string" || !storagePath) {
      return res.status(400).json({ error: "buildingId and storagePath required" });
    }
    await assertCanAccessBuilding(req, buildingId);
    const companyId = await getCompanyId(userId);

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
