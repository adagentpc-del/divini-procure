/**
 * Tests for the pure fee arithmetic (server/src/lib/feeMath.ts).
 *
 * Covers the platform fee computed on a few amounts (exact cents) and the
 * protected grandfathered existing-relationship 2% rule in isolation. No DB,
 * no env, no config: this module is dependency-free.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STANDARD_FEE_PERCENTAGE,
  GRANDFATHERED_FEE_PERCENTAGE,
  feeCentsFromPercentage,
  resolveFeeRule,
  successFeeCents,
  num,
} from "../server/src/lib/feeMath.ts";

test("success fee: 2% under the cap is the full percentage", () => {
  // $100,000 award, 2%, cap $2,500 -> $2,000 (under cap)
  assert.equal(successFeeCents(10_000_000, 2, 250_000), 200_000);
});
test("success fee: large award is capped at $2,500", () => {
  // $1,000,000 award, 2% = $20,000, capped at $2,500
  assert.equal(successFeeCents(100_000_000, 2, 250_000), 250_000);
  // $5,000,000 award still capped
  assert.equal(successFeeCents(500_000_000, 2, 250_000), 250_000);
});
test("success fee: grandfathered 1% capped $1,000", () => {
  assert.equal(successFeeCents(5_000_000, 1, 100_000), 50_000);      // $50k -> $500
  assert.equal(successFeeCents(100_000_000, 1, 100_000), 100_000);   // $1M -> capped $1,000
});
test("success fee: zero/negative award yields zero; no cap when cap<=0", () => {
  assert.equal(successFeeCents(0, 2, 250_000), 0);
  assert.equal(successFeeCents(-100, 2, 250_000), 0);
  assert.equal(successFeeCents(100_000_000, 2, 0), 2_000_000); // no cap -> full 2%
});

test("constants: defaults are 10% standard and 2% grandfathered", () => {
  assert.equal(DEFAULT_STANDARD_FEE_PERCENTAGE, 10.0);
  assert.equal(GRANDFATHERED_FEE_PERCENTAGE, 2.0);
});

test("feeCentsFromPercentage: 10% platform fee on exact amounts", () => {
  // $100.00 -> $10.00
  assert.equal(feeCentsFromPercentage(10_000, 10), 1_000);
  // $1.00 -> $0.10
  assert.equal(feeCentsFromPercentage(100, 10), 10);
  // $250.50 -> $25.05
  assert.equal(feeCentsFromPercentage(25_050, 10), 2_505);
  // $0 -> $0
  assert.equal(feeCentsFromPercentage(0, 10), 0);
});

test("feeCentsFromPercentage: 2% grandfathered fee on exact amounts", () => {
  // $100.00 @ 2% -> $2.00
  assert.equal(feeCentsFromPercentage(10_000, 2), 200);
  // $1,234.50 @ 2% -> $24.69
  assert.equal(feeCentsFromPercentage(123_450, 2), 2_469);
});

test("feeCentsFromPercentage: rounds to nearest cent (half up via Math.round)", () => {
  // 12345 * 10 / 100 = 1234.5 -> rounds to 1235
  assert.equal(feeCentsFromPercentage(12_345, 10), 1_235);
  // 12344 * 10 / 100 = 1234.4 -> rounds to 1234
  assert.equal(feeCentsFromPercentage(12_344, 10), 1_234);
});

test("feeCentsFromPercentage: clamps negative base and negative result to 0", () => {
  assert.equal(feeCentsFromPercentage(-5_000, 10), 0);
  assert.equal(feeCentsFromPercentage(10_000, -10), 0);
});

test("feeCentsFromPercentage: accepts numeric strings and nullish", () => {
  assert.equal(feeCentsFromPercentage("10000", "10"), 1_000);
  assert.equal(feeCentsFromPercentage(null, 10), 0);
  assert.equal(feeCentsFromPercentage(10_000, null), 0);
});

test("num: coerces strings, passes through finite numbers, falls back otherwise", () => {
  assert.equal(num("2.5"), 2.5);
  assert.equal(num(7), 7);
  assert.equal(num(null, 10), 10);
  assert.equal(num(undefined, 10), 10);
  assert.equal(num("not-a-number", 10), 10);
});

test("resolveFeeRule: null relationship yields standard fee at default rate", () => {
  const r = resolveFeeRule(null);
  assert.equal(r.grandfathered, false);
  assert.equal(r.source, "standard");
  assert.equal(r.feePercentage, DEFAULT_STANDARD_FEE_PERCENTAGE);
  assert.equal(r.appliesForever, false);
});

test("resolveFeeRule: honors a caller-supplied standard rate", () => {
  const r = resolveFeeRule(null, 12.5);
  assert.equal(r.feePercentage, 12.5);
  assert.equal(r.grandfathered, false);
});

test("resolveFeeRule: grandfathered pair returns the protected 2% and applies forever", () => {
  const r = resolveFeeRule({
    relationship_status: "grandfathered_2_percent",
    grandfathered_fee_eligible: true,
  });
  assert.equal(r.grandfathered, true);
  assert.equal(r.source, "grandfathered_2_percent");
  assert.equal(r.feePercentage, 2.0);
  assert.equal(r.appliesForever, true);
});

test("resolveFeeRule: grandfathered status WITHOUT eligibility flag is NOT grandfathered", () => {
  const r = resolveFeeRule({
    relationship_status: "grandfathered_2_percent",
    grandfathered_fee_eligible: false,
  });
  assert.equal(r.grandfathered, false);
  assert.equal(r.source, "standard");
});

test("resolveFeeRule: a standard-status pair uses its own standard_fee_percentage", () => {
  const r = resolveFeeRule({
    relationship_status: "standard_fee",
    standard_fee_percentage: 8,
  });
  assert.equal(r.grandfathered, false);
  assert.equal(r.feePercentage, 8);
});

test("resolveFeeRule: a grandfathered pair can carry appliesForever=false explicitly", () => {
  const r = resolveFeeRule({
    relationship_status: "grandfathered_2_percent",
    grandfathered_fee_eligible: true,
    grandfathered_fee_applies_forever: false,
    grandfathered_fee_percentage: 2,
  });
  assert.equal(r.grandfathered, true);
  assert.equal(r.appliesForever, false);
});

test("end to end: grandfathered 2% on $1,000 charge is $20.00", () => {
  const resolved = resolveFeeRule({
    relationship_status: "grandfathered_2_percent",
    grandfathered_fee_eligible: true,
  });
  const fee = feeCentsFromPercentage(100_000, resolved.feePercentage);
  assert.equal(fee, 2_000);
});

test("end to end: standard 10% on $1,000 charge is $100.00", () => {
  const resolved = resolveFeeRule(null);
  const fee = feeCentsFromPercentage(100_000, resolved.feePercentage);
  assert.equal(fee, 10_000);
});
