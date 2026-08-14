/**
 * Lien waiver e-signature + invoice linkage (competitive gap closure,
 * docs/competitive-analysis-2026-08.md gap #1). Verifies the real
 * e-signature path (mirroring agreements.ts's pattern), that a bare status
 * PATCH can no longer reach 'submitted' (signing is now required), invoice-
 * ownership validation on creation, and that payment status surfaces as a
 * visible fact - never a claim that Divini holds/escrows the money.
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
let outsiderCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "lwsign-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Lien Waiver Sign Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "lwsign-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "Lien Waiver Sign Vendor Co")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "lwsign-outsider");
  outsiderCompanyId = (await createCompany(outsider.client, "vendor", "Lien Waiver Sign Outsider Co")).id;

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
    name: "Lien Waiver Sign Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function awardedPoAndInvoice(priceDollars: number, grossAmountCents: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Lien Waiver Sign Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: priceDollars, days: 7 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  const poId = award.body.purchaseOrder.id as string;

  const invoice = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents, invoiceNumber: `LW-${Date.now()}`,
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
  return { poId, invoiceId: invoice.body.invoice.id as string };
}

test("lien waiver sign: PATCH status=submitted is rejected - signing is the only path", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const waiverId = create.body.waiver.id;

  const attempt = await vendor.client.patch(`/api/lien-waivers/${waiverId}`, { status: "submitted" });
  assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
});

test("lien waiver sign: the vendor can sign with a real signature, capturing a full audit trail", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  const waiverId = create.body.waiver.id;

  const sign = await vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, {
    signerName: "Jane Vendor", signatureText: "Jane Vendor", affirm: true,
  });
  assert.equal(sign.status, 200, JSON.stringify(sign.body));
  assert.equal(sign.body.waiver.status, "submitted");
  assert.equal(sign.body.signature.signer_name, "Jane Vendor");
  assert.equal(sign.body.signature.signer_email, vendor.email);
  assert.equal(sign.body.signature.signer_company_id, vendorCompanyId);
  assert.ok(sign.body.signature.signed_at);
  assert.equal(sign.body.signature.audit.affirmed, true);
});

test("lien waiver sign: missing signerName/signatureText/affirm are all rejected", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  const waiverId = create.body.waiver.id;

  const noName = await vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, { signatureText: "x", affirm: true });
  assert.equal(noName.status, 400);
  const noText = await vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, { signerName: "x", affirm: true });
  assert.equal(noText.status, 400);
  const noAffirm = await vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, { signerName: "x", signatureText: "x" });
  assert.equal(noAffirm.status, 400);
});

test("lien waiver sign: the developer cannot sign the vendor's waiver, and an outsider cannot see it at all", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  const waiverId = create.body.waiver.id;

  const devSign = await developer.client.post(`/api/lien-waivers/${waiverId}/sign`, {
    signerName: "Dev User", signatureText: "Dev User", affirm: true,
  });
  assert.equal(devSign.status, 403, JSON.stringify(devSign.body));

  const outsiderSign = await outsider.client.post(`/api/lien-waivers/${waiverId}/sign`, {
    signerName: "Outsider", signatureText: "Outsider", affirm: true,
  });
  // 404, not 403: lien_waivers RLS makes the row invisible to a company
  // that is neither the named vendor nor developer - matches the
  // established "no existence oracle" pattern used throughout this codebase.
  assert.equal(outsiderSign.status, 404, JSON.stringify(outsiderSign.body));
});

test("lien waiver sign: a second sign attempt on an already-submitted waiver is rejected (CAS)", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  const waiverId = create.body.waiver.id;

  const [r1, r2] = await Promise.all([
    vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, { signerName: "A", signatureText: "A", affirm: true }),
    vendor.client.post(`/api/lien-waivers/${waiverId}/sign`, { signerName: "B", signatureText: "B", affirm: true }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${JSON.stringify(statuses)}`);
});

test("lien waiver + invoice: creating a waiver against an invoice that doesn't match the vendor/developer/building is rejected", async () => {
  const { invoiceId } = await awardedPoAndInvoice(100_000, 50_000_00);

  const wrongVendor = await registerVerifiedUser(server.baseUrl, "lwsign-wrong-vendor");
  const wrongVendorCompanyId = (await createCompany(wrongVendor.client, "vendor", "Lien Waiver Wrong Vendor Co")).id;

  const attempt = await developer.client.post("/api/lien-waivers", {
    buildingId, invoiceId, vendorCompanyId: wrongVendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("lien waiver + invoice: payment status is a visible fact, never claimed before the invoice is actually paid", async () => {
  const { poId, invoiceId } = await awardedPoAndInvoice(200_000, 100_000_00);

  const create = await developer.client.post("/api/lien-waivers", {
    buildingId, invoiceId, vendorCompanyId, developerCompanyId, waiverType: "conditional_progress",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const waiverId = create.body.waiver.id;

  const beforePay = await developer.client.get(`/api/lien-waivers?buildingId=${buildingId}`);
  const rowBefore = beforePay.body.waivers.find((w: any) => w.id === waiverId);
  assert.ok(rowBefore, "waiver must be in the list");
  assert.equal(rowBefore.paymentConfirmed, false, "must not claim payment is confirmed before it actually is");

  const approve = await developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "approved" });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  const approvedAmount = approve.body.invoice.approved_amount_cents;

  const pay = await developer.client.post("/api/payments/external", {
    purchaseOrderId: poId, invoiceId, amountCents: Number(approvedAmount), methodDetail: "ACH outside platform",
  });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));

  const afterPay = await developer.client.get(`/api/lien-waivers?buildingId=${buildingId}`);
  const rowAfter = afterPay.body.waivers.find((w: any) => w.id === waiverId);
  assert.equal(rowAfter.paymentConfirmed, true, "must reflect the real invoice status once actually paid");
  assert.equal(rowAfter.invoice_status, "paid");
});
