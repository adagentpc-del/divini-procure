/**
 * Tests for the pure Divini Blueprint document classifier
 * (server/src/lib/document-classifier.ts). No DB, no env, no LLM.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocument } from "../server/src/lib/document-classifier.ts";

test("classifier: keyword match on filename wins even for a plain PDF extension", () => {
  const r = classifyDocument("Electrical Lighting Plan Rev3.pdf", "pdf");
  assert.equal(r.category, "drawing");
  assert.equal(r.discipline, "electrical");
  assert.equal(r.confidence, "medium");
});

test("classifier: specification keyword is detected regardless of case", () => {
  const r = classifyDocument("PROJECT SPECIFICATION MANUAL.pdf", "pdf");
  assert.equal(r.category, "specification");
});

test("classifier: a CAD extension with no keyword match is a low-confidence generic drawing", () => {
  const r = classifyDocument("untitled1.dwg", "dwg");
  assert.equal(r.category, "drawing");
  assert.equal(r.discipline, "general");
  assert.equal(r.confidence, "low");
  assert.equal(r.isCadFile, true);
});

test("classifier: a plain PDF with no keyword match is low-confidence, not fabricated as high", () => {
  const r = classifyDocument("scan0001.pdf", "pdf");
  assert.equal(r.confidence, "low");
  assert.equal(r.category, "drawing");
});

test("classifier: budget and estimate are distinct categories", () => {
  assert.equal(classifyDocument("2026 Project Budget.xlsx", "xlsx").category, "budget");
  assert.equal(classifyDocument("GC Cost Estimate.xlsx", "xlsx").category, "estimate");
});

test("classifier: image extension with no keyword defaults to photo", () => {
  const r = classifyDocument("IMG_4021.jpg", "jpg");
  assert.equal(r.category, "photo");
  assert.equal(r.confidence, "low");
});

test("classifier: spreadsheet extension with no keyword defaults to schedule", () => {
  const r = classifyDocument("data.xlsx", "xlsx");
  assert.equal(r.category, "schedule");
});

test("classifier: an unrecognized extension with no keyword falls back to other", () => {
  const r = classifyDocument("readme.txt", "txt");
  assert.equal(r.category, "other");
  assert.equal(r.confidence, "low");
});

test("classifier: structural drawing sheet-number pattern (S-1) is detected", () => {
  const r = classifyDocument("S-101 Foundation Plan.pdf", "pdf");
  assert.equal(r.discipline, "structural");
});

test("classifier: never returns high confidence -- this module never claims to have read file content", () => {
  const samples = [
    ["Electrical Plan.pdf", "pdf"],
    ["untitled.dwg", "dwg"],
    ["Budget.xlsx", "xlsx"],
  ] as const;
  for (const [name, ext] of samples) {
    assert.notEqual(classifyDocument(name, ext).confidence, "high");
  }
});
