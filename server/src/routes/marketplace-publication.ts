/**
 * Marketplace publication - visibility, scheduling, and urgency on top of
 * the pre-existing `packages` table (create/list/status already live in
 * server/src/routes.ts + server/src/db.ts). See
 * db/schema-marketplace-publication.sql for the full rationale: today a
 * package with status='open' is already visible to every vendor with no
 * validation gate, no scheduling, and no urgency concept. This module adds
 * all three, mounted at /api/marketplace in routes.ts.
 *
 * Publishing NEVER happens silently: POST /packages/:id/publish always runs
 * validatePackageForPublish() first and refuses with the exact blocking
 * errors if it is not ready, matching the master spec's "if validation
 * fails: do not publish, show exact errors" rule (section 24). A
 * publication_snapshot is written at the moment of publish so the listing
 * content is locked even as the working package record keeps evolving.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { validatePackageForPublish, type PublishReadinessInput } from "../lib/marketplace-validation.js";
import { checkUrgentListingLimit } from "../lib/entitlements.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const VISIBILITIES = new Set([
  "private_draft", "organization_only", "selected_team", "invite_only",
  "preferred_vendors", "qualified_vendors", "divini_verified",
  "public_marketplace", "private_group", "hidden_scheduled",
]);
const URGENCIES = new Set(["standard", "priority", "urgent", "emergency"]);

async function authorizePackageOwner(req: Request, packageId: string): Promise<{ pkg: any; companyId: string }> {
  const pkg = await q1<any>(`select * from packages where id = $1`, [packageId]);
  if (!pkg) throw new NotFoundError("package not found");
  const building = await q1<any>(`select * from buildings where id = $1`, [pkg.building_id]);
  if (!building) throw new NotFoundError("project not found");
  const auth = getAuth(req);
  if (!auth.isAdmin) {
    const member = await q1(
      `select 1 from company_members where user_id = $1 and company_id = $2`,
      [auth.userId, building.company_id],
    );
    if (!member) throw new ForbiddenError("not a member of this project's organization");
  }
  return { pkg, companyId: building.company_id };
}

async function readinessFor(pkg: any) {
  const [items, scopes, docs] = await Promise.all([
    q1<{ n: string }>(`select count(*)::int as n from package_line_items where package_id = $1`, [pkg.id]),
    q1<{ n: string }>(`select count(*)::int as n from scope_instances where package_id = $1`, [pkg.id]),
    // Documents can be attached directly (documents.package_id) or, for
    // packages created from a Divini Blueprint trade suggestion, only
    // through blueprint_document_package_links - a plain documents.package_id
    // count alone would always read 0 for those.
    q1<{ n: string }>(
      `select count(distinct id)::int as n from (
         select id from documents where package_id = $1
         union
         select document_id as id from blueprint_document_package_links where package_id = $1
       ) x`,
      [pkg.id],
    ),
  ]);
  const input: PublishReadinessInput = {
    visibility: pkg.visibility,
    bidDueDate: pkg.deadline,
    questionDeadline: pkg.question_deadline,
    termsAcknowledged: !!pkg.terms_acknowledged_at,
    hasScope: Number(items?.n ?? 0) > 0 || Number(scopes?.n ?? 0) > 0,
    hasDocuments: Number(docs?.n ?? 0) > 0,
  };
  return validatePackageForPublish(input);
}

// ---- GET /marketplace/packages/:id/readiness -------------------------------------
router.get(
  "/packages/:id/readiness",
  requireUser,
  h(async (req, res) => {
    const { pkg } = await authorizePackageOwner(req, req.params.id);
    res.json(await readinessFor(pkg));
  }),
);

// ---- PATCH /marketplace/packages/:id/publication ----------------------------------
// {visibility?, bidDueDate?, questionDeadline?, siteVisitAt?, responseRequiredBy?,
//  ndaRequired?, urgency?, urgencyReason?, publishAt?, termsAcknowledged?}
// Editable any time the package is not awarded/closed - including after it has
// gone live, since real projects change dates and scope after publication (an
// addendum, per Divini Blueprint, is the tool for telling vendors about it).
router.patch(
  "/packages/:id/publication",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { pkg } = await authorizePackageOwner(req, req.params.id);
    if (pkg.status === "awarded" || pkg.status === "closed") {
      return res.status(400).json({ error: "an awarded or closed package cannot be edited" });
    }
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (b.visibility !== undefined) {
      if (!VISIBILITIES.has(String(b.visibility))) return res.status(400).json({ error: "invalid visibility" });
      sets.push(`visibility = $${i++}`); vals.push(String(b.visibility));
    }
    if (b.bidDueDate !== undefined) { sets.push(`deadline = $${i++}`); vals.push(b.bidDueDate || null); }
    if (b.questionDeadline !== undefined) { sets.push(`question_deadline = $${i++}`); vals.push(b.questionDeadline || null); }
    if (b.siteVisitAt !== undefined) { sets.push(`site_visit_at = $${i++}`); vals.push(b.siteVisitAt || null); }
    if (b.responseRequiredBy !== undefined) { sets.push(`response_required_by = $${i++}`); vals.push(b.responseRequiredBy || null); }
    if (b.ndaRequired !== undefined) { sets.push(`nda_required = $${i++}`); vals.push(!!b.ndaRequired); }
    if (b.urgencyReason !== undefined) { sets.push(`urgency_reason = $${i++}`); vals.push(b.urgencyReason || null); }
    if (b.publishAt !== undefined) { sets.push(`publish_at = $${i++}`); vals.push(b.publishAt || null); }
    if (b.urgency !== undefined) {
      const urgency = String(b.urgency);
      if (!URGENCIES.has(urgency)) return res.status(400).json({ error: "invalid urgency" });
      sets.push(`urgency = $${i++}`); vals.push(urgency);
    }
    if (b.termsAcknowledged !== undefined) {
      if (b.termsAcknowledged) {
        sets.push(`terms_acknowledged_by = $${i++}`); vals.push(auth.userId);
        sets.push(`terms_acknowledged_at = now()`);
      } else {
        sets.push(`terms_acknowledged_by = null`, `terms_acknowledged_at = null`);
      }
    }

    if (sets.length === 0) return res.json({ package: pkg });
    vals.push(pkg.id);
    const row = await q1(`update packages set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ package: row });
  }),
);

/** Runs validation, and for a newly-urgent package also enforces the monthly limit. Returns the updated row or throws/responds with an error already sent (caller must check `handled`). */
async function attemptPublish(
  req: Request,
  res: Response,
  pkg: any,
  companyId: string,
): Promise<{ handled: boolean; row?: any }> {
  const readiness = await readinessFor(pkg);
  if (!readiness.ready) {
    res.status(400).json({ error: "package is not ready to publish", ...readiness });
    return { handled: true };
  }
  if (pkg.urgency !== "standard") {
    const limitCheck = await checkUrgentListingLimit(companyId);
    if (!limitCheck.allowed) {
      res.status(400).json({
        error: `urgent listing limit reached for this month (${limitCheck.used}/${limitCheck.limit})`,
        limitCheck,
      });
      return { handled: true };
    }
  }
  const auth = getAuth(req);
  const scheduled = pkg.publish_at && new Date(pkg.publish_at).getTime() > Date.now();
  if (scheduled) {
    // Stay in draft; server/src/index.ts's interval sweep publishes it at the
    // scheduled time. The snapshot is taken at that moment, not now, so it
    // reflects the package as it actually is when it goes live.
    const row = await q1(`select * from packages where id = $1`, [pkg.id]);
    return { handled: false, row };
  }
  const snapshot = { ...pkg, snapshot_taken_at: new Date().toISOString() };
  const row = await q1(
    `update packages set status = 'open', published_at = now(), published_by = $2, publication_snapshot = $3
     where id = $1 returning *`,
    [pkg.id, auth.userId, JSON.stringify(snapshot)],
  );
  return { handled: false, row };
}

