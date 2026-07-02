/**
 * Divini Procure - ADMIN KPI ANALYTICS + MESSAGING POLICY endpoints.
 *
 * Self-pathed router (mounted with no prefix in routes.ts), so the full paths
 * are /api/admin/analytics, /api/admin/messaging-policy, /api/messaging/can-message.
 *
 * Every KPI is computed defensively: each table is probed with to_regclass and
 * each metric runs in its own try/catch that defaults to 0, so a missing table
 * or column never breaks the dashboard. Money values are returned in integer
 * cents; the SPA formats them as dollars.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireUser, requireAdmin } from "../auth.js";
import { q1 } from "../pool.js";
import {
  canMessage,
  MESSAGING_MATRIX,
  type MessagingContext,
} from "../lib/messaging-policy.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import { getVendorVerification } from "../lib/verificationGate.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Defensive helpers
// ---------------------------------------------------------------------------

/** True when public.<table> exists. */
async function tableExists(table: string): Promise<boolean> {
  try {
    const row = await q1<{ exists: string | null }>(`select to_regclass($1) as exists`, [
      `public.${table}`,
    ]);
    return !!row?.exists;
  } catch {
    return false;
  }
}

/** True when public.<table> has column <column>. */
async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const row = await q1<{ n: number }>(
      `select count(*)::int as n
         from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    return !!row && Number(row.n) > 0;
  } catch {
    return false;
  }
}

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Number(n) : 0;
};

/**
 * Run a metric closure, swallowing any error (missing table/column, bad cast)
 * and returning 0 so one broken metric never blanks the whole dashboard.
 */
async function metric(fn: () => Promise<number>): Promise<number> {
  try {
    const v = await fn();
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** Count rows matching an optional where clause on a table, guarded. */
async function countWhere(table: string, where = "true", params: unknown[] = []): Promise<number> {
  if (!(await tableExists(table))) return 0;
  const row = await q1<{ n: number }>(
    `select count(*)::bigint as n from ${table} where ${where}`,
    params as any[],
  );
  return toNum(row?.n);
}

// ---------------------------------------------------------------------------
// GET /admin/analytics - compute the KPI rollup
// ---------------------------------------------------------------------------
router.get(
  "/admin/analytics",
  requireAdmin,
  h(async (_req, res) => {
    // --- Marketplace ------------------------------------------------------
    const activeDevelopers = await metric(() =>
      countWhere("companies", "kind = 'buyer'"),
    );
    const activeVendors = await metric(() => countWhere("companies", "kind = 'vendor'"));

    const claimedProfiles = await metric(async () => {
      if (!(await tableExists("invite_codes"))) return 0;
      if (await columnExists("invite_codes", "claimed_at")) {
        return countWhere("invite_codes", "claimed_at is not null");
      }
      if (await columnExists("invite_codes", "claimed")) {
        return countWhere("invite_codes", "claimed = true");
      }
      return countWhere("invite_codes");
    });

    const approvedVendors = await metric(async () => {
      if (await tableExists("developer_vendor_relationships")) {
        // Approved == grandfathered or standard fee resolved (admin-reviewed).
        return countWhere(
          "developer_vendor_relationships",
          "relationship_status in ('grandfathered_2_percent','standard_fee')",
        );
      }
      if (await tableExists("vendor_credentials")) {
        return countWhere("vendor_credentials");
      }
      return 0;
    });

    // --- Procurement ------------------------------------------------------
    const openBidPackages = await metric(() =>
      countWhere("packages", "status in ('open','draft')"),
    );
    const awardedBids = await metric(() => countWhere("bids", "awarded = true"));

    const procurementVolumeCents = await metric(async () => {
      if (!(await tableExists("bids"))) return 0;
      if (!(await columnExists("bids", "price"))) return 0;
      const row = await q1<{ v: number }>(
        `select coalesce(sum(price), 0) * 100 as v from bids where awarded = true`,
      );
      return Math.round(toNum(row?.v));
    });

    // --- Fees -------------------------------------------------------------
    const feesEarnedCents = await metric(async () => {
      if (!(await tableExists("partner_commissions"))) return 0;
      const hasExcluded = await columnExists("partner_commissions", "excluded");
      const where = hasExcluded ? "excluded = false" : "true";
      const row = await q1<{ v: number }>(
        `select coalesce(sum(commission_cents), 0) as v from partner_commissions where ${where}`,
      );
      return Math.round(toNum(row?.v));
    });

    const grandfatheredVolume = await metric(() =>
      countWhere(
        "developer_vendor_relationships",
        "relationship_status = 'grandfathered_2_percent'",
      ),
    );
    const standardFeeVolume = await metric(() =>
      countWhere("developer_vendor_relationships", "relationship_status = 'standard_fee'"),
    );

    // --- Investment -------------------------------------------------------
    const activeInvestmentPrograms = await metric(() =>
      countWhere("investment_programs", "status in ('active','approved')"),
    );

    const qualifiedInvestors = await metric(async () => {
      if (!(await tableExists("investor_profiles"))) return 0;
      const hasStatus = await columnExists("investor_profiles", "status");
      const hasAccred = await columnExists("investor_profiles", "accreditation_status");
      const clauses: string[] = [];
      if (hasStatus) clauses.push("status in ('qualified','approved','active','verified')");
      if (hasAccred) clauses.push("accreditation_status in ('verified','accredited','approved')");
      if (clauses.length === 0) return countWhere("investor_profiles");
      return countWhere("investor_profiles", clauses.join(" or "));
    });

    const investorMatches = await metric(async () => {
      if (await tableExists("investor_matches")) return countWhere("investor_matches");
      if (await tableExists("investor_introduction_requests")) {
        return countWhere("investor_introduction_requests");
      }
      return 0;
    });

    const introductionsMade = await metric(() =>
      countWhere(
        "investor_introduction_requests",
        "pipeline_status in ('intro_made','approved')",
      ),
    );
    const softCommitments = await metric(() =>
      countWhere("investor_introduction_requests", "pipeline_status = 'soft_commitment'"),
    );

    // --- Capital (best-effort; sum target across committed/closed intros) -
    const capitalCommittedCents = await metric(async () => {
      if (!(await tableExists("investor_introduction_requests"))) return 0;
      if (!(await columnExists("investor_introduction_requests", "committed_amount_cents"))) {
        return 0;
      }
      const row = await q1<{ v: number }>(
        `select coalesce(sum(committed_amount_cents), 0) as v
           from investor_introduction_requests
          where pipeline_status in ('soft_commitment','committed','closed')`,
      );
      return Math.round(toNum(row?.v));
    });

    const capitalClosedCents = await metric(async () => {
      if (!(await tableExists("investor_introduction_requests"))) return 0;
      if (!(await columnExists("investor_introduction_requests", "committed_amount_cents"))) {
        return 0;
      }
      const row = await q1<{ v: number }>(
        `select coalesce(sum(committed_amount_cents), 0) as v
           from investor_introduction_requests
          where pipeline_status = 'closed'`,
      );
      return Math.round(toNum(row?.v));
    });

    res.json({
      // Marketplace
      activeDevelopers,
      activeVendors,
      claimedProfiles,
      approvedVendors,
      // Procurement
      openBidPackages,
      awardedBids,
      procurementVolumeCents,
      // Fees
      feesEarnedCents,
      grandfatheredVolume,
      standardFeeVolume,
      // Investment
      activeInvestmentPrograms,
      qualifiedInvestors,
      investorMatches,
      introductionsMade,
      softCommitments,
      // Capital
      capitalCommittedCents,
      capitalClosedCents,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/messaging-policy - the matrix for the policy page (any user)
// ---------------------------------------------------------------------------
router.get(
  "/admin/messaging-policy",
  requireUser,
  h(async (_req, res) => {
    res.json({ matrix: MESSAGING_MATRIX });
  }),
);

// ---------------------------------------------------------------------------
// GET /messaging/can-message - evaluate one pair (any user)
// ---------------------------------------------------------------------------
router.get(
  "/messaging/can-message",
  requireUser,
  h(async (req, res) => {
    const fromRole = String(req.query.fromRole || "");
    const toRole = String(req.query.toRole || "");
    const context: MessagingContext = {
      introApproved: String(req.query.introApproved || "") === "true",
      permissioned: String(req.query.permissioned || "") === "true",
    };
    const decision = canMessage(fromRole, toRole, context);

    // Monetization V2 (flag-gated): a VENDOR must be verified before it can
    // message a DEVELOPER. Layered ON TOP of the role policy so nothing changes
    // when the flag is off. Only enforced when a fromCompanyId is supplied (the
    // vendor's company) so the pure role-only query keeps working.
    if (
      PROCURE_MONETIZATION_V2 &&
      decision.allowed &&
      fromRole === "vendor" &&
      toRole === "developer"
    ) {
      const fromCompanyId = String(req.query.fromCompanyId || "");
      if (fromCompanyId) {
        const v = await getVendorVerification(fromCompanyId);
        if (!v.verified) {
          res.json({
            allowed: false,
            reason:
              "Vendor verification required before messaging a developer. " +
              "Complete verification to unlock messaging.",
          });
          return;
        }
      }
    }

    res.json(decision);
  }),
);

export default router;
