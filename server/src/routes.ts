/**
 * API routes - one endpoint for EVERY operation that the SPA's old
 * src/lib/db.ts + supabase.auth/storage calls performed. Mounted under /api.
 *
 * Authorization is enforced in src/db.ts (the RLS reimplementation). These
 * handlers just wire HTTP -> db functions, pull the verified user from
 * getAuth(req), and map ForbiddenError/NotFoundError to 403/404.
 *
 * Endpoint -> old db.ts/supabase call map (see CHANGES.md for the full table):
 *   GET  /api/me                         -> AuthProvider loadCompany + features isAdmin
 *   POST /api/companies                  -> createCompanyForUser (Onboarding)
 *   PATCH /api/companies/:id             -> supabase.from('companies').update (Profile)
 *   POST /api/account/delete             -> supabase.rpc('delete_my_account')
 *   GET  /api/buildings?companyId=       -> getBuildings
 *   GET  /api/buildings/:id              -> getBuilding
 *   POST /api/buildings                  -> supabase.from('buildings').insert (Projects)
 *   GET  /api/packages?buildingId=       -> getPackages
 *   GET  /api/packages/open?categories=  -> getOpenPackages
 *   GET  /api/packages/:id               -> getPackage
 *   POST /api/buildings/:id/packages     -> createPackage
 *   POST /api/packages/:id/status        -> setPackageStatus
 *   GET  /api/packages/:id/line-items    -> getLineItems
 *   POST /api/packages/:id/line-items    -> addLineItem
 *   DELETE /api/line-items/:id           -> deleteLineItem
 *   GET  /api/bids/mine?companyId=       -> getMyBids
 *   GET  /api/packages/:id/bids          -> getBidsForPackage
 *   POST /api/packages/:id/bids          -> submitPricedBid
 *   GET  /api/vendor-profiles/:companyId -> getVendorProfile
 *   GET  /api/packages/:id/questions     -> getQuestions
 *   POST /api/packages/:id/questions     -> askQuestion
 *   POST /api/questions/:id/answer       -> answerQuestion
 *   GET  /api/feature-flags              -> getFeatureFlags (features reload)
 *   PATCH /api/feature-flags/:key        -> setFeatureFlag{Enabled,Audience} (admin)
 *   GET  /api/documents?packageId|buildingId -> getDocuments
 *   POST /api/documents                  -> uploadDocument (multipart)
 *   GET  /api/documents/download         -> signedUrl target (streams file)
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "node:fs";
import { getAuth, requireUser, requireAdmin } from "./auth.js";
import * as db from "./db.js";
import { ForbiddenError, NotFoundError } from "./db.js";
import { q, q1, pool } from "./pool.js";
import {
  buildStorageKey,
  writeFile,
  signDownloadUrl,
  verifyDownloadUrl,
  readPath,
  fileExists,
} from "./storage.js";
import adminExtraRouter from "./routes/admin-extra.js";
import publicCaptureRouter from "./routes/public-capture.js";
import quoteComparisonRouter from "./routes/quote-comparison.js";
import intelRouter from "./routes/intel.js";
import rfqAssistRouter from "./routes/rfq-assist.js";
import onboardingRouter from "./routes/onboarding.js";
import engagementsRouter from "./routes/engagements.js";
import submittalsRouter from "./routes/submittals.js";
import deliveryRouter from "./routes/delivery.js";
import partnerRevRouter from "./routes/partner-rev.js";
import revenueRouter from "./routes/revenue.js";
import payoutsRouter from "./routes/payouts.js";
import grandfatheredFeesRouter from "./routes/grandfathered-fees.js";
import agreementsRouter from "./routes/agreements.js";
import campaignsRouter from "./routes/campaigns.js";
import procureCooRouter from "./routes/procure-coo.js";
import moatRouter from "./routes/moat.js";
import investmentRouter from "./routes/investment.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import feeMatrixRouter from "./routes/fee-matrix.js";
import vendorPricingRouter from "./routes/vendor-pricing.js";
import featuredRouter from "./routes/featured.js";
import awardWorkflowRouter from "./routes/award-workflow.js";
import changeOrdersRouter from "./routes/change-orders.js";
import productsRouter from "./routes/products.js";
import vendorImportRouter from "./routes/vendor-import.js";
import projectRolesRouter from "./routes/project-roles.js";
import projectTemplatesRouter from "./routes/project-templates.js";
import onboardingSamplesRouter from "./routes/onboarding-samples.js";
import investmentGovernanceRouter from "./routes/investment-governance.js";
import teasersProfilesRouter from "./routes/teasers-profiles.js";
import incentivesRouter from "./routes/incentives.js";
import profileCollateralRouter from "./routes/profile-collateral.js";
import crmRouter from "./routes/crm.js";
import adminTasksRouter from "./routes/admin-tasks.js";
import reportsRouter from "./routes/reports.js";
import analyticsRouter from "./routes/analytics.js";
import csvImportRouter from "./routes/csv-import.js";
import authNativeRouter from "./routes/auth-native.js";
// ---- Gap-closure Wave 1: verification, score recompute, agreement splits -----
import verificationRouter from "./routes/verification.js";
import scoreRefreshRouter from "./routes/score-refresh.js";
import splitTermsRouter from "./routes/split-terms.js";
// ---- Gap-closure Wave 2: COI, retainage, lender portal, disputes, quick-hits --
import coiRouter from "./routes/coi.js";
import retainageRouter from "./routes/retainage.js";
import lenderPortalRouter from "./routes/lender-portal.js";
import disputesRouter from "./routes/disputes.js";
import watchlistRouter from "./routes/watchlist.js";
import projectHealthRouter from "./routes/project-health.js";
import progressPhotosRouter from "./routes/progress-photos.js";
import paymentEtaRouter from "./routes/payment-eta.js";
// ---- Monetization V2 (flag-gated): bid credits + verification gate -----------
import { PROCURE_MONETIZATION_V2 } from "./config.js";
import { getBidCredits, consumeBidCredit } from "./lib/bidCredits.js";
import { assertVendorVerified, getVerificationDetail } from "./lib/verificationGate.js";
import { isVendorPro } from "./lib/entitlements.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** True when the user is a member of the given company. */
async function isCompanyMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

