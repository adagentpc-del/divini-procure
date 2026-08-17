/**
 * RFI (Request for Information) workflow (fresh competitive scan gap
 * closure, docs/competitive-analysis-2026-08.md). GET/POST/PATCH /rfis
 * (server/src/routes/rfi.ts). Bidirectional - unlike field-log - so this
 * covers both the vendor-write (ask, close-own) and developer-write
 * (answer, close) sides, plus the same cross-vendor privacy guarantee
 * field-log.test.ts proves for daily_logs.
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

async function awardVendorAt(vendor: TestClient, vendorCompanyId: string, category: string): Promise<void> {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 15000, days: 10 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
}

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "rfi-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "RFI Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "rfi-vendor-a");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "RFI Vendor A")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "rfi-vendor-b");
  vendorBCompanyId = (await createCompany(vendorB.client, "vendor", "RFI Vendor B")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "rfi-outsider");
  outsiderCompanyId = (await createCompany(outsider.client, "vendor", "RFI Outsider Vendor")).id;

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "RFI Test Building" });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  await awardVendorAt(vendorA.client, vendorACompanyId, "RFI Electrical");
  await awardVendorAt(vendorB.client, vendorBCompanyId, "RFI Plumbing");
});

test.after(async () => {
  await server.close();
});

test("rfi: an outsider with no award cannot raise or read an RFI at this building", async () => {
  const raise = await outsider.client.post("/api/rfis", {
    buildingId, vendorCompanyId: outsiderCompanyId, subject: "Should not work", question: "N/A",
  });
  assert.equal(raise.status, 403, JSON.stringify(raise.body));

  const read = await outsider.client.get(`/api/rfis?buildingId=${buildingId}`);
  assert.equal(read.status, 403, JSON.stringify(read.body));
});

test("rfi: missing required fields is a 400", async () => {
  const res = await vendorA.client.post("/api/rfis", { buildingId, vendorCompanyId: vendorACompanyId });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

let rfiId: string;

test("rfi: vendor A raises an RFI, gets a sequential number, and it is visible to the developer but NOT to vendor B", async () => {
  const create = await vendorA.client.post("/api/rfis", {
    buildingId, vendorCompanyId: vendorACompanyId,
    subject: "Panel schedule conflict", question: "Sheet E-101 shows 3-phase but spec calls for single-phase - which governs?",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.rfi.status, "open");
  assert.equal(create.body.rfi.rfi_number, "RFI-1");
  rfiId = create.body.rfi.id;

  const asDeveloper = await developer.client.get(`/api/rfis?buildingId=${buildingId}`);
  assert.equal(asDeveloper.status, 200);
  assert.equal(asDeveloper.body.rfis.length, 1, JSON.stringify(asDeveloper.body));

  const asVendorA = await vendorA.client.get(`/api/rfis?buildingId=${buildingId}`);
  assert.equal(asVendorA.body.rfis.length, 1);

  // Vendor B has its own active award at the SAME building but must not see
  // vendor A's RFI - same cross-vendor privacy guarantee as daily_logs.
  const asVendorB = await vendorB.client.get(`/api/rfis?buildingId=${buildingId}`);
  assert.equal(asVendorB.status, 200);
  assert.equal(asVendorB.body.rfis.length, 0, JSON.stringify(asVendorB.body));
});

test("rfi: numbering increments per building across vendors", async () => {
  const create = await vendorB.client.post("/api/rfis", {
    buildingId, vendorCompanyId: vendorBCompanyId,
    subject: "Fixture cut sheet", question: "Which fixture model for the second-floor restrooms?",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.rfi.rfi_number, "RFI-2");
});

test("rfi: a vendor cannot answer its own RFI", async () => {
  const res = await vendorA.client.patch(`/api/rfis/${rfiId}`, { answer: "I'll answer myself" });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("rfi: the developer answers, which auto-advances status to answered", async () => {
  const res = await developer.client.patch(`/api/rfis/${rfiId}`, { answer: "Single-phase per spec governs; sheet E-101 will be revised." });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rfi.status, "answered");
  assert.equal(res.body.rfi.answer, "Single-phase per spec governs; sheet E-101 will be revised.");
  assert.equal(res.body.rfi.answered_by_email, developer.email);
  assert.ok(res.body.rfi.answered_at);
});

test("rfi: vendor A can now close its answered RFI, but an unrelated vendor cannot (RLS hides the row entirely, so this is a 404, not a 403 - same as GET /rfis/:id)", async () => {
  const forbidden = await vendorB.client.patch(`/api/rfis/${rfiId}`, { status: "closed" });
  assert.equal(forbidden.status, 404, JSON.stringify(forbidden.body));

  const close = await vendorA.client.patch(`/api/rfis/${rfiId}`, { status: "closed" });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.rfi.status, "closed");
});

test("rfi: a closed RFI can no longer be updated by either side", async () => {
  const byDeveloper = await developer.client.patch(`/api/rfis/${rfiId}`, { answer: "Too late" });
  assert.equal(byDeveloper.status, 409, JSON.stringify(byDeveloper.body));

  const byVendor = await vendorA.client.patch(`/api/rfis/${rfiId}`, { status: "closed" });
  assert.equal(byVendor.status, 409, JSON.stringify(byVendor.body));
});

test("rfi: a vendor cannot raise an RFI at a building where it has no active award", async () => {
  const res = await outsider.client.post("/api/rfis", {
    buildingId, vendorCompanyId: outsiderCompanyId, subject: "Should not be allowed", question: "N/A",
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("rfi: the developer can close an RFI directly without answering it", async () => {
  const create = await vendorA.client.post("/api/rfis", {
    buildingId, vendorCompanyId: vendorACompanyId,
    subject: "Duplicate question", question: "Never mind, already answered elsewhere.",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const id = create.body.rfi.id;

  const close = await developer.client.patch(`/api/rfis/${id}`, { status: "closed" });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.rfi.status, "closed");
  assert.equal(close.body.rfi.answer, null);
});
