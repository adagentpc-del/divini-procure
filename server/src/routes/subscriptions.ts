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
 *
 * Vendor self-serve (PROCURE_MONETIZATION_V2 only):
 *   POST  /subscriptions/subscribe { tierKey }  (vendor member) upgrade to Pro /
 *                                                buy Verified+ / Featured tier
 *   POST  /subscriptions/cancel                 (vendor member) back to vendor_free
 *
 * Self-serve is RECORD-ONLY (Stripe-ready): it writes subscription_entitlements
 * exactly like the admin assign path, but never charges a card or moves money.
 *
 * Membership scoping mirrors the rest of the app: a non-admin caller must be a
 * member of the companyId they read. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError } from "../db.js";
import { q, q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import * as paypal from "../lib/paypal.js";
import {
  listTiers,
  getEntitlement,
  usage,
  allLimits,
  type Tier,
} from "../lib/entitlements.js";

/** Vendor-facing self-serve tiers (the "upgrade to Pro / buy Verified+" set). */
const SELF_SERVE_TIER_KEYS = new Set([
  "vendor_pro",
  "verified_plus",
  "vendor_featured",
]);
const VENDOR_FREE_TIER_KEY = "vendor_free";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** Throw ForbiddenError unless caller is admin or a member of companyId. */
async function assertMember(req: Request, companyId: string): Promise<void> {
  const auth = getAuth(req);
  if (auth.isAdmin) return;
  const ok = await q1("select 1 from company_members where user_id = $1 and company_id = $2", [
    auth.userId,
    companyId,
  ]);
  if (!ok) throw new ForbiddenError("not a member of this company");
}

/**
 * Assign a tier to a company by copying the tier defaults onto
 * subscription_entitlements (the same effective-limit write the admin assign
 * path uses). Record-only: no payment is taken. Returns the stored row.
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

// ---------------------------------------------------------------------------
// GET /subscriptions/tiers  -> the full catalogue (any signed-in user).
// ---------------------------------------------------------------------------
router.get(
  "/subscriptions/tiers",
  requireUser,
  h(async (_req, res) => {
    res.json({ tiers: await listTiers() });
  }),
);

// ---------------------------------------------------------------------------
// GET /subscriptions/mine?companyId=  -> entitlement + usage + per-key limits.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /admin/subscriptions/tiers  -> upsert a tier by key (admin).
// ---------------------------------------------------------------------------
router.post(
  "/admin/subscriptions/tiers",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Partial<Tier>;
    const key = (b.key ?? "").trim();
    if (!key) return res.status(400).json({ error: "key required" });
    const audience = b.audience === "vendor" || b.audience === "investor" ? b.audience : "developer";

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

// ---------------------------------------------------------------------------
// PATCH /admin/subscriptions/entitlement  -> assign a tier to a company (admin).
// Copies the tier limits onto subscription_entitlements as the effective limits;
// any per-key override supplied in the body wins over the tier value.
// ---------------------------------------------------------------------------
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

    // override wins when supplied (not undefined); else copy the tier value.
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

// ---------------------------------------------------------------------------
// GET /admin/subscriptions  -> all entitlements with the company name (admin).
// ---------------------------------------------------------------------------
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
// VENDOR SELF-SERVE (PROCURE_MONETIZATION_V2 only). Record-only, Stripe-ready.
// ---------------------------------------------------------------------------

/**
 * Resolve and authorize the acting vendor company for a self-serve action. The
 * caller must be admin or a member of companyId, and the company must be
 * vendor-kind. Returns the companyId, or null after writing the error response.
 */
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

// POST /subscriptions/subscribe { companyId, tierKey } -> set the vendor's tier.
// tierKey in { vendor_pro, verified_plus, vendor_featured }. Returns the
// effective entitlement. Record-only: no charge is taken.
router.post(
  "/subscriptions/subscribe",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) {
      return res.status(403).json({ error: "monetization not enabled" });
    }
    const b = (req.body ?? {}) as Record<string, any>;
    const tierKey = String(b.tierKey ?? "").trim();
    if (!SELF_SERVE_TIER_KEYS.has(tierKey)) {
      return res.status(400).json({
        error: "tierKey must be one of vendor_pro, verified_plus, vendor_featured",
      });
    }
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;

    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });

    const row = await assignTierToCompany(companyId, tier);
    res.json({ ok: true, entitlement: row, effective: await getEntitlement(companyId) });
  }),
);

