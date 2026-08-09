/**
 * Divini Procure - Phase 1 P1-17: vendor performance FACTUAL signals.
 *
 * "Do not create an opaque AI vendor score. Capture factual signals... Only
 * record facts the system actually knows." This is deliberately NOT a
 * score - every field here is a real count/amount/date pulled directly from
 * a canonical table, with no weighting, no normalization, no model. It is
 * the kind of clean, factual per-node feature vector
 * docs/procurement-graph-readiness.md describes a future Procurement Graph
 * needing as a baseline - captured here, used nowhere else this phase.
 *
 * Deliberately reuses lib/procure-moat.ts's existing tables (bid_invites,
 * bids, reviews) rather than duplicating their queries - this is an
 * additional FACTUAL view alongside moat.ts's deterministic Divini Score,
 * not a replacement for it.
 */
import { q, q1 } from "../pool.js";
import { num } from "./financial-model.js";

export interface VendorRelationshipSignals {
  vendorCompanyId: string;
  developerCompanyId: string;
  timesInvited: number;
  timesResponded: number;
  bidsSubmitted: number;
  timesShortlisted: number;
  timesAwarded: number;
  totalOriginalBidCents: number;
  totalFinalAwardCents: number;
  totalApprovedChangeOrderCents: number;
  packagesFulfilled: number;
  packagesFinanciallyClosed: number;
  totalFinalCostCents: number;
  reviewCount: number;
  averageStars: number | null;
  isRepeatRelationship: boolean;
}

/**
 * Every real, known fact about one vendor/developer procurement
 * relationship - computed live from canonical tables, never cached.
 */
export async function computeVendorRelationshipSignals(
  vendorCompanyId: string,
  developerCompanyId: string,
): Promise<VendorRelationshipSignals> {
  const packageIds = await q<{ id: string }>(
    `select distinct p.id
       from packages p
       join buildings b on b.id = p.building_id
      where b.company_id = $1
        and (
          exists (select 1 from bid_invites bi where bi.package_id = p.id and bi.vendor_company_id = $2)
          or exists (select 1 from bids bd where bd.package_id = p.id and bd.vendor_company_id = $2)
        )`,
    [developerCompanyId, vendorCompanyId],
  );

  const invites = await q1<{ n: number }>(
    `select count(*)::int as n from bid_invites bi
       join packages p on p.id = bi.package_id
       join buildings b on b.id = p.building_id
      where bi.vendor_company_id = $1 and b.company_id = $2`,
    [vendorCompanyId, developerCompanyId],
  );

  const bids = await q<{ price: number | null; package_id: string }>(
    `select bd.price, bd.package_id from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      where bd.vendor_company_id = $1 and b.company_id = $2
        and coalesce(bd.is_draft, false) = false`,
    [vendorCompanyId, developerCompanyId],
  );

  const shortlisted = await q1<{ n: number }>(
    `select count(*)::int as n from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      where bd.vendor_company_id = $1 and b.company_id = $2 and bd.status = 'shortlisted'`,
    [vendorCompanyId, developerCompanyId],
  );

  const awards = await q<{ awarded_amount_cents: number | null; package_id: string; status: string }>(
    `select a.awarded_amount_cents, a.package_id, a.status from awards a
       where a.vendor_company_id = $1 and a.developer_company_id = $2`,
    [vendorCompanyId, developerCompanyId],
  );
  const activeAwards = awards.filter((a) => a.status === "active");

  const cos = await q<{ cost_impact_cents: number | null }>(
    `select co.cost_impact_cents from change_orders co
      where co.vendor_company_id = $1 and co.developer_company_id = $2 and co.status = 'approved'`,
    [vendorCompanyId, developerCompanyId],
  );

  const fulfilledPos = await q1<{ n: number }>(
    `select count(*)::int as n from purchase_orders po
      where po.vendor_company_id = $1 and po.developer_company_id = $2 and po.status = 'fulfilled'`,
    [vendorCompanyId, developerCompanyId],
  );

  const closedPackages = await q<{ final_cost_cents: number | null }>(
    `select p.final_cost_cents from packages p
       join buildings b on b.id = p.building_id
      where b.company_id = $2 and p.financially_closed_at is not null
        and exists (select 1 from awards a where a.package_id = p.id and a.vendor_company_id = $1)`,
    [vendorCompanyId, developerCompanyId],
  );

  const reviewStats = await q1<{ n: number; avg: number | null }>(
    `select count(*)::int as n, avg(stars) as avg from reviews
      where ratee_company_id = $1 and rater_company_id = $2`,
    [vendorCompanyId, developerCompanyId],
  );

  return {
    vendorCompanyId,
    developerCompanyId,
    timesInvited: num(invites?.n),
    timesResponded: bids.length,
    bidsSubmitted: bids.length,
    timesShortlisted: num(shortlisted?.n),
    timesAwarded: awards.length,
    totalOriginalBidCents: bids.reduce((s, b) => s + (b.price != null ? Math.round(Number(b.price) * 100) : 0), 0),
    totalFinalAwardCents: activeAwards.reduce((s, a) => s + num(a.awarded_amount_cents), 0),
    totalApprovedChangeOrderCents: cos.reduce((s, c) => s + num(c.cost_impact_cents), 0),
    packagesFulfilled: num(fulfilledPos?.n),
    packagesFinanciallyClosed: closedPackages.length,
    totalFinalCostCents: closedPackages.reduce((s, p) => s + num(p.final_cost_cents), 0),
    reviewCount: num(reviewStats?.n),
    averageStars: reviewStats?.avg != null ? Math.round(Number(reviewStats.avg) * 100) / 100 : null,
    isRepeatRelationship: packageIds.length > 1,
  };
}
