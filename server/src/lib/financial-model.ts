/**
 * Divini Procure - Canonical Procurement + Financial Model (Phase 1).
 *
 * Pure, deterministic, no-IO domain functions. Every number that appears on
 * a project or package financial summary is computed by a function in this
 * file from inputs the caller already aggregated from the database - never
 * a mutable cached total that a write path increments/decrements in place.
 * This matches the "recompute from source, never trust an incremental
 * counter" precedent the codebase already established for
 * retainage_held_cents (db/schema-retainage.sql) and is a deliberate,
 * stronger reading of the Phase 0 design proposal (which suggested cached
 * columns): the Phase 1 instruction set says explicitly "Do NOT create
 * mutable totals that can silently drift if they can safely be derived from
 * canonical transactions," so this phase computes every summary field live,
 * on read, from the authoritative child rows.
 *
 * Money is integer cents everywhere (bigint columns), matching the rest of
 * the money-handling code added in Phase 0. Zero em dashes by convention.
 *
 * ============================================================================
 * CANONICAL DEFINITIONS (also reproduced in docs/phase1-financial-spine-implementation.md)
 * ============================================================================
 *
 * COMMITTED         The awarded amount captured at the moment of award
 *                    (awards.awarded_amount_cents). This IS the "committed"
 *                    event - award/PO creation is the one canonical
 *                    commitment event in this system (never re-derived from
 *                    a later PO edit; the PO's own amount_cents field is
 *                    fixed at creation and only moves via change orders).
 *
 * CONTRACTED         The signed agreement's own contract_amount_cents, when
 *                    an agreement has been linked and executed (status
 *                    'signed'). Tracked and displayed ALONGSIDE committed,
 *                    never silently substituted for it - a contract amount
 *                    that differs from the award is a visible discrepancy,
 *                    not an overwrite (see contractDiscrepancyCents()).
 *
 * APPROVED CHANGE ORDERS   The signed sum of change_orders.cost_impact_cents
 *                    for every change order in status 'approved' against a
 *                    given package/PO. Draft/submitted/under_review/rejected/
 *                    cancelled change orders never affect this number.
 *                    Negative values are valid (a deductive change order).
 *
 * REVISED COMMITMENT       committed + approvedChangeOrderDelta. The single
 *                    number "what have we actually committed to pay this
 *                    vendor, right now, including every approved change."
 *
 * INVOICED (gross)   Sum of invoices.gross_amount_cents for every invoice
 *                    NOT in status 'void' against a package/PO.
 *
 * APPROVED FOR PAYMENT     Sum of invoices.approved_amount_cents for every
 *                    invoice in status 'approved' | 'partially_paid' | 'paid'.
 *                    An invoice merely 'submitted' or 'under_review' is NOT
 *                    approved for payment yet - only a developer decision
 *                    moves it into this set.
 *
 * PAID               Sum of actually-completed payments: platform-recorded
 *                    payment_authorizations rows in status 'released' PLUS
 *                    external_payment_records rows (developer-recorded,
 *                    provenance 'external', never a Stripe/platform-processed
 *                    payment). An authorization merely 'authorized' is
 *                    approved-for-payment, NOT yet paid - see PAYMENT.md
 *                    distinction enforced by paidCents() below.
 *
 * RETAINAGE HELD / RELEASED     From retainage_records (already linked to its
 *                    purchase_order per Phase 0 item 12), NOT independently
 *                    derived from invoices.retainage_cents (each invoice's
 *                    retainage_cents is an informational per-invoice line,
 *                    not additive to the package/project retainage total -
 *                    see the "no double counting" note on netPayableCents()).
 *
 * REMAINING COMMITMENT     revisedCommitment - paid. Can be negative (a real
 *                    signal that more has been paid than currently committed
 *                    - e.g. before a pending change order is approved).
 *
 * FORECAST AT COMPLETION   revisedCommitment while the package is open;
 *                    becomes the recorded finalCostCents ONLY after the
 *                    package reaches financial closeout (see
 *                    forecastAtCompletionCents()). Never a predictive
 *                    number - Phase 1 does not build cost forecasting AI.
 *
 * VARIANCE           forecastAtCompletion - budgetCents (allowance at
 *                    package level, current budget at project level).
 *                    Positive = over; negative = under.
 * ============================================================================
 */

export function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Commitment / revised commitment
// ---------------------------------------------------------------------------

/** revised commitment = the originally committed (awarded) amount + the net approved change-order delta. */
export function revisedCommitmentCents(
  originalCommitmentCents: number | null | undefined,
  approvedChangeOrderDeltaCents: number | null | undefined,
): number {
  return num(originalCommitmentCents) + num(approvedChangeOrderDeltaCents);
}

