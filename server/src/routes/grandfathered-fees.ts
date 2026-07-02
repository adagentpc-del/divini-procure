/**
 * Divini Procure - GRANDFATHERED EXISTING-RELATIONSHIP FEE routes.
 *
 * Mounted under /api in routes.ts, so full paths are /api/relationships/... and
 * /api/admin/relationships/...
 *
 * Member endpoints (requireUser, scoped by company membership):
 *   POST /relationships/confirm-existing   developer attests a pre-existing pair
 *   GET  /relationships/mine?companyId=     developer's pairs + fee status
 *   GET  /relationships/vendor?companyId=   vendor's developer pairs + fee status
 *   GET  /relationships/fee?developerCompanyId=&vendorCompanyId=  effective fee for a pair
 *
 * Admin endpoints (requireAdmin):
 *   GET   /admin/relationships?status=                review queue
 *   GET   /admin/relationships/:id                    detail + audit + risk + fee
 *   PATCH /admin/relationships/:id/review             { decision, notes }
 *   PATCH /admin/relationships/:id/override           { feePercentage, reason }
 *   PATCH /admin/relationships/:id/dispute            { notes }
 *   PATCH /admin/relationships/:id/deactivate         { notes }
 *
 * The 2% rate is only set by admin approval/override; nothing here auto-applies
 * it. Every write path appends to dvr_audit_log via the data layer.
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { userCompanyIds } from "../db.js";
import { q1 } from "../pool.js";
import {
  confirmExistingRelationship,
  listForDeveloper,
  listForVendor,
  listForAdmin,
  getById,
  getByPair,
  getAudit,
  adminReview,
  adminOverride,
  setLifecycle,
  effectiveFee,
  riskFlags,
  assertMember,
  type RelationshipRow,
} from "../lib/relationships.js";
import { EXISTING_RELATIONSHIP_TYPES, type ExistingRelationshipType } from "../lib/fee-rules.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Developer attestation (the required existing-relationship checkbox)
// ---------------------------------------------------------------------------
router.post(
  "/relationships/confirm-existing",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const {
      developerCompanyId,
      vendorCompanyId,
      projectId,
      relationshipType,
      notes,
      supportingDocumentUrl,
      confirmed,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!developerCompanyId || !vendorCompanyId) {
      return res.status(400).json({ error: "developerCompanyId and vendorCompanyId required" });
    }
    if (confirmed !== true) {
      return res.status(400).json({ error: "confirmation is required" });
    }
    const type = EXISTING_RELATIONSHIP_TYPES.includes(relationshipType as ExistingRelationshipType)
      ? (relationshipType as ExistingRelationshipType)
      : null;
    if (!type) {
      return res.status(400).json({ error: "valid relationshipType required" });
    }

    const relationship = await confirmExistingRelationship({
      userId: auth.userId!,
      email: auth.email,
      developerCompanyId: String(developerCompanyId),
      vendorCompanyId: String(vendorCompanyId),
      projectId: projectId ? String(projectId) : null,
      relationshipType: type,
      notes: notes ? String(notes) : null,
      supportingDocumentUrl: supportingDocumentUrl ? String(supportingDocumentUrl) : null,
    });

    res.status(201).json({ relationship, fee: effectiveFee(relationship) });
  }),
);

// ---------------------------------------------------------------------------
// Developer view: my vendor relationships + fee status
// ---------------------------------------------------------------------------
router.get(
  "/relationships/mine",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const rows = (await listForDeveloper(companyId)) as RelationshipRow[];
    res.json({
      relationships: rows.map((r) => ({ ...r, fee: effectiveFee(r) })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Vendor view: developer relationships + fee status
// ---------------------------------------------------------------------------
router.get(
  "/relationships/vendor",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const rows = (await listForVendor(companyId)) as RelationshipRow[];
    res.json({
      relationships: rows.map((r) => ({ ...r, fee: effectiveFee(r) })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Effective fee for a pair (used by award / payment flows to show the rule)
// ---------------------------------------------------------------------------
router.get(
  "/relationships/fee",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const developerCompanyId = String(req.query.developerCompanyId || "");
    const vendorCompanyId = String(req.query.vendorCompanyId || "");
    if (!developerCompanyId || !vendorCompanyId) {
      return res.status(400).json({ error: "developerCompanyId and vendorCompanyId required" });
    }
    // caller must be a member of either side of the pair
    const mine = await userCompanyIds(auth.userId!);
    if (!auth.isAdmin && !mine.includes(developerCompanyId) && !mine.includes(vendorCompanyId)) {
      return res.status(403).json({ error: "not a party to this relationship" });
    }
    const rel = await getByPair(developerCompanyId, vendorCompanyId);
    res.json({ relationship: rel, fee: effectiveFee(rel) });
  }),
);

// ===========================================================================
// ADMIN
// ===========================================================================
router.get(
  "/admin/relationships",
  requireAdmin,
  h(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = (await listForAdmin(status)) as (RelationshipRow & {
      developer_name: string;
      vendor_name: string;
    })[];
    res.json({
      relationships: rows.map((r) => ({
        ...r,
        fee: effectiveFee(r),
        risk: riskFlags(r),
      })),
    });
  }),
);

router.get(
  "/admin/relationships/:id",
  requireAdmin,
  h(async (req, res) => {
    const rel = await getById(req.params.id);
    if (!rel) return res.status(404).json({ error: "relationship not found" });
    const developer = await q1(`select id, name, kind, email from companies where id = $1`, [
      rel.developer_company_id,
    ]);
    const vendor = await q1(`select id, name, kind, email from companies where id = $1`, [
      rel.vendor_company_id,
    ]);
    const audit = await getAudit(rel.id);
    res.json({ relationship: rel, developer, vendor, audit, fee: effectiveFee(rel), risk: riskFlags(rel) });
  }),
);

router.patch(
  "/admin/relationships/:id/review",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { decision, notes } = (req.body ?? {}) as Record<string, unknown>;
    if (!["approve", "reject", "needs_more_info"].includes(String(decision))) {
      return res.status(400).json({ error: "decision must be approve | reject | needs_more_info" });
    }
    const relationship = await adminReview({
      id: req.params.id,
      decision: decision as "approve" | "reject" | "needs_more_info",
      adminUserId: auth.userId!,
      adminEmail: auth.email,
      notes: notes ? String(notes) : null,
    });
    res.json({ relationship, fee: effectiveFee(relationship) });
  }),
);

router.patch(
  "/admin/relationships/:id/override",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { feePercentage, reason } = (req.body ?? {}) as Record<string, unknown>;
    const pct = Number(feePercentage);
    if (!Number.isFinite(pct) || pct < 0) {
      return res.status(400).json({ error: "feePercentage must be a non-negative number" });
    }
    const relationship = await adminOverride({
      id: req.params.id,
      feePercentage: pct,
      adminUserId: auth.userId!,
      adminEmail: auth.email,
      reason: reason ? String(reason) : null,
    });
    res.json({ relationship, fee: effectiveFee(relationship) });
  }),
);

router.patch(
  "/admin/relationships/:id/dispute",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { notes } = (req.body ?? {}) as Record<string, unknown>;
    const relationship = await setLifecycle({
      id: req.params.id,
      state: "disputed",
      adminUserId: auth.userId!,
      adminEmail: auth.email,
      notes: notes ? String(notes) : null,
    });
    res.json({ relationship, fee: effectiveFee(relationship) });
  }),
);

router.patch(
  "/admin/relationships/:id/deactivate",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { notes } = (req.body ?? {}) as Record<string, unknown>;
    const relationship = await setLifecycle({
      id: req.params.id,
      state: "inactive",
      adminUserId: auth.userId!,
      adminEmail: auth.email,
      notes: notes ? String(notes) : null,
    });
    res.json({ relationship, fee: effectiveFee(relationship) });
  }),
);

export default router;
