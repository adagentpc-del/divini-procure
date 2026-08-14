/**
 * Vendor performance reviews.
 *
 * Phase 0 item 19: the `reviews` table has been a real, already-wired
 * input to vendor reputation since the original schema (lib/procure-
 * moat.ts's diviniScore() gives up to 15/100 points from
 * `avg(stars) from reviews where ratee_company_id = $1`), but nothing
 * anywhere ever wrote to it - the entire signal has been permanently
 * zero. This is the smallest real write path: a developer rates the
 * vendor on a package, but only after a genuine completed relationship
 * (see assertCanReview below), one review per (rater, vendor, package),
 * editable by the same rater. Not a predictive system, not a public
 * review-response feature, not vendor-rates-developer - exactly what the
 * existing scoring code already assumes.
 *
 * M-01 gap #12: reviews also carry three optional structured yes/no facts
 * (would_rehire, on_time, on_budget) and a guided lessons_learned field,
 * plus the originating package's trade category via a join - a lessons-
 * learned knowledge base a developer can actually use when sourcing a
 * similar-trade project, not another opaque score.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function getCompanyId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await q1<{ company_id: string }>(
    `select company_id from company_members where user_id = $1 order by created_at asc limit 1`,
    [userId],
  );
  return row?.company_id ?? null;
}

/**
 * Verify the caller may leave a review for vendorCompanyId on packageId, as
 * raterCompanyId (the caller's own company, never client-trusted beyond
 * this check): raterCompanyId must be a company the caller belongs to, AND
 * there must be a purchase order for exactly this (package, vendor,
 * developer) triple that has actually reached 'fulfilled' - the real
 * completed-relationship signal, not merely "awarded" (still in progress)
 * or "cancelled". Admins bypass the membership check but the fulfilled-PO
 * requirement still applies - even an admin cannot fabricate a review for
 * a relationship that never completed.
 */
async function assertCanReview(
  req: Request,
  packageId: string,
  vendorCompanyId: string,
  raterCompanyId: string,
): Promise<void> {
  const { userId, isAdmin } = getAuth(req);
  if (!isAdmin) {
    const isMember = await q1(
      `select 1 from company_members where user_id = $1 and company_id = $2`,
      [userId, raterCompanyId],
    );
    if (!isMember) throw new ForbiddenError("not a member of the rating company");
  }

  const fulfilled = await q1(
    `select 1 from purchase_orders
      where package_id = $1 and vendor_company_id = $2 and developer_company_id = $3
        and status = 'fulfilled'`,
    [packageId, vendorCompanyId, raterCompanyId],
  );
  if (!fulfilled) {
    throw new ForbiddenError(
      "a review requires a purchase order for this package and vendor that has reached status 'fulfilled'",
    );
  }
}

