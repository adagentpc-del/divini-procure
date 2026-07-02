/**
 * Subscription entitlements engine for Divini Procure.
 *
 * Resolves a company's EFFECTIVE plan = its assigned tier defaults merged with
 * any per-company overrides stored on subscription_entitlements (an override
 * column wins when it is not null; otherwise the tier value applies). Also
 * counts live usage and answers per-resource limit checks.
 *
 * companies.kind is 'buyer' | 'vendor'. The tier "audience" namespace is
 * 'developer' | 'vendor' | 'investor' (a buyer maps to the developer audience).
 * The investor audience is only ever assigned explicitly by an admin.
 *
 * Defensive: every usage count is wrapped so a missing table/column degrades to
 * 0 rather than throwing. A NULL limit means UNLIMITED.
 *
 * Integer cents. Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";

export type LimitKey =
  | "active_project_limit"
  | "bid_package_limit"
  | "vendor_invite_limit"
  | "investment_program_limit"
  | "investor_match_limit"
  | "seat_limit";

export interface Tier {
  id: string;
  key: string;
  name: string;
  audience: "developer" | "vendor" | "investor";
  price_cents: number;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  vendor_invite_limit: number | null;
  investment_program_limit: number | null;
  investor_match_limit: number | null;
  seat_limit: number | null;
  ai_features: boolean;
  reporting_access: boolean;
  white_glove: boolean;
  sort: number;
}

export interface Entitlement {
  company_id: string;
  tier_key: string | null;
  audience: "developer" | "vendor" | "investor";
  name: string;
  price_cents: number;
  ai_features: boolean;
  reporting_access: boolean;
  white_glove: boolean;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  vendor_invite_limit: number | null;
  investment_program_limit: number | null;
  investor_match_limit: number | null;
  seat_limit: number | null;
  /** true when no entitlement row existed and a free default was synthesized. */
  is_default: boolean;
}

export interface Usage {
  active_projects: number;
  bid_packages: number;
  vendor_invites: number;
  investment_programs: number;
  investor_matches: number;
  seats: number;
}

export interface LimitCheck {
  key: LimitKey;
  limit: number | null;
  used: number;
  remaining: number | null;
  allowed: boolean;
}

const LIMIT_KEYS: LimitKey[] = [
  "active_project_limit",
  "bid_package_limit",
  "vendor_invite_limit",
  "investment_program_limit",
  "investor_match_limit",
  "seat_limit",
];

/** Map the company.kind onto the tier audience namespace. */
function kindToAudience(kind: string | null | undefined): "developer" | "vendor" {
  return kind === "vendor" ? "vendor" : "developer";
}

/** The fallback free tier key for a given audience. */
function defaultTierKey(audience: "developer" | "vendor" | "investor"): string {
  if (audience === "vendor") return "vendor_free";
  if (audience === "investor") return "investor_basic";
  return "developer_free";
}

async function loadTier(key: string): Promise<Tier | null> {
  return q1<Tier>("select * from subscription_tiers where key = $1", [key]);
}

/** All tiers, ordered for display. */
export async function listTiers(): Promise<Tier[]> {
  return q<Tier>("select * from subscription_tiers order by sort asc, audience asc, price_cents asc");
}

/** Pick a value: the override wins when not null, else the tier default. */
function pick<T>(override: T | null | undefined, tierValue: T | null): T | null {
  return override === null || override === undefined ? tierValue : override;
}

/**
 * The EFFECTIVE entitlement for a company: assigned tier merged with overrides.
 * Falls back to the free tier for the company kind when no row exists.
 */
export async function getEntitlement(companyId: string): Promise<Entitlement> {
  const company = await q1<{ kind: string | null }>(
    "select kind from companies where id = $1",
    [companyId],
  );
  const baseAudience = kindToAudience(company?.kind);

  const ent = await q1<any>(
    "select * from subscription_entitlements where company_id = $1",
    [companyId],
  );

  // Resolve which tier backs this entitlement.
  const audience = (ent?.audience as Entitlement["audience"]) || baseAudience;
  const tierKey = ent?.tier_key || defaultTierKey(audience);
  let tier = await loadTier(tierKey);
  if (!tier) tier = await loadTier(defaultTierKey(audience));

  const tierAudience = (tier?.audience as Entitlement["audience"]) || audience;

  if (!ent) {
    // No stored entitlement: synthesize a free-tier default.
    return {
      company_id: companyId,
      tier_key: tier?.key ?? null,
      audience: tierAudience,
      name: tier?.name ?? "Free",
      price_cents: tier?.price_cents ?? 0,
      ai_features: tier?.ai_features ?? false,
      reporting_access: tier?.reporting_access ?? false,
      white_glove: tier?.white_glove ?? false,
      active_project_limit: tier?.active_project_limit ?? null,
      bid_package_limit: tier?.bid_package_limit ?? null,
      vendor_invite_limit: tier?.vendor_invite_limit ?? null,
      investment_program_limit: tier?.investment_program_limit ?? null,
      investor_match_limit: tier?.investor_match_limit ?? null,
      seat_limit: tier?.seat_limit ?? null,
      is_default: true,
    };
  }

  return {
    company_id: companyId,
    tier_key: tier?.key ?? ent.tier_key ?? null,
    audience: tierAudience,
    name: tier?.name ?? "Custom",
    price_cents: tier?.price_cents ?? 0,
    ai_features: ent.ai_features ?? tier?.ai_features ?? false,
    reporting_access: ent.reporting_access ?? tier?.reporting_access ?? false,
    white_glove: ent.white_glove ?? tier?.white_glove ?? false,
    active_project_limit: pick(ent.active_project_limit, tier?.active_project_limit ?? null),
    bid_package_limit: pick(ent.bid_package_limit, tier?.bid_package_limit ?? null),
    vendor_invite_limit: pick(ent.vendor_invite_limit, tier?.vendor_invite_limit ?? null),
    investment_program_limit: pick(ent.investment_program_limit, tier?.investment_program_limit ?? null),
    investor_match_limit: pick(ent.investor_match_limit, tier?.investor_match_limit ?? null),
    seat_limit: pick(ent.seat_limit, tier?.seat_limit ?? null),
    is_default: false,
  };
}

