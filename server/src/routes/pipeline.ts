/**
 * Divini Pipeline - the user-facing sales/procurement CRM for Divini Procure.
 * Mounted under /api/pipeline in routes.ts.
 *
 * NOT to be confused with crm_records (db/schema-crm.sql), which is Divini's
 * own INTERNAL sales pipeline for signing up developers/vendors/investors as
 * customers. This is the opposite: a tool END USERS use to run their OWN
 * sales/procurement funnel - a vendor tracking bid opportunities, or a
 * developer tracking their vendor-sourcing funnel for a package.
 *
 * An opportunity belongs to exactly one organization_id (the company running
 * ITS OWN funnel). Authorization: member of organization_id, or admin.
 *
 * The "readiness score" is fully deterministic (server/src/lib/pipeline-score.ts):
 * it never predicts an outcome, it only checks whether specific stored fields
 * are present. Tables live in db/schema-pipeline.sql. Integer cents. Zero em
 * dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { scoreOpportunityReadiness } from "../lib/pipeline-score.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const PROFILE_TYPES = new Set(["vendor", "developer"]);
const ACTIVITY_TYPES = new Set(["note", "call", "email", "meeting", "site_visit", "system"]);
const TASK_STATUSES = new Set(["open", "completed", "cancelled"]);

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Load an opportunity and authorize the caller (member of its org, or admin). */
async function authorizeOpportunity(req: Request, id: string): Promise<any> {
  const auth = getAuth(req);
  const opp = await q1<any>(`select * from pipeline_opportunities where id = $1`, [id]);
  if (!opp) throw new NotFoundError("opportunity not found");
  if (auth.isAdmin) return opp;
  if (await isMemberOfCompany(auth.userId!, opp.organization_id)) return opp;
  throw new ForbiddenError("not a member of this opportunity's organization");
}

function taskDueClause(alias: string): string {
  return `exists (select 1 from pipeline_tasks t where t.opportunity_id = ${alias}.id and t.status = 'open')`;
}
function taskOverdueClause(alias: string): string {
  return `exists (select 1 from pipeline_tasks t where t.opportunity_id = ${alias}.id and t.status = 'open' and t.due_at < now())`;
}

function withReadiness(row: any) {
  const readiness = scoreOpportunityReadiness({
    estimatedValueCents: row.estimated_value_cents,
    nextAction: row.next_action,
    nextActionDate: row.next_action_date,
    expectedCloseDate: row.expected_close_date,
    category: row.category,
    packageId: row.package_id,
    bidId: row.bid_id,
    clientCompanyId: row.client_company_id,
    clientEmail: row.client_email,
    lastActivityAt: row.last_activity_at,
    hasOpenTask: !!row.has_open_task,
    hasOverdueTask: !!row.has_overdue_task,
  });
  return { ...row, readiness };
}

// ---- GET /pipeline/stages?companyId=&profileType= --------------------------
// Org-specific stages if the org has defined any, else the global default set.
router.get(
  "/stages",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const rawCompanyId = req.query.companyId ? String(req.query.companyId) : null;
    // IDOR fix: only include this company's own custom stage definitions if
    // the caller is actually a member (or admin) - otherwise silently fall
    // back to the global default set below, same as if no companyId were
    // supplied, rather than leaking another company's custom labels.
    const companyId =
      rawCompanyId && (auth.isAdmin || (await isMemberOfCompany(auth.userId!, rawCompanyId)))
        ? rawCompanyId
        : null;
    const profileType = String(req.query.profileType || "vendor");
    if (!PROFILE_TYPES.has(profileType)) {
      return res.status(400).json({ error: "profileType must be vendor or developer" });
    }
    let rows: any[] = [];
    if (companyId) {
      rows = await q(
        `select * from pipeline_stage_definitions
          where organization_id = $1 and profile_type = $2 and active = true
          order by sort_order asc`,
        [companyId, profileType],
      );
    }
    if (rows.length === 0) {
      rows = await q(
        `select * from pipeline_stage_definitions
          where organization_id is null and profile_type = $1 and active = true
          order by sort_order asc`,
        [profileType],
      );
    }
    res.json({ stages: rows });
  }),
);

// ---- GET /pipeline/loss-reasons?companyId= ----------------------------------
router.get(
  "/loss-reasons",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const rawCompanyId = req.query.companyId ? String(req.query.companyId) : null;
    // IDOR fix: same as /stages above - only include this company's own
    // custom loss-reason labels if the caller is a member (or admin).
    const companyId =
      rawCompanyId && (auth.isAdmin || (await isMemberOfCompany(auth.userId!, rawCompanyId)))
        ? rawCompanyId
        : null;
    const rows = await q(
      `select * from pipeline_loss_reasons
        where active = true and (organization_id is null or organization_id = $1)
        order by organization_id nulls last, label asc`,
      [companyId],
    );
    res.json({ lossReasons: rows });
  }),
);