// ---- NATIVE auth (email/password + verification + reset + owner transfer).
//      Mounted first; its endpoints carry their own guards. /api/auth/*.
router.use(authNativeRouter);

// ---- super-admin essentials (invites, discount codes, referral partners,
//      per-user referrals/credits). Each endpoint carries its own guard. ------
router.use(adminExtraRouter);

// ---- public invite/referral capture + signup attribution. Public lookups
//      carry no guard; the accept/attribute endpoints require a signed-in user.
router.use(publicCaptureRouter);

// ---- procurement OS: quote comparison, intelligence, RFQ assist (CAD/auto-lines)
router.use(onboardingRouter);
router.use(engagementsRouter);
router.use("/quotes", quoteComparisonRouter);
router.use(intelRouter);
router.use(rfqAssistRouter);
router.use(submittalsRouter);
router.use("/deliveries", deliveryRouter);
router.use(partnerRevRouter);
// ---- platform revenue ledger (accrual; admin marks collected, never charges) -
router.use(revenueRouter);
// ---- Stripe Connect payout rail (connect bank, queue splits, 1-click release) -
router.use(payoutsRouter);
// ---- grandfathered existing-relationship 2% fee (developer/vendor pair) -----
router.use(grandfatheredFeesRouter);
// ---- agreements + e-sign, campaigns, AI COO, intelligence moat, investment --
router.use(agreementsRouter);
router.use(campaignsRouter);
router.use(procureCooRouter);
router.use(moatRouter);
router.use(investmentRouter);
// ---- Wave A: subscriptions/entitlements, fee matrix, vendor pricing ---------
router.use(subscriptionsRouter);
router.use(feeMatrixRouter);
router.use(vendorPricingRouter);
router.use(featuredRouter);
// ---- Wave B: award->PO->payment-auth, change orders, products, vendor import
router.use(awardWorkflowRouter);
router.use(changeOrdersRouter);
router.use(productsRouter);
router.use(vendorImportRouter);
// ---- Wave C: project roles/dashboards, templates, onboarding+samples, gov, teasers
router.use(projectRolesRouter);
router.use(projectTemplatesRouter);
router.use(onboardingSamplesRouter);
router.use(investmentGovernanceRouter);
router.use(teasersProfilesRouter);
router.use("/incentives", incentivesRouter);
router.use(profileCollateralRouter);
// ---- Wave D: CRM, admin tasks+audit, reports, analytics+messaging, csv import
router.use(crmRouter);
router.use(adminTasksRouter);
router.use(reportsRouter);
router.use(analyticsRouter);
router.use(csvImportRouter);
// ---- Gap-closure Wave 1: verification queue, score recompute, split terms ----
router.use(verificationRouter);
router.use(scoreRefreshRouter);
router.use(splitTermsRouter);
// ---- Gap-closure Wave 2 routers -----------------------------------------------
router.use(coiRouter);
router.use(retainageRouter);
router.use(lenderPortalRouter);
router.use(disputesRouter);
router.use(watchlistRouter);
router.use(projectHealthRouter);
router.use(progressPhotosRouter);
router.use(paymentEtaRouter);

