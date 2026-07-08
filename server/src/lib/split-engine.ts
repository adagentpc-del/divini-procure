/**
 * Divini Procure - PAYOUT SPLIT ENGINE.
 *
 * Given a collected platform_revenue row, determine each party's agreed split
 * and queue a payout_instructions row per split. Conservative by design: a split
 * is produced ONLY where BOTH a configured percentage AND a real recipient
 * exist. If no agreement / referral term defines a split for a party, that party
 * is skipped. We never invent a split.
 *
 * Today the one well-defined split is the referral partner who referred the
 * developer: they earn revenue_share_pct of the platform fee (fee_cents). The
 * referral lookup reuses the exact attribution pattern from monetization.ts
 * (direct company link, else user_referrals email attribution). Client / vendor
 * / profile agreement-based splits hook in here later; the structure supports
 * them but none is fabricated.
 *
 * enqueueSplitsForRevenue is idempotent (skips a revenue id that already has
 * instructions) and best-effort (never throws into the caller), so wiring it
 * onto the revenue PATCH "collected" transition can never break that flow.
 *
 * Zero em dashes by convention. Integer cents throughout.
 */
import { q, q1 } from "../pool.js";

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

export type RecipientKind =
  | "referral_partner"
  | "client"
  | "vendor"
  | "profile"
  | "other";

export interface ComputedSplit {
  recipient_kind: RecipientKind;
  recipient_company_id?: string | null;
  recipient_user_id?: string | null;
  recipient_referral_partner_id?: string | null;
  basis_cents: number;
  split_percentage: number | null;
  amount_cents: number;
}

export interface PlatformRevenueRow {
  id: string;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  program_id?: string | null;
  fee_cents: number | string | null;
  base_cents: number | string | null;
  currency?: string | null;
  payment_authorization_id?: string | null;
  purchase_order_id?: string | null;
}

/**
 * Compute the splits for one platform_revenue row. Returns [] when no party has
 * a configured percentage AND a recipient. The only split produced today is the
 * referral partner who brought in the developer company, earning
 * revenue_share_pct of fee_cents.
 */
