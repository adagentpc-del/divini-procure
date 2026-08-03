/**
 * Tests for real XLSX budget import (server/src/lib/xlsx-extraction.ts).
 * Builds a workbook in memory (via the module's own buildTestWorkbookBuffer
 * helper) and round-trips it through the parser - no network, no binary
 * test fixtures on disk.
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBudgetXlsx, buildTestWorkbookBuffer } from "../server/src/lib/xlsx-extraction.ts";

test("xlsx: parses header columns and amounts, skipping unparseable rows", async () => {
  const buf = await buildTestWorkbookBuffer([
    ["Category", "Description", "Amount"],
    ["Concrete", "Foundation and slab", 120000],
    ["Electrical", "Rough-in and fixtures", "45,000.50"],
    ["Plumbing", "Bad row", "not-a-number"],
  ]);
  const r = await parseBudgetXlsx(buf);
  assert.equal(r.rows.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.rows[0].category, "Concrete");
  assert.equal(r.rows[0].amountCents, 12000000);
  assert.equal(r.rows[1].amountCents, 4500050);
});

test("xlsx: is tolerant of alternate header names", async () => {
  const buf = await buildTestWorkbookBuffer([
    ["Cost Code", "Item", "Cost"],
    ["03", "Concrete work", 10000],
  ]);
  const r = await parseBudgetXlsx(buf);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].category, "03");
  assert.equal(r.rows[0].description, "Concrete work");
  assert.equal(r.rows[0].amountCents, 1000000);
});

test("xlsx: a header with no recognizable amount column is reported as an error", async () => {
  const buf = await buildTestWorkbookBuffer([["Foo", "Bar"], ["1", "2"]]);
  const r = await parseBudgetXlsx(buf);
  assert.ok(r.error);
  assert.equal(r.rows.length, 0);
});

test("xlsx: a non-XLSX buffer is reported as an error, not a thrown exception", async () => {
  const r = await parseBudgetXlsx(Buffer.from("this is not a real xlsx file"));
  assert.ok(r.error);
});

test("xlsx: a $-formatted amount cell parses correctly", async () => {
  const buf = await buildTestWorkbookBuffer([
    ["Category", "Description", "Amount"],
    ["Roofing", "New shingles", "$8,250"],
  ]);
  const r = await parseBudgetXlsx(buf);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].amountCents, 825000);
});
