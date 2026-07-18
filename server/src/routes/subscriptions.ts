/**
 * Subscription Tiers + Entitlements routes for Divini Procure. Mounted under
 * /api. Additive; does not replace any existing billing or feature gating.
 *
 * Member-facing:
 *   GET  /subscriptions/tiers                 (signed-in)  -> all tiers
 *   GET  /subscriptions/mine?companyId=       (member)     -> entitlement + usage + limits
 *
 * Admin-only:
 *   POST  /admin/subscriptions/tiers          (admin) upsert a tier (by key)
 *   PATCH /admin/subscriptions/entitlement    (admin) assign a tier to a company
 *   GET   /admin/subscriptions                (admin) all entitlements + company name
 *   POST  /admin/stripe/sync-prices           (admin) create Stripe Products/Prices for paid tiers
 *
 * Vendor self-serve (PROCURE_MONETIZATION_V2 only):
 *   POST  /subscriptions/checkout { companyId, tierKey, successUrl, cancelUrl }
 *         -> Stripe Checkout Session; returns { recordOnly, sessionId, url }
 *         -> Free tiers assigned immediately (record-only).
 *   GET   /subscriptions/session?sessionId=   -> verify a Checkout Session, assign tier
 *   POST  /subscriptions/cancel               (vendor member) cancel + downgrade to free
 *
 * Webhook (Stripe only):
 *   POST  /webhooks/stripe                    -> checkout.session.completed,
 *                                                customer.subscription.deleted,
 *                                                customer.subscription.updated,
 *                                                invoice.payment_failed
 *
 * Splits: the Stripe Connect payout engine (split-engine.ts + stripe-connect.ts)
 * is separate. Subscription billing COLLECTS money from buyers; the split engine
 * DISTRIBUTES referral partner shares from platform_revenue rows. The two are
 * intentionally decoupled so subscription billing never blocks on payout logic.
 *
 * Authorization mirrors the rest of the app: a non-admin caller must be a
 * member of the companyId they read. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError } from "../db.js";
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import * as stripe from "../lib/stripe.js";
import {
  listTiers,
  getEntitlement,
  usage,
  allLimits,
  type Tier,
} from "../lib/entitlements.js";
import { sendEmail } from "../lib/email.js";

/** Vendor-facing self-serve tiers (the "upgrade to Pro / buy Verified+" set). */
const SELF_SERVE_TIER_KEYS = new Set(["vendor_pro", "verified_plus", "vendor_featured"]);
const VENDOR_FREE_TIER_KEY = "vendor_free";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

async function assertMember(req: Request, companyId: string): Promise<void> {
  const auth = getAuth(req);
  if (auth.isAdmin) return;
  const ok = await q1(
    "select 1 from company_members where user_id = $1 and company_id = $2",
    [auth.userId, companyId],
  );
  if (!ok) throw new ForbiddenError("not a member of this company");
}

async function callerIsMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(
    "select 1 from company_members where user_id = $1 and company_id = $2",
    [userId, companyId],
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// Tier assignment (payment-method agnostic; used by webhook + admin routes)
// ---------------------------------------------------------------------------

/**
 * Assign a tier to a company by copying the tier defaults onto
 * subscription_entitlements. Record-only: no payment is taken. Returns the row.
 */
async function assignTierToCompany(companyId: string, tier: Tier): Promise<unknown> {
  return q1(
    `insert into subscription_entitlements
       (company_id, tier_key, audience,
        active_project_limit, bid_package_limit, vendor_invite_limit,
        investment_program_limit, investor_match_limit, seat_limit,
        ai_features, reporting_access, white_glove, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (company_id) do update set
       tier_key = excluded.tier_key,
       audience = excluded.audience,
       active_project_limit = excluded.active_project_limit,
       bid_package_limit = excluded.bid_package_limit,
       vendor_invite_limit = excluded.vendor_invite_limit,
       investment_program_limit = excluded.investment_program_limit,
       investor_match_limit = excluded.investor_match_limit,
       seat_limit = excluded.seat_limit,
       ai_features = excluded.ai_features,
       reporting_access = excluded.reporting_access,
       white_glove = excluded.white_glove,
       updated_at = now()
     returning *`,
    [
      companyId,
      tier.key,
      tier.audience,
      tier.active_project_limit,
      tier.bid_package_limit,
      tier.vendor_invite_limit,
      tier.investment_program_limit,
      tier.investor_match_limit,
      tier.seat_limit,
      tier.ai_features,
      tier.reporting_access,
      tier.white_glove,
    ],
  );
}

/** Downgrade a company to the free tier and clear its Stripe subscription id. */
async function assignFreeTier(companyId: string): Promise<void> {
  const ent = await q1<{ audience: string | null }>(
    "select audience from subscription_entitlements where company_id = $1",
    [companyId],
  );
  const audience = ent?.audience || "developer";
  const freeKey = audience === "vendor" ? "vendor_free" : "developer_free";
  const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [freeKey]);
  if (tier) await assignTierToCompany(companyId, tier);
  await q(
    `update subscription_entitlements
        set stripe_subscription_id = null,
            subscription_status = 'cancelled',
            updated_at = now()
      where company_id = $1`,
    [companyId],
  );
}