// GET /reviews?vendorCompanyId=&packageId= - public (marketplace transparency,
// matches vendor_profiles/companies/packages already being public-read).
// Each row includes the originating package's trade category (joined, never
// duplicated onto reviews) so a developer sourcing a similar-trade project
// can see which of a vendor's past reviews are actually relevant - the
// "lessons-learned knowledge base" gap (M-01 #12), not just a star average.
router.get(
  "/reviews",
  h(async (req, res) => {
    const vendorCompanyId = (req.query.vendorCompanyId as string) || "";
    const packageId = (req.query.packageId as string) || "";
    if (!vendorCompanyId && !packageId) {
      return res.status(400).json({ error: "vendorCompanyId or packageId required" });
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (vendorCompanyId) {
      params.push(vendorCompanyId);
      conditions.push(`r.ratee_company_id = $${params.length}`);
    }
    if (packageId) {
      params.push(packageId);
      conditions.push(`r.package_id = $${params.length}`);
    }
    const rows = await q<any>(
      `select r.*, rc.name as rater_name, p.category as package_category
         from reviews r
         left join companies rc on rc.id = r.rater_company_id
         left join packages p on p.id = r.package_id
        where ${conditions.join(" and ")}
        order by r.created_at desc
        limit 200`,
      params,
    );
    const stats = await q1<{
      avg: number | null; cnt: string;
      rehire_yes: string; rehire_no: string;
      on_time_yes: string; on_time_no: string;
      on_budget_yes: string; on_budget_no: string;
    }>(
      `select avg(stars) as avg, count(*) as cnt,
              count(*) filter (where would_rehire = true) as rehire_yes,
              count(*) filter (where would_rehire = false) as rehire_no,
              count(*) filter (where on_time = true) as on_time_yes,
              count(*) filter (where on_time = false) as on_time_no,
              count(*) filter (where on_budget = true) as on_budget_yes,
              count(*) filter (where on_budget = false) as on_budget_no
         from reviews r where ${conditions.join(" and ")}`,
      params,
    );
    res.json({
      reviews: rows,
      averageStars: stats?.avg == null ? null : Number(stats.avg),
      count: Number(stats?.cnt ?? 0),
      wouldRehireYes: Number(stats?.rehire_yes ?? 0),
      wouldRehireNo: Number(stats?.rehire_no ?? 0),
      onTimeYes: Number(stats?.on_time_yes ?? 0),
      onTimeNo: Number(stats?.on_time_no ?? 0),
      onBudgetYes: Number(stats?.on_budget_yes ?? 0),
      onBudgetNo: Number(stats?.on_budget_no ?? 0),
    });
  }),
);

// POST /reviews - create (one per rater/vendor/package - anti-duplicate via
// the DB unique index; a repeat attempt is a 409, not a silent overwrite).
router.post(
  "/reviews",
  requireUser,
  h(async (req, res) => {
    const { userId } = getAuth(req);
    const { packageId, vendorCompanyId, stars, body, wouldRehire, onTime, onBudget, lessonsLearned } =
      (req.body ?? {}) as Record<string, unknown>;

    if (!packageId || typeof packageId !== "string") return res.status(400).json({ error: "packageId required" });
    if (!vendorCompanyId || typeof vendorCompanyId !== "string")
      return res.status(400).json({ error: "vendorCompanyId required" });
    const starsNum = Number(stars);
    if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ error: "stars must be an integer 1 to 5" });
    }
    const asBoolOrNull = (v: unknown): boolean | null => (v === true || v === false ? v : null);

    const raterCompanyId = await getCompanyId(userId);
    if (!raterCompanyId) return res.status(400).json({ error: "no company for this account" });

    await assertCanReview(req, packageId, vendorCompanyId, raterCompanyId);

    const vendor = await q1<{ id: string }>(`select id from companies where id = $1`, [vendorCompanyId]);
    if (!vendor) throw new NotFoundError("vendor company not found");

    const existing = await q1<{ id: string }>(
      `select id from reviews where rater_company_id = $1 and ratee_company_id = $2 and package_id = $3`,
      [raterCompanyId, vendorCompanyId, packageId],
    );
    if (existing) {
      return res.status(409).json({
        error: "a review for this vendor on this package already exists - use PATCH to edit it",
        reviewId: existing.id,
      });
    }

    const row = await q1<any>(
      `insert into reviews (rater_company_id, ratee_company_id, package_id, stars, body, would_rehire, on_time, on_budget, lessons_learned)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        raterCompanyId,
        vendorCompanyId,
        packageId,
        starsNum,
        typeof body === "string" ? body.slice(0, 4000) : null,
        asBoolOrNull(wouldRehire),
        asBoolOrNull(onTime),
        asBoolOrNull(onBudget),
        typeof lessonsLearned === "string" ? lessonsLearned.slice(0, 4000) : null,
      ],
    );
    res.status(201).json({ review: row });
  }),
);

// PATCH /reviews/:id - the original rater's own company (or admin) may edit
// stars/body. Anti-duplicate is inherent: this is the ONLY way to change an
// existing review, never a second POST.
router.patch(
  "/reviews/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, isAdmin } = getAuth(req);
    const existing = await q1<any>(`select * from reviews where id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: "review not found" });

    if (!isAdmin) {
      const isMember = await q1(
        `select 1 from company_members where user_id = $1 and company_id = $2`,
        [userId, existing.rater_company_id],
      );
      if (!isMember) return res.status(403).json({ error: "only the company that left this review may edit it" });
    }

    const { stars, body, wouldRehire, onTime, onBudget, lessonsLearned } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    const asBoolOrNull = (v: unknown): boolean | null => (v === true || v === false ? v : null);

    if (stars !== undefined) {
      const starsNum = Number(stars);
      if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
        return res.status(400).json({ error: "stars must be an integer 1 to 5" });
      }
      add("stars", starsNum);
    }
    if (body !== undefined) add("body", typeof body === "string" ? body.slice(0, 4000) : null);
    if (wouldRehire !== undefined) add("would_rehire", asBoolOrNull(wouldRehire));
    if (onTime !== undefined) add("on_time", asBoolOrNull(onTime));
    if (onBudget !== undefined) add("on_budget", asBoolOrNull(onBudget));
    if (lessonsLearned !== undefined) add("lessons_learned", typeof lessonsLearned === "string" ? lessonsLearned.slice(0, 4000) : null);
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    const row = await q1<any>(`update reviews set ${sets.join(", ")} where id = $${params.length} returning *`, params);
    res.json({ review: row });
  }),
);

export default router;