// ---- health ----------------------------------------------------------------
router.get("/healthz", async (_req, res) => {
  // DB liveness: a cheap query that returns quickly even under load.
  try {
    await pool.query("select 1");
    res.json({ ok: true, service: "divini-procure", ts: Date.now(), db: "ok" });
  } catch (e: any) {
    res.status(503).json({ ok: false, service: "divini-procure", ts: Date.now(), db: "error", error: e?.message });
  }
});

// ---- identity / company ----------------------------------------------------
// Returns the verified user + their company (replaces AuthProvider.loadCompany
// and FeaturesProvider.isAdmin). Upserts the user row on the way.
router.get(
  "/me",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.ensureUser(auth.userId!, auth.email);
    const company = await db.getMyCompany(auth.userId!);
    res.json({
      user: { id: auth.userId, email: auth.email },
      isAdmin: auth.isAdmin,
      company: company ?? null,
    });
  }),
);

router.post(
  "/companies",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.ensureUser(auth.userId!, auth.email);
    const company = await db.createCompanyForUser(auth.userId!, req.body);
    res.status(201).json(company);
  }),
);

router.patch(
  "/companies/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const company = await db.updateCompany(auth.userId!, req.params.id, req.body);
    res.json(company);
  }),
);

router.post(
  "/account/delete",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    // CCPA / GDPR right-to-erasure (#13): delete any CRM records whose email
    // matches the user's email before the user row is removed. crm_records are
    // admin-owned records about a contact and are not cascade-deleted by the
    // users table, so we delete them here explicitly.
    if (auth.email) {
      await q(
        `delete from crm_records where lower(coalesce(email,'')) = lower($1)`,
        [auth.email],
      );
    }
    await db.deleteMyAccount(auth.userId!);
    res.json({ ok: true });
  }),
);

// GDPR/CPRA data portability: download everything tied to this account.
router.get(
  "/account/export",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const data = await db.exportMyData(auth.userId!);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="divini-procure-data-${date}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(data, null, 2));
  }),
);

// ---- buildings -------------------------------------------------------------
router.get(
  "/buildings",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    res.json(await db.getBuildings(auth.userId!, companyId));
  }),
);

router.get(
  "/buildings/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = await db.getBuilding(auth.userId!, req.params.id);
    res.json(b ?? null);
  }),
);

router.post(
  "/buildings",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = await db.createBuilding(auth.userId!, req.body);
    res.status(201).json(b);
  }),
);

router.get(
  "/buildings/:id/packages",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json(await db.getPackages(auth.userId!, req.params.id));
  }),
);

router.post(
  "/buildings/:id/packages",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const p = await db.createPackage(auth.userId!, req.params.id, req.body);
    res.status(201).json(p);
  }),
);

// ---- packages --------------------------------------------------------------
router.get(
  "/packages/open",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const cats = req.query.categories
      ? String(req.query.categories).split(",").filter(Boolean)
      : undefined;
    res.json(await db.getOpenPackages(auth.userId!, cats));
  }),
);

