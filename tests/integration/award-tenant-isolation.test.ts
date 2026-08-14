/**
 * Phase 0 item 28's final-validation checklist explicitly calls out "wrong
 * tenant cannot award" as a workflow to live-verify. award-workflow.ts's
 * own authorization (userOwnsPackage() before POST /award/confirm) was not
 * touched this phase, but no integration test exercised this specific
 * case directly - every other award-adjacent test in this suite awards as
 * the real owning developer. This closes that gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let owner: { client: TestClient; email: string };
let ownerCompanyId: string;
let outsider: { client: TestClient; email: string };
let vendor: { client: TestClient; email: string };
let vendorCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  owner = await registerVerifiedUser(server.baseUrl, "award-tenant-owner");
  const ownerCo = await createCompany(owner.client, "buyer", "Award Tenant Owner Co");
  ownerCompanyId = ownerCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "award-tenant-outsider");
  await createCompany(outsider.client, "buyer", "Award Tenant Outsider Co");

  vendor = await registerVerifiedUser(server.baseUrl, "award-tenant-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Award Tenant Vendor Co");
  vendorCompanyId = vendorCo.id;

  const building = await owner.client.post("/api/buildings", {
    company_id: ownerCompanyId,
    name: "Award Tenant Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("award: a company with no ownership of the package's building cannot confirm the award", async () => {
  const pkg = await owner.client.post(`/api/buildings/${buildingId}/packages`, { category: "Tenant Isolation Test" });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: 1500,
    days: 7,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const wrongTenantAttempt = await outsider.client.post("/api/award/confirm", { bidId });
  // 404, not 403: bids' RLS SELECT policy (db/schema-rls.sql) already
  // makes a bid invisible to any company that is neither the bidding
  // vendor nor the package's building owner, so award-workflow.ts's own
  // `select ... from bids where id = $1` returns zero rows before its
  // app-layer userOwnsPackage() check ever runs - the same RLS-driven
  // "no existence oracle" pattern established elsewhere this phase
  // (agreements, progress photos, lien waivers). The security property
  // under test (an unrelated company cannot award this bid) still holds.
  assert.equal(wrongTenantAttempt.status, 404, JSON.stringify(wrongTenantAttempt.body));

  // Confirm the bid was NOT awarded and no purchase order leaked into
  // existence from the rejected attempt.
  const { q1 } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const bidRow = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q1<{ awarded: boolean }>(`select awarded from bids where id = $1`, [bidId]),
  );
  assert.equal(bidRow?.awarded, false, "a rejected wrong-tenant award attempt must not mark the bid awarded");

  const poRow = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q1<{ id: string }>(`select id from purchase_orders where bid_id = $1`, [bidId]),
  );
  assert.equal(poRow, null, "a rejected wrong-tenant award attempt must not create a purchase order");

  // The real owner can still award it afterward - the rejected attempt
  // must not have corrupted the bid's awardable state.
  const realAward = await owner.client.post("/api/award/confirm", { bidId });
  assert.equal(realAward.status, 201, JSON.stringify(realAward.body));
  assert.equal(realAward.body.purchaseOrder.vendor_company_id, vendorCompanyId);
});
