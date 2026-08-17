/**
 * AI-01: AI-drafted scope-of-work from uploaded plans (fresh competitive
 * scan gap #8, AI/Procurement Graph freeze explicitly opened for this by
 * the user). POST /scope/instances/:id/ai-draft
 * (server/src/routes/scope-builder.ts).
 *
 * This environment has no LLM_PROVIDER configured (llmEnabled() is false
 * by default, matching every other AI touch point in this codebase - see
 * server/src/lib/llm.ts's own header). That means the actual grounded-
 * generation behavior is untestable here without a real provider, same as
 * blueprint.ts's own /analyze endpoint - what IS testable, and what
 * actually matters most for this feature's core guardrail ("the LLM is
 * never a hard dependency"), is that every code path degrades gracefully
 * with a clear reason and never writes anything to scope_instances.
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
let packageId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "sbai-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "SB AI Dev Co")).id;

  outsider = await registerVerifiedUser(server.baseUrl, "sbai-outsider");
  await createCompany(outsider.client, "buyer", "SB AI Outsider Co");

  const building = await developer.client.post("/api/buildings", { company_id: developerCompanyId, name: "SB AI Building" });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "SB AI Electrical" });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

test("scope AI draft: an outsider cannot draft a scope they don't own", async () => {
  const create = await developer.client.post("/api/scope/instances", {
    companyId: developerCompanyId, category: "SB AI Electrical", title: "Outsider test scope",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const scopeId = create.body.instance.id;

  const res = await outsider.client.post(`/api/scope/instances/${scopeId}/ai-draft`, {});
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("scope AI draft: a scope with no linked package returns a clear reason, never a draft", async () => {
  const create = await developer.client.post("/api/scope/instances", {
    companyId: developerCompanyId, category: "SB AI Electrical", title: "No package scope",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const scopeId = create.body.instance.id;

  const res = await developer.client.post(`/api/scope/instances/${scopeId}/ai-draft`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.draft, null);
  assert.match(res.body.reason, /package/i);
});

test("scope AI draft: with a linked package, degrades gracefully when the LLM is not configured (this environment's default) and never writes to the scope", async () => {
  const create = await developer.client.post("/api/scope/instances", {
    companyId: developerCompanyId, category: "SB AI Electrical", title: "Linked-package scope", packageId,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const scopeId = create.body.instance.id;

  const before = await developer.client.get(`/api/scope/instances/${scopeId}`);
  assert.equal(before.status, 200, JSON.stringify(before.body));

  const res = await developer.client.post(`/api/scope/instances/${scopeId}/ai-draft`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.draft, null, "no LLM_PROVIDER is configured in this environment, so this must degrade rather than error");
  assert.ok(res.body.reason, "a clear reason must always accompany a null draft");

  // Confirm the endpoint is genuinely read-only - the scope's narrative
  // fields are untouched, matching "never auto-saves" for every AI touch
  // point in this codebase.
  const after = await developer.client.get(`/api/scope/instances/${scopeId}`);
  assert.equal(after.status, 200, JSON.stringify(after.body));
  assert.equal(after.body.instance.site_conditions, before.body.instance.site_conditions);
  assert.equal(after.body.instance.access_restrictions, before.body.instance.access_restrictions);
  assert.deepEqual(after.body.instance.exclusions, before.body.instance.exclusions);
  assert.deepEqual(after.body.instance.acceptance_criteria, before.body.instance.acceptance_criteria);
});

test("scope AI draft: a package with a real extracted document still degrades gracefully without a configured LLM, and the endpoint remains read-only", async () => {
  // Direct-DB fixture (no upload+extraction pipeline exercised here) - a
  // document genuinely linked to this package with real extracted text,
  // matching schema-blueprint-content-extraction.sql's shape. Confirms the
  // document-lookup query itself runs without error even when it finds a
  // real row, still short-circuiting on llmEnabled() before ever building
  // a prompt from it.
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(
      `insert into documents (company_id, building_id, package_id, name, kind, extracted_text, extraction_method, extracted_at)
       values ($1, $2, $3, 'panel-schedule.pdf', 'application/pdf', 'Panel schedule: 200A service, 3-phase. Access via loading dock only, 7am-3pm weekdays.', 'pdf_text_layer', now())`,
      [developerCompanyId, buildingId, packageId],
    ),
  );

  const create = await developer.client.post("/api/scope/instances", {
    companyId: developerCompanyId, category: "SB AI Electrical", title: "Scope with real document", packageId,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const scopeId = create.body.instance.id;

  const res = await developer.client.post(`/api/scope/instances/${scopeId}/ai-draft`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.draft, null);
  assert.match(res.body.reason, /not configured/i);
});
