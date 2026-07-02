/**
 * Divini Procure - PRODUCT CATALOG / SKU MANAGEMENT routes.
 *
 * Mounted under /api in routes.ts, so full paths are /api/products/...
 *
 * A vendor company (companies.kind='vendor') manages its own catalog. Buyers
 * (developers) browse. Each product has a price-visibility band controlling who
 * may read price_cents:
 *   public      -> any signed-in user
 *   trade       -> any signed-in company (the default professional tier)
 *   developer   -> only developers/buyers (companies.kind='buyer')
 *   admin_only  -> admins only
 * The vendor company's own members and admins always see price. When a caller
 * may not see price we null price_cents and set priceHidden=true; non-price
 * fields are always returned. Non-owners only ever see status='active' rows.
 *
 * Money is integer cents over the wire (price_cents). Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const PRICE_VISIBILITIES = ["public", "trade", "developer", "admin_only"] as const;
type PriceVisibility = (typeof PRICE_VISIBILITIES)[number];

const STATUSES = ["active", "discontinued", "draft"] as const;
type Status = (typeof STATUSES)[number];

interface ProductRow {
  id: string;
  vendor_company_id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  image_urls: string[] | null;
  spec_url: string | null;
  dimensions: string | null;
  finishes: string[] | null;
  materials: string[] | null;
  lead_time_days: number | null;
  price_cents: string | number | null;
  price_visibility: string;
  commercial_rating: number | null;
  hospitality_rating: number | null;
  warranty: string | null;
  file_urls: string[] | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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

/** True when the caller is a developer/buyer (kind='buyer') in some company. */
async function isBuyer(userId: string): Promise<boolean> {
  const row = await q1(
    `select 1
       from company_members cm
       join companies c on c.id = cm.company_id
      where cm.user_id = $1 and c.kind = 'buyer'
      limit 1`,
    [userId],
  );
  return !!row;
}

/**
 * Decide whether the caller may see this product's price, and return the product
 * shaped for the wire (price_cents nulled + priceHidden=true when not allowed).
 * The vendor company's own members and admins always see price.
 */
function shapeForViewer(
  row: ProductRow,
  opts: { isOwner: boolean; isAdmin: boolean; callerIsBuyer: boolean },
): ProductRow & { priceHidden: boolean } {
  const { isOwner, isAdmin, callerIsBuyer } = opts;
  let allowed = false;
  if (isOwner || isAdmin) {
    allowed = true;
  } else {
    switch (row.price_visibility as PriceVisibility) {
      case "public":
        allowed = true;
        break;
      case "trade":
        // any signed-in company may see trade price
        allowed = true;
        break;
      case "developer":
        allowed = callerIsBuyer;
        break;
      case "admin_only":
        allowed = false;
        break;
      default:
        allowed = false;
    }
  }
  if (allowed) {
    return { ...row, priceHidden: false };
  }
  return { ...row, price_cents: null, priceHidden: true };
}

/** Parse a string[] from a body value (array of strings, or comma-separated string). */
function toTextArray(v: unknown): string[] | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : [];
  }
  const arr = String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : [];
}

