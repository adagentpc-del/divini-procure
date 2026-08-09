/**
 * Regression coverage for the Phase 0 relational-integrity fix:
 * purchase_orders.package_id/building_id/developer_company_id/
 * vendor_company_id and change_orders.vendor_company_id/
 * developer_company_id had no foreign key constraint at all, so a bug or
 * bad insert anywhere upstream could silently create a money record
 * pointing at a package/building/company that does not exist. This
 * verifies the new constraints are actually enforced by Postgres (not
 * just present in a migration file that never ran), and that deleting a
 * referenced row detaches the PO (ON DELETE SET NULL) instead of leaving
 * it dangling or destroying the financial record.
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
let buildingId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "fk-dev");
  const devCo = await createCompany(developer.client, "buyer", "FK Integrity Dev Co");
  developerCompanyId = devCo.id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "FK Integrity Test Building",
  });
  assert.equal(building.status, 201);
  buildingId = (building.body.building ?? building.body).id;

  vendor = await registerVerifiedUser(server.baseUrl, "fk-vendor");
  const vendorCo = await createCompany(vendor.client, "vendor", "FK Integrity Vendor Co");
  vendorCompanyId = vendorCo.id;
});

test.after(async () => {
  await server.close();
});

test("purchase_orders: a bogus package_id is rejected by the database, not just the app", async () => {
  const { q } = await import("../../server/dist/pool.js");
  await assert.rejects(
    () =>
      q(
        `insert into purchase_orders (package_id, building_id, developer_company_id, vendor_company_id, amount_cents, status)
         values ($1, $2, $3, $4, 100, 'issued')`,
        [
          "00000000-0000-0000-0000-000000000000",
          buildingId,
          developerCompanyId,
          vendorCompanyId,
        ],
      ),
    /foreign key constraint/i,
  );
});

test("purchase_orders: a bogus vendor_company_id is rejected by the database", async () => {
  const { q } = await import("../../server/dist/pool.js");
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "Plumbing",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  await assert.rejects(
    () =>
      q(
        `insert into purchase_orders (package_id, building_id, developer_company_id, vendor_company_id, amount_cents, status)
         values ($1, $2, $3, $4, 100, 'issued')`,
        [packageId, buildingId, developerCompanyId, "00000000-0000-0000-0000-000000000000"],
      ),
    /foreign key constraint/i,
  );
});

test("change_orders: a bogus developer_company_id is rejected by the database", async () => {
  const { q } = await import("../../server/dist/pool.js");
  await assert.rejects(
    () =>
      q(
        `insert into change_orders (building_id, package_id, vendor_company_id, developer_company_id, description, cost_impact_cents)
         values ($1, null, $2, $3, 'test change order', 100)`,
        [buildingId, vendorCompanyId, "00000000-0000-0000-0000-000000000000"],
      ),
    /foreign key constraint/i,
  );
});

test("purchase_orders: deleting the referenced package detaches the PO instead of leaving it dangling or destroying it", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "HVAC",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const bid = await vendor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId,
    price: 3000,
    days: 5,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  const poId = award.body.purchaseOrder.id as string;

  await q(`delete from packages where id = $1`, [packageId]);

  const po = await q1<{ package_id: string | null }>(
    `select package_id from purchase_orders where id = $1`,
    [poId],
  );
  assert.ok(po, "the purchase order itself must survive the package deletion");
  assert.equal(po!.package_id, null);
});
