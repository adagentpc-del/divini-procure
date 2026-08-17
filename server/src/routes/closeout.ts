/**
 * Project closeout: final punch list + warranty tracking for Divini Procure
 * (fresh competitive scan, 2026-08-17 - docs/competitive-analysis-2026-08.md
 * gap #17). Self-pathed, mounted in routes.ts. Distinct from the purely
 * financial closeout marker (financial-summary.ts's financially_closed_at)
 * and from delivery.ts's per-delivery material punch items.
 *
 * Scoped to PACKAGE, matching change-orders.ts/delivery.ts's own
 * granularity. The developer (the building's owning company) raises punch
 * items and warranty claims and sets warranty terms; the vendor holding the
 * package's award resolves punch items and works claims; the developer
 * verifies a punch item's fix or resolves/denies a claim. RLS
 * (db/schema-closeout.sql) enforces the row-visibility boundary; this file
 * enforces the narrower field-level contract per role, matching rfi.ts's
 * split between who may touch a row and what they may set on it.
 *
 * Endpoints (all requireUser):
 *   GET   /closeout/my-packages?companyId=      -> { packages: [...] }
 *   GET   /packages/:packageId/closeout         -> { package, punchItems, warrantyClaims }
 *   PATCH /packages/:packageId/warranty         -> { package }
 *   POST  /packages/:packageId/punch-items      -> { item }
 *   PATCH /closeout/punch-items/:id             -> { item }
 *   POST  /packages/:packageId/warranty-claims  -> { claim }
 *   PATCH /closeout/warranty-claims/:id         -> { claim }
 *
 * Zero em dashes by convention.
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

const PUNCH_STATUS = new Set(["open", "resolved", "verified"]);
const CLAIM_STATUS = new Set(["open", "in_progress", "resolved", "denied"]);

/** True when the user is a member of the given company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Package row plus its building - fetched once, used by most handlers. */
async function getPackageWithBuilding(packageId: string): Promise<{ id: string; building_id: string } | null> {
  return q1<{ id: string; building_id: string }>(`select id, building_id from packages where id = $1`, [packageId]);
}

/** Read access: the building owner, a member of a vendor company with any
 * award (active or cancelled) on this package, or admin. */
async function assertCanReadCloseout(req: Request, packageId: string): Promise<{ id: string; building_id: string }> {
  const auth = getAuth(req);
  const pkg = await getPackageWithBuilding(packageId);
  if (!pkg) throw new NotFoundError("package not found");
  if (auth.isAdmin) return pkg;

  const owned = await q1(
    `select 1 from buildings b
       join company_members cm on cm.company_id = b.company_id
      where b.id = $1 and cm.user_id = $2`,
    [pkg.building_id, auth.userId],
  );
  if (owned) return pkg;

  const vendor = await q1(
    `select 1 from awards a
       join company_members cm on cm.company_id = a.vendor_company_id
      where a.package_id = $1 and cm.user_id = $2`,
    [packageId, auth.userId],
  );
  if (vendor) return pkg;

  throw new ForbiddenError("not authorized to view this package's closeout");
}

/** Write access to RAISE a punch item / claim / set warranty terms: only the
 * building's developer (or admin). Returns the package + building. */
async function assertDeveloperOfPackage(req: Request, packageId: string): Promise<{ id: string; building_id: string }> {
  const auth = getAuth(req);
  const pkg = await getPackageWithBuilding(packageId);
  if (!pkg) throw new NotFoundError("package not found");
  if (auth.isAdmin) return pkg;
  const owned = await q1(
    `select 1 from buildings b
       join company_members cm on cm.company_id = b.company_id
      where b.id = $1 and cm.user_id = $2`,
    [pkg.building_id, auth.userId],
  );
  if (!owned) throw new ForbiddenError("only the developer may do this");
  return pkg;
}

/** The vendor currently (or most recently) awarded this package. Punch
 * items and claims only make sense for an awarded package. */
async function getAwardedVendor(packageId: string): Promise<string | null> {
  const row = await q1<{ vendor_company_id: string }>(
    `select vendor_company_id from awards where package_id = $1 order by status = 'active' desc, created_at desc limit 1`,
    [packageId],
  );
  return row?.vendor_company_id ?? null;
}

