/**
 * Project closeout: final punch list + warranty tracking (fresh
 * competitive scan gap closure, docs/competitive-analysis-2026-08.md gap
 * #17). GET/POST/PATCH under /packages/:packageId/... and /closeout/...
 * (server/src/routes/closeout.ts). Bidirectional, same shape as
 * rfi.test.ts: the developer raises items/claims and sets warranty terms,
 * the vendor resolves items and works claims, plus the same cross-vendor
 * privacy guarantee proven for RFIs and daily_logs.
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
let buildingId: string;
let packageAId: string;
let packageBId: string;
let unawardedPackageId: string;

async function awardVendorAt(vendor: TestClient, vendorCompanyId: string, category: string): Promise<string> {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 15000, days: 10 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  return packageId;
}

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "co-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Closeout Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "co-vendor-a");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "Closeout Vendor A")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "co-vendor-b");
  vendorBCompanyId = (await createCompany(vendorB.client, "vendor", "Closeout Vendor B")).id;

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "Closeout Test Building" });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  packageAId = await awardVendorAt(vendorA.client, vendorACompanyId, "Closeout Electrical");
  packageBId = await awardVendorAt(vendorB.client, vendorBCompanyId, "Closeout Plumbing");

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Closeout Unawarded" });
  unawardedPackageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

test("closeout: my-packages lists a vendor's awarded package with has_active_award true", async () => {
  const res = await vendorA.client.get(`/api/closeout/my-packages?companyId=${vendorACompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.packages.find((p: any) => p.package_id === packageAId);
  assert.ok(row, JSON.stringify(res.body));
  assert.equal(row.has_active_award, true);
});

test("closeout: a vendor cannot set warranty terms - developer only", async () => {
  const res = await vendorA.client.patch(`/api/packages/${packageAId}/warranty`, { months: 12 });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("closeout: the developer sets warranty terms", async () => {
  const res = await developer.client.patch(`/api/packages/${packageAId}/warranty`, {
    startDate: "2026-01-01", months: 12, terms: "Parts and labor",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.package.warranty_months, 12);
  assert.equal(res.body.package.warranty_terms, "Parts and labor");
  assert.equal(res.body.package.warranty_set_by, developer.email);
});

test("closeout: an explicit null clears a warranty field; an omitted key leaves it alone (Codex finding)", async () => {
  // Clear terms only - startDate/months should survive untouched.
  const clearTerms = await developer.client.patch(`/api/packages/${packageAId}/warranty`, { terms: null });
  assert.equal(clearTerms.status, 200, JSON.stringify(clearTerms.body));
  assert.equal(clearTerms.body.package.warranty_terms, null);
  assert.equal(clearTerms.body.package.warranty_months, 12, "omitted fields must not be touched");
  assert.equal(clearTerms.body.package.warranty_start_date?.slice(0, 10), "2026-01-01");

  // Restore terms for later assertions.
  const restore = await developer.client.patch(`/api/packages/${packageAId}/warranty`, { terms: "Parts and labor" });
  assert.equal(restore.body.package.warranty_terms, "Parts and labor");
});

test("closeout: a vendor cannot raise a punch item, and description is required", async () => {
  const asVendor = await vendorA.client.post(`/api/packages/${packageAId}/punch-items`, { description: "Nope" });
  assert.equal(asVendor.status, 403, JSON.stringify(asVendor.body));

  const missing = await developer.client.post(`/api/packages/${packageAId}/punch-items`, {});
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
});

test("closeout: raising a punch item on an unawarded package is rejected", async () => {
  const res = await developer.client.post(`/api/packages/${unawardedPackageId}/punch-items`, { description: "No vendor yet" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

let punchItemId: string;

test("closeout: the developer raises a punch item, visible to vendor A but NOT vendor B (cross-vendor privacy)", async () => {
  const create = await developer.client.post(`/api/packages/${packageAId}/punch-items`, { description: "Touch up paint in stairwell B" });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.item.status, "open");
  punchItemId = create.body.item.id;

  const asVendorA = await vendorA.client.get(`/api/packages/${packageAId}/closeout`);
  assert.equal(asVendorA.status, 200, JSON.stringify(asVendorA.body));
  assert.equal(asVendorA.body.punchItems.length, 1);

  // Vendor B has its own award at the SAME building, but on a different
  // package - it must not be able to read package A's closeout at all.
  const asVendorB = await vendorB.client.get(`/api/packages/${packageAId}/closeout`);
  assert.equal(asVendorB.status, 403, JSON.stringify(asVendorB.body));
});

test("closeout: vendor A resolves the punch item, then a second resolve attempt is rejected", async () => {
  const resolve = await vendorA.client.patch(`/api/closeout/punch-items/${punchItemId}`, { status: "resolved" });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.item.status, "resolved");
  assert.equal(resolve.body.item.resolved_by_email, vendorA.email);

  const again = await vendorA.client.patch(`/api/closeout/punch-items/${punchItemId}`, { status: "resolved" });
  assert.equal(again.status, 409, JSON.stringify(again.body));
});

test("closeout: a vendor cannot verify its own fix", async () => {
  const res = await vendorA.client.patch(`/api/closeout/punch-items/${punchItemId}`, { status: "verified" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("closeout: the developer cannot verify an item directly from open (must be resolved first) (Codex finding)", async () => {
  const create = await developer.client.post(`/api/packages/${packageAId}/punch-items`, { description: "Never resolved" });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const res = await developer.client.patch(`/api/closeout/punch-items/${create.body.item.id}`, { status: "verified" });
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

test("closeout: the developer verifies the fix, then reopens it - reopening clears the completion metadata (Codex finding)", async () => {
  const verify = await developer.client.patch(`/api/closeout/punch-items/${punchItemId}`, { status: "verified" });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  assert.equal(verify.body.item.status, "verified");
  assert.equal(verify.body.item.verified_by_email, developer.email);
  assert.ok(verify.body.item.resolved_at, "resolved_at should still be set from the earlier resolve");

  const reopen = await developer.client.patch(`/api/closeout/punch-items/${punchItemId}`, { status: "open" });
  assert.equal(reopen.status, 200, JSON.stringify(reopen.body));
  assert.equal(reopen.body.item.resolved_at, null, "reopening must clear stale resolved_at");
  assert.equal(reopen.body.item.resolved_by_email, null, "reopening must clear stale resolved_by_email");
  assert.equal(reopen.body.item.verified_at, null, "reopening must clear stale verified_at");
  assert.equal(reopen.body.item.verified_by_email, null, "reopening must clear stale verified_by_email");
  assert.equal(reopen.body.item.status, "open");
});

let claimId: string;

test("closeout: the developer files a warranty claim; vendor acknowledges and resolves it", async () => {
  const create = await developer.client.post(`/api/packages/${packageAId}/warranty-claims`, { description: "Leak at roof flashing" });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  claimId = create.body.claim.id;

  const ack = await vendorA.client.patch(`/api/closeout/warranty-claims/${claimId}`, { status: "in_progress" });
  assert.equal(ack.status, 200, JSON.stringify(ack.body));
  assert.equal(ack.body.claim.status, "in_progress");

  const resolve = await vendorA.client.patch(`/api/closeout/warranty-claims/${claimId}`, { status: "resolved", resolutionNotes: "Re-flashed and sealed." });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.claim.status, "resolved");
  assert.equal(resolve.body.claim.resolution_notes, "Re-flashed and sealed.");
});

test("closeout: a resolved claim can no longer be updated", async () => {
  const res = await developer.client.patch(`/api/closeout/warranty-claims/${claimId}`, { status: "denied" });
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

test("closeout: a vendor cannot deny its own claim; the developer can deny a different one", async () => {
  const create = await developer.client.post(`/api/packages/${packageAId}/warranty-claims`, { description: "Squeaky door hinge" });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const id = create.body.claim.id;

  const vendorDeny = await vendorA.client.patch(`/api/closeout/warranty-claims/${id}`, { status: "denied" });
  assert.equal(vendorDeny.status, 400, JSON.stringify(vendorDeny.body));

  const developerDeny = await developer.client.patch(`/api/closeout/warranty-claims/${id}`, { status: "denied", resolutionNotes: "Not covered under this warranty." });
  assert.equal(developerDeny.status, 200, JSON.stringify(developerDeny.body));
  assert.equal(developerDeny.body.claim.status, "denied");
});
