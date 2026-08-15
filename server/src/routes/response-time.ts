/**
 * Divini Procure - vendor invite response time API. Self-pathed under
 * /api. See lib/response-time.ts for the computation and why this is
 * deliberately public (any authenticated user, no relationship gate) and
 * aggregate-only.
 *
 *   GET /vendor-response-time/:vendorCompanyId
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireUser } from "../auth.js";
import { NotFoundError } from "../lib/errors.js";
import { q1 } from "../pool.js";
import { computeInviteResponseTime } from "../lib/response-time.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.get(
  "/vendor-response-time/:vendorCompanyId",
  requireUser,
  h(async (req, res) => {
    const vendorCompanyId = req.params.vendorCompanyId;
    const company = await q1<{ id: string }>(`select id from companies where id = $1`, [vendorCompanyId]);
    if (!company) throw new NotFoundError("company not found");

    const snapshot = await computeInviteResponseTime(vendorCompanyId);
    res.json(snapshot);
  }),
);

export default router;
