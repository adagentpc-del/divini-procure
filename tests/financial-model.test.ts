import { test } from "node:test";
import assert from "node:assert/strict";
import {
  revisedCommitmentCents,
  sumApprovedChangeOrders,
  contractDiscrepancyCents,
  netPayableCents,
  paidCents,
  approvedForPaymentCents,
  remainingCommitmentCents,
  isOverCommitment,
  retainageOutstandingCents,
  forecastAtCompletionCents,
  varianceCents,
  allocationStatus,
  packageFinancialStatus,
  computeBidStatistics,
  computeBudgetHealth,
} from "../server/src/lib/financial-model.ts";

// ---- revised commitment / change orders ------------------------------------

test("revisedCommitmentCents: zero change orders leaves commitment unchanged", () => {
  assert.equal(revisedCommitmentCents(500_000_00, 0), 500_000_00);
});

test("revisedCommitmentCents: positive CO increases commitment", () => {
  assert.equal(revisedCommitmentCents(500_000_00, 25_000_00), 525_000_00);
});

test("revisedCommitmentCents: negative CO decreases commitment", () => {
  assert.equal(revisedCommitmentCents(500_000_00, -10_000_00), 490_000_00);
});

test("revisedCommitmentCents: multiple approved COs (worked example from spec)", () => {
  // Original commitment $500,000; CO1 +$25,000; CO2 -$10,000 -> $515,000.
  const delta = sumApprovedChangeOrders([25_000_00, -10_000_00]);
  assert.equal(delta, 15_000_00);
  assert.equal(revisedCommitmentCents(500_000_00, delta), 515_000_00);
});

test("sumApprovedChangeOrders: draft/rejected COs must never be passed in, but a stray null/undefined is tolerated as 0", () => {
  assert.equal(sumApprovedChangeOrders([10_000, null, undefined, -3_000]), 7_000);
});

test("sumApprovedChangeOrders: empty list is zero", () => {
  assert.equal(sumApprovedChangeOrders([]), 0);
});

test("contractDiscrepancyCents: no contract recorded yet returns null (not zero)", () => {
  assert.equal(contractDiscrepancyCents(null, 500_000_00), null);
});

test("contractDiscrepancyCents: contract above award is a positive discrepancy", () => {
  assert.equal(contractDiscrepancyCents(510_000_00, 500_000_00), 10_000_00);
});

test("contractDiscrepancyCents: contract equal to award is zero, not null", () => {
  assert.equal(contractDiscrepancyCents(500_000_00, 500_000_00), 0);
});

// ---- invoicing / payment ----------------------------------------------------

test("netPayableCents: gross minus retainage", () => {
  assert.equal(netPayableCents(500_000_00, 50_000_00), 450_000_00);
});

test("netPayableCents: never negative even if retainage exceeds gross (data error, not a negative payable)", () => {
  assert.equal(netPayableCents(1_000, 5_000), 0);
});

test("netPayableCents: zero retainage passes gross through unchanged", () => {
  assert.equal(netPayableCents(200_000, 0), 200_000);
});

test("paidCents: platform-released + external, both zero", () => {
  assert.equal(paidCents(0, 0), 0);
});

test("paidCents: an 'authorized' (not released) authorization must never be passed in - this combinator trusts its caller filtered it out", () => {
  // Simulates the caller having summed ONLY released rows; a merely-authorized
  // amount contributes nothing here because it was never included upstream.
  assert.equal(paidCents(45_000_00, 0), 45_000_00);
});

test("paidCents: external payment recorded outside the platform is additive and distinguishable in provenance", () => {
  assert.equal(paidCents(0, 125_000_00), 125_000_00);
});

test("paidCents: a failed payment must never be summed in - simulated by omitting it from the input entirely", () => {
  // A failed payment contributes 0 by never being included in either sum.
  assert.equal(paidCents(10_000, 0), 10_000);
});

test("approvedForPaymentCents: multiple invoices sum correctly", () => {
  assert.equal(approvedForPaymentCents([450_000_00, 200_000_00, 0]), 650_000_00);
});

test("approvedForPaymentCents: a void/rejected invoice contributes nothing - simulated by omission", () => {
  assert.equal(approvedForPaymentCents([450_000_00]), 450_000_00);
});

