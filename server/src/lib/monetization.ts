/**
 * Divini Procure - MONETIZATION ENGINE (records + accrues, never charges).
 *
 * Two responsibilities, both write-once accruals on top of the existing fee
 * resolution and referral primitives. Nothing here calls a payment processor,
 * charges a card, or moves money. It RECORDS a platform_revenue accrual and,
 * when applicable, a pending partner_commissions row. An admin later marks
 * revenue collected by hand.
 *
 *   resolveAndRecordFee()        -> resolve the correct fee via resolveContextFee
 *                                   (grandfathered 2% > matrix > standard), then
 *                                   insert/update one platform_revenue row at
 *                                   status 'accrued'. Idempotent per payment
 *                                   authorization id.
 *   maybeRecordReferralCommission() -> if the referred (developer) company was
 *                                   brought in by an active referral partner,
 *                                   record a pending profit-based commission
 *                                   using the SAME math as partner-rev.ts. Best
 *                                   effort: never throws into the caller.
 *
 * Reuses resolveContextFee (fee-matrix.ts), which itself reuses getByPair +
 * resolveFee, so the protected grandfathered rate is honored automatically.
 * Zero em dashes by convention. Integer cents throughout.
 */
import { q, q1 } from "../pool.js";
import { resolveContextFee } from "./fee-matrix.js";

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

export interface ResolveAndRecordFeeInput {
  developerCompanyId?: string | null;
  vendorCompanyId?: string | null;
  baseCents: number;
  purchaseOrderId?: string | null;
  paymentAuthorizationId?: string | null;
  programId?: string | null;
  ruleType?: string | null;
  /** 'procurement_fee' (default) | 'capital_introduction' | 'subscription' | 'manual' */
  sourceType?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
}

export interface ResolveAndRecordFeeResult {
  feePercentage: number | null;
  feeCents: number;
  feeSource: string;
  payerType: string;
  revenueId: string | null;
}

const SOURCE_TYPES = new Set([
  "procurement_fee",
  "capital_introduction",
  "subscription",
  "manual",
]);

/**
 * Resolve the correct fee for a developer/vendor/base context and RECORD it as
 * an accrued platform_revenue row. The fee is whatever resolveContextFee
 * returns (grandfathered 2% pair wins, else the most specific matrix rule, else
 * the platform standard). fee_cents is round(base * pct/100), or flatCents when
 * the resolved rule is a flat fee. Idempotent per paymentAuthorizationId: if a
 * row already exists for that authorization, it is UPDATED in place rather than
 * duplicated. Never moves money; status is always 'accrued' on write.
 */
export async function resolveAndRecordFee(
  input: ResolveAndRecordFeeInput,
): Promise<ResolveAndRecordFeeResult> {
  const baseCents = Math.max(0, Math.round(num(input.baseCents)));
  const sourceType =
    input.sourceType && SOURCE_TYPES.has(input.sourceType) ? input.sourceType : "procurement_fee";

  const resolved = await resolveContextFee({
    developerCompanyId: input.developerCompanyId ?? null,
    vendorCompanyId: input.vendorCompanyId ?? null,
    ruleType: input.ruleType ?? null,
    programId: input.programId ?? null,
  });

  const pct = resolved.percentage;
  const flatCents = resolved.flatCents;
  let feeCents: number;
  if (flatCents != null && (pct == null || flatCents > 0)) {
    // Flat-fee rule: accrue the flat amount.
    feeCents = Math.max(0, Math.round(num(flatCents)));
  } else {
    feeCents = Math.max(0, Math.round((baseCents * num(pct)) / 100));
  }

  const result: ResolveAndRecordFeeResult = {
    feePercentage: pct,
    feeCents,
    feeSource: resolved.source,
    payerType: resolved.payer_type,
    revenueId: null,
  };

  // Idempotent per payment authorization: update the existing accrual if any.
  if (input.paymentAuthorizationId) {
    const existing = await q1<{ id: string; status: string }>(
      `select id, status from platform_revenue where payment_authorization_id = $1`,
      [input.paymentAuthorizationId],
    );
    if (existing) {
      // Only refresh the fee math + context while the row is still 'accrued'.
      // Once an admin has invoiced/collected/waived/void it, leave it alone.
      if (existing.status === "accrued") {
        const updated = await q1<{ id: string }>(
          `update platform_revenue set
             source_type = $1,
             developer_company_id = $2,
             vendor_company_id = $3,
             purchase_order_id = $4,
             program_id = $5,
             base_cents = $6,
             fee_percentage = $7,
             fee_cents = $8,
             fee_source = $9,
             payer_type = $10,
             updated_at = now()
           where id = $11 returning id`,
          [
            sourceType,
            input.developerCompanyId ?? null,
            input.vendorCompanyId ?? null,
            input.purchaseOrderId ?? null,
            input.programId ?? null,
            baseCents,
            pct,
            feeCents,
            resolved.source,
            resolved.payer_type,
            existing.id,
          ],
        );
        result.revenueId = updated?.id ?? existing.id;
      } else {
        result.revenueId = existing.id;
      }
      return result;
    }
  }

  const row = await q1<{ id: string }>(
    `insert into platform_revenue
       (source_type, developer_company_id, vendor_company_id, purchase_order_id,
        payment_authorization_id, program_id, base_cents, fee_percentage, fee_cents,
        fee_source, payer_type, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'accrued',$12)
     returning id`,
    [
      sourceType,
      input.developerCompanyId ?? null,
      input.vendorCompanyId ?? null,
      input.purchaseOrderId ?? null,
      input.paymentAuthorizationId ?? null,
      input.programId ?? null,
      baseCents,
      pct,
      feeCents,
      resolved.source,
      resolved.payer_type,
      input.actorEmail ?? input.actorUserId ?? null,
    ],
  );
  result.revenueId = row?.id ?? null;
  return result;
}

