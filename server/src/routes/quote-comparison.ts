/**
 * Quote Comparison Engine for Divini Procure. Mounted under /api/quotes in
 * routes.ts (the lead wires `router.use("/quotes", quoteComparisonRouter)`).
 *
 * Lets the buyer who owns a package (or a super-admin) compare every bid on
 * that package side-by-side across price, lead time, freight, warranty, install,
 * and scope coverage, get a deterministic ranking, and save a recommendation /
 * award decision into bid_recommendations.
 *
 * Authorization reuses Procure's existing primitives:
 *   - the package's building owner (company_members of the building's company)
 *   - OR a super-admin (ADMIN_ALLOWED_EMAILS, via getAuth().isAdmin)
 * mirrors the userOwnsPackage() check in server/src/db.ts.
 *
 * Tables: bid_recommendations + comparison columns on bids
 * (db/schema-quote-compare.sql). Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * Authorize: the signed-in user must own the package (be a member of the
 * company that owns the package's building) OR be a super-admin. Throws
 * NotFoundError when the package does not exist, ForbiddenError otherwise.
 */
async function assertCanViewComparison(req: Request, packageId: string): Promise<void> {
  const auth = getAuth(req);
  const pkg = await q1<{ id: string }>(`select id from packages where id = $1`, [packageId]);
  if (!pkg) throw new NotFoundError("package not found");
  if (auth.isAdmin) return;
  const owned = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, auth.userId],
  );
  if (!owned) throw new ForbiddenError("not the owner of this package");
}

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Bid as returned to the comparison matrix. total_cents is the canonical total. */
interface CompareBid {
  id: string;
  vendor_company: string;
  total_cents: number;
  lead_time_days: number | null;
  freight_cents: number | null;
  warranty_text: string | null;
  install_cents: number | null;
  scope_notes: string | null;
  notes: string | null;
  line_items: { id: string; name: string; qty: number; unit_price_cents: number; amount_cents: number }[];
}

const router = Router();

