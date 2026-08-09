/**
 * Regression coverage for the Phase 0 fix to progress-photos.ts: POST/PATCH/GET
 * previously trusted a client-supplied buildingId with no check that the
 * caller had any relationship to that building at all, letting any
 * authenticated user fabricate or read another company's (including
 * investor-visible) progress photos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let owner: { client: TestClient; email: string };
let ownerCompanyId: string;
let buildingId: string;
let outsider: { client: TestClient; email: string };

test.before(async () => {
  server = await startTestServer();
  owner = await registerVerifiedUser(server.baseUrl, "photos-owner");
  const company = await createCompany(owner.client, "buyer", "Photos Owner Co");
  ownerCompanyId = company.id;

  const building = await owner.client.post("/api/buildings", {
    company_id: ownerCompanyId,
    name: "Photos Test Building",
    location: "Test City",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  outsider = await registerVerifiedUser(server.baseUrl, "photos-outsider");
  await createCompany(outsider.client, "buyer", "Unrelated Co");
});

test.after(async () => {
  await server.close();
});

test("progress photos: an unrelated company cannot create a photo on another company's building", async () => {
  const attempt = await outsider.client.post("/api/progress-photos", {
    buildingId,
    storagePath: "fake/path.jpg",
    caption: "CONFIDENTIAL forged milestone",
    visibleToInvestors: true,
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("progress photos: an unrelated company cannot list another company's building photos", async () => {
  const create = await owner.client.post("/api/progress-photos", {
    buildingId,
    storagePath: "real/path.jpg",
    caption: "Real milestone",
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));

  const attempt = await outsider.client.get(`/api/progress-photos?buildingId=${buildingId}`);
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("progress photos: the building owner can create and list their own photos", async () => {
  const create = await owner.client.post("/api/progress-photos", {
    buildingId,
    storagePath: "owner/path.jpg",
    caption: "Owner milestone",
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));

  const list = await owner.client.get(`/api/progress-photos?buildingId=${buildingId}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.photos.length >= 1);
});

test("progress photos: an unrelated company cannot modify another company's photo", async () => {
  const create = await owner.client.post("/api/progress-photos", {
    buildingId,
    storagePath: "owner/path2.jpg",
    caption: "Original caption",
  });
  assert.equal(create.status, 200);
  const photoId = create.body.photo.id;

  const attempt = await outsider.client.patch(`/api/progress-photos/${photoId}`, {
    caption: "tampered by outsider",
    visibleToInvestors: true,
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});