/**
 * Resolve the Stripe Customer for a company. Returns an existing id or creates
 * a new Stripe Customer and caches it. Uses the subscription_entitlements row
 * as the cache. The user's email is used so the Stripe dashboard is readable.
 */
async function resolveStripeCustomer(
  companyId: string,
  userEmail: string | null,
): Promise<string | null> {
  if (!stripe.isConfigured()) return null;
  const existing = await q1<{ stripe_customer_id: string | null }>(
    "select stripe_customer_id from subscription_entitlements where company_id = $1",
    [companyId],
  );
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const company = await q1<{ name: string | null }>("select name from companies where id = $1", [companyId]);
  try {
    const { customerId } = await stripe.createCustomer({
      email: userEmail,
      name: company?.name ?? undefined,
      metadata: { company_id: companyId },
    });
    // Cache the customer id immediately.
    await q(
      `insert into subscription_entitlements (company_id, stripe_customer_id, updated_at)
       values ($1, $2, now())
       on conflict (company_id) do update set stripe_customer_id = $2, updated_at = now()`,
      [companyId, customerId],
    );
    return customerId;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve and authorize the acting vendor company for self-serve actions.
// ---------------------------------------------------------------------------
async function resolveVendorCompany(
  req: Request,
  res: Response,
): Promise<string | null> {
  const companyId = String(
    (req.body && req.body.companyId) || req.query.companyId || "",
  ).trim();
  if (!companyId) {
    res.status(400).json({ error: "companyId required" });
    return null;
  }
  await assertMember(req, companyId);
  const company = await q1<{ kind: string | null }>(
    "select kind from companies where id = $1",
    [companyId],
  );
  if (!company) {
    res.status(404).json({ error: "company not found" });
    return null;
  }
  if (company.kind !== "vendor") {
    res.status(403).json({ error: "self-serve subscriptions are for vendor companies" });
    return null;
  }
  return companyId;
}

// ===========================================================================
// READ ROUTES
// ===========================================================================

// GET /subscriptions/tiers -> the full catalogue (any signed-in user).
router.get(
  "/subscriptions/tiers",
  requireUser,
  h(async (_req, res) => {
    res.json({ tiers: await listTiers() });
  }),
);

// GET /subscriptions/mine?companyId= -> entitlement + usage + per-key limits.
router.get(
  "/subscriptions/mine",
  requireUser,
  h(async (req, res) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : "";
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(req, companyId);
    const [entitlement, used, limits] = await Promise.all([
      getEntitlement(companyId),
      usage(companyId),
      allLimits(companyId),
    ]);
    res.json({ entitlement, usage: used, limits });
  }),
);

// ===========================================================================
// ADMIN ROUTES (tier + entitlement management)
// ===========================================================================

// POST /admin/subscriptions/tiers -> upsert a tier by key (admin).
router.post(
  "/admin/subscriptions/tiers",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Partial<Tier>;
    const key = (b.key ?? "").trim();
    if (!key) return res.status(400).json({ error: "key required" });
    const audience =
      b.audience === "vendor" || b.audience === "investor" ? b.audience : "developer";

    const row = await q1<Tier>(
      `insert into subscription_tiers
         (key, name, audience, price_cents,
          active_project_limit, bid_package_limit, vendor_invite_limit,
          investment_program_limit, investor_match_limit, seat_limit,
          ai_features, reporting_access, white_glove, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (key) do update set
         name = excluded.name,
         audience = excluded.audience,
         price_cents = excluded.price_cents,
         active_project_limit = excluded.active_project_limit,
         bid_package_limit = excluded.bid_package_limit,
         vendor_invite_limit = excluded.vendor_invite_limit,
         investment_program_limit = excluded.investment_program_limit,
         investor_match_limit = excluded.investor_match_limit,
         seat_limit = excluded.seat_limit,
         ai_features = excluded.ai_features,
         reporting_access = excluded.reporting_access,
         white_glove = excluded.white_glove,
         sort = excluded.sort
       returning *`,
      [
        key,
        b.name ?? key,
        audience,
        Number.isFinite(Number(b.price_cents)) ? Number(b.price_cents) : 0,
        b.active_project_limit ?? null,
        b.bid_package_limit ?? null,
        b.vendor_invite_limit ?? null,
        b.investment_program_limit ?? null,
        b.investor_match_limit ?? null,
        b.seat_limit ?? null,
        b.ai_features ?? false,
        b.reporting_access ?? false,
        b.white_glove ?? false,
        Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0,
      ],
    );
    res.json({ tier: row });
  }),
);

