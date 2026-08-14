/**
 * Divini Procure - bidirectional payment-behavior reputation (competitive
 * gap #13, docs/competitive-analysis-2026-08.md): "developer/GC payment-
 * behavior transparency... Levelset's 'payment profiles' (which GCs pay
 * late)". Facts only, never a score - same explicit rule as
 * lib/vendor-signals.ts and lib/prequalification.ts.
 *
 * There is no contractual "payment due date" field anywhere in the schema
 * (no Net-30/Net-60 terms are captured), so this deliberately does not
 * claim to measure lateness against a due date. Instead it reports the
 * real, honest thing the platform actually knows: how long it took, in
 * calendar days, from a vendor submitting an invoice to that invoice
 * being paid (external_payment_records.paid_date, the most recent payment
 * record per invoice - an invoice can be paid in more than one
 * installment). This is exactly the kind of "clean, factual per-node
 * feature" lib/vendor-signals.ts already establishes as this codebase's
 * convention for reputation data: a count/date pulled directly from a
 * canonical table, no weighting, no model.
 *
 * Deliberately public to any authenticated user (no relationship or
 * company-membership gate) - unlike vendor prequalification (a developer
 * screening ONE vendor they already have a relationship with), payment
 * reputation exists specifically so a vendor can evaluate a developer
 * BEFORE any relationship exists, the same way coi_requirements is
 * public-read ("a vendor must be able to see the insurance bar before
 * bidding" - schema-rls-high-risk.sql). Only aggregate statistics are
 * returned, never a specific vendor's invoice amounts or identity, so no
 * individual vendor's payment history is exposed.
 *
 * invoices RLS restricts SELECT to the two parties on each row (see
 * schema-invoices.sql) - correctly so, since a raw invoice row carries a
 * dollar amount and a specific vendor's identity. Making that public would
 * leak real financial data platform-wide. Instead this query runs under
 * runAsAdmin() (see lib/requestContext.ts's own docstring: "already fully
 * authorized by something upstream") because the SELECT list below never
 * requests amount_cents, vendor_company_id, or any other identifying
 * column - only a computed day-count - so there is nothing sensitive for
 * the admin escalation to expose. The authorization decision this
 * bypasses is "who may see one raw invoice," which is not the decision
 * being made here; "who may see this developer's aggregate payment
 * timing" is a decision this module makes deliberately, in the open.
 */
import { q } from "../pool.js";
import { runAsAdmin } from "./requestContext.js";

export interface PaymentReputationSnapshot {
  developerCompanyId: string;
  paidInvoiceCount: number;
  averageDaysToPayment: number | null;
  fastestDaysToPayment: number | null;
  slowestDaysToPayment: number | null;
  within30DaysCount: number;
  within60DaysCount: number;
  over60DaysCount: number;
}

export async function computePaymentReputation(developerCompanyId: string): Promise<PaymentReputationSnapshot> {
  const rows = await runAsAdmin(() =>
    q<{ days: number }>(
      `select extract(day from (pay.max_paid_date::timestamptz - coalesce(i.submitted_at, i.invoice_date::timestamptz)))::int as days
         from invoices i
         join lateral (
           select max(paid_date) as max_paid_date
             from external_payment_records epr
            where epr.invoice_id = i.id
         ) pay on pay.max_paid_date is not null
        where i.developer_company_id = $1
          and i.status in ('paid', 'partially_paid')
          and coalesce(i.submitted_at, i.invoice_date::timestamptz) is not null`,
      [developerCompanyId],
    ),
  );

  const days = rows.map((r) => Number(r.days)).filter((d) => Number.isFinite(d) && d >= 0);
  const paidInvoiceCount = days.length;

  if (paidInvoiceCount === 0) {
    return {
      developerCompanyId,
      paidInvoiceCount: 0,
      averageDaysToPayment: null,
      fastestDaysToPayment: null,
      slowestDaysToPayment: null,
      within30DaysCount: 0,
      within60DaysCount: 0,
      over60DaysCount: 0,
    };
  }

  const sum = days.reduce((s, d) => s + d, 0);

  return {
    developerCompanyId,
    paidInvoiceCount,
    averageDaysToPayment: Math.round((sum / paidInvoiceCount) * 10) / 10,
    fastestDaysToPayment: Math.min(...days),
    slowestDaysToPayment: Math.max(...days),
    within30DaysCount: days.filter((d) => d <= 30).length,
    within60DaysCount: days.filter((d) => d > 30 && d <= 60).length,
    over60DaysCount: days.filter((d) => d > 60).length,
  };
}
