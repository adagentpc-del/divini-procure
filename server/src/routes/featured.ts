/**
 * Featured Vendor routes for Divini Procure. Mounted under /api.
 *
 * Self-serve, vendor-facing placement upsell. All behavior is gated on
 * PROCURE_MONETIZATION_V2: with the flag OFF every endpoint reports the feature
 * as unavailable and writes nothing, so the app is identical to today.
 *
 *   GET  /featured?companyId=    (vendor member) -> status + price
 *   POST /featured/buy           (vendor member) -> activate a 1 month placement
 *   POST /featured/cancel        (vendor member) -> cancel the active placement
 *
 * Record-only: nothing here charges a card or moves money (Stripe-ready). The
 * caller must be signed in and a member of the vendor-type company they act on.
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError } from "../db.js";
import { q1 } from "../pool.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import {
  featuredStatus,
  buyFeatured,
  cancelFeatured,
  VENDOR_FEATURED_PRICE_CENTS,
} from "../db/featured.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/**
 * Resolve and authorize the acting vendor company. The caller must be admin or
 * a member of companyId, and the company must be vendor-kind. Returns the
 * companyId on success; otherwise throws / writes the error response and returns
 * null so the handler can stop.
 */
async function resolveVendorCompany(
  req: Request,
  res: Response,
): Promise<string | null> {
  const auth = getAuth(req);
  const companyId = String(
    (req.body && req.body.companyId) || req.query.companyId || "",
  ).trim();
  if (!companyId) {
    res.status(400).json({ error: "companyId required" });
    return null;
  }
  if (!auth.isAdmin) {
    const ok = await q1(
      "select 1 from company_members where user_id = $1 and company_id = $2",
      [auth.userId, companyId],
    );
    if (!ok) throw new ForbiddenError("not a member of this company");
  }
  const company = await q1<{ kind: string | null }>(
    "select kind from companies where id = $1",
    [companyId],
  );
  if (!company) {
    res.status(404).json({ error: "company not found" });
    return null;
  }
  if (company.kind !== "vendor") {
    res.status(403).json({ error: "featured placement is for vendor companies" });
    return null;
  }
  return companyId;
}

// ---------------------------------------------------------------------------
// GET /featured?companyId=  -> current status + price.
// ---------------------------------------------------------------------------
router.get(
  "/featured",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) {
      return res.json({
        enabled: false,
        active: false,
        price_cents: VENDOR_FEATURED_PRICE_CENTS,
      });
    }
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;
    const status = await featuredStatus(companyId);
    res.json({ enabled: true, ...status });
  }),
);

// ---------------------------------------------------------------------------
// POST /featured/buy  -> activate / renew a one month featured placement.
// ---------------------------------------------------------------------------
router.post(
  "/featured/buy",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) {
      return res.status(403).json({ error: "monetization not enabled" });
    }
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;
    const processorRef =
      req.body && req.body.processorRef ? String(req.body.processorRef) : null;
    const row = await buyFeatured(companyId, processorRef);
    const status = await featuredStatus(companyId);
    res.json({ ok: true, featured: row, status });
  }),
);

// ---------------------------------------------------------------------------
// POST /featured/cancel  -> cancel the active placement (back to not featured).
// ---------------------------------------------------------------------------
router.post(
  "/featured/cancel",
  requireUser,
  h(async (req, res) => {
    if (!PROCURE_MONETIZATION_V2) {
      return res.status(403).json({ error: "monetization not enabled" });
    }
    const companyId = await resolveVendorCompany(req, res);
    if (!companyId) return;
    const row = await cancelFeatured(companyId);
    const status = await featuredStatus(companyId);
    res.json({ ok: true, cancelled: row, status });
  }),
);

export default router;
