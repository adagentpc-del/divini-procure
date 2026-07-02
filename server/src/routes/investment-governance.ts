/**
 * Divini Procure - INVESTMENT GOVERNANCE routes.
 *
 * ADDITIVE governance layer mounted under /api (self-pathed). It sits ALONGSIDE
 * routes/investment.ts and does NOT touch it. It manages:
 *
 *   - BROKER / capital-introducer profiles (a user onboards, an admin reviews).
 *   - INVESTOR permission LEVELS (admin grants explicit, scoped capabilities).
 *   - PER-PROGRAM compliance state (legal + compliance review, disclosure,
 *     exemption, restricted-materials flag; admin-only writes).
 *   - DOCUMENT access logging (append-only audit trail).
 *
 * COMPLIANCE INVARIANTS enforced here:
 *   - Nothing in this file verifies accreditation, approves brokers/investors,
 *     or publishes offerings automatically. Every advancing status change is an
 *     explicit admin (requireAdmin) action.
 *   - Brokers self-report; status starts at pending_review and only an admin
 *     advances it.
 *   - Compliance reads are gated to the owning company's members or an admin.
 *
 * Router convention: const h=(fn)=>(req,res,next)=>fn(req,res).catch(next).
 * Errors map via the shared errorHandler (ForbiddenError->403, NotFoundError->404).
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const BROKER_TYPES = [
  "capital_introducer",
  "broker",
  "advisor",
  "referral_partner",
  "family_office_rep",
];
const PERMISSION_LEVELS = [
  "investor_basic",
  "investor_budget",
  "investor_approval",
  "owner_full",
  "asset_manager",
];
const REVIEW_STATES = ["not_started", "in_review", "cleared", "flagged"];

/** Throw unless the user is a member of the company. */
async function assertMember(userId: string, companyId: string): Promise<void> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  if (!row) throw new ForbiddenError("not a member of this company");
}

// ===========================================================================
// BROKER / CAPITAL INTRODUCER (user self-service + admin review)
// ===========================================================================

router.get(
  "/broker/me",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const row = await q1<any>(`select * from broker_profiles where user_id = $1`, [auth.userId]);
    res.json(row ?? null);
  }),
);

router.post(
  "/broker/onboard",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const brokerType = String(b.brokerType || b.broker_type || "");
    if (!BROKER_TYPES.includes(brokerType)) {
      return res.status(400).json({ error: "invalid brokerType" });
    }
    const licenseStatus =
      b.licenseStatus !== undefined
        ? String(b.licenseStatus)
        : b.license_status !== undefined
          ? String(b.license_status)
          : "not_provided";
    const licenseNumber =
      b.licenseNumber !== undefined
        ? String(b.licenseNumber)
        : b.license_number !== undefined
          ? String(b.license_number)
          : null;
    const investorNetworkType =
      b.investorNetworkType !== undefined
        ? String(b.investorNetworkType)
        : b.investor_network_type !== undefined
          ? String(b.investor_network_type)
          : null;
    const revShareTerms =
      b.revShareTerms !== undefined
        ? String(b.revShareTerms)
        : b.rev_share_terms !== undefined
          ? String(b.rev_share_terms)
          : null;
    const complianceNotes =
      b.complianceNotes !== undefined
        ? String(b.complianceNotes)
        : b.compliance_notes !== undefined
          ? String(b.compliance_notes)
          : null;

    // Upsert keyed by user_id. Status is NEVER advanced from here; a re-submit
    // resets it to pending_review so an admin re-reviews the change.
    const row = await q1<any>(
      `insert into broker_profiles
         (user_id, broker_type, license_status, license_number, investor_network_type,
          rev_share_terms, compliance_notes, status)
       values ($1,$2,$3,$4,$5,$6,$7,'pending_review')
       on conflict (user_id) do update set
         broker_type = excluded.broker_type,
         license_status = excluded.license_status,
         license_number = excluded.license_number,
         investor_network_type = excluded.investor_network_type,
         rev_share_terms = excluded.rev_share_terms,
         compliance_notes = excluded.compliance_notes,
         status = 'pending_review',
         updated_at = now()
       returning *`,
      [
        auth.userId,
        brokerType,
        licenseStatus,
        licenseNumber,
        investorNetworkType,
        revShareTerms,
        complianceNotes,
      ],
    );
    res.status(201).json({ broker: row });
  }),
);

router.get(
  "/admin/brokers",
  requireAdmin,
  h(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const rows = status
      ? await q<any>(`select * from broker_profiles where status = $1 order by created_at desc`, [
          status,
        ])
      : await q<any>(`select * from broker_profiles order by created_at desc`);
    res.json({ brokers: rows });
  }),
);

router.patch(
  "/admin/brokers/:id",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = String(b.status || "");
    if (!["pending_review", "approved", "restricted", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be pending_review | approved | restricted | rejected" });
    }
    const adminNotes =
      b.adminNotes !== undefined
        ? String(b.adminNotes)
        : b.admin_notes !== undefined
          ? String(b.admin_notes)
          : null;
    const row = await q1<any>(
      `update broker_profiles
         set status = $2, admin_notes = coalesce($3, admin_notes), updated_at = now()
       where id = $1 returning *`,
      [req.params.id, status, adminNotes],
    );
    if (!row) throw new NotFoundError("broker profile not found");
    res.json({ broker: row });
  }),
);

// ===========================================================================
// INVESTOR PERMISSION LEVELS (admin-only)
// ===========================================================================

