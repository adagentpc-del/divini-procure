/**
 * Divini Procure - Phase 1 P1-10: Invoices / Payment Applications.
 * Self-pathed under /api (mounted with router.use(invoicesRouter), no prefix).
 *
 * The minimum durable invoice model the Phase 1 instruction requires - NOT
 * accounting. An invoice links to the exact commitment it draws against
 * (project/package/PO/vendor/developer) and moves through an explicit
 * review lifecycle: draft -> submitted -> under_review -> approved |
 * rejected -> void. 'partially_paid'/'paid' are system-derived by
 * routes/payments.ts (P1-11) when a payment is recorded against an
 * invoice - never settable via this file's status PATCH.
 *
 * Authorization: either party (developer or vendor) may create/read an
 * invoice; only the DEVELOPER (or admin) may approve/reject/void it - the
 * same "developer decides, vendor requests" shape as change orders.
 *
 * Endpoints (all requireUser):
 *   GET   /invoices?buildingId=|packageId=|purchaseOrderId=  -> { invoices: [...] }
 *   GET   /invoices/:id                                       -> { invoice, lineItems }
 *   POST  /invoices                                           -> { invoice, overCommitment }
 *   PATCH /invoices/:id/status                                -> { invoice }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1, withTransaction } from "../pool.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { isMemberOfCompany, buildingDeveloperCompany } from "../lib/financial-auth.js";
import { netPayableCents, isOverCommitment, sumApprovedChangeOrders, num } from "../lib/financial-model.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "partially_paid",
  "paid",
  "void",
] as const;
type InvoiceStatus = (typeof STATUSES)[number];

// System-derived statuses - never directly settable via PATCH /status; only
// routes/payments.ts (P1-11) may move an invoice into these.
const SYSTEM_ONLY_STATUSES = new Set(["partially_paid", "paid"]);

// Legal developer-driven transitions.
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["submitted", "void"],
  submitted: ["under_review", "approved", "rejected", "void"],
  under_review: ["approved", "rejected", "void"],
  approved: ["void"],
  rejected: ["void"],
  partially_paid: ["void"],
  paid: [],
  void: [],
};

/** original_amount_cents (locked at award) + net signed sum of approved change orders. */
async function revisedCommitmentForPo(poId: string): Promise<number> {
  const po = await q1<{ original_amount_cents: number | null }>(
    `select original_amount_cents from purchase_orders where id = $1`,
    [poId],
  );
  if (!po) return 0;
  const cos = await q<{ cost_impact_cents: number | null }>(
    `select cost_impact_cents from change_orders where purchase_order_id = $1 and status = 'approved'`,
    [poId],
  );
  const delta = sumApprovedChangeOrders(cos.map((c) => c.cost_impact_cents));
  return num(po.original_amount_cents) + delta;
}

/** Sum of gross_amount_cents for every non-void invoice against a PO, optionally excluding one invoice (for a re-check on edit). */
async function cumulativeInvoicedGrossCents(poId: string, excludeInvoiceId?: string): Promise<number> {
  const rows = await q<{ sum: number | null }>(
    excludeInvoiceId
      ? `select coalesce(sum(gross_amount_cents),0) as sum from invoices where purchase_order_id = $1 and status != 'void' and id != $2`
      : `select coalesce(sum(gross_amount_cents),0) as sum from invoices where purchase_order_id = $1 and status != 'void'`,
    excludeInvoiceId ? [poId, excludeInvoiceId] : [poId],
  );
  return num(rows[0]?.sum);
}

async function role(
  userId: string,
  isAdmin: boolean,
  developerCompanyId: string,
  vendorCompanyId: string,
): Promise<"developer" | "vendor" | "admin" | null> {
  if (isAdmin) return "admin";
  if (await isMemberOfCompany(userId, developerCompanyId)) return "developer";
  if (await isMemberOfCompany(userId, vendorCompanyId)) return "vendor";
  return null;
}

// ---- GET /invoices?buildingId=|packageId=|purchaseOrderId= ------------------
router.get(
  "/invoices",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const buildingId = req.query.buildingId ? String(req.query.buildingId) : null;
    const packageId = req.query.packageId ? String(req.query.packageId) : null;
    const purchaseOrderId = req.query.purchaseOrderId ? String(req.query.purchaseOrderId) : null;
    if (!buildingId && !packageId && !purchaseOrderId) {
      return res.status(400).json({ error: "buildingId, packageId, or purchaseOrderId required" });
    }

    const where: string[] = [];
    const params: unknown[] = [];
    if (buildingId) { params.push(buildingId); where.push(`building_id = $${params.length}`); }
    if (packageId) { params.push(packageId); where.push(`package_id = $${params.length}`); }
    if (purchaseOrderId) { params.push(purchaseOrderId); where.push(`purchase_order_id = $${params.length}`); }

    // RLS already restricts rows to the caller's own developer/vendor
    // relationship (or admin); this just filters within what they can see.
    const invoices = await q<any>(
      `select * from invoices where ${where.join(" and ")} order by created_at desc`,
      params,
    );
    res.json({ invoices });
  }),
);

