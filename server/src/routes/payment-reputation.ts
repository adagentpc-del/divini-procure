/**
 * Divini Procure - bidirectional payment-behavior reputation API.
 * Self-pathed under /api. See lib/payment-reputation.ts for the
 * computation and why this is deliberately public (any authenticated
 * user, no relationship gate) and aggregate-only.
 *
 *   GET /payment-reputation/:developerCompanyId
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireUser } from "../auth.js";
import { NotFoundError } from "../lib/errors.js";
import { q1 } from "../pool.js";
import { computePaymentReputation } from "../lib/payment-reputation.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

router.get(
  "/payment-reputation/:developerCompanyId",
  requireUser,
  h(async (req, res) => {
    const developerCompanyId = req.params.developerCompanyId;
    // companies has permissive read RLS (any authenticated user, matching
    // marketplace-browse semantics - see packages/buildings precedent in
    // moat.ts's related-packages route), so this existence check needs no
    // special escalation.
    const company = await q1<{ id: string }>(`select id from companies where id = $1`, [developerCompanyId]);
    if (!company) throw new NotFoundError("company not found");

    const snapshot = await computePaymentReputation(developerCompanyId);
    res.json(snapshot);
  }),
);

export default router;
