/**
 * Change Order Management for Divini Procure. Self-pathed; mounted in routes.ts
 * with `router.use(changeOrdersRouter)` (NO extra prefix), so the paths are
 * /api/change-orders*.
 *
 * A change order is raised by a DEVELOPER (a member of the company that owns the
 * project/building) against a vendor, capturing cost and schedule impact, and is
 * advanced through a review workflow. When investor approval is required the
 * change order carries an independent investor_approval_status that an admin (or,
 * in future, a permissioned investor) decides on. Every create and status change
 * appends an immutable change_order_audit row (actor = current user email).
 *
 * Authorization mirrors the rest of Procure (server/src/db.ts): a DEVELOPER is a
 * member of the building's owning company (buildings.company_id). Read access is
 * granted to a member of the developer company OR the vendor company, OR admin.
 * Write (create / status transitions) is the developer company member OR admin.
 * Investor-approval decisions are admin-only for now. Tables live in
 * db/schema-change-orders.sql. Integer cents. Zero em dashes by convention.
 *
 * Status lifecycle:
 *   draft -> submitted -> under_review -> approved | rejected | cancelled
 *
 * Endpoints (all requireUser):
 *   GET   /change-orders?buildingId=  | ?companyId=   -> { changeOrders: [...] }
 *   POST  /change-orders                              -> { changeOrder }
 *   GET   /change-orders/:id                          -> { changeOrder, audit: [...] }
 *   PATCH /change-orders/:id                          -> { changeOrder, investorApprovalPending? }
 *   PATCH /change-orders/:id/investor-approval        -> { changeOrder }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// Status lifecycle. draft is the create state; from there it moves forward and
// terminates at approved / rejected / cancelled.
const STATUS = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "cancelled",
] as const;
type Status = (typeof STATUS)[number];
const STATUS_SET = new Set<string>(STATUS);

// Legal forward transitions for a change order's status.
const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["under_review", "approved", "rejected", "cancelled"],
  under_review: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

// Fields a PATCH may update while a change order is still editable (draft).
const EDITABLE_FIELDS = new Set([
  "title",
  "description",
  "costImpactCents",
  "scheduleImpactDays",
  "investorApprovalRequired",
  "documentUrl",
  "coNumber",
  "packageId",
]);

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Resolve the developer (owning) company of a building. */
async function buildingDeveloperCompany(buildingId: string): Promise<string | null> {
  const row = await q1<{ company_id: string }>(`select company_id from buildings where id = $1`, [
    buildingId,
  ]);
  return row?.company_id ?? null;
}

/** Append an audit row. Never throws into the request path on its own. */
async function audit(
  changeOrderId: string,
  actorEmail: string | null,
  action: string,
  detail: unknown,
): Promise<void> {
  await q(
    `insert into change_order_audit (change_order_id, actor_email, action, detail)
     values ($1,$2,$3,$4)`,
    [changeOrderId, actorEmail, action, detail == null ? null : JSON.stringify(detail)],
  );
}

/**
 * Read authorization for one change order: member of the developer company OR
 * the vendor company, OR admin. Returns the row when allowed, else null.
 */
async function authorizeRead(
  userId: string,
  isAdmin: boolean,
  changeOrderId: string,
): Promise<any | null> {
  const co = await q1<any>(`select * from change_orders where id = $1`, [changeOrderId]);
  if (!co) return null;
  if (isAdmin) return co;
  if (await isMemberOfCompany(userId, co.developer_company_id)) return co;
  if (await isMemberOfCompany(userId, co.vendor_company_id)) return co;
  return null;
}

/**
 * Write authorization for one change order: member of the developer company, OR
 * admin. Returns the row when allowed, else null (caller distinguishes 404 vs
 * 403 via the `found` flag).
 */
async function authorizeWrite(
  userId: string,
  isAdmin: boolean,
  changeOrderId: string,
): Promise<{ co: any | null; found: boolean }> {
  const co = await q1<any>(`select * from change_orders where id = $1`, [changeOrderId]);
  if (!co) return { co: null, found: false };
  if (isAdmin) return { co, found: true };
  if (await isMemberOfCompany(userId, co.developer_company_id)) return { co, found: true };
  return { co: null, found: true };
}

