/**
 * Divini Procure - STRIPE BILLING adapter (fetch-based, no npm dependency).
 *
 * Handles subscription checkout (Stripe Checkout Sessions), subscription
 * management, and webhook event verification. This is SEPARATE from
 * stripe-connect.ts which handles vendor payouts (Stripe Connect transfers).
 * Both use the same STRIPE_SECRET_KEY but address different flows:
 *   stripe.ts          -> platform COLLECTS subscription payments from buyers
 *   stripe-connect.ts  -> platform PAYS OUT to vendors / referral partners
 *
 * Stripe Checkout is used for both one-time and recurring billing so Divini
 * never touches raw card numbers. The Checkout Session redirects the user to
 * Stripe's hosted page; on success Stripe fires a webhook (checkout.session.completed)
 * and the session returns the user to ?session_id=cs_xxx which we look up to
 * activate the tier.
 *
 * Env:
 *   STRIPE_SECRET_KEY        - sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    - whsec_... (from the dashboard endpoint config)
 *   STRIPE_PUBLISHABLE_KEY   - pk_live_... (exposed to the frontend)
 *
 * Zero em dashes by convention. Integer cents throughout.
 */

const STRIPE_API = "https://api.stripe.com";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY || "").trim();
}

export class StripeNotConfigured extends Error {
  code = "stripe_not_configured" as const;
  constructor(msg = "Stripe not configured: set STRIPE_SECRET_KEY to take payments") {
    super(msg);
    this.name = "StripeNotConfigured";
  }
}

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

// ---------------------------------------------------------------------------
// Internal HTTP helpers (same pattern as stripe-connect.ts)
// ---------------------------------------------------------------------------

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
    throw new StripeApiError(res.status, String(err.message ?? res.statusText ?? "Stripe error"));
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
    throw new StripeApiError(res.status, String(err.message ?? res.statusText ?? "Stripe error"));
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * Create or retrieve a Stripe Customer for a company. We store the
 * stripe_customer_id in subscription_entitlements.
 */
export async function createCustomer(args: {
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string>;
}): Promise<{ customerId: string }> {
  const body: Record<string, unknown> = {};
  if (args.email) body.email = args.email;
  if (args.name) body.name = args.name;
  if (args.metadata && Object.keys(args.metadata).length) body.metadata = args.metadata;
  const customer = await stripePost<{ id: string }>("/v1/customers", body);
  return { customerId: customer.id };
}

// ---------------------------------------------------------------------------
// Products and Prices (billing catalog)
// ---------------------------------------------------------------------------

export interface StripePriceResult {
  priceId: string;
  productId: string;
}

/**
 * Ensure a Stripe Product and Price exist for a given tier. Creates both if
 * absent. Returns the price_id (price_... id) to use for Checkout Sessions.
 * We create monthly recurring prices for paid tiers. For a truly one-time
 * payment (lifetime plan), pass recurring=false.
 */
export async function ensurePrice(args: {
  tierKey: string;
  tierName: string;
  amountCents: number;
  recurring?: boolean;
  existingProductId?: string | null;
}): Promise<StripePriceResult> {
  // Create or reuse a product.
  let productId = args.existingProductId ?? null;
  if (!productId) {
    const product = await stripePost<{ id: string }>("/v1/products", {
      name: `Divini Procure - ${args.tierName}`,
      metadata: { tier_key: args.tierKey },
    });
    productId = product.id;
  }

  const priceBody: Record<string, unknown> = {
    product: productId,
    currency: "usd",
    unit_amount: Math.max(0, Math.round(args.amountCents)),
    metadata: { tier_key: args.tierKey },
  };
  if (args.recurring !== false) {
    priceBody["recurring[interval]"] = "month";
  }
  const price = await stripePost<{ id: string }>("/v1/prices", priceBody);
  return { priceId: price.id, productId };
}

// ---------------------------------------------------------------------------
// Checkout Sessions
// ---------------------------------------------------------------------------

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for a subscription tier. The session
 * redirects the user to Stripe's hosted checkout page. On success Stripe fires
 * checkout.session.completed and redirects to successUrl?session_id={CHECKOUT_SESSION_ID}.
 *
 * For paid recurring tiers, mode='subscription'. For free or one-time tiers
 * where a price_id is not available, fall back to a Payment intent with mode='payment'.
 * metadata.companyId and metadata.tierKey encode the attribution so the webhook
 * can assign the tier without trusting client-supplied state.
 */