// POST /subscriptions/cancel { companyId } -> return the vendor to vendor_free.
router.post(
  "/subscriptions/cancel",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) {
      return res.status(403).json({ error: "monetization not enabled" });
    }
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;

    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [
      VENDOR_FREE_TIER_KEY,
    ]);
    if (!tier) return res.status(404).json({ error: "vendor_free tier not found" });

    const row = await assignTierToCompany(companyId, tier);
    res.json({ ok: true, entitlement: row, effective: await getEntitlement(companyId) });
  }),
);

// ---------------------------------------------------------------------------
// PayPal checkout for access-based subscriptions. Record-only fallback when
// PayPal is not configured, so nothing breaks before keys are set. Charges the
// first period; assign the tier on a COMPLETED capture. (Recurring billing plans
// are a later step - see the apply doc.)
// ---------------------------------------------------------------------------
async function callerIsMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [userId, companyId]);
  return !!row;
}

// POST /subscriptions/checkout { companyId, tierKey, returnUrl, cancelUrl }
router.post(
  "/subscriptions/checkout",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    const tierKey = String(b.tierKey ?? "").trim();
    if (!companyId || !tierKey) return res.status(400).json({ error: "companyId and tierKey required" });
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });

    // Free tier or PayPal not configured -> record-only assignment (payment-ready).
    if (Number(tier.price_cents) <= 0 || !paypal.isConfigured()) {
      const row = await assignTierToCompany(companyId, tier);
      return res.json({
        recordOnly: true,
        entitlement: row,
        note: paypal.isConfigured() ? "free tier" : "PayPal not configured; tier assigned record-only",
      });
    }
    try {
      const order = await paypal.createOrder({
        amountCents: Number(tier.price_cents),
        description: `Divini Procure ${tier.name} (first period)`,
        referenceId: `${companyId}:${tierKey}`,
        returnUrl: String(b.returnUrl || ""),
        cancelUrl: String(b.cancelUrl || ""),
      });
      res.json({ recordOnly: false, orderId: order.orderId, approveUrl: order.approveUrl });
    } catch (e: any) {
      if (e instanceof paypal.PaypalNotConfigured) {
        const row = await assignTierToCompany(companyId, tier);
        return res.json({ recordOnly: true, entitlement: row, note: "PayPal not configured; tier assigned record-only" });
      }
      return res.status(502).json({ error: e?.message || "PayPal checkout failed" });
    }
  }),
);

// POST /subscriptions/capture { companyId, tierKey, orderId } -> capture + assign tier.
router.post(
  "/subscriptions/capture",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    const tierKey = String(b.tierKey ?? "").trim();
    const orderId = String(b.orderId ?? "").trim();
    if (!companyId || !tierKey || !orderId) {
      return res.status(400).json({ error: "companyId, tierKey and orderId required" });
    }
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    try {
      const cap = await paypal.captureOrder(orderId);
      if (!cap.ok) return res.status(402).json({ error: "payment not completed", status: cap.status });
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || "PayPal capture failed" });
    }
    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });
    const row = await assignTierToCompany(companyId, tier);
    res.json({ ok: true, entitlement: row, effective: await getEntitlement(companyId) });
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
    if (!INVESTOR_PLANS.has(plan)) return res.status(400).json({ error: "plan must be free, premium or concierge" });
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
// RECURRING BILLING (PayPal Subscriptions / auto-renewal)
// ===========================================================================

/** Ensure a single PayPal catalog product exists; cache its id in app_config. */
async function ensurePaypalProduct(): Promise<string> {
  const row = await q1<{ v: string | null }>(`select v from app_config where k = 'paypal_product_id'`);
  if (row?.v) return row.v;
  const id = await paypal.createProduct("Divini Procure Access");
  await q(
    `insert into app_config (k, v) values ('paypal_product_id', $1)
     on conflict (k) do update set v = excluded.v, updated_at = now()`,
    [id],
  );
  return id;
}

/** Downgrade a company to the free tier of its audience and clear its subscription. */
async function assignFreeTier(companyId: string): Promise<void> {
  const ent = await q1<{ audience: string | null }>(`select audience from subscription_entitlements where company_id = $1`, [companyId]);
  const audience = ent?.audience || "developer";
  const freeKey = audience === "vendor" ? "vendor_free" : "developer_free";
  const tier = await q1<Tier>(`select * from subscription_tiers where key = $1`, [freeKey]);
  if (tier) await assignTierToCompany(companyId, tier);
  await q(
    `update subscription_entitlements set paypal_subscription_id = null, subscription_status = 'cancelled', updated_at = now() where company_id = $1`,
    [companyId],
  );
}

