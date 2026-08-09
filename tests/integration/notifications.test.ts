/**
 * Regression coverage for Phase 0 item 15: transactional notifications for
 * bid invite + award, using the existing notification/email infra
 * (lib/notify.ts, lib/email.ts - no second architecture), plus the new
 * GET/PATCH /notifications read + mark-read surface (previously the
 * notifications table was write-only with no route reading it at all).
 *
 * The key property under test beyond "a notification gets created" is
 * IDEMPOTENCY: retrying an already-completed award confirm, or re-inviting
 * an already-invited vendor, must not spam a second notification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string; userId: string };
let developerCompanyId: string;
let vendor: { client: TestClient; email: string; userId: string };
let vendorCompanyId: string;
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "notify-dev");
  const devCo = await createCompany(developer.client, "buyer", "Notify Dev Co");
  developerCompanyId = devCo.id;

  vendor = await registerVerifiedUser(server.baseUrl, "notify-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Notify Vendor Co");
  vendorCompanyId = vendorCo.id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Notify Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

async function countNotifications(userId: string, kind: string): Promise<number> {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ id: string }>(`select id from notifications where user_id = $1 and kind = $2`, [userId, kind]),
  );
  return rows.length;
}

test("bid invite: creates exactly one notification for the vendor on first invite, none on a re-invite", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Electrical",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const invite1 = await developer.client.post("/api/intel/invite-vendor", {
    packageId,
    vendorCompanyId,
    message: "Please bid",
  });
  assert.equal(invite1.status, 200, JSON.stringify(invite1.body));

  const afterFirst = await countNotifications(vendor.userId, "bid_invite");
  assert.equal(afterFirst, 1, "the first invite must create exactly one notification");

  // Re-invite the same vendor on the same package (the route's own upsert
  // ON CONFLICT DO UPDATE path) - must NOT create a second notification.
  const invite2 = await developer.client.post("/api/intel/invite-vendor", {
    packageId,
    vendorCompanyId,
    message: "Second nudge",
  });
  assert.equal(invite2.status, 200, JSON.stringify(invite2.body));

  const afterSecond = await countNotifications(vendor.userId, "bid_invite");
  assert.equal(afterSecond, 1, "re-inviting an already-invited vendor must not spam a second notification");
});

test("award confirm: creates exactly one notification for the vendor, and a retried confirm does not create a second one", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Plumbing",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: 6000,
    days: 12,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const award1 = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award1.status, 201, JSON.stringify(award1.body));

  const afterFirst = await countNotifications(vendor.userId, "award");
  assert.equal(afterFirst, 1, "the first successful award confirm must create exactly one notification");

  // Retry the same confirm (e.g. a resent request after a network blip).
  // The route's own existing-PO early-return makes this idempotent - it
  // must not create a second notification.
  const award2 = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award2.status, 200, JSON.stringify(award2.body));

  const afterSecond = await countNotifications(vendor.userId, "award");
  assert.equal(afterSecond, 1, "retrying an already-confirmed award must not spam a second notification");
});

test("GET /notifications: returns only the caller's own notifications, and mark-read is scoped to the owner", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Roofing",
  });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  await developer.client.post("/api/intel/invite-vendor", { packageId, vendorCompanyId });

  const mine = await vendor.client.get("/api/notifications");
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(mine.body.notifications.length >= 1, "the vendor must see its own notifications");
  assert.ok(
    mine.body.notifications.every((n: any) => n.kind !== undefined),
    "notification rows must be well-formed",
  );

  const someoneElses = await developer.client.get("/api/notifications");
  assert.equal(someoneElses.status, 200);
  assert.ok(
    someoneElses.body.notifications.every((n: any) => !mine.body.notifications.some((m: any) => m.id === n.id)),
    "the developer must not see the vendor's notifications (or vice versa)",
  );

  const targetId = mine.body.notifications[0].id;

  // The developer (not the notification's owner) must not be able to mark
  // it read.
  const foreignMarkRead = await developer.client.patch(`/api/notifications/${targetId}/read`, {});
  assert.equal(foreignMarkRead.status, 404, JSON.stringify(foreignMarkRead.body));

  const ownMarkRead = await vendor.client.patch(`/api/notifications/${targetId}/read`, {});
  assert.equal(ownMarkRead.status, 200, JSON.stringify(ownMarkRead.body));
  assert.equal(ownMarkRead.body.notification.read, true);
});
