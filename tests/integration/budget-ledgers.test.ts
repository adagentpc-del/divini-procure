/**
 * Phase 1 P1-03/P1-04: project budget + package allowance ledgers.
 * Verifies the append-only revision history required by the Phase 1
 * instruction set (never overwrite a budget - a correction is a new
 * revision row), authorization (developer/admin only, not vendors or
 * outsiders), and that concurrent revisions do not lose an update.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let vendor: { client: TestClient; email: string };
let outsider: { client: TestClient; email: string };
let buildingId: string;
let packageId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "budget-dev");
  const devCo = await createCompany(developer.client, "buyer", "Budget Ledger Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "budget-vendor");
  await createCompany(vendor.client, "vendor", "Budget Ledger Vendor Co");

  outsider = await registerVerifiedUser(server.baseUrl, "budget-outsider");
  await createCompany(outsider.client, "buyer", "Budget Ledger Outsider Co");

  // This suite creates a second project under the same developer company
  // (the concurrent-revision test) past the free tier's 1-active-project
  // limit, which is unrelated to what this suite is testing - lift it the
  // same way reviews.test.ts/marketplace-visibility.test.ts do.
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
    name: "Budget Ledger Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Budget Ledger Package",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

// ---- project budget ----------------------------------------------------------

test("budget: create the original project budget", async () => {
  const res = await developer.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 30_000_000_00,
    contingencyCents: 500_000_00,
    reason: "Initial approved project budget",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.building.budget_original_cents, 30_000_000_00);
  assert.equal(res.body.building.budget_current_cents, 30_000_000_00);
  assert.equal(res.body.revision.revision_number, 1);
  assert.equal(res.body.revision.previous_amount_cents, null);
});

test("budget: unauthorized revision (outsider) is rejected", async () => {
  const res = await outsider.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 99_000_000_00,
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("budget: a vendor (not the developer) cannot revise the project budget", async () => {
  const res = await vendor.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 1,
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("budget: authorized revision preserves original amount and appends history", async () => {
  const revise = await developer.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 32_000_000_00,
    reason: "Approved scope addition",
  });
  assert.equal(revise.status, 201, JSON.stringify(revise.body));
  // The ORIGINAL never changes on a later revision.
  assert.equal(revise.body.building.budget_original_cents, 30_000_000_00);
  assert.equal(revise.body.building.budget_current_cents, 32_000_000_00);
  assert.equal(revise.body.revision.revision_number, 2);
  assert.equal(revise.body.revision.previous_amount_cents, 30_000_000_00);
  assert.equal(revise.body.revision.new_amount_cents, 32_000_000_00);

  const history = await developer.client.get(`/api/buildings/${buildingId}/budget-revisions`);
  assert.equal(history.status, 200);
  assert.equal(history.body.revisions.length, 2);
  // Newest first.
  assert.equal(history.body.revisions[0].revision_number, 2);
  assert.equal(history.body.revisions[1].revision_number, 1);
  assert.equal(history.body.revisions[1].new_amount_cents, 30_000_000_00, "the ORIGINAL $30M must remain in history, never erased");
});

test("budget: outsider cannot even read the revision history", async () => {
  const res = await outsider.client.get(`/api/buildings/${buildingId}/budget-revisions`);
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("budget: two concurrent revisions on the same project do not lose an update", async () => {
  const b2 = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Concurrent Budget Building",
  });
  const bId = (b2.body.building ?? b2.body).id;
  await developer.client.post(`/api/buildings/${bId}/budget-revisions`, { amountCents: 10_000_000_00 });

  const [r1, r2] = await Promise.all([
    developer.client.post(`/api/buildings/${bId}/budget-revisions`, { amountCents: 11_000_000_00, reason: "A" }),
    developer.client.post(`/api/buildings/${bId}/budget-revisions`, { amountCents: 12_000_000_00, reason: "B" }),
  ]);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));

  const history = await developer.client.get(`/api/buildings/${bId}/budget-revisions`);
  assert.equal(history.status, 200);
  // Original + two concurrent revisions = 3 rows, distinct revision numbers
  // (2 and 3, in some order) - neither request's write was silently dropped.
  assert.equal(history.body.revisions.length, 3);
  const numbers = history.body.revisions.map((r: any) => r.revision_number).sort();
  assert.deepEqual(numbers, [1, 2, 3]);
});

// ---- package allowance ---------------------------------------------------------

test("allowance: create the original package allowance", async () => {
  const res = await developer.client.post(`/api/packages/${packageId}/allowance-revisions`, {
    amountCents: 2_000_000_00,
    reason: "Initial electrical allowance",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.package.allowance_original_cents, 2_000_000_00);
  assert.equal(res.body.package.allowance_current_cents, 2_000_000_00);
  assert.equal(res.body.revision.revision_number, 1);
});

test("allowance: cross-tenant (outsider) denial on both read and write", async () => {
  const write = await outsider.client.post(`/api/packages/${packageId}/allowance-revisions`, {
    amountCents: 1,
  });
  assert.equal(write.status, 403, JSON.stringify(write.body));

  const read = await outsider.client.get(`/api/packages/${packageId}/allowance-revisions`);
  assert.equal(read.status, 403, JSON.stringify(read.body));
});

test("allowance: revision preserves original, history accumulates", async () => {
  const revise = await developer.client.post(`/api/packages/${packageId}/allowance-revisions`, {
    amountCents: 2_075_000_00,
    reason: "Approved scope change",
  });
  assert.equal(revise.status, 201, JSON.stringify(revise.body));
  assert.equal(revise.body.package.allowance_original_cents, 2_000_000_00);
  assert.equal(revise.body.package.allowance_current_cents, 2_075_000_00);

  const history = await developer.client.get(`/api/packages/${packageId}/allowance-revisions`);
  assert.equal(history.status, 200);
  assert.equal(history.body.revisions.length, 2);
});