// GET /change-orders?buildingId= | ?companyId= -> list change orders.
router.get(
  "/change-orders",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const buildingId = req.query.buildingId ? String(req.query.buildingId) : null;
    const companyId = req.query.companyId ? String(req.query.companyId) : null;

    if (buildingId) {
      const devCompany = await buildingDeveloperCompany(buildingId);
      if (!devCompany) return res.json({ changeOrders: [] });
      if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
        return res.status(403).json({ error: "forbidden" });
      }
      const changeOrders = await q<any>(
        `select co.*, v.name as vendor_name
           from change_orders co
           left join companies v on v.id = co.vendor_company_id
          where co.building_id = $1
          order by co.created_at desc`,
        [buildingId],
      );
      return res.json({ changeOrders });
    }

    if (companyId) {
      if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
        return res.status(403).json({ error: "forbidden" });
      }
      const changeOrders = await q<any>(
        `select co.*, v.name as vendor_name, b.name as building_name
           from change_orders co
           left join companies v on v.id = co.vendor_company_id
           left join buildings b on b.id = co.building_id
          where co.developer_company_id = $1
          order by co.created_at desc`,
        [companyId],
      );
      return res.json({ changeOrders });
    }

    res.status(400).json({ error: "buildingId or companyId required" });
  }),
);

// POST /change-orders -> create a draft change order (+ audit).
router.post(
  "/change-orders",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const {
      buildingId,
      packageId,
      vendorCompanyId,
      coNumber,
      title,
      description,
      costImpactCents,
      scheduleImpactDays,
      investorApprovalRequired,
      documentUrl,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!buildingId || typeof buildingId !== "string") {
      return res.status(400).json({ error: "buildingId required" });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }

    const devCompany = await buildingDeveloperCompany(buildingId);
    if (!devCompany) return res.status(404).json({ error: "project not found" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const investorRequired = investorApprovalRequired === true;
    const investorStatus = investorRequired ? "pending" : "not_required";

    const co = await q1<any>(
      `insert into change_orders
         (building_id, package_id, vendor_company_id, developer_company_id, co_number,
          title, description, cost_impact_cents, schedule_impact_days,
          status, investor_approval_required, investor_approval_status,
          document_url, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13)
       returning *`,
      [
        buildingId,
        packageId ? String(packageId) : null,
        vendorCompanyId ? String(vendorCompanyId) : null,
        devCompany,
        coNumber ? String(coNumber) : null,
        title.trim(),
        description ? String(description) : null,
        Number.isFinite(Number(costImpactCents)) ? Math.trunc(Number(costImpactCents)) : 0,
        Number.isFinite(Number(scheduleImpactDays)) ? Math.trunc(Number(scheduleImpactDays)) : 0,
        investorRequired,
        investorStatus,
        documentUrl ? String(documentUrl) : null,
        auth.userId,
      ],
    );
    await audit(co.id, auth.email ?? auth.userId ?? null, "created", {
      status: "draft",
      cost_impact_cents: co.cost_impact_cents,
      schedule_impact_days: co.schedule_impact_days,
      investor_approval_required: co.investor_approval_required,
    });
    res.status(201).json({ changeOrder: co });
  }),
);

// GET /change-orders/:id -> one change order + audit timeline.
router.get(
  "/change-orders/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const co = await authorizeRead(auth.userId!, auth.isAdmin, req.params.id);
    if (!co) return res.status(404).json({ error: "not found" });

    const vendor = co.vendor_company_id
      ? await q1<any>(`select name from companies where id = $1`, [co.vendor_company_id])
      : null;
    const auditRows = await q<any>(
      `select * from change_order_audit where change_order_id = $1 order by created_at asc`,
      [co.id],
    );
    res.json({
      changeOrder: { ...co, vendor_name: vendor?.name ?? null },
      audit: auditRows,
      allowedNext: TRANSITIONS[(co.status as Status) ?? "draft"] ?? [],
    });
  }),
);

