/**
 * Vendor invite response time (competitive gap closure, gap #15 in
 * docs/competitive-analysis-2026-08.md): GET
 * /vendor-response-time/:vendorCompanyId (lib/response-time.ts +
 * routes/response-time.ts). Deliberately public (any authenticated user,
 * no relationship required) and aggregate-only, matching the
 * payment-reputation.ts precedent.
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
  developer = await registerVerifiedUser(server.baseUrl, "rt-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "RT Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "rt-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "RT Vendor Co")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "rt-outsider");
  await createCompany(outsider.client, "buyer", "RT Outsider Co");

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "RT Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("response time: a vendor with no invited-then-bid pairs returns a null-average, zero-count snapshot", async () => {
  const res = await outsider.client.get(`/api/vendor-response-time/${vendorCompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.respondedInviteCount, 0);
  assert.equal(res.body.averageDaysToRespond, null);
});

test("response time: a nonexistent vendor company id is a 404", async () => {
  const res = await outsider.client.get(`/api/vendor-response-time/00000000-0000-0000-0000-000000000000`);
  assert.equal(res.status, 404);
});

test("response time: an outsider with no relationship can still see the aggregate after an invited vendor bids - it is deliberately public", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "RT Package" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const invite = await developer.client.post("/api/intel/invite-vendor", { packageId, vendorCompanyId });
  assert.equal(invite.status, 200, JSON.stringify(invite.body));

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 15000, days: 10 });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));

  // An outsider - never a party to this package or invite - queries the
  // vendor's aggregate response time directly. This must succeed and
  // reflect the invite/bid pair just created, proving the aggregate is
  // genuinely public rather than gated to the two relationship parties.
  const res = await outsider.client.get(`/api/vendor-response-time/${vendorCompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.respondedInviteCount, 1, JSON.stringify(res.body));
  assert.ok(typeof res.body.averageDaysToRespond === "number" && res.body.averageDaysToRespond >= 0);

  // And the vendor's own view agrees.
  const selfView = await vendor.client.get(`/api/vendor-response-time/${vendorCompanyId}`);
  assert.equal(selfView.status, 200);
  assert.deepEqual(selfView.body, res.body);
});
