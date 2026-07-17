/**
 * Divini Procure - ADMIN VERIFICATION WORKFLOWS routes. ADDITIVE.
 *
 * Mounted under /api in routes.ts. Admin-only. Two workflows:
 *   (A) Vendor credential review. Admin reviews each vendor_credentials row
 *       (license / insurance / compliance doc) and decides verified /
 *       rejected / needs_info. After each decision the vendor's
 *       vendor_profiles.verify_status is RECOMPUTED defensively.
 *   (B) Investor accreditation + KYC verification. Admin sets
 *       investor_qualification_records.accreditation_verification_status and
 *       kyc_status; when accreditation is verified the investor_profiles row
 *       may be advanced to admin_review_status='approved'.
 *
 * COMPLIANCE INVARIANTS:
 *   - Every verifying / approving action here is an explicit admin action and
 *     is written to verification_audit with the acting admin's email.
 *   - The deterministic matching / AI layer never calls these endpoints; they
 *     are the only place a credential or accreditation is marked verified.
 *
 * Router convention: const h=(fn)=>(req,res,next)=>fn(req,res).catch(next).
 * Errors map via the shared errorHandler. Money is integer cents. Zero em
 * dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin, requireUser } from "../auth.js";
import { NotFoundError, userCompanyIds } from "../db.js";
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import { REQUIRED_CREDENTIAL_TYPES } from "../lib/verificationGate.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function actorEmail(req: Request): string {
  return getAuth(req).email ?? "unknown";
}

async function audit(
  subjectType: string,
  subjectId: string,
  action: string,
  email: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await q(
    `insert into verification_audit (subject_type, subject_id, action, actor_email, detail)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [subjectType, subjectId, action, email, JSON.stringify(detail ?? {})],
  );
}

const CREDENTIAL_DECISIONS = ["verified", "rejected", "needs_info"] as const;
type CredentialDecision = (typeof CREDENTIAL_DECISIONS)[number];

const ACCREDITATION_DECISIONS = ["verified", "rejected"] as const;
type AccreditationDecision = (typeof ACCREDITATION_DECISIONS)[number];

const KYC_DECISIONS = ["passed", "failed"] as const;
type KycDecision = (typeof KYC_DECISIONS)[number];

/**
 * Recompute a vendor's verify_status from its credentials.
 *
 * Two modes, switched on PROCURE_MONETIZATION_V2:
 *
 *   FLAG OFF (today's behavior, unchanged): a vendor with at least one
 *   credential whose `status`='verified' and none 'rejected' is 'approved';
 *   any 'rejected' makes it 'flagged'; otherwise the existing status is kept
 *   (never lowered below an AI step). verified_at / verification_expires_at are
 *   not touched.
 *
 *   FLAG ON (V2 gate): a vendor is VERIFIED only when every REQUIRED credential
 *   type (license, gl_insurance, trade_cert) has at least one row that is
 *   doc_status='approved' AND not expired (expires_at in the future or null).
 *   Any required type missing/expired -> not verified ('pending', or 'flagged'
 *   if a required credential was rejected). When verified, verify_status is set
 *   to 'approved' (the constraint-permitted verified state), verified_at = now,
 *   and verification_expires_at = the earliest required-credential expiry. The
 *   DB CHECK on verify_status permits pending|ai-verified|approved|flagged.
 */