// GET /closeout/my-packages?companyId= -- packages this vendor company holds
// (or has ever held) an award on, for the vendor-side picker. Not
// active-only, same reasoning as rfi.ts's /rfis/my-sites: a vendor keeps
// read/resolve access to its own punch items and claims after an award
// ends.
router.get(
  "/closeout/my-packages",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const packages = await q(
      `select p.id as package_id, p.building_id, p.category, b.name as building_name,
              bool_or(a.status = 'active') as has_active_award
         from awards a
         join packages p on p.id = a.package_id
         join buildings b on b.id = p.building_id
        where a.vendor_company_id = $1
        group by p.id, p.building_id, p.category, b.name
        order by b.name, p.category`,
      [companyId],
    );
    res.json({ packages });
  }),
);

// GET /packages/:packageId/closeout
router.get(
  "/packages/:packageId/closeout",
  requireUser,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    await assertCanReadCloseout(req, packageId);
    const pkg = await q1(
      `select id, warranty_start_date, warranty_months, warranty_terms, warranty_set_by, warranty_set_at,
              financially_closed_at, final_cost_cents
         from packages where id = $1`,
      [packageId],
    );
    // RLS further restricts a vendor caller to only its own company's rows.
    const punchItems = await q(
      `select * from closeout_punch_items where package_id = $1 order by created_at desc`,
      [packageId],
    );
    const warrantyClaims = await q(
      `select * from warranty_claims where package_id = $1 order by created_at desc`,
      [packageId],
    );
    res.json({ package: pkg, punchItems, warrantyClaims });
  }),
);

// PATCH /packages/:packageId/warranty
router.patch(
  "/packages/:packageId/warranty",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.params.packageId;
    await assertDeveloperOfPackage(req, packageId);
    const body = (req.body ?? {}) as { startDate?: string; months?: number; terms?: string };
    const startDate = body.startDate ? String(body.startDate) : null;
    const months =
      body.months == null || !Number.isFinite(Number(body.months)) ? null : Math.max(0, Math.round(Number(body.months)));
    const terms = body.terms !== undefined ? String(body.terms).trim() || null : null;

    const pkg = await q1(
      `update packages set
         warranty_start_date = coalesce($2::date, warranty_start_date),
         warranty_months = coalesce($3, warranty_months),
         warranty_terms = coalesce($4, warranty_terms),
         warranty_set_by = $5,
         warranty_set_at = now()
       where id = $1
       returning id, warranty_start_date, warranty_months, warranty_terms, warranty_set_by, warranty_set_at`,
      [packageId, startDate, months, terms, auth.email ?? null],
    );
    if (!pkg) throw new NotFoundError("package not found");
    res.json({ package: pkg });
  }),
);

