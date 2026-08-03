/**
 * Tests for the pure Divini Blueprint trade suggester
 * (server/src/lib/trade-suggester.ts). No DB, no env, no LLM.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTrades } from "../server/src/lib/trade-suggester.ts";

test("suggester: an empty input yields no suggestions", () => {
  assert.deepEqual(suggestTrades({}), []);
});

test("suggester: electrical documents suggest an Electrical package", () => {
  const r = suggestTrades({ electrical: 3 });
  assert.equal(r.length, 1);
  assert.equal(r[0].packageTitle, "Electrical");
  assert.equal(r[0].supportingDocumentCount, 3);
});

test("suggester: structural documents suggest BOTH concrete and structural steel", () => {
  const r = suggestTrades({ structural: 2 });
  const titles = r.map((s) => s.packageTitle);
  assert.ok(titles.includes("Concrete"));
  assert.ok(titles.includes("Structural Steel"));
});

test("suggester: disciplines with no known trade (survey, geotechnical) produce nothing", () => {
  assert.deepEqual(suggestTrades({ survey: 5, geotechnical: 2 }), []);
});

test("suggester: confidence is medium at 2+ supporting documents, low at exactly 1, and never high", () => {
  assert.equal(suggestTrades({ plumbing: 1 })[0].confidence, "low");
  assert.equal(suggestTrades({ plumbing: 2 })[0].confidence, "medium");
  assert.equal(suggestTrades({ plumbing: 50 })[0].confidence, "medium");
});

test("suggester: a zero or negative count is excluded, not treated as a signal", () => {
  assert.deepEqual(suggestTrades({ electrical: 0, plumbing: -1 }), []);
});

test("suggester: results are sorted by supporting document count descending", () => {
  const r = suggestTrades({ electrical: 1, plumbing: 5, mechanical: 3 });
  assert.equal(r[0].tradeCategory, "plumbing");
});

test("suggester: rationale cites the exact document count and discipline", () => {
  const r = suggestTrades({ mechanical: 4 });
  assert.match(r[0].rationale, /4 uploaded documents classified as mechanical/);
});
