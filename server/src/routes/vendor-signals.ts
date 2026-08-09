/**
 * Divini Procure - Phase 1 P1-17: vendor performance factual signals API.
 * Self-pathed under /api. See lib/vendor-signals.ts for the computation and
 * its "facts only, never a score" scope note.
 *
 * Authorization: either party to the relationship (the developer or the
 * vendor itself) may read it, OR admin - this is the same pair of
 * companies' own transaction history, not a third party's data.
 *
 *   GET /vendor-signals?vendorCompanyId=&developerCompanyId=
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError } from "../lib/errors.js";
import { isMemberOfCompany } from "../lib/financial-auth.js";
import { computeVendorRelationshipSignals } from "../lib/vendor-signals.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.get(
  "/vendor-signals",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const vendorCompanyId = req.query.vendorCompanyId ? String(req.query.vendorCompanyId) : "";
    const developerCompanyId = req.query.developerCompanyId ? String(req.query.developerCompanyId) : "";
    if (!vendorCompanyId || !developerCompanyId) {
      return res.status(400).json({ error: "vendorCompanyId and developerCompanyId required" });
    }
    if (!auth.isAdmin) {
      const isVendor = await isMemberOfCompany(auth.userId!, vendorCompanyId);
      const isDeveloper = await isMemberOfCompany(auth.userId!, developerCompanyId);
      if (!isVendor && !isDeveloper) {
        throw new ForbiddenError("not a party to this vendor/developer relationship");
      }
    }
    const signals = await computeVendorRelationshipSignals(vendorCompanyId, developerCompanyId);
    res.json(signals);
  }),
);

export default router;