// ---- POST /marketplace/packages/:id/publish ----------------------------------------
router.post(
  "/packages/:id/publish",
  requireUser,
  h(async (req, res) => {
    const { pkg, companyId } = await authorizePackageOwner(req, req.params.id);
    if (pkg.status === "awarded" || pkg.status === "closed") {
      return res.status(400).json({ error: "an awarded or closed package cannot be republished" });
    }
    const result = await attemptPublish(req, res, pkg, companyId);
    if (result.handled) return;
    const scheduled = pkg.publish_at && new Date(pkg.publish_at).getTime() > Date.now();
    res.json({ package: result.row, scheduled: !!scheduled });
  }),
);

// ---- POST /marketplace/packages/publish-batch {packageIds[], ...same PATCH fields} --
// Applies the shared publication settings to every listed package (owned by
// the caller), then attempts to publish each independently - one package's
// validation failure or urgent-limit rejection never blocks the others.
router.post(
  "/packages/publish-batch",
  requireUser,
  h(async (req, res) => {
    const b = req.body ?? {};
    const packageIds: string[] = Array.isArray(b.packageIds) ? b.packageIds : [];
    if (packageIds.length === 0) return res.status(400).json({ error: "packageIds required" });

    const results: { packageId: string; ok: boolean; error?: string; scheduled?: boolean }[] = [];
    for (const packageId of packageIds) {
      try {
        const { pkg, companyId } = await authorizePackageOwner(req, packageId);
        if (pkg.status === "awarded" || pkg.status === "closed") {
          results.push({ packageId, ok: false, error: "awarded or closed" });
          continue;
        }
        const sets: string[] = [];
        const vals: unknown[] = [];
        let i = 1;
        if (b.visibility !== undefined && VISIBILITIES.has(String(b.visibility))) { sets.push(`visibility = $${i++}`); vals.push(String(b.visibility)); }
        if (b.bidDueDate !== undefined) { sets.push(`deadline = $${i++}`); vals.push(b.bidDueDate || null); }
        if (b.questionDeadline !== undefined) { sets.push(`question_deadline = $${i++}`); vals.push(b.questionDeadline || null); }
        if (b.siteVisitAt !== undefined) { sets.push(`site_visit_at = $${i++}`); vals.push(b.siteVisitAt || null); }
        if (b.ndaRequired !== undefined) { sets.push(`nda_required = $${i++}`); vals.push(!!b.ndaRequired); }
        let pkgForPublish = pkg;
        if (sets.length > 0) {
          vals.push(pkg.id);
          pkgForPublish = await q1<any>(`update packages set ${sets.join(", ")} where id = $${i} returning *`, vals);
        }

        const readiness = await readinessFor(pkgForPublish);
        if (!readiness.ready) {
          results.push({ packageId, ok: false, error: readiness.errors.join("; ") });
          continue;
        }
        if (pkgForPublish.urgency !== "standard") {
          const limitCheck = await checkUrgentListingLimit(companyId);
          if (!limitCheck.allowed) {
            results.push({ packageId, ok: false, error: `urgent listing limit reached (${limitCheck.used}/${limitCheck.limit})` });
            continue;
          }
        }
        const auth = getAuth(req);
        const scheduled = pkgForPublish.publish_at && new Date(pkgForPublish.publish_at).getTime() > Date.now();
        if (!scheduled) {
          const snapshot = { ...pkgForPublish, snapshot_taken_at: new Date().toISOString() };
          await q(
            `update packages set status = 'open', published_at = now(), published_by = $2, publication_snapshot = $3 where id = $1`,
            [pkgForPublish.id, auth.userId, JSON.stringify(snapshot)],
          );
        }
        results.push({ packageId, ok: true, scheduled: !!scheduled });
      } catch (e: any) {
        results.push({ packageId, ok: false, error: e?.message ?? "could not publish" });
      }
    }
    res.json({ results });
  }),
);

