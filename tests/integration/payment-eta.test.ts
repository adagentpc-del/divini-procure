/**
 * Regression coverage for the Phase 0 fix to payment-eta.ts: both routes
 * queried columns that do not exist anywhere in the schema (bids.company_id,
 * packages.name) and threw a Postgres error on every single call. Fixed to
 * use the real columns (bids.vendor_company_id, bids.price, packages.category)
 * and the real "awarded" boolean flag. This test drives a full award end to
 * end (package -> bid -> award) and asserts the endpoints return a real,
 * non-error result reflecting it, not just that they don't throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;

test.before(async () => {
  server = await startTestServer();
});

test.after(async () => {
  await server.close();
});

test("payment ETA: reflects a real awarded bid using the actual schema columns (previously threw on every call)", async () => {
  const buyer = await registerVerifiedUser(server.baseUrl, "eta-buyer");
  const buyerCo = await createCompany(buyer.client, "buyer", "ETA Buyer Co");

  const building = await buyer.client.post("/api/buildings", {
    company_id: buyerCo.id,
    name: "ETA Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  const buildingId = (building.body.building ?? building.body).id;

  const pkg = await buyer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Electrical",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  assert.ok(packageId, JSON.stringify(pkg.body));

  const vendor = await registerVerifiedUser(server.baseUrl, "eta-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "ETA Vendor Co");

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorCo.id,
    price: 5000,
    days: 14,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;
  assert.ok(bidId, JSON.stringify(bid.body));

  const award = await buyer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  // Before this fix, both of these threw a 500 (column does not exist) on
  // every call, for every vendor, regardless of whether they had an awarded
  // bid at all.
  const status = await vendor.client.get("/api/me/payment-status");
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.payments.length, 1);
  assert.equal(status.body.payments[0].amountCents, 500000);
  assert.equal(status.body.payments[0].packageName, "Electrical");
  assert.equal(status.body.payments[0].buildingId, buildingId);
  assert.ok(["overdue", "due_soon", "on_track"].includes(status.body.payments[0].paymentStatus));

  const summary = await vendor.client.get("/api/me/payment-summary");
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.totalPendingCents + summary.body.totalOverdueCents, 500000);

  // A vendor with no awarded bids gets an empty, non-error result.
  const other = await registerVerifiedUser(server.baseUrl, "eta-other-vendor");
  await createCompany(other.client, "vendor", "Other Vendor Co");
  const otherStatus = await other.client.get("/api/me/payment-status");
  assert.equal(otherStatus.status, 200);
  assert.equal(otherStatus.body.payments.length, 0);
});
