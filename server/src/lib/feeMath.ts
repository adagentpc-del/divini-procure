/**
 * Divini Procure - PURE FEE ARITHMETIC (dependency-free).
 *
 * This module contains ONLY pure arithmetic for platform/referral fees and the
 * protected grandfathered existing-relationship fee. It has NO imports: no env,
 * no config, no DB. fee-rules.ts delegates its number-crunching here so the math
 * can be unit-tested in isolation.
 *
 * Money is handled in integer cents to avoid floating point drift, and fee
 * amounts are rounded to the nearest cent.
 *
 * Zero em dashes by convention.
 */

/** The protected grandfathered existing-relationship rate (percent). */
export const GRANDFATHERED_FEE_PERCENTAGE = 2.0;

/** The platform default rate (percent) when nothing else applies. */
export const DEFAULT_STANDARD_FEE_PERCENTAGE = 10.0;

/** Coerce a number-or-numeric-string-or-nullish into a finite number. */
export function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute a fee amount (integer cents) from a base amount (cents) and a
 * percentage rate. The base is clamped to a non-negative whole number of cents,
 * the fee is rounded to the nearest cent, and the result is never negative.
 *
 * Examples (10%): 10_000 -> 1_000, 12_345 -> 1_235 (round half up via Math.round).
 */
export function feeCentsFromPercentage(baseCents: number | string | null | undefined, percentage: number | string | null | undefined): number {
  const base = Math.max(0, Math.round(num(baseCents)));
  const pct = num(percentage);
  const fee = Math.round((base * pct) / 100);
  return Math.max(0, fee);
}

/**
 * Monetization V2 success-fee defaults (percent + cap in cents). The success fee
 * is charged to the WINNING vendor on a platform-sourced award: a low percentage
 * of the awarded contract, CAPPED so it never becomes punitive on large
 * construction deals. Grandfathered existing-relationship pairs get a lower rate
 * and cap. All are overridable via env (see config.ts); these are the fallbacks.
 */
export const PROCURE_STANDARD_SUCCESS_PCT_DEFAULT = 2.0;
export const PROCURE_STANDARD_SUCCESS_CAP_CENTS_DEFAULT = 250000; // $2,500
export const PROCURE_GRANDFATHERED_SUCCESS_PCT_DEFAULT = 1.0;
export const PROCURE_GRANDFATHERED_CAP_CENTS_DEFAULT = 100000; // $1,000

/**
 * Success fee in integer cents: a percentage of the award, capped. The cap is
 * applied only when capCents > 0; a non-positive cap means "no cap". Never
 * negative. This is the V2 money model: the platform earns on the WIN, and the
 * vendor never pays a scary percentage on a large award.
 *
 * Example: 2% of $1,000,000 award = $20,000, capped at $2,500 -> 250000 cents.
 *          2% of $100,000 award = $2,000 (under the cap) -> 200000 cents.
 */
export function successFeeCents(
  awardCents: number | string | null | undefined,
  percentage: number | string | null | undefined,
  capCents: number | string | null | undefined,
): number {
  const raw = feeCentsFromPercentage(awardCents, percentage);
  const cap = Math.round(num(capCents));
  if (cap > 0) return Math.min(raw, cap);
  return raw;
}

/** Shape we need from a developer_vendor_relationships row to resolve the rate. */
export interface RelationshipFeeInput {
  relationship_status?: string | null;
  grandfathered_fee_eligible?: boolean | null;
  grandfathered_fee_percentage?: number | string | null;
  grandfathered_fee_applies_forever?: boolean | null;
  standard_fee_percentage?: number | string | null;
}

export interface ResolvedFee {
  feePercentage: number;
  grandfathered: boolean;
  source: "grandfathered_2_percent" | "standard";
  appliesForever: boolean;
  label: string;
}

/**
 * Pure resolution of the effective fee rate for a developer-vendor relationship.
 *
 * Protected logic: a pair is grandfathered ONLY when its relationship_status is
 * exactly 'grandfathered_2_percent' AND grandfathered_fee_eligible is true. In
 * that case the rate is the stored grandfathered_fee_percentage (defaults to the
 * grandfathered constant), and nothing here can promote a non-grandfathered pair
 * or demote a grandfathered one. A null/absent relationship means standard fee.
 *
 * The platform standard rate is passed in (standardFeePercentage) so this module
 * stays free of env/config reads; callers supply STANDARD_FEE_PERCENTAGE.
 */
export function resolveFeeRule(
  rel: RelationshipFeeInput | null | undefined,
  standardFeePercentage: number = DEFAULT_STANDARD_FEE_PERCENTAGE,
): ResolvedFee {
  const standardPct = rel && rel.standard_fee_percentage != null
    ? num(rel.standard_fee_percentage, standardFeePercentage)
    : standardFeePercentage;

  const isGrandfathered =
    !!rel &&
    rel.relationship_status === "grandfathered_2_percent" &&
    !!rel.grandfathered_fee_eligible;

  if (isGrandfathered) {
    const pct = num(rel!.grandfathered_fee_percentage, GRANDFATHERED_FEE_PERCENTAGE);
    return {
      feePercentage: pct,
      grandfathered: true,
      source: "grandfathered_2_percent",
      appliesForever: rel!.grandfathered_fee_applies_forever !== false,
      label: `Grandfathered Existing Vendor Relationship - ${pct}% payment authorization fee.`,
    };
  }

  return {
    feePercentage: standardPct,
    grandfathered: false,
    source: "standard",
    appliesForever: false,
    label: "Standard Divini Procure platform/referral fee applies.",
  };
}
