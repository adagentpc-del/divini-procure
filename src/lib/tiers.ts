/**
 * Shared subscription-tier types and helpers - used by Subscription.tsx,
 * Onboarding.tsx (tier selection at registration), and Pricing.tsx (public
 * marketing page), so all three read the exact same tier shape and apply
 * the exact same "which tiers are real base plans vs later add-ons" rule
 * instead of drifting apart.
 */

export type Audience = 'developer' | 'vendor' | 'investor';
export type CompanyKind = 'buyer' | 'vendor' | 'investor';

export type Tier = {
  key: string;
  name: string;
  audience: Audience;
  /** null = custom/contact-us pricing (e.g. an Enterprise tier), distinct from a real $0 free tier. */
  price_cents: number | null;
  ai_features: boolean;
  reporting_access: boolean;
  white_glove: boolean;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  vendor_invite_limit: number | null;
  investment_program_limit: number | null;
  investor_match_limit: number | null;
  seat_limit: number | null;
};

export type LimitCheck = {
  key: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  allowed: boolean;
};

export type Entitlement = Tier & {
  company_id: string;
  tier_key: string | null;
  is_default: boolean;
  subscription_status: string | null;
};

export const LIMIT_LABELS: Record<string, string> = {
  active_project_limit: 'Active projects',
  bid_package_limit: 'Bid packages',
  vendor_invite_limit: 'Vendor invites',
  investment_program_limit: 'Capital programs',
  investor_match_limit: 'Capital Partner matches',
  seat_limit: 'Team seats',
};

// verified_plus / vendor_featured are purchased ON TOP OF a base vendor
// plan (see server/src/lib/entitlements.ts's isVerifiedPlus/isFeatured) -
// they are not alternative starting plans, so registration and the public
// pricing ladder both exclude them from the base tier comparison. They
// still surface inside the app (Subscription.tsx) as add-on upgrades.
export const ADDON_TIER_KEYS = new Set(['verified_plus', 'vendor_featured']);

export function audienceForKind(kind: CompanyKind): Audience {
  if (kind === 'vendor') return 'vendor';
  if (kind === 'investor') return 'investor';
  return 'developer';
}

export function freeTierKeyForAudience(audience: Audience): string {
  if (audience === 'vendor') return 'vendor_free';
  if (audience === 'investor') return 'capital_partner_free';
  return 'developer_free';
}

/** Base, selectable plans for one audience - price-ordered, add-ons excluded. */
export function basePlansFor(tiers: Tier[], audience: Audience): Tier[] {
  return tiers
    .filter((t) => t.audience === audience && !ADDON_TIER_KEYS.has(t.key))
    // Custom-priced (null) tiers sort last - they are the highest, most
    // bespoke tier, never the cheapest, even though their price is unknown.
    .sort((a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity));
}

export function money(cents: number | null): string {
  if (cents === null) return 'Custom';
  if (!cents) return 'Free';
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mo`;
}

export function limitText(n: number | null): string {
  return n === null ? 'Unlimited' : String(n);
}