/**
 * The signed sum of APPROVED change orders only. Draft/submitted/under_review/
 * rejected/cancelled change orders contribute 0. Negative cost_impact_cents
 * (a deductive CO) subtracts normally - callers pass every approved CO's
 * cost_impact_cents and this simply sums them (kept as a named function so
 * the "approved-only" filter is documented in one place rather than repeated
 * inline everywhere a change-order total is needed).
 */
export function sumApprovedChangeOrders(
  approvedChangeOrderCostImpactsCents: Array<number | string | null | undefined>,
): number {
  return approvedChangeOrderCostImpactsCents.reduce<number>((sum, v) => sum + num(v), 0);
}

/**
 * A contract's own recorded amount can legitimately differ from the award/PO
 * commitment (see §20 of the Phase 1 instruction). Returns the signed
 * difference (contract - committed); 0 means they agree; null means no
 * contract amount is recorded yet (nothing to compare).
 */
export function contractDiscrepancyCents(
  contractAmountCents: number | null | undefined,
  originalCommitmentCents: number | null | undefined,
): number | null {
  if (contractAmountCents == null) return null;
  return num(contractAmountCents) - num(originalCommitmentCents);
}

// ---------------------------------------------------------------------------
// Payment / invoicing
// ---------------------------------------------------------------------------

/** net payable for ONE invoice = its gross amount minus the retainage withheld on that invoice. Never negative. */
export function netPayableCents(
  grossAmountCents: number | null | undefined,
  retainageCents: number | null | undefined,
): number {
  return Math.max(0, num(grossAmountCents) - num(retainageCents));
}

/**
 * PAID must only ever count money that has actually moved (or been recorded
 * as having moved outside the platform) - never an authorization that is
 * merely 'authorized' (approved-for-payment). Callers pass the two already
 * status-filtered sums so this function stays a pure combinator: it does not
 * itself know how to query payment_authorizations or external_payment_records.
 */
export function paidCents(
  releasedPlatformPaymentAuthCents: number | null | undefined,
  externalPaymentCents: number | null | undefined,
): number {
  return num(releasedPlatformPaymentAuthCents) + num(externalPaymentCents);
}

/** approved-for-payment (NOT yet necessarily paid): sum of invoice approved_amount_cents in approved|partially_paid|paid status. */
export function approvedForPaymentCents(
  approvedInvoiceAmountsCents: Array<number | string | null | undefined>,
): number {
  return approvedInvoiceAmountsCents.reduce<number>((sum, v) => sum + num(v), 0);
}

/**
 * remaining commitment = revised commitment - paid. Deliberately NOT floored
 * at zero: a negative result is a real, meaningful signal (more has been
 * paid than is currently committed - typically because a change order that
 * will restore the commitment is still pending approval) and must not be
 * hidden by clamping.
 */
export function remainingCommitmentCents(
  revisedCommitmentCentsValue: number | null | undefined,
  paidCentsValue: number | null | undefined,
): number {
  return num(revisedCommitmentCentsValue) - num(paidCentsValue);
}

/**
 * True when this invoice's cumulative gross (this invoice + every prior
 * non-void invoice against the same PO) would exceed the PO's revised
 * commitment. This is a FLAG, never a hard block (per §25: "do not
 * automatically reject legitimate overage scenarios") - the caller decides
 * whether to require additional approval before accepting the invoice.
 */
export function isOverCommitment(
  cumulativeInvoicedGrossCents: number,
  revisedCommitmentCentsValue: number | null | undefined,
): boolean {
  if (revisedCommitmentCentsValue == null) return false;
  return cumulativeInvoicedGrossCents > num(revisedCommitmentCentsValue);
}

// ---------------------------------------------------------------------------
// Retainage
// ---------------------------------------------------------------------------

/** retainage still outstanding = held - released. Never floored (a released > held state is a data error worth surfacing, not hiding). */
export function retainageOutstandingCents(
  retainageHeldCents: number | null | undefined,
  retainageReleasedCents: number | null | undefined,
): number {
  return num(retainageHeldCents) - num(retainageReleasedCents);
}

// ---------------------------------------------------------------------------
// Forecast / variance / closeout
// ---------------------------------------------------------------------------

