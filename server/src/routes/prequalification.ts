/**
 * Divini Procure - vendor prequalification snapshot API.
 * Self-pathed under /api. See lib/prequalification.ts for the computation.
 *
 * Authorization: the vendor itself may always read its own snapshot. When
 * buildingId is supplied, the building's owning (developer) company may
 * also read it - mirrors retainage.ts / vendor-signals.ts's "either party
 * to the relationship" pattern. Without a buildingId there is no
 * relationship to justify third-party visibility, so only the vendor
 * itself (or admin) may read a self-check snapshot.
 *
 *   GET /prequalification?vendorCompanyId=&buildingId=
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError } from "../lib/errors.js";
import { isMemberOfCompany, buildingDeveloperCompany } from "../lib/financial-auth.js";
import { computePrequalificationSnapshot } from "../lib/prequalification.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.get(
  "/prequalification",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const vendorCompanyId = req.query.vendorCompanyId ? String(req.query.vendorCompanyId) : "";
    const buildingId = req.query.buildingId ? String(req.query.buildingId) : null;
    if (!vendorCompanyId) {
      return res.status(400).json({ error: "vendorCompanyId required" });
    }

    if (!auth.isAdmin) {
      const isVendor = await isMemberOfCompany(auth.userId!, vendorCompanyId);
      let isRelatedDeveloper = false;
      if (!isVendor && buildingId) {
        const developerCompanyId = await buildingDeveloperCompany(buildingId);
        isRelatedDeveloper = await isMemberOfCompany(auth.userId!, developerCompanyId);
      }
      if (!isVendor && !isRelatedDeveloper) {
        throw new ForbiddenError("not authorized to view this vendor's prequalification status");
      }
    }

    const snapshot = await computePrequalificationSnapshot(vendorCompanyId, buildingId);
    res.json(snapshot);
  }),
);

export default router;