// POST /packages/:packageId/punch-items
router.post(
  "/packages/:packageId/punch-items",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.params.packageId;
    const pkg = await assertDeveloperOfPackage(req, packageId);
    const description = req.body?.description ? String(req.body.description).trim() : "";
    if (!description) return res.status(400).json({ error: "description is required" });

    const vendorCompanyId = await getAwardedVendor(packageId);
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "this package has no award to raise a punch item against" });
    }

    const item = await q1(
      `insert into closeout_punch_items (package_id, building_id, vendor_company_id, description, raised_by_email)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [packageId, pkg.building_id, vendorCompanyId, description, auth.email ?? null],
    );
    res.status(201).json({ item });
  }),
);

// PATCH /closeout/punch-items/:id
router.patch(
  "/closeout/punch-items/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const id = req.params.id;
    const row = await q1<{ building_id: string; vendor_company_id: string; status: string }>(
      `select building_id, vendor_company_id, status from closeout_punch_items where id = $1`,
      [id],
    );
    if (!row) throw new NotFoundError("punch item not found");

    const isVendorMember = !auth.isAdmin && (await isMember(auth.userId!, row.vendor_company_id));
    const isDeveloperMember =
      !auth.isAdmin &&
      !!(await q1(
        `select 1 from buildings b join company_members cm on cm.company_id = b.company_id
          where b.id = $1 and cm.user_id = $2`,
        [row.building_id, auth.userId],
      ));
    if (!auth.isAdmin && !isVendorMember && !isDeveloperMember) {
      throw new ForbiddenError("not authorized to update this punch item");
    }

    const requestedStatus = req.body?.status !== undefined ? String(req.body.status) : null;
    if (requestedStatus !== null && !PUNCH_STATUS.has(requestedStatus)) {
      return res.status(400).json({ error: "invalid status" });
    }

    if (auth.isAdmin || isDeveloperMember) {
      // The developer verifies a vendor's claimed fix, or reopens an item
      // it doesn't accept as actually resolved.
      if (requestedStatus && !["verified", "open"].includes(requestedStatus)) {
        return res.status(400).json({ error: "a developer may only verify or reopen a punch item" });
      }
      const item = await q1(
        `update closeout_punch_items set
           status = coalesce($2, status),
           verified_by_email = case when $2 = 'verified' then $3 else verified_by_email end,
           verified_at = case when $2 = 'verified' then now() else verified_at end,
           updated_at = now()
         where id = $1
         returning *`,
        [id, requestedStatus, auth.email ?? null],
      );
      return res.json({ item });
    }

    // The vendor may only mark ITS OWN open item resolved - it cannot
    // verify its own fix or reopen a closed item.
    if (requestedStatus !== "resolved") {
      return res.status(400).json({ error: "a vendor may only mark a punch item resolved" });
    }
    if (row.status !== "open") {
      return res.status(409).json({ error: "only an open punch item can be marked resolved" });
    }
    const item = await q1(
      `update closeout_punch_items set status = 'resolved', resolved_by_email = $2, resolved_at = now(), updated_at = now()
       where id = $1 returning *`,
      [id, auth.email ?? null],
    );
    res.json({ item });
  }),
);

// POST /packages/:packageId/warranty-claims
router.post(
  "/packages/:packageId/warranty-claims",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.params.packageId;
    const pkg = await assertDeveloperOfPackage(req, packageId);
    const description = req.body?.description ? String(req.body.description).trim() : "";
    if (!description) return res.status(400).json({ error: "description is required" });

    const vendorCompanyId = await getAwardedVendor(packageId);
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "this package has no award to file a warranty claim against" });
    }

    const claim = await q1(
      `insert into warranty_claims (package_id, building_id, vendor_company_id, description, filed_by_email)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [packageId, pkg.building_id, vendorCompanyId, description, auth.email ?? null],
    );
    res.status(201).json({ claim });
  }),
);

// PATCH /closeout/warranty-claims/:id
router.patch(
  "/closeout/warranty-claims/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const id = req.params.id;
    const row = await q1<{ building_id: string; vendor_company_id: string; status: string }>(
      `select building_id, vendor_company_id, status from warranty_claims where id = $1`,
      [id],
    );
    if (!row) throw new NotFoundError("warranty claim not found");
    if (["resolved", "denied"].includes(row.status) && !auth.isAdmin) {
      return res.status(409).json({ error: "this claim is already closed" });
    }

    const isVendorMember = !auth.isAdmin && (await isMember(auth.userId!, row.vendor_company_id));
    const isDeveloperMember =
      !auth.isAdmin &&
      !!(await q1(
        `select 1 from buildings b join company_members cm on cm.company_id = b.company_id
          where b.id = $1 and cm.user_id = $2`,
        [row.building_id, auth.userId],
      ));
    if (!auth.isAdmin && !isVendorMember && !isDeveloperMember) {
      throw new ForbiddenError("not authorized to update this warranty claim");
    }

    const requestedStatus = req.body?.status !== undefined ? String(req.body.status) : null;
    if (requestedStatus !== null && !CLAIM_STATUS.has(requestedStatus)) {
      return res.status(400).json({ error: "invalid status" });
    }
    const notes = req.body?.resolutionNotes !== undefined ? String(req.body.resolutionNotes).trim() || null : null;

    if (isVendorMember && !auth.isAdmin && !isDeveloperMember) {
      // The vendor works the claim (acknowledge -> in_progress) and may
      // mark it resolved once fixed, but never denies its own claim.
      if (!requestedStatus || !["in_progress", "resolved"].includes(requestedStatus)) {
        return res.status(400).json({ error: "a vendor may only set in_progress or resolved" });
      }
    } else if (requestedStatus && !["in_progress", "resolved", "denied"].includes(requestedStatus)) {
      return res.status(400).json({ error: "invalid status transition" });
    }

    const claim = await q1(
      `update warranty_claims set
         status = coalesce($2, status),
         resolution_notes = coalesce($3, resolution_notes),
         resolved_by_email = case when $2 in ('resolved', 'denied') then $4 else resolved_by_email end,
         resolved_at = case when $2 in ('resolved', 'denied') then now() else resolved_at end,
         updated_at = now()
       where id = $1
       returning *`,
      [id, requestedStatus, notes, auth.email ?? null],
    );
    res.json({ claim });
  }),
);

export default router;