// ---- GET /marketplace/urgent-limit?companyId= -----------------------------------
router.get(
  "/urgent-limit",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin) {
      const member = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [auth.userId, companyId]);
      if (!member) throw new ForbiddenError("not a member of this organization");
    }
    res.json(await checkUrgentListingLimit(companyId));
  }),
);

/**
 * Auto-publish packages whose scheduled publish_at has arrived. Called from
 * server/src/index.ts on an interval (this is a persistent Node process, not
 * serverless - the same pattern used by Divini Follow-Up Desk). Re-validates
 * each package before publishing rather than trusting the state at the time
 * it was scheduled, since visibility/dates/urgency can all change afterward
 * - a package that is no longer ready is left in draft and logged, never
 * force-published, matching this build's "never publish anything that is
 * not ready" rule.
 */
export async function publishDueScheduledPackages(): Promise<{ published: number; skipped: number }> {
  const due = await q<any>(
    `select * from packages where status = 'draft' and publish_at is not null and publish_at <= now() and published_at is null`,
  );
  let published = 0;
  let skipped = 0;
  for (const pkg of due) {
    const readiness = await readinessFor(pkg);
    if (!readiness.ready) {
      skipped++;
      // eslint-disable-next-line no-console
      console.error(`[marketplace-publication] scheduled package ${pkg.id} is no longer ready to publish: ${readiness.errors.join("; ")}`);
      continue;
    }
    if (pkg.urgency !== "standard") {
      const building = await q1<{ company_id: string }>(`select company_id from buildings where id = $1`, [pkg.building_id]);
      const limitCheck = building ? await checkUrgentListingLimit(building.company_id) : { allowed: true, used: 0, limit: null, remaining: null };
      if (!limitCheck.allowed) {
        skipped++;
        // eslint-disable-next-line no-console
        console.error(`[marketplace-publication] scheduled package ${pkg.id} skipped: urgent listing limit reached (${limitCheck.used}/${limitCheck.limit})`);
        continue;
      }
    }
    const snapshot = { ...pkg, snapshot_taken_at: new Date().toISOString() };
    await q(
      `update packages set status = 'open', published_at = now(), publication_snapshot = $2 where id = $1`,
      [pkg.id, JSON.stringify(snapshot)],
    );
    published++;
  }
  return { published, skipped };
}

export default router;
