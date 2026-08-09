/**
 * Phase 1 P1-08: explicit agreement <-> purchase order linkage. The Phase 0
 * audit found agreements disconnected from purchase orders; this verifies
 * PATCH /agreements/:id/link-purchase-order and the contract-vs-award
 * discrepancy surfaced on GET /award/purchase-orders/:id.
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
  developer = await registerVerifiedUser(server.baseUrl, "agpo-dev");
  const devCo = await createCompany(developer.client, "buyer", "Agreement PO Link Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "agpo-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Agreement PO Link Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "agpo-outsider");
  await createCompany(outsider.client, "buyer", "Agreement PO Link Outsider Co");

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
    name: "Agreement PO Link Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function awardedPo(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Agreement PO Link" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: priceDollars,
    days: 7,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  return award.body.purchaseOrder.id as string;
}

test("agreement <-> PO link: developer links a signed agreement to its purchase order", async () => {
  const poId = await awardedPo(500_000);

  const create = await developer.client.post("/api/agreements", {
    partyCompanyId: developerCompanyId,
    title: "Electrical Subcontract",
    body: "Terms.",
    counterpartyEmail: vendor.email,
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const agreementId = create.body.agreement.id;

  const link = await developer.client.patch(`/api/agreements/${agreementId}/link-purchase-order`, {
    purchaseOrderId: poId,
    contractAmountCents: 510_000_00,
  });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.equal(link.body.agreement.purchase_order_id, poId);
  assert.equal(Number(link.body.agreement.contract_amount_cents), 510_000_00);

  const poDetail = await developer.client.get(`/api/award/purchase-orders/${poId}`);
  assert.equal(poDetail.status, 200);
  assert.equal(poDetail.body.agreement.id, agreementId);
  // Award/PO amount was $500,000 -> 50,000,000 cents; contract is $510,000 ->
  // 51,000,000 cents; discrepancy = +1,000,000 cents ($10,000), matching the
  // spec's own worked example ("Award $500,000 / Contract $510,000").
  assert.equal(poDetail.body.contractDiscrepancyCents, 1_000_000_00 / 100);
});

test("agreement <-> PO link: a matching contract amount shows zero discrepancy, not null", async () => {
  const poId = await awardedPo(200_000);
  const create = await developer.client.post("/api/agreements", {
    partyCompanyId: developerCompanyId,
    title: "Matching Contract",
    body: "Terms.",
    counterpartyEmail: vendor.email,
  });
  const agreementId = create.body.agreement.id;
  await developer.client.patch(`/api/agreements/${agreementId}/link-purchase-order`, {
    purchaseOrderId: poId,
    contractAmountCents: 200_000_00,
  });

  const poDetail = await developer.client.get(`/api/award/purchase-orders/${poId}`);
  assert.equal(poDetail.body.contractDiscrepancyCents, 0);
});

test("agreement <-> PO link: no linked agreement yields null agreement and null discrepancy, never a false zero", async () => {
  const poId = await awardedPo(150_000);
  const poDetail = await developer.client.get(`/api/award/purchase-orders/${poId}`);
  assert.equal(poDetail.body.agreement, null);
  assert.equal(poDetail.body.contractDiscrepancyCents, null);
});

test("agreement <-> PO link: an outsider cannot link its own agreement to a PO it has no visibility into", async () => {
  const poId = await awardedPo(100_000);
  const create = await outsider.client.post("/api/agreements", {
    partyCompanyId: (await createCompany(outsider.client, "buyer", "Unrelated Agreement Co " + Date.now())).id,
    title: "Unrelated Agreement",
    body: "Terms.",
    counterpartyEmail: "someone@example.test",
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const agreementId = create.body.agreement.id;

  // 404, not 400: purchase_orders' own RLS SELECT policy (db/schema-rls-
  // high-risk.sql) already makes this PO invisible to a company that is
  // neither its developer nor its vendor, so the route's own
  // `select * from purchase_orders where id = $1` returns nothing before
  // the relationship-validity check (developer/vendor/project match) ever
  // runs - the same "no existence oracle" pattern established elsewhere
  // this phase. The relationship check still exists as defense in depth for
  // an admin caller, who bypasses RLS visibility entirely and could
  // otherwise mis-link two genuinely unrelated records.
  const link = await outsider.client.patch(`/api/agreements/${agreementId}/link-purchase-order`, {
    purchaseOrderId: poId,
  });
  assert.equal(link.status, 404, JSON.stringify(link.body));
});

test("agreement <-> PO link: an unrelated company cannot link someone else's agreement", async () => {
  const poId = await awardedPo(90_000);
  const create = await developer.client.post("/api/agreements", {
    partyCompanyId: developerCompanyId,
    title: "Developer Agreement",
    body: "Terms.",
    counterpartyEmail: vendor.email,
  });
  const agreementId = create.body.agreement.id;

  // 404, not 403: agreements' own RLS SELECT policy already hides this
  // agreement from a company that is neither the party nor the verified
  // counterparty - same pattern as agreements-sign.test.ts.
  const attempt = await outsider.client.patch(`/api/agreements/${agreementId}/link-purchase-order`, {
    purchaseOrderId: poId,
  });
  assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
});
