/**
 * Award-to-Procurement Workflow for Divini Procure. Mounted under /api/award in
 * routes.ts (the lead wires `router.use("/award", awardWorkflowRouter)`).
 *
 * After a bid is awarded, the DEVELOPER (the company that owns the package's
 * building) manages the procurement lifecycle that follows:
 *   1. award confirmation   -> mark the bid awarded + draft a purchase order
 *   2. purchase order        -> status draft -> issued -> acknowledged ->
 *                               in_production -> fulfilled (or cancelled)
 *   3. payment authorization -> RECORD ONLY. This system NEVER moves money.
 *                               Each row records an authorization/release for
 *                               audit purposes only.
 *   4. production/delivery/install -> referenced via the existing deliveries
 *                                     system (not rebuilt here).
 *   5. closeout + warranty documents -> award_documents rows on the PO.
 *
 * Authorization reuses Procure's existing primitives (mirrors the
 * userOwnsPackage() pattern in db.ts + submittals.ts / delivery.ts):
 *   - the DEVELOPER: a member of the company that owns the package's building.
 *   - the VENDOR: a member of the purchase order's vendor_company_id (read-only
 *     access to their own PO + its documents).
 *   - a super-admin (ADMIN_ALLOWED_EMAILS, via getAuth().isAdmin) is always
 *     allowed.
 *
 * bids.price is dollars (numeric); amount_cents = round(price * 100).
 *
 * Tables: purchase_orders + payment_authorizations + award_documents
 * (db/schema-award-workflow.sql). Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { resolveAndRecordFee, maybeRecordReferralCommission } from "../lib/monetization.js";
import { runAsAdmin } from "../lib/requestContext.js";
import { notifyCompanyMembers } from "../lib/notify.js";
import { enqueueJob } from "../lib/jobs.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---- purchase order lifecycle ----------------------------------------------
const PO_STATUSES = new Set([
  "draft",
  "issued",
  "acknowledged",
  "in_production",
  "fulfilled",
  "cancelled",
]);

// ---- payment authorization lifecycle (RECORD ONLY) -------------------------
const PAY_STATUSES = new Set(["pending", "authorized", "released", "void"]);

// ---- award document kinds --------------------------------------------------
const DOC_KINDS = new Set(["closeout", "warranty", "po", "other"]);

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

/**
 * True when the signed-in user is the developer that owns the package, i.e. a
 * member of the company that owns the package's building (mirrors db.ts
 * userOwnsPackage). Admins are handled by callers via getAuth().isAdmin.
 */
async function userOwnsPackage(userId: string, packageId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, userId],
  );
  return !!row;
}

/**
 * Authorize a purchase order for READ access: developer (package owner) OR a
 * member of the PO's vendor company OR admin. Returns the PO row when allowed,
 * else throws. Throws NotFoundError when the PO does not exist.
 */
async function authorizePoRead(req: Request, poId: string): Promise<any> {
  const auth = getAuth(req);
  const po = await q1<any>(`select * from purchase_orders where id = $1`, [poId]);
  if (!po) throw new NotFoundError("purchase order not found");
  if (auth.isAdmin) return po;
  if (po.developer_company_id && (await isMemberOfCompany(auth.userId!, po.developer_company_id))) {
    return po;
  }
  if (po.package_id && (await userOwnsPackage(auth.userId!, po.package_id))) return po;
  if (po.vendor_company_id && (await isMemberOfCompany(auth.userId!, po.vendor_company_id))) {
    return po;
  }
  throw new ForbiddenError("not the developer or vendor for this purchase order");
}

/**
 * Authorize a purchase order for WRITE access: developer (package owner) OR
 * admin only. Vendors may read but not mutate. Returns the PO row, else throws.
 */
async function authorizePoWrite(req: Request, poId: string): Promise<any> {
  const auth = getAuth(req);
  const po = await q1<any>(`select * from purchase_orders where id = $1`, [poId]);
  if (!po) throw new NotFoundError("purchase order not found");
  if (auth.isAdmin) return po;
  if (po.developer_company_id && (await isMemberOfCompany(auth.userId!, po.developer_company_id))) {
    return po;
  }
  if (po.package_id && (await userOwnsPackage(auth.userId!, po.package_id))) return po;
  throw new ForbiddenError("only the developer may manage this purchase order");
}

