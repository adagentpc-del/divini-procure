/**
 * Submittal & Approval management for Divini Procure. Mounted under /submittals
 * in routes.ts so the paths are /api/submittals*.
 *
 * A construction-style submittal lifecycle layered on a procurement package. A
 * submittal is created (status 'draft'), then advances through a linear status
 * order, with the ability to send it back to 'revision_required'. Every change
 * appends an immutable submittal_history row (actor = current user email).
 *
 * Authorization mirrors the rest of Procure (server/src/db.ts): the PACKAGE
 * OWNER (a member of the company that owns the package's building, via
 * userOwnsPackage) OR the ASSIGNED VENDOR company (a member of the submittal's
 * vendor_company_id) may read and transition. Admins are always allowed. The
 * guard reuses the same company_members + packages/buildings joins as db.ts.
 * Tables live in db/schema-approvals.sql. Zero em dashes by convention.
 *
 * Linear status order (send-back to revision_required allowed from any
 * post-submitted stage):
 *   draft -> submitted -> review -> revision_required -> approved
 *         -> ordered -> delivered -> installed -> closed
 *
 * Endpoints (all requireUser):
 *   POST /submittals               { packageId, title, type?, lineItemId?, vendorCompanyId? }
 *   GET  /submittals/:packageId    -> { submittals: [...] } latest status + history count
 *   GET  /submittals/item/:id      -> { submittal, history: [...] } full timeline
 *   POST /submittals/:id/transition { toStatus, comments? }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// The submittal lifecycle. Linear forward order; any stage at or beyond
// 'submitted' may also be sent back to 'revision_required', and
// 'revision_required' may be resubmitted to 'submitted'.
const STATUS_ORDER = [
  "draft",
  "submitted",
  "review",
  "revision_required",
  "approved",
  "ordered",
  "delivered",
  "installed",
  "closed",
] as const;
type Status = (typeof STATUS_ORDER)[number];

const STATUS_SET = new Set<string>(STATUS_ORDER);

/** Compute the set of statuses a submittal may legally move to from `from`. */
function allowedTransitions(from: string): Status[] {
  const next: Status[] = [];
  const idx = STATUS_ORDER.indexOf(from as Status);
  if (idx < 0) return next;
  // Forward one step along the linear order.
  const forward = STATUS_ORDER[idx + 1];
  if (forward) next.push(forward);
  // Send back to revision_required from any reviewed/active stage (i.e. once
  // it has been submitted), except when it is already there.
  if (idx >= STATUS_ORDER.indexOf("submitted") && from !== "revision_required") {
    if (!next.includes("revision_required")) next.push("revision_required");
  }
  // From revision_required the natural move is back to submitted (the forward
  // step already covers 'approved'; resubmission to 'submitted' is also valid).
  if (from === "revision_required" && !next.includes("submitted")) {
    next.push("submitted");
  }
  return next;
}

/** True when the signed-in user owns the package (mirrors db.ts userOwnsPackage). */
async function userOwnsPackage(userId: string, packageId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, userId],
  );
  return !!row;
}

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

/**
 * Authorize package-level access: package owner OR (for vendor creation) a
 * member of the supplied vendor company, OR admin. Returns true if allowed.
 */
async function canAccessPackage(
  userId: string,
  isAdmin: boolean,
  packageId: string,
  vendorCompanyId: string | null,
): Promise<boolean> {
  if (isAdmin) return true;
  if (await userOwnsPackage(userId, packageId)) return true;
  if (vendorCompanyId && (await isMemberOfCompany(userId, vendorCompanyId))) return true;
  return false;
}

/**
 * Authorize submittal-level access: package owner OR the submittal's assigned
 * vendor company, OR admin. Returns the submittal row when allowed, else null.
 */
async function authorizeSubmittal(
  userId: string,
  isAdmin: boolean,
  submittalId: string,
): Promise<any | null> {
  const s = await q1<any>(`select * from submittals where id = $1`, [submittalId]);
  if (!s) return null;
  if (isAdmin) return s;
  if (await userOwnsPackage(userId, s.package_id)) return s;
  if (await isMemberOfCompany(userId, s.vendor_company_id)) return s;
  return null;
}

