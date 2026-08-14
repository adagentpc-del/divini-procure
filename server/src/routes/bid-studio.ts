/**
 * Divini Bid Studio - structured draft-build workflow for a vendor's bid.
 * Mounted under /api/bid-studio in routes.ts.
 *
 * Extends the EXISTING bids / bid_line_items tables (db/schema.sql) rather
 * than duplicating them - see db/schema-bid-studio.sql for the added
 * columns/tables. Does not replace the existing simple submission path
 * (POST /api/packages/:id/bids -> server/src/db.ts submitPricedBid) or the
 * separate bid_items/package_line_items BOQ-pricing feature; this is an
 * alternate, structured build-then-submit workflow: line items with optional
 * upgrades, tax/discount/deposit, a payment schedule, assumptions/
 * exclusions/terms, an expiration date, versioned drafts, and reusable
 * templates. On submit, the computed total is written into the existing
 * bids.price column (dollars) so every downstream reader keeps working.
 *
 * Authorization: a draft belongs to its vendor_company_id. Access = member
 * of that company, or admin - the same single-owner model as Divini
 * Pipeline and Divini Scope Builder (this is the vendor's own workspace for
 * building a bid, not a shared record with the developer until submitted).
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { computeBidTotals, scoreBidReadiness, type BidLineItemInput } from "../lib/bid-totals.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const DUE_EVENTS = new Set(["deposit", "milestone", "completion", "net_15", "net_30", "net_60", "other"]);

async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

async function authorizeDraft(req: Request, id: string): Promise<any> {
  const auth = getAuth(req);
  const bid = await q1<any>(`select * from bids where id = $1`, [id]);
  if (!bid) throw new NotFoundError("bid not found");
  if (auth.isAdmin) return bid;
  if (await isMemberOfCompany(auth.userId!, bid.vendor_company_id)) return bid;
  throw new ForbiddenError("not a member of this bid's vendor company");
}

/**
 * Once a bid leaves 'draft' status its price/total_cents are fixed to what
 * was computed at submit time. Structural edits (line items, milestones,
 * tax/discount/deposit) are only allowed on a draft - editing them after
 * submission would desync the stored total from the line items without ever
 * recomputing it. Matches the existing change-orders.ts convention (fields
 * are only editable while draft). Returns an error message when blocked, or
 * null when the edit is allowed - callers `return res.status(400)...` on a
 * non-null result, matching this file's existing inline-validation style
 * (the shared error middleware only special-cases ForbiddenError/NotFoundError).
 */
function draftEditBlockReason(bid: any): string | null {
  return bid.status === "draft" ? null : `bid is ${bid.status}; only a draft can be edited`;
}

/** Resolve a bid via a line item or milestone id, then authorize it. */
async function authorizeViaChild(req: Request, table: "bid_line_items" | "bid_payment_milestones", childId: string): Promise<{ bid: any; childBidId: string }> {
  const child = await q1<any>(`select * from ${table} where id = $1`, [childId]);
  if (!child) throw new NotFoundError("not found");
  const bid = await authorizeDraft(req, child.bid_id);
  return { bid, childBidId: child.bid_id };
}

async function loadLineItems(bidId: string): Promise<any[]> {
  // bid_line_items has no created_at column (unlike bid_payment_milestones);
  // sort_order is the only real ordering field, matching loadMilestones()
  // below. Ordering by a second, nonexistent column here was a genuine bug
  // that 500'd every call - live-reproduced and fixed as part of the
  // compliance completion pass.
  return q(`select * from bid_line_items where bid_id = $1 order by sort_order asc`, [bidId]);
}
async function loadMilestones(bidId: string): Promise<any[]> {
  return q(`select * from bid_payment_milestones where bid_id = $1 order by sort_order asc`, [bidId]);
}

function toLineItemInputs(rows: any[]): BidLineItemInput[] {
  return rows.map((r) => ({
    qty: r.qty,
    unitPriceDollars: r.unit_price,
    optional: r.optional,
    selected: r.selected,
  }));
}