// PATCH /admin/subscriptions/entitlement -> assign a tier to a company (admin).
router.patch(
  "/admin/subscriptions/entitlement",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = (b.companyId ?? "").trim();
    const tierKey = (b.tierKey ?? "").trim();
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!tierKey) return res.status(400).json({ error: "tierKey required" });

    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });

    const ov = (k: string, tierVal: number | null) =>
      b[k] === undefined || b[k] === null || b[k] === "" ? tierVal : Number(b[k]);
    const ovBool = (k: string, tierVal: boolean) =>
      b[k] === undefined || b[k] === null ? tierVal : Boolean(b[k]);

    const row = await q1(
      `insert into subscription_entitlements
         (company_id, tier_key, audience,
          active_project_limit, bid_package_limit, vendor_invite_limit,
          investment_program_limit, investor_match_limit, seat_limit,
          ai_features, reporting_access, white_glove, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (company_id) do update set
         tier_key = excluded.tier_key,
         audience = excluded.audience,
         active_project_limit = excluded.active_project_limit,
         bid_package_limit = excluded.bid_package_limit,
         vendor_invite_limit = excluded.vendor_invite_limit,
         investment_program_limit = excluded.investment_program_limit,
         investor_match_limit = excluded.investor_match_limit,
         seat_limit = excluded.seat_limit,
         ai_features = excluded.ai_features,
         reporting_access = excluded.reporting_access,
         white_glove = excluded.white_glove,
         updated_at = now()
       returning *`,
      [
        companyId,
        tier.key,
        tier.audience,
        ov("active_project_limit", tier.active_project_limit),
        ov("bid_package_limit", tier.bid_package_limit),
        ov("vendor_invite_limit", tier.vendor_invite_limit),
        ov("investment_program_limit", tier.investment_program_limit),
        ov("investor_match_limit", tier.investor_match_limit),
        ov("seat_limit", tier.seat_limit),
        ovBool("ai_features", tier.ai_features),
        ovBool("reporting_access", tier.reporting_access),
        ovBool("white_glove", tier.white_glove),
      ],
    );
    res.json({ entitlement: row, effective: await getEntitlement(companyId) });
  }),
);

// GET /admin/subscriptions -> all entitlements with company name (admin).
router.get(
  "/admin/subscriptions",
  requireAdmin,
  h(async (_req, res) => {
    const rows = await q(
      `select e.company_id,
              c.name as company_name,
              c.kind as company_kind,
              e.tier_key,
              e.audience,
              t.name as tier_name,
              t.price_cents,
              e.seat_limit,
              e.active_project_limit,
              e.bid_package_limit,
              e.investment_program_limit,
              e.investor_match_limit,
              e.ai_features,
              e.reporting_access,
              e.white_glove,
              e.stripe_subscription_id,
              e.stripe_customer_id,
              e.subscription_status,
              e.updated_at
         from subscription_entitlements e
         left join companies c on c.id = e.company_id
         left join subscription_tiers t on t.key = e.tier_key
        order by c.name asc nulls last`,
    );
    res.json({ entitlements: rows });
  }),
);

// ---------------------------------------------------------------------------
// Admin: investor plan assignment (investors are user-keyed, not company-keyed).
// ---------------------------------------------------------------------------
const INVESTOR_PLANS = new Set(["free", "premium", "concierge"]);

router.get(
  "/admin/investors",
  requireAdmin,
  h(async (req, res) => {
    const qStr = String(req.query.q ?? "").trim().toLowerCase();
    const investors = qStr
      ? await q(
          `select id, user_id, email, full_name, plan from investor_profiles
            where lower(coalesce(email,'')) like $1 or lower(coalesce(full_name,'')) like $1
            order by created_at desc limit 100`,
          [`%${qStr}%`],
        )
      : await q(
          `select id, user_id, email, full_name, plan from investor_profiles order by created_at desc limit 100`,
        );
    res.json({ investors });
  }),
);