/**
 * Forecast at completion. While a package/project is open, the forecast IS
 * the revised commitment (no predictive modeling - Phase 1 explicitly does
 * not build cost forecasting AI). Once financially closed, the forecast
 * becomes the recorded final cost - see §48/§49: "a project/package is not
 * final just because all currently known invoices are paid," closeout is an
 * explicit, separate event (financial-closeout.ts) that stamps finalCostCents.
 */
export function forecastAtCompletionCents(input: {
  revisedCommitmentCents: number;
  isFinanciallyClosed: boolean;
  finalCostCents?: number | null;
}): number {
  if (input.isFinanciallyClosed && input.finalCostCents != null) {
    return num(input.finalCostCents);
  }
  return num(input.revisedCommitmentCents);
}

/** variance = forecast - budget (allowance at package level, current budget at project level). Positive = over. */
export function varianceCents(
  forecastCentsValue: number | null | undefined,
  budgetCentsValue: number | null | undefined,
): number | null {
  if (budgetCentsValue == null) return null;
  return num(forecastCentsValue) - num(budgetCentsValue);
}

// ---------------------------------------------------------------------------
// Allocation integrity (project budget vs sum of package allowances)
// ---------------------------------------------------------------------------

export type AllocationState = "within_allocation" | "over_allocated" | "unbudgeted";

export function allocationStatus(input: {
  currentBudgetCents: number | null | undefined;
  allocatedCents: number | null | undefined;
}): { unallocatedCents: number | null; state: AllocationState } {
  if (input.currentBudgetCents == null) {
    return { unallocatedCents: null, state: "unbudgeted" };
  }
  const unallocated = num(input.currentBudgetCents) - num(input.allocatedCents);
  return {
    unallocatedCents: unallocated,
    state: unallocated < 0 ? "over_allocated" : "within_allocation",
  };
}

// ---------------------------------------------------------------------------
// Package financial status label (a label derived from real numbers, never a
// new source of truth - mirrors the Phase 0 ProjectHealthBadge precedent).
// ---------------------------------------------------------------------------

export type PackageFinancialStatus =
  | "no_award_yet"
  | "unbudgeted"
  | "within_budget"
  | "over_budget";

export function packageFinancialStatus(input: {
  hasActiveAward: boolean;
  allowanceCurrentCents: number | null | undefined;
  revisedCommitmentCents: number;
}): PackageFinancialStatus {
  if (!input.hasActiveAward) return "no_award_yet";
  if (input.allowanceCurrentCents == null) return "unbudgeted";
  return input.revisedCommitmentCents > num(input.allowanceCurrentCents)
    ? "over_budget"
    : "within_budget";
}

// ---------------------------------------------------------------------------
// Bid statistics (structural support only - not a leveling/normalization
// engine; §10 explicitly: "Do not confuse these with normalized/leveled
// values yet.")
// ---------------------------------------------------------------------------

export interface BidStatistics {
  validBidCount: number;
  lowCents: number | null;
  highCents: number | null;
  medianCents: number | null;
  averageCents: number | null;
}

export function computeBidStatistics(bidAmountsCents: Array<number | null | undefined>): BidStatistics {
  const valid = bidAmountsCents.filter((v): v is number => v != null && Number.isFinite(v));
  if (valid.length === 0) {
    return { validBidCount: 0, lowCents: null, highCents: null, medianCents: null, averageCents: null };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  const average = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return {
    validBidCount: sorted.length,
    lowCents: sorted[0],
    highCents: sorted[sorted.length - 1],
    medianCents: median,
    averageCents: average,
  };
}

// ---------------------------------------------------------------------------
// Deterministic budget health (§52 - transparent rules, not predictive AI)
// ---------------------------------------------------------------------------

export type BudgetHealth = "healthy" | "at_risk" | "over_budget" | "unbudgeted";

export function computeBudgetHealth(input: {
  currentBudgetCents: number | null | undefined;
  forecastAtCompletionCents: number;
  contingencyRemainingCents: number | null | undefined;
  packageOverageCount: number;
}): BudgetHealth {
  if (input.currentBudgetCents == null) return "unbudgeted";
  const budget = num(input.currentBudgetCents);
  const variance = input.forecastAtCompletionCents - budget;
  if (variance > 0) return "over_budget";
  // At risk: forecast within 5% of budget, contingency mostly spent, or any
  // package already over its own allowance even though the project overall
  // is not yet over budget.
  const nearLimit = budget > 0 && variance >= -0.05 * budget;
  const contingencyLow =
    input.contingencyRemainingCents != null && num(input.contingencyRemainingCents) <= 0;
  if (nearLimit || contingencyLow || input.packageOverageCount > 0) return "at_risk";
  return "healthy";
}
