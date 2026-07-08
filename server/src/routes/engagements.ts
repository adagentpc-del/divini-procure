/**
 * Current engagements ("what you have going on") for Divini Procure. Mounted
 * under /api in routes.ts so the paths are /api/engagements.
 *
 * Lets an existing vendor / developer / investor log and track the work they
 * already have in flight, separate from formal procurement packages/bids. Every
 * row is scoped to the signed-in user's company via company_members membership.
 * It uses Procure's own q/q1 helpers and the requireUser guard, and never leaks
 * data across companies. Table lives in db/schema-engagements.sql. Zero em
 * dashes by convention.
 *
 * Endpoints (all requireUser):
 *   POST  /engagements        { title, type?, status?, counterparty?, valueCents?, location?, notes? }
 *   GET   /engagements        -> { engagements: [...] } newest first, own company only
 *   PATCH /engagements/:id     { title?, type?, status?, counterparty?, valueCents?, location?, notes? }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** Resolve the signed-in user's primary company id (first membership). */
async function primaryCompanyId(userId: string): Promise<string | null> {
  const row = await q1<{ company_id: string }>(
    `select company_id from company_members where user_id = $1 order by created_at asc limit 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

/** Coerce a value-cents input into a bigint-safe integer or null. */
function toCents(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

// POST /engagements -> insert a new engagement for the user's company.
router.post(
  "/engagements",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await primaryCompanyId(auth.userId!);
    if (!companyId) return res.status(400).json({ error: "no company for user" });

    const { title, type, status, counterparty, valueCents, location, notes } =
      (req.body ?? {}) as Record<string, unknown>;
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }

    const row = await q1(
      `insert into current_engagements
         (company_id, created_by, title, type, status, counterparty, value_cents, location, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        companyId,
        auth.userId,
        title.trim(),
        type ? String(type) : null,
        status ? String(status) : "active",
        counterparty ? String(counterparty) : null,
        toCents(valueCents),
        location ? String(location) : null,
        notes ? String(notes) : null,
      ],
    );
    res.status(201).json({ engagement: row });
  }),
);

// GET /engagements -> list the user's company engagements, newest first.
router.get(
  "/engagements",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await primaryCompanyId(auth.userId!);
    if (!companyId) return res.json({ engagements: [] });
    const engagements = await q(
      `select * from current_engagements where company_id = $1 order by created_at desc limit 500`,
      [companyId],
    );
    res.json({ engagements });
  }),
);

// PATCH /engagements/:id -> update if owned by the user's company.
router.patch(
  "/engagements/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = await primaryCompanyId(auth.userId!);
    if (!companyId) return res.status(400).json({ error: "no company for user" });

    const { title, type, status, counterparty, valueCents, location, notes } =
      (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "title must be a non-empty string" });
      }
      add("title", title.trim());
    }
    if (type !== undefined) add("type", type === null || type === "" ? null : String(type));
    if (status !== undefined) add("status", status === null || status === "" ? "active" : String(status));
    if (counterparty !== undefined)
      add("counterparty", counterparty === null || counterparty === "" ? null : String(counterparty));
    if (valueCents !== undefined) add("value_cents", toCents(valueCents));
    if (location !== undefined) add("location", location === null || location === "" ? null : String(location));
    if (notes !== undefined) add("notes", notes === null || notes === "" ? null : String(notes));
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    add("updated_at", new Date());

    // Company scoping is enforced in the WHERE clause: the row must belong to
    // the caller's company, so cross-company updates return 404.
    params.push(req.params.id);
    params.push(companyId);
    const row = await q1(
      `update current_engagements set ${sets.join(", ")}
        where id = $${params.length - 1} and company_id = $${params.length}
        returning *`,
      params,
    );
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ engagement: row });
  }),
);

export default router;