router.patch(
  "/admin/investors/plan",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const userId = String(b.userId ?? "").trim();
    const plan = String(b.plan ?? "").trim().toLowerCase();
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!INVESTOR_PLANS.has(plan))
      return res.status(400).json({ error: "plan must be free, premium or concierge" });
    const row = await q1(
      `update investor_profiles set plan = $2, updated_at = now() where user_id = $1
       returning id, user_id, email, full_name, plan`,
      [userId, plan],
    );
    if (!row) return res.status(404).json({ error: "investor not found" });
    res.json({ investor: row });
  }),
);

// ===========================================================================
// ADMIN: STRIPE PRICE SYNC
// Creates a Stripe Product and a monthly recurring Price for each paid tier.
// Safe to re-run: only creates when stripe_price_id is not yet set.
// ===========================================================================

router.post(
  "/admin/stripe/sync-prices",
  requireAdmin,
  h(async (req, res) => {
    if (!stripe.isConfigured()) return res.status(400).json({ error: "Stripe not configured" });
    const paid = await q<Tier & { stripe_price_id: string | null; stripe_product_id: string | null }>(
      "select * from subscription_tiers where price_cents > 0 order by price_cents asc",
    );
    const results: { key: string; priceId: string; created: boolean }[] = [];
    for (const t of paid) {
      if (t.stripe_price_id) {
        results.push({ key: t.key, priceId: t.stripe_price_id, created: false });
        continue;
      }
      const { priceId, productId } = await stripe.ensurePrice({
        tierKey: t.key,
        tierName: t.name ?? t.key,
        amountCents: Number(t.price_cents),
        existingProductId: t.stripe_product_id,
      });
      await q(
        `update subscription_tiers
            set stripe_price_id = $2, stripe_product_id = $3
          where key = $1`,
        [t.key, priceId, productId],
      );
      results.push({ key: t.key, priceId, created: true });
    }
    res.json({ synced: results });
  }),
);

// ===========================================================================
// VENDOR SELF-SERVE (PROCURE_MONETIZATION_V2 only) - Stripe Checkout
// ===========================================================================

/**
 * POST /subscriptions/checkout { companyId, tierKey, successUrl, cancelUrl }
 *
 * For free tiers or when Stripe is not configured: record-only assignment.
 * For paid tiers with Stripe configured: creates a Checkout Session and
 * returns { sessionId, url } for the frontend to redirect to.
 *
 * The successUrl should include {CHECKOUT_SESSION_ID} which Stripe fills in:
 *   /subscription?session_id={CHECKOUT_SESSION_ID}
 *
 * Idempotency: if a session for this companyId+tierKey is already 'complete',
 * the tier has already been assigned by the webhook. We return ok=true.
 */
