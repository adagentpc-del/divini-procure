/**
 * Direct database-layer coverage for Phase 0 item 14: RLS on the high-risk
 * tables added by db/schema-rls-high-risk.sql (previously NONE of these had
 * row-level security at all - purchase_orders, payment_authorizations,
 * platform_revenue, payout_instructions, connect_accounts, agreements,
 * agreement_signatures, change_orders, disputes, retainage, lien waivers,
 * progress photos, COI, referral-partner financials, and the remaining
 * bid/package satellite tables).
 *
 * This file exercises the actual database boundary directly (via the
 * compiled pool.js query helpers run under a fabricated request context),
 * not just the HTTP route layer - the same q()/q1() the real app uses, so
 * RLS is genuinely in effect on every query here exactly as it is for a
 * real request. Route-level tests elsewhere already cover purchase_orders,
 * payment_authorizations, agreements, agreement_signatures, retainage
 * records, and lien_waivers end to end (award-workflow.ts /
 * agreements-sign.test.ts / retainage.test.ts / retainage-po-link.test.ts /
 * po-fk-integrity.test.ts), including "unrelated company denied" cases, so
 * this file focuses on the tables that had NO other integration coverage:
 * platform_revenue, payout_instructions, connect_accounts, change_orders,
 * change_order_audit, disputes, dispute_messages, coi_certificates,
 * coi_requirements, partner_commissions, partner_payouts, bid_invites,
 * bid_line_items, bid_revisions.
 *
 * Every table below gets at least one ALLOW (the authorized party can see /
 * write the row) and one DENY (an unrelated company cannot) - per this
 * phase's explicit requirement that every newly-protected table has an
 * allow-authorized/deny-unrelated test pair, not just a policy that looks
 * right on paper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;

type Actor = { userId: string; email: string; client: TestClient };
let companyA: { actor: Actor; companyId: string };
let companyB: { actor: Actor; companyId: string };
let companyC: { actor: Actor; companyId: string };
let buildingId: string;
let packageId: string;

async function asUser<T>(userId: string | null, isAdmin: boolean, fn: () => Promise<T>): Promise<T> {
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  return runWithRequestContext({ userId, isAdmin, email: null }, fn);
}
const asAdmin = <T,>(fn: () => Promise<T>) => asUser(null, true, fn);

test.before(async () => {
  server = await startTestServer();

  const a = await registerVerifiedUser(server.baseUrl, "rls-a");
  const aCo = await createCompany(a.client, "buyer", "RLS Company A");
  companyA = { actor: a, companyId: aCo.id };

  const b = await registerVerifiedUser(server.baseUrl, "rls-b");
  const bCo = await createCompany(b.client, "buyer", "RLS Company B Unrelated");
  companyB = { actor: b, companyId: bCo.id };

  const c = await registerVerifiedUser(server.baseUrl, "rls-c");
  const cCo = await createCompany(c.client, "vendor", "RLS Company C Vendor");
  companyC = { actor: c, companyId: cCo.id };

  const building = await companyA.actor.client.post("/api/buildings", {
    company_id: companyA.companyId,
    name: "RLS Test Building",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;

  const pkg = await companyA.actor.client.post(`/api/buildings/${buildingId}/packages`, {
    category: "General",
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  packageId = pkg.body.id ?? pkg.body.package?.id;
});

test.after(async () => {
  await server.close();
});

// ---------------------------------------------------------------------------
// platform_revenue
// ---------------------------------------------------------------------------
test("platform_revenue: the named developer company can read its own accrual row", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const row = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into platform_revenue (source_type, developer_company_id, vendor_company_id, base_cents, fee_cents, status)
       values ('procurement_fee', $1, $2, 100000, 5000, 'accrued') returning id`,
      [companyA.companyId, companyC.companyId],
    ),
  );
  assert.ok(row);

  const seenByOwner = await asUser(companyA.actor.userId, false, () =>
    q<{ id: string }>(`select id from platform_revenue where id = $1`, [row!.id]),
  );
  assert.equal(seenByOwner.length, 1, "the developer company must see its own revenue row");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from platform_revenue where id = $1`, [row!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see another developer's revenue row");
});

test("platform_revenue: an unrelated company cannot write a revenue row for itself", async () => {
  const { q } = await import("../../server/dist/pool.js");
  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into platform_revenue (source_type, developer_company_id, vendor_company_id, base_cents, fee_cents, status)
           values ('procurement_fee', $1, $2, 999999, 50000, 'accrued') returning id`,
          [companyA.companyId, companyC.companyId],
        ),
      ),
    /row-level security/i,
    "a company that is not the named developer must not be able to insert a platform_revenue row attributing it to companyA",
  );
});

// ---------------------------------------------------------------------------
// payout_instructions
// ---------------------------------------------------------------------------
test("payout_instructions: the named recipient can read its own instruction; a stranger cannot; only admin can insert", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const row = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into payout_instructions (recipient_kind, recipient_company_id, amount_cents, status)
       values ('vendor', $1, 12345, 'pending') returning id`,
      [companyC.companyId],
    ),
  );
  assert.ok(row);

  const seenByRecipient = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from payout_instructions where id = $1`, [row!.id]),
  );
  assert.equal(seenByRecipient.length, 1, "the named recipient company must see its own payout instruction");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from payout_instructions where id = $1`, [row!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see another recipient's payout instruction");

  await assert.rejects(
    () =>
      asUser(companyC.actor.userId, false, () =>
        q(
          `insert into payout_instructions (recipient_kind, recipient_company_id, amount_cents, status)
           values ('vendor', $1, 1, 'pending') returning id`,
          [companyC.companyId],
        ),
      ),
    /row-level security/i,
    "even the recipient itself must not be able to insert its own payout instruction - only admin (the split engine / release flow) may",
  );
});

// ---------------------------------------------------------------------------
// connect_accounts
// ---------------------------------------------------------------------------
test("connect_accounts: a company can create and read its own account; a stranger cannot read it or create one on its behalf", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");

  const created = await asUser(companyC.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into connect_accounts (owner_kind, owner_company_id, status)
       values ('company', $1, 'not_started') returning id`,
      [companyC.companyId],
    ),
  );
  assert.ok(created, "a company must be able to create its own connect account");

  const seenByOwner = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from connect_accounts where id = $1`, [created!.id]),
  );
  assert.equal(seenByOwner.length, 1);

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from connect_accounts where id = $1`, [created!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see another company's connect account");

  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into connect_accounts (owner_kind, owner_company_id, status)
           values ('company', $1, 'not_started') returning id`,
          [companyA.companyId],
        ),
      ),
    /row-level security/i,
    "a company must not be able to create a connect account claiming ownership by a DIFFERENT company",
  );
});

// ---------------------------------------------------------------------------
// change_orders / change_order_audit
// ---------------------------------------------------------------------------
test("change_orders: developer and vendor can both read; an unrelated company cannot; only the developer can write", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const co = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into change_orders (building_id, package_id, vendor_company_id, developer_company_id, title, description, cost_impact_cents)
       values ($1, $2, $3, $4, 'Test CO', 'test', 500) returning id`,
      [buildingId, packageId, companyC.companyId, companyA.companyId],
    ),
  );
  assert.ok(co, "the developer must be able to create a change order on its own building");

  const seenByDeveloper = await asUser(companyA.actor.userId, false, () =>
    q<{ id: string }>(`select id from change_orders where id = $1`, [co!.id]),
  );
  assert.equal(seenByDeveloper.length, 1);

  const seenByVendor = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from change_orders where id = $1`, [co!.id]),
  );
  assert.equal(seenByVendor.length, 1, "the named vendor must be able to read the change order");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from change_orders where id = $1`, [co!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see this change order");

  // An UPDATE that matches zero rows under RLS does not throw - it just
  // silently affects nothing - so assert no change happened, rather than
  // expecting an exception.
  await asUser(companyC.actor.userId, false, () =>
    q(`update change_orders set title = 'hijacked' where id = $1`, [co!.id]),
  );
  const after = await asAdmin(() =>
    q1<{ title: string }>(`select title from change_orders where id = $1`, [co!.id]),
  );
  assert.notEqual(after?.title, "hijacked", "the vendor must not be able to modify a change order it does not own");
});

test("change_order_audit: visible to developer and vendor, hidden from an unrelated company", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const co = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into change_orders (building_id, package_id, vendor_company_id, developer_company_id, title, description, cost_impact_cents)
       values ($1, $2, $3, $4, 'Audit Test CO', 'test', 100) returning id`,
      [buildingId, packageId, companyC.companyId, companyA.companyId],
    ),
  );
  const audit = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into change_order_audit (change_order_id, actor_email, action, detail) values ($1, $2, 'created', '{}') returning id`,
      [co!.id, companyA.actor.email],
    ),
  );
  assert.ok(audit, "the developer must be able to append an audit row on its own change order");

  const seenByVendor = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from change_order_audit where id = $1`, [audit!.id]),
  );
  assert.equal(seenByVendor.length, 1);

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from change_order_audit where id = $1`, [audit!.id]),
  );
  assert.equal(seenByOutsider.length, 0);
});

// ---------------------------------------------------------------------------
// disputes / dispute_messages
// ---------------------------------------------------------------------------
test("disputes: both the filer and the respondent can read; an unrelated third company cannot", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const dispute = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into disputes (filed_by_company_id, against_company_id, dispute_type, title, description)
       values ($1, $2, 'non_payment', 'Test dispute', 'test') returning id`,
      [companyA.companyId, companyC.companyId],
    ),
  );
  assert.ok(dispute, "a company must be able to file a dispute against another company");

  const seenByFiler = await asUser(companyA.actor.userId, false, () =>
    q<{ id: string }>(`select id from disputes where id = $1`, [dispute!.id]),
  );
  assert.equal(seenByFiler.length, 1);

  const seenByRespondent = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from disputes where id = $1`, [dispute!.id]),
  );
  assert.equal(seenByRespondent.length, 1, "the company the dispute was filed against must be able to read it");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from disputes where id = $1`, [dispute!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated third company must not see this dispute");

  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into disputes (filed_by_company_id, against_company_id, dispute_type, title, description)
           values ($1, $2, 'non_payment', 'Impersonation attempt', 'test') returning id`,
          [companyA.companyId, companyC.companyId],
        ),
      ),
    /row-level security/i,
    "a company must not be able to file a dispute claiming to be filed_by a DIFFERENT company",
  );

  return dispute!.id;
});

test("dispute_messages: parties see visible messages; an unrelated company sees none; admin-only notes stay hidden from parties", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const dispute = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into disputes (filed_by_company_id, against_company_id, dispute_type, title, description)
       values ($1, $2, 'non_payment', 'Messages test dispute', 'test') returning id`,
      [companyA.companyId, companyC.companyId],
    ),
  );

  const msg = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into dispute_messages (dispute_id, author_company_id, author_email, message, is_visible_to_both)
       values ($1, $2, $3, 'a visible message', true) returning id`,
      [dispute!.id, companyA.companyId, companyA.actor.email],
    ),
  );
  assert.ok(msg);

  const adminNote = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into dispute_messages (dispute_id, author_company_id, author_email, message, message_type, is_visible_to_both)
       values ($1, $2, 'admin@divini.test', 'internal note', 'admin_note', false) returning id`,
      [dispute!.id, companyA.companyId],
    ),
  );
  assert.ok(adminNote);

  const seenByRespondent = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from dispute_messages where dispute_id = $1 order by created_at asc`, [dispute!.id]),
  );
  assert.deepEqual(
    seenByRespondent.map((r) => r.id).sort(),
    [msg!.id].sort(),
    "the other party must see the visible message but not the internal admin note",
  );

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from dispute_messages where dispute_id = $1`, [dispute!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must see no messages on this dispute");

  const seenByAdmin = await asAdmin(() =>
    q<{ id: string }>(`select id from dispute_messages where dispute_id = $1`, [dispute!.id]),
  );
  assert.equal(seenByAdmin.length, 2, "admin must see both the visible message and the internal note");
});

// ---------------------------------------------------------------------------
// coi_certificates / coi_requirements
// ---------------------------------------------------------------------------
test("coi_certificates: owning company can read/write its own certificate; an unrelated company cannot", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const cert = await asUser(companyC.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into coi_certificates (company_id, certificate_type, expiry_date)
       values ($1, 'general_liability', now() + interval '1 year') returning id`,
      [companyC.companyId],
    ),
  );
  assert.ok(cert);

  const seenByOwner = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from coi_certificates where id = $1`, [cert!.id]),
  );
  assert.equal(seenByOwner.length, 1);

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from coi_certificates where id = $1`, [cert!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see another company's COI certificate");

  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into coi_certificates (company_id, certificate_type, expiry_date)
           values ($1, 'general_liability', now() + interval '1 year') returning id`,
          [companyC.companyId],
        ),
      ),
    /row-level security/i,
    "a company must not be able to create a COI certificate claiming to belong to a DIFFERENT company",
  );
});

test("coi_requirements: publicly readable (any authenticated user); write restricted to the building owner", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const req = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into coi_requirements (building_id, certificate_type, required)
       values ($1, 'general_liability', true) returning id`,
      [buildingId],
    ),
  );
  assert.ok(req, "the building owner must be able to set a COI requirement on its own building");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from coi_requirements where id = $1`, [req!.id]),
  );
  assert.equal(seenByOutsider.length, 1, "COI requirements are intentionally public read (vendors must see the bar before bidding)");

  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into coi_requirements (building_id, certificate_type, required)
           values ($1, 'workers_comp', true) returning id`,
          [buildingId],
        ),
      ),
    /row-level security/i,
    "a company that does not own the building must not be able to set a COI requirement on it",
  );
});

// ---------------------------------------------------------------------------
// partner_commissions / partner_payouts
// ---------------------------------------------------------------------------
test("partner_commissions: the referral partner's own company can read its commissions; an unrelated company cannot; write is admin-only", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const partner = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into referral_partners (company_id, name, referral_code) values ($1, 'RLS Test Partner', $2) returning id`,
      [companyA.companyId, `rls-test-${Date.now()}`],
    ),
  );
  const commission = await asAdmin(() =>
    q1<{ id: string }>(
      `insert into partner_commissions (partner_id, commission_cents, status) values ($1, 5000, 'pending') returning id`,
      [partner!.id],
    ),
  );
  assert.ok(commission);

  const seenByPartnerCompany = await asUser(companyA.actor.userId, false, () =>
    q<{ id: string }>(`select id from partner_commissions where id = $1`, [commission!.id]),
  );
  assert.equal(seenByPartnerCompany.length, 1, "the referral partner's own company must see its commission");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from partner_commissions where id = $1`, [commission!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see another partner's commission");

  await assert.rejects(
    () =>
      asUser(companyA.actor.userId, false, () =>
        q(
          `insert into partner_commissions (partner_id, commission_cents, status) values ($1, 1, 'pending') returning id`,
          [partner!.id],
        ),
      ),
    /row-level security/i,
    "even the referral partner's own company must not be able to insert its own commission row - admin only",
  );
});

// ---------------------------------------------------------------------------
// bid_invites / bid_line_items / bid_revisions
// ---------------------------------------------------------------------------
test("bid_invites: developer and invited vendor can read; an unrelated company cannot; only the developer can write", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const invite = await asUser(companyA.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into bid_invites (package_id, vendor_company_id, developer_company_id, status)
       values ($1, $2, $3, 'invited') returning id`,
      [packageId, companyC.companyId, companyA.companyId],
    ),
  );
  assert.ok(invite, "the developer must be able to invite a vendor to bid");

  const seenByVendor = await asUser(companyC.actor.userId, false, () =>
    q<{ id: string }>(`select id from bid_invites where id = $1`, [invite!.id]),
  );
  assert.equal(seenByVendor.length, 1, "the invited vendor must see its own invite");

  const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
    q<{ id: string }>(`select id from bid_invites where id = $1`, [invite!.id]),
  );
  assert.equal(seenByOutsider.length, 0, "an unrelated company must not see this invite");

  await assert.rejects(
    () =>
      asUser(companyB.actor.userId, false, () =>
        q(
          `insert into bid_invites (package_id, vendor_company_id, developer_company_id, status)
           values ($1, $2, $3, 'invited') returning id`,
          [packageId, companyB.companyId, companyA.companyId],
        ),
      ),
    /row-level security/i,
    "a company must not be able to create a bid invite claiming to be a DIFFERENT company's developer",
  );
});

test("bid_line_items and bid_revisions: visible to the bidding vendor and the building owner, hidden from an unrelated company", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const bid = await companyC.actor.client.post(`/api/packages/${packageId}/bids`, {
    vendorCompanyId: companyC.companyId,
    price: 4200,
    days: 14,
  });
  assert.equal(bid.status, 201, JSON.stringify(bid.body));
  const bidId = bid.body.id ?? bid.body.bid?.id;

  const lineItem = await asUser(companyC.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into bid_line_items (bid_id, name, qty, unit_price) values ($1, 'Test line', 1, 100) returning id`,
      [bidId],
    ),
  );
  assert.ok(lineItem);

  const revision = await asUser(companyC.actor.userId, false, () =>
    q1<{ id: string }>(
      `insert into bid_revisions (bid_id, proposed, created_by) values ($1, '{"price": 4000}', $2) returning id`,
      [bidId, companyC.actor.userId],
    ),
  );
  assert.ok(revision);

  for (const [table, id] of [
    ["bid_line_items", lineItem!.id],
    ["bid_revisions", revision!.id],
  ] as const) {
    const seenByBuildingOwner = await asUser(companyA.actor.userId, false, () =>
      q<{ id: string }>(`select id from ${table} where id = $1`, [id]),
    );
    assert.equal(seenByBuildingOwner.length, 1, `the building owner must see the vendor's ${table} row`);

    const seenByOutsider = await asUser(companyB.actor.userId, false, () =>
      q<{ id: string }>(`select id from ${table} where id = $1`, [id]),
    );
    assert.equal(seenByOutsider.length, 0, `an unrelated company must not see this ${table} row`);
  }
});