async function recomputeVendorVerifyStatus(companyId: string): Promise<string | null> {
  if (!companyId) return null;

  if (PROCURE_MONETIZATION_V2) {
    return recomputeVendorVerifyStatusV2(companyId);
  }

  const counts = await q1<{ total: string; verified: string; rejected: string }>(
    `select
        count(*)::int                                            as total,
        count(*) filter (where lower(status) = 'verified')::int  as verified,
        count(*) filter (where lower(status) = 'rejected')::int  as rejected
      from vendor_credentials
      where company_id = $1`,
    [companyId],
  );
  const total = Number(counts?.total ?? 0);
  const verified = Number(counts?.verified ?? 0);
  const rejected = Number(counts?.rejected ?? 0);

  // No credentials at all -> leave the profile untouched.
  if (total === 0) {
    const row = await q1<{ verify_status: string | null }>(
      `select verify_status from vendor_profiles where company_id = $1`,
      [companyId],
    );
    return row?.verify_status ?? null;
  }

  let next: string;
  if (rejected > 0) {
    next = "flagged";
  } else if (verified > 0) {
    next = "approved";
  } else {
    // Pending / needs_info only. Do not lower an existing ai-verified/approved.
    const row = await q1<{ verify_status: string | null }>(
      `select verify_status from vendor_profiles where company_id = $1`,
      [companyId],
    );
    const cur = row?.verify_status ?? null;
    if (cur === "approved" || cur === "ai-verified") return cur;
    next = "pending";
  }

  // Upsert so a vendor profile always exists for the company before we set it.
  await q(
    `insert into vendor_profiles (company_id, verify_status)
       values ($1, $2)
     on conflict (company_id) do update set verify_status = excluded.verify_status`,
    [companyId, next],
  );
  return next;
}

/**
 * V2 recompute: enforce required credential types being approved + current.
 * Returns the new verify_status. Sets verified_at + verification_expires_at when
 * verified; clears verified_at when not.
 */
async function recomputeVendorVerifyStatusV2(companyId: string): Promise<string | null> {
  // All credentials, with the type we gate on. credential_type is the V2 column;
  // fall back to the legacy free-text `type` when credential_type is not set.
  const creds = await q<{
    credential_type: string | null;
    doc_status: string | null;
    status: string | null;
    expires_at: string | null;
  }>(
    `select coalesce(credential_type, type) as credential_type,
            doc_status, status, expires_at
       from vendor_credentials
      where company_id = $1`,
    [companyId],
  );

  const now = Date.now();
  const required = REQUIRED_CREDENTIAL_TYPES;

  let anyRequiredRejected = false;
  const expiries: number[] = [];
  let allRequiredCovered = true;

  for (const reqType of required) {
    const ofType = creds.filter(
      (c) => (c.credential_type ?? "").toLowerCase() === reqType,
    );
    if (ofType.some((c) => (c.doc_status ?? "").toLowerCase() === "rejected")) {
      anyRequiredRejected = true;
    }
    const approvedCurrent = ofType.filter((c) => {
      const approved = (c.doc_status ?? "").toLowerCase() === "approved";
      const exp = c.expires_at ? Date.parse(c.expires_at) : null;
      const notExpired = exp == null || exp > now;
      return approved && notExpired;
    });
    if (approvedCurrent.length === 0) {
      allRequiredCovered = false;
    } else {
      for (const c of approvedCurrent) {
        if (c.expires_at) {
          const t = Date.parse(c.expires_at);
          if (Number.isFinite(t)) expiries.push(t);
        }
      }
    }
  }

  let next: string;
  let verifiedAtSql = "null";
  let expiresAt: string | null = null;

  if (allRequiredCovered) {
    next = "approved"; // constraint-permitted verified state
    verifiedAtSql = "now()";
    if (expiries.length > 0) {
      expiresAt = new Date(Math.min(...expiries)).toISOString();
    }
  } else if (anyRequiredRejected) {
    next = "flagged";
  } else {
    next = "pending";
  }

  await q(
    `insert into vendor_profiles (company_id, verify_status, verified_at, verification_expires_at)
       values ($1, $2, ${verifiedAtSql}, $3)
     on conflict (company_id) do update
       set verify_status = excluded.verify_status,
           verified_at = ${verifiedAtSql === "now()" ? "now()" : "null"},
           verification_expires_at = excluded.verification_expires_at`,
    [companyId, next, expiresAt],
  );
  return next;
}

/**
 * Nightly/worker callable: flip any vendor whose verification has LAPSED out of
 * the verified state. A vendor is lapsed when verify_status is the verified
 * value ('approved') but verification_expires_at is in the past, OR a required
 * credential has since expired. Recomputes each affected vendor so the status is
 * derived from current credentials. Returns the list of companies that changed.
 * No-op (returns []) when PROCURE_MONETIZATION_V2 is off.
 */