// ---- POST /award/confirm -- confirm an award + draft a purchase order -------
// {bidId} -> mark the bid awarded (if not already), then create a draft PO
// derived from the bid. The developer must own the package the bid belongs to.
router.post(
  "/confirm",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const bidId: string = req.body?.bidId ?? "";
    if (!bidId) return res.status(400).json({ error: "bidId required" });

    // Resolve the bid + its package + building + developer company.
    const ctx = await q1<any>(
      `select b.id as bid_id, b.price, b.vendor_company_id, b.awarded,
              p.id as package_id, p.building_id, bl.company_id as developer_company_id
         from bids b
         join packages p on p.id = b.package_id
         join buildings bl on bl.id = p.building_id
        where b.id = $1`,
      [bidId],
    );
    if (!ctx) throw new NotFoundError("bid not found");

    // Only the developer that owns the package (or admin) may confirm.
    if (!auth.isAdmin && !(await userOwnsPackage(auth.userId!, ctx.package_id))) {
      throw new ForbiddenError("only the developer may confirm this award");
    }

    // #53: Validate bid amount against the package budget before confirming.
    // If the bid price exceeds the package's budget_max, warn (do not block)
    // so the developer sees a clear flag in the response. A hard block would be
    // too restrictive (budgets are estimates; developers may approve overages),
    // but a silent over-budget award is a data-quality gap that should be surfaced.
    let budgetWarning: string | null = null;
    const budgetRow = await q1<{ budget_max: number | null }>(
      `select budget_max from packages where id = $1`,
      [ctx.package_id],
    );
    if (
      budgetRow?.budget_max != null &&
      ctx.price != null &&
      Number(ctx.price) > Number(budgetRow.budget_max)
    ) {
      budgetWarning = `Bid amount $${Number(ctx.price).toLocaleString()} exceeds package budget cap $${Number(budgetRow.budget_max).toLocaleString()}. Confirm to proceed or revise the budget.`;
    }

    // Mark the bid awarded if it is not already. bids' RLS update policy only
    // allows the VENDOR company to update its own bid (see schema-rls.sql) -
    // the developer confirming an award is not a member of that company, so
    // this write needs the same runAsAdmin() escalation requestContext.ts
    // documents for other already-authorized cross-company writes. It is
    // safe here specifically because userOwnsPackage() above already proved
    // the caller owns this package/building before any write happens.
    if (!ctx.awarded) {
      const updated = await runAsAdmin(() =>
        q(`update bids set awarded = true, status = 'awarded' where id = $1 returning id`, [
          bidId,
        ]),
      );
      if (updated.length === 0) {
        throw new Error(`failed to mark bid ${bidId} as awarded`);
      }
    }

    // Reuse an existing draft PO for this bid if one was already started, so
    // confirm is idempotent and does not spawn duplicate purchase orders.
    const existing = await q1<any>(
      `select * from purchase_orders where bid_id = $1 order by created_at limit 1`,
      [bidId],
    );
    if (existing) {
      return res.status(200).json({ purchaseOrder: existing });
    }

    // bids.price is dollars; store integer cents on the PO.
    const amountCents =
      ctx.price != null ? Math.round(Number(ctx.price) * 100) : null;

    const purchaseOrder = await q1<any>(
      `insert into purchase_orders
         (bid_id, package_id, building_id, developer_company_id, vendor_company_id,
          amount_cents, status, created_by)
       values ($1,$2,$3,$4,$5,$6,'draft',$7)
       returning *`,
      [
        bidId,
        ctx.package_id,
        ctx.building_id,
        ctx.developer_company_id,
        ctx.vendor_company_id,
        amountCents,
        auth.userId,
      ],
    );

    // Notify the awarded vendor. Placed AFTER the purchase order insert and
    // gated by the same `if (existing)` early-return above: a retried
    // /confirm for a bid that already has a PO returns 200 before ever
    // reaching this line, so this fires exactly once per real award, not
    // once per request. The in-app row is fast/local and stays on the
    // request path; the outbound email (a slow, unreliable third-party
    // HTTP call) is enqueued onto the durable job queue (lib/jobs.ts)
    // instead of awaited here, so a Resend outage cannot add latency to -
    // or fail - an already-successful award confirmation. One job per
    // recipient, keyed by (purchase order, recipient) so a retried enqueue
    // can never double-send.
    if (ctx.vendor_company_id) {
      const poNumber = purchaseOrder?.po_number || purchaseOrder?.id;
      const amountText =
        amountCents != null ? `$${(amountCents / 100).toLocaleString()}` : "an amount to be confirmed";
      const recipients = await notifyCompanyMembers(ctx.vendor_company_id, {
        title: "You were awarded a package",
        detail: `Your bid was awarded (PO ${poNumber}, ${amountText}). Sign in to Divini Procure to view the purchase order.`,
        kind: "award",
      });
      for (const r of recipients) {
        if (!r.email) continue;
        await enqueueJob({
          jobType: "send_email",
          payload: {
            to: r.email,
            subject: "You were awarded a package on Divini Procure",
            text:
              `Congratulations - your bid was awarded.\n\n` +
              `Purchase order: ${poNumber}\nAmount: ${amountText}\n\n` +
              `Sign in to Divini Procure to view the purchase order and next steps.\n`,
          },
          idempotencyKey: `award-email:${purchaseOrder.id}:${r.userId}`,
        });
      }
    }

    res.status(201).json({ purchaseOrder, ...(budgetWarning ? { budgetWarning } : {}) });
  }),
);

