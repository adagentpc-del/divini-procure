/**
 * Divini Procure - COI (Certificate of Insurance) tracking routes.
 *
 * Self-pathed under /coi (and /admin/coi). Handles CRUD for insurance
 * certificates, soft deletes, admin verification, and expiry summaries.
 * Money is always integer cents. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const VALID_TYPES = new Set([
  "general_liability",
  "workers_comp",
  "umbrella",
  "auto",
  "professional",
  "other",
]);

/** Resolve the primary company_id for an authenticated user. */
async function getUserCompanyId(userId: string): Promise<string | null> {
  const row = await q1<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

/** Check whether a user belongs to a company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1<{ ok: number }>(
    `SELECT 1 AS ok FROM company_members WHERE user_id = $1 AND company_id = $2`,
    [userId, companyId],
  );
  return row != null;
}

// ---------------------------------------------------------------------------
// GET /coi/summary -- must come BEFORE /:id route
// Query param: buildingId
// Returns counts of active / expiring_soon / expired certs for vendors
// associated with the building (companies with bids on packages for it).
// ---------------------------------------------------------------------------
router.get(
  "/coi/summary",
  requireUser,
  h(async (req, res) => {
    const buildingId = req.query.buildingId as string | undefined;

    const rows = await q<{ computed_status: string; cnt: string }>(
      `SELECT
         CASE
           WHEN expiry_date < now() THEN 'expired'
           WHEN expiry_date < now() + interval '30 days' THEN 'expiring_soon'
           ELSE 'active'
         END AS computed_status,
         COUNT(*) AS cnt
       FROM coi_certificates c
       WHERE c.status != 'suspended'
         AND (
           $1::uuid IS NULL
           OR c.company_id IN (
             SELECT DISTINCT b.company_id
               FROM bids b
               JOIN bid_packages bp ON bp.id = b.package_id
              WHERE bp.building_id = $1::uuid
           )
         )
       GROUP BY computed_status`,
      [buildingId ?? null],
    );

    let activeCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;
    for (const row of rows) {
      const n = Number(row.cnt);
      if (row.computed_status === "active") activeCount = n;
      else if (row.computed_status === "expiring_soon") expiringSoonCount = n;
      else if (row.computed_status === "expired") expiredCount = n;
    }

    res.json({ buildingId: buildingId ?? null, activeCount, expiringSoonCount, expiredCount });
  }),
);

// ---------------------------------------------------------------------------
// GET /coi
// Query params: companyId?, buildingId?, status?
// ---------------------------------------------------------------------------
router.get(
  "/coi",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const requestedCompanyId = req.query.companyId as string | undefined;
    const buildingId = req.query.buildingId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    // Determine which company's certs to load
    let targetCompanyId: string | null = null;
    if (requestedCompanyId) {
      if (!auth.isAdmin && !(await isMember(auth.userId!, requestedCompanyId))) {
        return res.status(403).json({ error: "access denied" });
      }
      targetCompanyId = requestedCompanyId;
    } else {
      targetCompanyId = auth.userId ? await getUserCompanyId(auth.userId) : null;
    }

    const params: unknown[] = [];
    const conditions: string[] = ["c.status != 'suspended'"];

    if (targetCompanyId) {
      params.push(targetCompanyId);
      conditions.push(`c.company_id = $${params.length}`);
    }

    if (buildingId) {
      params.push(buildingId);
      conditions.push(`c.building_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    let rows = await q<any>(
      `SELECT c.*,
              co.name AS company_name,
              CASE
                WHEN c.expiry_date < now() THEN 'expired'
                WHEN c.expiry_date < now() + interval '30 days' THEN 'expiring_soon'
                ELSE 'active'
              END AS computed_status
         FROM coi_certificates c
         LEFT JOIN companies co ON co.id = c.company_id
         ${where}
        ORDER BY c.expiry_date ASC`,
      params,
    );

    if (statusFilter) {
      rows = rows.filter((r: any) => r.computed_status === statusFilter);
    }

    res.json({ certificates: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /coi
// ---------------------------------------------------------------------------
router.post(
  "/coi",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const {
      companyId,
      buildingId,
      certificateType,
      carrierName,
      policyNumber,
      coverageAmountCents,
      aggregateAmountCents,
      effectiveDate,
      expiryDate,
      storagePath,
      notes,
    } = body;

    if (!certificateType || !VALID_TYPES.has(String(certificateType))) {
      return res.status(400).json({ error: "invalid certificateType" });
    }
    if (!expiryDate) {
      return res.status(400).json({ error: "expiryDate is required" });
    }

    const targetCompanyId = companyId
      ? String(companyId)
      : auth.userId
        ? await getUserCompanyId(auth.userId)
        : null;
    if (!targetCompanyId) {
      return res.status(400).json({ error: "companyId is required" });
    }
    if (!auth.isAdmin && !(await isMember(auth.userId!, targetCompanyId))) {
      return res.status(403).json({ error: "access denied" });
    }

    const cert = await q1<any>(
      `INSERT INTO coi_certificates
         (company_id, building_id, certificate_type, carrier_name, policy_number,
          coverage_amount_cents, aggregate_amount_cents, effective_date, expiry_date,
          storage_path, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        targetCompanyId,
        buildingId ?? null,
        String(certificateType),
        carrierName ?? null,
        policyNumber ?? null,
        coverageAmountCents != null ? Number(coverageAmountCents) : null,
        aggregateAmountCents != null ? Number(aggregateAmountCents) : null,
        effectiveDate ?? null,
        String(expiryDate),
        storagePath ?? null,
        notes ?? null,
      ],
    );

    res.status(201).json({ certificate: cert });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /coi/:id
// ---------------------------------------------------------------------------
router.patch(
  "/coi/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(
      `SELECT * FROM coi_certificates WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "certificate not found" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, existing.company_id as string))) {
      return res.status(403).json({ error: "access denied" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];

    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (body.carrierName !== undefined) add("carrier_name", body.carrierName ?? null);
    if (body.policyNumber !== undefined) add("policy_number", body.policyNumber ?? null);
    if (body.coverageAmountCents !== undefined)
      add("coverage_amount_cents", body.coverageAmountCents != null ? Number(body.coverageAmountCents) : null);
    if (body.aggregateAmountCents !== undefined)
      add("aggregate_amount_cents", body.aggregateAmountCents != null ? Number(body.aggregateAmountCents) : null);
    if (body.effectiveDate !== undefined) add("effective_date", body.effectiveDate ?? null);
    if (body.expiryDate !== undefined) add("expiry_date", body.expiryDate ?? null);
    if (body.storagePath !== undefined) add("storage_path", body.storagePath ?? null);
    if (body.notes !== undefined) add("notes", body.notes ?? null);

    // Admin-only: verify
    if (auth.isAdmin && body.verify) {
      add("verified_by", auth.email ?? null);
      add("verified_at", new Date().toISOString());
    }

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const cert = await q1<any>(
      `UPDATE coi_certificates SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    res.json({ certificate: cert });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /coi/:id -- soft delete (status = 'suspended')
// ---------------------------------------------------------------------------
router.delete(
  "/coi/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(
      `SELECT * FROM coi_certificates WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "certificate not found" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, existing.company_id as string))) {
      return res.status(403).json({ error: "access denied" });
    }

    await q1<any>(
      `UPDATE coi_certificates SET status = 'suspended', updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id],
    );

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/coi/expiring -- requireAdmin
// Certificates expiring within 30 days, ordered by expiry_date asc
// ---------------------------------------------------------------------------
router.get(
  "/admin/coi/expiring",
  requireAdmin,
  h(async (_req, res) => {
    const certs = await q<any>(
      `SELECT c.*, co.name AS company_name
         FROM coi_certificates c
         LEFT JOIN companies co ON co.id = c.company_id
        WHERE c.status != 'suspended'
          AND c.expiry_date >= now()
          AND c.expiry_date < now() + interval '30 days'
        ORDER BY c.expiry_date ASC`,
    );

    res.json({ certificates: certs });
  }),
);

export default router;
