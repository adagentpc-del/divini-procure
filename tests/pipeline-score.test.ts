/**
 * Tests for the pure Divini Pipeline readiness score (server/src/lib/pipeline-score.ts).
 * No DB, no env: this module is dependency-free.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOpportunityReadiness, RECENT_ACTIVITY_DAYS } from "../server/src/lib/pipeline-score.ts";

test("readiness: an empty opportunity scores 0 with every factor missing", () => {
  const r = scoreOpportunityReadiness({});
  assert.equal(r.score, 0);
  assert.equal(r.positives.length, 0);
  assert.equal(r.missing.length, 8);
});

test("readiness: every factor met scores exactly 100", () => {
  const now = new Date("2026-08-03T12:00:00Z");
  const r = scoreOpportunityReadiness(
    {
      estimatedValueCents: 500_000,
      nextAction: "Call client",
      nextActionDate: "2026-08-10",
      expectedCloseDate: "2026-09-01",
      category: "electrical",
      packageId: "pkg_1",
      clientCompanyId: "co_1",
      lastActivityAt: "2026-08-01T00:00:00Z",
      hasOpenTask: true,
      hasOverdueTask: false,
    },
    now,
  );
  assert.equal(r.score, 100);
  assert.equal(r.missing.length, 0);
  assert.equal(r.positives.length, 8);
});

test("readiness: factor points sum to exactly 100", () => {
  const r = scoreOpportunityReadiness({});
  const total = r.factors.reduce((sum, f) => sum + f.points, 0);
  assert.equal(total, 100);
});

test("readiness: an overdue task is reported distinctly from no task at all", () => {
  const withOverdue = scoreOpportunityReadiness({ hasOpenTask: true, hasOverdueTask: true });
  assert.ok(withOverdue.missing.includes("Has an overdue task"));

  const withNoTask = scoreOpportunityReadiness({});
  assert.ok(withNoTask.missing.includes("No open task"));
});

test("readiness: activity recency uses the RECENT_ACTIVITY_DAYS threshold", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const justInside = scoreOpportunityReadiness(
    { lastActivityAt: new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 86_400_000 + 1000) },
    now,
  );
  const justOutside = scoreOpportunityReadiness(
    { lastActivityAt: new Date(now.getTime() - (RECENT_ACTIVITY_DAYS + 1) * 86_400_000) },
    now,
  );
  assert.ok(justInside.positives.some((p) => p.includes("Activity logged")));
  assert.ok(justOutside.missing.some((m) => m.includes("No activity")));
});

test("readiness: next action requires BOTH a description and a date", () => {
  const onlyText = scoreOpportunityReadiness({ nextAction: "Call client" });
  assert.ok(onlyText.missing.includes("Next action not scheduled"));

  const onlyDate = scoreOpportunityReadiness({ nextActionDate: "2026-08-10" });
  assert.ok(onlyDate.missing.includes("Next action not scheduled"));

  const both = scoreOpportunityReadiness({ nextAction: "Call client", nextActionDate: "2026-08-10" });
  assert.ok(both.positives.includes("Next action scheduled"));
});

test("readiness: linked via bidId alone also satisfies the linked factor", () => {
  const r = scoreOpportunityReadiness({ bidId: "bid_1" });
  assert.ok(r.positives.includes("Linked to a real bid package"));
});

test("readiness: score never exceeds 100 or drops below 0", () => {
  const r = scoreOpportunityReadiness({
    estimatedValueCents: 1,
    nextAction: "x",
    nextActionDate: "2026-01-01",
    expectedCloseDate: "2026-01-01",
    category: "x",
    packageId: "x",
    bidId: "x",
    clientCompanyId: "x",
    clientEmail: "x@example.com",
    lastActivityAt: new Date(),
    hasOpenTask: true,
    hasOverdueTask: false,
  });
  assert.ok(r.score <= 100 && r.score >= 0);
});
