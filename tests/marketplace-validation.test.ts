/**
 * Tests for the pure marketplace-publication readiness gate
 * (server/src/lib/marketplace-validation.ts). No DB, no env.
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePackageForPublish, type PublishReadinessInput } from "../server/src/lib/marketplace-validation.ts";

const base: PublishReadinessInput = {
  visibility: "public_marketplace",
  bidDueDate: "2026-09-01",
  questionDeadline: "2026-08-20",
  termsAcknowledged: true,
  hasScope: true,
  hasDocuments: true,
};

test("validation: a fully complete package is ready with no errors or warnings", () => {
  const r = validatePackageForPublish(base);
  assert.equal(r.ready, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("validation: private_draft is not a publishable visibility", () => {
  const r = validatePackageForPublish({ ...base, visibility: "private_draft" });
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => e.includes("visibility")));
});

test("validation: a null visibility is an error", () => {
  const r = validatePackageForPublish({ ...base, visibility: null });
  assert.equal(r.ready, false);
});

test("validation: a missing bid due date is a blocking error", () => {
  const r = validatePackageForPublish({ ...base, bidDueDate: null });
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => e.includes("bid due date")));
});

test("validation: a question deadline after the bid due date is a blocking error", () => {
  const r = validatePackageForPublish({ ...base, questionDeadline: "2026-09-05" });
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => e.includes("question deadline")));
});

test("validation: a question deadline on the same day as the bid due date is allowed", () => {
  const r = validatePackageForPublish({ ...base, questionDeadline: "2026-09-01" });
  assert.equal(r.ready, true);
});

test("validation: unacknowledged terms is a blocking error", () => {
  const r = validatePackageForPublish({ ...base, termsAcknowledged: false });
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => e.includes("acknowledge")));
});

test("validation: missing scope and documents are warnings, not blocking errors", () => {
  const r = validatePackageForPublish({ ...base, hasScope: false, hasDocuments: false });
  assert.equal(r.ready, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 2);
});