async function totalsAndReadiness(bid: any, lineItems: any[]) {
  const totals = computeBidTotals({
    lineItems: toLineItemInputs(lineItems),
    taxCents: bid.tax_cents,
    discountCents: bid.discount_cents,
    depositCents: bid.deposit_cents,
    depositPercentBasisPoints: bid.deposit_percent_basis_points,
  });
  const readiness = scoreBidReadiness({
    lineItemCount: totals.lineItemCount,
    totalCents: totals.totalCents,
    expiresAt: bid.expires_at,
    terms: bid.terms,
    hasDepositTerms: bid.deposit_cents != null || bid.deposit_percent_basis_points != null,
    hasAssumptionsOrExclusions: !!(bid.assumptions || (bid.exclusions && bid.exclusions.length > 0)),
  });
  return { totals, readiness };
}

/** Parse a string[] from a body value (array of strings, or comma-separated string). Matches products.ts convention. */
function toTextArray(v: unknown): string[] | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---- GET /bid-studio/drafts?companyId=&packageId=&status= --------------------
router.get(
  "/drafts",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const conditions = ["vendor_company_id = $1"];
    const params: unknown[] = [companyId];
    let i = 2;
    if (req.query.packageId) {
      conditions.push(`package_id = $${i++}`);
      params.push(String(req.query.packageId));
    }
    if (req.query.status) {
      conditions.push(`status = $${i++}`);
      params.push(String(req.query.status));
    }
    const rows = await q(
      `select * from bids where ${conditions.join(" and ")} order by created_at desc limit 200`,
      params,
    );
    res.json({ drafts: rows });
  }),
);

// ---- POST /bid-studio/drafts {companyId, packageId, days?, note?} -----------
router.post(
  "/drafts",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const companyId = String(b.companyId || "");
    const packageId = String(b.packageId || "");
    if (!companyId || !packageId) return res.status(400).json({ error: "companyId and packageId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const row = await q1(
      `insert into bids (package_id, vendor_company_id, price, days, note, status, is_draft, docs_ok)
       values ($1,$2,0,$3,$4,'draft',true,false) returning *`,
      [packageId, companyId, b.days ?? null, b.note ?? null],
    );
    res.status(201).json({ draft: row });
  }),
);

// ---- GET /bid-studio/drafts/:id -----------------------------------------------
router.get(
  "/drafts/:id",
  requireUser,
  h(async (req, res) => {
    const bid = await authorizeDraft(req, req.params.id);
    const [lineItems, milestones, versions] = await Promise.all([
      loadLineItems(bid.id),
      loadMilestones(bid.id),
      q(`select * from bid_versions where bid_id = $1 order by version_number desc`, [bid.id]),
    ]);
    const { totals, readiness } = await totalsAndReadiness(bid, lineItems);
    res.json({ draft: bid, lineItems, milestones, versions, totals, readiness });
  }),
);

const EDITABLE_DRAFT_FIELDS: Record<string, string> = {
  days: "days",
  note: "note",
  scopeInstanceId: "scope_instance_id",
  expiresAt: "expires_at",
  depositCents: "deposit_cents",
  depositPercentBasisPoints: "deposit_percent_basis_points",
  taxCents: "tax_cents",
  discountCents: "discount_cents",
  assumptions: "assumptions",
  terms: "terms",
};

