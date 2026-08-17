/**
 * Plan room activity tracking (competitive gap closure, gap #6 in
 * docs/competitive-analysis-2026-08.md): GET /packages/:id logs a
 * 'viewed' event for a genuine cross-company viewer, and
 * GET /packages/:id/activity surfaces the developer-only summary.
 * lib/package-activity.ts + schema-package-activity.sql.
 *
 * Document-download tracking (logDocumentDownload, wired into
 * /documents/signed-url) is now exercised end to end - DOC-01 fixed the
 * pre-existing gap that made a cross-company vendor's document access
 * unreachable in the first place (see package-document-visibility.test.ts).
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

/** logPackageView/logDocumentDownload are fire-and-forget ('void', never
 * awaited by the route - see routes.ts's own comment on why) so their
 * write can still be in flight when the very next request reads it back.
 * Under this suite's full-run concurrency (--test-concurrency=6 sharing
 * one Postgres), that race is real, not theoretical - poll briefly rather
 * than assuming the write has already landed. */
async function waitForTotalViews(getActivity: () => Promise<{ body: { totalViews: number } }>, expected: number) {
  for (let i = 0; i < 20; i++) {
    const res = await getActivity();
    if (res.body.totalViews >= expected) return res;
    await new Promise((r) => setTimeout(r, 25));
  }
  return getActivity();
}

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

  const afterOne = await waitForTotalViews(() => developer.client.get(`/api/packages/${packageId}/activity`), 2);
  assert.equal(afterOne.status, 200, JSON.stringify(afterOne.body));
  assert.equal(afterOne.body.totalViews, 2);
  assert.equal(afterOne.body.distinctViewerCompanies, 1);
  assert.equal(afterOne.body.perVendor[0].viewerCompanyId, vendorACompanyId);
  assert.equal(afterOne.body.perVendor[0].viewCount, 2);
  assert.ok(afterOne.body.perVendor[0].viewerCompanyName.startsWith("PA Vendor A Co"));

  // Vendor B views once too - a second distinct viewer company.
  await vendorB.client.get(`/api/packages/${packageId}`);

  const afterTwo = await waitForTotalViews(() => developer.client.get(`/api/packages/${packageId}/activity`), 3);
  assert.equal(afterTwo.body.totalViews, 3);
  assert.equal(afterTwo.body.distinctViewerCompanies, 2);

  // Vendor A cannot see that Vendor B (or itself) was logged - the
  // activity summary is developer-only, matching the schema's own RLS.
  const vendorAView = await vendorA.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(vendorAView.status, 403, JSON.stringify(vendorAView.body));
});

test("package activity: a vendor requesting a signed download URL for a package document logs a 'document_downloaded' event", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "spec.pdf");
  form.append("companyId", developerCompanyId);
  form.append("buildingId", buildingId);
  form.append("packageId", packageId);
  const uploadRes = await fetch(`${server.baseUrl}/api/documents`, {
    method: "POST",
    headers: { Cookie: (developer.client as any).cookie as string },
    body: form,
  });
  assert.equal(uploadRes.status, 201);
  const uploadBody = await uploadRes.json();
  const storagePath = uploadBody.storage_path as string;

  const before = await developer.client.get(`/api/packages/${packageId}/activity`);
  const beforeDownloads = before.body.totalDownloads;

  const signed = await vendorA.client.get(`/api/documents/signed-url?path=${encodeURIComponent(storagePath)}`);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));

  const after = await (async () => {
    for (let i = 0; i < 20; i++) {
      const res = await developer.client.get(`/api/packages/${packageId}/activity`);
      if (res.body.totalDownloads >= beforeDownloads + 1) return res;
      await new Promise((r) => setTimeout(r, 25));
    }
    return developer.client.get(`/api/packages/${packageId}/activity`);
  })();
  assert.equal(after.body.totalDownloads, beforeDownloads + 1, JSON.stringify(after.body));
  const vendorARow = after.body.perVendor.find((v: any) => v.viewerCompanyId === vendorACompanyId);
  assert.ok(vendorARow, "vendor A must appear in the activity summary");
  assert.ok(vendorARow.downloadCount >= 1);
});

test("package activity: a user who belongs to BOTH the developer's company AND an unrelated second company is still an internal viewer, not a logged 'viewed' event", async () => {
  // A user can be a member of more than one company (company_members).
  // Add the developer's own user as a second member of an unrelated
  // company directly (there is no self-serve "join another company"
  // endpoint to exercise here), same technique field-log.test.ts uses for
  // its coworker scenario.
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const pool = await import("../../server/dist/pool.js");
  const otherCompany = await createCompany(vendorB.client, "vendor", "PA Unrelated Second Co (dev's other hat)");
  const devUserId = (await pool.q<{ id: string }>(`select id from users where email = $1`, [developer.email]))[0]?.id;
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    pool.q(`insert into company_members (company_id, user_id, role, seat) values ($1, $2, 'member', 2)`, [
      otherCompany.id,
      devUserId,
    ]),
  );

  const before = await developer.client.get(`/api/packages/${packageId}/activity`);
  const beforeViews = before.body.totalViews;

  // The developer views its OWN package - even though it's also a member
  // of `otherCompany`, this must not be logged as that company "viewing"
  // the package (the bug: picking the first id !== developerCompanyId
  // would have picked otherCompany.id here and logged a false event).
  await developer.client.get(`/api/packages/${packageId}`);

  // This is a NEGATIVE assertion (nothing should have been logged), so an
  // immediate check is not actually a meaningful regression guard: if the
  // fix above were reverted, the buggy code path calls the same
  // fire-and-forget logPackageView() the rest of this file has to poll
  // for - checking too early would just as happily observe "not landed
  // yet" as "never happened" and pass either way. Wait through that
  // window before asserting absence, not just presence.
  await new Promise((r) => setTimeout(r, 500));
  const after = await developer.client.get(`/api/packages/${packageId}/activity`);
  assert.equal(after.body.totalViews, beforeViews, "a dual-membership internal view must not be logged as vendor engagement");
});
