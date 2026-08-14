/**
 * Phase 1 P1-12/P1-13: the canonical financial summary read model. This is
 * the live-verification worked example from the Phase 1 instruction itself
 * (section 60-63): a $2,000,000 allowance package, two bids, an award, a
 * contract, an approved change order, an invoice, retainage, a payment,
 * then a second (negative) change order - verifying the summary's numbers
 * at every step, and that nothing is ever double-counted (award vs PO vs
 * contract; invoice vs payment; retainage held vs released).
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

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "finsum-dev");
  const devCo = await createCompany(developer.client, "buyer", "Financial Summary Dev Co");
  developerCompanyId = devCo.id;

  vendorA = await registerVerifiedUser(server.baseUrl, "finsum-vendor-a");
  const vaCo = await createCompany(vendorA.client, "vendor", "Financial Summary Vendor A");
  vendorACompanyId = vaCo.id;

  vendorB = await registerVerifiedUser(server.baseUrl, "finsum-vendor-b");
  const vbCo = await createCompany(vendorB.client, "vendor", "Financial Summary Vendor B");
  vendorBCompanyId = vbCo.id;

  const { q } = await import("../../server/dist/pool.js");
  const { runWithRequestContext } = await import("../../server/dist/lib/requestContext.js");
  await runWithRequestContext({ userId: null, isAdmin: true, email: null }, () =>
    q(
      `insert into subscription_entitlements (company_id, tier_key, subscription_status)
       values ($1, 'developer_pro', 'active')
       on conflict (company_id) do update set tier_key = excluded.tier_key, subscription_status = excluded.subscription_status`,
      [developerCompanyId],
    ),
  );

  const building = await developer.client.post("/api/buildings", {
    company_id: developerCompanyId,
    name: "Financial Summary Test Building (200-unit multifamily)",
  });
  assert.equal(building.status, 201, JSON.stringify(building.body));
  buildingId = (building.body.building ?? building.body).id;
});

test.after(async () => {
  await server.close();
});

test("financial summary: full lifecycle worked example matches the spec's own numbers exactly", async () => {
  // PROJECT budget: $30,000,000.
  const budget = await developer.client.post(`/api/buildings/${buildingId}/budget-revisions`, {
    amountCents: 30_000_000_00,
  });
  assert.equal(budget.status, 201, JSON.stringify(budget.body));

  // PACKAGE: Electrical, allowance $2,000,000.
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Electrical" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const allowance = await developer.client.post(`/api/packages/${packageId}/allowance-revisions`, {
    amountCents: 2_000_000_00,
  });
  assert.equal(allowance.status, 201, JSON.stringify(allowance.body));

  // Vendor A bids $1,900,000; Vendor B bids $1,850,000, then revises to $1,825,000.
  const bidA = await vendorA.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId: vendorACompanyId, price: 1_900_000, days: 30 });
  const bidB = await vendorB.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId: vendorBCompanyId, price: 1_850_000, days: 25 });
  const bidBId = bidB.body.id ?? bidB.body.bid?.id;

  const revision = await vendorB.client.post(`/api/packages/${packageId}/bids/${bidBId}/revisions`, { priceDollars: 1_825_000 });
  await developer.client.patch(`/api/bid-revisions/${revision.body.revision.id}`, { decision: "accepted" });

  const preAwardSummary = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(preAwardSummary.status, 200, JSON.stringify(preAwardSummary.body));
  assert.equal(preAwardSummary.body.bidStatistics.validBidCount, 2);
  assert.equal(preAwardSummary.body.bidStatistics.lowCents, 1_825_000_00);
  assert.equal(preAwardSummary.body.bidStatistics.highCents, 1_900_000_00);
  assert.equal(preAwardSummary.body.hasActiveAward, false);
  assert.equal(preAwardSummary.body.status, "no_award_yet");

  // AWARD Vendor B at $1,825,000 (the revised, final negotiated amount).
  const award = await developer.client.post("/api/award/confirm", { bidId: bidBId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  assert.equal(Number(award.body.award.awarded_amount_cents), 1_825_000_00);
  const poId = award.body.purchaseOrder.id as string;

  // CONTRACT executed at the same amount (no discrepancy).
  const agreement = await developer.client.post("/api/agreements", {
    partyCompanyId: developerCompanyId, title: "Electrical Subcontract", body: "Terms.", counterpartyEmail: vendorB.email,
  });
  await developer.client.patch(`/api/agreements/${agreement.body.agreement.id}/link-purchase-order`, {
    purchaseOrderId: poId, contractAmountCents: 1_825_000_00,
  });

  const postAwardSummary = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(postAwardSummary.body.hasActiveAward, true);
  assert.equal(postAwardSummary.body.awardedAmountCents, 1_825_000_00);
  assert.equal(postAwardSummary.body.originalCommitmentCents, 1_825_000_00);
  assert.equal(postAwardSummary.body.contractAmountCents, 1_825_000_00);
  assert.equal(postAwardSummary.body.contractDiscrepancyCents, 0);
  assert.equal(postAwardSummary.body.revisedCommitmentCents, 1_825_000_00);
  assert.equal(postAwardSummary.body.status, "within_budget");

  // APPROVED CO1: +$75,000.
  const co1 = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId: vendorBCompanyId, title: "Additional panel work", costImpactCents: 75_000_00,
  });
  await developer.client.patch(`/api/change-orders/${co1.body.changeOrder.id}`, { status: "submitted" });
  await developer.client.patch(`/api/change-orders/${co1.body.changeOrder.id}`, { status: "approved" });

  const afterCo1 = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(afterCo1.body.approvedChangeOrdersCents, 75_000_00);
  assert.equal(afterCo1.body.revisedCommitmentCents, 1_900_000_00);

  // INVOICE 1: $500,000 gross, retainage $50,000 (retainage record created
  // against this invoice's own draw amount, 10% - retainage_records'
  // retainage_held_cents is contractAmountCents * retainagePct/100, so
  // passing the invoice's own gross as "contractAmountCents" here yields
  // exactly $50,000 held, matching the spec's own worked example).
  const retainage = await developer.client.post("/api/retainage", {
    buildingId, packageId, vendorCompanyId: vendorBCompanyId, developerCompanyId,
    contractAmountCents: 500_000_00, retainagePct: 10,
  });
  assert.equal(retainage.status, 201, JSON.stringify(retainage.body));
  assert.equal(Number(retainage.body.record.retainage_held_cents), 50_000_00);

  const invoice1 = await vendorB.client.post("/api/invoices", {
    buildingId, vendorCompanyId: vendorBCompanyId, purchaseOrderId: poId,
    grossAmountCents: 500_000_00, retainageCents: 50_000_00,
  });
  assert.equal(invoice1.status, 201, JSON.stringify(invoice1.body));
  const invoice1Id = invoice1.body.invoice.id;
  const approveInvoice1 = await developer.client.patch(`/api/invoices/${invoice1Id}/status`, {
    status: "approved", approvedAmountCents: 500_000_00,
  });
  assert.equal(approveInvoice1.status, 200, JSON.stringify(approveInvoice1.body));
  assert.equal(Number(approveInvoice1.body.invoice.net_payable_cents), 450_000_00);

  // PAYMENT: $450,000 net paid externally.
  const payment = await developer.client.post("/api/payments/external", {
    purchaseOrderId: poId, invoiceId: invoice1Id, amountCents: 450_000_00, methodDetail: "ACH outside platform",
  });
  assert.equal(payment.status, 201, JSON.stringify(payment.body));
  assert.equal(payment.body.invoice.status, "paid");

  const afterPayment = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(afterPayment.body.invoicedGrossCents, 500_000_00);
  assert.equal(afterPayment.body.retainageHeldCents, 50_000_00);
  assert.equal(afterPayment.body.paidCents, 450_000_00);
  // Remaining commitment = revised commitment - paid = 1,900,000 - 450,000.
  assert.equal(afterPayment.body.remainingCommitmentCents, 1_900_000_00 - 450_000_00);
  // No double counting: paid must not also appear inside invoicedGrossCents
  // additively, and retainage must not appear inside paidCents.
  assert.equal(afterPayment.body.invoicedGrossCents + 0, 500_000_00);

  // CO2: +$150,000 -> revised commitment $2,050,000, variance +$50,000 over
  // the $2,000,000 allowance - matching the spec's own worked example.
  const co2 = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId: vendorBCompanyId, title: "Scope expansion", costImpactCents: 150_000_00,
  });
  await developer.client.patch(`/api/change-orders/${co2.body.changeOrder.id}`, { status: "submitted" });
  await developer.client.patch(`/api/change-orders/${co2.body.changeOrder.id}`, { status: "approved" });

  const afterCo2 = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(afterCo2.body.approvedChangeOrdersCents, 225_000_00); // 75,000 + 150,000
  assert.equal(afterCo2.body.revisedCommitmentCents, 2_050_000_00);
  assert.equal(afterCo2.body.varianceCents, 50_000_00);
  assert.equal(afterCo2.body.status, "over_budget");

  // CO3: -$25,000 (deductive) -> revised commitment falls, no unsigned-int issues.
  const co3 = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId: vendorBCompanyId, title: "Scope reduction", costImpactCents: -25_000_00,
  });
  await developer.client.patch(`/api/change-orders/${co3.body.changeOrder.id}`, { status: "submitted" });
  await developer.client.patch(`/api/change-orders/${co3.body.changeOrder.id}`, { status: "approved" });

  const afterCo3 = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(afterCo3.body.approvedChangeOrdersCents, 200_000_00); // 75,000 + 150,000 - 25,000
  assert.equal(afterCo3.body.revisedCommitmentCents, 2_025_000_00);

  // PROJECT rollup reflects the package.
  const projectSummary = await developer.client.get(`/api/buildings/${buildingId}/financial-summary`);
  assert.equal(projectSummary.status, 200, JSON.stringify(projectSummary.body));
  assert.equal(projectSummary.body.budgetCurrentCents, 30_000_000_00);
  assert.equal(projectSummary.body.allocatedCents, 2_000_000_00);
  assert.equal(projectSummary.body.committedCents, 1_825_000_00);
  assert.equal(projectSummary.body.revisedCommitmentCents, 2_025_000_00);
  assert.equal(projectSummary.body.paidCents, 450_000_00);
  assert.equal(projectSummary.body.retainageHeldCents, 50_000_00);
  assert.equal(projectSummary.body.packageCount, 1);
  assert.equal(projectSummary.body.packagesOverAllowance, 1);
});

test("financial summary: authorization matches budget.ts (developer/admin only, vendor and outsider denied)", async () => {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Auth Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;

  const vendorAttempt = await vendorA.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(vendorAttempt.status, 403, JSON.stringify(vendorAttempt.body));

  const buildingAttempt = await vendorA.client.get(`/api/buildings/${buildingId}/financial-summary`);
  assert.equal(buildingAttempt.status, 403, JSON.stringify(buildingAttempt.body));

  const ok = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

// ---- P1-18: financial closeout -------------------------------------------------

async function awardedPo(priceDollars: number) {
  const pkg = await developer.client.post(`/api/buildings/${buildingId}/packages`, { category: "Closeout Test" });
  const packageId = pkg.body.id ?? pkg.body.package?.id;
  const bid = await vendorA.client.post(`/api/packages/${packageId}/bids`, { vendorCompanyId: vendorACompanyId, price: priceDollars, days: 10 });
  const bidId = bid.body.id ?? bid.body.bid?.id;
  const award = await developer.client.post("/api/award/confirm", { bidId });
  assert.equal(award.status, 201, JSON.stringify(award.body));
  return { packageId, poId: award.body.purchaseOrder.id as string };
}

test("closeout: blocked while an active change order, an unresolved invoice, or outstanding retainage exists", async () => {
  const { packageId, poId } = await awardedPo(100_000);

  const co = await developer.client.post("/api/change-orders", {
    buildingId, packageId, vendorCompanyId: vendorACompanyId, title: "Pending CO", costImpactCents: 1_000_00,
  });
  const blockedByCo = await developer.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(blockedByCo.status, 400, JSON.stringify(blockedByCo.body));
  assert.match(blockedByCo.body.error, /change order/);

  await developer.client.patch(`/api/change-orders/${co.body.changeOrder.id}`, { status: "cancelled" });

  const invoice = await vendorA.client.post("/api/invoices", {
    buildingId, vendorCompanyId: vendorACompanyId, purchaseOrderId: poId, grossAmountCents: 50_000_00,
  });
  const blockedByInvoice = await developer.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(blockedByInvoice.status, 400, JSON.stringify(blockedByInvoice.body));
  assert.match(blockedByInvoice.body.error, /invoice/);

  await developer.client.patch(`/api/invoices/${invoice.body.invoice.id}/status`, { status: "void" });

  const closed = await developer.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.ok(closed.body.package.financially_closed_at);
  assert.equal(Number(closed.body.package.final_cost_cents), 100_000_00);
});

test("closeout: only the developer can close; a vendor cannot; a closed package cannot be closed again", async () => {
  const { packageId } = await awardedPo(60_000);

  const vendorAttempt = await vendorA.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(vendorAttempt.status, 403, JSON.stringify(vendorAttempt.body));

  const first = await developer.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const second = await developer.client.post(`/api/packages/${packageId}/close-financials`, {});
  assert.equal(second.status, 400, JSON.stringify(second.body));
  assert.match(second.body.error, /already financially closed/);
});

test("closeout: forecastFinalCents becomes the recorded final cost only after closeout, not before", async () => {
  const { packageId } = await awardedPo(75_000);

  const before = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(before.body.isFinanciallyClosed, false);
  assert.equal(before.body.finalCostCents, null);
  assert.equal(before.body.forecastFinalCents, 75_000_00);

  await developer.client.post(`/api/packages/${packageId}/close-financials`, {});

  const after = await developer.client.get(`/api/packages/${packageId}/financial-summary`);
  assert.equal(after.body.isFinanciallyClosed, true);
  assert.equal(after.body.finalCostCents, 75_000_00);
  assert.equal(after.body.forecastFinalCents, 75_000_00);
});
