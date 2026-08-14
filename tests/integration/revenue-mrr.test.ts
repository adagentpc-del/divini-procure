/**
 * Regression coverage for the Phase 0 fix to revenue.ts's admin monetization
 * summary: it queried a legacy `subscriptions` table using columns
 * (amount_cents, plan_key) that do not exist on it, silently caught by a
 * misleadingly-worded catch block, so proMrrCents/proSubscribers were
 * permanently 0 regardless of real subscriber state. Fixed to read from the
 * actual live tables (subscription_entitlements joined to
 * subscription_tiers). This test seeds a real active "pro" subscriber
 * (there is no test-friendly path through real Stripe checkout, so the
 * entitlement row is written directly via the db layer) and hits the real
 * GET /admin/monetization-summary endpoint as an admin, asserting the
 * response reflects it - not just that the call doesn't throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany } from "./helpers/client.ts";

let server: TestServer;

test.before(async () => {
  server = await startTestServer();
});

test.after(async () => {
  await server.close();
});

test("admin monetization summary: reflects a real active pro subscriber (previously hardcoded to $0 by a schema/query mismatch)", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");

  const owner = await registerVerifiedUser(server.baseUrl, "mrr-owner");
  const company = await createCompany(owner.client, "buyer", "MRR Test Co");

  const tier = await q1<{ price_cents: number }>(
    `select price_cents from subscription_tiers where key = 'developer_pro'`,
  );
  assert.ok(tier, "developer_pro tier must exist in seed data");
  assert.ok(tier!.price_cents > 0, "developer_pro must be a real paid tier");

  await q(
    `insert into subscription_entitlements (company_id, tier_key, subscription_status)
     values ($1, 'developer_pro', 'active')
     on conflict (company_id) do update set tier_key = excluded.tier_key, subscription_status = excluded.subscription_status`,
    [company.id],
  );

  // getAdminAllowedEmails() (config.ts) is evaluated fresh on every request,
  // so this grants the already-authenticated owner admin access for this
  // test without needing to reboot the server.
  process.env.ADMIN_ALLOWED_EMAILS = owner.email;
  try {
    const summary = await owner.client.get("/api/admin/monetization-summary");
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.ok(
      summary.body.proSubscribers >= 1,
      `expected at least 1 pro subscriber, got ${JSON.stringify(summary.body)}`,
    );
    assert.ok(
      summary.body.proMrrCents >= tier!.price_cents,
      `expected proMrrCents to include the seeded $${tier!.price_cents / 100} subscription, got ${JSON.stringify(summary.body)}`,
    );
  } finally {
    delete process.env.ADMIN_ALLOWED_EMAILS;
  }
});