export interface MaybeReferralInput {
  /** The company that was (possibly) referred. For procurement this is the developer. */
  referredCompanyId?: string | null;
  platformFeeCents: number;
  processingCostCents?: number | null;
  /** partner_commissions.source: subscription | transaction | setup | enterprise | manual_adjustment */
  source?: string | null;
  actorEmail?: string | null;
}

export interface MaybeReferralResult {
  created: boolean;
  commissionCents: number;
  partnerId?: string | null;
  reason?: string;
}

const COMMISSION_SOURCES = new Set([
  "subscription",
  "transaction",
  "setup",
  "enterprise",
  "manual_adjustment",
]);

/**
 * If referredCompanyId was brought in by an active referral partner, record a
 * pending partner_commissions row using the SAME profit-based math as
 * partner-rev.ts:
 *   net_profit = max(0, platformFee - processingCost)
 *   commission = round(net_profit * revenue_share_pct / 100)   (percent / default)
 *              = flat_fee_cents                                 (flat)
 * Best effort: any failure is swallowed and reported as { created: false }, so a
 * referral lookup problem can never break the award/payment flow. Never moves
 * money. The commission is recorded at status 'pending' for later admin payout.
 */
export async function maybeRecordReferralCommission(
  input: MaybeReferralInput,
): Promise<MaybeReferralResult> {
  try {
    const referredCompanyId = input.referredCompanyId ?? null;
    if (!referredCompanyId) return { created: false, commissionCents: 0, reason: "no_company" };

    const platformFee = Math.max(0, Math.round(num(input.platformFeeCents)));
    const processingCost = Math.max(0, Math.round(num(input.processingCostCents)));
    const source = input.source && COMMISSION_SOURCES.has(input.source) ? input.source : "transaction";

    // Find the active referral partner that brought this company in. A company
    // is attributed either via a referral_partners.company_id direct link, or
    // via a user_referrals row whose code matches a partner referral_code and
    // whose referred_email belongs to a member of this company. Prefer a direct
    // company link; fall back to the email-based attribution.
    const partner = await q1<{
      id: string;
      commission_type: string | null;
      revenue_share_pct: number | string | null;
      flat_fee_cents: number | string | null;
      status: string | null;
    }>(
      `select rp.id, rp.commission_type, rp.revenue_share_pct, rp.flat_fee_cents, rp.status
         from referral_partners rp
        where rp.status = 'active'
          and (
            rp.company_id = $1
            or exists (
              select 1
                from user_referrals ur
                join company_members cm on lower(cm_user.email) = lower(ur.referred_email)
                join users cm_user on cm_user.id = cm.user_id
               where ur.code = rp.referral_code
                 and cm.company_id = $1
            )
          )
        order by case when rp.company_id = $1 then 0 else 1 end
        limit 1`,
      [referredCompanyId],
    );

    if (!partner) return { created: false, commissionCents: 0, reason: "no_partner" };

    const netProfit = Math.max(0, platformFee - processingCost);
    const sharePct = num(partner.revenue_share_pct, 0);
    const flat = Math.max(0, Math.round(num(partner.flat_fee_cents, 0)));
    const type = partner.commission_type ?? "percent";
    const commissionCents =
      type === "flat" ? flat : Math.max(0, Math.round((netProfit * sharePct) / 100));

    const row = await q1<{ id: string }>(
      `insert into partner_commissions
         (partner_id, referred_company_id, source, gross_cents, platform_fee_cents,
          processing_cost_cents, net_profit_cents, commission_cents, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning id`,
      [
        partner.id,
        referredCompanyId,
        source,
        platformFee, // gross reference: the platform fee that triggered this
        platformFee,
        processingCost,
        netProfit,
        commissionCents,
      ],
    );

    return {
      created: !!row,
      commissionCents,
      partnerId: partner.id,
    };
  } catch {
    // Best effort: never throw into the caller.
    return { created: false, commissionCents: 0, reason: "error" };
  }
}