/** Run a count query, defaulting to 0 if the table/column is missing. */
async function safeCount(sql: string, params: any[]): Promise<number> {
  try {
    const row = await q1<{ n: string | number }>(sql, params);
    const n = row ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Live usage for a company. Each count is defensive (0 on any error). */
export async function usage(companyId: string): Promise<Usage> {
  const [
    active_projects,
    bid_packages,
    vendor_invites,
    investment_programs,
    investor_matches,
    seats,
  ] = await Promise.all([
    safeCount("select count(*)::int as n from buildings where company_id = $1", [companyId]),
    safeCount(
      "select count(*)::int as n from packages p join buildings b on b.id = p.building_id where b.company_id = $1",
      [companyId],
    ),
    // invite_codes are keyed by admin email (created_by), not by company. There
    // is no reliable company linkage, so this defensively resolves to 0 unless a
    // company_id column exists on invite_codes.
    safeCount("select count(*)::int as n from invite_codes where company_id = $1", [companyId]),
    safeCount("select count(*)::int as n from investment_programs where company_id = $1", [companyId]),
    safeCount(
      "select count(*)::int as n from investor_introduction_requests m join investment_programs ip on ip.id = m.program_id where ip.company_id = $1",
      [companyId],
    ),
    safeCount(
      "select count(*)::int as n from developer_seats where organization_company_id = $1 and status = 'active'",
      [companyId],
    ),
  ]);

  return {
    active_projects,
    bid_packages,
    vendor_invites,
    investment_programs,
    investor_matches,
    seats,
  };
}

/** Map a limit key to the usage field that meters it. */
function usedFor(key: LimitKey, u: Usage): number {
  switch (key) {
    case "active_project_limit":
      return u.active_projects;
    case "bid_package_limit":
      return u.bid_packages;
    case "vendor_invite_limit":
      return u.vendor_invites;
    case "investment_program_limit":
      return u.investment_programs;
    case "investor_match_limit":
      return u.investor_matches;
    case "seat_limit":
      return u.seats;
  }
}

/**
 * Limit check for a single resource. A NULL limit is UNLIMITED (always allowed,
 * remaining null). Otherwise allowed when used < limit.
 */
export async function checkLimit(companyId: string, key: LimitKey): Promise<LimitCheck> {
  const [ent, u] = await Promise.all([getEntitlement(companyId), usage(companyId)]);
  const limit = (ent[key] as number | null) ?? null;
  const used = usedFor(key, u);
  if (limit === null) {
    return { key, limit: null, used, remaining: null, allowed: true };
  }
  return { key, limit, used, remaining: Math.max(0, limit - used), allowed: used < limit };
}

/** Limit checks for every metered resource. */
export async function allLimits(companyId: string): Promise<Record<LimitKey, LimitCheck>> {
  const [ent, u] = await Promise.all([getEntitlement(companyId), usage(companyId)]);
  const out = {} as Record<LimitKey, LimitCheck>;
  for (const key of LIMIT_KEYS) {
    const limit = (ent[key] as number | null) ?? null;
    const used = usedFor(key, u);
    out[key] =
      limit === null
        ? { key, limit: null, used, remaining: null, allowed: true }
        : { key, limit, used, remaining: Math.max(0, limit - used), allowed: used < limit };
  }
  return out;
}

/**
 * Monetization V2 entitlement helpers. A vendor on the vendor_pro tier gets
 * unlimited bids + real-time alerts + priority verification; verified_plus and
 * vendor_featured are add-on tiers. These read the company's effective tier_key.
 * Agent B (subscriptions) may extend these; Agent A (bid credits / gate) imports
 * isVendorPro to bypass the free-tier quarterly bid limit.
 */
export async function isVendorPro(companyId: string): Promise<boolean> {
  const ent = await getEntitlement(companyId);
  return ent.tier_key === "vendor_pro";
}
export async function isVerifiedPlus(companyId: string): Promise<boolean> {
  const ent = await getEntitlement(companyId);
  return ent.tier_key === "verified_plus";
}

/**
 * Featured-placement check. The featured state lives in the vendor_featured
 * table (a one month placement), not on the tier_key, so this re-exports the
 * canonical implementation in db/featured.ts to give callers a single import
 * surface alongside isVendorPro / isVerifiedPlus. Flag-aware (false when
 * PROCURE_MONETIZATION_V2 is off).
 */
export { isFeatured } from "../db/featured.js";

/**
 * Lead-alert delivery mode for a vendor company. When PROCURE_MONETIZATION_V2
 * is on, Pro vendors get 'realtime' alerts about new matching projects/RFQs and
 * free vendors get 'digest' (flagged for a daily roll-up rather than an
 * immediate send). With the flag OFF every vendor is 'realtime' so behavior is
 * identical to today. Callers that emit new-project notifications branch on this.
 */
export async function vendorAlertMode(companyId: string): Promise<"realtime" | "digest"> {
  if (!PROCURE_MONETIZATION_V2) return "realtime";
  return (await isVendorPro(companyId)) ? "realtime" : "digest";
}