// ---- GET /pipeline/sources?companyId= ---------------------------------------
router.get(
  "/sources",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const rawCompanyId = req.query.companyId ? String(req.query.companyId) : null;
    // IDOR fix: same as /stages above - only include this company's own
    // custom lead-source labels if the caller is a member (or admin).
    const companyId =
      rawCompanyId && (auth.isAdmin || (await isMemberOfCompany(auth.userId!, rawCompanyId)))
        ? rawCompanyId
        : null;
    const rows = await q(
      `select * from pipeline_sources
        where active = true and (organization_id is null or organization_id = $1)
        order by organization_id nulls last, label asc`,
      [companyId],
    );
    res.json({ sources: rows });
  }),
);

// ---- GET /pipeline/tags?companyId= ------------------------------------------
router.get(
  "/tags",
  requireUser,
  h(async (req, res) => {
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const auth = getAuth(req);
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const rows = await q(`select * from pipeline_tags where organization_id = $1 order by label asc`, [
      companyId,
    ]);
    res.json({ tags: rows });
  }),
);

// ---- POST /pipeline/tags {companyId, label} ---------------------------------
router.post(
  "/tags",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.body?.companyId || "");
    const label = String(req.body?.label || "").trim();
    if (!companyId || !label) return res.status(400).json({ error: "companyId and label required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const row = await q1(
      `insert into pipeline_tags (organization_id, label) values ($1,$2)
       on conflict (organization_id, label) do update set label = excluded.label
       returning *`,
      [companyId, label],
    );
    res.status(201).json({ tag: row });
  }),
);

// ---- GET /pipeline/board?companyId=&profileType= ----------------------------
// Kanban summary: opportunity count + total estimated value per stage.
router.get(
  "/board",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    const profileType = String(req.query.profileType || "vendor");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!PROFILE_TYPES.has(profileType)) {
      return res.status(400).json({ error: "profileType must be vendor or developer" });
    }
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const rows = await q(
      `select stage_key,
              count(*)::int as opportunity_count,
              coalesce(sum(estimated_value_cents), 0)::bigint as total_value_cents
         from pipeline_opportunities
        where organization_id = $1 and profile_type = $2 and status = 'open'
        group by stage_key`,
      [companyId, profileType],
    );
    res.json({ board: rows });
  }),
);

// ---- GET /pipeline/opportunities?companyId=&profileType=&stage=&status=&ownerUserId= ----
router.get(
  "/opportunities",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }

    const conditions = ["o.organization_id = $1"];
    const params: unknown[] = [companyId];
    let i = 2;
    if (req.query.profileType) {
      conditions.push(`o.profile_type = $${i++}`);
      params.push(String(req.query.profileType));
    }
    if (req.query.stage) {
      conditions.push(`o.stage_key = $${i++}`);
      params.push(String(req.query.stage));
    }
    if (req.query.status) {
      conditions.push(`o.status = $${i++}`);
      params.push(String(req.query.status));
    }
    if (req.query.ownerUserId) {
      conditions.push(`o.owner_user_id = $${i++}`);
      params.push(String(req.query.ownerUserId));
    }

    const rows = await q<any>(
      `select o.*, ${taskDueClause("o")} as has_open_task, ${taskOverdueClause("o")} as has_overdue_task
         from pipeline_opportunities o
        where ${conditions.join(" and ")}
        order by o.updated_at desc
        limit 500`,
      params,
    );
    res.json({ opportunities: rows.map(withReadiness) });
  }),
);

// ---- POST /pipeline/opportunities -------------------------------------------
router.post(
  "/opportunities",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const companyId = String(b.companyId || "");
    const profileType = String(b.profileType || "");
    const name = String(b.name || "").trim();
    if (!companyId || !name) return res.status(400).json({ error: "companyId and name required" });
    if (!PROFILE_TYPES.has(profileType)) {
      return res.status(400).json({ error: "profileType must be vendor or developer" });
    }
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }

    const row = await q1(
      `insert into pipeline_opportunities
         (organization_id, profile_type, name, client_company_id, client_name, client_email, client_phone,
          package_id, bid_id, building_id, category, source, estimated_value_cents,
          stage_key, owner_user_id, next_action, next_action_date, expected_close_date, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       returning *`,
      [
        companyId,
        profileType,
        name,
        b.clientCompanyId ?? null,
        b.clientName ?? null,
        b.clientEmail ?? null,
        b.clientPhone ?? null,
        b.packageId ?? null,
        b.bidId ?? null,
        b.buildingId ?? null,
        b.category ?? null,
        b.source ?? null,
        b.estimatedValueCents ?? null,
        "new",
        b.ownerUserId ?? auth.userId,
        b.nextAction ?? null,
        b.nextActionDate ?? null,
        b.expectedCloseDate ?? null,
        b.notes ?? null,
        auth.userId,
      ],
    );
    await q(
      `insert into pipeline_stage_history (opportunity_id, from_stage_key, to_stage_key, changed_by)
       values ($1,null,'new',$2)`,
      [(row as any).id, auth.userId],
    );
    res.status(201).json({ opportunity: withReadiness(row) });
  }),
);

