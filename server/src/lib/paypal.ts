/**
 * Divini Procure - PAYPAL adapter (fetch-based, no npm dependency).
 *
 * A thin wrapper over the PayPal Orders v2 REST API using the global fetch.
 * Mirrors the stripe-connect.ts pattern: every call is guarded on
 * PAYPAL_CLIENT_ID + PAYPAL_SECRET. When keys are not configured, calls throw a
 * typed PaypalNotConfigured error and routes fall back to record-only behavior.
 *
 * We never touch raw card/bank numbers: checkout is a PayPal-hosted approval
 * link; we only create an order for the tier price and capture it on return.
 *
 * Env:
 *   PAYPAL_CLIENT_ID   - REST app client id
 *   PAYPAL_SECRET      - REST app secret
 *   PAYPAL_ENV         - 'live' | 'sandbox' (default 'sandbox')
 *
 * Zero em dashes by convention.
 */

function apiBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  // FAIL-LOUD in production: if PAYPAL_ENV is not explicitly set to "live",
  // payments will silently hit the sandbox and no real money will be collected.
  if (process.env.NODE_ENV === "production" && env !== "live") {
    // eslint-disable-next-line no-console
    console.warn(
      "[paypal] WARNING: PAYPAL_ENV is not set to 'live' in production. " +
        "All PayPal orders will be routed to the SANDBOX and no real money will be captured. " +
        "Set PAYPAL_ENV=live to enable real payments.",
    );
  }
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

/** True when PayPal REST credentials are present (live calls are possible). */
export function isConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID || "").trim() && !!(process.env.PAYPAL_SECRET || "").trim();
}

export class PaypalNotConfigured extends Error {
  code = "paypal_not_configured" as const;
  constructor(msg = "PayPal not configured: set PAYPAL_CLIENT_ID and PAYPAL_SECRET to take payments") {
    super(msg);
    this.name = "PaypalNotConfigured";
  }
}

export class PaypalApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.name = "PaypalApiError";
    this.status = status;
  }
}

function creds(): { id: string; secret: string } {
  const id = (process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = (process.env.PAYPAL_SECRET || "").trim();
  if (!id || !secret) throw new PaypalNotConfigured();
  return { id, secret };
}

async function accessToken(): Promise<string> {
  const { id, secret } = creds();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    throw new PaypalApiError(r.status, j.error_description || "PayPal auth failed");
  }
  return j.access_token;
}

export interface CreatedOrder {
  orderId: string;
  approveUrl: string | null;
}

/** Create a one-period CAPTURE order for a subscription tier. Amount in cents. */
export async function createOrder(args: {
  amountCents: number;
  description: string;
  referenceId?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}): Promise<CreatedOrder> {
  const token = await accessToken();
  const value = (Math.max(0, Math.round(args.amountCents)) / 100).toFixed(2);
  const r = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.referenceId,
          description: args.description.slice(0, 127),
          amount: { currency_code: "USD", value },
        },
      ],
      application_context: {
        brand_name: args.brandName || "Divini Procure",
        user_action: "PAY_NOW",
        return_url: args.returnUrl,
        cancel_url: args.cancelUrl,
      },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    id?: string;
    links?: { rel: string; href: string }[];
    message?: string;
  };
  if (!r.ok || !j.id) throw new PaypalApiError(r.status, j.message || "PayPal order create failed");
  const approve = (j.links || []).find((l) => l.rel === "approve")?.href ?? null;
  return { orderId: j.id, approveUrl: approve };
}

export interface CaptureResult {
  ok: boolean;
  status: string;
  orderId: string;
}

/** Capture a previously-approved order. ok=true only on COMPLETED. */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!r.ok) throw new PaypalApiError(r.status, j.message || "PayPal capture failed");
  return { ok: j.status === "COMPLETED", status: j.status || "unknown", orderId };
}

// ===========================================================================
// RECURRING: Catalog product + billing plans + subscriptions (auto-renewal)
// ===========================================================================

/** Create a SERVICE catalog product (the container for billing plans). */
export async function createProduct(name: string, description = "Divini Procure platform access"): Promise<string> {
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v1/catalogs/products`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.slice(0, 127), description: description.slice(0, 256), type: "SERVICE", category: "SOFTWARE" }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok || !j.id) throw new PaypalApiError(r.status, j.message || "PayPal product create failed");
  return j.id;
}

/** Create a monthly fixed-price billing plan under a product. Amount in cents. */
export async function createMonthlyPlan(args: { productId: string; name: string; amountCents: number }): Promise<string> {
  const token = await accessToken();
  const value = (Math.max(0, Math.round(args.amountCents)) / 100).toFixed(2);
  const r = await fetch(`${apiBase()}/v1/billing/plans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: args.productId,
      name: args.name.slice(0, 127),
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0, // 0 = infinite until cancelled
          pricing_scheme: { fixed_price: { value, currency_code: "USD" } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 1,
      },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok || !j.id) throw new PaypalApiError(r.status, j.message || "PayPal plan create failed");
  return j.id;
}

export interface CreatedSubscription {
  subscriptionId: string;
  approveUrl: string | null;
}

/** Start a subscription against a plan; returns the approval link. */
export async function createSubscription(args: {
  planId: string;
  customId?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}): Promise<CreatedSubscription> {
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v1/billing/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      plan_id: args.planId,
      custom_id: args.customId,
      application_context: {
        brand_name: args.brandName || "Divini Procure",
        user_action: "SUBSCRIBE_NOW",
        return_url: args.returnUrl,
        cancel_url: args.cancelUrl,
      },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; links?: { rel: string; href: string }[]; message?: string };
  if (!r.ok || !j.id) throw new PaypalApiError(r.status, j.message || "PayPal subscription create failed");
  const approve = (j.links || []).find((l) => l.rel === "approve")?.href ?? null;
  return { subscriptionId: j.id, approveUrl: approve };
}

/** Read a subscription's status (ACTIVE / APPROVED / CANCELLED / EXPIRED / SUSPENDED). */
export async function getSubscription(subscriptionId: string): Promise<{ status: string; custom_id?: string }> {
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await r.json().catch(() => ({}))) as { status?: string; custom_id?: string; message?: string };
  if (!r.ok) throw new PaypalApiError(r.status, j.message || "PayPal subscription lookup failed");
  return { status: j.status || "unknown", custom_id: j.custom_id };
}

/** Cancel an active subscription. */
export async function cancelSubscription(subscriptionId: string, reason = "Cancelled by user"): Promise<void> {
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason.slice(0, 127) }),
  });
  if (!r.ok && r.status !== 204) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new PaypalApiError(r.status, j.message || "PayPal subscription cancel failed");
  }
}

/** Verify a webhook signature against PAYPAL_WEBHOOK_ID. Returns false when unverifiable. */
export async function verifyWebhook(headers: Record<string, string | undefined>, event: unknown): Promise<boolean> {
  const webhookId = (process.env.PAYPAL_WEBHOOK_ID || "").trim();
  if (!webhookId) return false;
  const token = await accessToken();
  const r = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id: headers["paypal-transmission-id"],
      transmission_time: headers["paypal-transmission-time"],
      cert_url: headers["paypal-cert-url"],
      auth_algo: headers["paypal-auth-algo"],
      transmission_sig: headers["paypal-transmission-sig"],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { verification_status?: string };
  return j.verification_status === "SUCCESS";
}
