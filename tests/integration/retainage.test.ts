/**
 * Regression coverage for the Phase 0 fix to retainage.ts: POST /retainage,
 * POST /lien-waivers, and PATCH /lien-waivers/:id previously accepted
 * arbitrary vendorCompanyId/developerCompanyId values from the request body
 * with no check that the caller had any real relationship to the named
 * building, letting any authenticated user fabricate financial records
 * between two companies they have nothing to do with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let buildingId: string;
let vendor: { client: TestClient; email: string };
let vendorCompanyId: string;
let attacker: { client: TestClient; email: string };
let attackerCompanyId: string;

test.before(async () => {
  server = await startTestServer();

  developer = await registerVerifiedUser(server.baseUrl, "retainage-dev");
  const devCo = await createCompany(developer.client, "buyer", "Retainage Dev Co");
  developerCompanyId = devCo.id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Retainage Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  vendor = await registerVerifiedUser(server.baseUrl, "retainage-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "Retainage Vendor Co");
  vendorCompanyId = vendorCo.id;

  attacker = await registerVerifiedUser(server.baseUrl, "retainage-attacker");
  const attackerCo = await createCompany(attacker.client, "buyer", "Unrelated Attacker Co");
  attackerCompanyId = attackerCo.id;
});

test.after(async () => {
  await server.close();
});

test("retainage: an unrelated company cannot create a retainage record by supplying someone else's building/company ids", async () => {
  const attempt = await attacker.client.post("/api/retainage", {
    buildingId,
    vendorCompanyId,
    developerCompanyId, // real developer company, but attacker isn't a member of it
    contractAmountCents: 100000,
    retainagePct: 10,
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("retainage: an unrelated company cannot create a retainage record even if it names its OWN company as developerCompanyId (building ownership mismatch)", async () => {
  const attempt = await attacker.client.post("/api/retainage", {
    buildingId, // real building, owned by `developer`, not the attacker
    vendorCompanyId,
    developerCompanyId: attackerCompanyId,
    contractAmountCents: 100000,
    retainagePct: 10,
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("retainage: the building's real developer company can create a retainage record", async () => {
  const create = await developer.client.post("/api/retainage", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    contractAmountCents: 100000,
    retainagePct: 10,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.equal(create.body.record.retainage_held_cents, 10000);
});

test("retainage: a malformed/nonexistent vendorCompanyId is rejected", async () => {
  const attempt = await developer.client.post("/api/retainage", {
    buildingId,
    vendorCompanyId: "00000000-0000-0000-0000-000000000000",
    developerCompanyId,
    contractAmountCents: 100000,
    retainagePct: 10,
  });
  assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
});

test("lien waivers: an unrelated company cannot create a lien waiver against another company's building", async () => {
  const attempt = await attacker.client.post("/api/lien-waivers", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    waiverType: "conditional_progress",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("lien waivers: an unrelated company cannot PATCH (accept) another pair's lien waiver", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    waiverType: "conditional_progress",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const waiverId = create.body.waiver.id;

  const attempt = await attacker.client.patch(`/api/lien-waivers/${waiverId}`, {
    status: "accepted",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("lien waivers: the vendor cannot unilaterally accept its own waiver (developer/admin only)", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    waiverType: "conditional_progress",
  });
  assert.equal(create.status, 201);
  const waiverId = create.body.waiver.id;

  const attempt = await vendor.client.patch(`/api/lien-waivers/${waiverId}`, {
    status: "accepted",
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("lien waivers: the developer can accept a lien waiver it is a real party to", async () => {
  const create = await developer.client.post("/api/lien-waivers", {
    buildingId,
    vendorCompanyId,
    developerCompanyId,
    waiverType: "conditional_progress",
  });
  assert.equal(create.status, 201);
  const waiverId = create.body.waiver.id;

  const accept = await developer.client.patch(`/api/lien-waivers/${waiverId}`, {
    status: "accepted",
  });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.waiver.status, "accepted");
});
