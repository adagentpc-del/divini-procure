/**
 * Divini Bid Studio - BID TOTALS + READINESS (pure, no IO).
 *
 * Deterministic arithmetic only, same "how this was calculated" transparency
 * principle as the rest of the Divini deterministic business tools: every
 * number here traces back to a stored line item or a stored bid-level field,
 * never a generated estimate.
 *
 * Money convention: bid_line_items.unit_price and bids.price are pre-existing
 * DOLLAR (numeric) columns (see server/src/routes/award-workflow.ts). This
 * module is the ONE place that converts dollar line items into integer-cent
 * totals, matching the rest of the money-handling code in this codebase.
 *
 * Zero em dashes by convention.
 */

export interface BidLineItemInput {
  qty?: number | string | null;
  unitPriceDollars?: number | string | null;
  optional?: boolean | null;
  selected?: boolean | null; // defaults true; only matters when optional=true
}

export interface BidTotalsInput {
  lineItems: BidLineItemInput[];
  taxCents?: number | string | null;
  discountCents?: number | string | null;
  depositCents?: number | string | null;
  depositPercentBasisPoints?: number | string | null; // used only when depositCents is not set
}

export interface BidTotalsResult {
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  depositCents: number;
  lineItemCount: number;
  includedLineItemCount: number;
}

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/** Round dollars to integer cents (half up), never negative. */
function dollarsToCents(dollars: number): number {
  return Math.max(0, Math.round(dollars * 100));
}

/**
 * Compute a bid's totals in integer cents from its line items and bid-level
 * tax/discount/deposit settings.
 *
 * Subtotal = sum over line items of (qty * unitPriceDollars), EXCLUDING an
 * optional line item unless it is explicitly selected. Total = max(0,
 * subtotal - discount) + tax. Deposit is either the explicit depositCents, or
 * depositPercentBasisPoints applied to the total, in that priority order.
 */
export function computeBidTotals(input: BidTotalsInput): BidTotalsResult {
  const items = input.lineItems ?? [];
  let subtotalCents = 0;
  let includedLineItemCount = 0;
  for (const item of items) {
    const included = !item.optional || item.selected !== false;
    if (!included) continue;
    const qty = num(item.qty, 1);
    const unitPriceDollars = num(item.unitPriceDollars, 0);
    subtotalCents += dollarsToCents(qty * unitPriceDollars);
    includedLineItemCount += 1;
  }

  const taxCents = Math.max(0, Math.round(num(input.taxCents, 0)));
  const discountCents = Math.max(0, Math.round(num(input.discountCents, 0)));
  const totalCents = Math.max(0, subtotalCents - discountCents) + taxCents;

  let depositCents: number;
  if (input.depositCents != null) {
    depositCents = Math.max(0, Math.round(num(input.depositCents, 0)));
  } else {
    const bps = Math.max(0, Math.min(10_000, Math.round(num(input.depositPercentBasisPoints, 0))));
    depositCents = Math.round((totalCents * bps) / 10_000);
  }

  return {
    subtotalCents,
    taxCents,
    discountCents,
    totalCents,
    depositCents,
    lineItemCount: items.length,
    includedLineItemCount,
  };
}

export interface BidReadinessInput {
  lineItemCount: number;
  totalCents: number;
  expiresAt?: string | Date | null;
  terms?: string | null;
  hasDepositTerms?: boolean;
  hasAssumptionsOrExclusions?: boolean;
}

export interface ReadinessFactor {
  code: string;
  label: string;
  missingLabel: string;
  points: number;
  met: boolean;
}

export interface BidReadinessResult {
  score: number;
  positives: string[];
  missing: string[];
  factors: ReadinessFactor[];
}

/** Same checklist-scoring shape as pipeline-score.ts / scope-completeness.ts. */
export function scoreBidReadiness(input: BidReadinessInput): BidReadinessResult {
  const factors: ReadinessFactor[] = [
    {
      code: "line_items",
      label: "Has at least one line item",
      missingLabel: "No line items yet",
      points: 30,
      met: (input.lineItemCount ?? 0) > 0,
    },
    {
      code: "total",
      label: "Total is greater than zero",
      missingLabel: "Total is zero",
      points: 20,
      met: (input.totalCents ?? 0) > 0,
    },
    {
      code: "expires_at",
      label: "Expiration date set",
      missingLabel: "Expiration date not set",
      points: 15,
      met: !!input.expiresAt,
    },
    {
      code: "terms",
      label: "Terms provided",
      missingLabel: "Terms not provided",
      points: 15,
      met: !!(input.terms && input.terms.trim().length > 0),
    },
    {
      code: "deposit",
      label: "Deposit terms set",
      missingLabel: "Deposit terms not set",
      points: 10,
      met: !!input.hasDepositTerms,
    },
    {
      code: "assumptions",
      label: "Assumptions or exclusions listed",
      missingLabel: "No assumptions or exclusions listed",
      points: 10,
      met: !!input.hasAssumptionsOrExclusions,
    },
  ];

  let score = 0;
  const positives: string[] = [];
  const missing: string[] = [];
  for (const f of factors) {
    if (f.met) {
      score += f.points;
      positives.push(f.label);
    } else {
      missing.push(f.missingLabel);
    }
  }
  return { score: Math.max(0, Math.min(100, score)), positives, missing, factors };
}
