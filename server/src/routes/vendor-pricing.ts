/**
 * Divini Procure - VENDOR PRICING TIERS routes.
 *
 * Mounted under /api in routes.ts, so full paths are /api/vendor-pricing/... and
 * /api/admin/vendor-pricing.
 *
 * A vendor company manages its own multi-tier pricing; a developer (buyer) reads
 * only the rows a given vendor has made visible to them. Visibility bands:
 *   public      -> anyone authed
 *   trade       -> any developer/buyer (the default professional tier)
 *   developer   -> only the named developer_company_id
 *   project     -> only members of the project's owning company
 *   admin_only  -> admins only
 *
 * Money is integer cents over the wire (price_cents). Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { userCompanyIds, ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const PRICING_TYPES = [
  "retail",
  "trade",
  "developer_specific",
  "project_specific",
  "contract",
  "volume",
  "preferred",
  "grandfathered",
  "private_admin",
] as const;
type PricingType = (typeof PRICING_TYPES)[number];

const VISIBILITIES = ["public", "trade", "developer", "project", "admin_only"] as const;
type Visibility = (typeof VISIBILITIES)[number];

/** True when the user is a member of the company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Assert the user is a member of the company; throw 403 otherwise. */
async function assertMember(userId: string, companyId: string): Promise<void> {
  if (!(await isMember(userId, companyId))) {
    throw new ForbiddenError("not a member of this company");
  }
}

// ---------------------------------------------------------------------------
// GET /vendor-pricing - visibility-scoped read of a vendor's pricing
// ---------------------------------------------------------------------------
router.get(
  "/vendor-pricing",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const vendorCompanyId = String(req.query.vendorCompanyId || "");
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "vendorCompanyId required" });
    }
    const developerCompanyId = req.query.developerCompanyId
      ? String(req.query.developerCompanyId)
      : null;
    const projectId = req.query.projectId ? String(req.query.projectId) : null;

    const mine = await userCompanyIds(auth.userId!);
    const isVendorMember = mine.includes(vendorCompanyId);
    // A developer is "a party" when they are a member of the developerCompanyId
    // they claim AND that company is not the vendor itself.
    const isDeveloperParty =
      !!developerCompanyId && mine.includes(developerCompanyId) && developerCompanyId !== vendorCompanyId;

    // Project ids the caller's companies own (for project visibility).
    let ownedProjectIds: string[] = [];
    if (!auth.isAdmin && !isVendorMember && mine.length) {
      const rows = await q<{ id: string }>(
        `select id from buildings where company_id = any($1)`,
        [mine],
      );
      ownedProjectIds = rows.map((r) => r.id);
    }

    const where: string[] = ["vendor_company_id = $1"];
    const params: any[] = [vendorCompanyId];

    if (auth.isAdmin) {
      // admin sees all rows (active and inactive), no visibility filter.
    } else if (isVendorMember) {
      // the vendor sees all of their own rows (active and inactive).
    } else if (isDeveloperParty) {
      // a member of the developer_company sees:
      //   public + trade
      //   + developer_specific / developer-visibility rows for THEM
      //   + project rows for THEIR projects
      // never private_admin or admin_only; never another developer's rows.
      where.push("active = true");
      const clauses: string[] = [];
      clauses.push("visibility in ('public','trade')");

      params.push(developerCompanyId);
      const devIdx = params.length;
      clauses.push(
        `(developer_company_id = $${devIdx} and (visibility = 'developer' or pricing_type = 'developer_specific'))`,
      );

      if (ownedProjectIds.length) {
        params.push(ownedProjectIds);
        const projIdx = params.length;
        clauses.push(`(visibility = 'project' and project_id = any($${projIdx}))`);
      }

      where.push(`(${clauses.join(" or ")})`);
      where.push("visibility not in ('private_admin','admin_only')");
    } else {
      // not a party: only public, active rows.
      where.push("active = true");
      where.push("visibility = 'public'");
    }

    // Optional caller-supplied narrowing filters (do not widen visibility).
    if (projectId) {
      params.push(projectId);
      where.push(`project_id = $${params.length}`);
    }

    const sql = `select * from vendor_pricing where ${where.join(" and ")} order by product_label nulls last, price_cents nulls last`;
    const rows = await q(sql, params);
    res.json({ pricing: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /vendor-pricing - vendor creates a price row for its own company
// ---------------------------------------------------------------------------
router.post(
  "/vendor-pricing",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const vendorCompanyId = String(b.vendorCompanyId || "");
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "vendorCompanyId required" });
    }
    await assertMember(auth.userId!, vendorCompanyId);

    const pricingType = PRICING_TYPES.includes(b.pricingType as PricingType)
      ? (b.pricingType as PricingType)
      : null;
    if (!pricingType) {
      return res.status(400).json({ error: "valid pricingType required" });
    }
    const visibility = VISIBILITIES.includes(b.visibility as Visibility)
      ? (b.visibility as Visibility)
      : "trade";

    const priceCents =
      b.priceCents === undefined || b.priceCents === null || b.priceCents === ""
        ? null
        : Math.round(Number(b.priceCents));
    if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
      return res.status(400).json({ error: "priceCents must be a non-negative integer" });
    }
    const minQty =
      b.minQty === undefined || b.minQty === null || b.minQty === ""
        ? 1
        : Math.max(1, Math.round(Number(b.minQty)));

    const row = await q1(
      `insert into vendor_pricing
         (vendor_company_id, developer_company_id, project_id, pricing_type, product_label,
          sku, unit, price_cents, min_qty, currency, visibility, notes, active, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,'USD'),$11,$12,true,$13)
       returning *`,
      [
        vendorCompanyId,
        b.developerCompanyId ? String(b.developerCompanyId) : null,
        b.projectId ? String(b.projectId) : null,
        pricingType,
        b.productLabel ? String(b.productLabel) : null,
        b.sku ? String(b.sku) : null,
        b.unit ? String(b.unit) : null,
        priceCents,
        minQty,
        b.currency ? String(b.currency) : null,
        visibility,
        b.notes ? String(b.notes) : null,
        auth.userId,
      ],
    );
    res.status(201).json({ pricing: row });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /vendor-pricing/:id - update a row (vendor member or admin)
