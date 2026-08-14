/**
 * Tests for the pure Divini Follow-Up Desk scheduling/template utilities
 * (server/src/lib/follow-up-scheduling.ts). No DB, no env.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDelay, renderTemplate, isApproaching, isStale } from "../server/src/lib/follow-up-scheduling.ts";

test("addDelay: minutes/hours/days are plain arithmetic", () => {
  const from = new Date("2026-08-03T12:00:00Z"); // Monday
  assert.equal(addDelay(from, 30, "minutes").toISOString(), "2026-08-03T12:30:00.000Z");
  assert.equal(addDelay(from, 2, "hours").toISOString(), "2026-08-03T14:00:00.000Z");
  assert.equal(addDelay(from, 3, "days").toISOString(), "2026-08-06T12:00:00.000Z");
});

test("addDelay: business_days skips Saturday and Sunday", () => {
  // Friday 2026-08-07 + 1 business day should land on Monday 2026-08-10.
  const friday = new Date("2026-08-07T12:00:00Z");
  const result = addDelay(friday, 1, "business_days");
  assert.equal(result.toISOString().slice(0, 10), "2026-08-10");
});

test("addDelay: business_days over a full week counts exactly 5 weekdays", () => {
  const monday = new Date("2026-08-03T12:00:00Z");
  const result = addDelay(monday, 5, "business_days");
  // Mon -> Tue,Wed,Thu,Fri,Mon(next week) = 5 business days -> 2026-08-10
  assert.equal(result.toISOString().slice(0, 10), "2026-08-10");
});

test("addDelay: zero or negative delay never moves backward", () => {
  const from = new Date("2026-08-03T12:00:00Z");
  assert.equal(addDelay(from, 0, "days").getTime(), from.getTime());
  assert.equal(addDelay(from, -5, "days").getTime(), from.getTime());
});

test("renderTemplate: substitutes known merge fields", () => {
  const out = renderTemplate("Hi {{name}}, your bid on {{package}} expires {{expiresAt}}.", {
    name: "Jane",
    package: "Electrical Rough-In",
    expiresAt: "Aug 12",
  });
  assert.equal(out, "Hi Jane, your bid on Electrical Rough-In expires Aug 12.");
});

test("renderTemplate: an unmatched token is left visible, not silently dropped", () => {
  const out = renderTemplate("Hi {{name}}, see {{missingField}}.", { name: "Jane" });
  assert.equal(out, "Hi Jane, see {{missingField}}.");
});

test("isApproaching: true only when the date is in the future within the window", () => {
  const now = new Date("2026-08-03T00:00:00Z");
  assert.equal(isApproaching("2026-08-05T00:00:00Z", 3, now), true);
  assert.equal(isApproaching("2026-08-10T00:00:00Z", 3, now), false);
  assert.equal(isApproaching("2026-08-01T00:00:00Z", 3, now), false); // already past
  assert.equal(isApproaching(null, 3, now), false);
});

test("isStale: true when the date is at least N days in the past", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  assert.equal(isStale("2026-08-01T00:00:00Z", 14, now), true);
  assert.equal(isStale("2026-08-05T00:00:00Z", 14, now), false);
});

test("isStale: null is treated as stale by default (never happened)", () => {
  assert.equal(isStale(null, 14), true);
  assert.equal(isStale(null, 14, new Date(), false), false);
});
