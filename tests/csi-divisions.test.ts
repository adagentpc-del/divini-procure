/**
 * Tests for the pure CSI division lookup (server/src/lib/csi-divisions.ts).
 * No DB, no env. Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { divisionByCode, guessCsiDivision, missingDivisionsForDrawingDisciplines, CSI_DIVISIONS } from "../server/src/lib/csi-divisions.ts";

test("csi: divisionByCode finds a known division", () => {
  assert.deepEqual(divisionByCode("26"), { code: "26", name: "Electrical" });
});

test("csi: divisionByCode returns null for an unknown code", () => {
  assert.equal(divisionByCode("99"), null);
});

test("csi: guessCsiDivision maps electrical discipline to Division 26", () => {
  assert.deepEqual(guessCsiDivision("electrical"), { code: "26", name: "Electrical" });
});

test("csi: guessCsiDivision returns null for disciplines with no single-division mapping", () => {
  assert.equal(guessCsiDivision("survey"), null);
  assert.equal(guessCsiDivision("geotechnical"), null);
  assert.equal(guessCsiDivision("environmental"), null);
  assert.equal(guessCsiDivision("general"), null);
});

test("csi: every division has a unique code", () => {
  const codes = CSI_DIVISIONS.map((d) => d.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("csi: missingDivisionsForDrawingDisciplines flags a division implied by drawings but not tagged on any spec", () => {
  const missing = missingDivisionsForDrawingDisciplines(["electrical", "plumbing"], []);
  const codes = missing.map((d) => d.code);
  assert.ok(codes.includes("26"));
  assert.ok(codes.includes("22"));
});

test("csi: missingDivisionsForDrawingDisciplines excludes a division already covered by a tagged spec", () => {
  const missing = missingDivisionsForDrawingDisciplines(["electrical", "plumbing"], ["26"]);
  const codes = missing.map((d) => d.code);
  assert.ok(!codes.includes("26"));
  assert.ok(codes.includes("22"));
});

test("csi: missingDivisionsForDrawingDisciplines deduplicates disciplines that map to the same division", () => {
  const missing = missingDivisionsForDrawingDisciplines(["electrical", "electrical"], []);
  assert.equal(missing.length, 1);
});

test("csi: missingDivisionsForDrawingDisciplines returns nothing for disciplines with no division mapping", () => {
  assert.deepEqual(missingDivisionsForDrawingDisciplines(["survey", "geotechnical"], []), []);
});
