/**
 * Divini Procure - Phase 1 P1-05: Bid Revision workflow (first real write
 * path for the previously schema-only, zero-caller `bid_revisions` table -
 * confirmed by grep this session: no route anywhere read or wrote it before
 * this file, the same "dead table" situation Phase 0 item 19 found and fixed
 * for `reviews`).
 *
 * A bid's canonical, currently-active price is always `bids.price` (never
 * duplicated into a second "current price" field). What this file adds is
 * NEGOTIATION HISTORY around that value: either party proposes a revised
 * price, the counterparty accepts or declines, and only on acceptance does
 * `bids.price` move - inside a transaction, together with the accepted
 * bid_revisions row, so the two can never disagree. Nothing is ever deleted
 * or overwritten: every proposal (accepted, declined, or still pending)
 * remains in bid_revisions forever, so "vendor originally bid $740,000,
 * revision 2 = $718,000, final negotiated offer = $705,000" stays fully
 * reconstructable even though `bids.price` only ever shows the latest value.
 *
 * Once a bid is awarded, no further revisions may be proposed (the award
 * has already captured a specific amount - see award-workflow.ts).
 *
 * Authorization: the developer (member of the package's building company) or
 * the bidding vendor (member of bids.vendor_company_id) may each PROPOSE a
 * revision; only the OTHER party (the counterparty) - or admin - may accept
 * or decline it. A party can never approve its own proposal.
 *
 * Endpoints (all requireUser):
 *   GET   /packages/:packageId/bids/:bidId/revisions -> { revisions: [...] }
 *   POST  /packages/:packageId/bids/:bidId/revisions -> { revision }
 *   PATCH /bid-revisions/:id                         -> { revision, bid? }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1, withTransaction, escalateToAdmin } from "../pool.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { isMemberOfCompany, bidContext } from "../lib/financial-auth.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function role(
  userId: string,
  isAdmin: boolean,
  ctx: { developer_company_id: string; vendor_company_id: string },
): Promise<"developer" | "vendor" | "admin" | null> {
  if (isAdmin) return "admin";
  if (await isMemberOfCompany(userId, ctx.developer_company_id)) return "developer";
  if (await isMemberOfCompany(userId, ctx.vendor_company_id)) return "vendor";
  return null;
}

// ---- GET /packages/:packageId/bids/:bidId/revisions --------------------------
router.get(
  "/packages/:packageId/bids/:bidId/revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await bidContext(req.params.bidId);
    if (!ctx || ctx.package_id !== req.params.packageId) throw new NotFoundError("bid not found");
    const who = await role(auth.userId!, auth.isAdmin, ctx);
    if (!who) throw new ForbiddenError("not a party to this bid");

    const revisions = await q<any>(
      `select * from bid_revisions where bid_id = $1 order by created_at desc`,
      [req.params.bidId],
    );
    res.json({ revisions, currentPrice: ctx.price });
  }),
);

// ---- POST /packages/:packageId/bids/:bidId/revisions --------------------------
// {priceDollars, note?} -> a pending proposal from whichever party is calling.
router.post(
  "/packages/:packageId/bids/:bidId/revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await bidContext(req.params.bidId);
    if (!ctx || ctx.package_id !== req.params.packageId) throw new NotFoundError("bid not found");
    const who = await role(auth.userId!, auth.isAdmin, ctx);
    if (!who) throw new ForbiddenError("not a party to this bid");
    if (who === "admin") {
      return res.status(400).json({ error: "an admin may not propose a revision on behalf of a party" });
    }
    if (ctx.awarded) {
      return res.status(400).json({ error: "this bid has already been awarded; no further revisions" });
    }

    const priceDollars = Number(req.body?.priceDollars);
    if (!Number.isFinite(priceDollars) || priceDollars < 0) {
      return res.status(400).json({ error: "priceDollars required (nonnegative number)" });
    }
    const note = req.body?.note ? String(req.body.note).trim() : null;

    const revision = await q1<any>(
      `insert into bid_revisions (bid_id, proposed, status, created_by)
       values ($1, $2, 'pending', $3)
       returning *`,
      [
        req.params.bidId,
        JSON.stringify({ priceDollars, note, proposedBy: who, previousPriceDollars: ctx.price }),
        auth.userId,
      ],
    );
    res.status(201).json({ revision });
  }),
);

// ---- PATCH /bid-revisions/:id -- accept or decline (counterparty only) -------
// {decision: 'accepted' | 'declined'}
router.patch(
  "/bid-revisions/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const decision = req.body?.decision;
    if (decision !== "accepted" && decision !== "declined") {
      return res.status(400).json({ error: "decision must be accepted or declined" });
    }

    // NOTE ON LOCKING STRATEGY: this deliberately does NOT use `SELECT ...
    // FOR UPDATE` on bids/bid_revisions. Reproduced empirically this phase:
    // Postgres silently returns zero rows for a `FOR UPDATE` select against a
    // table whose RLS USING clause contains an EXISTS subquery into another
    // RLS-protected table (bids_select's package/building/company_members
    // join, schema-rls.sql) - even though the IDENTICAL query without `FOR
    // UPDATE`, or `FOR UPDATE` against a table with a trivial `using (true)`
    // policy, both return the row correctly for the very same session/GUCs.
    // Confirmed via a standalone repro script comparing all four combinations
    // side by side. Documented in the Phase 1 completion report as a
    // discovered Postgres RLS constraint, not an application bug. The safe,
    // equally-correct alternative used here and in every other Phase 1
    // concurrency-sensitive write (change orders, invoices, payments):
    // optimistic compare-and-swap via `UPDATE ... WHERE status = 'pending'`,
    // which needs no row lock at all - the UPDATE statement's own atomicity
    // is the concurrency guard, and a zero-row result means someone else won
    // the race.
    const result = await withTransaction(async (tx) => {
      const revision = await tx.q1<any>(`select * from bid_revisions where id = $1`, [req.params.id]);
      if (!revision) throw new NotFoundError("revision not found");
      if (revision.status !== "pending") {
        throw new ValidationError(`revision is already ${revision.status}`);
      }

      const bid = await tx.q1<any>(`select * from bids where id = $1`, [revision.bid_id]);
      if (!bid) throw new NotFoundError("bid not found");
      const devRow = await tx.q1<{ company_id: string }>(
        `select bl.company_id from packages p join buildings bl on bl.id = p.building_id where p.id = $1`,
        [bid.package_id],
      );
      const ctx = { developer_company_id: devRow?.company_id ?? "", vendor_company_id: bid.vendor_company_id };
      const who = await role(auth.userId!, auth.isAdmin, ctx);
      if (!who) throw new ForbiddenError("not a party to this bid");

      const proposedBy = revision.proposed?.proposedBy;
      if (who !== "admin" && who === proposedBy) {
        throw new ForbiddenError("the proposing party cannot decide its own revision");
      }
      if (bid.awarded) {
        throw new ValidationError("this bid has already been awarded; no further revisions");
      }

      const updatedRevision = await tx.q1<any>(
        `update bid_revisions set status = $2 where id = $1 and status = 'pending' returning *`,
        [revision.id, decision],
      );
      if (!updatedRevision) {
        throw new ValidationError("this revision was already decided by a concurrent request");
      }

      let updatedBid = bid;
      if (decision === "accepted") {
        const priceDollars = Number(revision.proposed?.priceDollars);
        // bids_update RLS (schema-rls.sql) only permits the VENDOR company
        // (or admin) to write to bids - but a DEVELOPER accepting the
        // vendor's own proposal is an equally legitimate trigger for this
        // exact write (and the reverse: a vendor accepting the developer's
        // proposal). role() above already proved the caller is one of the
        // two authorized parties to this negotiation, so this escalation is
        // safe for the same reason award-workflow.ts's runAsAdmin() escalation
        // is safe when marking a bid awarded.
        await escalateToAdmin(tx);
        updatedBid = await tx.q1<any>(
          `update bids set price = $2 where id = $1 and awarded = false returning *`,
          [bid.id, priceDollars],
        );
        if (!updatedBid) {
          throw new ValidationError("this bid was awarded concurrently; the accepted revision was not applied");
        }
      }

      return { revision: updatedRevision, bid: updatedBid };
    });

    res.json(result);
  }),
);

export default router;