// ---- GET /quotes/compare/:packageId -- full side-by-side comparison ---------
router.get(
  "/compare/:packageId",
  requireUser,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    await assertCanViewComparison(req, packageId);

    // Package + building context.
    const pkg = await q1<any>(
      `select p.*, b.id as _bid, b.name as _bname, b.location as _bloc, b.company_id as _bcompany
         from packages p join buildings b on b.id = p.building_id
        where p.id = $1`,
      [packageId],
    );
    if (!pkg) throw new NotFoundError("package not found");
    const { _bid, _bname, _bloc, _bcompany, ...pkgRest } = pkg;
    const packageOut = {
      ...pkgRest,
      building: { id: _bid, name: _bname, location: _bloc, company_id: _bcompany },
    };

    // All bids on this package (buyer sees every vendor's bid). The comparison
    // columns are nullable add-ons from schema-quote-compare.sql.
    const bidRows = await q<any>(
      `select bd.id, bd.price, bd.note,
              bd.lead_time_days, bd.freight_cents, bd.warranty_text,
              bd.install_cents, bd.scope_notes,
              c.name as vendor_company
         from bids bd
         join companies c on c.id = bd.vendor_company_id
        where bd.package_id = $1 and coalesce(bd.is_draft, false) = false
        order by bd.created_at`,
      [packageId],
    );

    // Per-bid priced line items. `bid_items` is the live priced-bid table
    // (line_item_id + amount); `bid_line_items` is the legacy/standalone table
    // (name + unit_price). Pull both so the total can be computed even when the
    // bids.price column is absent/zero.
    const bids: CompareBid[] = [];
    for (const r of bidRows) {
      const items = await q<any>(
        `select bi.id, coalesce(pli.description, 'Line item') as name,
                coalesce(bi.qty, pli.qty, 1) as qty,
                coalesce(bi.unit_price, 0) as unit_price,
                coalesce(bi.amount, coalesce(bi.unit_price,0) * coalesce(bi.qty, pli.qty, 1)) as amount
           from bid_items bi
           left join package_line_items pli on pli.id = bi.line_item_id
          where bi.bid_id = $1
          order by pli.sort nulls last, bi.id`,
        [r.id],
      );
      // Fallback to the standalone bid_line_items table if no priced bid_items.
      let lineRows = items;
      if (lineRows.length === 0) {
        lineRows = await q<any>(
          `select id, coalesce(name, 'Line item') as name,
                  coalesce(qty, 1) as qty, coalesce(unit_price, 0) as unit_price,
                  coalesce(unit_price, 0) * coalesce(qty, 1) as amount
             from bid_line_items where bid_id = $1 order by id`,
          [r.id],
        );
      }
      const line_items = lineRows.map((li) => ({
        id: String(li.id),
        name: String(li.name),
        qty: toNum(li.qty),
        unit_price_cents: Math.round(toNum(li.unit_price) * 100),
        amount_cents: Math.round(toNum(li.amount) * 100),
      }));

      // Canonical total: prefer the bids.price column; else sum the line items.
      const lineSumCents = line_items.reduce((s, li) => s + li.amount_cents, 0);
      const priceCents = r.price != null ? Math.round(toNum(r.price) * 100) : 0;
      const total_cents = priceCents > 0 ? priceCents : lineSumCents;

      bids.push({
        id: String(r.id),
        vendor_company: r.vendor_company ?? "Vendor",
        total_cents,
        lead_time_days: r.lead_time_days != null ? toNum(r.lead_time_days) : null,
        freight_cents: r.freight_cents != null ? toNum(r.freight_cents) : null,
        warranty_text: r.warranty_text ?? null,
        install_cents: r.install_cents != null ? toNum(r.install_cents) : null,
        scope_notes: r.scope_notes ?? null,
        notes: r.note ?? null,
        line_items,
      });
    }

    // -------- deterministic ranking --------
    // Three normalized dimensions, each scaled 0..1 (1 = best), then weighted.
    //   price  (40%): all-in cost = total + freight + install. Lower is better.
    //   speed  (30%): lead time in days. Faster (fewer days) is better.
    //   scope  (30%): coverage = line-item count + has-scope-notes + has-warranty.
    //                 More coverage is better.
    // Dimensions with no signal across all bids contribute 0.5 (neutral) so a
    // single missing field never unfairly sinks a bid.
    const allIn = (b: CompareBid) =>
      b.total_cents + (b.freight_cents ?? 0) + (b.install_cents ?? 0);
    const coverage = (b: CompareBid) =>
      b.line_items.length + (b.scope_notes ? 1 : 0) + (b.warranty_text ? 1 : 0);

    const prices = bids.map(allIn);
    const leads = bids.map((b) => (b.lead_time_days != null ? b.lead_time_days : null));
    const covers = bids.map(coverage);

    const minPrice = Math.min(...prices.filter((p) => p > 0), Infinity);
    const maxPrice = Math.max(...prices, 0);
    const leadVals = leads.filter((l): l is number => l != null && l > 0);
    const minLead = leadVals.length ? Math.min(...leadVals) : null;
    const maxLead = leadVals.length ? Math.max(...leadVals) : null;
    const minCover = Math.min(...covers, 0);
    const maxCover = Math.max(...covers, 0);

    const W_PRICE = 0.4, W_SPEED = 0.3, W_SCOPE = 0.3;

    const scored = bids.map((b) => {
      const price = allIn(b);
      // Lower price -> higher score. Neutral when no price signal.
      let priceScore = 0.5;
      if (maxPrice > minPrice && price > 0 && Number.isFinite(minPrice)) {
        priceScore = 1 - (price - minPrice) / (maxPrice - minPrice);
      } else if (Number.isFinite(minPrice) && price === minPrice) {
        priceScore = 1;
      }
      // Faster lead -> higher score. Neutral when this bid has no lead time.
      let speedScore = 0.5;
      if (b.lead_time_days != null && minLead != null && maxLead != null) {
        speedScore = maxLead > minLead ? 1 - (b.lead_time_days - minLead) / (maxLead - minLead) : 1;
      }
      // More coverage -> higher score.
      let scopeScore = 0.5;
      if (maxCover > minCover) {
        scopeScore = (coverage(b) - minCover) / (maxCover - minCover);
      }
      const score = Math.round((W_PRICE * priceScore + W_SPEED * speedScore + W_SCOPE * scopeScore) * 1000) / 1000;
      return { bid_id: b.id, score, priceScore, speedScore, scopeScore };
    });

    const ranking = [...scored]
      .sort((a, b) => b.score - a.score)
      .map((s, i) => ({
        bid_id: s.bid_id,
        score: s.score,
        rank: i + 1,
        dimensions: {
          price: Math.round(s.priceScore * 1000) / 1000,
          speed: Math.round(s.speedScore * 1000) / 1000,
          scope: Math.round(s.scopeScore * 1000) / 1000,
        },
      }));

    // -------- per-row "best" winners (for the matrix highlighting) --------
    const pickMin = (sel: (b: CompareBid) => number | null) => {
      let best: string | null = null;
      let bestVal = Infinity;
      for (const b of bids) {
        const v = sel(b);
        if (v != null && v > 0 && v < bestVal) { bestVal = v; best = b.id; }
      }
      return best;
    };
    const pickMax = (sel: (b: CompareBid) => number | null) => {
      let best: string | null = null;
      let bestVal = -Infinity;
      for (const b of bids) {
        const v = sel(b);
        if (v != null && v > bestVal) { bestVal = v; best = b.id; }
      }
      return best;
    };

    const bests = {
      lowest_total_bid_id: pickMin((b) => b.total_cents),
      lowest_all_in_bid_id: pickMin((b) => allIn(b)),
      fastest_bid_id: pickMin((b) => b.lead_time_days),
      lowest_freight_bid_id: pickMin((b) => b.freight_cents),
      lowest_install_bid_id: pickMin((b) => b.install_cents),
      most_scope_bid_id: pickMax((b) => coverage(b)),
      top_ranked_bid_id: ranking.length ? ranking[0].bid_id : null,
    };

    res.json({
      package: packageOut,
      bids,
      ranking,
      bests,
      scoring: {
        weights: { price: W_PRICE, speed: W_SPEED, scope: W_SCOPE },
        dimensions: {
          price: "All-in cost (total + freight + install). Lower is better.",
          speed: "Lead time in days. Faster is better.",
          scope: "Coverage = priced line items + scope notes + warranty. More is better.",
        },
      },
    });
  }),
);