router.post(
  "/subscriptions/checkout",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    const tierKey = String(b.tierKey ?? "").trim();
    if (!companyId || !tierKey) {
      return res.status(400).json({ error: "companyId and tierKey required" });
    }
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const tier = await q1<Tier & { stripe_price_id: string | null }>(
      "select * from subscription_tiers where key = $1",
      [tierKey],
    );
    if (!tier) return res.status(404).json({ error: "tier not found" });

    // Free tier or Stripe not configured: assign immediately.
    if (Number(tier.price_cents) <= 0 || !stripe.isConfigured()) {
      const row = await assignTierToCompany(companyId, tier);
      return res.json({
        recordOnly: true,
        entitlement: row,
        note: stripe.isConfigured() ? "free tier" : "Stripe not configured; tier assigned record-only",
      });
    }

    // Paid tier: must have a stripe_price_id (run /admin/stripe/sync-prices first).
    if (!tier.stripe_price_id) {
      return res.status(400).json({
        error: "No Stripe price for this tier. Run /admin/stripe/sync-prices first.",
        needsSync: true,
      });
    }

    const customerId = await resolveStripeCustomer(companyId, auth.email ?? null);
    const successUrl =
      String(b.successUrl || "") ||
      `${process.env.PUBLIC_APP_URL || "https://diviniprocure.com"}/subscription?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      String(b.cancelUrl || "") ||
      `${process.env.PUBLIC_APP_URL || "https://diviniprocure.com"}/subscription`;

    try {
      const session = await stripe.createCheckoutSession({
        priceId: tier.stripe_price_id,
        customerId,
        customerEmail: customerId ? undefined : (auth.email ?? undefined),
        companyId,
        tierKey,
        successUrl,
        cancelUrl,
        mode: "subscription",
      });
      res.json({ recordOnly: false, sessionId: session.sessionId, url: session.url });
    } catch (e: any) {
      if (e instanceof stripe.StripeNotConfigured) {
        const row = await assignTierToCompany(companyId, tier);
        return res.json({ recordOnly: true, entitlement: row, note: "Stripe not configured; tier assigned record-only" });
      }
      return res.status(502).json({ error: e?.message || "Stripe checkout failed" });
    }
  }),
);

/**
 * GET /subscriptions/session?sessionId= -> verify session and assign tier.
 *
 * Called from the success URL after Stripe redirects back. Looks up the session
 * to confirm status=complete and payment_status=paid, then assigns the tier.
 * Idempotent: safe to call multiple times for the same session_id.
 *
 * We also process via webhook (checkout.session.completed) for reliability, so
 * this endpoint is a belt-and-suspenders confirmation for the user's browser.
 */
router.get(
  "/subscriptions/session",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    if (!stripe.isConfigured()) return res.status(400).json({ error: "Stripe not configured" });

    let session: Awaited<ReturnType<typeof stripe.getCheckoutSession>>;
    try {
      session = await stripe.getCheckoutSession(sessionId);
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || "Could not retrieve Stripe session" });
    }

    if (session.status !== "complete" || session.paymentStatus !== "paid") {
      return res.status(402).json({
        error: "Payment not completed",
        status: session.status,
        paymentStatus: session.paymentStatus,
      });
    }

    const companyId = session.metadata.company_id;
    const tierKey = session.metadata.tier_key;
    if (!companyId || !tierKey) {
      return res.status(400).json({ error: "Session metadata missing company_id or tier_key" });
    }

    // Auth check: the calling user must be a member of the company in the session.
    const auth = getAuth(req);
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }

    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });

    const row = await assignTierToCompany(companyId, tier);

    // Cache the subscription id if available so we can cancel it later.
    if (session.subscriptionId) {
      await q(
        `update subscription_entitlements
            set stripe_subscription_id = $2,
                stripe_customer_id = coalesce($3, stripe_customer_id),
                subscription_status = 'active',
                updated_at = now()
          where company_id = $1`,
        [companyId, session.subscriptionId, session.customerId],
      );
    }

    res.json({ ok: true, entitlement: row, effective: await getEntitlement(companyId) });
  }),
);

/**
 * POST /subscriptions/cancel { companyId } -> cancel Stripe subscription + downgrade.
 */
router.post(
  "/subscriptions/cancel",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;

    const ent = await q1<{ stripe_subscription_id: string | null }>(
      "select stripe_subscription_id from subscription_entitlements where company_id = $1",
      [companyId],
    );
    if (ent?.stripe_subscription_id && stripe.isConfigured()) {
      try {
        // Cancel at period end so the user keeps access until the period they paid for.
        await stripe.cancelSubscription(ent.stripe_subscription_id, true);
      } catch {
        // Already cancelled or expired - proceed to downgrade anyway.
      }
    }
    await assignFreeTier(companyId);
    res.json({ ok: true, effective: await getEntitlement(companyId) });
  }),
);

// ===========================================================================
// STRIPE WEBHOOK
// Raw body must be preserved for signature verification. In app.ts, mount this
// BEFORE express.json() or use express.raw({ type: 'application/json' }) on
// this specific path. The route is public but signature-guarded.
// ===========================================================================

router.post(
  "/webhooks/stripe",
  h(async (req, res) => {
    // req.body is a Buffer when express.raw() is applied (configured in app.ts).
    const sig = req.headers["stripe-signature"];
    if (!sig || typeof sig !== "string") {
      return res.status(400).json({ error: "Missing Stripe-Signature header" });
    }

    let event: { type: string; data: { object: Record<string, unknown> }; id: string };
    try {
      event = await stripe.constructWebhookEvent(req.body as Buffer, sig);
    } catch (e: any) {
      // Return 400 so Stripe retries only legitimate delivery failures, not bad signatures.
      return res.status(400).json({ error: `Webhook error: ${e?.message}` });
    }

    const obj = event.data.object as Record<string, unknown>;

    try {
      switch (event.type) {
        // -----------------------------------------------------------------
        // Checkout completed: assign the tier.
        // -----------------------------------------------------------------
        case "checkout.session.completed": {
          if (obj.payment_status !== "paid") break;
          const meta = (obj.metadata as Record<string, string>) ?? {};
          const companyId = meta.company_id;
          const tierKey = meta.tier_key;
          if (!companyId || !tierKey || !PROCURE_MONETIZATION_V2) break;

          const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
          if (!tier) break;
          await assignTierToCompany(companyId, tier);

          // Cache subscription + customer ids.
          const subId = (obj.subscription as string | null) ?? null;
          const custId = (obj.customer as string | null) ?? null;
          if (subId || custId) {
            await q(
              `update subscription_entitlements
                  set stripe_subscription_id = coalesce($2, stripe_subscription_id),
                      stripe_customer_id = coalesce($3, stripe_customer_id),
                      subscription_status = 'active',
                      updated_at = now()
                where company_id = $1`,
              [companyId, subId, custId],
            );
          }
          // Send a confirmation email to the company owner. Best-effort: a
          // failure here must never fail the webhook response (Stripe would retry).
          try {
            const owner = await q1<{ email: string; name: string | null }>(
              `select u.email, c.name
                 from company_members cm
                 join users u on u.id = cm.user_id
                 join companies c on c.id = cm.company_id
                where cm.company_id = $1
                  and cm.role = 'owner'
                order by cm.created_at asc
                limit 1`,
              [companyId],
            );
            if (owner) {
              await sendEmail({
                to: owner.email,
                subject: "Your Divini Procure subscription is active",
                text:
                  `Hi${owner.name ? ` from ${owner.name}` : ""},\n\n` +
                  `Your subscription to the ${tier.name} plan is now active.\n\n` +
                  `You can manage your plan at any time from Settings in the Divini Procure app.\n\n` +
                  `Thank you for using Divini Procure.\n\n` +
                  `--\n` +
                  `Divini Procure\n` +
                  `support@diviniprocure.com\n` +
                  `9169 W State St #2739, Garden City, ID 83714`,
              });
            }
          } catch (emailErr) {
            console.warn("[webhook] checkout confirmation email failed:", (emailErr as Error).message);
          }
          break;
        }

        // -----------------------------------------------------------------
        // Subscription deleted or cancelled: downgrade to free.
        // -----------------------------------------------------------------
        case "customer.subscription.deleted": {
          const subId = (obj.id as string | null) ?? null;
          if (!subId) break;
          const ent = await q1<{ company_id: string }>(
            "select company_id from subscription_entitlements where stripe_subscription_id = $1",
            [subId],
          );
          if (ent?.company_id) await assignFreeTier(ent.company_id);
          break;
        }

        // -----------------------------------------------------------------
        // Invoice payment failed: mark the subscription as past_due.
        // Do NOT downgrade yet - Stripe will retry and eventually fire
        // customer.subscription.deleted if all retries fail.
        // -----------------------------------------------------------------
        case "invoice.payment_failed": {
          const custId = (obj.customer as string | null) ?? null;
          if (!custId) break;
          await q(
            `update subscription_entitlements
                set subscription_status = 'past_due', updated_at = now()
              where stripe_customer_id = $1`,
            [custId],
          );
          break;
        }

        // -----------------------------------------------------------------
        // Subscription updated: sync status (handles reactivation etc.)
        // -----------------------------------------------------------------
        case "customer.subscription.updated": {
          const subId = (obj.id as string | null) ?? null;
          const status = (obj.status as string | null) ?? null;
          if (!subId || !status) break;
          if (["active", "trialing"].includes(status)) {
            await q(
              `update subscription_entitlements
                  set subscription_status = 'active', updated_at = now()
                where stripe_subscription_id = $1`,
              [subId],
            );
          } else if (status === "past_due") {
            await q(
              `update subscription_entitlements
                  set subscription_status = 'past_due', updated_at = now()
                where stripe_subscription_id = $1`,
              [subId],
            );
          } else if (["canceled", "unpaid"].includes(status)) {
            const ent = await q1<{ company_id: string }>(
              "select company_id from subscription_entitlements where stripe_subscription_id = $1",
              [subId],
            );
            if (ent?.company_id) await assignFreeTier(ent.company_id);
          }
          break;
        }

        default:
          // Unhandled event type - acknowledge but take no action.
          break;
      }
    } catch (e) {
      // Log processing errors but always return 200 so Stripe doesn't retry
      // events where processing would always fail (e.g. missing tier in DB).
      console.error("[webhook:stripe] processing error", event.type, e);
    }

    res.json({ received: true });
  }),
);

export default router;