/** Parse an integer in [min,max] or null. */
function toIntInRange(v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// ---------------------------------------------------------------------------
// GET /products - browse catalog (price visibility scoped)
//   ?vendorCompanyId= &category= &q=
// ---------------------------------------------------------------------------
router.get(
  "/products",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const vendorCompanyId = req.query.vendorCompanyId
      ? String(req.query.vendorCompanyId)
      : null;
    const category = req.query.category ? String(req.query.category) : null;
    const keyword = req.query.q ? String(req.query.q).trim() : "";

    const isOwner = vendorCompanyId
      ? await isMember(auth.userId!, vendorCompanyId)
      : false;
    const callerIsBuyer = await isBuyer(auth.userId!);

    const where: string[] = [];
    const params: any[] = [];

    if (vendorCompanyId) {
      params.push(vendorCompanyId);
      where.push(`vendor_company_id = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (keyword) {
      params.push(`%${keyword}%`);
      const idx = params.length;
      where.push(
        `(name ilike $${idx} or sku ilike $${idx} or description ilike $${idx} or subcategory ilike $${idx})`,
      );
    }

    // Non-owner non-admin callers only see active products.
    if (!auth.isAdmin && !isOwner) {
      where.push(`status = 'active'`);
    }

    const sql = `select * from products${
      where.length ? ` where ${where.join(" and ")}` : ""
    } order by name nulls last, created_at desc`;
    const rows = await q<ProductRow>(sql, params);

    const products = rows.map((r) =>
      shapeForViewer(r, {
        isOwner,
        isAdmin: auth.isAdmin,
        callerIsBuyer,
      }),
    );
    res.json({ products });
  }),
);

// ---------------------------------------------------------------------------
// POST /products - vendor creates a product for its own company
// ---------------------------------------------------------------------------
router.post(
  "/products",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const vendorCompanyId = String(b.vendorCompanyId || "");
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "vendorCompanyId required" });
    }
    await assertMember(auth.userId!, vendorCompanyId);

    const priceVisibility = PRICE_VISIBILITIES.includes(b.priceVisibility as PriceVisibility)
      ? (b.priceVisibility as PriceVisibility)
      : "trade";
    const status = STATUSES.includes(b.status as Status) ? (b.status as Status) : "active";

    const priceCents =
      b.priceCents === undefined || b.priceCents === null || b.priceCents === ""
        ? null
        : Math.round(Number(b.priceCents));
    if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
      return res.status(400).json({ error: "priceCents must be a non-negative integer" });
    }
    const leadTimeDays =
      b.leadTimeDays === undefined || b.leadTimeDays === null || b.leadTimeDays === ""
        ? null
        : Math.max(0, Math.round(Number(b.leadTimeDays)));

    const row = await q1<ProductRow>(
      `insert into products
         (vendor_company_id, name, sku, category, subcategory, description,
          image_urls, spec_url, dimensions, finishes, materials, lead_time_days,
          price_cents, price_visibility, commercial_rating, hospitality_rating,
          warranty, file_urls, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       returning *`,
      [
        vendorCompanyId,
        b.name ? String(b.name) : null,
        b.sku ? String(b.sku) : null,
        b.category ? String(b.category) : null,
        b.subcategory ? String(b.subcategory) : null,
        b.description ? String(b.description) : null,
        toTextArray(b.imageUrls),
        b.specUrl ? String(b.specUrl) : null,
        b.dimensions ? String(b.dimensions) : null,
        toTextArray(b.finishes),
        toTextArray(b.materials),
        leadTimeDays,
        priceCents,
        priceVisibility,
        toIntInRange(b.commercialRating, 1, 5),
        toIntInRange(b.hospitalityRating, 1, 5),
        b.warranty ? String(b.warranty) : null,
        toTextArray(b.fileUrls),
        status,
        auth.userId,
      ],
    );
    res.status(201).json({ product: { ...(row as ProductRow), priceHidden: false } });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /products/:id - update (vendor member or admin)
// ---------------------------------------------------------------------------
router.patch(
  "/products/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<{ vendor_company_id: string }>(
      `select vendor_company_id from products where id = $1`,
      [req.params.id],
    );
    if (!existing) throw new NotFoundError("product not found");
    if (!auth.isAdmin) {
      await assertMember(auth.userId!, existing.vendor_company_id);
    }

    const b = (req.body ?? {}) as Record<string, unknown>;

    let priceVisibility: PriceVisibility | null = null;
    if (b.priceVisibility !== undefined) {
      if (!PRICE_VISIBILITIES.includes(b.priceVisibility as PriceVisibility)) {
        return res.status(400).json({ error: "invalid priceVisibility" });
      }
      priceVisibility = b.priceVisibility as PriceVisibility;
    }
    let status: Status | null = null;
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status as Status)) {
        return res.status(400).json({ error: "invalid status" });
      }
      status = b.status as Status;
    }

    let priceCents: number | null = null;
    const setPrice = b.priceCents !== undefined;
    if (setPrice) {
      priceCents =
        b.priceCents === null || b.priceCents === "" ? null : Math.round(Number(b.priceCents));
      if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
        return res.status(400).json({ error: "priceCents must be a non-negative integer" });
      }
    }

    let leadTimeDays: number | null = null;
    const setLead = b.leadTimeDays !== undefined;
    if (setLead) {
      leadTimeDays =
        b.leadTimeDays === null || b.leadTimeDays === ""
          ? null
          : Math.max(0, Math.round(Number(b.leadTimeDays)));
    }

    const row = await q1<ProductRow>(
      `update products set
         name               = coalesce($2, name),
         sku                = coalesce($3, sku),
         category           = coalesce($4, category),
         subcategory        = coalesce($5, subcategory),
         description        = coalesce($6, description),
         image_urls         = case when $7::boolean then $8::text[] else image_urls end,
         spec_url           = coalesce($9, spec_url),
         dimensions         = coalesce($10, dimensions),
         finishes           = case when $11::boolean then $12::text[] else finishes end,
         materials          = case when $13::boolean then $14::text[] else materials end,
         lead_time_days     = case when $15::boolean then $16::int else lead_time_days end,
         price_cents        = case when $17::boolean then $18::bigint else price_cents end,
         price_visibility   = coalesce($19, price_visibility),
         commercial_rating  = case when $20::boolean then $21::int else commercial_rating end,
         hospitality_rating = case when $22::boolean then $23::int else hospitality_rating end,
         warranty           = coalesce($24, warranty),
         file_urls          = case when $25::boolean then $26::text[] else file_urls end,
         status             = coalesce($27, status),
         updated_at         = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        b.name !== undefined ? String(b.name) : null,
        b.sku !== undefined ? String(b.sku) : null,
        b.category !== undefined ? String(b.category) : null,
        b.subcategory !== undefined ? String(b.subcategory) : null,
        b.description !== undefined ? String(b.description) : null,
        b.imageUrls !== undefined, // whether to set image_urls
        toTextArray(b.imageUrls),
        b.specUrl !== undefined ? String(b.specUrl) : null,
        b.dimensions !== undefined ? String(b.dimensions) : null,
        b.finishes !== undefined, // whether to set finishes
        toTextArray(b.finishes),
        b.materials !== undefined, // whether to set materials
        toTextArray(b.materials),
        setLead, // whether to set lead_time_days
        leadTimeDays,
        setPrice, // whether to set price_cents
        priceCents,
        priceVisibility,
        b.commercialRating !== undefined, // whether to set commercial_rating
        toIntInRange(b.commercialRating, 1, 5),
        b.hospitalityRating !== undefined, // whether to set hospitality_rating
        toIntInRange(b.hospitalityRating, 1, 5),
        b.warranty !== undefined ? String(b.warranty) : null,
        b.fileUrls !== undefined, // whether to set file_urls
        toTextArray(b.fileUrls),
        status,
      ],
    );
    res.json({ product: { ...(row as ProductRow), priceHidden: false } });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /products/:id - soft delete (status='discontinued')
// ---------------------------------------------------------------------------
router.delete(
  "/products/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<{ vendor_company_id: string }>(
      `select vendor_company_id from products where id = $1`,
      [req.params.id],
    );
    if (!existing) throw new NotFoundError("product not found");
    if (!auth.isAdmin) {
      await assertMember(auth.userId!, existing.vendor_company_id);
    }
    const row = await q1<ProductRow>(
      `update products set status = 'discontinued', updated_at = now() where id = $1 returning *`,
      [req.params.id],
    );
    res.json({ product: { ...(row as ProductRow), priceHidden: false } });
  }),
);

// ---------------------------------------------------------------------------
// GET /products/:id - single product (price visibility scoped)
// ---------------------------------------------------------------------------
router.get(
  "/products/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const row = await q1<ProductRow>(`select * from products where id = $1`, [req.params.id]);
    if (!row) throw new NotFoundError("product not found");

    const isOwner = await isMember(auth.userId!, row.vendor_company_id);
    // Non-owner non-admin callers cannot see non-active products.
    if (!auth.isAdmin && !isOwner && row.status !== "active") {
      throw new NotFoundError("product not found");
    }
    const callerIsBuyer = await isBuyer(auth.userId!);
    const product = shapeForViewer(row, { isOwner, isAdmin: auth.isAdmin, callerIsBuyer });
    res.json({ product });
  }),
);

export default router;
