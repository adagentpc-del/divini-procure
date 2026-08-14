/**
 * Vendor prequalification (competitive gap closure, gap #3 in
 * docs/competitive-analysis-2026-08.md): license tracking CRUD
 * (routes/licenses.ts, mirrors routes/coi.ts) and the prequalification
 * snapshot (routes/prequalification.ts + lib/prequalification.ts) that
 * compares a vendor's COI certificates and licenses on file against a
 * building's requirements. Facts only, never a score.
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
let outsiderDeveloper: { client: TestClient; email: string };
let outsiderDeveloperCompanyId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "vq-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "VQ Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "vq-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "VQ Vendor Co")).id;

  outsiderDeveloper = await registerVerifiedUser(server.baseUrl, "vq-outsider-dev");
  outsiderDeveloperCompanyId = (await createCompany(outsiderDeveloper.client, "buyer", "VQ Outsider Dev Co")).id;
});

test.after(async () => {
  await server.close();
});

const FUTURE = "2099-01-01";
const PAST = "2020-01-01";

test("licenses: a vendor can create, list, edit, and soft-delete its own license", async () => {
  const create = await vendor.client.post("/api/licenses", {
    licenseType: "General Contractor License",
    licenseNumber: "GC-001",
    issuingAuthority: "State Board",
    jurisdiction: "CA",
    expiryDate: FUTURE,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const licenseId = create.body.license.id;

  const list = await vendor.client.get("/api/licenses");
  assert.equal(list.status, 200);
  assert.ok(list.body.licenses.some((l: any) => l.id === licenseId));

  const edit = await vendor.client.patch(`/api/licenses/${licenseId}`, { licenseNumber: "GC-002" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.license.license_number, "GC-002");

  const del = await vendor.client.delete(`/api/licenses/${licenseId}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));

  const listAfter = await vendor.client.get("/api/licenses");
  assert.ok(!listAfter.body.licenses.some((l: any) => l.id === licenseId), "suspended license must not appear in the list");
});

test("licenses: missing licenseType/expiryDate are rejected; an unrelated company cannot read or edit another's license", async () => {
  const noType = await vendor.client.post("/api/licenses", { expiryDate: FUTURE });
  assert.equal(noType.status, 400);
  const noExpiry = await vendor.client.post("/api/licenses", { licenseType: "Plumbing" });
  assert.equal(noExpiry.status, 400);

  const create = await vendor.client.post("/api/licenses", { licenseType: "Electrical", expiryDate: FUTURE });
  const licenseId = create.body.license.id;

  // Outsider has no relationship at all with the vendor - RLS makes the row
  // invisible, so both direct GET-by-list-filter and PATCH see nothing.
  const outsiderList = await outsiderDeveloper.client.get(`/api/licenses?companyId=${vendorCompanyId}`);
  assert.equal(outsiderList.status, 403, JSON.stringify(outsiderList.body));

  const outsiderPatch = await outsiderDeveloper.client.patch(`/api/licenses/${licenseId}`, { licenseNumber: "x" });
  assert.equal(outsiderPatch.status, 404, JSON.stringify(outsiderPatch.body));
});

test("prequalification: a vendor can always read its own self-check snapshot", async () => {
  await vendor.client.post("/api/licenses", { licenseType: "Self Check License", expiryDate: FUTURE });

  const res = await vendor.client.get(`/api/prequalification?vendorCompanyId=${vendorCompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.buildingId, null);
  assert.equal(typeof res.body.compliant, "boolean");
});

test("prequalification: an unrelated company cannot read another vendor's snapshot without a buildingId", async () => {
  const res = await outsiderDeveloper.client.get(`/api/prequalification?vendorCompanyId=${vendorCompanyId}`);
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("prequalification: a developer with no real relationship to the vendor sees an empty, safe snapshot even for their own building", async () => {
  const building = await outsiderDeveloper.client.post("/api/buildings", {
    company_id: outsiderDeveloperCompanyId,
    name: "VQ No-Relationship Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  const buildingId = (building.body.building ?? building.body).id;

  // App layer allows the request (this developer does own the building),
  // but RLS's relationship-scoped select policy on coi_certificates /
  // vendor_licenses returns nothing because this vendor never bid on or
  // was invited to any of this developer's packages - proving the
  // relationship gate is enforced at the data layer, not just app-layer.
  const res = await outsiderDeveloper.client.get(
    `/api/prequalification?vendorCompanyId=${vendorCompanyId}&buildingId=${buildingId}`,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.coi.onFile.length, 0, "no relationship - no COI rows should be visible");
  assert.equal(res.body.licenses.onFile.length, 0, "no relationship - no license rows should be visible");
});

test("prequalification: a related developer sees the vendor's real compliance status, including missing/expired required types", async () => {
  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "VQ Relationship Building",
  });
  const buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "VQ Package" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  // A real relationship: the vendor bids on the developer's package.
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 10000, days: 5 });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));

  // Before any requirement exists, the building has none - trivially compliant.
  const before = await developer.client.get(
    `/api/prequalification?vendorCompanyId=${vendorCompanyId}&buildingId=${buildingId}`,
  );
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.compliant, true);

  // Set a COI requirement the vendor doesn't yet meet.
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(
      `insert into coi_requirements (building_id, certificate_type, required) values ($1, 'general_liability', true)`,
      [buildingId],
    ),
  );

  const missing = await developer.client.get(
    `/api/prequalification?vendorCompanyId=${vendorCompanyId}&buildingId=${buildingId}`,
  );
  assert.equal(missing.status, 200, JSON.stringify(missing.body));
  assert.equal(missing.body.compliant, false);
  assert.deepEqual(missing.body.coi.missingTypes, ["general_liability"]);

  // Vendor files an EXPIRED cert of the right type - still not compliant,
  // but now "expired", not "missing".
  const expiredCert = await vendor.client.post("/api/coi", {
    certificateType: "general_liability",
    expiryDate: PAST,
  });
  assert.equal(expiredCert.status, 201, JSON.stringify(expiredCert.body));

  const expired = await developer.client.get(
    `/api/prequalification?vendorCompanyId=${vendorCompanyId}&buildingId=${buildingId}`,
  );
  assert.equal(expired.body.compliant, false);
  assert.deepEqual(expired.body.coi.missingTypes, []);
  assert.deepEqual(expired.body.coi.expiredRequiredTypes, ["general_liability"]);

  // Vendor files a CURRENT cert of the right type - now compliant.
  const currentCert = await vendor.client.post("/api/coi", {
    certificateType: "general_liability",
    expiryDate: FUTURE,
  });
  assert.equal(currentCert.status, 201, JSON.stringify(currentCert.body));

  const compliant = await developer.client.get(
    `/api/prequalification?vendorCompanyId=${vendorCompanyId}&buildingId=${buildingId}`,
  );
  assert.equal(compliant.status, 200, JSON.stringify(compliant.body));
  assert.equal(compliant.body.compliant, true);
  assert.deepEqual(compliant.body.coi.missingTypes, []);
  assert.deepEqual(compliant.body.coi.expiredRequiredTypes, []);
});
