/**
 * Platform hardening: GET /quotes/compare/:packageId used to call
 * getBidLineItems(bidId) once per active bid in a loop (a genuine N+1 -
 * unbounded with vendor participation on a package). Batched to 2 queries
 * total via getBidLineItemsByIds() (server/src/lib/bid-line-items.ts).
 *
 * This test exists specifically to catch the classic batching-refactor bug:
 * two bids' line items getting swapped/mixed when grouped by bid_id into a
 * Map. Seeds one STRUCTURED bid (bid_items, via package_line_items) and one
 * FREEFORM bid (bid_line_items, direct insert - no convenient one-call API
 * for a non-draft freeform bid) with deliberately different, distinctive
 * values, then asserts each bid's own line items and total in the
 * comparison response are exactly its own, never the other bid's.
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
let buildingId: string;
let packageId: string;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "qcbatch-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Quote Batching Dev Co")).id;

  vendorA = await registerVerifiedUser(server.baseUrl, "qcbatch-vendora");
  vendorACompanyId = (await createCompany(vendorA.client, "vendor", "Quote Batching Vendor A")).id;

  vendorB = await registerVerifiedUser(server.baseUrl, "qcbatch-vendorb");
  vendorBCompanyId = (await createCompany(vendorB.client, "vendor", "Quote Batching Vendor B")).id;

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Quote Batching Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Quote Batching Test" });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

test("quote comparison: structured and freeform line items across multiple bids are never swapped after batching", async () => {
  // Structured line item for vendor A's bid.
  const addLi = await developer.client.post(`/api/packages/${packageId}/line-items`, {
    description: "Panel upgrade", qty: 1, unit: "EA",
  });
  assert.equal(addLi.status, 201, JSON.stringify(addLi.body));
  const liList = await developer.client.get(`/api/packages/${packageId}/line-items`);
  const lineItemId = liList.body[0].id;

  const bidA = await vendorA.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorACompanyId,
    price: 5000,
    days: 10,
    items: [{ line_item_id: lineItemId, unit_price: 5000, qty: 1, amount: 5000 }],
  });
  assert.equal(bidA.status, 201, JSON.stringify(bidA.body));
  const bidAId = bidA.body.id ?? bidA.body.bid?.id;

  // Vendor B: no structured items, price only - then a freeform
  // bid_line_items row is inserted directly (no draft-only bid-studio path
  // applies to an already-submitted bid).
  const bidB = await vendorB.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: vendorBCompanyId,
    price: 8000,
    days: 20,
  });
  assert.equal(bidB.status, 201, JSON.stringify(bidB.body));
  const bidBId = bidB.body.id ?? bidB.body.bid?.id;

  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(
      `insert into bid_line_items (bid_id, name, qty, unit_price, sort_order)
       values ($1, 'Freeform wiring run', 2, 3500, 0)`,
      [bidBId],
    ),
  );

  const compare = await developer.client.get(`/api/quotes/compare/${packageId}`);
  assert.equal(compare.status, 200, JSON.stringify(compare.body));
  assert.equal(compare.body.bids.length, 2);

  const rowA = compare.body.bids.find((b: any) => b.id === String(bidAId));
  const rowB = compare.body.bids.find((b: any) => b.id === String(bidBId));
  assert.ok(rowA, "vendor A's bid must be present");
  assert.ok(rowB, "vendor B's bid must be present");

  // Vendor A: exactly its own structured line item, never vendor B's.
  assert.equal(rowA.line_items.length, 1);
  assert.equal(rowA.line_items[0].name, "Panel upgrade");
  assert.equal(rowA.line_items[0].amount_cents, 500000);
  assert.equal(rowA.total_cents, 500000, "bids.price ($5000) is the canonical total when set");

  // Vendor B: exactly its own freeform line item, never vendor A's.
  assert.equal(rowB.line_items.length, 1);
  assert.equal(rowB.line_items[0].name, "Freeform wiring run");
  assert.equal(rowB.line_items[0].amount_cents, 700000, "qty 2 * unit_price $3500 (dollars, pre-existing column convention) = $7000 -> 700000 cents");

  // No cross-contamination in either direction.
  assert.ok(!rowA.line_items.some((li: any) => li.name === "Freeform wiring run"));
  assert.ok(!rowB.line_items.some((li: any) => li.name === "Panel upgrade"));
});
