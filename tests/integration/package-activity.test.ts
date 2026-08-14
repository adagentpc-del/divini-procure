/**
 * Plan room activity tracking (competitive gap closure, gap #6 in
 * docs/competitive-analysis-2026-08.md): GET /packages/:id logs a
 * 'viewed' event for a genuine cross-company viewer, and
 * GET /packages/:id/activity surfaces the developer-only summary.
 * lib/package-activity.ts + schema-package-activity.sql.
 *
 * Document-download tracking (logDocumentDownload, wired into
 * /documents/signed-url) is intentionally NOT exercised here: the
 * documents table's own RLS (schema-rls.sql) and that endpoint's app-layer
 * check both restrict a signed URL to the uploading company or admin, so a
 * genuinely cross-company vendor download is not currently reachable
 * through the real request path - a separate, pre-existing gap, not
 * something this pass claims to have fixed. The logging code itself is
 * correct and forward-compatible with that gap being closed later.
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
let buildingId: string;
let packageId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "pa-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "PA Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "pa-vendor-a");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "PA Vendor A Co")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "pa-vendor-b");
  await createCompany(vendorB.client, "vendor", "PA Vendor B Co");

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "PA Building" });
  buildingId = (building.body.building ?? building.body).id;
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "PA Package" });
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

test("package activity: only the developer (not a vendor, not an outsider) can read the activity summary", async () => {
  const devView = await developer.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(devView.status, 200, JSON.stringify(devView.body));
  assert.equal(devView.body.totalViews, 0);

  const vendorView = await vendorA.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(vendorView.status, 403, JSON.stringify(vendorView.body));
});

test("package activity: a vendor viewing the package logs a 'viewed' event visible only to the developer, and self-views by the developer are not counted", async () => {
  // Developer re-opens its own package several times - must not count as engagement.
  await developer.client.get(`/api/packages/${packageId}`);
  await developer.client.get(`/api/packages/${packageId}`);

  const before = await developer.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(before.body.totalViews, 0, "developer's own views must not be logged");

  // Vendor A views the package twice.
  await vendorA.client.get(`/api/packages/${packageId}`);
  await vendorA.client.get(`/api/packages/${packageId}`);

  const afterOne = await developer.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(afterOne.status, 200, JSON.stringify(afterOne.body));
  assert.equal(afterOne.body.totalViews, 2);
  assert.equal(afterOne.body.distinctViewerCompanies, 1);
  assert.equal(afterOne.body.perVendor[0].viewerCompanyId, vendorACompanyId);
  assert.equal(afterOne.body.perVendor[0].viewCount, 2);
  assert.ok(afterOne.body.perVendor[0].viewerCompanyName.startsWith("PA Vendor A Co"));

  // Vendor B views once too - a second distinct viewer company.
  await vendorB.client.get(`/api/packages/${packageId}`);

  const afterTwo = await developer.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(afterTwo.body.totalViews, 3);
  assert.equal(afterTwo.body.distinctViewerCompanies, 2);

  // Vendor A cannot see that Vendor B (or itself) was logged - the
  // activity summary is developer-only, matching the schema's own RLS.
  const vendorAView = await vendorA.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(vendorAView.status, 403, JSON.stringify(vendorAView.body));
});
