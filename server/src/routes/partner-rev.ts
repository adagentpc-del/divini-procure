/**
 * Divini Procure - REFERRAL PARTNER REVENUE (commission ledger + payouts).
 *
 * Mounted under /api in routes.ts, so the full paths are /api/admin/partner-rev/...
 * Enhancement on top of the EXISTING referral_partners table (admin-extra.ts).
 * Brings Procure up to the Divini Partners admin level: a PROFIT-BASED
 * commission ledger plus payout tracking/management.
 *
 * Ports the profit-based commission math from Divini Partners'
 * lib/partnerCommission.ts:
 *
 *     net_profit  = max(0, platform_fee_cents - processing_cost_cents)
 *     commission  = round(net_profit * share% / 100)        (percent / default)
 *                 = flat_fee_cents                          (flat)
 *
 * The partner's share is its revenue_share_pct; commission is NEVER a share of
 * the gross invoice. Procure's referral_partners has no applies-to / subscription
 * toggles (Partners does), so every source earns; that can be tightened later.
 *
 * This module RECORDS and TRACKS payouts; it NEVER moves money (a real ACH
 * provider is required for disbursement). All amounts are integer cents.
 *
 * Endpoints (all requireAdmin):
 *   GET   /admin/partner-rev/:partnerId                  partner + commissions + payouts + totals
 *   POST  /admin/partner-rev/:partnerId/commissions      add a commission (computes net + commission)
 *   PATCH /admin/partner-rev/commissions/:id             { status?, excluded? }
 *   POST  /admin/partner-rev/:partnerId/payouts/compute  roll up a period into a payout
 *   PATCH /admin/partner-rev/payouts/:id                 { status?, manual_adjustment_cents?, commission_paid_cents? }
 *   GET   /admin/partner-rev/payouts?partnerId=          list payouts
 *
 * Zero em dashes in this file by convention of the ported routers.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---------------------------------------------------------------------------
// Profit-based commission engine (pure; ported from Partners lib/partnerCommission.ts)
// ---------------------------------------------------------------------------
const COMMISSION_SOURCES = [
  "subscription",
  "transaction",
  "setup",
  "enterprise",
  "manual_adjustment",
] as const;
type CommissionSource = (typeof COMMISSION_SOURCES)[number];

const COMMISSION_STATUSES = ["pending", "approved", "paid", "held", "disputed"] as const;
const PAYOUT_STATUSES = [
  "pending",
  "approved",
  "scheduled",
  "paid",
  "held",
  "disputed",
  "cancelled",
] as const;

interface PartnerRow {
  id: string;
  name: string;
  commission_type: string | null;
  revenue_share_pct: number | string | null;
  flat_fee_cents: number | string | null;
  status: string;
}

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute the profit-based commission for one referred event.
 * net_profit = max(0, platformFee - processingCost). commission is
 * round(net_profit * share/100) for percent, flat_fee_cents for flat. The base
 * is ALWAYS profit, never gross.
 */
function computeCommission(
  partner: PartnerRow,
  input: { platformFeeCents: number; processingCostCents: number },
): { netProfitCents: number; sharePct: number; commissionCents: number } {
  const platformFee = Math.max(0, Math.round(num(input.platformFeeCents)));
  const processingCost = Math.max(0, Math.round(num(input.processingCostCents)));
  const netProfitCents = Math.max(0, platformFee - processingCost);

  const sharePct = num(partner.revenue_share_pct, 0);
  const flat = Math.max(0, Math.round(num(partner.flat_fee_cents, 0)));
  const type = partner.commission_type ?? "percent";

  let commissionCents: number;
  if (type === "flat") {
    commissionCents = flat;
  } else {
    commissionCents = Math.round((netProfitCents * sharePct) / 100);
  }
  return { netProfitCents, sharePct, commissionCents: Math.max(0, commissionCents) };
}

const router = Router();

// Everything here is super-admin only.
router.use("/admin/partner-rev", requireAdmin);

// ---------------------------------------------------------------------------
// GET /admin/partner-rev/payouts?partnerId=  -> list payouts (declared before
// the /:partnerId routes so "payouts" is not captured as a partner id).
// ---------------------------------------------------------------------------
router.get(
  "/admin/partner-rev/payouts",
  h(async (req, res) => {
    const partnerId = (req.query.partnerId as string) || undefined;
    const payouts = partnerId
      ? await q(
          `select * from partner_payouts where partner_id = $1 order by created_at desc limit 500`,
          [partnerId],
        )
      : await q(`select * from partner_payouts order by created_at desc limit 500`);
    res.json({ payouts });
  }),
);

