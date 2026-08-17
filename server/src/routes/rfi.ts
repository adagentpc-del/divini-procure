/**
 * RFI (Request for Information) workflow for Divini Procure (fresh
 * competitive scan, 2026-08-17 - docs/competitive-analysis-2026-08.md: a
 * tracked, assignable RFI log is baseline project-communication
 * infrastructure across every general-purpose competitor and was entirely
 * absent from this codebase). Self-pathed under /rfis, mounted in routes.ts.
 *
 * A VENDOR holding an ACTIVE award at a building raises an RFI (a question,
 * optionally scoped to one of its packages) addressed to the DEVELOPER (the
 * building's owning company). Lifecycle: open -> answered -> closed.
 *
 * Bidirectional, unlike field-log: the vendor asks and may close its own
 * RFI; only the developer (or admin) may write an answer. RLS
 * (db/schema-rfi.sql) enforces the row-visibility boundary (a vendor never
 * sees another vendor's RFIs at the same building); this file enforces the
 * narrower FIELD-level contract per role, matching change-orders.ts's
 * EDITABLE_FIELDS convention - RLS says who may touch the row, this says
 * which fields they may set.
 *
 * Endpoints (all requireUser):
 *   GET   /rfis?buildingId=            -> { rfis: [...] }
 *   POST  /rfis                        -> { rfi }
 *   GET   /rfis/:id                    -> { rfi }
 *   PATCH /rfis/:id                    -> { rfi }
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

const STATUS = ["open", "answered", "closed"] as const;
type Status = (typeof STATUS)[number];
const STATUS_SET = new Set<string>(STATUS);

/** True when the user is a member of the given company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/**
 * Read access to a building's RFI log: the building owner, a member of a
 * vendor company with any award (active or cancelled) at this building, or
 * admin - mirrors field-log.ts's assertCanReadFieldLog, so a vendor keeps
 * read access to its own past RFIs after an award ends.
 */
async function assertCanReadRfis(req: Request, buildingId: string): Promise<void> {
  const auth = getAuth(req);
  const building = await q1<{ id: string }>(`select id from buildings where id = $1`, [buildingId]);
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
    `select 1 from awards a
       join company_members cm on cm.company_id = a.vendor_company_id
      where a.building_id = $1 and cm.user_id = $2`,
    [buildingId, auth.userId],
  );
  if (vendor) return;

  throw new ForbiddenError("not authorized to view this site's RFI log");
}

/** Write access to raise a new RFI: member of the vendor company, AND that
 * vendor must hold an ACTIVE award at this building. */
async function assertVendorCanRaiseRfiAt(req: Request, buildingId: string, vendorCompanyId: string): Promise<void> {
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMember(auth.userId!, vendorCompanyId))) {
    throw new ForbiddenError("not a member of this vendor company");
  }
  const active = await q1(
    `select 1 from awards where building_id = $1 and vendor_company_id = $2 and status = 'active'`,
    [buildingId, vendorCompanyId],
  );
  if (!active) throw new ForbiddenError("no active award for this vendor at this building");
}

// GET /rfis/my-sites?companyId= -- buildings where this vendor company holds
// (or has ever held) an award, for the site picker. Deliberately NOT
// active-award-only like field-log's /my-sites: assertCanReadRfis grants a
// vendor read access to its own historical RFIs at a building even after
// its award there is cancelled, so the picker must keep that building
// selectable or those RFIs become unreachable. has_active_award tells the
// UI whether to also offer "ask a new question" for that site (creation
// still requires an active award, enforced server-side either way).
router.get(
  "/rfis/my-sites",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const sites = await q(
      `select b.id, b.name, b.location, bool_or(a.status = 'active') as has_active_award
         from awards a
         join buildings b on b.id = a.building_id
        where a.vendor_company_id = $1
        group by b.id, b.name, b.location
        order by b.name`,
      [companyId],
    );
    res.json({ sites });
  }),
);

