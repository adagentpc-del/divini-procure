/**
 * Phase 1 P1-10: the first canonical invoice/payment-application model.
 * Verifies submission, PO/vendor-pair validation, over-commitment flagging
 * (a warning, never a hard block), the developer-only approval decision,
 * and concurrency-safe status transitions.
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
let outsiderVendor: { client: TestClient; email: string };
let outsiderVendorCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "inv-dev");
  const devCo = await createCompany(developer.client, "buyer", "Invoice Test Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "inv-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Invoice Test Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsiderVendor = await registerVerifiedUser(server.baseUrl, "inv-outsider-vendor");
  const outsiderCo = await createCompany(outsiderVendor.client, "vendor", "Invoice Test Outsider Vendor Co");
  outsiderVendorCompanyId = outsiderCo.id;

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
    name: "Invoice Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function awardedPo(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Invoice Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: priceDollars,
    days: 7,
  });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  return { packageId, poId: award.body.purchaseOrder.id as string };
}

test("invoices: vendor submits a valid invoice against its own PO", async () => {
  const { poId } = await awardedPo(500_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId,
    vendorCompanyId,
    purchaseOrderId: poId,
    grossAmountCents: 200_000_00,
    invoiceNumber: "INV-001",
  });
  assert.equal(submit.status, 201, JSON.stringify(submit.body));
  assert.equal(submit.body.invoice.status, "submitted");
  assert.equal(Number(submit.body.invoice.gross_amount_cents), 200_000_00);
  assert.equal(submit.body.overCommitment, false);
});

test("invoices: a vendor cannot submit an invoice against a PO that is not theirs", async () => {
  const { poId } = await awardedPo(300_000);
  // 404, not 400: purchase_orders' own RLS SELECT policy already makes this
  // PO invisible to a company that is neither its developer nor its vendor,
  // so the route's own PO lookup returns nothing before the vendor/developer-
  // pair validation ever runs - same "no existence oracle" pattern
  // established elsewhere this phase.
  const attempt = await outsiderVendor.client.post("/api/invoices", {
    buildingId,
    vendorCompanyId: outsiderVendorCompanyId,
    purchaseOrderId: poId,
    grossAmountCents: 100_000_00,
  });
  assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
});

test("invoices: the developer CAN see a mismatched PO, so the vendor/developer-pair check itself is exercised", async () => {
  const { poId } = await awardedPo(310_000);
  // The developer submitting on behalf of the WRONG vendor company (one it
  // has no relationship with on this PO) can see the PO (it owns the
  // project), so this reaches the real relationship-validity check.
  const attempt = await developer.client.post("/api/invoices", {
    buildingId,
    vendorCompanyId: outsiderVendorCompanyId,
    purchaseOrderId: poId,
    grossAmountCents: 100_000_00,
  });
  assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
  assert.match(attempt.body.error, /does not belong to the specified vendor\/developer pair/);
});

test("invoices: exceeding the revised commitment is FLAGGED, not blocked", async () => {
  const { poId } = await awardedPo(100_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId,
    vendorCompanyId,
    purchaseOrderId: poId,
    grossAmountCents: 150_000_00, // exceeds the $100,000 commitment
  });
  assert.equal(submit.status, 201, JSON.stringify(submit.body));
  assert.equal(submit.body.overCommitment, true);
  assert.equal(submit.body.invoice.over_commitment, true);
});

test("invoices: developer approves; net payable accounts for retainage", async () => {
  const { poId } = await awardedPo(400_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 100_000_00,
  });
  const invoiceId = submit.body.invoice.id;

  // A vendor cannot approve its own invoice.
  const vendorApprove = await vendor.client.patch(`/api/invoices/${invoiceId}/status`, { status: "approved" });
  assert.equal(vendorApprove.status, 403, JSON.stringify(vendorApprove.body));

  const approve = await developer.client.patch(`/api/invoices/${invoiceId}/status`, {
    status: "approved",
    approvedAmountCents: 95_000_00,
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(Number(approve.body.invoice.approved_amount_cents), 95_000_00);
  assert.equal(Number(approve.body.invoice.net_payable_cents), 95_000_00 - Number(submit.body.invoice.retainage_cents));
});

test("invoices: partially_paid/paid are system-derived, not settable via the status endpoint", async () => {
  const { poId } = await awardedPo(120_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 50_000_00,
  });
  const invoiceId = submit.body.invoice.id;
  const attempt = await developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "paid" });
  assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
});

test("invoices: two concurrent approval decisions on the same invoice - only one wins", async () => {
  const { poId } = await awardedPo(600_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 200_000_00,
  });
  const invoiceId = submit.body.invoice.id;

  const [r1, r2] = await Promise.all([
    developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "approved" }),
    developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "rejected", rejectedReason: "duplicate" }),
  ]);
  // Exactly one request wins (200). The loser is rejected either by the CAS
  // guard (409, if both read the pre-transition status before either wrote)
  // or by the ordinary illegal-transition check (400, if it read AFTER the
  // winner's commit, e.g. reading "approved" and finding "approved -> rejected"
  // not in TRANSITIONS) - both are correct outcomes of the same underlying
  // guarantee (no second decision is ever accepted), so either is allowed
  // here; what must never happen is both succeeding.
  const statuses = [r1.status, r2.status].sort();
  assert.equal(statuses[0], 200, `expected exactly one 200, got ${JSON.stringify(statuses)}`);
  assert.ok([400, 409].includes(statuses[1]), `expected the loser to be 400 or 409, got ${JSON.stringify(statuses)}`);

  const final = await developer.client.get(`/api/invoices/${invoiceId}`);
  assert.ok(["approved", "rejected"].includes(final.body.invoice.status));
});

test("invoices: void is reachable from submitted, and terminates the lifecycle", async () => {
  const { poId } = await awardedPo(80_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 20_000_00,
  });
  const invoiceId = submit.body.invoice.id;
  const void1 = await developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "void" });
  assert.equal(void1.status, 200, JSON.stringify(void1.body));

  const again = await developer.client.patch(`/api/invoices/${invoiceId}/status`, { status: "approved" });
  assert.equal(again.status, 400, JSON.stringify(again.body));
});

test("invoices: an outsider vendor cannot even see another vendor's invoice", async () => {
  const { poId } = await awardedPo(60_000);
  const submit = await vendor.client.post("/api/invoices", {
    buildingId, vendorCompanyId, purchaseOrderId: poId, grossAmountCents: 10_000_00,
  });
  const invoiceId = submit.body.invoice.id;
  const read = await outsiderVendor.client.get(`/api/invoices/${invoiceId}`);
  assert.equal(read.status, 404, JSON.stringify(read.body));
});
