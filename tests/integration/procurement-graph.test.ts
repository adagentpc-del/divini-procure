/**
 * Procurement Graph deterministic extensions (docs/ai-layer-design.md
 * section 3, "next phase" build): G-01 commitment-weighted edges, G-02a
 * vendor-vendor co-bid edges, G-02b package relatedness, G-03 score
 * history. All pure/deterministic - zero AI involved. procure-moat.ts had
 * no test coverage at all before this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let vendorA: { client: TestClient; email: string };
let vendorACompanyId: string;
let vendorB: { client: TestClient; email: string };
let vendorBCompanyId: string;
let outsider: { client: TestClient; email: string };
let outsiderCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "pgraph-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Procurement Graph Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "pgraph-vendora");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "Procurement Graph Vendor A")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "pgraph-vendorb");
  vendorBCompanyId = (await createCompany(vendorB.client, "vendor", "Procurement Graph Vendor B")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "pgraph-outsider");
  outsiderCompanyId = (await createCompany(outsider.client, "buyer", "Procurement Graph Outsider Co")).id;

  // Lift the free-tier active-project/bid-package limit - this suite
  // creates several buildings/packages, unrelated to what it tests.
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(
      `insert into subscription_entitlements (company_id, tier_key, subscription_status)
       values ($1, 'developer_pro', 'active')
       on conflict (company_id) do update set tier_key = excluded.tier_key, subscription_status = excluded.subscription_status`,
      [developerCompanyId],
    ),
  );

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Procurement Graph Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("G-01: buildRelationshipEdges creates a real 'commitment' edge weighted by awarded dollar amount", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Graph Commitment Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendorA.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorACompanyId, price: 120_000, days: 30,
  });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  const rebuild = await developer.client.post("/api/admin/relationship-edges/rebuild");
  // Non-admin caller: expect this to be forbidden, then redo as admin via the
  // graph read (which is what actually matters for this test) - rebuild
  // itself is admin-only per moat.ts's own docstring.
  assert.equal(rebuild.status, 403, "rebuild is admin-only, confirming the auth guard is real");

  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const { buildRelationshipEdges } = await import("../../server/dist/lib/procure-moat.js");
  const edgeCount = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    buildRelationshipEdges(),
  );
  assert.ok(edgeCount > 0);

  const graph = await developer.client.get(`/api/relationship/graph?companyId=${developerCompanyId}`);
  assert.equal(graph.status, 200, JSON.stringify(graph.body));
  const commitmentEdge = graph.body.edges.find(
    (e: any) => e.type === "commitment" && e.from === developerCompanyId && e.to === vendorACompanyId,
  );
  assert.ok(commitmentEdge, "expected a commitment edge from developer to vendor A");
  assert.equal(commitmentEdge.detail.totalAmountCents, 120_000_00);
  assert.equal(commitmentEdge.detail.awardCount, 1);
  // Weight is the recency-decayed dollar amount (in dollars, not cents) - a
  // brand-new award should be very close to its full $120,000 value (decay
  // over a few seconds is negligible), never zero, never the raw cents figure.
  assert.ok(commitmentEdge.weight > 119_000 && commitmentEdge.weight <= 120_000,
    `expected weight close to 120000, got ${commitmentEdge.weight}`);
});

test("G-02a: buildRelationshipEdges creates a 'co_bid' edge between two vendors who bid the same package", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Graph CoBid Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  await vendorA.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId: vendorACompanyId, price: 50_000, days: 10 });
  await vendorB.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId: vendorBCompanyId, price: 55_000, days: 12 });

  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const { buildRelationshipEdges, relationshipGraph } = await import("../../server/dist/lib/procure-moat.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () => buildRelationshipEdges());
  const graph = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    relationshipGraph(vendorACompanyId),
  );
  const coBid = graph!.edges.find((e: any) => e.type === "co_bid");
  assert.ok(coBid, "expected a co_bid edge between the two vendors");
  assert.ok(
    (coBid.from === vendorACompanyId && coBid.to === vendorBCompanyId) ||
      (coBid.from === vendorBCompanyId && coBid.to === vendorACompanyId),
  );
  assert.equal(coBid.detail.sharedPackages, 1);
});

test("G-02b: related-packages returns same-building and same-trade-portfolio packages, never another company's", async () => {
  // A dedicated building, not the file-shared `buildingId` - tests 1/2
  // already added packages to that one, which would otherwise leak into
  // this test's "everything else in the same building" assertion. Unique
  // trade-category text guards the same way against the shared test DB
  // other runs of this file also write to.
  const trade = `Electrical Related Test ${Date.now()}`;
  const building1 = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId, name: "Procurement Graph Related-Packages Building 1",
  });
  const building1Id = (building1.body.building ?? building1.body).id;
  const pkgElectrical1 = await developer.client.post(`/api/buildings/${building1Id}/packages`, { category: trade });
  const pkgPlumbing = await developer.client.post(`/api/buildings/${building1Id}/packages`, { category: "Plumbing Related Test" });
  const packageId1 = pkgElectrical1.body.id ?? pkgElectrical1.body.package?.id;
  const plumbingId = pkgPlumbing.body.id ?? pkgPlumbing.body.package?.id;

  const building2 = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId, name: "Procurement Graph Second Building",
  });
  const building2Id = (building2.body.building ?? building2.body).id;
  const pkgElectrical2 = await developer.client.post(`/api/buildings/${building2Id}/packages`, { category: trade });
  const packageId2 = pkgElectrical2.body.id ?? pkgElectrical2.body.package?.id;

  // An outsider's own package with the SAME trade category - must never appear.
  const outsiderBuilding = await outsider.client.post("/api/buildings", {
    company_id: outsiderCompanyId, name: "Outsider Building",
  });
  const outsiderBuildingId = (outsiderBuilding.body.building ?? outsiderBuilding.body).id;
  await outsider.client.post(`/api/buildings/${outsiderBuildingId}/packages`, { category: trade });

  const res = await developer.client.get(`/api/related-packages/${packageId1}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const related = res.body.related;

  const sameProject = related.find((r: any) => r.id === plumbingId);
  assert.ok(sameProject, "the plumbing package in the same building must be related");
  assert.equal(sameProject.relation, "same_project");

  const sameTrade = related.find((r: any) => r.id === packageId2);
  assert.ok(sameTrade, "the electrical package in the developer's other building must be related");
  assert.equal(sameTrade.relation, "same_trade_portfolio");

  assert.ok(
    !related.some((r: any) => r.id !== plumbingId && r.id !== packageId2),
    "must never include the outsider's package with the same trade category (or any other unrelated row)",
  );

  // 403, not 404: packages/buildings have a permissive using(true) RLS
  // policy (any authenticated user can see a package, matching
  // marketplace-browse semantics), so packageContext() finds the row and
  // the route's own explicit membership check is what denies the outsider -
  // matching financial-summary.ts's identical packageContext()-based
  // authorization pattern.
  const outsiderRead = await outsider.client.get(`/api/related-packages/${packageId1}`);
  assert.equal(outsiderRead.status, 403, JSON.stringify(outsiderRead.body));
});

test("G-03: score-as-of-a-past-date excludes events that happened after that date", async () => {
  // A dedicated, brand-new vendor company - not vendorACompanyId, which
  // test 1 already gave a real awarded bid to (that earlier bid's
  // created_at would already satisfy "before this test's bid", polluting
  // the "must show no bids" assertion below).
  const historyVendor = await registerVerifiedUser(server.baseUrl, "pgraph-history-vendor");
  const historyVendorCompanyId = (await createCompany(historyVendor.client, "vendor", "Graph Score History Vendor")).id;

  // Capture a "before" timestamp strictly prior to the bid's creation -
  // date-only granularity (YYYY-MM-DD) is not fine-grained enough here:
  // "today" parses as UTC midnight, which is BEFORE a bid created later
  // the same day, making a same-day "must include" assertion impossible
  // at date granularity. Full ISO timestamps, captured immediately before
  // and after the bid POST, give an unambiguous boundary on either side.
  const beforeBid = new Date().toISOString();
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Graph Score History Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await historyVendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: historyVendorCompanyId, price: 30_000, days: 15,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const afterBid = new Date().toISOString();

  // "As of" a moment before this bid existed: the win-rate factor's detail
  // must show no bids, since the bid's created_at is after that cutoff.
  const past = await historyVendor.client.get(`/api/divini-score/${historyVendorCompanyId}/history?asOf=${encodeURIComponent(beforeBid)}`);
  assert.equal(past.status, 200, JSON.stringify(past.body));
  const pastWinRate = past.body.factors.find((f: any) => f.key === "win_rate");
  assert.equal(pastWinRate.detail, "No bids submitted yet");

  // "As of" a moment after the bid was created: it must be counted.
  const now = await historyVendor.client.get(`/api/divini-score/${historyVendorCompanyId}/history?asOf=${encodeURIComponent(afterBid)}`);
  assert.equal(now.status, 200, JSON.stringify(now.body));
  const nowWinRate = now.body.factors.find((f: any) => f.key === "win_rate");
  assert.ok(nowWinRate.detail.includes("1 bid"), `expected the bid to be counted as of afterBid, got: ${nowWinRate.detail}`);

  assert.ok(!("id" in now.body), "diviniScoreAsOf must never persist/return a divini_scores row id - it is read-only");
});

test("G-03: future asOf date and malformed asOf are both rejected", async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const futureRes = await vendorA.client.get(`/api/divini-score/${vendorACompanyId}/history?asOf=${future}`);
  assert.equal(futureRes.status, 400, JSON.stringify(futureRes.body));

  const badRes = await vendorA.client.get(`/api/divini-score/${vendorACompanyId}/history?asOf=not-a-date`);
  assert.equal(badRes.status, 400, JSON.stringify(badRes.body));

  const missingRes = await vendorA.client.get(`/api/divini-score/${vendorACompanyId}/history`);
  assert.equal(missingRes.status, 400, JSON.stringify(missingRes.body));
});

test("G-03: an outsider (non-member) cannot read another company's score history", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await outsider.client.get(`/api/divini-score/${vendorACompanyId}/history?asOf=${today}`);
  assert.equal(res.status, 403, JSON.stringify(res.body));
});