// PATCH /change-orders/:id -> update status and/or editable fields (+ audit).
router.patch(
  "/change-orders/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { co, found } = await authorizeWrite(auth.userId!, auth.isAdmin, req.params.id);
    if (!found) return res.status(404).json({ error: "not found" });
    if (!co) return res.status(403).json({ error: "forbidden" });

    const body = (req.body ?? {}) as Record<string, unknown>;

    // ---- field updates (only while editable, i.e. draft) ----
    const sets: string[] = [];
    const params: unknown[] = [];
    const fieldChanges: Record<string, unknown> = {};
    if (co.status === "draft") {
      const map: Record<string, string> = {
        title: "title",
        description: "description",
        costImpactCents: "cost_impact_cents",
        scheduleImpactDays: "schedule_impact_days",
        investorApprovalRequired: "investor_approval_required",
        documentUrl: "document_url",
        coNumber: "co_number",
        packageId: "package_id",
      };
      for (const key of Object.keys(body)) {
        if (!EDITABLE_FIELDS.has(key)) continue;
        const col = map[key];
        let val: unknown = body[key];
        if (key === "costImpactCents" || key === "scheduleImpactDays") {
          val = Number.isFinite(Number(val)) ? Math.trunc(Number(val)) : 0;
        } else if (key === "investorApprovalRequired") {
          val = val === true;
        } else if (val != null) {
          val = String(val);
        }
        params.push(val);
        sets.push(`${col} = $${params.length}`);
        fieldChanges[col] = val;
      }
      // Keep investor_approval_status consistent if the requirement flips while
      // it is still in a pre-decision state (not_required <-> pending).
      if ("investorApprovalRequired" in fieldChanges) {
        const required = fieldChanges.investor_approval_required === true;
        if (
          required &&
          (co.investor_approval_status === "not_required" || !co.investor_approval_status)
        ) {
          params.push("pending");
          sets.push(`investor_approval_status = $${params.length}`);
        } else if (!required && co.investor_approval_status === "pending") {
          params.push("not_required");
          sets.push(`investor_approval_status = $${params.length}`);
        }
      }
    }

    // ---- status transition ----
    const toStatus = body.status;
    let statusChanged = false;
    if (toStatus != null) {
      if (typeof toStatus !== "string" || !STATUS_SET.has(toStatus)) {
        return res.status(400).json({ error: "valid status required" });
      }
      if (toStatus !== co.status) {
        const allowed = TRANSITIONS[co.status as Status] ?? [];
        if (!allowed.includes(toStatus as Status)) {
          return res.status(400).json({
            error: `cannot move from ${co.status} to ${toStatus}`,
            allowedNext: allowed,
          });
        }
        params.push(toStatus);
        sets.push(`status = $${params.length}`);
        statusChanged = true;
      }
    }

    if (sets.length === 0) {
      return res.json({ changeOrder: co, investorApprovalPending: false });
    }

    params.push(co.id);
    const updated = await q1<any>(
      `update change_orders set ${sets.join(", ")}, updated_at = now()
        where id = $${params.length} returning *`,
      params,
    );

    if (statusChanged) {
      await audit(co.id, auth.email ?? auth.userId ?? null, "status_changed", {
        from: co.status,
        to: toStatus,
      });
    } else {
      await audit(co.id, auth.email ?? auth.userId ?? null, "updated", fieldChanges);
    }

    // If this was an approval but investor sign-off is required and not yet
    // granted, surface a flag so the UI can warn that it is conditionally
    // approved pending investor sign-off.
    const investorApprovalPending =
      updated.status === "approved" &&
      updated.investor_approval_required === true &&
      updated.investor_approval_status !== "approved";

    res.json({ changeOrder: updated, investorApprovalPending });
  }),
);

// PATCH /change-orders/:id/investor-approval -> admin (or future permissioned
// investor) records an investor approval decision (+ audit).
router.patch(
  "/change-orders/:id/investor-approval",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    // For now only admins may decide investor approval.
    if (!auth.isAdmin) return res.status(403).json({ error: "forbidden" });

    const co = await q1<any>(`select * from change_orders where id = $1`, [req.params.id]);
    if (!co) return res.status(404).json({ error: "not found" });

    const { decision } = (req.body ?? {}) as Record<string, unknown>;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision must be approved or rejected" });
    }

    const updated = await q1<any>(
      `update change_orders set investor_approval_status = $2, updated_at = now()
        where id = $1 returning *`,
      [co.id, decision],
    );
    await audit(co.id, auth.email ?? auth.userId ?? null, "investor_approval", {
      from: co.investor_approval_status,
      to: decision,
    });
    res.json({ changeOrder: updated });
  }),
);

export default router;
