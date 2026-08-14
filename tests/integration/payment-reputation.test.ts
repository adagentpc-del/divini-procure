/**
 * Bidirectional payment-behavior reputation (competitive gap closure,
 * gap #13 in docs/competitive-analysis-2026-08.md): GET
 * /payment-reputation/:developerCompanyId (lib/payment-reputation.ts +
 * routes/payment-reputation.ts). Deliberately public (any authenticated
 * user, no relationship required) and aggregate-only - a vendor needs to
 * be able to check this BEFORE bidding, when no relationship exists yet.
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
  developer = await registerVerifiedUser(server.baseUrl, "pr-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "PR Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "pr-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "PR Vendor Co")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "pr-outsider");
  await createCompany(outsider.client, "buyer", "PR Outsider Co");

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "PR Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("payment reputation: a developer with no paid invoices returns a null-average, zero-count snapshot", async () => {
  const res = await vendor.client.get(`/api/payment-reputation/${developerCompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paidInvoiceCount, 0);
  assert.equal(res.body.averageDaysToPayment, null);
});

test("payment reputation: a nonexistent developer company id is a 404", async () => {
  const res = await vendor.client.get(`/api/payment-reputation/00000000-0000-0000-0000-000000000000`);
  assert.equal(res.status, 404);
});

test("payment reputation: an outsider with no relationship to this developer can still see the aggregate - it is deliberately public", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "PR Package" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 20000, days: 5 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  const poId = award.body.purchaseOrder.id as string;

  const invoice = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 10_000_00, invoiceNumber: `PR-${Date.now()}`,
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
  const invoiceId = invoice.body.invoice.id as string;

  const approve = await developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "approved" });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  const approvedAmount = approve.body.invoice.approved_amount_cents;

  const today = new Date().toISOString().slice(0, 10);
  const pay = await developer.client.post("/api/payments/external", {
    purchaseOrderId: poId, invoiceId, amountCents: Number(approvedAmount), methodDetail: "ACH", paidDate: today,
  });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));

  // An outsider - a totally different company, never a party to this
  // invoice or this building - queries the developer's aggregate payment
  // reputation directly. This must succeed and reflect the real payment
  // just recorded, proving the aggregate is genuinely public rather than
  // silently empty for anyone but the two parties (which invoices' own
  // RLS would otherwise produce).
  const res = await outsider.client.get(`/api/payment-reputation/${developerCompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paidInvoiceCount, 1, JSON.stringify(res.body));
  assert.ok(typeof res.body.averageDaysToPayment === "number" && res.body.averageDaysToPayment >= 0);
  assert.equal(res.body.within30DaysCount + res.body.within60DaysCount + res.body.over60DaysCount, 1);

  // And the developer's own view agrees.
  const selfView = await developer.client.get(`/api/payment-reputation/${developerCompanyId}`);
  assert.equal(selfView.status, 200);
  assert.deepEqual(selfView.body, res.body);
});