// ---- PATCH /bid-studio/drafts/:id ---------------------------------------------
router.patch(
  "/drafts/:id",
  requireUser,
  h(async (req, res) => {
    const bid = await authorizeDraft(req, req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [key, column] of Object.entries(EDITABLE_DRAFT_FIELDS)) {
      if (b[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        vals.push(b[key]);
      }
    }
    if (b.exclusions !== undefined) {
      sets.push(`exclusions = $${i++}::text[]`);
      vals.push(toTextArray(b.exclusions));
    }
    if (sets.length === 0) return res.json({ draft: bid });
    vals.push(bid.id);
    const row = await q1(`update bids set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ draft: row });
  }),
);

// ---- POST /bid-studio/drafts/:id/line-items -----------------------------------
router.post(
  "/drafts/:id/line-items",
  requireUser,
  h(async (req, res) => {
    const bid = await authorizeDraft(req, req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    const b = req.body ?? {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const row = await q1(
      `insert into bid_line_items (bid_id, name, description, category, qty, unit, unit_price, optional, selected, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        bid.id,
        name,
        b.description ?? null,
        b.category ?? null,
        b.qty ?? 1,
        b.unit ?? null,
        b.unitPrice ?? 0,
        !!b.optional,
        b.selected !== false,
        b.sortOrder ?? 0,
      ],
    );
    res.status(201).json({ lineItem: row });
  }),
);

// ---- PATCH /bid-studio/line-items/:id ------------------------------------------
const EDITABLE_LINE_ITEM_FIELDS: Record<string, string> = {
  name: "name",
  description: "description",
  category: "category",
  qty: "qty",
  unit: "unit",
  unitPrice: "unit_price",
  optional: "optional",
  selected: "selected",
  sortOrder: "sort_order",
};
router.patch(
  "/line-items/:id",
  requireUser,
  h(async (req, res) => {
    const { bid } = await authorizeViaChild(req, "bid_line_items", req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [key, column] of Object.entries(EDITABLE_LINE_ITEM_FIELDS)) {
      if (b[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        vals.push(b[key]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });
    vals.push(req.params.id);
    const row = await q1(`update bid_line_items set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ lineItem: row });
  }),
);

// ---- DELETE /bid-studio/line-items/:id ------------------------------------------
router.delete(
  "/line-items/:id",
  requireUser,
  h(async (req, res) => {
    const { bid } = await authorizeViaChild(req, "bid_line_items", req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    await q(`delete from bid_line_items where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

// ---- POST /bid-studio/drafts/:id/milestones -------------------------------------
router.post(
  "/drafts/:id/milestones",
  requireUser,
  h(async (req, res) => {
    const bid = await authorizeDraft(req, req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    const b = req.body ?? {};
    const label = String(b.label || "").trim();
    if (!label) return res.status(400).json({ error: "label required" });
    const dueEvent = String(b.dueEvent || "milestone");
    if (!DUE_EVENTS.has(dueEvent)) return res.status(400).json({ error: `invalid dueEvent: ${dueEvent}` });
    const row = await q1(
      `insert into bid_payment_milestones (bid_id, label, percent_basis_points, amount_cents, due_event, sort_order)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [bid.id, label, b.percentBasisPoints ?? null, b.amountCents ?? null, dueEvent, b.sortOrder ?? 0],
    );
    res.status(201).json({ milestone: row });
  }),
);

// ---- DELETE /bid-studio/milestones/:id -------------------------------------------
router.delete(
  "/milestones/:id",
  requireUser,
  h(async (req, res) => {
    const { bid } = await authorizeViaChild(req, "bid_payment_milestones", req.params.id);
    const blockReason = draftEditBlockReason(bid);
    if (blockReason) return res.status(400).json({ error: blockReason });
    await q(`delete from bid_payment_milestones where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

/** Snapshot the current draft state into bid_versions. */
async function snapshotVersion(bidId: string, actorUserId: string | null, changeSummary: string | null): Promise<number> {
  const bid = await q1<any>(`select * from bids where id = $1`, [bidId]);
  const [lineItems, milestones] = await Promise.all([loadLineItems(bidId), loadMilestones(bidId)]);
  const nextVersion = (bid.current_version ?? 0) + 1;
  await q(
    `insert into bid_versions (bid_id, version_number, snapshot_json, change_summary, created_by)
     values ($1,$2,$3,$4,$5)`,
    [bidId, nextVersion, JSON.stringify({ bid, lineItems, milestones }), changeSummary, actorUserId],
  );
  await q(`update bids set current_version = $2 where id = $1`, [bidId, nextVersion]);
  return nextVersion;
}

// ---- POST /bid-studio/drafts/:id/save-version {changeSummary?} -----------------
router.post(
  "/drafts/:id/save-version",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const bid = await authorizeDraft(req, req.params.id);
    const version = await snapshotVersion(bid.id, auth.userId, req.body?.changeSummary ?? null);
    res.status(201).json({ version });
  }),
);

// ---- POST /bid-studio/drafts/:id/submit ----------------------------------------
router.post(
  "/drafts/:id/submit",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const bid = await authorizeDraft(req, req.params.id);
    if (bid.status !== "draft") {
      return res.status(400).json({ error: `bid is already ${bid.status}; Bid Studio only submits drafts` });
    }
    const lineItems = await loadLineItems(bid.id);
    if (lineItems.length === 0) {
      return res.status(400).json({ error: "add at least one line item before submitting" });
    }
    const { totals } = await totalsAndReadiness(bid, lineItems);
    if (totals.totalCents <= 0) {
      return res.status(400).json({ error: "total must be greater than zero" });
    }

    const row = await q1<any>(
      `update bids set
         price = $2,
         subtotal_cents = $3,
         tax_cents = $4,
         discount_cents = $5,
         total_cents = $6,
         deposit_cents = $7,
         status = 'submitted',
         is_draft = false,
         docs_ok = true
       where id = $1 returning *`,
      [
        bid.id,
        Math.round(totals.totalCents) / 100,
        totals.subtotalCents,
        totals.taxCents,
        totals.discountCents,
        totals.totalCents,
        totals.depositCents,
      ],
    );
    await snapshotVersion(bid.id, auth.userId, "Submitted");
    res.json({ draft: row, totals });
  }),
);

// ---- POST /bid-studio/drafts/:id/save-as-template {name, category?} ------------
router.post(
  "/drafts/:id/save-as-template",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const bid = await authorizeDraft(req, req.params.id);
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const lineItems = await loadLineItems(bid.id);

    const tmpl = await q1<any>(
      `insert into bid_templates (organization_id, category, name, assumptions, exclusions, terms, deposit_percent_basis_points, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        bid.vendor_company_id,
        req.body?.category ?? null,
        name,
        bid.assumptions,
        bid.exclusions,
        bid.terms,
        bid.deposit_percent_basis_points,
        auth.userId,
      ],
    );
    for (const li of lineItems) {
      await q(
        `insert into bid_template_line_items (template_id, name, description, category, qty, unit, unit_price, optional, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tmpl.id, li.name, li.description, li.category, li.qty, li.unit, li.unit_price, li.optional, li.sort_order],
      );
    }
    res.status(201).json({ template: tmpl });
  }),
);

// ---- GET /bid-studio/templates?companyId=&category= -----------------------------
router.get(
  "/templates",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const conditions = ["organization_id = $1"];
    const params: unknown[] = [companyId];
    if (req.query.category) {
      conditions.push(`category = $2`);
      params.push(String(req.query.category));
    }
    const rows = await q(
      `select * from bid_templates where ${conditions.join(" and ")} order by name asc`,
      params,
    );
    res.json({ templates: rows });
  }),
);

// ---- POST /bid-studio/templates/:id/apply {packageId} ---------------------------
router.post(
  "/templates/:id/apply",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const tmpl = await q1<any>(`select * from bid_templates where id = $1`, [req.params.id]);
    if (!tmpl) throw new NotFoundError("template not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, tmpl.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const packageId = String(req.body?.packageId || "");
    if (!packageId) return res.status(400).json({ error: "packageId required" });

    const draft = await q1<any>(
      `insert into bids
         (package_id, vendor_company_id, price, status, is_draft, docs_ok, assumptions, exclusions, terms, deposit_percent_basis_points)
       values ($1,$2,0,'draft',true,false,$3,$4,$5,$6) returning *`,
      [packageId, tmpl.organization_id, tmpl.assumptions, tmpl.exclusions, tmpl.terms, tmpl.deposit_percent_basis_points],
    );
    const templateLineItems = await q<any>(
      `select * from bid_template_line_items where template_id = $1 order by sort_order asc`,
      [tmpl.id],
    );
    for (const li of templateLineItems) {
      await q(
        `insert into bid_line_items (bid_id, name, description, category, qty, unit, unit_price, optional, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [draft.id, li.name, li.description, li.category, li.qty, li.unit, li.unit_price, li.optional, li.sort_order],
      );
    }
    res.status(201).json({ draft });
  }),
);

export default router;