export async function computeSplits(
  revenueRow: PlatformRevenueRow,
): Promise<ComputedSplit[]> {
  const splits: ComputedSplit[] = [];
  const feeCents = Math.max(0, Math.round(num(revenueRow.fee_cents)));
  const baseCents = Math.max(0, Math.round(num(revenueRow.base_cents)));
  if (feeCents <= 0) return splits;

  const developerCompanyId = revenueRow.developer_company_id ?? null;
  const vendorCompanyId = revenueRow.vendor_company_id ?? null;

  // Dedupe key for a recipient so the same party is never paid twice (for
  // example a referral partner who is also named in a split term). Keyed by the
  // most specific recipient id present.
  const seen = new Set<string>();
  const recipientKey = (s: {
    recipient_referral_partner_id?: string | null;
    recipient_company_id?: string | null;
    recipient_user_id?: string | null;
  }): string =>
    s.recipient_referral_partner_id
      ? `rp:${s.recipient_referral_partner_id}`
      : s.recipient_company_id
        ? `co:${s.recipient_company_id}`
        : s.recipient_user_id
          ? `us:${s.recipient_user_id}`
          : "";

  // Referral partner who referred the developer (same attribution as
  // monetization.ts maybeRecordReferralCommission). A percent partner with a
  // positive share earns revenue_share_pct of the platform fee.
  if (developerCompanyId) {
    const partner = await q1<{
      id: string;
      commission_type: string | null;
      revenue_share_pct: number | string | null;
      flat_fee_cents: number | string | null;
    }>(
      `select rp.id, rp.commission_type, rp.revenue_share_pct, rp.flat_fee_cents
         from referral_partners rp
        where rp.status = 'active'
          and (
            rp.company_id = $1
            or exists (
              select 1
                from user_referrals ur
                join company_members cm on cm.company_id = $1
                join users cm_user on cm_user.id = cm.user_id
               where ur.code = rp.referral_code
                 and lower(cm_user.email) = lower(ur.referred_email)
            )
          )
        order by case when rp.company_id = $1 then 0 else 1 end
        limit 1`,
      [developerCompanyId],
    );

    if (partner) {
      const type = partner.commission_type ?? "percent";
      if (type === "flat") {
        const flat = Math.max(0, Math.round(num(partner.flat_fee_cents, 0)));
        if (flat > 0) {
          splits.push({
            recipient_kind: "referral_partner",
            recipient_referral_partner_id: partner.id,
            basis_cents: feeCents,
            split_percentage: null,
            amount_cents: Math.min(flat, feeCents),
          });
          seen.add(`rp:${partner.id}`);
        }
      } else {
        const sharePct = num(partner.revenue_share_pct, 0);
        if (sharePct > 0) {
          const amount = Math.max(0, Math.round((feeCents * sharePct) / 100));
          if (amount > 0) {
            splits.push({
              recipient_kind: "referral_partner",
              recipient_referral_partner_id: partner.id,
              basis_cents: feeCents,
              split_percentage: sharePct,
              amount_cents: amount,
            });
            seen.add(`rp:${partner.id}`);
          }
        }
      }
    }
  }

  // ----------------------------------------------------------------------
  // AGREED per-party split terms (split_terms). These let an admin define a
  // share for any recipient (client / vendor / profile / referral partner /
  // other) scoped to this revenue context. We match ACTIVE terms whose scope
  // overlaps the revenue: a NULL scope column is a wildcard (matches anything),
  // and a set column must equal the corresponding revenue value. A term that
  // names a developer / vendor / program that does NOT match this revenue is
  // excluded, so a term never leaks onto an unrelated revenue row.
  //
  // basis 'fee'      -> share of fee_cents  (the platform fee)
  // basis 'payment'  -> share of base_cents (the gross payment base)
  // amount = flat_cents when set, else basis * percentage / 100.
  // A split is produced only when the amount is positive and a real recipient
  // id exists. The dedupe set above prevents paying the same recipient twice
  // (for example if they are also the referral partner).
  const terms = await q<{
    id: string;
    recipient_kind: string | null;
    recipient_company_id: string | null;
    recipient_user_id: string | null;
    recipient_referral_partner_id: string | null;
    developer_company_id: string | null;
    vendor_company_id: string | null;
    program_id: string | null;
    basis: string | null;
    percentage: number | string | null;
    flat_cents: number | string | null;
  }>(
    `select id, recipient_kind, recipient_company_id, recipient_user_id,
            recipient_referral_partner_id, developer_company_id, vendor_company_id,
            program_id, basis, percentage, flat_cents
       from split_terms
      where active = true
        and (developer_company_id is null or developer_company_id = $1)
        and (vendor_company_id is null or vendor_company_id = $2)
        and (program_id is null or program_id = $3)
        and (
          developer_company_id is not null
          or vendor_company_id is not null
          or program_id is not null
        )
      order by created_at asc`,
    [developerCompanyId, vendorCompanyId, revenueRow.program_id ?? null],
  );

  for (const t of terms) {
    const kind = (t.recipient_kind ?? "other") as RecipientKind;
    const recipient = {
      recipient_referral_partner_id: t.recipient_referral_partner_id ?? null,
      recipient_company_id: t.recipient_company_id ?? null,
      recipient_user_id: t.recipient_user_id ?? null,
    };
    // Need at least one real recipient id to pay.
    const key = recipientKey(recipient);
    if (!key) continue;
    // Dedupe: skip if this recipient was already produced above.
    if (seen.has(key)) continue;

    const basis = t.basis === "payment" ? "payment" : "fee";
    const basisCents = basis === "payment" ? baseCents : feeCents;
    if (basisCents <= 0) continue;

    const flat =
      t.flat_cents == null ? null : Math.max(0, Math.round(num(t.flat_cents)));
    const sharePct = num(t.percentage, 0);

    let amount = 0;
    let splitPct: number | null = null;
    if (flat != null && flat > 0) {
      amount = Math.min(flat, basisCents);
    } else if (sharePct > 0) {
      amount = Math.max(0, Math.round((basisCents * sharePct) / 100));
      splitPct = sharePct;
    }
    if (amount <= 0) continue;

    splits.push({
      recipient_kind: kind,
      recipient_company_id: recipient.recipient_company_id,
      recipient_user_id: recipient.recipient_user_id,
      recipient_referral_partner_id: recipient.recipient_referral_partner_id,
      basis_cents: basisCents,
      split_percentage: splitPct,
      amount_cents: amount,
    });
    seen.add(key);
  }

  return splits;
}

