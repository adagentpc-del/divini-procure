/**
 * Tests for the pure Divini Scope Builder completeness score
 * (server/src/lib/scope-completeness.ts). No DB, no env.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreScopeCompleteness } from "../server/src/lib/scope-completeness.ts";

test("completeness: fully empty scope with no required fields scores exactly 40 (required-fields factor auto-met)", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: 0, requiredFieldsAnswered: 0 });
  assert.equal(r.score, 40);
  assert.ok(r.positives.includes("No required fields on this template"));
  assert.equal(r.missing.length, 6);
});

test("completeness: everything filled scores exactly 100", () => {
  const r = scoreScopeCompleteness({
    requiredFieldsTotal: 3,
    requiredFieldsAnswered: 3,
    siteConditions: "Tight urban lot, one lane access",
    accessRestrictions: "No deliveries before 7am",
    deliveryRequirements: "Loading dock on north side",
    exclusions: ["Permits"],
    acceptanceCriteria: ["Passes inspection"],
    changeOrderRules: "Written approval required before extra work begins",
  });
  assert.equal(r.score, 100);
  assert.equal(r.missing.length, 0);
});

test("completeness: partial required fields earn proportional points", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: 4, requiredFieldsAnswered: 2 });
  const reqFactor = r.factors.find((f) => f.code === "required_fields")!;
  assert.equal(reqFactor.earnedPoints, 20); // 2/4 of 40
  assert.equal(reqFactor.met, false);
});

test("completeness: factor points sum to exactly 100 when all met", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: 1, requiredFieldsAnswered: 1 });
  const total = r.factors.reduce((sum, f) => sum + f.points, 0);
  assert.equal(total, 100);
});

test("completeness: delivery_install factor is met by EITHER delivery or install text", () => {
  const deliveryOnly = scoreScopeCompleteness({ requiredFieldsTotal: 0, requiredFieldsAnswered: 0, deliveryRequirements: "x" });
  assert.ok(deliveryOnly.positives.includes("Delivery/install requirements described"));

  const installOnly = scoreScopeCompleteness({ requiredFieldsTotal: 0, requiredFieldsAnswered: 0, installRequirements: "x" });
  assert.ok(installOnly.positives.includes("Delivery/install requirements described"));
});

test("completeness: whitespace-only text does not count as filled", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: 0, requiredFieldsAnswered: 0, siteConditions: "   " });
  assert.ok(r.missing.includes("Site conditions not described"));
});

test("completeness: answered count is clamped to total (never exceeds it)", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: 2, requiredFieldsAnswered: 10 });
  const reqFactor = r.factors.find((f) => f.code === "required_fields")!;
  assert.equal(reqFactor.earnedPoints, 40);
  assert.equal(reqFactor.met, true);
});

test("completeness: score never exceeds 100 or drops below 0", () => {
  const r = scoreScopeCompleteness({ requiredFieldsTotal: -5, requiredFieldsAnswered: -5 });
  assert.ok(r.score <= 100 && r.score >= 0);
});