export async function recomputeExpiringVerifications(): Promise<
  { companyId: string; from: string | null; to: string | null }[]
> {
  if (!PROCURE_MONETIZATION_V2) return [];

  // Candidate set: currently-approved vendors whose recorded expiry has passed,
  // plus any approved vendor that holds a now-expired required credential. We
  // recompute each from current credentials, which is the source of truth.
  const candidates = await q<{ company_id: string; verify_status: string | null }>(
    `select distinct vp.company_id, vp.verify_status
       from vendor_profiles vp
      where vp.verify_status = 'approved'
        and (
          (vp.verification_expires_at is not null and vp.verification_expires_at <= now())
          or exists (
            select 1 from vendor_credentials vc
             where vc.company_id = vp.company_id
               and vc.expires_at is not null
               and vc.expires_at <= now()
          )
        )`,
    [],
  );

  const changed: { companyId: string; from: string | null; to: string | null }[] = [];
  for (const c of candidates) {
    const from = c.verify_status ?? null;
    // Mark any expired credentials as doc_status='expired' so the audit trail is
    // accurate before we recompute.
    await q(
      `update vendor_credentials
          set doc_status = 'expired'
        where company_id = $1
          and expires_at is not null
          and expires_at <= now()
          and coalesce(lower(doc_status), '') <> 'expired'`,
      [c.company_id],
    );
    const to = await recomputeVendorVerifyStatusV2(c.company_id);
    if (to !== from) {
      changed.push({ companyId: c.company_id, from, to });
      await audit("vendor_profile", c.company_id, "verification_lapsed", "system", {
        from,
        to,
      });
    }
  }
  return changed;
}

// ===========================================================================
// (A) VENDOR CREDENTIAL REVIEW
// ===========================================================================

// GET /api/admin/verification/vendor-credentials?status=pending|verified|rejected|needs_info
router.get(
  "/admin/verification/vendor-credentials",
  requireAdmin,
  h(async (req, res) => {
    const params: unknown[] = [];
    let where = "";
    const status = req.query.status ? String(req.query.status).trim() : "";
    if (status) {
      params.push(status);
      where = `where lower(vc.status) = lower($${params.length})`;
    }
    const rows = await q(
      `select
          vc.id, vc.company_id, vc.type, vc.doc_url, vc.registry, vc.result,
          vc.confidence, vc.ok, vc.status, vc.scanned_at, vc.created_at,
          vc.reviewed_by, vc.reviewed_at, vc.review_notes,
          c.name as company_name,
          vp.verify_status as vendor_verify_status
        from vendor_credentials vc
        left join companies c on c.id = vc.company_id
        left join vendor_profiles vp on vp.company_id = vc.company_id
        ${where}
        order by vc.created_at desc nulls last`,
      params,
    );
    res.json({ credentials: rows });
  }),
);

// PATCH /api/admin/verification/vendor-credentials/:id { decision, notes }
router.patch(
  "/admin/verification/vendor-credentials/:id",
  requireAdmin,
  h(async (req, res) => {
    const id = String(req.params.id);
    const body = (req.body ?? {}) as {
      decision?: string;
      notes?: string;
      credentialType?: string;
      expiresAt?: string;
    };
    const decision = String(body.decision ?? "") as CredentialDecision;
    if (!CREDENTIAL_DECISIONS.includes(decision)) {
      res.status(400).json({ error: "decision must be one of verified, rejected, needs_info" });
      return;
    }
    const notes = body.notes ? String(body.notes) : null;
    // Optional V2 fields the admin can set while reviewing so the credential is
    // gateable (the type it satisfies + when its coverage expires).
    const credentialType = body.credentialType ? String(body.credentialType) : null;
    const expiresAt = body.expiresAt ? String(body.expiresAt) : null;
    const email = actorEmail(req);

    const cred = await q1<{ id: string; company_id: string | null }>(
      `select id, company_id from vendor_credentials where id = $1`,
      [id],
    );
    if (!cred) throw new NotFoundError("credential not found");

    // Map the legacy decision onto the V2 doc_status so the verification gate
    // can require approved + current required credentials:
    //   verified -> approved, rejected -> rejected, needs_info -> pending.
    const docStatus =
      decision === "verified" ? "approved" : decision === "rejected" ? "rejected" : "pending";

    const updated = await q1(
      `update vendor_credentials
          set status = $2,
              doc_status = $5,
              credential_type = coalesce($6, credential_type),
              expires_at = coalesce($7::timestamptz, expires_at),
              review_notes = coalesce($3, review_notes),
              reviewed_by = $4,
              reviewed_at = now()
        where id = $1
        returning id, company_id, type, credential_type, status, doc_status,
                  expires_at, review_notes, reviewed_by, reviewed_at`,
      [id, decision, notes, email, docStatus, credentialType, expiresAt],
    );

    await audit("vendor_credential", id, decision, email, {
      companyId: cred.company_id,
      notes: notes ?? undefined,
    });

    let vendorVerifyStatus: string | null = null;
    if (cred.company_id) {
      vendorVerifyStatus = await recomputeVendorVerifyStatus(cred.company_id);
      await audit("vendor_profile", cred.company_id, "verify_status_recomputed", email, {
        verifyStatus: vendorVerifyStatus,
        triggeredBy: id,
      });
    }

    res.json({ credential: updated, vendorVerifyStatus });
  }),
);

