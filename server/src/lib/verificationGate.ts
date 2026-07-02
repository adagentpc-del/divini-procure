/**
 * Divini Procure - VENDOR VERIFICATION GATE (Monetization V2).
 *
 * When PROCURE_MONETIZATION_V2 is ON, a vendor must be VERIFIED before it can:
 *   - submit a bid
 *   - be matched / recommended to a developer
 *   - message a developer
 * Verification is a free, mandatory gate (verify the docs, then transact).
 *
 * What counts as "verified": the canonical verified state on vendor_profiles is
 * verify_status. The live DB CHECK constraint permits
 * pending|ai-verified|approved|flagged, and the admin credential-review recompute
 * writes 'approved' for a fully verified vendor, so 'approved' IS the verified
 * status here. We also accept a literal 'verified' for forward-compatibility if
 * the constraint is ever widened. A flag-off deployment behaves exactly as today:
 * the gate always passes.
 *
 * Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import { ForbiddenError } from "../db.js";

/** Statuses that mean a vendor is verified for gating purposes. */
const VERIFIED_STATUSES = new Set(["verified", "approved"]);

export const REQUIRED_CREDENTIAL_TYPES = ["license", "gl_insurance", "trade_cert"] as const;
export type RequiredCredentialType = (typeof REQUIRED_CREDENTIAL_TYPES)[number];

export interface VerificationState {
  /** Effective: true when the flag is off OR the vendor is verified. */
  verified: boolean;
  /** The raw vendor_profiles.verify_status (null when no profile row). */
  status: string | null;
  /** Whether the V2 gate is actually enforced (the flag is on). */
  gated: boolean;
  verifiedAt: string | null;
  verificationExpiresAt: string | null;
}

/**
 * Read a vendor's verification state. When the flag is off, verified is always
 * true (no behavior change). When on, verified reflects verify_status.
 */
export async function getVendorVerification(companyId: string): Promise<VerificationState> {
  let status: string | null = null;
  let verifiedAt: string | null = null;
  let verificationExpiresAt: string | null = null;
  try {
    const row = await q1<{
      verify_status: string | null;
      verified_at: string | null;
      verification_expires_at: string | null;
    }>(
      `select verify_status, verified_at, verification_expires_at
         from vendor_profiles where company_id = $1`,
      [companyId],
    );
    status = row?.verify_status ?? null;
    verifiedAt = row?.verified_at ?? null;
    verificationExpiresAt = row?.verification_expires_at ?? null;
  } catch {
    status = null;
  }

  if (!PROCURE_MONETIZATION_V2) {
    return { verified: true, status, gated: false, verifiedAt, verificationExpiresAt };
  }
  const verified = !!status && VERIFIED_STATUSES.has(status.toLowerCase());
  return { verified, status, gated: true, verifiedAt, verificationExpiresAt };
}

/**
 * Boolean convenience: is this vendor verified? Flag-off always true.
 */
export async function isVendorVerified(companyId: string): Promise<boolean> {
  const v = await getVendorVerification(companyId);
  return v.verified;
}

/**
 * Raise a ForbiddenError (mapped to 403) when the vendor is not verified and the
 * V2 gate is enforced. No-op when the flag is off. The error message names the
 * gate so the frontend can surface a "complete verification" call to action.
 */
export async function assertVendorVerified(companyId: string): Promise<void> {
  if (!PROCURE_MONETIZATION_V2) return;
  const v = await getVendorVerification(companyId);
  if (!v.verified) {
    throw new ForbiddenError(
      "Vendor verification required. Complete verification before bidding, " +
        "being recommended to a developer, or messaging a developer.",
    );
  }
}

/**
 * Which required credential types are missing or expiring for a vendor, for the
 * GET /api/me/verification surface. A required type is satisfied only when at
 * least one credential of that type is doc_status='approved' AND not expired.
 * "Expiring" lists approved credentials whose expires_at is within `soonDays`.
 * Defensive: a missing table degrades to "all required missing".
 */
export async function getVerificationDetail(
  companyId: string,
  soonDays = 30,
): Promise<{
  status: string | null;
  verified: boolean;
  gated: boolean;
  verifiedAt: string | null;
  verificationExpiresAt: string | null;
  requiredTypes: string[];
  missing: string[];
  expiring: { credentialType: string; expiresAt: string | null }[];
}> {
  const state = await getVendorVerification(companyId);

  let rows: {
    credential_type: string | null;
    doc_status: string | null;
    expires_at: string | null;
  }[] = [];
  try {
    rows = await q<{
      credential_type: string | null;
      doc_status: string | null;
      expires_at: string | null;
    }>(
      `select credential_type, doc_status, expires_at
         from vendor_credentials where company_id = $1`,
      [companyId],
    );
  } catch {
    rows = [];
  }

  const now = Date.now();
  const soonCutoff = now + soonDays * 24 * 60 * 60 * 1000;

  const missing: string[] = [];
  const expiring: { credentialType: string; expiresAt: string | null }[] = [];

  for (const reqType of REQUIRED_CREDENTIAL_TYPES) {
    const ofType = rows.filter(
      (r) => (r.credential_type ?? "").toLowerCase() === reqType,
    );
    const approvedCurrent = ofType.filter((r) => {
      const approved = (r.doc_status ?? "").toLowerCase() === "approved";
      const exp = r.expires_at ? Date.parse(r.expires_at) : null;
      const notExpired = exp == null || exp > now;
      return approved && notExpired;
    });
    if (approvedCurrent.length === 0) {
      missing.push(reqType);
      continue;
    }
    // Flag any approved-current credential expiring within the window.
    for (const r of approvedCurrent) {
      const exp = r.expires_at ? Date.parse(r.expires_at) : null;
      if (exp != null && exp <= soonCutoff) {
        expiring.push({ credentialType: reqType, expiresAt: r.expires_at });
      }
    }
  }

  return {
    status: state.status,
    verified: state.verified,
    gated: state.gated,
    verifiedAt: state.verifiedAt,
    verificationExpiresAt: state.verificationExpiresAt,
    requiredTypes: [...REQUIRED_CREDENTIAL_TYPES],
    missing,
    expiring,
  };
}
