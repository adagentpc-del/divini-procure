/**
 * Divini Procure - vendor invite response time (competitive gap #15,
 * docs/competitive-analysis-2026-08.md: "richer trust badges... response-
 * time SLAs"). Facts only, never a score - same explicit rule as
 * lib/vendor-signals.ts, lib/prequalification.ts and
 * lib/payment-reputation.ts.
 *
 * The only honest "response" signal this schema has is the gap between a
 * bid_invites row being created (a developer inviting a vendor to bid on a
 * package via Procurement Intelligence) and that same vendor's first bid on
 * that same package landing in bids. bid_invites.status is never actually
 * advanced to 'bid_submitted' by any write path in this codebase (checked:
 * no route updates it past 'invited'/'viewed'), so this deliberately does
 * NOT read that status column - it derives the fact straight from the two
 * canonical timestamps that are always correct: bid_invites.created_at and
 * bids.created_at.
 *
 * This only covers vendors who were formally invited through the intel
 * flow and then bid - it says nothing about vendors who found a package via
 * open marketplace search and bid without ever being invited. That is a
 * real scope limit, not an oversight: there is no "vendor first viewed this
 * package" timestamp for the non-invited path, so no honest response-time
 * fact can be computed for it.
 *
 * Deliberately public to any authenticated user (no relationship gate),
 * matching payment-reputation.ts's precedent: only aggregate day-counts are
 * returned, never which packages or which developer, so there is nothing
 * sensitive for the admin-context query to expose.
 */
import { q } from "../pool.js";
import { runAsAdmin } from "./requestContext.js";

export interface ResponseTimeSnapshot {
  vendorCompanyId: string;
  respondedInviteCount: number;
  averageDaysToRespond: number | null;
  fastestDaysToRespond: number | null;
  slowestDaysToRespond: number | null;
}

export async function computeInviteResponseTime(vendorCompanyId: string): Promise<ResponseTimeSnapshot> {
  const rows = await runAsAdmin(() =>
    q<{ days: number }>(
      `select extract(epoch from (first_bid.created_at - bi.created_at)) / 86400.0 as days
         from bid_invites bi
         join lateral (
           select b.created_at
             from bids b
            where b.package_id = bi.package_id
              and b.vendor_company_id = bi.vendor_company_id
            order by b.created_at asc
            limit 1
         ) first_bid on true
        where bi.vendor_company_id = $1
          and first_bid.created_at >= bi.created_at`,
      [vendorCompanyId],
    ),
  );

  const days = rows.map((r) => Number(r.days)).filter((d) => Number.isFinite(d) && d >= 0);
  const respondedInviteCount = days.length;

  if (respondedInviteCount === 0) {
    return {
      vendorCompanyId,
      respondedInviteCount: 0,
      averageDaysToRespond: null,
      fastestDaysToRespond: null,
      slowestDaysToRespond: null,
    };
  }

  const sum = days.reduce((s, d) => s + d, 0);

  return {
    vendorCompanyId,
    respondedInviteCount,
    averageDaysToRespond: Math.round((sum / respondedInviteCount) * 10) / 10,
    fastestDaysToRespond: Math.round(Math.min(...days) * 10) / 10,
    slowestDaysToRespond: Math.round(Math.max(...days) * 10) / 10,
  };
}
