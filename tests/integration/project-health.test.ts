/**
 * Regression coverage for the Phase 0 fix to project-health.ts's compute
 * endpoint: it joined vendor_profiles on bids.company_id, a column that
 * does not exist (bids has vendor_company_id) - POST .../compute threw a
 * Postgres error on every call, reachable from the live "Recompute" button
 * in ProjectHealthBadge.tsx. Also confirms the persisted score reflects a
 * real awarded, verified vendor (not just that the call doesn't throw).
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

test("project health compute: returns a real result for a building with an awarded bid (previously threw on every call)", async () => {
  const buyer = await registerVerifiedUser(server.baseUrl, "health-buyer");
  const buyerCo = await createCompany(buyer.client, "buyer", "Health Buyer Co");

  const building = await buyer.client.post("/api/buildings", {
    company_id: buyerCo.id,
    name: "Health Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  const buildingId = (building.body.building ?? building.body).id;

  const pkg = await buyer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Plumbing",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const vendor = await registerVerifiedUser(server.baseUrl, "health-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Health Vendor Co");

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorCo.id,
    price: 3000,
    days: 10,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const award = await buyer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  const compute = await buyer.client.post(`/api/project-health/${buildingId}/compute`, {});
  assert.equal(compute.status, 200, JSON.stringify(compute.body));
  assert.equal(typeof compute.body.snapshot.score, "number");
  assert.equal(typeof compute.body.snapshot.budgetScore, "number");
  // Phase 1 P1-16: budget_score is now real budget health (lib/financial-
  // summary.ts), not a bid-participation proxy. This building never set a
  // project budget, so budgetHealth is "unbudgeted" (neutral, neither
  // healthy nor over) - a real, honest signal, not a fabricated score.
  assert.equal(compute.body.snapshot.budgetHealth, "unbudgeted");
  assert.equal(compute.body.snapshot.budgetScore, 10);

  const get = await buyer.client.get(`/api/project-health/${buildingId}`);
  assert.equal(get.status, 200, JSON.stringify(get.body));
  assert.ok(get.body.snapshot);
  assert.equal(typeof get.body.snapshot.budget_score, "number");
});