// ---- GET /award/purchase-orders?companyId= -- a developer's POs -------------
router.get(
  "/purchase-orders",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const rows = await q<any>(
      `select po.*,
              c.name as vendor_name,
              (select count(*) from award_documents d where d.purchase_order_id = po.id) as document_count,
              (select count(*) from payment_authorizations pa where pa.purchase_order_id = po.id) as payment_count
         from purchase_orders po
         left join companies c on c.id = po.vendor_company_id
        where po.developer_company_id = $1
        order by po.created_at desc`,
      [companyId],
    );
    res.json(
      rows.map((r) => ({
        ...r,
        document_count: Number(r.document_count ?? 0),
        payment_count: Number(r.payment_count ?? 0),
      })),
    );
  }),
);

// ---- GET /award/purchase-orders/:id -- one PO + payments + documents --------
router.get(
  "/purchase-orders/:id",
  requireUser,
  h(async (req, res) => {
    const po = await authorizePoRead(req, req.params.id);
    const vendor = po.vendor_company_id
      ? await q1<any>(`select name from companies where id = $1`, [po.vendor_company_id])
      : null;
    const payments = await q<any>(
      `select * from payment_authorizations where purchase_order_id = $1 order by created_at desc`,
      [po.id],
    );
    const documents = await q<any>(
      `select * from award_documents where purchase_order_id = $1 order by created_at desc`,
      [po.id],
    );
    res.json({
      purchaseOrder: { ...po, vendor_name: vendor?.name ?? null },
      payments,
      documents,
    });
  }),
);