// GET /rfis?buildingId=
router.get(
  "/rfis",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await assertCanReadRfis(req, buildingId);
    // RLS further restricts a vendor caller to only its own company's rows;
    // the building owner/admin see every vendor's RFIs at this building.
    const rfis = await q(`select * from rfis where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ rfis });
  }),
);

// GET /rfis/:id
router.get(
  "/rfis/:id",
  requireUser,
  h(async (req, res) => {
    // RLS hides rows this caller may not see; a hidden row and a missing
    // row are indistinguishable to the caller by design, both 404.
    const rfi = await q1(`select * from rfis where id = $1`, [req.params.id]);
    if (!rfi) throw new NotFoundError("RFI not found");
    res.json({ rfi });
  }),
);

// POST /rfis
router.post(
  "/rfis",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as {
      buildingId?: string;
      packageId?: string;
      vendorCompanyId?: string;
      subject?: string;
      question?: string;
      dueDate?: string;
    };
    const buildingId = body.buildingId ? String(body.buildingId) : "";
    const vendorCompanyId = body.vendorCompanyId ? String(body.vendorCompanyId) : "";
    const subject = body.subject ? String(body.subject).trim() : "";
    const question = body.question ? String(body.question).trim() : "";
    if (!buildingId || !vendorCompanyId || !subject || !question) {
      return res.status(400).json({ error: "buildingId, vendorCompanyId, subject, and question are required" });
    }
    await assertVendorCanRaiseRfiAt(req, buildingId, vendorCompanyId);

    const packageId = body.packageId ? String(body.packageId) : null;
    const dueDate = body.dueDate ? String(body.dueDate) : null;

    if (packageId) {
      // Without this, a caller could tag an RFI to a package outside this
      // building (or awarded to a different vendor entirely), producing a
      // misleading cross-project/cross-vendor record - the UI only offers
      // packages at the selected building, but the API must not trust that.
      const validPackage = await q1(
        `select 1 from packages p
           join awards a on a.package_id = p.id
          where p.id = $1 and p.building_id = $2 and a.vendor_company_id = $3`,
        [packageId, buildingId, vendorCompanyId],
      );
      if (!validPackage) {
        return res.status(400).json({ error: "packageId must be a package at this building awarded to this vendor" });
      }
    }

    const building = await q1<{ company_id: string }>(`select company_id from buildings where id = $1`, [buildingId]);
    const developerCompanyId = building?.company_id ?? null;

    // Atomic per-building counter, not a `count(*)` of existing rows - see
    // db/schema-rfi.sql's rfi_counters comment for why: a plain count would
    // run under this vendor's own RLS-restricted view of the table and
    // could collide with another vendor's numbering at the same building.
    const counter = await q1<{ next_number: number }>(
      `insert into rfi_counters (building_id, next_number) values ($1, 2)
       on conflict (building_id) do update set next_number = rfi_counters.next_number + 1
       returning next_number - 1 as next_number`,
      [buildingId],
    );
    const rfiNumber = `RFI-${counter?.next_number ?? 1}`;

    const rfi = await q1(
      `insert into rfis (building_id, package_id, vendor_company_id, developer_company_id, rfi_number, subject, question, due_date, asked_by_email)
       values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9)
       returning *`,
      [buildingId, packageId, vendorCompanyId, developerCompanyId, rfiNumber, subject, question, dueDate, auth.email ?? null],
    );
    res.status(201).json({ rfi });
  }),
);

// PATCH /rfis/:id
router.patch(
  "/rfis/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const id = req.params.id;
    const row = await q1<{
      building_id: string;
      vendor_company_id: string;
      developer_company_id: string | null;
      status: Status;
    }>(`select building_id, vendor_company_id, developer_company_id, status from rfis where id = $1`, [id]);
    if (!row) throw new NotFoundError("RFI not found");

    const isVendorMember = !auth.isAdmin && (await isMember(auth.userId!, row.vendor_company_id));
    const isDeveloperMember =
      !auth.isAdmin && row.developer_company_id ? await isMember(auth.userId!, row.developer_company_id) : false;
    if (!auth.isAdmin && !isVendorMember && !isDeveloperMember) {
      throw new ForbiddenError("not authorized to update this RFI");
    }
    if (row.status === "closed" && !auth.isAdmin) {
      return res.status(409).json({ error: "RFI is already closed" });
    }

    const body = (req.body ?? {}) as { answer?: string; status?: string };
    const requestedStatus = body.status !== undefined ? String(body.status) : null;
    if (requestedStatus !== null && !STATUS_SET.has(requestedStatus)) {
      return res.status(400).json({ error: "invalid status" });
    }

    if (auth.isAdmin || isDeveloperMember) {
      // The developer answers the question and/or advances status. Answer
      // text is developer-only - the vendor asks, it does not answer its
      // own question.
      const answer = body.answer !== undefined ? String(body.answer).trim() : null;
      let nextStatus: Status | null = requestedStatus as Status | null;
      if (!nextStatus && answer) nextStatus = "answered";
      if (nextStatus && !["answered", "closed"].includes(nextStatus)) {
        return res.status(400).json({ error: "a developer may only set status to answered or closed" });
      }
      const rfi = await q1(
        `update rfis set
           answer = coalesce($2, answer),
           answered_by_email = case when $2 is not null then $3 else answered_by_email end,
           answered_at = case when $2 is not null then now() else answered_at end,
           status = coalesce($4, status),
           updated_at = now()
         where id = $1
         returning *`,
        [id, answer || null, auth.email ?? null, nextStatus],
      );
      return res.json({ rfi });
    }

    // The vendor may only close its own RFI (acknowledging the answer, or
    // withdrawing an open question) - it may never set an answer or reopen.
    if (isVendorMember) {
      if (body.answer !== undefined) {
        throw new ForbiddenError("only the developer may answer an RFI");
      }
      if (requestedStatus !== "closed") {
        return res.status(400).json({ error: "a vendor may only close its own RFI" });
      }
      const rfi = await q1(
        `update rfis set status = 'closed', updated_at = now() where id = $1 returning *`,
        [id],
      );
      return res.json({ rfi });
    }

    throw new ForbiddenError("not authorized to update this RFI");
  }),
);

export default router;
