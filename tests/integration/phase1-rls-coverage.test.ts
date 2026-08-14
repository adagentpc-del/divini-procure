/**
 * Phase 1 P1-14: verifies every new Phase 1 financial table shipped with
 * row-level security ENABLED and FORCED, not "secured later" - the Phase 1
 * instruction's explicit requirement (section 39: "No Phase 1 financial
 * table should be added and secured later"). This is a direct database-
 * catalog check (pg_class.relrowsecurity / relforcerowsecurity), not a
 * behavioral proxy - a table could pass a behavioral allow/deny test by
 * accident of query structure even with RLS off if every route happened to
 * filter correctly in application code, so this checks the actual database
 * guarantee directly. Every one of these tables ALSO has its own dedicated
 * allow/deny integration coverage in the test file for the feature that
 * introduced it (budget-ledgers, awards, invoices, payments, agreement-po-
 * link, bid-revisions) - this file is a coverage backstop, not a
 * replacement for those behavioral tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";

let server: TestServer;

test.before(async () => {
  server = await startTestServer();
});

test.after(async () => {
  await server.close();
});

const PHASE1_TABLES = [
  "building_budget_revisions",
  "package_allowance_revisions",
  "awards",
  "invoices",
  "invoice_line_items",
  "external_payment_records",
];

test("Phase 1 P1-14: every new financial table has row-level security enabled AND forced", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");

  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relname = any($1) and relkind = 'r'`,
      [PHASE1_TABLES],
    ),
  );

  const found = new Map(rows.map((r) => [r.relname, r]));
  for (const table of PHASE1_TABLES) {
    const row = found.get(table);
    assert.ok(row, `table ${table} not found in pg_class - migration may not have run`);
    assert.equal(row!.relrowsecurity, true, `${table}: row level security is not ENABLED`);
    assert.equal(row!.relforcerowsecurity, true, `${table}: row level security is not FORCED (owner/superuser could bypass it)`);
  }
});

test("Phase 1 P1-14: every new financial table has at least one real RLS policy defined (not just enabled with zero policies, which denies everyone)", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");

  const rows = await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q<{ tablename: string; count: number }>(
      `select tablename, count(*)::int as count from pg_policies
        where tablename = any($1) group by tablename`,
      [PHASE1_TABLES],
    ),
  );
  const found = new Map(rows.map((r) => [r.tablename, Number(r.count)]));
  for (const table of PHASE1_TABLES) {
    assert.ok((found.get(table) ?? 0) > 0, `table ${table} has RLS enabled but zero policies defined`);
  }
});
