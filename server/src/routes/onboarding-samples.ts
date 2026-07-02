/**
 * Category Vendor-Onboarding Templates + Sample Request workflow for Divini
 * Procure. Self-pathed; mounted in routes.ts with
 * `router.use(onboardingSamplesRouter)` (NO extra prefix), so the paths are
 * /api/vendor-onboarding-templates* and /api/sample-requests*.
 *
 * Two concerns:
 *
 *   1. vendor_onboarding_templates: a per-category checklist of the documents
 *      and profile fields a vendor must supply to be onboarded for a category.
 *      Readable by any authed user (a vendor wants to see what is required for
 *      its category); only an admin may upsert / extend a category.
 *
 *   2. sample_requests: a developer (a member of the buyer company) requests a
 *      physical material sample from a vendor, optionally tied to a project
 *      (buildings). Lifecycle:
 *          requested -> vendor_review -> shipped -> delivered
 *                    -> approved | rejected
 *      The VENDOR may set vendor_review / shipped (+ tracking_number +
 *      vendor_response). The DEVELOPER may set approved / rejected (+
 *      approval_notes). An admin may set anything. delivered is a transitional
 *      state the developer flips into before approving (so either side can mark
 *      a shipment delivered); approval/rejection is developer-only.
 *
 * Authorization mirrors the rest of Procure (server/src/db.ts): membership is
 * `select 1 from company_members where user_id=$1 and company_id=$2`. A read is
 * allowed to a member of the developer company OR the vendor company, OR admin.
 * Tables live in db/schema-onboarding-samples.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const MATERIAL_TYPES = new Set<string>([
  "tile",
  "flooring",
  "fabric",
  "drapery",
  "stone",
  "paint",
  "hardware",
  "finish",
  "other",
]);

// Sample request lifecycle and the legal forward transitions per actor role.
const SAMPLE_STATUS = new Set<string>([
  "requested",
  "vendor_review",
  "shipped",
  "delivered",
  "approved",
  "rejected",
]);

// Statuses a VENDOR member may move a request into.
const VENDOR_STATUSES = new Set<string>(["vendor_review", "shipped"]);
// Statuses a DEVELOPER member may move a request into. delivered is the
// developer acknowledging receipt; approved / rejected are the final decision.
const DEVELOPER_STATUSES = new Set<string>(["delivered", "approved", "rejected"]);

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

// ===========================================================================
// VENDOR ONBOARDING TEMPLATES
// ===========================================================================

// GET /vendor-onboarding-templates -> list every category template.
router.get(
  "/vendor-onboarding-templates",
  requireUser,
  h(async (_req, res) => {
    const templates = await q<any>(
      `select * from vendor_onboarding_templates order by category asc`,
    );
    res.json({ templates });
  }),
);

// GET /vendor-onboarding-templates/:category -> one category template.
router.get(
  "/vendor-onboarding-templates/:category",
  requireUser,
  h(async (req, res) => {
    const template = await q1<any>(
      `select * from vendor_onboarding_templates where category = $1`,
      [req.params.category],
    );
    if (!template) return res.status(404).json({ error: "not found" });
    res.json({ template });
  }),
);

// POST /admin/vendor-onboarding-templates -> upsert a category (admin only).
router.post(
  "/admin/vendor-onboarding-templates",
  requireAdmin,
  h(async (req, res) => {
    const { category, requiredDocs, requiredFields, notes } = (req.body ?? {}) as Record<
      string,
      unknown
    >;
    if (!category || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "category required" });
    }
    const docs = Array.isArray(requiredDocs) ? requiredDocs.map((x) => String(x)) : [];
    const fields = Array.isArray(requiredFields) ? requiredFields.map((x) => String(x)) : [];
    const template = await q1<any>(
      `insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
       values ($1,$2,$3,$4)
       on conflict (category) do update set
         required_docs = excluded.required_docs,
         required_fields = excluded.required_fields,
         notes = excluded.notes
       returning *`,
      [category.trim(), docs, fields, notes == null ? null : String(notes)],
    );
    res.status(201).json({ template });
  }),
);

// ===========================================================================
// SAMPLE REQUESTS
// ===========================================================================

// GET /sample-requests?developerCompanyId= | ?vendorCompanyId= -> list.
router.get(
  "/sample-requests",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const developerCompanyId = req.query.developerCompanyId
      ? String(req.query.developerCompanyId)
      : null;
    const vendorCompanyId = req.query.vendorCompanyId ? String(req.query.vendorCompanyId) : null;

    if (developerCompanyId) {
      if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, developerCompanyId))) {
        return res.status(403).json({ error: "forbidden" });
      }
      const sampleRequests = await q<any>(
        `select sr.*, v.name as vendor_name, b.name as project_name
           from sample_requests sr
           left join companies v on v.id = sr.vendor_company_id
           left join buildings b on b.id = sr.project_id
          where sr.developer_company_id = $1
          order by sr.created_at desc`,
        [developerCompanyId],
      );
      return res.json({ sampleRequests });
    }

    if (vendorCompanyId) {
      if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, vendorCompanyId))) {
        return res.status(403).json({ error: "forbidden" });
      }
      const sampleRequests = await q<any>(
        `select sr.*, d.name as developer_name, b.name as project_name
           from sample_requests sr
           left join companies d on d.id = sr.developer_company_id
           left join buildings b on b.id = sr.project_id
          where sr.vendor_company_id = $1
          order by sr.created_at desc`,
        [vendorCompanyId],
      );
      return res.json({ sampleRequests });
    }

    res.status(400).json({ error: "developerCompanyId or vendorCompanyId required" });
  }),
);

// POST /sample-requests -> a developer creates a sample request.
router.post(
  "/sample-requests",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const {
      developerCompanyId,
      vendorCompanyId,
      projectId,
      materialType,
      productLabel,
      quantity,
      shipToAddress,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!developerCompanyId || typeof developerCompanyId !== "string") {
      return res.status(400).json({ error: "developerCompanyId required" });
    }
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, developerCompanyId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (typeof materialType !== "string" || !MATERIAL_TYPES.has(materialType)) {
      return res.status(400).json({ error: "valid materialType required" });
    }
    if (!productLabel || typeof productLabel !== "string" || !productLabel.trim()) {
      return res.status(400).json({ error: "productLabel required" });
    }

    const qty = Number.isFinite(Number(quantity)) ? Math.max(1, Math.trunc(Number(quantity))) : 1;

    const sampleRequest = await q1<any>(
      `insert into sample_requests
         (project_id, developer_company_id, vendor_company_id, material_type,
          product_label, quantity, ship_to_address, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'requested',$8)
       returning *`,
      [
        projectId ? String(projectId) : null,
        developerCompanyId,
        vendorCompanyId ? String(vendorCompanyId) : null,
        materialType,
        productLabel.trim(),
        qty,
        shipToAddress ? String(shipToAddress) : null,
        auth.email ?? auth.userId ?? null,
      ],
    );
    res.status(201).json({ sampleRequest });
  }),
);

// PATCH /sample-requests/:id -> advance a sample request.
//   vendor member  -> vendor_review | shipped (+ tracking_number, vendor_response)
//   developer member -> delivered | approved | rejected (+ approval_notes)
//   admin -> any of the above
router.patch(
  "/sample-requests/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const sr = await q1<any>(`select * from sample_requests where id = $1`, [req.params.id]);
    if (!sr) return res.status(404).json({ error: "not found" });

    const isDeveloper =
      auth.isAdmin || (await isMemberOfCompany(auth.userId!, sr.developer_company_id));
    const isVendor =
      auth.isAdmin || (await isMemberOfCompany(auth.userId!, sr.vendor_company_id));
    if (!isDeveloper && !isVendor) {
      return res.status(403).json({ error: "forbidden" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];

    // ---- status transition ----
    const toStatus = body.status;
    if (toStatus != null) {
      if (typeof toStatus !== "string" || !SAMPLE_STATUS.has(toStatus)) {
        return res.status(400).json({ error: "valid status required" });
      }
      // Enforce who may set which status. Admin bypasses the role gate.
      const vendorMay = auth.isAdmin || isVendor;
      const developerMay = auth.isAdmin || isDeveloper;
      const allowed =
        (vendorMay && VENDOR_STATUSES.has(toStatus)) ||
        (developerMay && DEVELOPER_STATUSES.has(toStatus));
      if (!allowed) {
        return res
          .status(403)
          .json({ error: `your role may not set status to ${toStatus}` });
      }
      params.push(toStatus);
      sets.push(`status = $${params.length}`);
    }

    // ---- vendor-only fields ----
    if (body.trackingNumber !== undefined) {
      if (!(auth.isAdmin || isVendor)) {
        return res.status(403).json({ error: "only the vendor may set tracking_number" });
      }
      params.push(body.trackingNumber == null ? null : String(body.trackingNumber));
      sets.push(`tracking_number = $${params.length}`);
    }
    if (body.vendorResponse !== undefined) {
      if (!(auth.isAdmin || isVendor)) {
        return res.status(403).json({ error: "only the vendor may set vendor_response" });
      }
      params.push(body.vendorResponse == null ? null : String(body.vendorResponse));
      sets.push(`vendor_response = $${params.length}`);
    }

    // ---- developer-only fields ----
    if (body.approvalNotes !== undefined) {
      if (!(auth.isAdmin || isDeveloper)) {
        return res.status(403).json({ error: "only the developer may set approval_notes" });
      }
      params.push(body.approvalNotes == null ? null : String(body.approvalNotes));
      sets.push(`approval_notes = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.json({ sampleRequest: sr });
    }

    params.push(sr.id);
    const updated = await q1<any>(
      `update sample_requests set ${sets.join(", ")}, updated_at = now()
        where id = $${params.length} returning *`,
      params,
    );
    res.json({ sampleRequest: updated });
  }),
);

export default router;