// ===========================================================================
// (B) INVESTOR ACCREDITATION VERIFICATION
// ===========================================================================

// GET /api/admin/verification/investors?status=not_verified|verified|rejected
router.get(
  "/admin/verification/investors",
  requireAdmin,
  h(async (req, res) => {
    const params: unknown[] = [];
    let where = "";
    const status = req.query.status ? String(req.query.status).trim() : "";
    if (status) {
      params.push(status);
      where = `where lower(coalesce(qr.accreditation_verification_status, 'not_verified')) = lower($${params.length})`;
    }
    const rows = await q(
      `select
          ip.id, ip.user_id, ip.full_name, ip.entity_name, ip.email,
          ip.investor_type, ip.accreditation_status, ip.admin_review_status,
          ip.status, ip.created_at,
          qr.id                              as qualification_id,
          qr.accredited,
          qr.qualified_purchaser,
          qr.proof_of_funds,
          qr.kyc_completed,
          qr.jurisdiction,
          coalesce(qr.accreditation_verification_status, 'not_verified') as accreditation_verification_status,
          coalesce(qr.kyc_status, 'not_started')                          as kyc_status,
          coalesce(qr.aml_status, 'not_started')                          as aml_status
        from investor_profiles ip
        left join investor_qualification_records qr on qr.investor_id = ip.id
        ${where}
        order by ip.created_at desc nulls last`,
      params,
    );
    res.json({ investors: rows });
  }),
);

