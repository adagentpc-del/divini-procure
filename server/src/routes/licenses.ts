/**
 * Divini Procure - vendor license (trade/business) tracking routes.
 *
 * Self-pathed under /licenses (and /admin/licenses). Mirrors routes/coi.ts
 * route-for-route (same CRUD shape, same soft-delete-by-suspend, same admin
 * expiring-soon list) - license_type is free text rather than an enum
 * because trade/business license categories vary by jurisdiction far more
 * than insurance certificate types do. Money is always integer cents where
 * present. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

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
// GET /licenses
// Query params: companyId?, buildingId?, status?
// ---------------------------------------------------------------------------
router.get(
  "/licenses",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const requestedCompanyId = req.query.companyId as string | undefined;
    const buildingId = req.query.buildingId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

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
    const conditions: string[] = ["l.status != 'suspended'"];

    if (targetCompanyId) {
      params.push(targetCompanyId);
      conditions.push(`l.company_id = $${params.length}`);
    }

    if (buildingId) {
      params.push(buildingId);
      conditions.push(`l.building_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    let rows = await q<any>(
      `SELECT l.*,
              co.name AS company_name,
              CASE
                WHEN l.expiry_date < now() THEN 'expired'
                WHEN l.expiry_date < now() + interval '30 days' THEN 'expiring_soon'
                ELSE 'active'
              END AS computed_status
         FROM vendor_licenses l
         LEFT JOIN companies co ON co.id = l.company_id
         ${where}
        ORDER BY l.expiry_date ASC`,
      params,
    );

    if (statusFilter) {
      rows = rows.filter((r: any) => r.computed_status === statusFilter);
    }

    res.json({ licenses: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /licenses
// ---------------------------------------------------------------------------
router.post(
  "/licenses",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const {
      companyId,
      buildingId,
      licenseType,
      licenseNumber,
      issuingAuthority,
      jurisdiction,
      effectiveDate,
      expiryDate,
      storagePath,
      notes,
    } = body;

    if (!licenseType || !String(licenseType).trim()) {
      return res.status(400).json({ error: "licenseType is required" });
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

    const license = await q1<any>(
      `INSERT INTO vendor_licenses
         (company_id, building_id, license_type, license_number, issuing_authority,
          jurisdiction, effective_date, expiry_date, storage_path, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        targetCompanyId,
        buildingId ?? null,
        String(licenseType).trim(),
        licenseNumber ?? null,
        issuingAuthority ?? null,
        jurisdiction ?? null,
        effectiveDate ?? null,
        String(expiryDate),
        storagePath ?? null,
        notes ?? null,
      ],
    );

    res.status(201).json({ license });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /licenses/:id
// ---------------------------------------------------------------------------
router.patch(
  "/licenses/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(
      `SELECT * FROM vendor_licenses WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "license not found" });
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

    if (body.licenseType !== undefined) {
      if (!String(body.licenseType).trim()) return res.status(400).json({ error: "licenseType cannot be empty" });
      add("license_type", String(body.licenseType).trim());
    }
    if (body.licenseNumber !== undefined) add("license_number", body.licenseNumber ?? null);
    if (body.issuingAuthority !== undefined) add("issuing_authority", body.issuingAuthority ?? null);
    if (body.jurisdiction !== undefined) add("jurisdiction", body.jurisdiction ?? null);
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

    const license = await q1<any>(
      `UPDATE vendor_licenses SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    res.json({ license });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /licenses/:id -- soft delete (status = 'suspended')
// ---------------------------------------------------------------------------
router.delete(
  "/licenses/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(
      `SELECT * FROM vendor_licenses WHERE id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "license not found" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, existing.company_id as string))) {
      return res.status(403).json({ error: "access denied" });
    }

    await q1<any>(
      `UPDATE vendor_licenses SET status = 'suspended', updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id],
    );

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/licenses/expiring -- requireAdmin
// ---------------------------------------------------------------------------
router.get(
  "/admin/licenses/expiring",
  requireAdmin,
  h(async (_req, res) => {
    const licenses = await q<any>(
      `SELECT l.*, co.name AS company_name
         FROM vendor_licenses l
         LEFT JOIN companies co ON co.id = l.company_id
        WHERE l.status != 'suspended'
          AND l.expiry_date >= now()
          AND l.expiry_date < now() + interval '30 days'
        ORDER BY l.expiry_date ASC`,
    );

    res.json({ licenses });
  }),
);

export default router;