/**
 * Find the connect_accounts row id for a computed split's recipient, if any, and
 * whether that account has payouts enabled. Returns { id, payoutsEnabled }.
 */
async function findRecipientAccount(
  split: ComputedSplit,
): Promise<{ id: string | null; payoutsEnabled: boolean }> {
  let row: { id: string; payouts_enabled: boolean } | null = null;
  if (split.recipient_referral_partner_id) {
    row = await q1(
      `select id, payouts_enabled from connect_accounts
        where owner_referral_partner_id = $1 order by updated_at desc limit 1`,
      [split.recipient_referral_partner_id],
    );
  } else if (split.recipient_company_id) {
    row = await q1(
      `select id, payouts_enabled from connect_accounts
        where owner_company_id = $1 order by updated_at desc limit 1`,
      [split.recipient_company_id],
    );
  } else if (split.recipient_user_id) {
    row = await q1(
      `select id, payouts_enabled from connect_accounts
        where owner_user_id = $1 order by updated_at desc limit 1`,
      [split.recipient_user_id],
    );
  }
  return { id: row?.id ?? null, payoutsEnabled: !!row?.payouts_enabled };
}

export interface EnqueueResult {
  created: number;
}

/**
 * Load the platform_revenue row, compute its splits, and insert one
 * payout_instructions row per split (status 'pending', or 'ready' when the
 * recipient already has a payouts-enabled connect account). Idempotent: if any
 * instructions already exist for this revenue id, nothing is inserted. Best
 * effort: any failure is swallowed and reported as { created: 0 }.
 */
export async function enqueueSplitsForRevenue(
  revenueId: string,
  actorEmail: string | null,
): Promise<EnqueueResult> {
  try {
    if (!revenueId) return { created: 0 };

    // Idempotency: skip if this revenue id already has instructions.
    const existing = await q1<{ id: string }>(
      `select id from payout_instructions where source_revenue_id = $1 limit 1`,
      [revenueId],
    );
    if (existing) return { created: 0 };

    const rev = await q1<PlatformRevenueRow>(
      `select id, developer_company_id, vendor_company_id, program_id, fee_cents, base_cents,
              payment_authorization_id, purchase_order_id
         from platform_revenue where id = $1`,
      [revenueId],
    );
    if (!rev) return { created: 0 };

    const splits = await computeSplits(rev);
    if (!splits.length) return { created: 0 };

    let created = 0;
    for (const s of splits) {
      const acct = await findRecipientAccount(s);
      const status = acct.id && acct.payoutsEnabled ? "ready" : "pending";
      const inserted = await q1<{ id: string }>(
        `insert into payout_instructions
           (source_revenue_id, payment_authorization_id, purchase_order_id, recipient_kind,
            recipient_company_id, recipient_user_id, recipient_referral_partner_id,
            connect_account_id, basis_cents, split_percentage, amount_cents, currency, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'usd',$12)
         returning id`,
        [
          rev.id,
          rev.payment_authorization_id ?? null,
          rev.purchase_order_id ?? null,
          s.recipient_kind,
          s.recipient_company_id ?? null,
          s.recipient_user_id ?? null,
          s.recipient_referral_partner_id ?? null,
          acct.id,
          s.basis_cents,
          s.split_percentage,
          s.amount_cents,
          status,
        ],
      );
      if (inserted?.id) {
        created += 1;
        await q(
          `insert into payout_audit (instruction_id, actor_email, action, detail)
           values ($1,$2,'enqueued',$3::jsonb)`,
          [
            inserted.id,
            actorEmail ?? null,
            JSON.stringify({
              source_revenue_id: rev.id,
              recipient_kind: s.recipient_kind,
              amount_cents: s.amount_cents,
              status,
            }),
          ],
        );
      }
    }
    return { created };
  } catch {
    // Best effort: never throw into the caller (the revenue collect flow).
    return { created: 0 };
  }
}
