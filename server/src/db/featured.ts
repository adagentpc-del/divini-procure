/**
 * Divini Procure - FEATURED VENDOR module (records + tracks, never charges).
 *
 * A vendor can buy a "Featured" placement for a one month period. Like the rest
 * of the monetization layer this is RECORD-ONLY: nothing here calls a payment
 * processor, charges a card, or moves money. It writes the vendor_featured table
 * (active period of one month) so the marketplace ranking/badges can read it.
 * An admin or a future Stripe webhook fills processor_ref when real billing is
 * wired in.
 *
 * The featured price is a fixed constant (9900 = $99/mo), matching the
 * vendor_featured tier seeded in subscription_tiers and the table default.
 *
 * Everything that mutates is gated by the caller on PROCURE_MONETIZATION_V2;
 * the read helpers (isFeatured / featuredCompanyIds) are flag-aware so that with
 * the flag OFF the marketplace sees no featured vendors at all (identical to
 * today). Zero em dashes by convention. Integer cents throughout.
 */
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";

/** Featured placement price in cents ($99/mo). Mirrors the seeded tier. */
export const VENDOR_FEATURED_PRICE_CENTS = 9900;

/** One featured period in milliseconds (approx one month = 30 days). */
const FEATURED_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface FeaturedRow {
  id: string;
  company_id: string | null;
  status: "active" | "cancelled" | "expired";
  price_cents: number;
  started_at: string | null;
  current_period_end: string | null;
  processor_ref: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FeaturedStatus {
  active: boolean;
  price_cents: number;
  status: FeaturedRow["status"] | null;
  started_at: string | null;
  current_period_end: string | null;
}

/**
 * The current active featured row for a company, if any. An "active" row whose
 * current_period_end has passed is treated as not active (lazy expiry).
 */
export async function getActiveFeatured(companyId: string): Promise<FeaturedRow | null> {
  return q1<FeaturedRow>(
    `select * from vendor_featured
       where company_id = $1
         and status = 'active'
         and (current_period_end is null or current_period_end > now())
       order by started_at desc nulls last
       limit 1`,
    [companyId],
  );
}

/** The featured status for a company (price + active flag). Flag-aware. */
export async function featuredStatus(companyId: string): Promise<FeaturedStatus> {
  if (!PROCURE_MONETIZATION_V2) {
    return {
      active: false,
      price_cents: VENDOR_FEATURED_PRICE_CENTS,
      status: null,
      started_at: null,
      current_period_end: null,
    };
  }
  const row = await getActiveFeatured(companyId);
  return {
    active: !!row,
    price_cents: VENDOR_FEATURED_PRICE_CENTS,
    status: row?.status ?? null,
    started_at: row?.started_at ?? null,
    current_period_end: row?.current_period_end ?? null,
  };
}

/**
 * Buy / renew a featured placement for one month. Record-only: writes an active
 * vendor_featured row with started_at = now and current_period_end = now + 1mo.
 * If an active row already exists it is extended in place (idempotent renew)
 * rather than duplicated. Never moves money.
 */
export async function buyFeatured(
  companyId: string,
  processorRef?: string | null,
): Promise<FeaturedRow | null> {
  const existing = await getActiveFeatured(companyId);
  const end = new Date(Date.now() + FEATURED_PERIOD_MS).toISOString();

  if (existing) {
    return q1<FeaturedRow>(
      `update vendor_featured set
         status = 'active',
         price_cents = $2,
         current_period_end = $3,
         processor_ref = coalesce($4, processor_ref),
         updated_at = now()
       where id = $1
       returning *`,
      [existing.id, VENDOR_FEATURED_PRICE_CENTS, end, processorRef ?? null],
    );
  }

  return q1<FeaturedRow>(
    `insert into vendor_featured
       (company_id, status, price_cents, started_at, current_period_end, processor_ref)
     values ($1, 'active', $2, now(), $3, $4)
     returning *`,
    [companyId, VENDOR_FEATURED_PRICE_CENTS, end, processorRef ?? null],
  );
}

/**
 * Cancel a company's active featured placement. Record-only: marks the active
 * row 'cancelled'. Returns the cancelled row (or null when none was active).
 */
export async function cancelFeatured(companyId: string): Promise<FeaturedRow | null> {
  return q1<FeaturedRow>(
    `update vendor_featured set
       status = 'cancelled',
       updated_at = now()
     where company_id = $1 and status = 'active'
     returning *`,
    [companyId],
  );
}

/**
 * True when a company currently holds an active, unexpired featured placement.
 * Flag-aware: returns false when PROCURE_MONETIZATION_V2 is off.
 */
export async function isFeatured(companyId: string): Promise<boolean> {
  if (!PROCURE_MONETIZATION_V2) return false;
  const row = await getActiveFeatured(companyId);
  return !!row;
}

/**
 * Batch helper for the marketplace: the set of company ids that currently hold
 * an active, unexpired featured placement. Use to rank/badge listings without
 * an N+1 of isFeatured calls. Flag-aware: returns an empty set when the flag is
 * off. Defensive: a missing table degrades to an empty set.
 */
export async function featuredCompanyIds(): Promise<Set<string>> {
  if (!PROCURE_MONETIZATION_V2) return new Set();
  try {
    const rows = await q<{ company_id: string }>(
      `select distinct company_id from vendor_featured
         where status = 'active'
           and company_id is not null
           and (current_period_end is null or current_period_end > now())`,
    );
    return new Set(rows.map((r) => r.company_id));
  } catch {
    return new Set();
  }
}