// ---- PATCH /quotes/compare/:packageId/recommend -- upsert the decision -------
router.patch(
  "/compare/:packageId/recommend",
  requireUser,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    await assertCanViewComparison(req, packageId);
    const auth = getAuth(req);

    const selectedBidId: string | null = req.body?.selectedBidId ?? null;
    const notes: string | null = req.body?.notes ?? null;
    const status: string = typeof req.body?.status === "string" ? req.body.status : "draft";

    // Guard: a selected bid must actually belong to this package.
    if (selectedBidId) {
      const ok = await q1(`select 1 from bids where id = $1 and package_id = $2`, [
        selectedBidId,
        packageId,
      ]);
      if (!ok) throw new NotFoundError("selected bid is not on this package");
    }

    const row = await q1<any>(
      `insert into bid_recommendations (package_id, selected_bid_id, notes, status, decided_by)
         values ($1, $2, $3, $4, $5)
       on conflict (package_id) do update set
         selected_bid_id = excluded.selected_bid_id,
         notes = excluded.notes,
         status = excluded.status,
         decided_by = excluded.decided_by,
         updated_at = now()
       returning *`,
      [packageId, selectedBidId, notes, status, auth.userId],
    );
    res.json(row);
  }),
);

// ---- GET /quotes/compare/:packageId/recommendation -- current decision -------
router.get(
  "/compare/:packageId/recommendation",
  requireUser,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    await assertCanViewComparison(req, packageId);
    const row = await q1<any>(
      `select * from bid_recommendations where package_id = $1`,
      [packageId],
    );
    res.json(row ?? null);
  }),
);

export default router;
