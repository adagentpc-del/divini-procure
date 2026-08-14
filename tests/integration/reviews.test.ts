/**
 * Regression coverage for Phase 0 item 19: the first real write path for
 * the previously write-less `reviews` table. lib/procure-moat.ts's
 * diviniScore() has always read from this table (avg(stars) where
 * ratee_company_id = vendor) - nothing ever wrote to it before this.
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
  developer = await registerVerifiedUser(server.baseUrl, "review-dev");
  const devCo = await createCompany(developer.client, "buyer", "Review Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "review-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Review Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "review-outsider");
  await createCompany(outsider.client, "buyer", "Review Outsider Co");

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Review Test Building",
  });
  assert.equal(building.status, 201);
  buildingId = (building.body.building ?? building.body).id;

  // This suite creates several awarded packages under the same developer
  // company across its tests, past the free tier's 3-bid-package limit
  // (a plan limit unrelated to what this suite is testing) - lift it the
  // same way revenue-mrr.test.ts does, by writing a real entitlement row
  // directly via the db layer.
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
});

test.after(async () => {
  await server.close();
});

async function awardedPackage(priceDollars: number, category = "General") {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category });
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
  const poId = award.body.purchaseOrder.id as string;

  return { packageId, poId };
}

test("reviews: cannot review a vendor before the purchase order is fulfilled", async () => {
  const { packageId } = await awardedPackage(1000);
  const attempt = await developer.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 5,
    body: "Too early",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("reviews: the developer can review once the PO is fulfilled; a second POST is rejected as a duplicate", async () => {
  const { packageId, poId } = await awardedPackage(2000);

  const issue = await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });
  assert.equal(issue.status, 200, JSON.stringify(issue.body));

  const create = await developer.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 4,
    body: "Solid work, on time.",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.review.stars, 4);
  assert.equal(create.body.review.rater_company_id, developerCompanyId);
  assert.equal(create.body.review.ratee_company_id, vendorCompanyId);

  const dup = await developer.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 1,
    body: "Trying to overwrite",
  });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));

  // The original review must be unaffected by the rejected duplicate attempt.
  const list = await developer.client.get(`/api/reviews?packageId=${packageId}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.reviews.length, 1);
  assert.equal(list.body.reviews[0].stars, 4);
});

test("reviews: an unrelated company cannot leave a review for a relationship it was never part of", async () => {
  const { packageId, poId } = await awardedPackage(3000);
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });

  const attempt = await outsider.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 5,
    body: "I was never involved",
  });
  // 403, not 400: outsider is a real, valid company - it simply has no
  // fulfilled purchase order for this package/vendor pair, so it fails
  // assertCanReview's relationship check, not basic input validation.
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("reviews: the vendor itself cannot leave a review claiming to be the rater (self-review)", async () => {
  const { packageId, poId } = await awardedPackage(3500);
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });

  const attempt = await vendor.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 5,
    body: "Self-review attempt",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("reviews: the original rater can edit; an unrelated company cannot edit someone else's review", async () => {
  const { packageId, poId } = await awardedPackage(4000);
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });

  const create = await developer.client.post("/api/reviews", {
    packageId,
    vendorCompanyId,
    stars: 3,
    body: "Initial review",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const reviewId = create.body.review.id;

  const edit = await developer.client.patch(`/api/reviews/${reviewId}`, { stars: 5, body: "Updated after final walkthrough" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.review.stars, 5);
  assert.ok(edit.body.review.updated_at);

  const foreignEdit = await outsider.client.patch(`/api/reviews/${reviewId}`, { stars: 1 });
  assert.equal(foreignEdit.status, 403, JSON.stringify(foreignEdit.body));
});

test("reviews: averageStars/count feed the public read, and lib/procure-moat.ts's own query sees the same data", async () => {
  const { packageId, poId } = await awardedPackage(5000);
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });
  await developer.client.post("/api/reviews", { packageId, vendorCompanyId, stars: 5, body: "Great" });

  const publicRead = await outsider.client.get(`/api/reviews?vendorCompanyId=${vendorCompanyId}`);
  assert.equal(publicRead.status, 200);
  assert.ok(publicRead.body.count >= 1);
  assert.ok(publicRead.body.averageStars != null);

  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const moatQuery = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ avg: number | null; cnt: number }>(
      `select avg(stars) as avg, count(*)::int as cnt from reviews where ratee_company_id = $1`,
      [vendorCompanyId],
    ),
  );
  assert.ok(moatQuery[0].cnt >= 1, "diviniScore()'s own review query must see the newly written row");
});

// M-01 gap #12: lessons-learned knowledge base fields (would_rehire/on_time/
// on_budget/lessons_learned), and the package's trade category surfaced on
// each review row so a developer sourcing similar work can find relevant
// past notes - never a derived score, just facts plus a guided text field.
test("reviews: lessons-learned fields round-trip on create, edit, and the public read, with the package's category attached", async () => {
  const { packageId, poId } = await awardedPackage(6000, "Electrical");
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });

  const create = await developer.client.post("/api/reviews", {
    packageId, vendorCompanyId, stars: 5, body: "Great crew",
    wouldRehire: true, onTime: true, onBudget: false,
    lessonsLearned: "Confirm panel lead times up front - that was our only delay.",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.review.would_rehire, true);
  assert.equal(create.body.review.on_time, true);
  assert.equal(create.body.review.on_budget, false);
  assert.equal(create.body.review.lessons_learned, "Confirm panel lead times up front - that was our only delay.");

  const publicRead = await outsider.client.get(`/api/reviews?vendorCompanyId=${vendorCompanyId}&packageId=${packageId}`);
  assert.equal(publicRead.status, 200);
  const row = publicRead.body.reviews.find((r: any) => r.id === create.body.review.id);
  assert.ok(row, "the new review must appear in the public read");
  assert.equal(row.package_category, "Electrical");
  assert.equal(row.would_rehire, true);
  assert.equal(row.lessons_learned, "Confirm panel lead times up front - that was our only delay.");
  assert.equal(publicRead.body.wouldRehireYes, 1);
  assert.equal(publicRead.body.wouldRehireNo, 0);

  const edit = await developer.client.patch(`/api/reviews/${create.body.review.id}`, { wouldRehire: false, lessonsLearned: "Updated note." });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.review.would_rehire, false);
  assert.equal(edit.body.review.lessons_learned, "Updated note.");

  const afterEdit = await outsider.client.get(`/api/reviews?vendorCompanyId=${vendorCompanyId}&packageId=${packageId}`);
  assert.equal(afterEdit.body.wouldRehireYes, 0);
  assert.equal(afterEdit.body.wouldRehireNo, 1);
});

test("reviews: lessons-learned fields are all optional - a plain review with none of them still works", async () => {
  const { packageId, poId } = await awardedPackage(6500, "Plumbing");
  await developer.client.patch(`/api/award/purchase-orders/${poId}`, { status: "fulfilled" });

  const create = await developer.client.post("/api/reviews", { packageId, vendorCompanyId, stars: 3 });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.review.would_rehire, null);
  assert.equal(create.body.review.on_time, null);
  assert.equal(create.body.review.on_budget, null);
  assert.equal(create.body.review.lessons_learned, null);
});
