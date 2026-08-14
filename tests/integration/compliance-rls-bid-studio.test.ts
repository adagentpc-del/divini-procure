/**
 * Compliance completion pass: closes the carried-forward "R-18" item from
 * docs/platform-standard/release-readiness.md (bid_line_items/
 * bid_payment_milestones outside DB-level RLS, real today via app-layer
 * checks only). Re-checking that note found a bigger gap than it described:
 * bid_versions, bid_templates, and bid_template_line_items - three more
 * tables from the same db/schema-bid-studio.sql migration - also had zero
 * RLS. See db/schema-rls-bid-studio.sql for the policies and their source
 * of truth (server/src/routes/bid-studio.ts's own authorization model).
 *
 * Two layers, matching the tests/integration/phase1-rls-coverage.test.ts
 * precedent: a direct pg_class/pg_policies catalog check (the real database
 * guarantee, not a behavioral proxy), plus an end-to-end behavioral flow
 * proving RLS didn't break legitimate same-vendor-company access and does
 * deny a genuine outsider vendor company.
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
let outsiderVendor: { client: TestClient; email: string };
let outsiderVendorCompanyId: string;
let buildingId: string;
let packageId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "bidstudio-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Bid Studio RLS Dev Co")).id;

  vendor = await registerVerifiedUser(server.baseUrl, "bidstudio-vendor");
  vendorCompanyId = (await createCompany(vendor.client, "vendor", "Bid Studio RLS Vendor Co")).id;

  outsiderVendor = await registerVerifiedUser(server.baseUrl, "bidstudio-outsider");
  outsiderVendorCompanyId = (await createCompany(outsiderVendor.client, "vendor", "Bid Studio RLS Outsider Co")).id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Bid Studio RLS Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Bid Studio RLS Test" });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

const BID_STUDIO_TABLES = ["bid_payment_milestones", "bid_versions", "bid_templates", "bid_template_line_items"];

test("compliance: bid-studio satellite tables have row-level security enabled AND forced", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");

  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relname = any($1) and relkind = 'r'`,
      [BID_STUDIO_TABLES],
    ),
  );

  const found = new Map(rows.map((r) => [r.relname, r]));
  for (const table of BID_STUDIO_TABLES) {
    const row = found.get(table);
    assert.ok(row, `table ${table} not found in pg_class - migration may not have run`);
    assert.equal(row!.relrowsecurity, true, `${table}: row level security is not ENABLED`);
    assert.equal(row!.relforcerowsecurity, true, `${table}: row level security is not FORCED`);
  }
});

test("compliance: bid-studio satellite tables each have at least one real RLS policy", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");

  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ tablename: string; count: number }>(
      `select tablename, count(*)::int as count from pg_policies
        where tablename = any($1) group by tablename`,
      [BID_STUDIO_TABLES],
    ),
  );
  const found = new Map(rows.map((r) => [r.tablename, Number(r.count)]));
  for (const table of BID_STUDIO_TABLES) {
    assert.ok((found.get(table) ?? 0) > 0, `table ${table} has RLS enabled but zero policies defined`);
  }
});

test("compliance: RLS did not break legitimate same-vendor-company bid-studio access (milestone, version, template)", async () => {
  const draft = await vendor.client.post("/api/bid-studio/drafts", { companyId: vendorCompanyId, packageId });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const bidId = draft.body.draft.id;

  const milestone = await vendor.client.post(`/api/bid-studio/drafts/${bidId}/milestones`, {
    label: "Deposit", dueEvent: "deposit", percentBasisPoints: 2000,
  });
  assert.equal(milestone.status, 201, JSON.stringify(milestone.body));

  const lineItem = await vendor.client.post(`/api/bid-studio/drafts/${bidId}/line-items`, {
    name: "Panel upgrade", qty: 1, unitPrice: 5000,
  });
  assert.equal(lineItem.status, 201, JSON.stringify(lineItem.body));

  const version = await vendor.client.post(`/api/bid-studio/drafts/${bidId}/save-version`, { changeSummary: "initial" });
  assert.equal(version.status, 201, JSON.stringify(version.body));

  const template = await vendor.client.post(`/api/bid-studio/drafts/${bidId}/save-as-template`, { name: "Standard electrical" });
  assert.equal(template.status, 201, JSON.stringify(template.body));

  const read = await vendor.client.get(`/api/bid-studio/drafts/${bidId}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.milestones.length, 1);
  assert.equal(read.body.versions.length, 1);

  const templates = await vendor.client.get(`/api/bid-studio/templates?companyId=${vendorCompanyId}`);
  assert.equal(templates.status, 200);
  assert.equal(templates.body.templates.length, 1);
});

test("compliance: an outsider vendor company cannot read another vendor's bid-studio draft, milestones, or templates", async () => {
  const draft = await vendor.client.post("/api/bid-studio/drafts", { companyId: vendorCompanyId, packageId });
  const bidId = draft.body.draft.id;
  await vendor.client.post(`/api/bid-studio/drafts/${bidId}/milestones`, { label: "Deposit", dueEvent: "deposit" });
  await vendor.client.post(`/api/bid-studio/drafts/${bidId}/save-as-template`, { name: "Outsider-test template" });

  // 404, not 403: bids itself has RLS (bids_select = vendor OR the
  // package's developer company OR admin), so the outsider's own SELECT
  // inside authorizeDraft() never sees the row at all - it throws
  // NotFoundError before its ForbiddenError branch is ever reached. This is
  // the same "RLS-driven no existence oracle" pattern documented throughout
  // this engagement's other test files (bid-revisions, agreement-po-link,
  // invoices): an unauthorized caller gets a row-invisible 404, not a 403.
  const readDraft = await outsiderVendor.client.get(`/api/bid-studio/drafts/${bidId}`);
  assert.equal(readDraft.status, 404, JSON.stringify(readDraft.body));

  const readOwnCompanyTemplates = await outsiderVendor.client.get(`/api/bid-studio/templates?companyId=${outsiderVendorCompanyId}`);
  assert.equal(readOwnCompanyTemplates.status, 200);
  assert.equal(readOwnCompanyTemplates.body.templates.length, 0, "outsider's own (empty) template list must not include the other vendor's template");

  const readOtherCompanyTemplates = await outsiderVendor.client.get(`/api/bid-studio/templates?companyId=${vendorCompanyId}`);
  assert.equal(readOtherCompanyTemplates.status, 403, JSON.stringify(readOtherCompanyTemplates.body));
});
