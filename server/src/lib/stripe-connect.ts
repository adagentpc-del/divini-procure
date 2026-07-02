/**
 * Divini Procure - STRIPE CONNECT adapter (fetch-based, no npm dependency).
 *
 * A thin wrapper over the Stripe REST API using the global fetch. There is NO
 * stripe npm package; every call is a plain HTTPS POST/GET with an
 * `Authorization: Bearer ${STRIPE_SECRET_KEY}` header and a form-encoded body.
 *
 * SAFETY: every function is guarded on STRIPE_SECRET_KEY. When the key is not
 * configured, the call throws a typed StripeNotConfigured error (or, for
 * isConfigured(), returns false) so the routes can degrade gracefully and a
 * release can mark an instruction 'blocked' WITHOUT erroring. The ONLY function
 * that actually moves money is createTransfer; it is called only from the
 * 1-click release route, only when the key is configured AND the recipient's
 * Connect account has payouts_enabled.
 *
 * We never touch raw bank numbers here. Onboarding is a Stripe-hosted link;
 * getAccount only ever reads back capability flags and a masked bank last4.
 *
 * Zero em dashes by convention. Integer cents throughout.
 */

const STRIPE_API = "https://api.stripe.com";

/** True when STRIPE_SECRET_KEY is present (live calls are possible). */
export function isConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY || "").trim();
}

/** Typed error so routes can branch on "not configured" without string matching. */
export class StripeNotConfigured extends Error {
  code = "stripe_not_configured" as const;
  constructor(msg = "Stripe not configured: connect Stripe and enable payouts to release") {
    super(msg);
    this.name = "StripeNotConfigured";
  }
}

/** Error carrying the Stripe-reported message for a failed API call. */
export class StripeApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.name = "StripeApiError";
    this.status = status;
  }
}

function secret(): string {
  const k = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!k) throw new StripeNotConfigured();
  return k;
}

/**
 * Encode a flat/nested object into Stripe's form syntax (a[b]=c). Only strings,
 * numbers, booleans, and one level of nesting (for metadata) are needed here.
 */
function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = formEncode(value as Record<string, unknown>, k);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}

async function stripePost<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as Record<string, unknown> | undefined) ?? {};
    throw new StripeApiError(res.status, String(err.message ?? res.statusText ?? "stripe error"));
  }
  return json as T;
}

async function stripeGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret()}` },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as Record<string, unknown> | undefined) ?? {};
    throw new StripeApiError(res.status, String(err.message ?? res.statusText ?? "stripe error"));
  }
  return json as T;
}

/**
 * Create an Express Connect account for a recipient. Returns the acct_... id.
 * Throws StripeNotConfigured when no key is set, so callers can present a
 * "connect Stripe" message instead of erroring.
 */
export async function createConnectAccount(args: {
  email?: string | null;
  country?: string;
}): Promise<{ accountId: string }> {
  if (!isConfigured()) throw new StripeNotConfigured();
  const body: Record<string, unknown> = {
    type: "express",
    country: args.country || "US",
    capabilities: { transfers: { requested: true } },
  };
  if (args.email) body.email = args.email;
  const acct = await stripePost<{ id: string }>("/v1/accounts", body);
  return { accountId: acct.id };
}

/**
 * Create a Stripe-hosted onboarding link for an account. The recipient completes
 * bank + identity details on Stripe's pages; we never see the raw numbers.
 */
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<{ url: string }> {
  if (!isConfigured()) throw new StripeNotConfigured();
  const link = await stripePost<{ url: string }>("/v1/account_links", {
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding",
  });
  return { url: link.url };
}

export interface ConnectAccountStatus {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  bank_last4?: string | null;
  country?: string | null;
  default_currency?: string | null;
}

/**
 * Read back an account's capability flags and the masked bank last4 (display
 * only). Never returns raw bank numbers; Stripe only exposes the last4.
 */
export async function getAccount(accountId: string): Promise<ConnectAccountStatus> {
  if (!isConfigured()) throw new StripeNotConfigured();
  const acct = await stripeGet<any>(`/v1/accounts/${encodeURIComponent(accountId)}`);
  let bankLast4: string | null = null;
  const extAccounts = acct?.external_accounts?.data;
  if (Array.isArray(extAccounts)) {
    const bank = extAccounts.find((a: any) => a?.object === "bank_account" && a?.last4);
    if (bank?.last4) bankLast4 = String(bank.last4);
  }
  return {
    charges_enabled: !!acct?.charges_enabled,
    payouts_enabled: !!acct?.payouts_enabled,
    details_submitted: !!acct?.details_submitted,
    bank_last4: bankLast4,
    country: acct?.country ?? null,
    default_currency: acct?.default_currency ?? null,
  };
}

/**
 * THE ACTUAL MONEY MOVE. Create a Stripe transfer to a destination Connect
 * account. Called ONLY from the 1-click release route, ONLY when the key is
 * configured AND the destination has payouts_enabled. Returns the transfer id.
 */
export async function createTransfer(args: {
  amountCents: number;
  currency?: string;
  destinationAccountId: string;
  metadata?: Record<string, string>;
}): Promise<{ transferId: string }> {
  if (!isConfigured()) throw new StripeNotConfigured();
  const body: Record<string, unknown> = {
    amount: Math.max(0, Math.round(args.amountCents)),
    currency: (args.currency || "usd").toLowerCase(),
    destination: args.destinationAccountId,
  };
  if (args.metadata && Object.keys(args.metadata).length) body.metadata = args.metadata;
  const transfer = await stripePost<{ id: string }>("/v1/transfers", body);
  return { transferId: transfer.id };
}
