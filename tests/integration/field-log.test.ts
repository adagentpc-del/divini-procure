/**
 * Field Log: daily logs + a time clock for a vendor's field crew
 * (competitive gap closure, gap #10 in docs/competitive-analysis-2026-08.md).
 * GET/POST /field-log/* (server/src/routes/field-log.ts). Vendor-write /
 * developer-read-only, scoped to a building where the vendor holds an
 * ACTIVE award - and, critically, one vendor's entries must never be
 * visible to a different vendor working at the same building under a
 * different package (RLS-enforced, not just app-layer).
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
let outsider: { client: TestClient; email: string };
let outsiderCompanyId: string;
let buildingId: string;

async function awardVendorAt(vendor: TestClient, vendorCompanyId: string, category: string): Promise<void> {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendor.post(`/api/packages/${packageId}/bids`, { vendorCompanyId, price: 15000, days: 10 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
}

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "fl-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "FL Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "fl-vendor-a");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "FL Vendor A")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "fl-vendor-b");
  vendorBCompanyId = (await createCompany(vendorB.client, "vendor", "FL Vendor B")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "fl-outsider");
  outsiderCompanyId = (await createCompany(outsider.client, "vendor", "FL Outsider Vendor")).id;

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "FL Test Building" });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  await awardVendorAt(vendorA.client, vendorACompanyId, "FL Electrical");
  await awardVendorAt(vendorB.client, vendorBCompanyId, "FL Plumbing");
});

test.after(async () => {
  await server.close();
});

test("field log: my-sites lists a building where the vendor holds an active award", async () => {
  const res = await vendorA.client.get(`/api/field-log/my-sites?companyId=${vendorACompanyId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.sites.some((s: any) => s.id === buildingId), JSON.stringify(res.body));
});

test("field log: an outsider with no award at this building sees no sites and cannot clock in", async () => {
  const sites = await outsider.client.get(`/api/field-log/my-sites?companyId=${outsiderCompanyId}`);
  assert.equal(sites.status, 200);
  assert.equal(sites.body.sites.length, 0);

  const clockIn = await outsider.client.post("/api/field-log/time-entries/clock-in", {
    buildingId, vendorCompanyId: outsiderCompanyId,
  });
  assert.equal(clockIn.status, 403, JSON.stringify(clockIn.body));

  const read = await outsider.client.get(`/api/field-log/daily-logs?buildingId=${buildingId}`);
  assert.equal(read.status, 403, JSON.stringify(read.body));
});

test("field log: clock in, see the open entry, reject a double clock-in, then clock out", async () => {
  const clockIn = await vendorA.client.post("/api/field-log/time-entries/clock-in", {
    buildingId, vendorCompanyId: vendorACompanyId,
  });
  assert.equal(clockIn.status, 201, JSON.stringify(clockIn.body));
  assert.equal(clockIn.body.entry.clock_out, null);
  const entryId = clockIn.body.entry.id as string;

  const open = await vendorA.client.get(`/api/field-log/time-entries/open?buildingId=${buildingId}&vendorCompanyId=${vendorACompanyId}`);
  assert.equal(open.status, 200);
  assert.equal(open.body.entry.id, entryId);

  const dupe = await vendorA.client.post("/api/field-log/time-entries/clock-in", {
    buildingId, vendorCompanyId: vendorACompanyId,
  });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.body));

  const clockOut = await vendorA.client.patch(`/api/field-log/time-entries/${entryId}/clock-out`, { notes: "Finished rough-in" });
  assert.equal(clockOut.status, 200, JSON.stringify(clockOut.body));
  assert.ok(clockOut.body.entry.clock_out, JSON.stringify(clockOut.body));
  assert.equal(clockOut.body.entry.notes, "Finished rough-in");

  const openAfter = await vendorA.client.get(`/api/field-log/time-entries/open?buildingId=${buildingId}&vendorCompanyId=${vendorACompanyId}`);
  assert.equal(openAfter.body.entry, null);

  const dupeClockOut = await vendorA.client.patch(`/api/field-log/time-entries/${entryId}/clock-out`, {});
  assert.equal(dupeClockOut.status, 409, JSON.stringify(dupeClockOut.body));
});

test("field log: a coworker at the same vendor company cannot clock out someone else's shift", async () => {
  // A vendor company can have more than one individual login
  // (company_members). Add a second person to Vendor A's company directly
  // (there is no self-serve "invite teammate" endpoint to exercise here),
  // mirroring the admin-context escalation rls-high-risk.test.ts uses for
  // direct setup.
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  const pool = await import("../../server/dist/pool.js");
  const coworker = await registerVerifiedUser(server.baseUrl, "fl-coworker");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    pool.q(`insert into company_members (company_id, user_id, role, seat) values ($1, $2, 'member', 2)`, [
      vendorACompanyId,
      coworker.userId,
    ]),
  );

  const clockIn = await vendorA.client.post("/api/field-log/time-entries/clock-in", {
    buildingId, vendorCompanyId: vendorACompanyId,
  });
  assert.equal(clockIn.status, 201, JSON.stringify(clockIn.body));
  const entryId = clockIn.body.entry.id as string;

  // The coworker can SEE the entry (same-company visibility)...
  const listAsCoworker = await coworker.client.get(`/api/field-log/time-entries?buildingId=${buildingId}`);
  assert.equal(listAsCoworker.status, 200);
  assert.ok(listAsCoworker.body.entries.some((e: any) => e.id === entryId));

  // ...but cannot clock it out on vendor A's behalf.
  const coworkerClockOut = await coworker.client.patch(`/api/field-log/time-entries/${entryId}/clock-out`, {});
  assert.equal(coworkerClockOut.status, 403, JSON.stringify(coworkerClockOut.body));

  // Vendor A can still clock out their own shift.
  const ownClockOut = await vendorA.client.patch(`/api/field-log/time-entries/${entryId}/clock-out`, {});
  assert.equal(ownClockOut.status, 200, JSON.stringify(ownClockOut.body));
});

test("field log: a daily log is visible to its own vendor and the building owner, but NOT to a different vendor at the same building", async () => {
  const create = await vendorA.client.post("/api/field-log/daily-logs", {
    buildingId, vendorCompanyId: vendorACompanyId,
    workPerformed: "Ran conduit on floor 2", crewCount: 4, weather: "Clear", delays: "None",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.log.work_performed, "Ran conduit on floor 2");
  assert.equal(create.body.log.crew_count, 4);

  // Vendor A sees its own log.
  const asVendorA = await vendorA.client.get(`/api/field-log/daily-logs?buildingId=${buildingId}`);
  assert.equal(asVendorA.status, 200);
  assert.equal(asVendorA.body.logs.length, 1, JSON.stringify(asVendorA.body));

  // The developer (building owner) sees it too.
  const asDeveloper = await developer.client.get(`/api/field-log/daily-logs?buildingId=${buildingId}`);
  assert.equal(asDeveloper.status, 200);
  assert.equal(asDeveloper.body.logs.length, 1, JSON.stringify(asDeveloper.body));

  // Vendor B, a DIFFERENT vendor with its own active award at the SAME
  // building, must not see Vendor A's log - this is the core privacy
  // guarantee RLS provides that an app-layer building-level check alone
  // would not (progress_photos' shared-visibility model does NOT apply
  // here on purpose).
  const asVendorB = await vendorB.client.get(`/api/field-log/daily-logs?buildingId=${buildingId}`);
  assert.equal(asVendorB.status, 200);
  assert.equal(asVendorB.body.logs.length, 0, JSON.stringify(asVendorB.body));
});

test("field log: a vendor cannot log work at a building where it has no active award", async () => {
  const res = await outsider.client.post("/api/field-log/daily-logs", {
    buildingId, vendorCompanyId: outsiderCompanyId, workPerformed: "Should not be allowed",
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("field log: missing required fields is a 400", async () => {
  const res = await vendorA.client.post("/api/field-log/daily-logs", { buildingId, vendorCompanyId: vendorACompanyId });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});
