/**
 * Divini Procure - INTRO CREDITS (the bid-credit analog for the matchmaker).
 *
 * A valued, scarce action here is a WARM INTRODUCTION. Requesting an intro spends
 * a credit; you earn credits by doing the things that make the marketplace
 * healthy (completing your profile, referrals, responsiveness, good ratings), and
 * everyone gets a generous monthly grant that refreshes.
 *
 * actor_kind='investor' -> actor_id = auth user_id (text)
 * actor_kind='company'  -> actor_id = company id (uuid as text)
 *
 * METERING is gated on PROCURE_INTRO_CREDITS. When OFF (the default), the ledger
 * still accrues grants + earns so the UI can show a balance from day one, but
 * spend() NEVER blocks and records nothing (unlimited). When ON, spend() records
 * and enforces. Flip the flag when you're ready to make intros scarce.
 *
 * Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";

export type ActorKind = "investor" | "company";

// Generous v1 defaults (env-overridable). Paid tiers get a larger monthly grant
// — the intro-credit allotment is a core paywall lever.
export const INVESTOR_MONTHLY_GRANT = Number(process.env.PROCURE_INVESTOR_MONTHLY_CREDITS || 10);
export const DEVELOPER_MONTHLY_GRANT = Number(process.env.PROCURE_DEVELOPER_MONTHLY_CREDITS || 20);
export const INVESTOR_PREMIUM_MONTHLY_GRANT = Number(process.env.PROCURE_INVESTOR_PREMIUM_MONTHLY_CREDITS || 40);
export const DEVELOPER_PRO_MONTHLY_GRANT = Number(process.env.PROCURE_DEVELOPER_PRO_MONTHLY_CREDITS || 60);
export const FOUNDING_BONUS = Number(process.env.PROCURE_FOUNDING_CREDIT_BONUS || 25);

/** Fixed earn amounts by reason. */
export const EARN = {
  profile_complete: 5,
  referral: 5,
  responsiveness: 2,
  positive_rating: 3,
} as const;

/** True when intro credits are ENFORCED (spend can block). Default false. */
export function meteringEnabled(): boolean {
  return process.env.PROCURE_INTRO_CREDITS === "true";
}

/** Current month key, UTC, e.g. "2026-07". Deterministic regardless of TZ. */
export function monthKeyFor(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Tier-aware monthly grant. Developers resolve via their company entitlement
 * (a paid tier -> larger grant); investors via investor_profiles.plan. Failures
 * fall back to the free grant so a lookup error never reduces someone's credits.
 */
async function resolveMonthlyGrant(kind: ActorKind, actorId: string): Promise<number> {
  try {
    if (kind === "company") {
      const { getEntitlement } = await import("./entitlements.js");
      const ent = await getEntitlement(actorId);
      const paid = Number(ent?.price_cents ?? 0) > 0 || ent?.reporting_access === true;
      return paid ? DEVELOPER_PRO_MONTHLY_GRANT : DEVELOPER_MONTHLY_GRANT;
    }
    const row = await q1<{ plan: string | null }>(
      `select plan from investor_profiles where user_id = $1`,
      [actorId],
    );
    const plan = (row?.plan || "free").toLowerCase();
    return plan === "premium" || plan === "concierge" ? INVESTOR_PREMIUM_MONTHLY_GRANT : INVESTOR_MONTHLY_GRANT;
  } catch {
    return kind === "investor" ? INVESTOR_MONTHLY_GRANT : DEVELOPER_MONTHLY_GRANT;
  }
}

/** Idempotently record this month's grant for an actor (once per YYYY-MM). */
async function ensureMonthlyGrant(kind: ActorKind, actorId: string): Promise<void> {
  const periodKey = monthKeyFor();
  const existing = await q1<{ id: string }>(
    `select id from intro_credit_ledger
      where actor_kind = $1 and actor_id = $2 and reason = 'monthly_grant' and period_key = $3
      limit 1`,
    [kind, actorId, periodKey],
  );
  if (existing) return;
  const grant = await resolveMonthlyGrant(kind, actorId);
  await q(
    `insert into intro_credit_ledger (actor_kind, actor_id, delta, reason, period_key)
     values ($1,$2,$3,'monthly_grant',$4)`,
    [kind, actorId, grant, periodKey],
  );
}

async function sumBalance(kind: ActorKind, actorId: string): Promise<number> {
  const r = await q1<{ bal: string | number | null }>(
    `select coalesce(sum(delta),0) as bal from intro_credit_ledger where actor_kind = $1 and actor_id = $2`,
    [kind, actorId],
  );
  return Number(r?.bal ?? 0);
}

export interface CreditState {
  balance: number;
  monthlyGrant: number;
  metered: boolean; // whether spending is currently enforced
  ledger: { delta: number; reason: string; created_at: string }[];
}

/** Full credit state for display (ensures the monthly grant first). */
export async function getCreditState(kind: ActorKind, actorId: string): Promise<CreditState> {
  await ensureMonthlyGrant(kind, actorId);
  const balance = await sumBalance(kind, actorId);
  const ledger = await q<{ delta: number; reason: string; created_at: string }>(
    `select delta, reason, created_at from intro_credit_ledger
      where actor_kind = $1 and actor_id = $2 order by created_at desc limit 25`,
    [kind, actorId],
  );
  return { balance, monthlyGrant: await resolveMonthlyGrant(kind, actorId), metered: meteringEnabled(), ledger };
}

/**
 * Award credits. `oncePerReason` makes it idempotent for one-time awards like
 * profile_complete or founding_bonus (a second call is a no-op).
 */
export async function earn(
  kind: ActorKind,
  actorId: string,
  amount: number,
  reason: string,
  opts: { oncePerReason?: boolean; refId?: string } = {},
): Promise<void> {
  if (amount <= 0) return;
  if (opts.oncePerReason) {
    const existing = await q1<{ id: string }>(
      `select id from intro_credit_ledger where actor_kind = $1 and actor_id = $2 and reason = $3 limit 1`,
      [kind, actorId, reason],
    );
    if (existing) return;
  }
  await q(
    `insert into intro_credit_ledger (actor_kind, actor_id, delta, reason, ref_id) values ($1,$2,$3,$4,$5)`,
    [kind, actorId, Math.round(amount), reason, opts.refId ?? null],
  );
}

export interface SpendResult {
  ok: boolean;
  unlimited: boolean;
  balance: number;
  reason?: "insufficient_credits";
}

/**
 * Spend credits for a valued action (e.g. requesting an introduction). When
 * metering is OFF this is a no-op that always allows (records nothing). When ON
 * it enforces the balance and records the spend.
 */
export async function spend(
  kind: ActorKind,
  actorId: string,
  amount: number,
  reason: string,
  refId?: string,
): Promise<SpendResult> {
  if (!meteringEnabled()) {
    return { ok: true, unlimited: true, balance: 0 };
  }
  await ensureMonthlyGrant(kind, actorId);
  const balance = await sumBalance(kind, actorId);
  if (balance < amount) {
    return { ok: false, unlimited: false, balance, reason: "insufficient_credits" };
  }
  await q(
    `insert into intro_credit_ledger (actor_kind, actor_id, delta, reason, ref_id) values ($1,$2,$3,$4,$5)`,
    [kind, actorId, -Math.abs(Math.round(amount)), reason, refId ?? null],
  );
  return { ok: true, unlimited: false, balance: balance - amount };
}