// PATCH /admin/partner-rev/payouts/:id { status?, manual_adjustment_cents?, commission_paid_cents? }
// Re-derives commission_owed = base + adjustment so an adjustment is not double counted.
router.patch(
  "/admin/partner-rev/payouts/:id",
  h(async (req, res) => {
    const { status, manual_adjustment_cents, commission_paid_cents } = (req.body ?? {}) as Record<
      string,
      unknown
    >;
    const prev = await q1<{
      id: string;
      commission_owed_cents: string | number;
      manual_adjustment_cents: string | number;
    }>(`select * from partner_payouts where id = $1`, [req.params.id]);
    if (!prev) return res.status(404).json({ error: "payout not found" });

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };

    if (status !== undefined) {
      if (!PAYOUT_STATUSES.includes(status as (typeof PAYOUT_STATUSES)[number])) {
        return res.status(400).json({ error: "invalid status" });
      }
      add("status", status);
    }
    if (manual_adjustment_cents !== undefined) {
      const adj = Math.trunc(num(manual_adjustment_cents as number));
      const prevAdj = num(prev.manual_adjustment_cents);
      const base = num(prev.commission_owed_cents) - prevAdj;
      add("manual_adjustment_cents", adj);
      add("commission_owed_cents", base + adj);
    }
    if (commission_paid_cents !== undefined) {
      add("commission_paid_cents", Math.trunc(num(commission_paid_cents as number)));
    }
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    add("updated_at", new Date());
    params.push(req.params.id);
    const payout = await q1(
      `update partner_payouts set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    res.json({ payout });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /admin/partner-rev/commissions/:id { status?, excluded? }
// ---------------------------------------------------------------------------
router.patch(
  "/admin/partner-rev/commissions/:id",
  h(async (req, res) => {
    const { status, excluded } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (status !== undefined) {
      if (!COMMISSION_STATUSES.includes(status as (typeof COMMISSION_STATUSES)[number])) {
        return res.status(400).json({ error: "invalid status" });
      }
      add("status", status);
    }
    if (excluded !== undefined) add("excluded", !!excluded);
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    params.push(req.params.id);
    const commission = await q1(
      `update partner_commissions set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!commission) return res.status(404).json({ error: "commission not found" });
    res.json({ commission });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/partner-rev/:partnerId/commissions
//   { source, grossCents, platformFeeCents, processingCostCents, referredCompanyId? }
// ---------------------------------------------------------------------------
router.post(
  "/admin/partner-rev/:partnerId/commissions",
  h(async (req, res) => {
    const partner = await q1<PartnerRow>(`select * from referral_partners where id = $1`, [
      req.params.partnerId,
    ]);
    if (!partner) return res.status(404).json({ error: "partner not found" });

    const { source, grossCents, platformFeeCents, processingCostCents, referredCompanyId } =
      (req.body ?? {}) as Record<string, unknown>;
    const src: CommissionSource = COMMISSION_SOURCES.includes(source as CommissionSource)
      ? (source as CommissionSource)
      : "subscription";

    const gross = Math.max(0, Math.round(num(grossCents as number)));
    const platformFee = Math.max(0, Math.round(num(platformFeeCents as number)));
    const processingCost = Math.max(0, Math.round(num(processingCostCents as number)));

    const { netProfitCents, commissionCents } = computeCommission(partner, {
      platformFeeCents: platformFee,
      processingCostCents: processingCost,
    });

    const commission = await q1(
      `insert into partner_commissions
         (partner_id, referred_company_id, source, gross_cents, platform_fee_cents,
          processing_cost_cents, net_profit_cents, commission_cents, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning *`,
      [
        partner.id,
        (referredCompanyId as string) || null,
        src,
        gross,
        platformFee,
        processingCost,
        netProfitCents,
        commissionCents,
      ],
    );
    res.status(201).json({ commission });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/partner-rev/:partnerId/payouts/compute { period }
//   Roll up all non-excluded commissions for the period into a payout row.
//   "Period" matching is by created_at::date prefix (to_char(created_at,'YYYY-MM')
//   or 'YYYY-MM-DD'), so '2026-06' captures the whole month.
// ---------------------------------------------------------------------------
router.post(
  "/admin/partner-rev/:partnerId/payouts/compute",
  h(async (req, res) => {
    const partner = await q1<PartnerRow>(`select * from referral_partners where id = $1`, [
      req.params.partnerId,
    ]);
    if (!partner) return res.status(404).json({ error: "partner not found" });

    const period = String((req.body ?? {}).period ?? "").trim();
    if (!period) return res.status(400).json({ error: "period required" });

    // Roll up non-excluded commissions whose created_at falls inside the period.
    const totals = await q1<{
      gross: string;
      platform_fees: string;
      processing_costs: string;
      net_profit: string;
      commission: string;
      cnt: string;
    }>(
      `select coalesce(sum(gross_cents),0)            as gross,
              coalesce(sum(platform_fee_cents),0)     as platform_fees,
              coalesce(sum(processing_cost_cents),0)  as processing_costs,
              coalesce(sum(net_profit_cents),0)       as net_profit,
              coalesce(sum(commission_cents),0)       as commission,
              count(*)                                as cnt
         from partner_commissions
        where partner_id = $1
          and excluded = false
          and to_char(created_at, 'YYYY-MM-DD') like $2 || '%'`,
      [partner.id, period],
    );

    const grossVolume = num(totals?.gross);
    const platformFees = num(totals?.platform_fees);
    const processingCosts = num(totals?.processing_costs);
    const netProfit = num(totals?.net_profit);
    const commissionSum = num(totals?.commission);
    const commissionPct = num(partner.revenue_share_pct, 0);

    // Upsert by (partner_id, period): refresh an existing payout, preserving its
    // manual adjustment and paid amount, else insert a fresh one.
    const existing = await q1<{ id: string; manual_adjustment_cents: string | number }>(
      `select id, manual_adjustment_cents from partner_payouts
        where partner_id = $1 and period = $2 limit 1`,
      [partner.id, period],
    );
    const manualAdj = existing ? num(existing.manual_adjustment_cents) : 0;
    const owed = commissionSum + manualAdj;

    let payout;
    if (existing) {
      payout = await q1(
        `update partner_payouts set
           gross_volume_cents = $1, platform_fees_cents = $2, processing_costs_cents = $3,
           net_profit_cents = $4, commission_pct = $5, commission_owed_cents = $6,
           updated_at = now()
         where id = $7 returning *`,
        [grossVolume, platformFees, processingCosts, netProfit, commissionPct, owed, existing.id],
      );
    } else {
      payout = await q1(
        `insert into partner_payouts
           (partner_id, period, gross_volume_cents, platform_fees_cents, processing_costs_cents,
            net_profit_cents, commission_pct, commission_owed_cents, manual_adjustment_cents, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,0,'pending') returning *`,
        [partner.id, period, grossVolume, platformFees, processingCosts, netProfit, commissionPct, owed],
      );
    }
    res.json({ payout, commissionsCounted: num(totals?.cnt) });
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/partner-rev/:partnerId -> partner + commissions + payouts + totals
// ---------------------------------------------------------------------------
router.get(
  "/admin/partner-rev/:partnerId",
  h(async (req, res) => {
    const partner = await q1<PartnerRow>(`select * from referral_partners where id = $1`, [
      req.params.partnerId,
    ]);
    if (!partner) return res.status(404).json({ error: "partner not found" });

    const commissions = await q(
      `select * from partner_commissions where partner_id = $1 order by created_at desc limit 500`,
      [partner.id],
    );
    const payouts = await q(
      `select * from partner_payouts where partner_id = $1 order by created_at desc limit 500`,
      [partner.id],
    );
    const t = await q1<{
      net_profit: string;
      commission: string;
      pending: string;
      paid: string;
    }>(
      `select coalesce(sum(net_profit_cents) filter (where excluded = false),0) as net_profit,
              coalesce(sum(commission_cents)  filter (where excluded = false),0) as commission,
              coalesce(sum(commission_cents)  filter (where excluded = false and status = 'pending'),0) as pending,
              coalesce(sum(commission_cents)  filter (where status = 'paid'),0) as paid
         from partner_commissions where partner_id = $1`,
      [partner.id],
    );
    const owed = await q1<{ owed: string; paid: string }>(
      `select coalesce(sum(commission_owed_cents),0) as owed,
              coalesce(sum(commission_paid_cents),0) as paid
         from partner_payouts where partner_id = $1`,
      [partner.id],
    );
    res.json({
      partner,
      commissions,
      payouts,
      totals: {
        netProfitCents: num(t?.net_profit),
        commissionCents: num(t?.commission),
        pendingCommissionCents: num(t?.pending),
        paidCommissionCents: num(t?.paid),
        payoutOwedCents: num(owed?.owed),
        payoutPaidCents: num(owed?.paid),
      },
    });
  }),
);

export default router;
