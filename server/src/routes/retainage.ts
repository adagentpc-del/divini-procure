/**
 * Divini Procure - Retainage Tracking and Lien Waiver routes.
 *
 * Self-pathed under /api (mounted with router.use(retainageRouter), no prefix).
 * Handles retainage records and lien waiver workflows between vendors and developers.
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
    `SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

/**
 * Verify the caller is authorized to create a retainage record or lien waiver
 * against `buildingId` as its `developerCompanyId`: the building's true
 * owning company (resolved from the database, not trusted from the request
 * body) must both be a company the caller is a member of AND match the
 * `developerCompanyId` supplied - so a caller cannot fabricate a record
 * against someone else's building by simply passing their own company id as
 * developerCompanyId, and cannot claim someone else's company id either.
 * Also confirms vendorCompanyId names a real company, rejecting malformed or
 * fabricated ids outright rather than letting them insert. Admins bypass.
 */
async function assertCanCreateAgainstBuilding(
  req: Request,
  buildingId: string,
  developerCompanyId: string,
  vendorCompanyId: string,
): Promise<void> {
  const { userId, isAdmin } = getAuth(req);
  const building = await q1<{ company_id: string }>(
    `select company_id from buildings where id = $1`,
    [buildingId],
  );
  if (!building) throw new NotFoundError("building not found");

  const vendor = await q1<{ id: string }>(`select id from companies where id = $1`, [
    vendorCompanyId,
  ]);
  if (!vendor) throw new NotFoundError("vendor company not found");

  if (isAdmin) return;

  if (building.company_id !== developerCompanyId) {
    throw new ForbiddenError("developerCompanyId does not match this building's owning company");
  }
  const isDeveloperMember = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, developerCompanyId],
  );
  if (!isDeveloperMember) {
    throw new ForbiddenError("not a member of this building's developer company");
  }
}

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
    const { userId, isAdmin } = getAuth(req);
    const companyId = await getCompanyId(userId);
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
    await assertCanCreateAgainstBuilding(req, buildingId, developerCompanyId, vendorCompanyId);

    const retainageHeldCents = Math.round(Number(contractAmountCents) * Number(retainagePct) / 100);

    // Financial source-of-truth fix (Phase 0): where a real, awarded
    // Purchase Order exists for this package + vendor, link this retainage
    // record to it rather than leaving contract_amount_cents as an
    // unverifiable freehand number. Never blocks creation on a mismatch
    // (a retainage record can legitimately cover a different, e.g. partial,
    // amount) - only surfaces it so the caller can see the two numbers
    // disagree, rather than silently trusting whichever was typed in.
    let purchaseOrderId: string | null = null;
    let contractAmountMismatch: { poAmountCents: number } | null = null;
    if (packageId) {
      const po = await q1<{ id: string; amount_cents: number | string | null }>(
        `select id, amount_cents from purchase_orders
          where package_id = $1 and vendor_company_id = $2
          order by created_at desc limit 1`,
        [packageId, vendorCompanyId],
      );
      if (po) {
        purchaseOrderId = po.id;
        const poCents = po.amount_cents == null ? null : Number(po.amount_cents);
        if (poCents != null && poCents !== Number(contractAmountCents)) {
          contractAmountMismatch = { poAmountCents: poCents };
        }
      }
    }

    const record = await q1<any>(
      `INSERT INTO retainage_records
         (building_id, package_id, vendor_company_id, developer_company_id,
          contract_amount_cents, retainage_pct, retainage_held_cents,
          release_trigger, milestone_required, notes, status, purchase_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'holding',$11)
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
        purchaseOrderId,
      ],
    );

    res.status(201).json({ record, ...(contractAmountMismatch ? { contractAmountMismatch } : {}) });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /retainage/:id — update a retainage record
// ---------------------------------------------------------------------------
router.patch(
  "/retainage/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const companyId = await getCompanyId(userId);

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
    const { userId, isAdmin } = getAuth(req);
    const companyId = await getCompanyId(userId);
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
    await assertCanCreateAgainstBuilding(req, buildingId, developerCompanyId, vendorCompanyId);

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
    const { userId, email, isAdmin } = getAuth(req);
    const companyId = await getCompanyId(userId);
    const { status, storagePath, notes } = req.body ?? {};

    const existing = await q1<any>(
      `SELECT id, vendor_company_id, developer_company_id FROM lien_waivers WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "lien waiver not found" });
    if (
      !isAdmin &&
      companyId !== existing.vendor_company_id &&
      companyId !== existing.developer_company_id
    ) {
      return res.status(403).json({ error: "forbidden" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (status !== undefined) {
      // Accepting a waiver is the paying party's (developer's) decision -
      // mirrors retainage's approve_release restriction below.
      if (status === "accepted" && !isAdmin && companyId !== existing.developer_company_id) {
        return res
          .status(403)
          .json({ error: "only the developer company or admin can accept a lien waiver" });
      }
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
    const { userId } = getAuth(req);
    const companyId = await getCompanyId(userId);
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
