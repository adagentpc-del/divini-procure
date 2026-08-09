/**
 * Divini Procure - Phase 1 P1-11: derive an invoice's paid/partially_paid
 * status from actual recorded payments (released platform authorizations +
 * external records), never from a developer's optimistic status change.
 * Called from both payment-recording paths (routes/payments.ts's external
 * record insert, and award-workflow.ts's payment-auth release) inside their
 * own withTransaction() so the invoice status update is atomic with the
 * payment write that triggered it.
 */
import type { TxQuery } from "../pool.js";
import { paidCents, num } from "./financial-model.js";

/**
 * Recompute and, if changed, persist an invoice's status based on actual
 * paid amount vs. its net_payable_cents. Only ever moves the invoice among
 * approved <-> partially_paid <-> paid - never touches draft/submitted/
 * under_review/rejected/void, which are developer/vendor workflow decisions
 * this function has no business overriding.
 */
export async function recomputeInvoicePaidStatus(tx: TxQuery, invoiceId: string): Promise<void> {
  const invoice = await tx.q1<any>(`select * from invoices where id = $1`, [invoiceId]);
  if (!invoice) return;
  const derivable = new Set(["approved", "partially_paid", "paid"]);
  if (!derivable.has(invoice.status) || invoice.net_payable_cents == null) return;

  const releasedRows = await tx.q<{ sum: number | null }>(
    `select coalesce(sum(amount_cents), 0) as sum from payment_authorizations where invoice_id = $1 and status = 'released'`,
    [invoiceId],
  );
  const externalRows = await tx.q<{ sum: number | null }>(
    `select coalesce(sum(amount_cents), 0) as sum from external_payment_records where invoice_id = $1`,
    [invoiceId],
  );
  const paid = paidCents(num(releasedRows[0]?.sum), num(externalRows[0]?.sum));
  const netPayable = num(invoice.net_payable_cents);

  let newStatus: string;
  if (paid <= 0) newStatus = "approved";
  else if (paid >= netPayable) newStatus = "paid";
  else newStatus = "partially_paid";

  if (newStatus !== invoice.status) {
    await tx.q(`update invoices set status = $2, updated_at = now() where id = $1`, [invoiceId, newStatus]);
  }
}
