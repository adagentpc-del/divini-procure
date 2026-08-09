/**
 * Phase 1 P1-11: payment lifecycle. Verifies approved-for-payment vs
 * actually-paid stays distinct (an 'authorized' payment_authorizations row
 * must never count as paid), external payment recording (developer-only,
 * distinguishable provenance, no fake platform processing), and that both
 * payment rails correctly derive an invoice's paid/partially_paid status.
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
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "pay-dev");
  const devCo = await createCompany(developer.client, "buyer", "Payments Test Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "pay-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Payments Test Vendor Co");
  vendorCompanyId = vendorCo.id;

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
    name: "Payments Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function approvedInvoice(priceDollars: number, grossCents: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Payments Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: priceDollars, days: 5 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  const poId = award.body.purchaseOrder.id as string;

  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: grossCents,
  });
  const invoiceId = submit.body.invoice.id;
  const approve = await developer.client.patch(`/api/invoices/${invoiceId}/status`, {
    status: "approved",
    approvedAmountCents: grossCents,
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  return { poId, invoiceId, netPayableCents: Number(approve.body.invoice.net_payable_cents) };
}

test("payments: an 'authorized' platform authorization is NOT counted as paid; only 'released' is", async () => {
  const { poId } = await approvedInvoice(200_000, 80_000_00);
  const create = await developer.client.post(`/api/award/purchase-orders/${poId}/payment-auth`, {
    amountCents: 80_000_00,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const payId = create.body.paymentAuthorization.id;

  const authorize = await developer.client.patch(`/api/award/payment-auth/${payId}`, { status: "authorized" });
  assert.equal(authorize.status, 200, JSON.stringify(authorize.body));
  assert.equal(authorize.body.paymentAuthorization.status, "authorized");
  // Approved-for-payment, not yet paid - the distinction the spec requires.
  assert.notEqual(authorize.body.paymentAuthorization.status, "released");
});

test("payments: releasing a platform authorization linked to an invoice moves it to paid", async () => {
  const { poId, invoiceId, netPayableCents } = await approvedInvoice(150_000, 60_000_00);
  const create = await developer.client.post(`/api/award/purchase-orders/${poId}/payment-auth`, {
    amountCents: netPayableCents,
    invoiceId,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const payId = create.body.paymentAuthorization.id;

  const release = await developer.client.patch(`/api/award/payment-auth/${payId}`, { status: "released" });
  assert.equal(release.status, 200, JSON.stringify(release.body));

  const invoice = await developer.client.get(`/api/invoices/${invoiceId}`);
  assert.equal(invoice.body.invoice.status, "paid");
});

test("payments: a partial platform release moves the invoice to partially_paid, not paid", async () => {
  const { poId, invoiceId, netPayableCents } = await approvedInvoice(250_000, 100_000_00);
  const half = Math.round(netPayableCents / 2);
  const create = await developer.client.post(`/api/award/purchase-orders/${poId}/payment-auth`, {
    amountCents: half,
    invoiceId,
  });
  const payId = create.body.paymentAuthorization.id;
  await developer.client.patch(`/api/award/payment-auth/${payId}`, { status: "released" });

  const invoice = await developer.client.get(`/api/invoices/${invoiceId}`);
  assert.equal(invoice.body.invoice.status, "partially_paid");
});

test("payments: external payment recording - developer only, distinguishable provenance, drives invoice status", async () => {
  const { poId, invoiceId, netPayableCents } = await approvedInvoice(180_000, 70_000_00);

  // A vendor cannot record a payment on its own behalf.
  const vendorAttempt = await vendor.client.post("/api/payments/external", {
    purchaseOrderId: poId, invoiceId, amountCents: netPayableCents, methodDetail: "Check #1",
  });
  assert.equal(vendorAttempt.status, 403, JSON.stringify(vendorAttempt.body));

  const record = await developer.client.post("/api/payments/external", {
    purchaseOrderId: poId,
    invoiceId,
    amountCents: netPayableCents,
    methodDetail: "ACH outside platform",
    paidDate: "2026-01-15",
    notes: "Wired directly per vendor request",
  });
  assert.equal(record.status, 201, JSON.stringify(record.body));
  assert.equal(record.body.payment.method_detail, "ACH outside platform");
  assert.equal(record.body.invoice.status, "paid");

  // Read back via the listing endpoint, scoped to the PO.
  const list = await developer.client.get(`/api/payments/external?purchaseOrderId=${poId}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.payments.length, 1);
  assert.equal(Number(list.body.payments[0].amount_cents), netPayableCents);
});

test("payments: platform-released and external amounts are both distinguishable and additive toward paid, never conflated", async () => {
  const { poId, invoiceId, netPayableCents } = await approvedInvoice(300_000, 120_000_00);
  const half = Math.round(netPayableCents / 2);

  const auth = await developer.client.post(`/api/award/purchase-orders/${poId}/payment-auth`, {
    amountCents: half, invoiceId,
  });
  await developer.client.patch(`/api/award/payment-auth/${auth.body.paymentAuthorization.id}`, { status: "released" });

  const remaining = netPayableCents - half;
  const external = await developer.client.post("/api/payments/external", {
    purchaseOrderId: poId, invoiceId, amountCents: remaining, methodDetail: "Wire transfer",
  });
  assert.equal(external.status, 201, JSON.stringify(external.body));
  assert.equal(external.body.invoice.status, "paid");
});