// ---- GET /pipeline/opportunities/:id -----------------------------------------
router.get(
  "/opportunities/:id",
  requireUser,
  h(async (req, res) => {
    const opp = await authorizeOpportunity(req, req.params.id);
    const [full] = await q<any>(
      `select o.*, ${taskDueClause("o")} as has_open_task, ${taskOverdueClause("o")} as has_overdue_task
         from pipeline_opportunities o where o.id = $1`,
      [opp.id],
    );
    const [activities, tasks, stageHistory, tags] = await Promise.all([
      q(`select * from pipeline_activities where opportunity_id = $1 order by created_at desc`, [opp.id]),
      q(`select * from pipeline_tasks where opportunity_id = $1 order by (due_at is null), due_at asc`, [opp.id]),
      q(`select * from pipeline_stage_history where opportunity_id = $1 order by changed_at asc`, [opp.id]),
      q(
        `select t.* from pipeline_tags t
           join pipeline_opportunity_tags ot on ot.tag_id = t.id
          where ot.opportunity_id = $1 order by t.label asc`,
        [opp.id],
      ),
    ]);
    res.json({ opportunity: withReadiness(full ?? opp), activities, tasks, stageHistory, tags });
  }),
);

const EDITABLE_FIELDS: Record<string, string> = {
  name: "name",
  clientCompanyId: "client_company_id",
  clientName: "client_name",
  clientEmail: "client_email",
  clientPhone: "client_phone",
  packageId: "package_id",
  bidId: "bid_id",
  buildingId: "building_id",
  category: "category",
  source: "source",
  estimatedValueCents: "estimated_value_cents",
  probabilityBasisPoints: "probability_basis_points",
  ownerUserId: "owner_user_id",
  nextAction: "next_action",
  nextActionDate: "next_action_date",
  expectedCloseDate: "expected_close_date",
  notes: "notes",
};

// ---- PATCH /pipeline/opportunities/:id ---------------------------------------
// Plain field edits, PLUS an optional stage transition ({stageKey}) which
// appends an immutable pipeline_stage_history row and, if the destination
// stage is flagged is_won/is_lost, sets status + won_at/lost_at accordingly.
router.patch(
  "/opportunities/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const opp = await authorizeOpportunity(req, req.params.id);
    const b = req.body ?? {};

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
      if (b[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        vals.push(b[key]);
      }
    }

    if (b.stageKey !== undefined && String(b.stageKey) !== opp.stage_key) {
      const newStageKey = String(b.stageKey);
      const stageDef =
        (await q1<any>(
          `select * from pipeline_stage_definitions
            where profile_type = $1 and stage_key = $2 and (organization_id = $3 or organization_id is null)
            order by organization_id nulls last limit 1`,
          [opp.profile_type, newStageKey, opp.organization_id],
        )) ?? null;
      if (!stageDef) return res.status(400).json({ error: `unknown stage: ${newStageKey}` });

      sets.push(`stage_key = $${i++}`);
      vals.push(newStageKey);
      sets.push(`last_activity_at = now()`);

      if (stageDef.is_won) {
        sets.push(`status = 'won'`, `won_at = now()`);
      } else if (stageDef.is_lost) {
        sets.push(`status = 'lost'`, `lost_at = now()`);
        if (b.lossReasonId !== undefined) {
          sets.push(`loss_reason_id = $${i++}`);
          vals.push(b.lossReasonId);
        }
        if (b.lossNotes !== undefined) {
          sets.push(`loss_notes = $${i++}`);
          vals.push(b.lossNotes);
        }
      }
    }

    if (sets.length > 0) {
      sets.push(`updated_at = now()`);
      vals.push(opp.id);
      await q(`update pipeline_opportunities set ${sets.join(", ")} where id = $${i}`, vals);

      if (b.stageKey !== undefined && String(b.stageKey) !== opp.stage_key) {
        await q(
          `insert into pipeline_stage_history (opportunity_id, from_stage_key, to_stage_key, changed_by)
           values ($1,$2,$3,$4)`,
          [opp.id, opp.stage_key, String(b.stageKey), auth.userId],
        );
      }
    }

    const [full] = await q<any>(
      `select o.*, ${taskDueClause("o")} as has_open_task, ${taskOverdueClause("o")} as has_overdue_task
         from pipeline_opportunities o where o.id = $1`,
      [opp.id],
    );
    res.json({ opportunity: withReadiness(full ?? opp) });
  }),
);

