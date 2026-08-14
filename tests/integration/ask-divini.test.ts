/**
 * Ask Divini narrow first slice (docs/ai-layer-design.md section 7).
 *
 * This test environment has no LLM configured (llmEnabled() is false by
 * default, matching every other AI-touching feature in this codebase's own
 * test posture - see tests/integration/*.test.ts for intel.ts/blueprint.ts,
 * neither of which exercises a real completion either). What IS verified
 * here, all real and live: the fail-closed contract (askAboutProject()
 * returns ok:false with a clear reason rather than throwing or fabricating
 * an answer when AI is disabled), payload assembly correctness (real
 * numbers from real financial-summary data, never fabricated), route
 * authorization (developer/admin only, matching financial-summary.ts
 * exactly), and input validation. The actual LLM call path cannot be
 * live-verified in this sandbox - same disclosed limitation this
 * engagement has applied to Stripe-dependent paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string };
let developerCompanyId: string;
let outsider: { client: TestClient; email: string };
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "askdivini-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Ask Divini Test Dev Co")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "askdivini-outsider");
  await createCompany(outsider.client, "buyer", "Ask Divini Outsider Co");

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Ask Divini Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  await developer.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 5_000_000_00, reason: "Ask Divini test",
  });
  await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Ask Divini Test Package" });
});

test.after(async () => {
  await server.close();
});

test("POST /ask-divini/project/:buildingId requires a non-empty question", async () => {
  const res = await developer.client.post(`/api/ask-divini/project/${buildingId}`, { question: "" });
  assert.equal(res.status, 400, JSON.stringify(res.body));

  const res2 = await developer.client.post(`/api/ask-divini/project/${buildingId}`, {});
  assert.equal(res2.status, 400, JSON.stringify(res2.body));
});

test("POST /ask-divini/project/:buildingId returns 404 for a nonexistent project", async () => {
  const res = await developer.client.post(`/api/ask-divini/project/00000000-0000-0000-0000-000000000000`, {
    question: "What is the current budget?",
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});

test("POST /ask-divini/project/:buildingId denies a non-member outsider", async () => {
  const res = await outsider.client.post(`/api/ask-divini/project/${buildingId}`, {
    question: "What is the current budget?",
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("POST /ask-divini/project/:buildingId: with AI disabled (this test environment's default), fails closed rather than fabricating an answer", async () => {
  const res = await developer.client.post(`/api/ask-divini/project/${buildingId}`, {
    question: "What is the current budget?",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, false, "must not claim success when no answer was actually generated");
  assert.equal(res.body.answer, null, "must never fabricate an answer text when the LLM is unavailable");
  assert.ok(res.body.reason, "must explain why, not just silently return nothing");
  assert.ok(res.body.disclosure, "the AI-generated disclosure text must always be present, even on failure");
});

test("buildProjectPayload assembles real, correct data - never fabricated, never another project's numbers", async () => {
  const { buildProjectPayload } = await import("../../server/dist/lib/ask-divini.js");
  const payload = await buildProjectPayload(buildingId);
  assert.ok(payload, "payload must be assembled for a real project");
  assert.equal(payload!.projectName, "Ask Divini Test Building");
  assert.equal(payload!.budgetCurrentCents, 5_000_000_00);
  assert.equal(payload!.packageCount, 1);
  const packages = payload!.packages as any[];
  assert.equal(packages.length, 1);
  assert.equal(packages[0].category, "Ask Divini Test Package");
});

test("buildProjectPayload returns null for a nonexistent project", async () => {
  const { buildProjectPayload } = await import("../../server/dist/lib/ask-divini.js");
  const payload = await buildProjectPayload("00000000-0000-0000-0000-000000000000");
  assert.equal(payload, null);
});