router.get(
  "/admin/investor-permissions",
  requireAdmin,
  h(async (req, res) => {
    const investorId = req.query.investorId ? String(req.query.investorId) : null;
    const rows = investorId
      ? await q<any>(
          `select * from investor_permissions where investor_id = $1 order by created_at desc`,
          [investorId],
        )
      : await q<any>(`select * from investor_permissions order by created_at desc limit 500`);
    res.json({ permissions: rows });
  }),
);

router.post(
  "/admin/investor-permissions",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const investorId = String(b.investorId || b.investor_id || "");
    if (!investorId) return res.status(400).json({ error: "investorId required" });
    const level = String(b.level || "");
    if (!PERMISSION_LEVELS.includes(level)) {
      return res.status(400).json({ error: "invalid level" });
    }
    const programId =
      b.programId !== undefined && b.programId !== null && b.programId !== ""
        ? String(b.programId)
        : b.program_id !== undefined && b.program_id !== null && b.program_id !== ""
          ? String(b.program_id)
          : null;
    const notes = b.notes !== undefined ? String(b.notes) : null;
    const row = await q1<any>(
      `insert into investor_permissions (investor_id, program_id, level, granted_by, notes)
       values ($1,$2,$3,$4,$5)
       on conflict (investor_id, program_id, level) do update set
         granted_by = excluded.granted_by, notes = excluded.notes
       returning *`,
      [investorId, programId, level, auth.userId, notes],
    );
    res.status(201).json({ permission: row });
  }),
);

router.delete(
  "/admin/investor-permissions/:id",
  requireAdmin,
  h(async (req, res) => {
    const row = await q1<any>(
      `delete from investor_permissions where id = $1 returning id`,
      [req.params.id],
    );
    if (!row) throw new NotFoundError("permission not found");
    res.json({ ok: true });
  }),
);

// ===========================================================================
// PER-PROGRAM COMPLIANCE
// ===========================================================================

router.get(
  "/investment/programs/:programId/compliance",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await q1<any>(`select id, company_id from investment_programs where id = $1`, [
      req.params.programId,
    ]);
    if (!program) throw new NotFoundError("program not found");
    // Owning company member OR admin only.
    if (!auth.isAdmin) await assertMember(auth.userId!, program.company_id);
    const row = await q1<any>(`select * from program_compliance where program_id = $1`, [
      program.id,
    ]);
    res.json({ compliance: row ?? null });
  }),
);

router.put(
  "/admin/investment/programs/:programId/compliance",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await q1<any>(`select id from investment_programs where id = $1`, [
      req.params.programId,
    ]);
    if (!program) throw new NotFoundError("program not found");
    const b = (req.body ?? {}) as Record<string, unknown>;

    const legal =
      b.legalReviewStatus !== undefined
        ? String(b.legalReviewStatus)
        : b.legal_review_status !== undefined
          ? String(b.legal_review_status)
          : "not_started";
    const compliance =
      b.complianceReviewStatus !== undefined
        ? String(b.complianceReviewStatus)
        : b.compliance_review_status !== undefined
          ? String(b.compliance_review_status)
          : "not_started";
    if (!REVIEW_STATES.includes(legal) || !REVIEW_STATES.includes(compliance)) {
      return res.status(400).json({ error: "invalid review status" });
    }
    const sponsorDisclosure =
      b.sponsorDisclosure !== undefined
        ? String(b.sponsorDisclosure)
        : b.sponsor_disclosure !== undefined
          ? String(b.sponsor_disclosure)
          : null;
    const offeringExemptionType =
      b.offeringExemptionType !== undefined
        ? String(b.offeringExemptionType)
        : b.offering_exemption_type !== undefined
          ? String(b.offering_exemption_type)
          : null;
    const restrictedMaterials =
      b.restrictedMaterials === true || b.restricted_materials === true;
    const notes = b.notes !== undefined ? String(b.notes) : null;

    const row = await q1<any>(
      `insert into program_compliance
         (program_id, legal_review_status, compliance_review_status, sponsor_disclosure,
          offering_exemption_type, restricted_materials, notes, reviewed_by, reviewed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (program_id) do update set
         legal_review_status = excluded.legal_review_status,
         compliance_review_status = excluded.compliance_review_status,
         sponsor_disclosure = excluded.sponsor_disclosure,
         offering_exemption_type = excluded.offering_exemption_type,
         restricted_materials = excluded.restricted_materials,
         notes = excluded.notes,
         reviewed_by = excluded.reviewed_by,
         reviewed_at = now(),
         updated_at = now()
       returning *`,
      [
        program.id,
        legal,
        compliance,
        sponsorDisclosure,
        offeringExemptionType,
        restrictedMaterials,
        notes,
        auth.userId,
      ],
    );
    res.json({ compliance: row });
  }),
);

// ===========================================================================
// DOCUMENT ACCESS LOG (append-only)
// ===========================================================================

router.post(
  "/investment/document-access",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const docType = b.docType !== undefined ? String(b.docType) : b.doc_type !== undefined ? String(b.doc_type) : null;
    const docId =
      b.docId !== undefined && b.docId !== null && b.docId !== ""
        ? String(b.docId)
        : b.doc_id !== undefined && b.doc_id !== null && b.doc_id !== ""
          ? String(b.doc_id)
          : null;
    const programId =
      b.programId !== undefined && b.programId !== null && b.programId !== ""
        ? String(b.programId)
        : b.program_id !== undefined && b.program_id !== null && b.program_id !== ""
          ? String(b.program_id)
          : null;
    await q(
      `insert into document_access_log (doc_type, doc_id, program_id, viewer_user_id, viewer_email)
       values ($1,$2,$3,$4,$5)`,
      [docType, docId, programId, auth.userId, auth.email],
    );
    res.status(201).json({ ok: true });
  }),
);

export default router;