// POST /admin/paypal/sync-plans -> create a billing plan for each paid tier (admin).
router.post(
  "/admin/paypal/sync-plans",
  requireAdmin,
  h(async (req, res) => {
    if (!paypal.isConfigured()) return res.status(400).json({ error: "PayPal not configured" });
    const productId = await ensurePaypalProduct();
    const paid = await q<Tier & { paypal_plan_id: string | null }>(
      `select * from subscription_tiers where price_cents > 0 order by price_cents asc`,
    );
    const plans: { key: string; planId: string; created: boolean }[] = [];
    for (const t of paid) {
      if (t.paypal_plan_id) { plans.push({ key: t.key, planId: t.paypal_plan_id, created: false }); continue; }
      const planId = await paypal.createMonthlyPlan({ productId, name: `Divini ${t.name}`, amountCents: Number(t.price_cents) });
      await q(`update subscription_tiers set paypal_plan_id = $2 where key = $1`, [t.key, planId]);
      plans.push({ key: t.key, planId, created: true });
    }
    res.json({ productId, plans });
  }),
);

// POST /subscriptions/checkout-recurring { companyId, tierKey, returnUrl, cancelUrl }
router.post(
  "/subscriptions/checkout-recurring",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    const tierKey = String(b.tierKey ?? "").trim();
    if (!companyId || !tierKey) return res.status(400).json({ error: "companyId and tierKey required" });
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const tier = await q1<Tier & { paypal_plan_id: string | null }>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });
    if (!tier.paypal_plan_id) {
      return res.status(400).json({ error: "No billing plan for this tier yet. Run plan sync first.", needsSync: true });
    }
    try {
      const sub = await paypal.createSubscription({
        planId: tier.paypal_plan_id,
        customId: `${companyId}:${tierKey}`,
        returnUrl: String(b.returnUrl || ""),
        cancelUrl: String(b.cancelUrl || ""),
      });
      res.json({ subscriptionId: sub.subscriptionId, approveUrl: sub.approveUrl });
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || "PayPal subscription failed" });
    }
  }),
);

// POST /subscriptions/activate { companyId, tierKey, subscriptionId } -> verify + assign.
router.post(
  "/subscriptions/activate",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    const tierKey = String(b.tierKey ?? "").trim();
    const subscriptionId = String(b.subscriptionId ?? "").trim();
    if (!companyId || !tierKey || !subscriptionId) return res.status(400).json({ error: "companyId, tierKey and subscriptionId required" });
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const sub = await paypal.getSubscription(subscriptionId).catch(() => null);
    if (!sub || !["ACTIVE", "APPROVED"].includes(sub.status)) {
      return res.status(402).json({ error: "subscription not active", status: sub?.status });
    }
    const tier = await q1<Tier>("select * from subscription_tiers where key = $1", [tierKey]);
    if (!tier) return res.status(404).json({ error: "tier not found" });
    await assignTierToCompany(companyId, tier);
    await q(
      `update subscription_entitlements set paypal_subscription_id = $2, subscription_status = 'active', updated_at = now() where company_id = $1`,
      [companyId, subscriptionId],
    );
    res.json({ ok: true, effective: await getEntitlement(companyId) });
  }),
);

// POST /subscriptions/cancel-recurring { companyId } -> cancel at PayPal + downgrade.
router.post(
  "/subscriptions/cancel-recurring",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) return res.status(403).json({ error: "monetization not enabled" });
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, any>;
    const companyId = String(b.companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await callerIsMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const ent = await q1<{ paypal_subscription_id: string | null }>(
      `select paypal_subscription_id from subscription_entitlements where company_id = $1`,
      [companyId],
    );
    if (ent?.paypal_subscription_id) {
      try { await paypal.cancelSubscription(ent.paypal_subscription_id); } catch { /* already cancelled / gone */ }
    }
    await assignFreeTier(companyId);
    res.json({ ok: true, effective: await getEntitlement(companyId) });
  }),
);

// POST /webhooks/paypal -> lifecycle events. Public but signature-verified.
router.post(
  "/webhooks/paypal",
  h(async (req, res) => {
    const event = req.body as any;
    const verified = await paypal.verifyWebhook(req.headers as Record<string, string | undefined>, event).catch(() => false);
    // Always 200 so PayPal does not hammer retries; act only on verified events.
    if (!verified) return res.status(200).json({ received: true, verified: false });
    const type = String(event?.event_type || "");
    const subId = event?.resource?.id as string | undefined;
    if (
      subId &&
      ["BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED"].includes(type)
    ) {
      const ent = await q1<{ company_id: string }>(
        `select company_id from subscription_entitlements where paypal_subscription_id = $1`,
        [subId],
      );
      if (ent?.company_id) await assignFreeTier(ent.company_id);
    }
    res.json({ received: true });
  }),
);

export default router;