// PATCH /api/admin/verification/investors/:id
//   { accreditationDecision?: verified|rejected, kycDecision?: passed|failed, notes? }
// :id is the investor_profiles.id.
router.patch(
  "/admin/verification/investors/:id",
  requireAdmin,
  h(async (req, res) => {
    const investorId = String(req.params.id);
    const body = (req.body ?? {}) as {
      accreditationDecision?: string;
      kycDecision?: string;
      notes?: string;
    };
    const notes = body.notes ? String(body.notes) : null;
    const email = actorEmail(req);

    const accreditationDecision = body.accreditationDecision
      ? (String(body.accreditationDecision) as AccreditationDecision)
      : undefined;
    const kycDecision = body.kycDecision ? (String(body.kycDecision) as KycDecision) : undefined;

    if (accreditationDecision && !ACCREDITATION_DECISIONS.includes(accreditationDecision)) {
      res.status(400).json({ error: "accreditationDecision must be verified or rejected" });
      return;
    }
    if (kycDecision && !KYC_DECISIONS.includes(kycDecision)) {
      res.status(400).json({ error: "kycDecision must be passed or failed" });
      return;
    }
    if (!accreditationDecision && !kycDecision) {
      res.status(400).json({ error: "provide accreditationDecision and/or kycDecision" });
      return;
    }

    const profile = await q1<{ id: string }>(
      `select id from investor_profiles where id = $1`,
      [investorId],
    );
    if (!profile) throw new NotFoundError("investor not found");

    // Ensure a qualification record exists so the verification status has a home.
    let qual = await q1<{ id: string }>(
      `select id from investor_qualification_records where investor_id = $1`,
      [investorId],
    );
    if (!qual) {
      qual = await q1<{ id: string }>(
        `insert into investor_qualification_records (investor_id) values ($1) returning id`,
        [investorId],
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [investorId];
    if (accreditationDecision) {
      params.push(accreditationDecision);
      sets.push(`accreditation_verification_status = $${params.length}`);
    }
    if (kycDecision) {
      params.push(kycDecision === "passed" ? "passed" : "failed");
      sets.push(`kyc_status = $${params.length}`);
    }
    sets.push(`updated_at = now()`);

    const qualRow = await q1(
      `update investor_qualification_records
          set ${sets.join(", ")}
        where investor_id = $1
        returning id, accreditation_verification_status, kyc_status, aml_status`,
      params,
    );

    await audit("investor", investorId, "verification_updated", email, {
      accreditationDecision: accreditationDecision ?? undefined,
      kycDecision: kycDecision ?? undefined,
      notes: notes ?? undefined,
    });

    // When accreditation is verified, advance the profile review to approved.
    let profileRow = null;
    if (accreditationDecision === "verified") {
      profileRow = await q1(
        `update investor_profiles
            set admin_review_status = 'approved',
                admin_notes = coalesce($2, admin_notes),
                updated_at = now()
          where id = $1
          returning id, admin_review_status, admin_notes`,
        [investorId, notes],
      );
      await audit("investor_profile", investorId, "approved", email, { reason: "accreditation_verified" });
    } else if (accreditationDecision === "rejected") {
      profileRow = await q1(
        `update investor_profiles
            set admin_review_status = 'rejected',
                admin_notes = coalesce($2, admin_notes),
                updated_at = now()
          where id = $1
          returning id, admin_review_status, admin_notes`,
        [investorId, notes],
      );
      await audit("investor_profile", investorId, "rejected", email, { reason: "accreditation_rejected" });
    } else if (notes) {
      profileRow = await q1(
        `update investor_profiles
            set admin_notes = coalesce($2, admin_notes), updated_at = now()
          where id = $1
          returning id, admin_review_status, admin_notes`,
        [investorId, notes],
      );
    }

    res.json({ qualification: qualRow, profile: profileRow });
  }),
);

// ===========================================================================
// (C) VENDOR SELF-SERVE DOCUMENT UPLOAD
// ===========================================================================

const VALID_CREDENTIAL_TYPES = ["license", "gl_insurance", "trade_cert", "other"] as const;

// POST /api/me/verification/documents
router.post(
  "/me/verification/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as {
      credentialType?: string;
      fileKey?: string;
      fileName?: string;
      expiresAt?: string;
    };

    const credentialType = body.credentialType ? String(body.credentialType) : "";
    const fileKey = body.fileKey ? String(body.fileKey) : "";

    if (!credentialType || !(VALID_CREDENTIAL_TYPES as readonly string[]).includes(credentialType)) {
      res.status(400).json({ error: `credentialType must be one of: ${VALID_CREDENTIAL_TYPES.join(", ")}` });
      return;
    }
    if (!fileKey) {
      res.status(400).json({ error: "fileKey is required" });
      return;
    }

    const companyIds = await userCompanyIds(auth.userId!);
    if (companyIds.length === 0) {
      res.status(403).json({ error: "user has no associated company" });
      return;
    }
    const companyId = companyIds[0];

    // Ownership check: fileKey must start with the caller's own companyId
    // directory so a vendor cannot register another company's storage path as
    // their own credential. Storage keys are written client-side as
    // `<companyId>/<filename>` before this endpoint is called.
    if (!fileKey.startsWith(`${companyId}/`)) {
      res.status(403).json({ error: "fileKey must belong to your own company directory." });
      return;
    }

    const fileName = body.fileName ? String(body.fileName) : null;
    const expiresAt = body.expiresAt ? String(body.expiresAt) : null;

    const row = await q1(
      `INSERT INTO vendor_credentials (company_id, credential_type, file_key, file_name, doc_status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5::timestamptz)
       RETURNING *`,
      [companyId, credentialType, fileKey, fileName, expiresAt],
    );

    const verifyStatus = await recomputeVendorVerifyStatus(companyId);

    res.status(201).json({ credential: row, verifyStatus });
  }),
);

