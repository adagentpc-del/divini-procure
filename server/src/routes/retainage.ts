/**
 * Divini Procure - Retainage Tracking and Lien Waiver routes.
 *
 * Self-pathed under /api (mounted with router.use(retainageRouter), no prefix).
 * Handles retainage records and lien waiver workflows between vendors and developers.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// GET /retainage — list retainage records with optional filters
// ---------------------------------------------------------------------------
router.get(
  "/retainage",
  requireUser,
  h(async (req, res) => {
    const { companyId, isAdmin } = getAuth(req);
    const { buildingId, vendorCompanyId, developerCompanyId } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    const add = (clause: string, val: unknown) => {
      params.push(val);
      conditions.push(`${clause} = $${params.length}`);
    };

    if (buildingId) add("r.building_id", buildingId);
    if (vendorCompanyId) add("r.vendor_company_id", vendorCompanyId);
    if (developerCompanyId) add("r.developer_company_id", developerCompanyId);

    // Authorization: must be in vendor or developer company, or admin
    if (!isAdmin) {
      params.push(companyId);
      conditions.push(`(r.vendor_company_id = $${params.length} OR r.developer_company_id = $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const records = await q<any>(
      `SELECT r.*,
              vc.name AS vendor_name,
              dc.name AS developer_name
         FROM retainage_records r
         LEFT JOIN companies vc ON vc.id = r.vendor_company_id
         LEFT JOIN companies dc ON dc.id = r.developer_company_id
         ${where}
         ORDER BY r.created_at DESC
         LIMIT 500`,
      params,
    );

    const summary = {
      totalHeldCents: records.reduce((sum: number, r: any) => sum + num(r.retainage_held_cents), 0),
      totalReleasedCents: records.reduce((sum: number, r: any) => sum + num(r.retainage_released_cents), 0),
      count: records.length,
    };

    res.json({ records, summary });
  }),
);

// ---------------------------------------------------------------------------
// POST /retainage — create a new retainage record
// ---------------------------------------------------------------------------
router.post(
  "/retainage",
  requireUser,
  h(async (req, res) => {
    const {
      buildingId,
      packageId,
      vendorCompanyId,
      developerCompanyId,
      contractAmountCents,
      retainagePct,
      releaseTrigger,
      milestoneRequired,
      notes,
    } = req.body ?? {};

    if (!buildingId || !vendorCompanyId || !developerCompanyId || contractAmountCents == null || retainagePct == null) {
      return res.status(400).json({ error: "buildingId, vendorCompanyId, developerCompanyId, contractAmountCents, retainagePct are required" });
    }

    const retainageHeldCents = Math.round(Number(contractAmountCents) * Number(retainagePct) / 100);

    const record = await q1<any>(
      `INSERT INTO retainage_records
         (building_id, package_id, vendor_company_id, developer_company_id,
          contract_amount_cents, retainage_pct, retainage_held_cents,
          release_trigger, milestone_required, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'holding')
       RETURNING *`,
      [
        buildingId,
        packageId ?? null,
        vendorCompanyId,
        developerCompanyId,
        contractAmountCents,
        retainagePct,
        retainageHeldCents,
        releaseTrigger ?? null,
        milestoneRequired ?? null,
        notes ?? null,
      ],
    );

    res.status(201).json({ record });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /retainage/:id — update a retainage record
// ---------------------------------------------------------------------------
router.patch(
  "/retainage/:id",
  requireUser,
  h(async (req, res) => {
    const { companyId, email, isAdmin } = getAuth(req);

    const existing = await q1<any>(
      `SELECT * FROM retainage_records WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "retainage record not found" });

    if (!isAdmin && companyId !== existing.vendor_company_id && companyId !== existing.developer_company_id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const { action, releasedCents, notes, milestoneRequired, releaseTrigger } = req.body ?? {};

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (action === "request_release") {
      sets.push(`release_requested_at = now()`);
    } else if (action === "approve_release") {
      if (!isAdmin && companyId !== existing.developer_company_id) {
        return res.status(403).json({ error: "only developer company or admin can approve release" });
      }
      if (releasedCents == null) {
        return res.status(400).json({ error: "releasedCents is required for approve_release" });
      }
      const released = Number(releasedCents);
      const newStatus = released >= num(existing.retainage_held_cents) ? "fully_released" : "partial_release";
      sets.push(`release_approved_at = now()`);
      add("release_approved_by", email);
      add("retainage_released_cents", released);
      add("status", newStatus);
    } else {
      if (notes !== undefined) add("notes", notes === "" ? null : String(notes));
      if (milestoneRequired !== undefined) add("milestone_required", milestoneRequired === "" ? null : String(milestoneRequired));
      if (releaseTrigger !== undefined) add("release_trigger", releaseTrigger === "" ? null : String(releaseTrigger));
    }

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const record = await q1<any>(
      `UPDATE retainage_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    res.json({ record });
  }),
);

// ---------------------------------------------------------------------------
// GET /lien-waivers — list lien waivers
// ---------------------------------------------------------------------------
router.get(
  "/lien-waivers",
  requireUser,
  h(async (req, res) => {
    const { companyId, isAdmin } = getAuth(req);
    const { buildingId, vendorCompanyId } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      params.push(val);
      conditions.push(`${clause} = $${params.length}`);
    };

    if (buildingId) add("w.building_id", buildingId);
    if (vendorCompanyId) add("w.vendor_company_id", vendorCompanyId);

    if (!isAdmin) {
      params.push(companyId);
      conditions.push(`(w.vendor_company_id = $${params.length} OR w.developer_company_id = $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const waivers = await q<any>(
      `SELECT w.*,
              vc.name AS vendor_name,
              dc.name AS developer_name
         FROM lien_waivers w
         LEFT JOIN companies vc ON vc.id = w.vendor_company_id
         LEFT JOIN companies dc ON dc.id = w.developer_company_id
         ${where}
         ORDER BY w.created_at DESC
         LIMIT 500`,
      params,
    );

    res.json({ waivers });
  }),
);

// ---------------------------------------------------------------------------
// POST /lien-waivers — create a new lien waiver
// ---------------------------------------------------------------------------
router.post(
  "/lien-waivers",
  requireUser,
  h(async (req, res) => {
    const { email } = getAuth(req);
    const {
      buildingId,
      retainageId,
      vendorCompanyId,
      developerCompanyId,
      waiverType,
      throughDate,
      paymentAmountCents,
      notes,
    } = req.body ?? {};

    if (!buildingId || !vendorCompanyId || !developerCompanyId || !waiverType) {
      return res.status(400).json({ error: "buildingId, vendorCompanyId, developerCompanyId, waiverType are required" });
    }

    const waiver = await q1<any>(
      `INSERT INTO lien_waivers
         (building_id, retainage_id, vendor_company_id, developer_company_id,
          waiver_type, through_date, payment_amount_cents, requested_by, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'requested')
       RETURNING *`,
      [
        buildingId,
        retainageId ?? null,
        vendorCompanyId,
        developerCompanyId,
        waiverType,
        throughDate ?? null,
        paymentAmountCents ?? null,
        email,
        notes ?? null,
      ],
    );

    res.status(201).json({ waiver });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /lien-waivers/:id — update a lien waiver
// ---------------------------------------------------------------------------
router.patch(
  "/lien-waivers/:id",
  requireUser,
  h(async (req, res) => {
    const { email } = getAuth(req);
    const { status, storagePath, notes } = req.body ?? {};

    const existing = await q1<any>(`SELECT id FROM lien_waivers WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: "lien waiver not found" });

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (status !== undefined) {
      add("status", String(status));
      if (status === "submitted") add("submitted_by", email);
      if (status === "accepted") add("accepted_by", email);
    }
    if (storagePath !== undefined) add("storage_path", storagePath === "" ? null : String(storagePath));
    if (notes !== undefined) add("notes", notes === "" ? null : String(notes));

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const waiver = await q1<any>(
      `UPDATE lien_waivers SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    res.json({ waiver });
  }),
);

// ---------------------------------------------------------------------------
// GET /me/retainage-summary — dashboard summary for authenticated company
// ---------------------------------------------------------------------------
router.get(
  "/me/retainage-summary",
  requireUser,
  h(async (req, res) => {
    const { companyId } = getAuth(req);
    if (!companyId) {
      return res.json({
        asVendor: { heldCents: 0, releasedCents: 0, pendingReleaseCount: 0 },
        asDeveloper: { heldCents: 0, releasedCents: 0, totalVendors: 0 },
      });
    }

    const vendorRow = await q1<{ held: string; released: string; pending: string }>(
      `SELECT
         COALESCE(SUM(retainage_held_cents), 0) AS held,
         COALESCE(SUM(retainage_released_cents), 0) AS released,
         COUNT(*) FILTER (WHERE release_requested_at IS NOT NULL AND release_approved_at IS NULL) AS pending
       FROM retainage_records
       WHERE vendor_company_id = $1`,
      [companyId],
    );

    const devRow = await q1<{ held: string; released: string; vendors: string }>(
      `SELECT
         COALESCE(SUM(retainage_held_cents), 0) AS held,
         COALESCE(SUM(retainage_released_cents), 0) AS released,
         COUNT(DISTINCT vendor_company_id) AS vendors
       FROM retainage_records
       WHERE developer_company_id = $1`,
      [companyId],
    );

    res.json({
      asVendor: {
        heldCents: num(vendorRow?.held),
        releasedCents: num(vendorRow?.released),
        pendingReleaseCount: num(vendorRow?.pending),
      },
      asDeveloper: {
        heldCents: num(devRow?.held),
        releasedCents: num(devRow?.released),
        totalVendors: num(devRow?.vendors),
      },
    });
  }),
);

export default router;
