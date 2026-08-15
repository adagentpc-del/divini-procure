/**
 * Vendor self-serve verification document upload (competitive gap #4 fix,
 * docs/competitive-analysis-2026-08.md): POST /me/verification/documents +
 * GET /me/verification/documents (server/src/routes/verification.ts section
 * C). Verification is "a free, mandatory gate" (lib/verificationGate.ts's own
 * docstring) but had no working self-serve way to satisfy it - the route
 * inserted into vendor_credentials.file_key/file_name, columns that were
 * never added to the schema anywhere, so every real call 500'd. Fixed by
 * adding the columns (db/schema-verification.sql) and this test proves the
 * whole round trip actually works against a real database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let vendor: { client: TestClient; email: string };
let vendorCompanyId: string;
let otherVendor: { client: TestClient; email: string };
let otherVendorCompanyId: string;

test.before(async () => {
  server = await startTestServer();
  vendor = await registerVerifiedUser(server.baseUrl, "vd-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "VD Vendor Co")).id;

  otherVendor = await registerVerifiedUser(server.baseUrl, "vd-other");
  otherVendorCompanyId = (await createCompany(otherVendor.client, "vendor", "VD Other Vendor Co")).id;
});

test.after(async () => {
  await server.close();
});

async function uploadRawDocument(client: TestClient, companyId: string, fileName: string) {
  const form = new FormData();
  form.append("file", new Blob([`fake bytes for ${fileName}`], { type: "application/pdf" }), fileName);
  form.append("companyId", companyId);
  const res = await client.postForm("/api/documents", form);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string; name: string; storage_path: string };
}

test("verification documents: a vendor can upload a license, register it, and see it pending review", async () => {
  const doc = await uploadRawDocument(vendor.client, vendorCompanyId, "license.pdf");
  assert.ok(doc.storage_path.startsWith(`${vendorCompanyId}/`), doc.storage_path);

  const res = await vendor.client.post("/api/me/verification/documents", {
    companyId: vendorCompanyId,
    credentialType: "license",
    fileKey: doc.storage_path,
    fileName: doc.name,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.credential.credential_type, "license");
  assert.equal(res.body.credential.doc_status, "pending");
  assert.equal(res.body.credential.file_key, doc.storage_path);

  const listed = await vendor.client.get(`/api/me/verification/documents?companyId=${vendorCompanyId}`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const rows = listed.body.documents as any[];
  assert.ok(rows.some((r) => r.credential_type === "license" && r.doc_status === "pending"), JSON.stringify(rows));

  // Still pending, not admin-approved, so it must NOT yet count as satisfying
  // the required 'license' type - uploading alone is not the same as being
  // verified.
  const detail = await vendor.client.get(`/api/me/verification?companyId=${vendorCompanyId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.ok(detail.body.missing.includes("license"), JSON.stringify(detail.body));
});

test("verification documents: a fileKey outside the caller's own company directory is rejected", async () => {
  const foreignDoc = await uploadRawDocument(otherVendor.client, otherVendorCompanyId, "borrowed.pdf");

  const res = await vendor.client.post("/api/me/verification/documents", {
    companyId: vendorCompanyId,
    credentialType: "gl_insurance",
    fileKey: foreignDoc.storage_path,
    fileName: foreignDoc.name,
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("verification documents: an invalid credentialType is a 400", async () => {
  const res = await vendor.client.post("/api/me/verification/documents", {
    companyId: vendorCompanyId,
    credentialType: "not_a_real_type",
    fileKey: `${vendorCompanyId}/misc/whatever.pdf`,
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("verification documents: a missing fileKey is a 400", async () => {
  const res = await vendor.client.post("/api/me/verification/documents", {
    companyId: vendorCompanyId,
    credentialType: "license",
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("verification documents: a missing companyId is a 400", async () => {
  const res = await vendor.client.post("/api/me/verification/documents", {
    credentialType: "license",
    fileKey: `${vendorCompanyId}/misc/whatever.pdf`,
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("verification documents: a non-member cannot POST or GET another company's documents", async () => {
  const postRes = await otherVendor.client.post("/api/me/verification/documents", {
    companyId: vendorCompanyId,
    credentialType: "license",
    fileKey: `${vendorCompanyId}/misc/whatever.pdf`,
  });
  assert.equal(postRes.status, 403, JSON.stringify(postRes.body));

  const getRes = await otherVendor.client.get(`/api/me/verification/documents?companyId=${vendorCompanyId}`);
  assert.equal(getRes.status, 403, JSON.stringify(getRes.body));
});
