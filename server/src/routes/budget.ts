/**
 * Divini Procure - Phase 1 Project Budget + Package Allowance ledgers.
 * Self-pathed under /api (mounted with router.use(budgetRouter), no prefix).
 *
 * Fixes the Phase 0-identified dead `buildings.budget` field with a typed,
 * historically-honest revision ledger at both the project (buildings) and
 * package (allowance) levels - see db/schema-financial-ledgers.sql's header
 * for the full design rationale. A revision NEVER overwrites history: it
 * appends a new *_revisions row (immutable - RLS grants SELECT+INSERT only)
 * and only then updates the current-value column on buildings/packages. The
 * very first revision for an entity also stamps the *_original_cents column,
 * which is never touched again by any later revision.
 *
 * Authorization: developer (a member of the project's owning company) or
 * admin only, for both read and write - this is developer-internal budget
 * data, not exposed to vendors (mirrors the Phase 1 instruction's explicit
 * default: "developer internal budget unless explicitly exposed" - nothing
 * in this phase exposes it to vendors).
 *
 * Endpoints:
 *   GET  /buildings/:id/budget-revisions       -> { revisions: [...] }
 *   POST /buildings/:id/budget-revisions       -> { building, revision }
 *   GET  /packages/:id/allowance-revisions     -> { revisions: [...] }
 *   POST /packages/:id/allowance-revisions     -> { package, revision }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1, withTransaction } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { isMemberOfCompany, buildingDeveloperCompany, packageContext } from "../lib/financial-auth.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

function parseAmountCents(body: Record<string, unknown>, field = "amountCents"): number {
  const v = body[field];
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${field} required (integer cents)`), { status: 400 });
  }
  return n;
}

// ---- GET /buildings/:id/budget-revisions -------------------------------------
router.get(
  "/buildings/:id/budget-revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const devCompany = await buildingDeveloperCompany(req.params.id);
    if (!devCompany) throw new NotFoundError("project not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
      throw new ForbiddenError("not the developer of this project");
    }
    const revisions = await q<any>(
      `select * from building_budget_revisions where building_id = $1 order by revision_number desc`,
      [req.params.id],
    );
    res.json({ revisions });
  }),
);

// ---- POST /buildings/:id/budget-revisions ------------------------------------
// {amountCents, contingencyCents?, reason?} -> appends a revision and updates
// buildings.budget_current_cents (and budget_original_cents, first time only).
router.post(
  "/buildings/:id/budget-revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const devCompany = await buildingDeveloperCompany(req.params.id);
    if (!devCompany) throw new NotFoundError("project not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, devCompany))) {
      throw new ForbiddenError("not the developer of this project");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const newAmountCents = parseAmountCents(body);
    if (newAmountCents < 0) return res.status(400).json({ error: "amountCents must be nonnegative" });
    const contingencyCents =
      body.contingencyCents == null || body.contingencyCents === ""
        ? undefined
        : Math.round(Number(body.contingencyCents));
    if (contingencyCents !== undefined && !Number.isFinite(contingencyCents)) {
      return res.status(400).json({ error: "contingencyCents must be a number" });
    }
    const reason = body.reason ? String(body.reason).trim() : null;

    const result = await withTransaction(async (tx) => {
      // Lock the building row so two concurrent revisions cannot both read
      // the same "previous" state and race to assign the same revision
      // number (see Phase 1 concurrency requirement: "concurrent budget
      // revision" must not lose an update).
      const building = await tx.q1<any>(`select * from buildings where id = $1 for update`, [
        req.params.id,
      ]);
      if (!building) throw new NotFoundError("project not found");

      const maxRev = await tx.q1<{ max: number | null }>(
        `select max(revision_number) as max from building_budget_revisions where building_id = $1`,
        [req.params.id],
      );
      const revisionNumber = (maxRev?.max ?? 0) + 1;
      const isFirst = revisionNumber === 1;

      const revision = await tx.q1<any>(
        `insert into building_budget_revisions
           (building_id, revision_number, previous_amount_cents, new_amount_cents,
            contingency_cents, reason, actor_user_id, actor_email)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning *`,
        [
          req.params.id,
          revisionNumber,
          building.budget_current_cents,
          newAmountCents,
          contingencyCents ?? building.contingency_cents ?? null,
          reason,
          auth.userId ?? null,
          auth.email ?? null,
        ],
      );

      const updated = await tx.q1<any>(
        `update buildings
            set budget_current_cents = $2::bigint,
                budget_original_cents = coalesce(budget_original_cents, case when $3 then $2::bigint else null end),
                contingency_cents = coalesce($4::bigint, contingency_cents)
          where id = $1
          returning *`,
        [req.params.id, newAmountCents, isFirst, contingencyCents ?? null],
      );

      return { building: updated, revision };
    });

    res.status(201).json(result);
  }),
);

// ---- GET /packages/:id/allowance-revisions -----------------------------------
router.get(
  "/packages/:id/allowance-revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await packageContext(req.params.id);
    if (!ctx) throw new NotFoundError("package not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, ctx.developer_company_id))) {
      throw new ForbiddenError("not the developer of this package's project");
    }
    const revisions = await q<any>(
      `select * from package_allowance_revisions where package_id = $1 order by revision_number desc`,
      [req.params.id],
    );
    res.json({ revisions });
  }),
);

// ---- POST /packages/:id/allowance-revisions ----------------------------------
// {amountCents, reason?} -> appends a revision and updates
// packages.allowance_current_cents (and allowance_original_cents, first time only).
router.post(
  "/packages/:id/allowance-revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ctx = await packageContext(req.params.id);
    if (!ctx) throw new NotFoundError("package not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, ctx.developer_company_id))) {
      throw new ForbiddenError("not the developer of this package's project");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const newAmountCents = parseAmountCents(body);
    if (newAmountCents < 0) return res.status(400).json({ error: "amountCents must be nonnegative" });
    const reason = body.reason ? String(body.reason).trim() : null;

    const result = await withTransaction(async (tx) => {
      const pkg = await tx.q1<any>(`select * from packages where id = $1 for update`, [req.params.id]);
      if (!pkg) throw new NotFoundError("package not found");

      const maxRev = await tx.q1<{ max: number | null }>(
        `select max(revision_number) as max from package_allowance_revisions where package_id = $1`,
        [req.params.id],
      );
      const revisionNumber = (maxRev?.max ?? 0) + 1;
      const isFirst = revisionNumber === 1;

      const revision = await tx.q1<any>(
        `insert into package_allowance_revisions
           (package_id, revision_number, previous_amount_cents, new_amount_cents, reason, actor_user_id, actor_email)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning *`,
        [
          req.params.id,
          revisionNumber,
          pkg.allowance_current_cents,
          newAmountCents,
          reason,
          auth.userId ?? null,
          auth.email ?? null,
        ],
      );

      const updated = await tx.q1<any>(
        `update packages
            set allowance_current_cents = $2::bigint,
                allowance_original_cents = coalesce(allowance_original_cents, case when $3 then $2::bigint else null end)
          where id = $1
          returning *`,
        [req.params.id, newAmountCents, isFirst],
      );

      return { package: updated, revision };
    });

    res.status(201).json(result);
  }),
);

export default router;