// ---- PATCH /award/purchase-orders/:id -- update PO (developer only) ---------
// Whitelisted fields: status / po_number / terms / notes. Setting status
// 'issued' stamps issued_at when it was not already set.
router.patch(
  "/purchase-orders/:id",
  requireUser,
  h(async (req, res) => {
    const po = await authorizePoWrite(req, req.params.id);

    const FIELDS = ["status", "po_number", "terms", "notes"] as const;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    let issuing = false;
    for (const key of FIELDS) {
      if (!(key in (req.body ?? {}))) continue;
      let v = req.body[key];
      if (key === "status") {
        if (v != null && !PO_STATUSES.has(String(v))) {
          return res.status(400).json({ error: `invalid status: ${v}` });
        }
        if (String(v) === "issued" && !po.issued_at) issuing = true;
      }
      if (v === "") v = null;
      sets.push(`${key} = $${i++}`);
      vals.push(v);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "no updatable fields supplied" });
    }
    if (issuing) sets.push(`issued_at = now()`);
    sets.push(`updated_at = now()`);
    vals.push(po.id);

    const row = await q1<any>(
      `update purchase_orders set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );
    res.json({ purchaseOrder: row });
  }),
);

// ---- POST /award/purchase-orders/:id/payment-auth -- RECORD ONLY ------------
// {amountCents, feePercentage?, payerType?} -> a pending payment_authorizations
// row PLUS two platform_revenue accruals (platform fee + infrastructure fee)
// and a referral commission if applicable. This NEVER moves money; the
// monetization engine RECORDS/ACCRUES revenue only.
//
// Fee resolution (single source of truth: server/src/lib/fee-matrix.ts, backed
// by the fee_rules database table, db/schema-fee-matrix.sql):
//   - PLATFORM FEE: if feePercentage is NOT supplied, it is AUTO-RESOLVED
//     (grandfathered existing-relationship pair > enterprise/custom fee_rules
//     row > standard 5% capped $25,000 / grandfathered 2% capped $10,000). If
//     feePercentage IS supplied, the manual value is kept (source 'manual').
//   - PLATFORM INFRASTRUCTURE FEE: always auto-resolved (0.1% capped $1,500),
//     always its own line item, regardless of whether the platform fee above
//     was manual. Never merged into the platform fee.
// Both fees are always recorded (this is not gated behind a flag); their
// resolved percentage/cap/amount are stored on the authorization row AND as
// separate platform_revenue ledger rows. After recording, a referral
// commission is recorded if the DEVELOPER (the referred party for
// procurement) was brought in by an active partner.
router.post(
  "/purchase-orders/:id/payment-auth",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const po = await authorizePoWrite(req, req.params.id);

    const rawAmount = req.body?.amountCents;
    const amountCents =
      rawAmount === undefined || rawAmount === null || rawAmount === ""
        ? po.amount_cents ?? null
        : Math.round(Number(rawAmount));
    if (amountCents == null || !Number.isFinite(amountCents)) {
      return res.status(400).json({ error: "amountCents required (integer cents)" });
    }

    const manualFeeSupplied = req.body?.feePercentage != null && req.body.feePercentage !== "";
    let manualFeePercentage: number | null = null;
    let manualFeeCents: number | null = null;
    if (manualFeeSupplied) {
      manualFeePercentage = Number(req.body.feePercentage);
      if (!Number.isFinite(manualFeePercentage)) {
        return res.status(400).json({ error: "feePercentage must be a number" });
      }
      manualFeeCents = Math.round((amountCents * manualFeePercentage) / 100);
    }

    const payerType: string | null = req.body?.payerType ? String(req.body.payerType) : null;
    const notes: string | null = req.body?.notes ? String(req.body.notes) : null;

    // Insert the base authorization row first (placeholder fee columns), so
    // every fee resolution below can be tied to a real payment_authorization_id
    // from the start - this keeps the ledger accrual idempotent per fee type
    // and avoids ever writing an orphaned accrual row.
    let row = await q1<any>(
      `insert into payment_authorizations
         (purchase_order_id, amount_cents, fee_percentage, fee_cents, payer_type, status, notes)
       values ($1,$2,$3,$4,$5,'pending',$6)
       returning *`,
      [po.id, amountCents, manualFeePercentage, manualFeeCents, payerType, notes],
    );

    let revenueId: string | null = null;
    let recordedFeeCents = manualFeeCents ?? 0;
    try {
      // PLATFORM FEE: auto-resolve (grandfathered / enterprise matrix row /
      // standard, capped) unless a manual override was supplied.
      const platformFee = await resolveAndRecordFee({
        developerCompanyId: po.developer_company_id ?? null,
        vendorCompanyId: po.vendor_company_id ?? null,
        baseCents: amountCents,
        purchaseOrderId: po.id,
        paymentAuthorizationId: row.id,
        sourceType: manualFeeSupplied ? "manual" : "procurement_fee",
        actorUserId: auth.userId ?? null,
        actorEmail: auth.email ?? null,
      });
      revenueId = platformFee.revenueId;

      const finalFeePercentage = manualFeeSupplied ? manualFeePercentage : platformFee.feePercentage;
      const finalFeeCents = manualFeeSupplied ? manualFeeCents : platformFee.feeCents;
      recordedFeeCents = finalFeeCents ?? 0;

      if (manualFeeSupplied && revenueId) {
        // The ledger should reflect the manual amount, not the auto-resolved one.
        await q(
          `update platform_revenue
              set fee_percentage = $1, fee_cents = $2, fee_source = 'manual', updated_at = now()
            where id = $3 and status = 'accrued'`,
          [manualFeePercentage, manualFeeCents, revenueId],
        );
      }

      // PLATFORM INFRASTRUCTURE FEE: always auto-resolved, always its own line
      // item, regardless of whether the platform fee above was manual.
      const infraFee = await resolveAndRecordFee({
        developerCompanyId: po.developer_company_id ?? null,
        vendorCompanyId: po.vendor_company_id ?? null,
        baseCents: amountCents,
        purchaseOrderId: po.id,
        paymentAuthorizationId: row.id,
        ruleType: "platform_infrastructure_fee",
        sourceType: "infrastructure_fee",
        actorUserId: auth.userId ?? null,
        actorEmail: auth.email ?? null,
      });

      const updated = await q1<any>(
        `update payment_authorizations
            set fee_percentage = $2,
                fee_cents = $3,
                award_cents = $4,
                success_fee_pct = $5,
                success_fee_cap_cents = $6,
                success_fee_cents = $7,
                success_fee_grandfathered = $8,
                success_fee_status = 'accrued',
                service_buffer_pct = $9,
                service_buffer_cap_cents = $10,
                service_buffer_cents = $11
          where id = $1
          returning *`,
        [
          row.id,
          finalFeePercentage,
          finalFeeCents,
          amountCents,
          finalFeePercentage,
          platformFee.capCents,
          finalFeeCents,
          platformFee.grandfathered,
          infraFee.feePercentage,
          infraFee.capCents,
          infraFee.feeCents,
        ],
      );
      if (updated) row = updated;
    } catch {
      // Recording fees must never break the authorization (no money moves
      // either way). Leave the base authorization row in place on error.
    }

    // Record a referral commission if the developer (the referred party for a
    // procurement fee) was brought in by an active partner. Best effort.
    const referral = await maybeRecordReferralCommission({
      referredCompanyId: po.developer_company_id ?? null,
      platformFeeCents: recordedFeeCents,
      source: "transaction",
      actorEmail: auth.email ?? null,
      platformRevenueId: revenueId,
    });

    res.status(201).json({
      paymentAuthorization: row,
      revenueId,
      referralCommission: referral.created
        ? { created: true, commissionCents: referral.commissionCents }
        : { created: false },
    });
  }),
);

// ---- PATCH /award/payment-auth/:id -- authorize/release/void (RECORD ONLY) --
// {status, notes} -> update an authorization. Setting status 'authorized' or
// 'released' stamps authorized_by + authorized_at. No money moves, ever.
router.patch(
  "/payment-auth/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const pay = await q1<any>(
      `select * from payment_authorizations where id = $1`,
      [req.params.id],
    );
    if (!pay) throw new NotFoundError("payment authorization not found");
    // Developer (or admin) of the parent PO may transition it.
    await authorizePoWrite(req, pay.purchase_order_id);

    const status = req.body?.status;
    const notes = req.body?.notes;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (status !== undefined) {
      if (!PAY_STATUSES.has(String(status))) {
        return res.status(400).json({ error: `invalid status: ${status}` });
      }
      sets.push(`status = $${i++}`);
      vals.push(String(status));
      if (String(status) === "authorized" || String(status) === "released") {
        sets.push(`authorized_by = $${i++}`);
        vals.push(auth.email ?? auth.userId);
        sets.push(`authorized_at = now()`);
      }
    }
    if (notes !== undefined) {
      sets.push(`notes = $${i++}`);
      vals.push(notes === "" ? null : String(notes));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "no updatable fields supplied" });
    }
    vals.push(pay.id);
    const row = await q1<any>(
      `update payment_authorizations set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );
    res.json({ paymentAuthorization: row });
  }),
);