// POST /submittals -> create a submittal in 'draft' + initial history row.
router.post(
  "/submittals",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { packageId, title, type, lineItemId, vendorCompanyId } =
      (req.body ?? {}) as Record<string, unknown>;

    if (!packageId || typeof packageId !== "string") {
      return res.status(400).json({ error: "packageId required" });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }
    const vendor = vendorCompanyId ? String(vendorCompanyId) : null;

    const allowed = await canAccessPackage(auth.userId!, auth.isAdmin, packageId, vendor);
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const submittal = await q1<any>(
      `insert into submittals
         (package_id, line_item_id, vendor_company_id, title, type, current_status, created_by)
       values ($1,$2,$3,$4,$5,'draft',$6)
       returning *`,
      [
        packageId,
        lineItemId ? String(lineItemId) : null,
        vendor,
        title.trim(),
        type ? String(type) : null,
        auth.userId,
      ],
    );
    await q(
      `insert into submittal_history (submittal_id, status, actor, comments)
       values ($1,'draft',$2,$3)`,
      [submittal.id, auth.email ?? auth.userId, "Submittal created."],
    );
    res.status(201).json({ submittal });
  }),
);

// GET /submittals/:packageId -> list for a package with history counts.
router.get(
  "/submittals/:packageId",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.params.packageId;

    // A package owner sees all submittals on the package; a vendor sees only
    // their own company's submittals; otherwise nothing. Admin sees all.
    const owner = auth.isAdmin || (await userOwnsPackage(auth.userId!, packageId));
    const myCompanies = (
      await q<{ company_id: string }>(
        `select company_id from company_members where user_id = $1`,
        [auth.userId],
      )
    ).map((r) => r.company_id);

    if (!owner && myCompanies.length === 0) return res.json({ submittals: [] });

    const params: unknown[] = [packageId];
    let sql = `select s.*, c.name as vendor_name,
                 (select count(*) from submittal_history hh where hh.submittal_id = s.id) as history_count
               from submittals s
               left join companies c on c.id = s.vendor_company_id
              where s.package_id = $1`;
    if (!owner) {
      params.push(myCompanies);
      sql += ` and s.vendor_company_id = any($2)`;
    }
    sql += ` order by s.created_at desc`;
    const submittals = await q<any>(sql, params);
    res.json({ submittals });
  }),
);

// GET /submittals/item/:id -> one submittal + full history timeline.
router.get(
  "/submittals/item/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const s = await authorizeSubmittal(auth.userId!, auth.isAdmin, req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });

    const vendor = s.vendor_company_id
      ? await q1<any>(`select name from companies where id = $1`, [s.vendor_company_id])
      : null;
    const history = await q<any>(
      `select * from submittal_history where submittal_id = $1 order by created_at asc`,
      [s.id],
    );
    const submittal = { ...s, vendor_name: vendor?.name ?? null };
    res.json({ submittal, history, allowedNext: allowedTransitions(s.current_status) });
  }),
);

// POST /submittals/:id/transition -> validate + apply a status change.
router.post(
  "/submittals/:id/transition",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { toStatus, comments } = (req.body ?? {}) as Record<string, unknown>;

    if (!toStatus || typeof toStatus !== "string" || !STATUS_SET.has(toStatus)) {
      return res.status(400).json({ error: "valid toStatus required" });
    }

    const s = await authorizeSubmittal(auth.userId!, auth.isAdmin, req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });

    const allowed = allowedTransitions(s.current_status);
    if (!allowed.includes(toStatus as Status)) {
      return res.status(400).json({
        error: `cannot move from ${s.current_status} to ${toStatus}`,
        allowedNext: allowed,
      });
    }

    const updated = await q1<any>(
      `update submittals set current_status = $2, updated_at = now()
        where id = $1 returning *`,
      [s.id, toStatus],
    );
    await q(
      `insert into submittal_history (submittal_id, status, actor, comments)
       values ($1,$2,$3,$4)`,
      [
        s.id,
        toStatus,
        auth.email ?? auth.userId,
        comments && String(comments).trim() ? String(comments).trim() : null,
      ],
    );
    res.json({ submittal: updated, allowedNext: allowedTransitions(toStatus) });
  }),
);

export default router;