router.get(
  "/packages/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json((await db.getPackage(auth.userId!, req.params.id)) ?? null);
  }),
);

router.post(
  "/packages/:id/status",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.setPackageStatus(auth.userId!, req.params.id, String(req.body.status));
    res.json({ ok: true });
  }),
);

router.get(
  "/packages/:id/line-items",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json(await db.getLineItems(auth.userId!, req.params.id));
  }),
);

router.post(
  "/packages/:id/line-items",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.addLineItem(auth.userId!, req.params.id, req.body);
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  "/line-items/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.deleteLineItem(auth.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

// ---- bids ------------------------------------------------------------------
router.get(
  "/bids/mine",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    res.json(await db.getMyBids(auth.userId!, companyId));
  }),
);

router.get(
  "/packages/:id/bids",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json(await db.getBidsForPackage(auth.userId!, req.params.id));
  }),
);

router.post(
  "/packages/:id/bids",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { vendorCompanyId, ...payload } = req.body;

    // Monetization V2 (flag-gated). When off, behavior is identical to today.
    if (PROCURE_MONETIZATION_V2 && vendorCompanyId) {
      // (a) Verification gate: a vendor must be verified before it can bid.
      //     Throws ForbiddenError (403) when unverified.
      await assertVendorVerified(String(vendorCompanyId));

      // (b) Free-tier bid credits: non-Pro vendors consume a quarterly credit on
      //     a NEW bid submission. Pro vendors are unlimited (consume is a no-op
      //     that returns ok). A win never reaches here, so wins never count.
      const credit = await consumeBidCredit(String(vendorCompanyId));
      if (!credit.ok) {
        return res.status(402).json({
          error:
            "You have used all free bids for this quarter. Upgrade to Vendor Pro " +
            "for unlimited bidding.",
          code: "bid_limit_reached",
          upgrade: { plan: "vendor_pro", reason: "unlimited_bids" },
          bidCredits: {
            periodKey: credit.periodKey,
            used: credit.used,
            limit: credit.limit,
            remaining: credit.remaining,
            unlimited: credit.unlimited,
          },
        });
      }
    }

    const bid = await db.submitPricedBid(auth.userId!, req.params.id, vendorCompanyId, payload);
    res.status(201).json(bid);
  }),
);

// ---- Monetization V2 read surfaces (flag-gated values; safe when off) -------
// GET /api/me/bid-credits?companyId= -- current quarter credits/limit/remaining
router.get(
  "/me/bid-credits",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    // Must be a member of the company (or admin) to read its credit state.
    if (!auth.isAdmin && !(await isCompanyMember(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const credits = await getBidCredits(companyId);
    const pro = await isVendorPro(companyId);
    res.json({ ...credits, vendorPro: pro, monetizationV2: PROCURE_MONETIZATION_V2 });
  }),
);

// GET /api/me/verification?companyId= -- verify status + missing/expiring creds
router.get(
  "/me/verification",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isCompanyMember(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const detail = await getVerificationDetail(companyId);
    res.json({ ...detail, monetizationV2: PROCURE_MONETIZATION_V2 });
  }),
);

// ---- vendor profile --------------------------------------------------------
router.get(
  "/vendor-profiles/:companyId",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json((await db.getVendorProfile(auth.userId!, req.params.companyId)) ?? null);
  }),
);

// ---- rfq Q&A ---------------------------------------------------------------
router.get(
  "/packages/:id/questions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    res.json(await db.getQuestions(auth.userId!, req.params.id));
  }),
);

router.post(
  "/packages/:id/questions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { vendorCompanyId, question } = req.body;
    await db.askQuestion(auth.userId!, req.params.id, vendorCompanyId, question);
    res.status(201).json({ ok: true });
  }),
);

router.post(
  "/questions/:id/answer",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.answerQuestion(auth.userId!, req.params.id, String(req.body.answer));
    res.json({ ok: true });
  }),
);

// ---- feature flags ---------------------------------------------------------
router.get(
  "/feature-flags",
  requireUser,
  h(async (_req, res) => {
    res.json(await db.getFeatureFlags());
  }),
);

