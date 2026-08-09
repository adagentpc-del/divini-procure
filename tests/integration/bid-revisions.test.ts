/**
 * Phase 1 P1-05: the first real write path for the previously schema-only
 * `bid_revisions` table. Verifies proposal/accept/decline, that only the
 * counterparty may decide, that the proposer cannot approve its own
 * proposal, that acceptance moves bids.price transactionally, and that
 * history is never destroyed (a declined or superseded proposal stays in
 * bid_revisions forever).
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
  developer = await registerVerifiedUser(server.baseUrl, "bidrev-dev");
  const devCo = await createCompany(developer.client, "buyer", "Bid Revision Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "bidrev-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Bid Revision Vendor Co");
  vendorCompanyId = vendorCo.id;

  outsider = await registerVerifiedUser(server.baseUrl, "bidrev-outsider");
  await createCompany(outsider.client, "buyer", "Bid Revision Outsider Co");

  // This suite creates several packages under the same developer company
  // (one per test via freshBid()), past the free tier's bid-package limit -
  // a plan limit unrelated to what this suite is testing - lift it the same
  // way reviews.test.ts does.
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
    name: "Bid Revision Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function freshBid(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Bid Revision Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: priceDollars,
    days: 5,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;
  return { packageId, bidId };
}

test("bid revisions: vendor proposes a lower price; developer accepts; bids.price moves", async () => {
  const { packageId, bidId } = await freshBid(740_000);

  const propose = await vendor.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, {
    priceDollars: 718_000,
    note: "Value engineering pass",
  });
  assert.equal(propose.status, 201, JSON.stringify(propose.body));
  assert.equal(propose.body.revision.status, "pending");
  const revisionId = propose.body.revision.id;

  // The vendor (proposer) cannot accept its own proposal.
  const selfAccept = await vendor.client.patch(`/api/bid-revisions/${revisionId}`, { decision: "accepted" });
  assert.equal(selfAccept.status, 403, JSON.stringify(selfAccept.body));

  // An outsider cannot decide either. 404, not 403: bid_revisions' RLS SELECT
  // policy (db/schema-rls-high-risk.sql) already makes the row invisible to
  // any company that is neither the bidding vendor nor the package's
  // building owner, so the route's own SELECT returns nothing before the
  // app-layer role() check ever runs - the same RLS-driven "no existence
  // oracle" pattern established elsewhere this phase (agreements, progress
  // photos, award confirm). The security property (an outsider cannot decide
  // this revision) still holds.
  const outsiderAccept = await outsider.client.patch(`/api/bid-revisions/${revisionId}`, { decision: "accepted" });
  assert.equal(outsiderAccept.status, 404, JSON.stringify(outsiderAccept.body));

  const accept = await developer.client.patch(`/api/bid-revisions/${revisionId}`, { decision: "accepted" });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.revision.status, "accepted");
  assert.equal(Number(accept.body.bid.price), 718_000);

  // A second decision on the same (now-resolved) revision is rejected.
  const again = await developer.client.patch(`/api/bid-revisions/${revisionId}`, { decision: "declined" });
  assert.equal(again.status, 400, JSON.stringify(again.body));
});

test("bid revisions: multi-round negotiation preserves full history without deleting any prior offer", async () => {
  const { packageId, bidId } = await freshBid(740_000);

  const r1 = await vendor.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, { priceDollars: 718_000 });
  await developer.client.patch(`/api/bid-revisions/${r1.body.revision.id}`, { decision: "accepted" });

  // Developer proposes a further reduction; vendor declines it.
  const r2 = await developer.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, { priceDollars: 690_000 });
  const decline = await vendor.client.patch(`/api/bid-revisions/${r2.body.revision.id}`, { decision: "declined" });
  assert.equal(decline.status, 200, JSON.stringify(decline.body));

  // Vendor counters with the actual final negotiated offer; developer accepts.
  const r3 = await vendor.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, { priceDollars: 705_000 });
  await developer.client.patch(`/api/bid-revisions/${r3.body.revision.id}`, { decision: "accepted" });

  const history = await developer.client.get(`/api/packages/${packageId}/bids/${bidId}/revisions`);
  assert.equal(history.status, 200);
  assert.equal(history.body.revisions.length, 3, "every proposal (accepted or declined) must remain in history");
  assert.equal(Number(history.body.currentPrice), 705_000);

  const statuses = history.body.revisions.map((r: any) => r.status).sort();
  assert.deepEqual(statuses, ["accepted", "accepted", "declined"]);
});

test("bid revisions: an outsider cannot propose or read revisions on a bid it has no part in", async () => {
  const { packageId, bidId } = await freshBid(50_000);
  // 404, not 403: bids' own RLS SELECT policy already hides this bid from an
  // outsider before bidContext()'s query returns a row - same "no existence
  // oracle" pattern as elsewhere in this suite.
  const propose = await outsider.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, { priceDollars: 1 });
  assert.equal(propose.status, 404, JSON.stringify(propose.body));
  const read = await outsider.client.get(`/api/packages/${packageId}/bids/${bidId}/revisions`);
  assert.equal(read.status, 404, JSON.stringify(read.body));
});

test("bid revisions: no further revisions may be proposed once the bid is awarded", async () => {
  const { packageId, bidId } = await freshBid(80_000);
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));

  const propose = await vendor.client.post(`/api/packages/${packageId}/bids/${bidId}/revisions`, { priceDollars: 70_000 });
  assert.equal(propose.status, 400, JSON.stringify(propose.body));
});