test("remainingCommitmentCents: partial payment leaves a positive remainder", () => {
  assert.equal(remainingCommitmentCents(1_900_000_00, 450_000_00), 1_450_000_00);
});

test("remainingCommitmentCents: fully paid leaves zero", () => {
  assert.equal(remainingCommitmentCents(1_000_00, 1_000_00), 0);
});

test("remainingCommitmentCents: overpaid relative to current commitment surfaces as negative, not clamped", () => {
  assert.equal(remainingCommitmentCents(400_000_00, 450_000_00), -50_000_00);
});

test("isOverCommitment: cumulative invoiced under commitment is not flagged", () => {
  assert.equal(isOverCommitment(400_000_00, 500_000_00), false);
});

test("isOverCommitment: cumulative invoiced over commitment is flagged", () => {
  assert.equal(isOverCommitment(600_000_00, 500_000_00), true);
});

test("isOverCommitment: exactly at commitment is not over", () => {
  assert.equal(isOverCommitment(500_000_00, 500_000_00), false);
});

test("isOverCommitment: no commitment on record (null) never flags", () => {
  assert.equal(isOverCommitment(600_000_00, null), false);
});

// ---- retainage ---------------------------------------------------------------

test("retainageOutstandingCents: held minus released", () => {
  assert.equal(retainageOutstandingCents(50_000_00, 0), 50_000_00);
});

test("retainageOutstandingCents: fully released is zero", () => {
  assert.equal(retainageOutstandingCents(50_000_00, 50_000_00), 0);
});

// ---- forecast / variance / closeout -------------------------------------------

test("forecastAtCompletionCents: open package forecasts as the revised commitment", () => {
  assert.equal(
    forecastAtCompletionCents({ revisedCommitmentCents: 1_900_000_00, isFinanciallyClosed: false }),
    1_900_000_00,
  );
});

test("forecastAtCompletionCents: closed package forecasts as the recorded final cost, not the revised commitment", () => {
  assert.equal(
    forecastAtCompletionCents({
      revisedCommitmentCents: 1_900_000_00,
      isFinanciallyClosed: true,
      finalCostCents: 1_875_000_00,
    }),
    1_875_000_00,
  );
});

test("forecastAtCompletionCents: closed but no final cost recorded falls back to revised commitment (never fabricates a final cost)", () => {
  assert.equal(
    forecastAtCompletionCents({ revisedCommitmentCents: 900_000, isFinanciallyClosed: true, finalCostCents: null }),
    900_000,
  );
});

test("varianceCents: over budget is positive", () => {
  assert.equal(varianceCents(2_050_000_00, 2_000_000_00), 50_000_00);
});

test("varianceCents: under budget is negative", () => {
  assert.equal(varianceCents(1_800_000_00, 2_000_000_00), -200_000_00);
});

test("varianceCents: exactly on budget is zero", () => {
  assert.equal(varianceCents(2_000_000_00, 2_000_000_00), 0);
});

test("varianceCents: no budget set returns null, not a false zero/positive", () => {
  assert.equal(varianceCents(500_000, null), null);
});

// ---- allocation integrity -----------------------------------------------------

test("allocationStatus: within allocation", () => {
  const r = allocationStatus({ currentBudgetCents: 20_000_000_00, allocatedCents: 15_000_000_00 });
  assert.equal(r.state, "within_allocation");
  assert.equal(r.unallocatedCents, 5_000_000_00);
});

test("allocationStatus: over-allocated is flagged, not blocked", () => {
  const r = allocationStatus({ currentBudgetCents: 20_000_000_00, allocatedCents: 27_000_000_00 });
  assert.equal(r.state, "over_allocated");
  assert.equal(r.unallocatedCents, -7_000_000_00);
});

test("allocationStatus: unbudgeted project has no allocation state", () => {
  const r = allocationStatus({ currentBudgetCents: null, allocatedCents: 100 });
  assert.equal(r.state, "unbudgeted");
  assert.equal(r.unallocatedCents, null);
});

// ---- package financial status --------------------------------------------------

test("packageFinancialStatus: no active award (or a cancelled award leaving none active)", () => {
  assert.equal(
    packageFinancialStatus({ hasActiveAward: false, allowanceCurrentCents: 1_000_000, revisedCommitmentCents: 0 }),
    "no_award_yet",
  );
});

