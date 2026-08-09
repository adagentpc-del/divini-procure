/**
 * Regression coverage for the Phase 0 financial source-of-truth fix:
 * retainage_records.contract_amount_cents was a freehand number with no
 * reference back to the awarded Purchase Order that is the real canonical
 * contract value. POST /retainage now links to a matching PO when one
 * exists (package_id + vendor_company_id) and surfaces a non-blocking
 * mismatch warning when the two amounts disagree, without ever refusing
 * to create the record.
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
  developer = await registerVerifiedUser(server.baseUrl, "po-link-dev");
  const devCo = await createCompany(developer.client, "buyer", "PO Link Dev Co");
  developerCompanyId = devCo.id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "PO Link Test Building",
  });
  assert.equal(building.status, 201);
  buildingId = (building.body.building ?? building.body).id;

  vendor = await registerVerifiedUser(server.baseUrl, "po-link-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "PO Link Vendor Co");
  vendorCompanyId = vendorCo.id;
});

test.after(async () => {
  await server.close();
});

async function awardedPackage(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Electrical",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: priceDollars,
    days: 10,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  return { packageId, poAmountCents: award.body.purchaseOrder.amount_cents as number };
}

test("retainage: creating against an awarded package links the record to the real PO, matching amount", async () => {
  const { packageId, poAmountCents } = await awardedPackage(5000);

  const create = await developer.client.post("/api/retainage", {
    buildingId,
    packageId,
    vendorCompanyId,
    developerCompanyId,
    contractAmountCents: poAmountCents,
    retainagePct: 10,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.record.purchase_order_id != null, true);
  assert.equal(create.body.contractAmountMismatch, undefined);
});

test("retainage: a contract amount that disagrees with the real PO amount is flagged, not blocked", async () => {
  const { packageId, poAmountCents } = await awardedPackage(7500);

  const create = await developer.client.post("/api/retainage", {
    buildingId,
    packageId,
    vendorCompanyId,
    developerCompanyId,
    contractAmountCents: poAmountCents + 100000, // deliberately wrong
    retainagePct: 10,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.record.purchase_order_id != null, true);
  assert.ok(create.body.contractAmountMismatch, "expected a mismatch warning");
  assert.equal(create.body.contractAmountMismatch.poAmountCents, poAmountCents);
});

test("retainage: creating with no packageId (no PO to resolve) still succeeds, with no linkage", async () => {
  const create = await developer.client.post("/api/retainage", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    contractAmountCents: 250000,
    retainagePct: 10,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.record.purchase_order_id, null);
});
