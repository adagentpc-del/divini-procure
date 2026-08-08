/**
 * Tests for the pure company-creation validation gate
 * (server/src/lib/company-validation.ts). No DB, no env.
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompanyCreation } from "../server/src/lib/company-validation.ts";

test("validation: a vendor company without vendorAgreementAccepted is rejected", () => {
  const r = validateCompanyCreation({ kind: "vendor" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error.includes("Vendor Agreement"));
});

test("validation: a vendor company with vendorAgreementAccepted explicitly false is rejected", () => {
  const r = validateCompanyCreation({ kind: "vendor", vendorAgreementAccepted: false });
  assert.equal(r.ok, false);
});

test("validation: a vendor company with vendorAgreementAccepted true is accepted", () => {
  const r = validateCompanyCreation({ kind: "vendor", vendorAgreementAccepted: true });
  assert.equal(r.ok, true);
});

test("validation: a buyer company never requires vendorAgreementAccepted", () => {
  const r = validateCompanyCreation({ kind: "buyer" });
  assert.equal(r.ok, true);
});

test("validation: an investor company never requires vendorAgreementAccepted", () => {
  const r = validateCompanyCreation({ kind: "investor" });
  assert.equal(r.ok, true);
});
