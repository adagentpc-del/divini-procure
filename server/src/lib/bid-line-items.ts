/**
 * Divini Procure - Phase 1 P1-05: consolidated bid line-item read path.
 *
 * Formalizes, in ONE place, the prefer/fallback rule that previously lived
 * only inline in quote-comparison.ts (Option A of the Phase 0 bid-data
 * consolidation plan, docs/bid-data-consolidation-plan.md: the system
 * already has a canonical-selection rule, just not a canonical table - codify
 * it everywhere a bid's line items are read instead of leaving each caller to
 * independently reimplement the same fallback). No schema migration, no data
 * movement - `bid_items` (structured, tied to a buyer-defined
 * package_line_items row) and `bid_line_items` (freeform, vendor-authored via
 * Bid Studio) remain two separate tables; every historical row in both is
 * preserved untouched.
 */
import { q } from "../pool.js";

export interface ResolvedBidLineItem {
  id: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
  source: "structured" | "freeform";
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A bid's line items: `bid_items` (structured, priced against the package's
 * own bill of quantities) when any exist, else `bid_line_items` (freeform,
 * vendor-authored) as a fallback. Mirrors quote-comparison.ts's own prior
 * inline logic exactly (same ordering, same coalesce rules) so this
 * refactor changes no behavior, only removes the duplication.
 */
export async function getBidLineItems(bidId: string): Promise<ResolvedBidLineItem[]> {
  const structured = await q<any>(
    `select bi.id, coalesce(pli.description, 'Line item') as name,
            coalesce(bi.qty, pli.qty, 1) as qty,
            coalesce(bi.unit_price, 0) as unit_price,
            coalesce(bi.amount, coalesce(bi.unit_price,0) * coalesce(bi.qty, pli.qty, 1)) as amount
       from bid_items bi
       left join package_line_items pli on pli.id = bi.line_item_id
      where bi.bid_id = $1
      order by pli.sort nulls last, bi.id`,
    [bidId],
  );
  if (structured.length > 0) {
    return structured.map((li) => ({
      id: String(li.id),
      name: String(li.name),
      qty: toNum(li.qty),
      unitPriceCents: Math.round(toNum(li.unit_price) * 100),
      amountCents: Math.round(toNum(li.amount) * 100),
      source: "structured" as const,
    }));
  }

  const freeform = await q<any>(
    `select id, coalesce(name, 'Line item') as name,
            coalesce(qty, 1) as qty, coalesce(unit_price, 0) as unit_price,
            coalesce(unit_price, 0) * coalesce(qty, 1) as amount
       from bid_line_items where bid_id = $1 order by sort_order nulls last, id`,
    [bidId],
  );
  return freeform.map((li) => ({
    id: String(li.id),
    name: String(li.name),
    qty: toNum(li.qty),
    unitPriceCents: Math.round(toNum(li.unit_price) * 100),
    amountCents: Math.round(toNum(li.amount) * 100),
    source: "freeform" as const,
  }));
}

/** Sum of a bid's resolved line items, in cents. */
export async function sumBidLineItemsCents(bidId: string): Promise<number> {
  const items = await getBidLineItems(bidId);
  return items.reduce((sum, li) => sum + li.amountCents, 0);
}
