/**
 * Divini Procure - Phase 1 P1-11: external (outside-the-platform) payment
 * recording. Self-pathed under /api (mounted with router.use(paymentsRouter),
 * no prefix).
 *
 * Divini Procure has no fund-movement rail for the developer-pays-vendor
 * leg (payment_authorizations has always been RECORD ONLY - see its own
 * schema header). This is NOT a payment processor and does not pretend to
 * be one: an external_payment_records row is the developer attesting that
 * money moved OUTSIDE the platform (e.g. "ACH outside platform", "Check
 * #1234") - never a claim that Divini processed it. Provenance stays
 * distinguishable everywhere this is read (lib/financial-model.ts's
 * paidCents() combinator takes the platform-released sum and the external
 * sum as two clearly separate inputs, never merged into one opaque number).
 *
 * Authorization: DEVELOPER only (or admin) may record an external payment -
 * a vendor cannot claim to have been paid. Both parties may read.
 *
 * Endpoints (all requireUser):
 *   POST /payments/external  -> { payment, invoice? }
 *   GET  /payments/external?purchaseOrderId=|invoiceId=  -> { payments: [...] }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, withTransaction } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import { isMemberOfCompany } from "../lib/financial-auth.js";
import { recomputeInvoicePaidStatus } from "../lib/invoice-status.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---- POST /payments/external ---------------------------------------------
// {purchaseOrderId, invoiceId?, amountCents, methodDetail?, paidDate?, notes?}
router.post(
  "/payments/external",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const purchaseOrderId = body.purchaseOrderId ? String(body.purchaseOrderId) : "";
    if (!purchaseOrderId) return res.status(400).json({ error: "purchaseOrderId required" });
    const amountCents = Math.round(Number(body.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "amountCents required (positive integer cents)" });
    }

    const result = await withTransaction(async (tx) => {
      const po = await tx.q1<any>(`select * from purchase_orders where id = $1`, [purchaseOrderId]);
      if (!po) throw new NotFoundError("purchase order not found");
      if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, po.developer_company_id))) {
        throw new ForbiddenError("only the developer may record an external payment");
      }

      const invoiceId = body.invoiceId ? String(body.invoiceId) : null;
      if (invoiceId) {
        const invoice = await tx.q1<any>(`select * from invoices where id = $1`, [invoiceId]);
        if (!invoice) throw new NotFoundError("invoice not found");
        if (invoice.purchase_order_id !== purchaseOrderId) {
          const err: any = new Error("this invoice does not belong to the specified purchase order");
          err.status = 400;
          throw err;
        }
      }

      const payment = await tx.q1<any>(
        `insert into external_payment_records
           (invoice_id, purchase_order_id, building_id, package_id, vendor_company_id,
            developer_company_id, amount_cents, method_detail, paid_date, recorded_by, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning *`,
        [
          invoiceId,
          purchaseOrderId,
          po.building_id,
          po.package_id,
          po.vendor_company_id,
          po.developer_company_id,
          amountCents,
          body.methodDetail ? String(body.methodDetail) : null,
          body.paidDate ? String(body.paidDate) : null,
          auth.email ?? auth.userId,
          body.notes ? String(body.notes) : null,
        ],
      );

      if (invoiceId) {
        await recomputeInvoicePaidStatus(tx, invoiceId);
      }
      const invoice = invoiceId ? await tx.q1<any>(`select * from invoices where id = $1`, [invoiceId]) : null;
      return { payment, invoice };
    });

    res.status(201).json(result);
  }),
);

// ---- GET /payments/external?purchaseOrderId=|invoiceId= -------------------
router.get(
  "/payments/external",
  requireUser,
  h(async (req, res) => {
    const purchaseOrderId = req.query.purchaseOrderId ? String(req.query.purchaseOrderId) : null;
    const invoiceId = req.query.invoiceId ? String(req.query.invoiceId) : null;
    if (!purchaseOrderId && !invoiceId) {
      return res.status(400).json({ error: "purchaseOrderId or invoiceId required" });
    }
    const payments = purchaseOrderId
      ? await q<any>(
          `select * from external_payment_records where purchase_order_id = $1 order by created_at desc`,
          [purchaseOrderId],
        )
      : await q<any>(
          `select * from external_payment_records where invoice_id = $1 order by created_at desc`,
          [invoiceId],
        );
    res.json({ payments });
  }),
);

export default router;