export async function createCheckoutSession(args: {
  priceId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  companyId: string;
  tierKey: string;
  successUrl: string;
  cancelUrl: string;
  mode?: "payment" | "subscription";
}): Promise<CheckoutSessionResult> {
  const mode = args.mode ?? "subscription";
  const body: Record<string, unknown> = {
    mode,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    "metadata[company_id]": args.companyId,
    "metadata[tier_key]": args.tierKey,
    "line_items[0][price]": args.priceId,
    "line_items[0][quantity]": "1",
  };
  if (args.customerId) {
    body.customer = args.customerId;
  } else if (args.customerEmail) {
    body.customer_email = args.customerEmail;
  }
  // For subscriptions, allow promotion codes and set trial behaviour.
  if (mode === "subscription") {
    body.allow_promotion_codes = "true";
    // Pass metadata at the subscription level so we can look it up from the
    // subscription object when the lifecycle webhook fires.
    body["subscription_data[metadata][company_id]"] = args.companyId;
    body["subscription_data[metadata][tier_key]"] = args.tierKey;
  }
  const session = await stripePost<{ id: string; url: string }>("/v1/checkout/sessions", body);
  return { sessionId: session.id, url: session.url };
}

export interface CheckoutSessionStatus {
  id: string;
  status: "open" | "complete" | "expired";
  paymentStatus: string;
  customerId: string | null;
  subscriptionId: string | null;
  metadata: Record<string, string>;
}

/** Retrieve a Checkout Session by its cs_... id. */
export async function getCheckoutSession(sessionId: string): Promise<CheckoutSessionStatus> {
  const s = await stripeGet<any>(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return {
    id: s.id,
    status: s.status ?? "open",
    paymentStatus: s.payment_status ?? "unpaid",
    customerId: s.customer ?? null,
    subscriptionId: s.subscription ?? null,
    metadata: (s.metadata as Record<string, string>) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface SubscriptionStatus {
  id: string;
  status: string;
  currentPeriodEnd: number | null;
  customerId: string | null;
  metadata: Record<string, string>;
}

/** Retrieve a Stripe subscription. */
export async function getSubscription(subscriptionId: string): Promise<SubscriptionStatus> {
  const s = await stripeGet<any>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return {
    id: s.id,
    status: s.status ?? "unknown",
    currentPeriodEnd: s.current_period_end ?? null,
    customerId: s.customer ?? null,
    metadata: (s.metadata as Record<string, string>) ?? {},
  };
}

/** Cancel a Stripe subscription immediately (at_period_end=false). */
export async function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd = false,
): Promise<void> {
  if (atPeriodEnd) {
    await stripePost<any>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      cancel_at_period_end: "true",
    });
  } else {
    await fetch(`${STRIPE_API}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret()}` },
    });
  }
}

// ---------------------------------------------------------------------------
// Webhook verification (replaces PAYPAL_WEBHOOK_ID flow entirely)
// ---------------------------------------------------------------------------

/**
 * Verify a Stripe webhook event using the STRIPE_WEBHOOK_SECRET (whsec_...).
 * Stripe uses a HMAC-SHA256 signature over a timestamp+payload string.
 * Returns the parsed event or throws on verification failure.
 *
 * We implement signature verification without the Stripe npm package using
 * Node's built-in crypto so there is no additional dependency.
 *
 * IMPORTANT: the caller must pass the RAW body buffer (before JSON.parse) and
 * the Stripe-Signature header verbatim. In app.ts the webhook route must use
 * express.raw({ type: 'application/json' }) BEFORE express.json().
 */
export async function constructWebhookEvent(
  rawBody: Buffer | string,
  signatureHeader: string,
): Promise<{ type: string; data: { object: Record<string, unknown> }; id: string }> {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) {
    throw new StripeNotConfigured(
      "STRIPE_WEBHOOK_SECRET not set. Set it to the whsec_... value from the Stripe Dashboard.",
    );
  }

  // Parse the Stripe-Signature header: t=timestamp,v1=sig1,...
  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) {
    throw new Error("Invalid Stripe-Signature header");
  }

  // Reject events older than 5 minutes to prevent replay attacks.
  const tsSec = Number(timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 300) {
    throw new Error("Stripe webhook timestamp is stale (>5 min). Possible replay attack.");
  }

  // Build the signed payload string: timestamp + "." + raw body.
  const payload =
    typeof rawBody === "string"
      ? rawBody
      : (rawBody as Buffer).toString("utf8");
  const signedPayload = `${timestamp}.${payload}`;

  // Compute HMAC-SHA256 using Node's built-in crypto.
  const { createHmac } = await import("node:crypto");
  const expectedSig = createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // Constant-time comparison to prevent timing attacks.
  const { timingSafeEqual } = await import("node:crypto");
  const expected = Buffer.from(expectedSig, "hex");
  const received = Buffer.from(signature, "hex");
  let valid = false;
  try {
    valid = expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error("Stripe webhook signature verification failed.");
  }

  return JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
    id: string;
  };
}