test("packageFinancialStatus: awarded with no allowance set is unbudgeted", () => {
  assert.equal(
    packageFinancialStatus({ hasActiveAward: true, allowanceCurrentCents: null, revisedCommitmentCents: 500_000 }),
    "unbudgeted",
  );
});

test("packageFinancialStatus: under allowance", () => {
  assert.equal(
    packageFinancialStatus({ hasActiveAward: true, allowanceCurrentCents: 2_000_000_00, revisedCommitmentCents: 1_900_000_00 }),
    "within_budget",
  );
});

test("packageFinancialStatus: over allowance", () => {
  assert.equal(
    packageFinancialStatus({ hasActiveAward: true, allowanceCurrentCents: 2_000_000_00, revisedCommitmentCents: 2_050_000_00 }),
    "over_budget",
  );
});

// ---- bid statistics --------------------------------------------------------------

test("computeBidStatistics: no bids", () => {
  const s = computeBidStatistics([]);
  assert.equal(s.validBidCount, 0);
  assert.equal(s.lowCents, null);
});

test("computeBidStatistics: single bid - low/high/median/average all equal it", () => {
  const s = computeBidStatistics([500_000]);
  assert.equal(s.validBidCount, 1);
  assert.equal(s.lowCents, 500_000);
  assert.equal(s.highCents, 500_000);
  assert.equal(s.medianCents, 500_000);
  assert.equal(s.averageCents, 500_000);
});

test("computeBidStatistics: odd count median is the middle value", () => {
  const s = computeBidStatistics([300, 100, 200]);
  assert.equal(s.lowCents, 100);
  assert.equal(s.highCents, 300);
  assert.equal(s.medianCents, 200);
  assert.equal(s.averageCents, 200);
});

test("computeBidStatistics: even count median averages the two middle values", () => {
  const s = computeBidStatistics([100, 200, 300, 400]);
  assert.equal(s.medianCents, 250);
  assert.equal(s.averageCents, 250);
});

test("computeBidStatistics: null/undefined entries (withdrawn or unpriced bids) are excluded, not zeroed", () => {
  const s = computeBidStatistics([100, null, 300, undefined]);
  assert.equal(s.validBidCount, 2);
  assert.equal(s.lowCents, 100);
});

// ---- budget health (deterministic, not predictive) --------------------------------

test("computeBudgetHealth: unbudgeted project", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: null,
      forecastAtCompletionCents: 1_000_000,
      contingencyRemainingCents: null,
      packageOverageCount: 0,
    }),
    "unbudgeted",
  );
});

test("computeBudgetHealth: comfortably under budget with contingency remaining is healthy", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: 30_000_000_00,
      forecastAtCompletionCents: 20_000_000_00,
      contingencyRemainingCents: 500_000_00,
      packageOverageCount: 0,
    }),
    "healthy",
  );
});

test("computeBudgetHealth: forecast within 5% of budget is at_risk", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: 30_000_000_00,
      forecastAtCompletionCents: 29_000_000_00,
      contingencyRemainingCents: 500_000_00,
      packageOverageCount: 0,
    }),
    "at_risk",
  );
});

test("computeBudgetHealth: any package already over its own allowance is at_risk even if the project total is not yet over", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: 30_000_000_00,
      forecastAtCompletionCents: 10_000_000_00,
      contingencyRemainingCents: 500_000_00,
      packageOverageCount: 1,
    }),
    "at_risk",
  );
});

test("computeBudgetHealth: forecast exceeds budget is over_budget", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: 30_000_000_00,
      forecastAtCompletionCents: 30_500_000_00,
      contingencyRemainingCents: 0,
      packageOverageCount: 2,
    }),
    "over_budget",
  );
});

test("computeBudgetHealth: exhausted contingency alone triggers at_risk even with forecast well under budget", () => {
  assert.equal(
    computeBudgetHealth({
      currentBudgetCents: 30_000_000_00,
      forecastAtCompletionCents: 10_000_000_00,
      contingencyRemainingCents: 0,
      packageOverageCount: 0,
    }),
    "at_risk",
  );
});