// ---- POST /pipeline/opportunities/:id/activities {activityType, body} -------
router.post(
  "/opportunities/:id/activities",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const opp = await authorizeOpportunity(req, req.params.id);
    const activityType = String(req.body?.activityType || "note");
    if (!ACTIVITY_TYPES.has(activityType)) {
      return res.status(400).json({ error: `invalid activityType: ${activityType}` });
    }
    const body = req.body?.body ? String(req.body.body) : null;
    const row = await q1(
      `insert into pipeline_activities (opportunity_id, activity_type, body, created_by)
       values ($1,$2,$3,$4) returning *`,
      [opp.id, activityType, body, auth.userId],
    );
    await q(`update pipeline_opportunities set last_activity_at = now(), updated_at = now() where id = $1`, [
      opp.id,
    ]);
    res.status(201).json({ activity: row });
  }),
);

// ---- POST /pipeline/opportunities/:id/tasks {title, dueAt?, assignedTo?} ----
router.post(
  "/opportunities/:id/tasks",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const opp = await authorizeOpportunity(req, req.params.id);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const row = await q1(
      `insert into pipeline_tasks (opportunity_id, title, due_at, assigned_to, created_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [opp.id, title, req.body?.dueAt ?? null, req.body?.assignedTo ?? auth.userId, auth.userId],
    );
    res.status(201).json({ task: row });
  }),
);

// ---- PATCH /pipeline/tasks/:id {status} --------------------------------------
router.patch(
  "/tasks/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const task = await q1<any>(`select * from pipeline_tasks where id = $1`, [req.params.id]);
    if (!task) throw new NotFoundError("task not found");
    const opp = await authorizeOpportunity(req, task.opportunity_id);

    const status = req.body?.status ? String(req.body.status) : null;
    if (status && !TASK_STATUSES.has(status)) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (status) {
      sets.push(`status = $${i++}`);
      vals.push(status);
      if (status === "completed") {
        sets.push(`completed_at = now()`, `completed_by = $${i++}`);
        vals.push(auth.userId);
      }
    }
    if (req.body?.title !== undefined) {
      sets.push(`title = $${i++}`);
      vals.push(String(req.body.title));
    }
    if (req.body?.dueAt !== undefined) {
      sets.push(`due_at = $${i++}`);
      vals.push(req.body.dueAt);
    }
    if (sets.length === 0) return res.json({ task });
    vals.push(task.id);
    const row = await q1(`update pipeline_tasks set ${sets.join(", ")} where id = $${i} returning *`, vals);
    if (status) {
      await q(`update pipeline_opportunities set last_activity_at = now(), updated_at = now() where id = $1`, [
        opp.id,
      ]);
    }
    res.json({ task: row });
  }),
);

// ---- POST /pipeline/opportunities/:id/tags {tagId} ---------------------------
router.post(
  "/opportunities/:id/tags",
  requireUser,
  h(async (req, res) => {
    const opp = await authorizeOpportunity(req, req.params.id);
    const tagId = String(req.body?.tagId || "");
    if (!tagId) return res.status(400).json({ error: "tagId required" });
    const tag = await q1<any>(`select * from pipeline_tags where id = $1 and organization_id = $2`, [
      tagId,
      opp.organization_id,
    ]);
    if (!tag) throw new NotFoundError("tag not found");
    await q(
      `insert into pipeline_opportunity_tags (opportunity_id, tag_id) values ($1,$2)
       on conflict do nothing`,
      [opp.id, tagId],
    );
    res.status(201).json({ ok: true });
  }),
);

// ---- DELETE /pipeline/opportunities/:id/tags/:tagId --------------------------
router.delete(
  "/opportunities/:id/tags/:tagId",
  requireUser,
  h(async (req, res) => {
    const opp = await authorizeOpportunity(req, req.params.id);
    await q(`delete from pipeline_opportunity_tags where opportunity_id = $1 and tag_id = $2`, [
      opp.id,
      req.params.tagId,
    ]);
    res.json({ ok: true });
  }),
);

export default router;
