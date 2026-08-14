/**
 * Phase 1 P1-17: vendor performance FACTUAL signals (never a score).
 * Verifies the endpoint returns real counts (invited, bid, awarded) drawn
 * from actual rows, and that only the two parties to the relationship (or
 * admin) may read it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let vendor: { client: TestClient; email: string };
let vendorCompanyId: string;
let outsider: { client: TestClient; email: string };
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "vsig-dev");
  const devCo = await createCompany(developer.client, "buyer", "Vendor Signals Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "vsig-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Vendor Signals Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "vsig-outsider");
  await createCompany(outsider.client, "buyer", "Vendor Signals Outsider Co");

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Vendor Signals Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("vendor signals: reflects a real bid and a real award as facts, not a score", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Vendor Signals Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 45_000, days: 8 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  const signals = await developer.client.get(`/api/vendor-signals?vendorCompanyId=${vendorCompanyId}&developerCompanyId=${developerCompanyId}`);
  assert.equal(signals.status, 200, JSON.stringify(signals.body));
  assert.equal(signals.body.bidsSubmitted, 1);
  assert.equal(signals.body.timesAwarded, 1);
  assert.equal(Number(signals.body.totalFinalAwardCents), 45_000_00);
  assert.equal(Number(signals.body.totalOriginalBidCents), 45_000_00);

  // The vendor itself can also read its own relationship signals.
  const vendorRead = await vendor.client.get(`/api/vendor-signals?vendorCompanyId=${vendorCompanyId}&developerCompanyId=${developerCompanyId}`);
  assert.equal(vendorRead.status, 200);
});

test("vendor signals: an outsider (neither party) is denied", async () => {
  const attempt = await outsider.client.get(`/api/vendor-signals?vendorCompanyId=${vendorCompanyId}&developerCompanyId=${developerCompanyId}`);
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});
