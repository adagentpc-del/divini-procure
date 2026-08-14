/**
 * Divini Procure - Phase 1 P1-13: canonical financial summary services.
 *
 * The ONE place project/package financial truth is computed - "do NOT let
 * every frontend page independently calculate financial truth" (Phase 1
 * instruction section 31). Every number is aggregated live from canonical
 * child rows on every call (see lib/financial-model.ts's header for why:
 * a deliberate, stronger reading of the Phase 0 design proposal's cached-
 * column suggestion). No N+1: each summary issues a small, fixed number of
 * aggregate queries, not one query per child row.
 *
 * P1-12 (retainage integration) is realized here, not as a separate schema
 * change: retainage_records (already linked to its purchase_order since
 * Phase 0 item 12) is the ONE source retainageHeld/retainageReleased is read
 * from. invoices.retainage_cents is deliberately NEVER summed into these
 * totals - it is an informational per-invoice line only, to avoid double
 * counting (Phase 1 instruction section 50).
 */
import { q, q1 } from "../pool.js";
import {
  num,
  revisedCommitmentCents,
  sumApprovedChangeOrders,
  contractDiscrepancyCents,
  paidCents,
  approvedForPaymentCents,
  remainingCommitmentCents,
  retainageOutstandingCents,
  forecastAtCompletionCents,
  varianceCents,
  allocationStatus,
  packageFinancialStatus,
  computeBidStatistics,
  computeBudgetHealth,
  type PackageFinancialStatus,
  type BudgetHealth,
} from "./financial-model.js";

export interface PackageFinancialSummary {
  packageId: string;
  buildingId: string;
  status: PackageFinancialStatus;
  allowanceOriginalCents: number | null;
  allowanceCurrentCents: number | null;
  estimateMinCents: number | null;
  estimateMaxCents: number | null;
  bidStatistics: ReturnType<typeof computeBidStatistics>;
  hasActiveAward: boolean;
  selectedBidId: string | null;
  awardedAmountCents: number | null;
  contractAmountCents: number | null;
  contractDiscrepancyCents: number | null;
  originalCommitmentCents: number;
  approvedChangeOrdersCents: number;
  revisedCommitmentCents: number;
  invoicedGrossCents: number;
  approvedForPaymentCents: number;
  paidCents: number;
  retainageHeldCents: number;
  retainageReleasedCents: number;
  retainageOutstandingCents: number;
  remainingCommitmentCents: number;
  isFinanciallyClosed: boolean;
  finalCostCents: number | null;
  forecastFinalCents: number;
  varianceCents: number | null;
}

export interface ProjectFinancialSummary {
  buildingId: string;
  budgetHealth: BudgetHealth;
  budgetOriginalCents: number | null;
  budgetCurrentCents: number | null;
  contingencyCents: number | null;
  allocatedCents: number;
  unallocatedCents: number | null;
  allocationState: "within_allocation" | "over_allocated" | "unbudgeted";
  committedCents: number;
  contractedCents: number;
  approvedChangeOrdersCents: number;
  revisedCommitmentCents: number;
  invoicedGrossCents: number;
  approvedForPaymentCents: number;
  paidCents: number;
  retainageHeldCents: number;
  retainageOutstandingCents: number;
  remainingCommitmentCents: number;
  forecastAtCompletionCents: number;
  varianceCents: number | null;
  packageCount: number;
  packagesOverAllowance: number;
}

