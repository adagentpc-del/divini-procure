/**
 * Developer API platform (competitive gap closure, gap #11 in
 * docs/competitive-analysis-2026-08.md): API key issuance, and - the
 * real point of the feature - that a key actually authenticates ordinary
 * routes exactly as its creating user would (same RLS, nothing more),
 * that a read-only key cannot write, and that a revoked key stops
 * working immediately. lib/api-keys.ts + routes/api-keys.ts +
 * auth.ts's authMiddleware/requireApiKeyWriteScope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let dev: { client: TestClient; email: string };
let devCompanyId: string;

test.before(async () => {
  server = await startTestServer();
  dev = await registerVerifiedUser(server.baseUrl, "apikey-dev");
  devCompanyId = (await createCompany(dev.client, "buyer", "ApiKey Dev Co")).id;
});

test.after(async () => {
  await server.close();
});

async function rawFetch(path: string, init: RequestInit) {
  const res = await fetch(`${server.baseUrl}/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test("api keys: create returns the raw key once, list never exposes it again", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "CI integration", scopes: ["read", "write"] });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  assert.ok(create.body.apiKey.rawKey.startsWith("dvp_live_"));
  assert.equal(create.body.apiKey.name, "CI integration");
  assert.deepEqual(create.body.apiKey.scopes.sort(), ["read", "write"]);

  const list = await dev.client.get("/api/api-keys");
  assert.equal(list.status, 200);
  const row = list.body.apiKeys.find((k: any) => k.id === create.body.apiKey.id);
  assert.ok(row, "the created key must appear in the list");
  assert.equal(row.rawKey, undefined, "the raw key must never be returned again");
  assert.equal(row.key_hash, undefined, "the hash must never be returned to a client either");
  assert.ok(row.key_prefix.startsWith("dvp_live_"));
});

test("api keys: missing name is rejected; an invalid scope is rejected", async () => {
  const noName = await dev.client.post("/api/api-keys", { scopes: ["read"] });
  assert.equal(noName.status, 400);
  const badScope = await dev.client.post("/api/api-keys", { name: "x", scopes: ["admin"] });
  assert.equal(badScope.status, 400);
});

test("api keys: a real API key authenticates as its creator - same identity, same RLS - and can read /api/me", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "Read test", scopes: ["read"] });
  const rawKey = create.body.apiKey.rawKey as string;

  const me = await rawFetch("/me", { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.company?.id, devCompanyId);
});

test("api keys: a read-only key cannot make a write request, even though its creator normally could", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "Read only", scopes: ["read"] });
  const rawKey = create.body.apiKey.rawKey as string;

  const attempt = await rawFetch("/buildings", {
    method: "POST",
    headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: devCompanyId, name: "Should be blocked" }),
  });
  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
  assert.match(attempt.body.error, /write scope/);
});

test("api keys: a write-scoped key can create through the API exactly as the session user could", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "Read write", scopes: ["read", "write"] });
  const rawKey = create.body.apiKey.rawKey as string;

  const building = await rawFetch("/buildings", {
    method: "POST",
    headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: devCompanyId, name: "Built via API key" }),
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
});

test("api keys: revoking a key stops it from authenticating anything, immediately", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "Will be revoked", scopes: ["read"] });
  const rawKey = create.body.apiKey.rawKey as string;
  const keyId = create.body.apiKey.id as string;

  const before = await rawFetch("/me", { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(before.status, 200);

  const revoke = await dev.client.delete(`/api/api-keys/${keyId}`);
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body));

  const after = await rawFetch("/me", { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(after.status, 401, JSON.stringify(after.body));

  // Revoking the same key again is a 404, not a silent success.
  const revokeAgain = await dev.client.delete(`/api/api-keys/${keyId}`);
  assert.equal(revokeAgain.status, 404);
});

test("api keys: an outsider cannot list or revoke another company's keys", async () => {
  const outsider = await registerVerifiedUser(server.baseUrl, "apikey-outsider");
  await createCompany(outsider.client, "buyer", "ApiKey Outsider Co");

  const create = await dev.client.post("/api/api-keys", { name: "Belongs to dev", scopes: ["read"] });
  const keyId = create.body.apiKey.id as string;

  const list = await outsider.client.get("/api/api-keys");
  assert.equal(list.status, 200);
  assert.ok(!list.body.apiKeys.some((k: any) => k.id === keyId), "outsider must not see dev's key in their own list");

  const revoke = await outsider.client.delete(`/api/api-keys/${keyId}`);
  assert.equal(revoke.status, 404, "RLS makes the row invisible - no existence oracle for a key you don't own");
});

test("api keys: an unknown or malformed bearer token is simply unauthenticated, not a distinct error", async () => {
  const res = await rawFetch("/me", { headers: { Authorization: "Bearer dvp_live_totally_made_up_key_00000000000000" } });
  assert.equal(res.status, 401);
});

test("api keys: using a key sets last_used_at (touchApiKeyLastUsed must not silently no-op under RLS)", async () => {
  const create = await dev.client.post("/api/api-keys", { name: "Touch test", scopes: ["read"] });
  const rawKey = create.body.apiKey.rawKey as string;
  const keyId = create.body.apiKey.id as string;

  const listBefore = await dev.client.get("/api/api-keys");
  const before = listBefore.body.apiKeys.find((k: any) => k.id === keyId);
  assert.equal(before.last_used_at, null);

  const me = await rawFetch("/me", { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(me.status, 200, JSON.stringify(me.body));

  // touchApiKeyLastUsed is fire-and-forget (never awaited by auth
  // middleware) - give its best-effort write a moment to land rather than
  // racing it.
  await new Promise((r) => setTimeout(r, 200));

  const listAfter = await dev.client.get("/api/api-keys");
  const after = listAfter.body.apiKeys.find((k: any) => k.id === keyId);
  assert.ok(after.last_used_at, "last_used_at must be set after the key authenticates a request");
});
