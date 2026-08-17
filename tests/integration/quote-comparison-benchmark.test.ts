/**
 * Historical cost benchmark on GET /quotes/compare/:packageId (competitive
 * gap closure, docs/competitive-analysis-2026-08.md gap #5). Purely
 * deterministic - a SQL aggregation over this developer's OWN past awarded
 * packages in the same trade category, never an LLM estimate and never
 * another company's award data (server/src/routes/quote-comparison.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let otherDeveloper: { client: TestClient; email: string };
let otherDeveloperCompanyId: string;
let vendor: { client: TestClient; email: string };
let vendorCompanyId: string;
let buildingId: string;

async function awardPackageAt(
  developerClient: TestClient,
  bId: string,
  category: string,
  priceDollars: number,
): Promise<string> {
  const pkg = await developerClient.post(`/api/buildings/${bId}/packages`, { category });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId, price: priceDollars, days: 10,
  });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developerClient.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  return packageId;
}

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "qcb-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "QCB Dev Co")).id;

  // This test creates more than the developer_free tier's bid_package_limit
  // (3 - db/schema-subscriptions.sql) of packages for one company, which is
  // orthogonal to what this test actually verifies (the benchmark
  // computation, not plan limits). Move the test company to the
  // developer_enterprise tier, whose own limit columns are genuinely NULL
  // (unlimited) - entitlements.ts's pick() treats a NULL OVERRIDE on the
  // entitlements row itself as "no override, use the tier default," so
  // setting bid_package_limit=null directly does NOT grant unlimited; the
  // tier_key has to change. Direct-DB-fixture technique other integration
  // tests already use for setup the API has no convenient endpoint for -
  // this does not touch the frozen pricing system's code, only seeds test
  // data through its existing schema.
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const pool = await import("../../server/dist/pool.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    pool.q(
      `insert into subscription_entitlements (company_id, tier_key) values ($1, 'developer_enterprise')
       on conflict (company_id) do update set tier_key = 'developer_enterprise'`,
      [developerCompanyId],
    ),
  );

  otherDeveloper = await registerVerifiedUser(server.baseUrl, "qcb-other-dev");
  otherDeveloperCompanyId = (await createCompany(otherDeveloper.client, "buyer", "QCB Other Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "qcb-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "QCB Vendor Co")).id;

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "QCB Building" });
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("quote comparison: no historical data yields a null benchmark", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "QCB Electrical" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 10000, days: 5 });

  const compare = await developer.client.get(`/api/quotes/compare/${packageId}`);
  assert.equal(compare.status, 200, JSON.stringify(compare.body));
  assert.equal(compare.body.benchmark, null);
});

test("quote comparison: benchmark aggregates only this developer's own past awards in the same category, excluding a different category and a different developer", async () => {
  // Two past AWARDED packages in "QCB Plumbing" for this developer: $10,000 and $20,000.
  await awardPackageAt(developer.client, buildingId, "QCB Plumbing", 10000);
  await awardPackageAt(developer.client, buildingId, "QCB Plumbing", 20000);
  // A different category must not pollute the benchmark.
  await awardPackageAt(developer.client, buildingId, "QCB Roofing", 999999);

  // A different developer's award in the SAME category ("QCB Plumbing")
  // must never leak into this developer's benchmark - this is the actual
  // privacy guarantee the feature depends on.
  const otherBuilding = await otherDeveloper.client.post("/api/buildings", { company_id: otherDeveloperCompanyId, name: "QCB Other Building" });
  const otherBuildingId = (otherBuilding.body.building ?? otherBuilding.body).id;
  await awardPackageAt(otherDeveloper.client, otherBuildingId, "QCB Plumbing", 1);

  // The NEW package being compared, also "QCB Plumbing".
  const newPkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "QCB Plumbing" });
  const newPackageId = newPkg.body.id ?? newPkg.body.package?.id;
  const newBid = await vendor.client.post(`/api/packages/${newPackageId}/bids`, { vendorCompanyId, price: 15000, days: 5 });
  const newBidId = newBid.body.id ?? newBid.body.bid?.id;

  const compare = await developer.client.get(`/api/quotes/compare/${newPackageId}`);
  assert.equal(compare.status, 200, JSON.stringify(compare.body));
  assert.ok(compare.body.benchmark, "benchmark must be present");
  assert.equal(compare.body.benchmark.sampleSize, 2, "only the 2 same-category, same-developer past awards");
  assert.equal(compare.body.benchmark.avgCents, 1500000, "avg of $10,000 and $20,000 = $15,000");
  assert.equal(compare.body.benchmark.minCents, 1000000);
  assert.equal(compare.body.benchmark.maxCents, 2000000);

  // The new bid ($15,000) is exactly at the average -> 0%.
  assert.equal(compare.body.benchmarkPctByBidId[String(newBidId)], 0);
});

test("quote comparison: a bid priced above the historical average shows a positive percentage", async () => {
  // Reuses the same developer/category benchmark ($10,000/$20,000 avg $15,000) from the prior test.
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "QCB Plumbing" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 18000, days: 5 });
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const compare = await developer.client.get(`/api/quotes/compare/${packageId}`);
  assert.equal(compare.status, 200, JSON.stringify(compare.body));
  // ($18,000 - $15,000) / $15,000 = +20%
  assert.equal(compare.body.benchmarkPctByBidId[String(bidId)], 20);
});
