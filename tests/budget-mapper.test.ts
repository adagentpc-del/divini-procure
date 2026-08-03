/**
 * Tests for the pure budget-row-to-package matcher
 * (server/src/lib/budget-mapper.ts). No DB, no env. Zero em dashes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBudgetRowToPackage } from "../server/src/lib/budget-mapper.ts";

test("budget mapper: an exact category name match is a medium-confidence result", () => {
  const r = matchBudgetRowToPackage(
    { category: "Electrical", description: "" },
    [{ packageId: "p1", category: "Electrical" }],
  );
  assert.deepEqual(r, { packageId: "p1", category: "Electrical", confidence: "medium" });
});

test("budget mapper: an exact match is case- and whitespace-insensitive", () => {
  const r = matchBudgetRowToPackage(
    { category: "  electrical  ", description: "" },
    [{ packageId: "p1", category: "Electrical" }],
  );
  assert.equal(r?.packageId, "p1");
});

test("budget mapper: two or more shared significant words is medium confidence", () => {
  const r = matchBudgetRowToPackage(
    { category: "", description: "Structural steel framing package" },
    [{ packageId: "p2", category: "Structural Steel" }],
  );
  assert.equal(r?.packageId, "p2");
  assert.equal(r?.confidence, "medium");
});

test("budget mapper: exactly one shared word is low confidence", () => {
  const r = matchBudgetRowToPackage(
    { category: "", description: "Concrete pour for the driveway" },
    [{ packageId: "p3", category: "Concrete Foundations" }],
  );
  assert.equal(r?.packageId, "p3");
  assert.equal(r?.confidence, "low");
});

test("budget mapper: no shared words is no match", () => {
  const r = matchBudgetRowToPackage(
    { category: "Roofing", description: "New shingles" },
    [{ packageId: "p4", category: "Plumbing" }],
  );
  assert.equal(r, null);
});

test("budget mapper: no candidates is no match", () => {
  assert.equal(matchBudgetRowToPackage({ category: "Electrical", description: "" }, []), null);
});

test("budget mapper: picks the candidate with the highest word overlap, not the first one", () => {
  const r = matchBudgetRowToPackage(
    { category: "", description: "Plumbing fixtures and rough-in plumbing work" },
    [
      { packageId: "weak", category: "General Fixtures" },
      { packageId: "strong", category: "Plumbing Rough-in" },
    ],
  );
  assert.equal(r?.packageId, "strong");
});