/** Package financial summary - the read model for one procurement package. */
export async function computePackageFinancialSummary(packageId: string): Promise<PackageFinancialSummary | null> {
  const pkg = await q1<any>(`select * from packages where id = $1`, [packageId]);
  if (!pkg) return null;

  const bidRows = await q<{ price: number | null }>(
    `select price from bids where package_id = $1 and coalesce(is_draft,false) = false
       and coalesce(status,'submitted') not in ('withdrawn','rejected')`,
    [packageId],
  );
  const bidStatistics = computeBidStatistics(
    bidRows.map((b) => (b.price != null ? Math.round(Number(b.price) * 100) : null)),
  );

  const award = await q1<any>(`select * from awards where package_id = $1 and status = 'active'`, [packageId]);
  const po = award ? await q1<any>(`select * from purchase_orders where award_id = $1`, [award.id]) : null;

  const originalCommitmentCents = po ? num(po.original_amount_cents) : 0;

  const cos = po
    ? await q<{ cost_impact_cents: number | null }>(
        `select cost_impact_cents from change_orders where purchase_order_id = $1 and status = 'approved'`,
        [po.id],
      )
    : [];
  const approvedChangeOrdersCents = sumApprovedChangeOrders(cos.map((c) => c.cost_impact_cents));
  const revisedCommitment = revisedCommitmentCents(originalCommitmentCents, approvedChangeOrdersCents);

  const agreement = po
    ? await q1<any>(
        `select contract_amount_cents from agreements where purchase_order_id = $1 order by created_at desc limit 1`,
        [po.id],
      )
    : null;
  const contractAmountCents = agreement?.contract_amount_cents != null ? num(agreement.contract_amount_cents) : null;
  const discrepancy = contractDiscrepancyCents(contractAmountCents, originalCommitmentCents);

  const invoiceRows = po
    ? await q<{ status: string; gross_amount_cents: number | null; approved_amount_cents: number | null }>(
        `select status, gross_amount_cents, approved_amount_cents from invoices where purchase_order_id = $1`,
        [po.id],
      )
    : [];
  const invoicedGrossCents = invoiceRows
    .filter((i) => i.status !== "void")
    .reduce((sum, i) => sum + num(i.gross_amount_cents), 0);
  const approvedForPayment = approvedForPaymentCents(
    invoiceRows
      .filter((i) => ["approved", "partially_paid", "paid"].includes(i.status))
      .map((i) => i.approved_amount_cents),
  );

  const releasedRows = po
    ? await q<{ sum: number | null }>(
        `select coalesce(sum(amount_cents),0) as sum from payment_authorizations where purchase_order_id = $1 and status = 'released'`,
        [po.id],
      )
    : [{ sum: 0 }];
  const externalRows = po
    ? await q<{ sum: number | null }>(
        `select coalesce(sum(amount_cents),0) as sum from external_payment_records where purchase_order_id = $1`,
        [po.id],
      )
    : [{ sum: 0 }];
  const paid = paidCents(num(releasedRows[0]?.sum), num(externalRows[0]?.sum));

  // Retainage: sourced ONLY from retainage_records (never from
  // invoices.retainage_cents, which stays informational-only - see header).
  const retainageRows = po
    ? await q<{ retainage_held_cents: number | null; retainage_released_cents: number | null }>(
        `select retainage_held_cents, retainage_released_cents from retainage_records where purchase_order_id = $1`,
        [po.id],
      )
    : [];
  const retainageHeldCents = retainageRows.reduce((s, r) => s + num(r.retainage_held_cents), 0);
  const retainageReleasedCents = retainageRows.reduce((s, r) => s + num(r.retainage_released_cents), 0);

  const remaining = remainingCommitmentCents(revisedCommitment, paid);

  // Closeout (P1-18): packages.financially_closed_at / final_cost_cents.
  const isFinanciallyClosed = !!pkg.financially_closed_at;
  const finalCostCents = pkg.final_cost_cents != null ? num(pkg.final_cost_cents) : null;
  const forecastFinal = forecastAtCompletionCents({
    revisedCommitmentCents: revisedCommitment,
    isFinanciallyClosed,
    finalCostCents,
  });

  const status = packageFinancialStatus({
    hasActiveAward: !!award,
    allowanceCurrentCents: pkg.allowance_current_cents,
    revisedCommitmentCents: revisedCommitment,
  });

  return {
    packageId,
    buildingId: pkg.building_id,
    status,
    allowanceOriginalCents: pkg.allowance_original_cents,
    allowanceCurrentCents: pkg.allowance_current_cents,
    estimateMinCents: pkg.budget_min != null ? Math.round(Number(pkg.budget_min) * 100) : null,
    estimateMaxCents: pkg.budget_max != null ? Math.round(Number(pkg.budget_max) * 100) : null,
    bidStatistics,
    hasActiveAward: !!award,
    selectedBidId: award?.bid_id ?? null,
    awardedAmountCents: award ? num(award.awarded_amount_cents) : null,
    contractAmountCents,
    contractDiscrepancyCents: discrepancy,
    originalCommitmentCents,
    approvedChangeOrdersCents,
    revisedCommitmentCents: revisedCommitment,
    invoicedGrossCents,
    approvedForPaymentCents: approvedForPayment,
    paidCents: paid,
    retainageHeldCents,
    retainageReleasedCents,
    retainageOutstandingCents: retainageOutstandingCents(retainageHeldCents, retainageReleasedCents),
    remainingCommitmentCents: remaining,
    isFinanciallyClosed,
    finalCostCents,
    forecastFinalCents: forecastFinal,
    varianceCents: varianceCents(forecastFinal, pkg.allowance_current_cents),
  };
}

