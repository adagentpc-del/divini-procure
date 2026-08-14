/**
 * Phase 1 P1-06: award as a transactional financial commitment event.
 * Verifies the canonical `awards` row, its database-enforced
 * one-active-award-per-package invariant, cancel/reopen/reaward, and that a
 * duplicate award attempt (same package, different bid) is rejected rather
 * than silently allowed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let vendorA: { client: TestClient; email: string };
let vendorACompanyId: string;
let vendorB: { client: TestClient; email: string };
let vendorBCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "awards-dev");
  const devCo = await createCompany(developer.client, "buyer", "Awards Dev Co");
  developerCompanyId = devCo.id;

  vendorA = await registerVerifiedUser(server.baseUrl, "awards-vendor-a");
  const vaCo = await createCompany(vendorA.client, "vendor", "Awards Vendor A Co");
  vendorACompanyId = vaCo.id;

  vendorB = await registerVerifiedUser(server.baseUrl, "awards-vendor-b");
  const vbCo = await createCompany(vendorB.client, "vendor", "Awards Vendor B Co");
  vendorBCompanyId = vbCo.id;

  // This suite creates several packages under one developer company (past
  // the free tier's bid-package limit, unrelated to what this suite tests).
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
    name: "Awards Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function twoBidsOnFreshPackage(priceA: number, priceB: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Awards Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bidA = await vendorA.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorACompanyId,
    price: priceA,
    days: 10,
  });
  assert.equal(bidA.status, 201, JSON.stringify(bidA.body));
  const bidB = await vendorB.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorBCompanyId,
    price: priceB,
    days: 12,
  });
  assert.equal(bidB.status, 201, JSON.stringify(bidB.body));
  return { packageId, bidAId: bidA.body.id ?? bidA.body.bid?.id, bidBId: bidB.body.id ?? bidB.body.bid?.id };
}

test("award confirm: creates a canonical award row with the amount locked at award time", async () => {
  const { bidAId } = await twoBidsOnFreshPackage(500_000, 480_000);
  const res = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.award, "response must include the canonical award record");
  assert.equal(res.body.award.status, "active");
  assert.equal(Number(res.body.award.awarded_amount_cents), 500_000 * 100);
  assert.equal(res.body.purchaseOrder.award_id, res.body.award.id);
  assert.equal(Number(res.body.purchaseOrder.original_amount_cents), 500_000 * 100);
});

test("award confirm: retried confirm for the same bid is idempotent (no second award/PO)", async () => {
  const { bidAId } = await twoBidsOnFreshPackage(300_000, 290_000);
  const first = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  assert.equal(first.status, 201);
  const second = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.award.id, first.body.award.id);
  assert.equal(second.body.purchaseOrder.id, first.body.purchaseOrder.id);
});

test("award confirm: a second bid cannot be awarded on the same package while one award is active", async () => {
  const { bidAId, bidBId } = await twoBidsOnFreshPackage(400_000, 395_000);
  const first = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const second = await developer.client.post("/api/award/confirm", { bidId: bidBId });
  assert.equal(second.status, 400, JSON.stringify(second.body));
  assert.match(second.body.error, /already has an active award/);
});

test("award confirm: two concurrent awards for two different bids on the same package - only one wins, the database enforces it", async () => {
  const { bidAId, bidBId, packageId } = await twoBidsOnFreshPackage(600_000, 590_000);

  const [r1, r2] = await Promise.all([
    developer.client.post("/api/award/confirm", { bidId: bidAId }),
    developer.client.post("/api/award/confirm", { bidId: bidBId }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  // Exactly one succeeds (201); the other is rejected (400) - never both
  // succeeding, which would violate the one-active-award-per-package rule.
  assert.deepEqual(statuses, [201, 400], `expected one 201 and one 400, got ${JSON.stringify(statuses)}`);

  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const activeAwards = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ id: string }>(`select id from awards where package_id = $1 and status = 'active'`, [packageId]),
  );
  assert.equal(activeAwards.length, 1, "exactly one active award must exist after the race");
});

test("award confirm: rollback on failure - a nonexistent bid never creates a partial award/PO/bid-flip", async () => {
  const before = await developer.client.get(`/api/award/purchase-orders?companyId=${developerCompanyId}`);
  const countBefore = before.body.length;

  const bogus = await developer.client.post("/api/award/confirm", { bidId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(bogus.status, 404, JSON.stringify(bogus.body));

  const after = await developer.client.get(`/api/award/purchase-orders?companyId=${developerCompanyId}`);
  assert.equal(after.body.length, countBefore, "a failed confirm must not create a stray purchase order");
});

test("award cancel: frees the package for re-award, bid reverts, PO is cancelled, history is preserved", async () => {
  const { bidAId, bidBId, packageId } = await twoBidsOnFreshPackage(700_000, 680_000);
  const awardA = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  assert.equal(awardA.status, 201, JSON.stringify(awardA.body));
  const awardId = awardA.body.award.id;

  // A vendor cannot cancel the award.
  const vendorCancel = await vendorA.client.post(`/api/award/${awardId}/cancel`, { reason: "not my call" });
  assert.equal(vendorCancel.status, 403, JSON.stringify(vendorCancel.body));

  const cancel = await developer.client.post(`/api/award/${awardId}/cancel`, { reason: "vendor could not perform" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.award.status, "cancelled");
  assert.equal(cancel.body.purchaseOrder.status, "cancelled");
  assert.equal(cancel.body.bidReverted, true);

  // A second cancel of the same award is rejected, not silently repeated.
  const again = await developer.client.post(`/api/award/${awardId}/cancel`, {});
  assert.equal(again.status, 400, JSON.stringify(again.body));

  // The package can now be awarded to the OTHER vendor.
  const awardB = await developer.client.post("/api/award/confirm", { bidId: bidBId });
  assert.equal(awardB.status, 201, JSON.stringify(awardB.body));
  assert.notEqual(awardB.body.award.id, awardId);

  // Both awards (one cancelled, one active) remain in history - nothing was deleted.
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const history = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ id: string; status: string }>(`select id, status from awards where package_id = $1 order by created_at`, [packageId]),
  );
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => h.status).sort(), ["active", "cancelled"]);
});

test("award cancel: a fulfilled purchase order's award cannot be cancelled", async () => {
  const { bidAId } = await twoBidsOnFreshPackage(250_000, 240_000);
  const award = await developer.client.post("/api/award/confirm", { bidId: bidAId });
  const awardId = award.body.award.id;
  const poId = award.body.purchaseOrder.id;

  const fulfill = await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });
  assert.equal(fulfill.status, 200, JSON.stringify(fulfill.body));

  const cancel = await developer.client.post(`/api/award/${awardId}/cancel`, {});
  assert.equal(cancel.status, 400, JSON.stringify(cancel.body));
  assert.match(cancel.body.error, /already been fulfilled/);
});