// ===========================================================================
// (D) VENDOR VERIFICATION OVERVIEW (developer dashboard)
// ===========================================================================

// GET /api/me/vendor-verification-overview?companyId=...
router.get(
  "/me/vendor-verification-overview",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const requestedCompanyId = req.query.companyId ? String(req.query.companyId) : null;

    // Verify the requester is a member of the requested company (or is admin)
    if (requestedCompanyId && !auth.isAdmin) {
      const companyIds = await userCompanyIds(auth.userId!);
      if (!companyIds.includes(requestedCompanyId)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }

    // Resolve the companyId to use for the preferences lookup
    const companyId =
      requestedCompanyId ??
      (auth.userId ? (await userCompanyIds(auth.userId))[0] ?? null : null);

    // Platform-wide vendor stats (simpler approach as specified)
    const stats = await q1<{ verified: string; pending: string }>(
      `SELECT
         count(*) FILTER (WHERE lower(verify_status) = 'approved')::int  AS verified,
         count(*) FILTER (WHERE verify_status IS NULL OR lower(verify_status) = 'pending')::int AS pending
       FROM vendor_profiles`,
      [],
    );

    const expiringRow = await q1<{ expiring: string }>(
      `SELECT count(DISTINCT company_id)::int AS expiring
       FROM vendor_credentials
       WHERE lower(doc_status) = 'verified'
         AND expires_at IS NOT NULL
         AND expires_at > now()
         AND expires_at <= now() + interval '30 days'`,
      [],
    );

    let verifiedVendorsOnly = false;
    if (companyId) {
      try {
        const pref = await q1<{ verified_vendors_only: boolean }>(
          `SELECT verified_vendors_only FROM company_rfp_preferences WHERE company_id = $1`,
          [companyId],
        );
        verifiedVendorsOnly = pref?.verified_vendors_only ?? false;
      } catch {
        // table may not exist yet — default to false
        verifiedVendorsOnly = false;
      }
    }

    res.json({
      verifiedVendors: Number(stats?.verified ?? 0),
      pendingVendors: Number(stats?.pending ?? 0),
      expiringVendors: Number(expiringRow?.expiring ?? 0),
      verifiedVendorsOnly,
    });
  }),
);

// ===========================================================================
// (E) RFP PREFERENCES
// ===========================================================================

// PATCH /api/me/rfp-preferences
router.patch(
  "/me/rfp-preferences",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as { companyId?: string; verifiedVendorsOnly?: boolean };
    const companyId = body.companyId ? String(body.companyId) : null;
    const verifiedVendorsOnly =
      typeof body.verifiedVendorsOnly === "boolean" ? body.verifiedVendorsOnly : false;

    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }

    if (!auth.isAdmin) {
      const companyIds = await userCompanyIds(auth.userId!);
      if (!companyIds.includes(companyId)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }

    // Idempotent migration: ensure table exists
    await q(
      `CREATE TABLE IF NOT EXISTS company_rfp_preferences (
         company_id uuid PRIMARY KEY,
         verified_vendors_only boolean NOT NULL DEFAULT false,
         updated_at timestamptz DEFAULT now()
       )`,
      [],
    );

    const row = await q1<{ verified_vendors_only: boolean }>(
      `INSERT INTO company_rfp_preferences (company_id, verified_vendors_only, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (company_id) DO UPDATE
         SET verified_vendors_only = excluded.verified_vendors_only,
             updated_at = now()
       RETURNING verified_vendors_only`,
      [companyId, verifiedVendorsOnly],
    );

    res.json({ ok: true, verifiedVendorsOnly: row?.verified_vendors_only ?? verifiedVendorsOnly });
  }),
);

export default router;