// ---- POST /award/purchase-orders/:id/documents -- add closeout/warranty -----
// {docKind, title, url}. Any party with read access to the PO may attach a
// document (developer or vendor), mirroring how submittals/deliveries are
// shared between the two companies on a package.
router.post(
  "/purchase-orders/:id/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const po = await authorizePoRead(req, req.params.id);

    const docKind = req.body?.docKind ? String(req.body.docKind) : "other";
    if (!DOC_KINDS.has(docKind)) {
      return res.status(400).json({ error: `invalid docKind: ${docKind}` });
    }
    const title = req.body?.title ? String(req.body.title).trim() : "";
    if (!title) return res.status(400).json({ error: "title required" });
    const url = req.body?.url ? String(req.body.url).trim() : null;

    const row = await q1<any>(
      `insert into award_documents (purchase_order_id, doc_kind, title, url, created_by)
       values ($1,$2,$3,$4,$5)
       returning *`,
      [po.id, docKind, title, url, auth.email ?? auth.userId],
    );
    res.status(201).json({ document: row });
  }),
);

// ---- GET /award/purchase-orders/:id/documents -- list documents on a PO -----
router.get(
  "/purchase-orders/:id/documents",
  requireUser,
  h(async (req, res) => {
    const po = await authorizePoRead(req, req.params.id);
    const documents = await q<any>(
      `select * from award_documents where purchase_order_id = $1 order by created_at desc`,
      [po.id],
    );
    res.json({ documents });
  }),
);

export default router;
