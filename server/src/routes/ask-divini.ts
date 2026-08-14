/**
 * Ask Divini routes - narrow first slice (docs/ai-layer-design.md section 7).
 * Mounted under /api. Single-project, financial-questions-only.
 *
 * Authorization: developer (member of the project's owning company) or
 * admin only - identical restriction to financial-summary.ts, since the
 * payload this answers from is the same developer-internal budget data.
 *
 *   POST /ask-divini/project/:buildingId  { question: string }
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";
import { buildingDeveloperCompany, isMemberOfCompany } from "../lib/financial-auth.js";
import { askAboutProject } from "../lib/ask-divini.js";
import { llmRateLimit } from "../lib/rateLimit.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// 20 questions per user per hour - same "expensive per-call LLM completion"
// posture as intel.ts's quote-analysis limiter.
const askDiviniLimit = llmRateLimit({ max: 20, windowMs: 60 * 60_000 });

router.post(
  "/ask-divini/project/:buildingId",
  requireUser,
  askDiviniLimit,
  h(async (req, res) => {
    const auth = getAuth(req);
    const devCompany = await buildingDeveloperCompany(req.params.buildingId);
    if (!devCompany) throw new NotFoundError("project not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
      throw new ForbiddenError("not the developer of this project");
    }

    const question = typeof req.body?.question === "string" ? req.body.question : "";
    if (!question.trim()) {
      return res.status(400).json({ error: "question required" });
    }

    const result = await askAboutProject(req.params.buildingId, question);
    res.json(result);
  }),
);

export default router;
