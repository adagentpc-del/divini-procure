/**
 * Divini Procure - Phase 1 P1-13: canonical financial summary API.
 * Self-pathed under /api (mounted with router.use(financialSummaryRouter),
 * no prefix). The ONE server-side read model for project/package financial
 * state - see lib/financial-summary.ts for the computation itself.
 *
 * Authorization: developer (member of the project's owning company) or
 * admin only - this is developer-internal budget/allowance data, matching
 * budget.ts's own restriction (nothing in this phase exposes it to
 * vendors; a vendor's own financial visibility into a specific PO/invoice/
 * payment stays scoped through those existing endpoints).
 *
 * Endpoints (both requireUser):
 *   GET /buildings/:id/financial-summary  -> ProjectFinancialSummary
 *   GET /packages/:id/financial-summary   -> PackageFinancialSummary
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { withTransaction } from "../pool.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { isMemberOfCompany, buildingDeveloperCompany, packageContext } from "../lib/financial-auth.js";
import { computeProjectFinancialSummary, computePackageFinancialSummary } from "../lib/financial-summary.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.get(
  "/buildings/:id/financial-summary",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const devCompany = await buildingDeveloperCompany(req.params.id);
    if (!devCompany) throw new NotFoundError("project not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
      throw new ForbiddenError("not the developer of this project");
    }
    const summary = await computeProjectFinancialSummary(req.params.id);
    if (!summary) throw new NotFoundError("project not found");
    res.json(summary);
  }),
);

router.get(
  "/packages/:id/financial-summary",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await packageContext(req.params.id);
    if (!ctx) throw new NotFoundError("package not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, ctx.developer_company_id))) {
      throw new ForbiddenError("not the developer of this package's project");
    }
    const summary = await computePackageFinancialSummary(req.params.id);
    if (!summary) throw new NotFoundError("package not found");
    res.json(summary);
  }),
);

// ---- POST /packages/:id/close-financials -------------------------------------
// Phase 1 P1-18: procurement financial closeout ONLY (not full construction
// closeout). "A project/package is not final just because all currently
// known invoices are paid" (section 48) - this is the explicit, separate
// event that makes final_cost_cents authoritative; until it fires,
// forecastFinalCents (== revised commitment) is the right number to trust.
// Blocked while any of: an active (non-terminal) change order, an
// unresolved invoice (not paid/void/rejected), outstanding retainage, or an
// unresolved dispute exists against this package - each checked against
// real rows, never assumed. Developer (or admin) only.
router.post(
  "/packages/:id/close-financials",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await packageContext(req.params.id);
    if (!ctx) throw new NotFoundError("package not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, ctx.developer_company_id))) {
      throw new ForbiddenError("not the developer of this package's project");
    }

    const result = await withTransaction(async (tx) => {
      const pkg = await tx.q1<any>(`select * from packages where id = $1`, [req.params.id]);
      if (!pkg) throw new NotFoundError("package not found");
      if (pkg.financially_closed_at) {
        throw new ValidationError("this package is already financially closed");
      }

      const blockers: string[] = [];

      const activeCos = await tx.q1<{ n: number }>(
        `select count(*)::int as n from change_orders where package_id = $1 and status in ('draft','submitted','under_review')`,
        [req.params.id],
      );
      if (Number(activeCos?.n) > 0) blockers.push(`${activeCos!.n} change order(s) still active (draft/submitted/under review)`);

      const openInvoices = await tx.q1<{ n: number }>(
        `select count(*)::int as n from invoices where package_id = $1 and status not in ('paid','void','rejected')`,
        [req.params.id],
      );
      if (Number(openInvoices?.n) > 0) blockers.push(`${openInvoices!.n} invoice(s) not yet paid, voided, or rejected`);

      const retainage = await tx.q1<{ outstanding: number | null }>(
        `select coalesce(sum(retainage_held_cents - retainage_released_cents), 0) as outstanding
           from retainage_records where package_id = $1`,
        [req.params.id],
      );
      const outstandingRetainage = Number(retainage?.outstanding ?? 0);
      if (outstandingRetainage > 0) {
        blockers.push(`$${(outstandingRetainage / 100).toLocaleString()} retainage still outstanding`);
      }

      const openDisputes = await tx.q1<{ n: number }>(
        `select count(*)::int as n from disputes where package_id = $1 and status not in ('resolved','closed_no_action')`,
        [req.params.id],
      );
      if (Number(openDisputes?.n) > 0) blockers.push(`${openDisputes!.n} unresolved dispute(s)`);

      if (blockers.length > 0) {
        throw new ValidationError(`cannot close financials: ${blockers.join("; ")}`);
      }

      // Recompute one last time, inside the transaction, so the final cost
      // is derived from the exact same canonical child rows the summary API
      // reads - never a client-supplied number.
      const summary = await computePackageFinancialSummary(req.params.id);
      const finalCostCents = summary?.revisedCommitmentCents ?? 0;

      const updated = await tx.q1<any>(
        `update packages
            set financially_closed_at = now(), financially_closed_by = $2, final_cost_cents = $3
          where id = $1 and financially_closed_at is null
          returning *`,
        [req.params.id, auth.email ?? auth.userId, finalCostCents],
      );
      if (!updated) throw new ValidationError("this package was already financially closed by a concurrent request");
      return updated;
    });

    res.json({ package: result });
  }),
);

export default router;