router.patch(
  "/feature-flags/:key",
  requireAdmin,
  h(async (req, res) => {
    if (typeof req.body.enabled === "boolean") {
      await db.setFeatureFlagEnabled(req.params.key, req.body.enabled);
    }
    if (typeof req.body.audience === "string") {
      await db.setFeatureFlagAudience(req.params.key, req.body.audience);
    }
    res.json({ ok: true });
  }),
);

// ---- admin console ---------------------------------------------------------
router.get(
  "/admin/overview",
  requireAdmin,
  h(async (_req, res) => {
    res.json(await db.adminOverview());
  }),
);

// ---- documents / files -----------------------------------------------------
router.get(
  "/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.query.packageId ? String(req.query.packageId) : undefined;
    const buildingId = req.query.buildingId ? String(req.query.buildingId) : undefined;
    res.json(await db.getDocuments(auth.userId!, { packageId, buildingId }));
  }),
);

// Upload: multipart/form-data with `file` + companyId/buildingId/packageId.
// Returns the created document row. (Replaces supabase.storage.upload + insert.)
router.post(
  "/documents",
  requireUser,
  upload.single("file"),
  h(async (req, res) => {
    const auth = getAuth(req);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file required" });
    const companyId = String(req.body.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const buildingId = req.body.buildingId ? String(req.body.buildingId) : null;
    const packageId = req.body.packageId ? String(req.body.packageId) : null;

    const storageKey = buildStorageKey({
      companyId,
      buildingId,
      packageId,
      fileName: file.originalname,
    });
    // Write only after authz passes (insertDocument checks membership). Build
    // the row first so a forbidden upload never touches disk.
    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    const doc = await db.insertDocument(auth.userId!, {
      company_id: companyId,
      building_id: buildingId,
      package_id: packageId,
      name: file.originalname,
      kind: ext,
      storage_path: storageKey,
      size: file.size,
    });
    writeFile(storageKey, file.buffer);
    res.status(201).json(doc);
  }),
);

// Issue a short-lived signed download URL for a storage_path (replaces
// supabase.storage.createSignedUrl). Caller must be authenticated.
router.get(
  "/documents/signed-url",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const path = String(req.query.path || "");
    if (!path) return res.status(400).json({ error: "path required" });
    const doc = await db.getDocumentByPath(path);
    if (!doc) throw new NotFoundError("document not found");
    // Verify the requesting user is a member of the document's company.
    // Without this check any authenticated user could obtain a signed URL for
    // any document by knowing (or guessing) its storage path (IDOR).
    if (doc.company_id && auth.userId) {
      const ids = await db.userCompanyIds(auth.userId);
      if (!ids.includes(doc.company_id) && !auth.isAdmin) {
        return res.status(403).json({ error: "access denied" });
      }
    }
    res.json({ signedUrl: signDownloadUrl(path) });
  }),
);

// Stream the file for a valid signed URL. No bearer needed (the signature IS
// the capability) - mirrors how a Supabase signed URL works.
router.get(
  "/documents/download",
  h(async (req, res) => {
    const rel = verifyDownloadUrl(
      String(req.query.path || ""),
      String(req.query.exp || ""),
      String(req.query.sig || ""),
    );
    if (!rel) return res.status(403).json({ error: "invalid or expired link" });
    if (!fileExists(rel)) return res.status(404).json({ error: "file missing" });
    const doc = await db.getDocumentByPath(rel);
    const filename = doc?.name || rel.split("/").pop() || "download";
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    fs.createReadStream(readPath(rel)).pipe(res);
  }),
);

// ---- error handler (must be after routes) ----------------------------------
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
  // Log the full stack trace (never returned to the client) for debugging.
  // eslint-disable-next-line no-console
  console.error(
    "[api error]",
    JSON.stringify({
      correlationId: (req as any).correlationId,
      method: req.method,
      path: req.path,
      message: err?.message || String(err),
      stack: err?.stack,
    }),
  );
  res.status(500).json({ error: "internal error" });
}

export default router;
