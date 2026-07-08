/**
 * Client-side monetization helpers for the PROCURE_MONETIZATION_V2 rebuild.
 *
 * The master flag PROCURE_MONETIZATION_V2 lives server-side. The SPA infers
 * whether V2 is active from the new endpoints' data: GET /api/me/bid-credits
 * and GET /api/me/verification. When either returns a shaped payload we treat
 * V2 as active and render the verify-first / bid-credit / upgrade UI. When the
 * endpoints are absent (older server, flag off) we degrade gracefully: callers
 * fall back to legacy behavior and the new gates do not block anything.
 *
 * This module is self-contained (only depends on the api client) so it can be
 * imported anywhere without pulling in context providers.
 */
import { apiGet, apiSend } from './api';

// ---- shapes returned by the parallel backend ----

export type BidCredits = {
  periodKey: string;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
};

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'expired' | 'rejected';

export type Verification = {
  status: VerificationStatus;
  // credential types still missing for a complete submission
  missing: string[];
  // credential types that are present but expiring soon
  expiring: string[];
};

export type FeaturedListing = {
  id?: string;
  company_id?: string;
  placement?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  active?: boolean;
};

// ---- pricing constants (mirror the server config) ----

export const VENDOR_PRO_TIER_KEY = 'vendor_pro';
export const VENDOR_PRO_PRICE_LABEL = '$149/mo';
export const FREE_BID_LIMIT = 5;
export const SUCCESS_FEE_PCT = 2;
export const SUCCESS_FEE_CAP_LABEL = '$2,500';

// ---- endpoint readers (all tolerant of absence) ----

/**
 * Read the signed-in vendor's bid credits for the current quarter. Returns null
 * if the endpoint is unavailable (V2 not active / older server), which callers
 * treat as "do not gate".
 */
export async function getBidCredits(): Promise<BidCredits | null> {
  try {
    const d = await apiGet<BidCredits>('/me/bid-credits');
    if (!d || typeof d.remaining !== 'number') return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Read the signed-in vendor's verification status. Returns null if the endpoint
 * is unavailable, which callers treat as "verification gating is off".
 */
export async function getVerification(): Promise<Verification | null> {
  try {
    const d = await apiGet<Verification>('/me/verification');
    if (!d || typeof d.status !== 'string') return null;
    return {
      status: d.status,
      missing: Array.isArray(d.missing) ? d.missing : [],
      expiring: Array.isArray(d.expiring) ? d.expiring : [],
    };
  } catch {
    return null;
  }
}

/** Read the current featured listings (marketplace promotion). */
export async function getFeatured(): Promise<FeaturedListing[]> {
  try {
    const d = await apiGet<{ featured?: FeaturedListing[] } | FeaturedListing[]>('/featured');
    if (Array.isArray(d)) return d;
    return Array.isArray(d?.featured) ? d.featured : [];
  } catch {
    return [];
  }
}

// ---- actions ----

/** Subscribe the signed-in company to a tier (e.g. vendor_pro). */
export async function subscribeToTier(tierKey: string): Promise<void> {
  await apiSend('POST', '/subscriptions/subscribe', { tierKey });
}

/** Buy a featured marketplace placement. */
export async function buyFeatured(): Promise<void> {
  await apiSend('POST', '/featured/buy', {});
}

// ---- derived helpers ----

/** True when the V2 monetization layer is active for this user. */
export function v2Active(credits: BidCredits | null, verification: Verification | null): boolean {
  return !!credits || !!verification;
}

/** True when the vendor is fully verified and may bid / contact developers. */
export function isVerified(v: Verification | null): boolean {
  // If verification gating is off (null), nothing blocks the vendor.
  if (!v) return true;
  return v.status === 'verified';
}

/** True when the vendor has at least one bid credit (or unlimited). */
export function canBid(c: BidCredits | null): boolean {
  // If credit metering is off (null), do not block.
  if (!c) return true;
  return c.unlimited || c.remaining > 0;
}

/** A short human label for the remaining bid credits. */
export function bidsLeftLabel(c: BidCredits | null): string {
  if (!c) return '';
  if (c.unlimited) return 'Unlimited (Pro)';
  return `${c.remaining} of ${c.limit} bids left this quarter`;
}

const STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: 'Not verified',
  pending: 'Verification under review',
  verified: 'Verified',
  expired: 'Verification expired',
  rejected: 'Verification rejected',
};

export function verificationLabel(v: Verification | null): string {
  if (!v) return 'Verified';
  return STATUS_LABELS[v.status] ?? v.status;
}

/** badge class (theme.css) for a verification status. */
export function verificationBadgeClass(v: Verification | null): string {
  if (!v) return 'b-green';
  switch (v.status) {
    case 'verified':
      return 'b-green';
    case 'pending':
      return 'b-amber';
    case 'expired':
    case 'rejected':
      return 'b-red';
    default:
      return 'b-neutral';
  }
}
