/**
 * DOC-01: package-scoped documents (specs/drawings/CAD) must be visible to
 * any vendor who can legitimately view the package itself (public
 * marketplace, qualified tier, or a real invite) - not just the owning
 * developer company. Before this fix, GET /documents?packageId= and GET
 * /documents/signed-url both hard-restricted to the owning company only,
 * meaning a bidding vendor could never see or download a developer's own
 * package documents at all - contradicting db.ts's own documented intent
 * ("documents: read any") and blocking the "plan room" concept entirely.
 *
 * Regression coverage: company-level documents with no package_id (e.g.
 * onboarding insurance/W9 uploads via routes/onboarding.ts) must remain
 * restricted to the owning company - this fix is scoped to package
 * visibility, not a blanket "read any."
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

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "docv-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "DocV Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "docv-vendor");
  await createCompany(vendor.client, "vendor", "DocV Vendor Co");

  outsider = await registerVerifiedUser(server.baseUrl, "docv-outsider");
  await createCompany(outsider.client, "buyer", "DocV Outsider Co");

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "DocV Building" });
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

function makePdfUploadBody(): { form: FormData } {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
  const blob = new Blob([bytes], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, "spec.pdf");
  return { form };
}

async function uploadDocument(client: TestClient, baseUrl: string, cookie: string, fields: Record<string, string>) {
  const { form } = makePdfUploadBody();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test("package documents: a publicly-visible package's documents are readable by any vendor who can view the package, not just the owning developer", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "DocV Public Package" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  await developer.client.post(`/api/packages/${packageId}/status`, { status: "open" });

  const devCookie = (developer.client as any).cookie as string;
  const upload = await uploadDocument(developer.client, server.baseUrl, devCookie, {
    companyId: developerCompanyId, packageId, buildingId,
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const storagePath = upload.body.storage_path;

  // Vendor never uploaded anything and has no relationship to this
  // developer at all - just a public marketplace listing they can browse.
  const list = await vendor.client.get(`/api/documents?packageId=${packageId}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.some((d: any) => d.storage_path === storagePath), "vendor must see the developer's package document");

  const signed = await vendor.client.get(`/api/documents/signed-url?path=${encodeURIComponent(storagePath)}`);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.ok(signed.body.signedUrl);
});

test("package documents: a private_draft package's documents stay restricted to the owning developer", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "DocV Draft Package" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  // createPackage() defaults visibility to 'public_marketplace' - set it
  // explicitly to private_draft so this test actually exercises the
  // restricted-visibility case.
  const setDraft = await developer.client.patch(`/api/marketplace/packages/${packageId}/publication`, { visibility: "private_draft" });
  assert.equal(setDraft.status, 200, JSON.stringify(setDraft.body));

  const devCookie = (developer.client as any).cookie as string;
  const upload = await uploadDocument(developer.client, server.baseUrl, devCookie, {
    companyId: developerCompanyId, packageId, buildingId,
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const storagePath = upload.body.storage_path;

  const list = await vendor.client.get(`/api/documents?packageId=${packageId}`);
  assert.equal(list.status, 403, JSON.stringify(list.body));

  const signed = await vendor.client.get(`/api/documents/signed-url?path=${encodeURIComponent(storagePath)}`);
  assert.equal(signed.status, 403, JSON.stringify(signed.body));

  // The developer itself can still see it.
  const devList = await developer.client.get(`/api/documents?packageId=${packageId}`);
  assert.equal(devList.status, 200);
  assert.ok(devList.body.some((d: any) => d.storage_path === storagePath));
});

test("company-level documents (no package) remain restricted to the owning company - not a blanket read-any", async () => {
  const devCookie = (developer.client as any).cookie as string;
  const upload = await uploadDocument(developer.client, server.baseUrl, devCookie, {
    companyId: developerCompanyId,
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const storagePath = upload.body.storage_path;

  const signed = await outsider.client.get(`/api/documents/signed-url?path=${encodeURIComponent(storagePath)}`);
  assert.equal(signed.status, 403, JSON.stringify(signed.body));

  const ownSigned = await developer.client.get(`/api/documents/signed-url?path=${encodeURIComponent(storagePath)}`);
  assert.equal(ownSigned.status, 200, JSON.stringify(ownSigned.body));
});
