/**
 * Phase 1 P1-09: change orders as real financial lifecycle events.
 * Verifies the PO auto-link at creation, that only APPROVED change orders
 * ever contribute to an approved-total (draft/submitted/rejected/cancelled
 * never do), negative (deductive) change orders work, and that two
 * concurrent approval attempts on the SAME change order do not both
 * succeed (compare-and-swap, not a lost-update race).
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
  developer = await registerVerifiedUser(server.baseUrl, "cofin-dev");
  const devCo = await createCompany(developer.client, "buyer", "CO Financial Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "cofin-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "CO Financial Vendor Co");
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
    name: "CO Financial Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function awardedPackage(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "CO Financial Test" });
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

async function approvedTotalCents(purchaseOrderId: string): Promise<number> {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ sum: number | null }>(
      `select coalesce(sum(cost_impact_cents), 0) as sum from change_orders where purchase_order_id = $1 and status = 'approved'`,
      [purchaseOrderId],
    ),
  );
  return Number(rows[0]?.sum ?? 0);
}

test("change order: auto-links to the package's active award's purchase order at creation", async () => {
  const { packageId, poId } = await awardedPackage(500_000);
  const create = await developer.client.post("/api/change-orders", {
    buildingId,
    packageId,
    vendorCompanyId,
    title: "Add exterior lighting",
    costImpactCents: 25_000_00,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.changeOrder.purchase_order_id, poId);
});

test("change order: draft and submitted never count toward the approved total; only approved does", async () => {
  const { packageId, poId } = await awardedPackage(400_000);
  const create = await developer.client.post("/api/change-orders", {
    buildingId,
    packageId,
    vendorCompanyId,
    title: "Scope addition",
    costImpactCents: 10_000_00,
  });
  const coId = create.body.changeOrder.id;
  assert.equal(await approvedTotalCents(poId), 0, "a draft CO must not count");

  const submit = await developer.client.patch(`/api/change-orders/${coId}`, { status: "submitted" });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(await approvedTotalCents(poId), 0, "a submitted CO must not count");

  const approve = await developer.client.patch(`/api/change-orders/${coId}`, { status: "approved" });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(await approvedTotalCents(poId), 10_000_00, "only once approved does it count");
});

test("change order: rejected and cancelled change orders never affect the approved total", async () => {
  const { packageId, poId } = await awardedPackage(300_000);

  const c1 = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId, title: "Will be rejected", costImpactCents: 5_000_00,
  });
  await developer.client.patch(`/api/change-orders/${c1.body.changeOrder.id}`, { status: "submitted" });
  const reject = await developer.client.patch(`/api/change-orders/${c1.body.changeOrder.id}`, { status: "rejected" });
  assert.equal(reject.status, 200, JSON.stringify(reject.body));

  const c2 = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId, title: "Will be cancelled", costImpactCents: 7_000_00,
  });
  const cancel = await developer.client.patch(`/api/change-orders/${c2.body.changeOrder.id}`, { status: "cancelled" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

  assert.equal(await approvedTotalCents(poId), 0);
});

test("change order: negative (deductive) change orders work and combine correctly with positive ones", async () => {
  const { packageId, poId } = await awardedPackage(600_000);

  const positive = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId, title: "CO1 addition", costImpactCents: 25_000_00,
  });
  await developer.client.patch(`/api/change-orders/${positive.body.changeOrder.id}`, { status: "submitted" });
  await developer.client.patch(`/api/change-orders/${positive.body.changeOrder.id}`, { status: "approved" });

  const negative = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId, title: "CO2 deduction", costImpactCents: -10_000_00,
  });
  assert.equal(Number(negative.body.changeOrder.cost_impact_cents), -10_000_00);
  await developer.client.patch(`/api/change-orders/${negative.body.changeOrder.id}`, { status: "submitted" });
  await developer.client.patch(`/api/change-orders/${negative.body.changeOrder.id}`, { status: "approved" });

  // Original commitment $500,000 + CO1 +$25,000 + CO2 -$10,000 -> approved
  // delta = +$15,000, matching the spec's own worked example.
  assert.equal(await approvedTotalCents(poId), 15_000_00);
});

test("change order concurrency: two simultaneous approval attempts on the SAME change order - only one wins", async () => {
  const { packageId } = await awardedPackage(200_000);
  const create = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId, title: "Concurrent approval test", costImpactCents: 3_000_00,
  });
  const coId = create.body.changeOrder.id;
  await developer.client.patch(`/api/change-orders/${coId}`, { status: "submitted" });

  const [r1, r2] = await Promise.all([
    developer.client.patch(`/api/change-orders/${coId}`, { status: "approved" }),
    developer.client.patch(`/api/change-orders/${coId}`, { status: "approved" }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${JSON.stringify(statuses)}`);

  const detail = await developer.client.get(`/api/change-orders/${coId}`);
  assert.equal(detail.body.changeOrder.status, "approved");
  // Two real transitions happened in this test (draft->submitted, then the
  // race to submitted->approved) - the CAS guard's job is to make sure the
  // LOSING concurrent request never adds a THIRD, duplicate audit row for a
  // transition that didn't actually happen twice.
  const statusChanges = detail.body.audit.filter((a: any) => a.action === "status_changed");
  assert.equal(statusChanges.length, 2, "exactly two real transitions (submit, approve), not three");
  const approvedEntries = statusChanges.filter((a: any) => a.detail?.to === "approved");
  assert.equal(approvedEntries.length, 1, "exactly one status_changed entry recording the approval, not two");
});
