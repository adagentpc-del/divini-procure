/**
 * Divini Procure - FREE-TIER BID CREDITS (Monetization V2).
 *
 * Free vendors get PROCURE_FREE_BIDS_PER_QUARTER (default 5) NEW bid submissions
 * per calendar quarter. No rollover: each quarter is its own vendor_bid_credits
 * row keyed by (company_id, period_key) starting at 0, so the annual allotment
 * (4 x per-quarter) naturally terminates because old quarter rows are never
 * reused. A WIN never consumes a credit; only a NEW bid submission does.
 *
 * Vendor Pro (isVendorPro) is UNLIMITED and is never metered or counted.
 *
 * Everything is gated on PROCURE_MONETIZATION_V2. When the flag is OFF, there is
 * no limit at all: getBidCredits reports unlimited and consumeBidCredit is a
 * no-op that always allows.
 *
 * The quarter-key + limit arithmetic is extracted as PURE helpers (periodKeyFor,
 * remainingBids, isOverLimit) so it can be unit tested with no DB.
 *
 * Zero em dashes by convention.
 */
// NOTE on imports: the DB pool, config, and entitlements are imported LAZILY
// inside the async DB-backed functions (dynamic import) rather than at module
// top. This keeps the module's top-level dependency-free so the PURE helpers
// (periodKeyFor / remainingBids / isOverLimit) can be unit tested under the Node
// built-in test runner with --experimental-strip-types, which does not rewrite
// ".js" specifiers to their ".ts" source. Runtime behavior is unchanged.

export interface BidCredits {
  periodKey: string;
  used: number;
  limit: number | null; // null means unlimited
  remaining: number | null; // null means unlimited
  unlimited: boolean;
}

export interface ConsumeResult {
  ok: boolean;
  periodKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  /** Set when ok is false: a machine-readable reason for the caller. */
  reason?: "limit_reached";
}

// ---------------------------------------------------------------------------
// PURE helpers (no IO) - unit tested in tests/bidCredits.test.ts
// ---------------------------------------------------------------------------

/**
 * Calendar-quarter key for a date, e.g. "2026Q3". Q1 = Jan-Mar, Q2 = Apr-Jun,
 * Q3 = Jul-Sep, Q4 = Oct-Dec. Uses UTC so the boundary is deterministic and
 * does not drift with server timezone.
 */
export function periodKeyFor(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1; // 1..4
  return `${year}Q${quarter}`;
}

/** Remaining bids for a used count against a limit. A null limit is unlimited. */
export function remainingBids(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  const u = Number.isFinite(used) ? used : 0;
  return Math.max(0, limit - u);
}

/** True when used has reached/exceeded the limit. A null limit is never over. */
export function isOverLimit(used: number, limit: number | null): boolean {
  if (limit === null) return false;
  const u = Number.isFinite(used) ? used : 0;
  return u >= limit;
}

// ---------------------------------------------------------------------------
// DB-backed API
// ---------------------------------------------------------------------------

/** The configured per-quarter limit (default 5), clamped to >= 0. */
function freeLimitFrom(perQuarter: number): number {
  const n = Number(perQuarter);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/**
 * Read a company's bid-credit state for the current quarter.
 *   - Flag off  -> unlimited.
 *   - Vendor Pro -> unlimited.
 *   - Otherwise  -> the free per-quarter limit, with `used` read from
 *                   vendor_bid_credits for the current period_key (0 if no row).
 * Defensive: a missing table/row degrades to 0 used.
 */
export async function getBidCredits(companyId: string): Promise<BidCredits> {
  const { q1 } = await import("../pool.js");
  const { PROCURE_MONETIZATION_V2, PROCURE_FREE_BIDS_PER_QUARTER } = await import("../config.js");
  const { isVendorPro } = await import("./entitlements.js");

  const periodKey = periodKeyFor();

  if (!PROCURE_MONETIZATION_V2) {
    return { periodKey, used: 0, limit: null, remaining: null, unlimited: true };
  }
  if (await isVendorPro(companyId)) {
    return { periodKey, used: 0, limit: null, remaining: null, unlimited: true };
  }

  const limit = freeLimitFrom(PROCURE_FREE_BIDS_PER_QUARTER);
  let used = 0;
  try {
    const row = await q1<{ used: number | string }>(
      `select used from vendor_bid_credits where company_id = $1 and period_key = $2`,
      [companyId, periodKey],
    );
    used = row ? Number(row.used) || 0 : 0;
  } catch {
    used = 0;
  }
  return { periodKey, used, limit, remaining: remainingBids(used, limit), unlimited: false };
}

/**
 * Consume one bid credit for the current quarter, enforcing the free limit.
 * Returns { ok:false, reason:'limit_reached' } when no credits remain. Pro
 * vendors and the flag-off case always return ok:true WITHOUT counting.
 *
 * The increment is atomic and limit-checked in a single statement: it upserts
 * the quarter row and only bumps `used` when it is still below the limit,
 * returning the post-state so a race cannot push usage past the cap.
 */
export async function consumeBidCredit(companyId: string): Promise<ConsumeResult> {
  const { q1 } = await import("../pool.js");
  const { PROCURE_MONETIZATION_V2, PROCURE_FREE_BIDS_PER_QUARTER } = await import("../config.js");
  const { isVendorPro } = await import("./entitlements.js");

  const periodKey = periodKeyFor();

  if (!PROCURE_MONETIZATION_V2) {
    return { ok: true, periodKey, used: 0, limit: null, remaining: null, unlimited: true };
  }
  if (await isVendorPro(companyId)) {
    return { ok: true, periodKey, used: 0, limit: null, remaining: null, unlimited: true };
  }

  const limit = freeLimitFrom(PROCURE_FREE_BIDS_PER_QUARTER);

  // Atomic upsert-and-increment, gated on the limit. On a fresh quarter the row
  // is inserted with used = 1. On an existing row, used is bumped only while it
  // is still below the limit; if already at the limit the UPDATE sets used to
  // itself (no change) so the returned value reflects the unchanged at-limit
  // count and we can detect that no credit was actually consumed.
  const row = await q1<{ used: number | string; was_below: boolean }>(
    `insert into vendor_bid_credits (company_id, period_key, used)
       values ($1, $2, 1)
     on conflict (company_id, period_key) do update
       set used = case when vendor_bid_credits.used < $3
                       then vendor_bid_credits.used + 1
                       else vendor_bid_credits.used end,
           updated_at = now()
     returning used, (used <= $3) as was_below`,
    [companyId, periodKey, limit],
  );

  const used = row ? Number(row.used) || 0 : 0;
  // A credit was consumed when the post-increment used count is within the cap.
  // If the row was already at/over the limit, the update was a no-op and used
  // stayed at the cap, so consumption is rejected.
  const consumed = used <= limit && used > 0 && Boolean(row?.was_below);

  if (!consumed) {
    return {
      ok: false,
      reason: "limit_reached",
      periodKey,
      used,
      limit,
      remaining: remainingBids(used, limit),
      unlimited: false,
    };
  }

  return {
    ok: true,
    periodKey,
    used,
    limit,
    remaining: remainingBids(used, limit),
    unlimited: false,
  };
}
