/**
 * Regression coverage for Phase 0 item 21: server-side marketplace search
 * (GET /marketplace/search, pg_trgm-backed - db/schema-marketplace-
 * search.sql). Covers free-text matching, category filtering, pagination,
 * and - critically - that search results are authorization-scoped the
 * SAME way GET /packages/open is (reusing allowedBrowseVisibilities()
 * from Phase 0 item 20), not a second unguarded path to the same data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string; userId: string };
let developerCompanyId: string;
let buildingId: string;
let unqualified: { client: TestClient; email: string; userId: string };
let verified: { client: TestClient; email: string; userId: string; companyId: string };

// Unique per test-process run and reused everywhere below. This search is
// exercised against the real, persistent shared database other
// integration suites (and repeated local runs of this very file) also
// write to - a generic building name/category would eventually match many
// rows across many runs, and this file's own target packages could fall
// outside the default result page. A shared suffix keeps every assertion
// exact regardless of what else is in the database.
const suffix = `${Date.now()}`;
const buildingName = `Riverstone Commons ${suffix}`;
const buildingLocation = `Boise, Idaho ${suffix}`;
const buildingDeveloper = `Riverstone Development Group ${suffix}`;

async function setVerifyStatus(companyId: string, status: string) {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(`update vendor_profiles set verify_status = $2 where company_id = $1`, [companyId, status]),
  );
}

test.before(async () => {
  server = await startTestServer();

  developer = await registerVerifiedUser(server.baseUrl, "search-dev");
  const devCo = await createCompany(developer.client, "buyer", "Search Dev Co");
  developerCompanyId = devCo.id;

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
    name: buildingName,
    location: buildingLocation,
    developer: buildingDeveloper,
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  unqualified = await registerVerifiedUser(server.baseUrl, "search-unqualified");
  await createCompany(unqualified.client, "vendor", "Unqualified Search Vendor Co");

  const v1 = await registerVerifiedUser(server.baseUrl, "search-verified");
  const vCo = await createCompany(v1.client, "vendor", "Verified Search Vendor Co");
  verified = { ...v1, companyId: vCo.id };
  await setVerifyStatus(vCo.id, "approved");
});

test.after(async () => {
  await server.close();
});

async function makePackage(category: string): Promise<string> {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  return pkg.body.id ?? pkg.body.package?.id;
}

test("search: free-text query matches building name, developer, and location", async () => {
  const category = `Electrical Search Test ${suffix}`;
  const packageId = await makePackage(category);

  const byBuildingName = await unqualified.client.get(`/api/marketplace/search?q=${encodeURIComponent(buildingName)}`);
  assert.equal(byBuildingName.status, 200, JSON.stringify(byBuildingName.body));
  assert.ok(byBuildingName.body.results.some((r: any) => r.id === packageId));

  const byDeveloper = await unqualified.client.get(`/api/marketplace/search?q=${encodeURIComponent(buildingDeveloper)}`);
  assert.ok(byDeveloper.body.results.some((r: any) => r.id === packageId));

  const byLocation = await unqualified.client.get(`/api/marketplace/search?q=${encodeURIComponent(buildingLocation)}`);
  assert.ok(byLocation.body.results.some((r: any) => r.id === packageId));

  const byCategory = await unqualified.client.get(`/api/marketplace/search?q=${encodeURIComponent(category)}`);
  assert.ok(byCategory.body.results.some((r: any) => r.id === packageId));

  const noMatch = await unqualified.client.get("/api/marketplace/search?q=NoSuchTermXYZ123");
  assert.ok(!noMatch.body.results.some((r: any) => r.id === packageId));
});

test("search: category filter narrows results to an exact category match", async () => {
  const electricalCat = `Electrical Filter Test ${suffix}`;
  const plumbingCat = `Plumbing Filter Test ${suffix}`;
  const electricalId = await makePackage(electricalCat);
  const plumbingId = await makePackage(plumbingCat);

  const electricalOnly = await unqualified.client.get(`/api/marketplace/search?categories=${encodeURIComponent(electricalCat)}`);
  assert.ok(electricalOnly.body.results.some((r: any) => r.id === electricalId));
  assert.ok(!electricalOnly.body.results.some((r: any) => r.id === plumbingId));
});

test("search: results are authorization-scoped exactly like GET /packages/open (query authorization, not just filtering)", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");

  const category = `Divini Verified Search Test ${suffix}`;
  const packageId = await makePackage(category);
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(`update packages set visibility = 'divini_verified' where id = $1`, [packageId]),
  );

  const unqualifiedSearch = await unqualified.client.get(`/api/marketplace/search?q=${encodeURIComponent(category)}`);
  assert.equal(unqualifiedSearch.status, 200);
  assert.ok(
    !unqualifiedSearch.body.results.some((r: any) => r.id === packageId),
    "an unqualified vendor's search must not surface a divini_verified-only listing, even by exact text match",
  );

  const verifiedSearch = await verified.client.get(`/api/marketplace/search?q=${encodeURIComponent(category)}`);
  assert.ok(verifiedSearch.body.results.some((r: any) => r.id === packageId), "a Divini-verified vendor must see it");
});

test("search: pagination - limit/offset and total count are real, not client-side", async () => {
  const paginationCategory = `Pagination Test ${suffix}`;
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await makePackage(`${paginationCategory} ${i}`));
  }

  const q = encodeURIComponent(paginationCategory);
  const page1 = await unqualified.client.get(`/api/marketplace/search?q=${q}&limit=2&offset=0`);
  assert.equal(page1.status, 200, JSON.stringify(page1.body));
  assert.equal(page1.body.results.length, 2);
  assert.ok(page1.body.total >= 5);

  const page2 = await unqualified.client.get(`/api/marketplace/search?q=${q}&limit=2&offset=2`);
  assert.equal(page2.body.results.length, 2);
  assert.notDeepEqual(
    page1.body.results.map((r: any) => r.id),
    page2.body.results.map((r: any) => r.id),
    "different offsets must return different rows, not the same page repeated",
  );
});
