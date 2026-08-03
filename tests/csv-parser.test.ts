/**
 * Tests for the pure, dependency-free CSV parser
 * (server/src/lib/csv-parser.ts). No DB, no env. Zero em dashes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseBudgetCsv } from "../server/src/lib/csv-parser.ts";

test("csv: parses a simple comma-separated file", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("csv: handles quoted fields containing commas", () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, John",hello\n'), [["name", "note"], ["Smith, John", "hello"]]);
});

test("csv: handles escaped double quotes inside a quoted field", () => {
  assert.deepEqual(parseCsv('a\n"she said ""hi"""\n'), [["a"], ['she said "hi"']]);
});

test("csv: handles a quoted field containing a newline", () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",x\n'), [["a", "b"], ["line1\nline2", "x"]]);
});

test("csv: handles CRLF line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("csv: a file with no trailing newline still yields the last row", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("csv: drops a trailing wholly-blank line", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
});

const BUDGET_CSV = [
  "Category,Description,Amount",
  "Concrete,Foundation and slab,\"$120,000.00\"",
  "Electrical,Rough-in and fixtures,45000",
  "Plumbing,Bad row,not-a-number",
].join("\n");

test("budget csv: maps header columns and parses dollar amounts into cents", () => {
  const r = parseBudgetCsv(BUDGET_CSV);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].category, "Concrete");
  assert.equal(r.rows[0].amountCents, 12000000);
  assert.equal(r.rows[1].amountCents, 4500000);
});

test("budget csv: a row with an unparseable amount is skipped, not guessed at", () => {
  const r = parseBudgetCsv(BUDGET_CSV);
  assert.equal(r.skipped, 1);
});

test("budget csv: an empty file is reported as an error, not an empty success", () => {
  const r = parseBudgetCsv("");
  assert.ok(r.error);
});

test("budget csv: a header with no recognizable amount column is reported as an error", () => {
  const r = parseBudgetCsv("foo,bar\n1,2\n");
  assert.ok(r.error);
  assert.equal(r.rows.length, 0);
});

test("budget csv: is tolerant of alternate header names (cost code / cost / item)", () => {
  const r = parseBudgetCsv("Cost Code,Item,Cost\n03,Concrete work,10000\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].category, "03");
  assert.equal(r.rows[0].description, "Concrete work");
  assert.equal(r.rows[0].amountCents, 1000000);
});