/** Project financial summary - the read model for one building, rolled up from its packages. */
export async function computeProjectFinancialSummary(buildingId: string): Promise<ProjectFinancialSummary | null> {
  const building = await q1<any>(`select * from buildings where id = $1`, [buildingId]);
  if (!building) return null;

  const packageIds = await q<{ id: string }>(`select id from packages where building_id = $1`, [buildingId]);
  const summaries = (
    await Promise.all(packageIds.map((p) => computePackageFinancialSummary(p.id)))
  ).filter((s): s is PackageFinancialSummary => s != null);

  const allocatedCents = summaries.reduce((sum, s) => sum + num(s.allowanceCurrentCents), 0);
  const committedCents = summaries.reduce((sum, s) => sum + s.originalCommitmentCents, 0);
  const contractedCents = summaries.reduce((sum, s) => sum + num(s.contractAmountCents), 0);
  const approvedChangeOrdersCents = summaries.reduce((sum, s) => sum + s.approvedChangeOrdersCents, 0);
  const revisedCommitment = summaries.reduce((sum, s) => sum + s.revisedCommitmentCents, 0);
  const invoicedGrossCents = summaries.reduce((sum, s) => sum + s.invoicedGrossCents, 0);
  const approvedForPayment = summaries.reduce((sum, s) => sum + s.approvedForPaymentCents, 0);
  const paid = summaries.reduce((sum, s) => sum + s.paidCents, 0);
  const retainageHeldCents = summaries.reduce((sum, s) => sum + s.retainageHeldCents, 0);
  const retainageReleasedCents = summaries.reduce((sum, s) => sum + s.retainageReleasedCents, 0);
  const remaining = remainingCommitmentCents(revisedCommitment, paid);
  const packagesOverAllowance = summaries.filter((s) => s.status === "over_budget").length;

  const forecastAtCompletion = summaries.reduce((sum, s) => sum + s.forecastFinalCents, 0);

  const allocation = allocationStatus({
    currentBudgetCents: building.budget_current_cents,
    allocatedCents,
  });

  const contingencyRemainingCents =
    building.contingency_cents != null
      ? num(building.contingency_cents) - Math.max(0, forecastAtCompletion - committedCents)
      : null;

  const budgetHealth = computeBudgetHealth({
    currentBudgetCents: building.budget_current_cents,
    forecastAtCompletionCents: forecastAtCompletion,
    contingencyRemainingCents,
    packageOverageCount: packagesOverAllowance,
  });

  return {
    buildingId,
    budgetHealth,
    budgetOriginalCents: building.budget_original_cents,
    budgetCurrentCents: building.budget_current_cents,
    contingencyCents: building.contingency_cents,
    allocatedCents,
    unallocatedCents: allocation.unallocatedCents,
    allocationState: allocation.state,
    committedCents,
    contractedCents,
    approvedChangeOrdersCents,
    revisedCommitmentCents: revisedCommitment,
    invoicedGrossCents,
    approvedForPaymentCents: approvedForPayment,
    paidCents: paid,
    retainageHeldCents,
    retainageOutstandingCents: retainageOutstandingCents(retainageHeldCents, retainageReleasedCents),
    remainingCommitmentCents: remaining,
    forecastAtCompletionCents: forecastAtCompletion,
    varianceCents: varianceCents(forecastAtCompletion, building.budget_current_cents),
    packageCount: summaries.length,
    packagesOverAllowance,
  };
}
