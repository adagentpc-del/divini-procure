/**
 * Tests for the pure Divini Blueprint revision matcher
 * (server/src/lib/revision-matcher.ts). No DB, no env.
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestRevisionMatches } from "../server/src/lib/revision-matcher.ts";

test("revision matcher: identical base name after stripping a revision token is a medium-confidence match", () => {
  const r = suggestRevisionMatches("A1.01 Floor Plan Rev2.pdf", [
    { id: "1", name: "A1.01 Floor Plan.dwg" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].documentId, "1");
  assert.equal(r[0].confidence, "medium");
});

test("revision matcher: a substring relationship (no revision token involved) is a low-confidence match", () => {
  const r = suggestRevisionMatches("Electrical Plan Sheet.pdf", [
    { id: "2", name: "Electrical Plan.pdf" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, "low");
});

test("revision matcher: an addendum-token suffix that resolves to the same base name is a medium-confidence match", () => {
  const r = suggestRevisionMatches("Electrical Plan Addendum 1.pdf", [
    { id: "2b", name: "Electrical Plan.pdf" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, "medium");
});

test("revision matcher: unrelated filenames produce no matches", () => {
  assert.deepEqual(suggestRevisionMatches("Structural Plan.dwg", [{ id: "3", name: "Budget.xlsx" }]), []);
});

test("revision matcher: an empty candidate list produces no matches", () => {
  assert.deepEqual(suggestRevisionMatches("Anything.pdf", []), []);
});

test("revision matcher: exact matches are sorted ahead of substring matches", () => {
  const r = suggestRevisionMatches("Site Plan v3.pdf", [
    { id: "low", name: "Site Plan Overview.pdf" },
    { id: "medium", name: "Site Plan.pdf" },
  ]);
  assert.equal(r[0].documentId, "medium");
  assert.equal(r[0].confidence, "medium");
});

test("revision matcher: very short normalized names do not fuzzy-substring-match", () => {
  assert.deepEqual(suggestRevisionMatches("A1.pdf", [{ id: "4", name: "A1 Cover Sheet.pdf" }]), []);
});

test("revision matcher: version tokens (v2, version 2) are stripped the same as rev tokens", () => {
  const r = suggestRevisionMatches("Budget v2.xlsx", [{ id: "5", name: "Budget.xlsx" }]);
  assert.equal(r[0].confidence, "medium");
});
