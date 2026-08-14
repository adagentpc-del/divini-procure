/**
 * Tests for the pure Divini Bid Studio totals + readiness score
 * (server/src/lib/bid-totals.ts). No DB, no env.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBidTotals, scoreBidReadiness } from "../server/src/lib/bid-totals.ts";

test("totals: subtotal is qty * unitPrice converted to cents", () => {
  const r = computeBidTotals({ lineItems: [{ qty: 3, unitPriceDollars: 100 }] });
  assert.equal(r.subtotalCents, 30_000);
  assert.equal(r.totalCents, 30_000);
  assert.equal(r.includedLineItemCount, 1);
});

test("totals: an unselected optional line item is excluded from the subtotal", () => {
  const r = computeBidTotals({
    lineItems: [
      { qty: 1, unitPriceDollars: 100 },
      { qty: 1, unitPriceDollars: 50, optional: true, selected: false },
    ],
  });
  assert.equal(r.subtotalCents, 10_000);
  assert.equal(r.includedLineItemCount, 1);
  assert.equal(r.lineItemCount, 2);
});

test("totals: a SELECTED optional line item IS included", () => {
  const r = computeBidTotals({
    lineItems: [{ qty: 1, unitPriceDollars: 50, optional: true, selected: true }],
  });
  assert.equal(r.subtotalCents, 5_000);
  assert.equal(r.includedLineItemCount, 1);
});

test("totals: discount reduces total, tax is added on top, neither goes negative", () => {
  const r = computeBidTotals({
    lineItems: [{ qty: 1, unitPriceDollars: 100 }],
    discountCents: 2_000,
    taxCents: 500,
  });
  // 10,000 - 2,000 + 500 = 8,500
  assert.equal(r.totalCents, 8_500);

  const overDiscounted = computeBidTotals({
    lineItems: [{ qty: 1, unitPriceDollars: 10 }],
    discountCents: 5_000,
  });
  assert.equal(overDiscounted.totalCents, 0); // never negative
});

test("totals: explicit depositCents wins over depositPercentBasisPoints", () => {
  const r = computeBidTotals({
    lineItems: [{ qty: 1, unitPriceDollars: 1_000 }],
    depositCents: 12_345,
    depositPercentBasisPoints: 5_000, // would be 50,000 cents if used
  });
  assert.equal(r.depositCents, 12_345);
});

test("totals: depositPercentBasisPoints applies to the TOTAL, not the subtotal", () => {
  const r = computeBidTotals({
    lineItems: [{ qty: 1, unitPriceDollars: 1_000 }],
    taxCents: 10_000, // total = 100,000 + 10,000 = 110,000
    depositPercentBasisPoints: 1_000, // 10%
  });
  assert.equal(r.totalCents, 110_000);
  assert.equal(r.depositCents, 11_000);
});

test("totals: an empty bid has zero totals and zero line items", () => {
  const r = computeBidTotals({ lineItems: [] });
  assert.equal(r.subtotalCents, 0);
  assert.equal(r.totalCents, 0);
  assert.equal(r.depositCents, 0);
  assert.equal(r.lineItemCount, 0);
});

test("readiness: factor points sum to exactly 100", () => {
  const r = scoreBidReadiness({ lineItemCount: 0, totalCents: 0 });
  const total = r.factors.reduce((sum, f) => sum + f.points, 0);
  assert.equal(total, 100);
});

test("readiness: a fully filled-out bid scores exactly 100", () => {
  const r = scoreBidReadiness({
    lineItemCount: 3,
    totalCents: 50_000,
    expiresAt: "2026-09-01",
    terms: "Net 30",
    hasDepositTerms: true,
    hasAssumptionsOrExclusions: true,
  });
  assert.equal(r.score, 100);
  assert.equal(r.missing.length, 0);
});

test("readiness: an empty draft scores 0 with every factor missing", () => {
  const r = scoreBidReadiness({ lineItemCount: 0, totalCents: 0 });
  assert.equal(r.score, 0);
  assert.equal(r.missing.length, 6);
});
