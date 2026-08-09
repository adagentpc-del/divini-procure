/**
 * Regression coverage for the Phase 0 financial-integrity fix: two
 * independent referral-commission rails (partner_commissions/partner_payouts
 * bookkeeping ledger, and payout_instructions real Stripe Connect rail)
 * could both pay out the same underlying commission with no shared identity
 * or cross-check. Fixed via partner_commissions.platform_revenue_id (unique,
 * linking to the same platform_revenue row payout_instructions.
 * source_revenue_id already references) plus guards at both "mark paid"
 * call sites. See db/schema-referral-commission-dedup.sql.
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

async function seedCommissionAndRevenue(
  q: any,
  q1: any,
  developerCompanyId: string,
  payoutInstructionStatus: 'pending' | 'paid',
) {
  const partner = await q1(
    `insert into referral_partners (name, referral_code, commission_type, revenue_share_pct, status)
     values ('Test Partner', $1, 'percent', 10, 'active') returning id`,
    [`test-code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  const revenue = await q1(
    `insert into platform_revenue (source_type, developer_company_id, base_cents, fee_cents, status)
     values ('procurement_fee', $1, 100000, 5000, 'collected') returning id`,
    [developerCompanyId],
  );
  const commission = await q1(
    `insert into partner_commissions
       (partner_id, referred_company_id, source, platform_fee_cents, net_profit_cents, commission_cents, status, platform_revenue_id)
     values ($1, $2, 'transaction', 5000, 5000, 500, 'pending', $3) returning id`,
    [partner.id, developerCompanyId, revenue.id],
  );
  const instruction = await q1(
    `insert into payout_instructions
       (source_revenue_id, recipient_kind, recipient_referral_partner_id, basis_cents, amount_cents, status)
     values ($1, 'referral_partner', $2, 5000, 500, $3) returning id`,
    [revenue.id, partner.id, payoutInstructionStatus],
  );
  return { partnerId: partner.id, revenueId: revenue.id, commissionId: commission.id, instructionId: instruction.id };
}

test("referral commission: marking paid via the bookkeeping ledger is refused once Stripe already paid it", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const owner = await registerVerifiedUser(server.baseUrl, "dblpay-owner-a");
  process.env.ADMIN_ALLOWED_EMAILS = owner.email;
  try {
    const devCo = await createCompany(owner.client, "buyer", "Dbl Payout Dev Co A");
    const seeded = await seedCommissionAndRevenue(q, q1, devCo.id, "paid");

    const attempt = await owner.client.patch(`/api/admin/partner-rev/commissions/${seeded.commissionId}`, {
      status: "paid",
    });
    assert.equal(attempt.status, 409, JSON.stringify(attempt.body));

    const check = await q1(`select status from partner_commissions where id = $1`, [seeded.commissionId]);
    assert.equal(check.status, "pending");
  } finally {
    delete process.env.ADMIN_ALLOWED_EMAILS;
  }
});

test("referral commission: marking paid via the bookkeeping ledger succeeds when Stripe has not paid it", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const owner = await registerVerifiedUser(server.baseUrl, "dblpay-owner-b");
  process.env.ADMIN_ALLOWED_EMAILS = owner.email;
  try {
    const devCo = await createCompany(owner.client, "buyer", "Dbl Payout Dev Co B");
    const seeded = await seedCommissionAndRevenue(q, q1, devCo.id, "pending");

    const attempt = await owner.client.patch(`/api/admin/partner-rev/commissions/${seeded.commissionId}`, {
      status: "paid",
    });
    assert.equal(attempt.status, 200, JSON.stringify(attempt.body));
    assert.equal(attempt.body.commission.status, "paid");
  } finally {
    delete process.env.ADMIN_ALLOWED_EMAILS;
  }
});

test("referral commission: Stripe release is refused once the bookkeeping ledger already marked it paid", async () => {
  const { q, q1 } = await import("../../server/dist/pool.js");
  const owner = await registerVerifiedUser(server.baseUrl, "dblpay-owner-c");
  process.env.ADMIN_ALLOWED_EMAILS = owner.email;
  try {
    const devCo = await createCompany(owner.client, "buyer", "Dbl Payout Dev Co C");
    const seeded = await seedCommissionAndRevenue(q, q1, devCo.id, "pending");
    await q(`update partner_commissions set status = 'paid' where id = $1`, [seeded.commissionId]);

    const attempt = await owner.client.post(`/api/admin/payouts/${seeded.instructionId}/release`, {});
    assert.equal(attempt.status, 409, JSON.stringify(attempt.body));

    const check = await q1(`select status from payout_instructions where id = $1`, [seeded.instructionId]);
    assert.equal(check.status, "pending");
  } finally {
    delete process.env.ADMIN_ALLOWED_EMAILS;
  }
});

test("referral commission: maybeRecordReferralCommission is idempotent for the same platform_revenue event", async () => {
  const { q1 } = await import("../../server/dist/pool.js");
  const monetization = await import("../../server/dist/lib/monetization.js");
  const owner = await registerVerifiedUser(server.baseUrl, "dblpay-owner-d");
  const devCo = await createCompany(owner.client, "buyer", "Dbl Payout Dev Co D");

  // Direct company-link attribution is simplest for this test: point a
  // partner directly at the developer company.
  await q1<{ id: string }>(
    `insert into referral_partners (name, referral_code, commission_type, revenue_share_pct, status, company_id)
     values ('Idempotent Partner Linked', $1, 'percent', 10, 'active', $2) returning id`,
    [`idem-linked-${Date.now()}`, devCo.id],
  );
  const revenue = await q1<{ id: string }>(
    `insert into platform_revenue (source_type, developer_company_id, base_cents, fee_cents, status)
     values ('procurement_fee', $1, 100000, 5000, 'collected') returning id`,
    [devCo.id],
  );

  const first = await monetization.maybeRecordReferralCommission({
    referredCompanyId: devCo.id,
    platformFeeCents: 5000,
    source: "transaction",
    platformRevenueId: revenue.id,
  });
  assert.equal(first.created, true);

  const second = await monetization.maybeRecordReferralCommission({
    referredCompanyId: devCo.id,
    platformFeeCents: 5000,
    source: "transaction",
    platformRevenueId: revenue.id,
  });
  assert.equal(second.created, false);
  assert.equal(second.reason, "already_recorded");

  const { q } = await import("../../server/dist/pool.js");
  const count = await q(`select id from partner_commissions where platform_revenue_id = $1`, [revenue.id]);
  assert.equal(count.length, 1);
});