// ---- GET /invoices/:id -------------------------------------------------------
router.get(
  "/invoices/:id",
  requireUser,
  h(async (req, res) => {
    const invoice = await q1<any>(`select * from invoices where id = $1`, [req.params.id]);
    if (!invoice) throw new NotFoundError("invoice not found");
    const lineItems = await q<any>(
      `select * from invoice_line_items where invoice_id = $1 order by sort_order, id`,
      [invoice.id],
    );
    res.json({ invoice, lineItems });
  }),
);

// ---- POST /invoices -----------------------------------------------------------
router.post(
  "/invoices",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const buildingId = body.buildingId ? String(body.buildingId) : "";
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    const vendorCompanyId = body.vendorCompanyId ? String(body.vendorCompanyId) : "";
    if (!vendorCompanyId) return res.status(400).json({ error: "vendorCompanyId required" });

    const devCompany = await buildingDeveloperCompany(buildingId);
    if (!devCompany) throw new NotFoundError("project not found");
    const who = await role(auth.userId!, auth.isAdmin, devCompany, vendorCompanyId);
    if (!who) throw new ForbiddenError("not a party to this project/vendor relationship");

    const grossAmountCents = Math.round(Number(body.grossAmountCents));
    if (!Number.isFinite(grossAmountCents) || grossAmountCents < 0) {
      return res.status(400).json({ error: "grossAmountCents required (nonnegative integer cents)" });
    }

    const purchaseOrderId = body.purchaseOrderId ? String(body.purchaseOrderId) : null;
    let packageId = body.packageId ? String(body.packageId) : null;
    if (purchaseOrderId) {
      // #25 validation: the invoice must actually reference a PO belonging
      // to the SAME vendor/developer pair - never let a vendor invoice
      // against someone else's PO, or a developer misattribute one.
      const po = await q1<any>(`select * from purchase_orders where id = $1`, [purchaseOrderId]);
      if (!po) throw new NotFoundError("purchase order not found");
      if (po.vendor_company_id !== vendorCompanyId || po.developer_company_id !== devCompany) {
        return res
          .status(400)
          .json({ error: "this purchase order does not belong to the specified vendor/developer pair" });
      }
      packageId = packageId ?? po.package_id ?? null;
    }

    let retainageCents = Number.isFinite(Number(body.retainageCents))
      ? Math.round(Number(body.retainageCents))
      : null;
    if (retainageCents == null && purchaseOrderId) {
      const rr = await q1<{ retainage_pct: number | null }>(
        `select retainage_pct from retainage_records where purchase_order_id = $1 order by created_at desc limit 1`,
        [purchaseOrderId],
      );
      retainageCents = rr?.retainage_pct != null
        ? Math.round((grossAmountCents * Number(rr.retainage_pct)) / 100)
        : 0;
    }
    retainageCents = retainageCents ?? 0;

    let overCommitment = false;
    if (purchaseOrderId) {
      const revised = await revisedCommitmentForPo(purchaseOrderId);
      const cumulative = (await cumulativeInvoicedGrossCents(purchaseOrderId)) + grossAmountCents;
      overCommitment = isOverCommitment(cumulative, revised);
    }

    const isDraft = body.draft === true;
    const status: InvoiceStatus = isDraft ? "draft" : "submitted";

    const invoice = await q1<any>(
      `insert into invoices
         (building_id, package_id, purchase_order_id, vendor_company_id, developer_company_id,
          invoice_number, invoice_date, period_start, period_end,
          gross_amount_cents, retainage_cents, status, over_commitment, file_url, notes,
          submitted_by, submitted_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       returning *`,
      [
        buildingId,
        packageId,
        purchaseOrderId,
        vendorCompanyId,
        devCompany,
        body.invoiceNumber ? String(body.invoiceNumber) : null,
        body.invoiceDate ? String(body.invoiceDate) : null,
        body.periodStart ? String(body.periodStart) : null,
        body.periodEnd ? String(body.periodEnd) : null,
        grossAmountCents,
        retainageCents,
        status,
        overCommitment,
        body.fileUrl ? String(body.fileUrl) : null,
        body.notes ? String(body.notes) : null,
        isDraft ? null : (auth.email ?? auth.userId),
        isDraft ? null : new Date(),
        auth.userId,
      ],
    );

    if (Array.isArray(body.lineItems)) {
      let sortOrder = 0;
      for (const raw of body.lineItems as Array<Record<string, unknown>>) {
        const amountCents = Math.round(Number(raw.amountCents));
        if (!Number.isFinite(amountCents)) continue;
        await q(
          `insert into invoice_line_items
             (invoice_id, package_line_item_id, description, cost_code, qty, unit, amount_cents, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            invoice.id,
            raw.packageLineItemId ? String(raw.packageLineItemId) : null,
            raw.description ? String(raw.description) : null,
            raw.costCode ? String(raw.costCode) : null,
            raw.qty != null && Number.isFinite(Number(raw.qty)) ? Number(raw.qty) : null,
            raw.unit ? String(raw.unit) : null,
            amountCents,
            sortOrder++,
          ],
        );
      }
    }

    res.status(201).json({ invoice, overCommitment });
  }),
);

// ---- PATCH /invoices/:id/status -----------------------------------------------
// {status, rejectedReason?, approvedAmountCents?} - developer (or admin) only
// for approve/reject; either party may void their own draft/submitted
// invoice. System-derived statuses (partially_paid/paid) are rejected here.
router.patch(
  "/invoices/:id/status",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const toStatus = req.body?.status;
    if (typeof toStatus !== "string" || !STATUSES.includes(toStatus as InvoiceStatus)) {
      return res.status(400).json({ error: "valid status required" });
    }
    if (SYSTEM_ONLY_STATUSES.has(toStatus)) {
      return res
        .status(400)
        .json({ error: `${toStatus} is set automatically when a payment is recorded, not via this endpoint` });
    }

    const result = await withTransaction(async (tx) => {
      const invoice = await tx.q1<any>(`select * from invoices where id = $1`, [req.params.id]);
      if (!invoice) throw new NotFoundError("invoice not found");

      const who = await role(auth.userId!, auth.isAdmin, invoice.developer_company_id, invoice.vendor_company_id);
      if (!who) throw new ForbiddenError("not a party to this invoice");

      const allowed = TRANSITIONS[invoice.status as InvoiceStatus] ?? [];
      if (invoice.status !== toStatus && !allowed.includes(toStatus as InvoiceStatus)) {
        throw new ValidationError(`cannot move from ${invoice.status} to ${toStatus}`);
      }
      // Approve/reject/under_review are developer decisions; a vendor may
      // only submit its own invoice or void it before a decision is made.
      const developerOnly = new Set(["under_review", "approved", "rejected"]);
      if (who === "vendor" && developerOnly.has(toStatus)) {
        throw new ForbiddenError("only the developer may approve, reject, or move this invoice under review");
      }

      const sets: string[] = ["status = $2", "updated_at = now()"];
      const params: unknown[] = [invoice.id, toStatus];
      if (toStatus === "submitted" && !invoice.submitted_at) {
        sets.push(`submitted_by = $${params.length + 1}`, `submitted_at = now()`);
        params.push(auth.email ?? auth.userId);
      }
      if (toStatus === "approved") {
        const approvedAmountRaw = req.body?.approvedAmountCents;
        const approvedAmountCents =
          approvedAmountRaw != null && approvedAmountRaw !== ""
            ? Math.round(Number(approvedAmountRaw))
            : invoice.gross_amount_cents;
        if (!Number.isFinite(approvedAmountCents)) {
          throw new ValidationError("approvedAmountCents must be a number");
        }
        const netPayable = netPayableCents(approvedAmountCents, invoice.retainage_cents);
        sets.push(`approved_amount_cents = $${params.length + 1}`);
        params.push(approvedAmountCents);
        sets.push(`net_payable_cents = $${params.length + 1}`);
        params.push(netPayable);
        sets.push(`approved_by = $${params.length + 1}`, `approved_at = now()`);
        params.push(auth.email ?? auth.userId);
      }
      if (toStatus === "rejected" && req.body?.rejectedReason) {
        sets.push(`rejected_reason = $${params.length + 1}`);
        params.push(String(req.body.rejectedReason));
      }

      // CAS: guard against two concurrent decisions on the same invoice.
      const updated = await tx.q1<any>(
        `update invoices set ${sets.join(", ")} where id = $1 and status = $${params.length + 1} returning *`,
        [...params, invoice.status],
      );
      if (!updated) {
        throw new ValidationError("this invoice's status was already changed by a concurrent request");
      }
      return updated;
    });

    res.json({ invoice: result });
  }),
);

export default router;
