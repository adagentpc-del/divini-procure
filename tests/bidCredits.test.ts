/**
 * Tests for the PURE bid-credit helpers (server/src/lib/bidCredits.ts):
 *   - periodKeyFor: calendar-quarter key ("YYYYQn"), UTC, deterministic.
 *   - remainingBids: remaining count vs a limit (null = unlimited).
 *   - isOverLimit: whether usage has reached the cap (null = never over).
 *
 * These helpers are dependency-free arithmetic (no DB, no env), so they run in
 * isolation under the Node built-in test runner. Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodKeyFor,
  remainingBids,
  isOverLimit,
} from "../server/src/lib/bidCredits.ts";

// ---- periodKeyFor: quarter boundaries (UTC) --------------------------------
test("periodKeyFor: Q1 covers Jan, Feb, Mar", () => {
  assert.equal(periodKeyFor(new Date("2026-01-01T00:00:00Z")), "2026Q1");
  assert.equal(periodKeyFor(new Date("2026-02-15T12:00:00Z")), "2026Q1");
  assert.equal(periodKeyFor(new Date("2026-03-31T23:59:59Z")), "2026Q1");
});
test("periodKeyFor: Q2 covers Apr, May, Jun", () => {
  assert.equal(periodKeyFor(new Date("2026-04-01T00:00:00Z")), "2026Q2");
  assert.equal(periodKeyFor(new Date("2026-06-30T23:59:59Z")), "2026Q2");
});
test("periodKeyFor: Q3 covers Jul, Aug, Sep", () => {
  assert.equal(periodKeyFor(new Date("2026-07-01T00:00:00Z")), "2026Q3");
  assert.equal(periodKeyFor(new Date("2026-09-30T23:59:59Z")), "2026Q3");
});
test("periodKeyFor: Q4 covers Oct, Nov, Dec", () => {
  assert.equal(periodKeyFor(new Date("2026-10-01T00:00:00Z")), "2026Q4");
  assert.equal(periodKeyFor(new Date("2026-12-31T23:59:59Z")), "2026Q4");
});
test("periodKeyFor: each quarter is its own key (no rollover keys reused)", () => {
  const keys = [
    periodKeyFor(new Date("2026-02-01T00:00:00Z")),
    periodKeyFor(new Date("2026-05-01T00:00:00Z")),
    periodKeyFor(new Date("2026-08-01T00:00:00Z")),
    periodKeyFor(new Date("2026-11-01T00:00:00Z")),
    periodKeyFor(new Date("2027-02-01T00:00:00Z")),
  ];
  // Five distinct quarter keys across the year boundary.
  assert.equal(new Set(keys).size, 5);
  assert.deepEqual(keys, ["2026Q1", "2026Q2", "2026Q3", "2026Q4", "2027Q1"]);
});

// ---- remainingBids ---------------------------------------------------------
test("remainingBids: counts down from the limit", () => {
  assert.equal(remainingBids(0, 5), 5);
  assert.equal(remainingBids(3, 5), 2);
  assert.equal(remainingBids(5, 5), 0);
});
test("remainingBids: never negative once over the cap", () => {
  assert.equal(remainingBids(7, 5), 0);
});
test("remainingBids: null limit is unlimited", () => {
  assert.equal(remainingBids(1000, null), null);
});
test("remainingBids: non-finite used degrades to 0 used", () => {
  assert.equal(remainingBids(Number.NaN, 5), 5);
});

// ---- isOverLimit -----------------------------------------------------------
test("isOverLimit: false while under the cap", () => {
  assert.equal(isOverLimit(0, 5), false);
  assert.equal(isOverLimit(4, 5), false);
});
test("isOverLimit: true at and beyond the cap", () => {
  assert.equal(isOverLimit(5, 5), true);
  assert.equal(isOverLimit(6, 5), true);
});
test("isOverLimit: null limit is never over (unlimited)", () => {
  assert.equal(isOverLimit(99999, null), false);
});

// ---- the 5-per-quarter / 20-per-year terminating allotment -----------------
test("free allotment: 5 per quarter, the 6th in a quarter is over the cap", () => {
  const limit = 5;
  // bids 1..5 are allowed (used BEFORE consuming: 0..4 < 5)
  for (let used = 0; used < limit; used++) {
    assert.equal(isOverLimit(used, limit), false);
  }
  // the 6th submission in the same quarter (used = 5) is rejected
  assert.equal(isOverLimit(5, limit), true);
  // a fresh quarter is a fresh row at 0, so the allotment resets to 5 again
  assert.equal(remainingBids(0, limit), 5);
});
