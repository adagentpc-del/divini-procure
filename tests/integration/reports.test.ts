/**
 * INV-01: the invoices CSV export (server/src/routes/reports.ts, generic AP
 * export - see docs/accounting-export.md for why this is deliberately NOT
 * labeled a certified QuickBooks/Xero integration). Verifies the export
 * carries the right rows/columns and respects the same visibility as the
 * invoices themselves (RLS, not a 403 gate - an outsider gets an empty file).
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
let outsider: { client: TestClient; email: string };
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "csv-dev");
  const devCo = await createCompany(developer.client, "buyer", "CSV Export Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "csv-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "CSV Export Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "csv-outsider");
  await createCompany(outsider.client, "vendor", "CSV Export Outsider Co");

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
    name: "CSV Export Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "CSV Export Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: 250_000,
    days: 5,
  });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  const poId = award.body.purchaseOrder.id as string;

  const submit = await vendor.client.post("/api/invoices", {
    buildingId,
    vendorCompanyId,
    purchaseOrderId: poId,
    invoiceNumber: "INV-CSV-001",
    grossAmountCents: 100_000_00,
  });
  assert.equal(submit.status, 201, JSON.stringify(submit.body));
});

test.after(async () => {
  await server.close();
});

test("reports: invoices CSV export includes the vendor name and invoice number for the developer", async () => {
  const res = await developer.client.get(`/api/reports/invoices/${buildingId}.csv`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const csv = String(res.body);
  assert.match(csv, /Vendor Name,Invoice Number/);
  assert.match(csv, /INV-CSV-001/);
  assert.match(csv, /CSV Export Vendor Co/);
  assert.match(csv, /100000\.00/);
});

test("reports: invoices CSV export is also visible to the vendor that owns the invoice", async () => {
  const res = await vendor.client.get(`/api/reports/invoices/${buildingId}.csv`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(String(res.body), /INV-CSV-001/);
});

test("reports: an outsider requesting the same project's CSV gets an empty file, not a 403 (no existence oracle)", async () => {
  const res = await outsider.client.get(`/api/reports/invoices/${buildingId}.csv`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const csv = String(res.body);
  assert.match(csv, /^Vendor Name,Invoice Number/);
  assert.ok(!csv.includes("INV-CSV-001"));
});

test("reports: invoices CSV export 404s for a project that does not exist", async () => {
  const res = await developer.client.get(`/api/reports/invoices/00000000-0000-0000-0000-000000000000.csv`);
  assert.equal(res.status, 404, JSON.stringify(res.body));
});