// ---------------------------------------------------------------------------
router.patch(
  "/vendor-pricing/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<{ vendor_company_id: string }>(
      `select vendor_company_id from vendor_pricing where id = $1`,
      [req.params.id],
    );
    if (!existing) throw new NotFoundError("pricing row not found");
    if (!auth.isAdmin) {
      await assertMember(auth.userId!, existing.vendor_company_id);
    }

    const b = (req.body ?? {}) as Record<string, unknown>;

    let pricingType: PricingType | null | undefined = undefined;
    if (b.pricingType !== undefined) {
      if (!PRICING_TYPES.includes(b.pricingType as PricingType)) {
        return res.status(400).json({ error: "invalid pricingType" });
      }
      pricingType = b.pricingType as PricingType;
    }
    let visibility: Visibility | null | undefined = undefined;
    if (b.visibility !== undefined) {
      if (!VISIBILITIES.includes(b.visibility as Visibility)) {
        return res.status(400).json({ error: "invalid visibility" });
      }
      visibility = b.visibility as Visibility;
    }

    let priceCents: number | null | undefined = undefined;
    if (b.priceCents !== undefined) {
      priceCents =
        b.priceCents === null || b.priceCents === "" ? null : Math.round(Number(b.priceCents));
      if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
        return res.status(400).json({ error: "priceCents must be a non-negative integer" });
      }
    }
    let minQty: number | undefined = undefined;
    if (b.minQty !== undefined && b.minQty !== null && b.minQty !== "") {
      minQty = Math.max(1, Math.round(Number(b.minQty)));
    }

    const row = await q1(
      `update vendor_pricing set
         pricing_type        = coalesce($2, pricing_type),
         product_label       = coalesce($3, product_label),
         sku                 = coalesce($4, sku),
         unit                = coalesce($5, unit),
         price_cents         = case when $6::boolean then $7::bigint else price_cents end,
         min_qty             = coalesce($8, min_qty),
         currency            = coalesce($9, currency),
         visibility          = coalesce($10, visibility),
         developer_company_id= case when $11::boolean then $12::uuid else developer_company_id end,
         project_id          = case when $13::boolean then $14::uuid else project_id end,
         notes               = coalesce($15, notes),
         active              = coalesce($16, active),
         updated_at          = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        pricingType ?? null,
        b.productLabel !== undefined ? String(b.productLabel) : null,
        b.sku !== undefined ? String(b.sku) : null,
        b.unit !== undefined ? String(b.unit) : null,
        b.priceCents !== undefined, // whether to set price
        priceCents ?? null,
        minQty ?? null,
        b.currency !== undefined ? String(b.currency) : null,
        visibility ?? null,
        b.developerCompanyId !== undefined, // whether to set developer
        b.developerCompanyId ? String(b.developerCompanyId) : null,
        b.projectId !== undefined, // whether to set project
        b.projectId ? String(b.projectId) : null,
        b.notes !== undefined ? String(b.notes) : null,
        typeof b.active === "boolean" ? b.active : null,
      ],
    );
    res.json({ pricing: row });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /vendor-pricing/:id - soft delete (active=false)
// ---------------------------------------------------------------------------
router.delete(
  "/vendor-pricing/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<{ vendor_company_id: string }>(
      `select vendor_company_id from vendor_pricing where id = $1`,
      [req.params.id],
    );
    if (!existing) throw new NotFoundError("pricing row not found");
    if (!auth.isAdmin) {
      await assertMember(auth.userId!, existing.vendor_company_id);
    }
    const row = await q1(
      `update vendor_pricing set active = false, updated_at = now() where id = $1 returning *`,
      [req.params.id],
    );
    res.json({ pricing: row });
  }),
);

// ===========================================================================
// ADMIN
// ===========================================================================
router.get(
  "/admin/vendor-pricing",
  requireAdmin,
  h(async (_req, res) => {
    const rows = await q(
      `select vp.*, v.name as vendor_name, d.name as developer_name
         from vendor_pricing vp
         left join companies v on v.id = vp.vendor_company_id
         left join companies d on d.id = vp.developer_company_id
        order by vp.created_at desc`,
    );
    res.json({ pricing: rows });
  }),
);

export default router;
