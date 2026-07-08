/**
 * Divini Procure - CRM / SALES PIPELINE + DEMO/ONBOARDING MEETINGS.
 *
 * Admin-facing sales pipeline. Self-pathed; mounted in routes.ts with
 * `router.use(crmRouter)` (NO extra prefix), so the full paths are
 * /api/admin/crm*, /api/admin/crm/board, and /api/admin/meetings/:id.
 *
 * A crm_record is a tracked subject (developer | vendor | investor | other)
 * moving through pipeline stages (prospect -> contacted -> demo_scheduled ->
 * onboarding_started -> active, or paused | lost). onboarding_meetings log demo
 * and onboarding sessions against a record (requested docs, follow-up tasks,
 * assigned admin, profile completeness, outcome status).
 *
 * Every endpoint is admin-only (requireAdmin). Tables live in
 * db/schema-crm.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { NotFoundError } from "../db.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const SUBJECT_TYPES = new Set<string>(["developer", "vendor", "investor", "other"]);
const STAGES = [
  "prospect",
  "contacted",
  "demo_scheduled",
  "onboarding_started",
  "active",
  "paused",
  "lost",
] as const;
const STAGE_SET = new Set<string>(STAGES);
const MEETING_STATUS = new Set<string>(["scheduled", "completed", "no_show", "cancelled"]);

/** Normalize an unknown into a clean string array (for text[] columns). */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean);
}

/** Trimmed string, or null when empty / absent. */
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ===========================================================================
// CRM RECORDS
// ===========================================================================

// GET /admin/crm?stage=&subjectType= -> list pipeline records.
router.get(
  "/admin/crm",
  requireAdmin,
  h(async (req, res) => {
    const stage = req.query.stage ? String(req.query.stage) : null;
    const subjectType = req.query.subjectType ? String(req.query.subjectType) : null;

    const where: string[] = [];
    const params: unknown[] = [];
    if (stage && STAGE_SET.has(stage)) {
      params.push(stage);
      where.push(`r.stage = $${params.length}`);
    }
    if (subjectType && SUBJECT_TYPES.has(subjectType)) {
      params.push(subjectType);
      where.push(`r.subject_type = $${params.length}`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";

    const records = await q<any>(
      `select r.*, c.name as company_name, c.kind as company_kind
         from crm_records r
         left join companies c on c.id = r.subject_company_id
         ${clause}
        order by r.updated_at desc`,
      params,
    );
    res.json({ records });
  }),
);

// GET /admin/crm/board -> records grouped by stage (kanban).
router.get(
  "/admin/crm/board",
  requireAdmin,
  h(async (_req, res) => {
    const records = await q<any>(
      `select r.*, c.name as company_name, c.kind as company_kind
         from crm_records r
         left join companies c on c.id = r.subject_company_id
        order by r.updated_at desc`,
    );
    const board: Record<string, any[]> = {};
    for (const stage of STAGES) board[stage] = [];
    for (const rec of records) {
      const stage = STAGE_SET.has(rec.stage) ? rec.stage : "prospect";
      board[stage].push(rec);
    }
    res.json({ stages: STAGES, board });
  }),
);

// POST /admin/crm -> create a pipeline record.
router.post(
  "/admin/crm",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const subjectType =
      typeof b.subjectType === "string" && SUBJECT_TYPES.has(b.subjectType)
        ? b.subjectType
        : "other";
    const stage =
      typeof b.stage === "string" && STAGE_SET.has(b.stage) ? b.stage : "prospect";

    const name = str(b.name);
    const email = str(b.email);
    if (!name && !email) {
      return res.status(400).json({ error: "name or email required" });
    }

    const record = await q1<any>(
      `insert into crm_records
         (subject_type, subject_company_id, subject_user_id, name, email, phone,
          stage, source, owner_admin, notes, next_action, next_action_date, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [
        subjectType,
        str(b.subjectCompanyId),
        str(b.subjectUserId),
        name,
        email,
        str(b.phone),
        stage,
        str(b.source),
        str(b.ownerAdmin),
        str(b.notes),
        str(b.nextAction),
        str(b.nextActionDate),
        auth.email ?? auth.userId ?? null,
      ],
    );
    res.status(201).json({ record });
  }),
);

// GET /admin/crm/:id -> a record plus its meetings.
router.get(
  "/admin/crm/:id",
  requireAdmin,
  h(async (req, res) => {
    const record = await q1<any>(
      `select r.*, c.name as company_name, c.kind as company_kind
         from crm_records r
         left join companies c on c.id = r.subject_company_id
        where r.id = $1`,
      [req.params.id],
    );
    if (!record) throw new NotFoundError("crm record not found");
    const meetings = await q<any>(
      `select * from onboarding_meetings
        where crm_record_id = $1
        order by coalesce(scheduled_at, created_at) desc`,
      [req.params.id],
    );
    res.json({ record, meetings });
  }),
);

// PATCH /admin/crm/:id -> update stage + fields.
router.patch(
  "/admin/crm/:id",
  requireAdmin,
  h(async (req, res) => {
    const existing = await q1<any>(`select id from crm_records where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError("crm record not found");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];

    const setCol = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };

    if (b.stage !== undefined) {
      if (typeof b.stage !== "string" || !STAGE_SET.has(b.stage)) {
        return res.status(400).json({ error: "valid stage required" });
      }
      setCol("stage", b.stage);
    }
    if (b.subjectType !== undefined) {
      if (typeof b.subjectType !== "string" || !SUBJECT_TYPES.has(b.subjectType)) {
        return res.status(400).json({ error: "valid subjectType required" });
      }
      setCol("subject_type", b.subjectType);
    }
    if (b.subjectCompanyId !== undefined) setCol("subject_company_id", str(b.subjectCompanyId));
    if (b.subjectUserId !== undefined) setCol("subject_user_id", str(b.subjectUserId));
    if (b.name !== undefined) setCol("name", str(b.name));
    if (b.email !== undefined) setCol("email", str(b.email));
    if (b.phone !== undefined) setCol("phone", str(b.phone));
    if (b.source !== undefined) setCol("source", str(b.source));
    if (b.ownerAdmin !== undefined) setCol("owner_admin", str(b.ownerAdmin));
    if (b.notes !== undefined) setCol("notes", str(b.notes));
    if (b.nextAction !== undefined) setCol("next_action", str(b.nextAction));
    if (b.nextActionDate !== undefined) setCol("next_action_date", str(b.nextActionDate));

    if (sets.length === 0) {
      const record = await q1<any>(`select * from crm_records where id = $1`, [req.params.id]);
      return res.json({ record });
    }

    params.push(req.params.id);
    const record = await q1<any>(
      `update crm_records set ${sets.join(", ")}, updated_at = now()
        where id = $${params.length} returning *`,
      params,
    );
    res.json({ record });
  }),
);

// DELETE /admin/crm/:id -> remove a record (cascades its meetings).
router.delete(
  "/admin/crm/:id",
  requireAdmin,
  h(async (req, res) => {
    const existing = await q1<any>(`select id from crm_records where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError("crm record not found");
    await q(`delete from crm_records where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

// ===========================================================================
// ONBOARDING / DEMO MEETINGS
// ===========================================================================

// POST /admin/crm/:id/meetings -> log a demo / onboarding meeting on a record.
router.post(
  "/admin/crm/:id/meetings",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const record = await q1<any>(
      `select id, subject_company_id from crm_records where id = $1`,
      [req.params.id],
    );
    if (!record) throw new NotFoundError("crm record not found");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const status =
      typeof b.status === "string" && MEETING_STATUS.has(b.status) ? b.status : "scheduled";

    let completeness: number | null = null;
    if (b.profileCompleteness != null && b.profileCompleteness !== "") {
      const n = Number(b.profileCompleteness);
      if (Number.isFinite(n)) completeness = Math.max(0, Math.min(100, Math.trunc(n)));
    }

    const meeting = await q1<any>(
      `insert into onboarding_meetings
         (crm_record_id, subject_company_id, title, scheduled_at, notes,
          requested_docs, follow_up_tasks, assigned_admin, profile_completeness,
          status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning *`,
      [
        record.id,
        record.subject_company_id,
        str(b.title),
        str(b.scheduledAt),
        str(b.notes),
        toStringArray(b.requestedDocs),
        toStringArray(b.followUpTasks),
        str(b.assignedAdmin),
        completeness,
        status,
        auth.email ?? auth.userId ?? null,
      ],
    );
    res.status(201).json({ meeting });
  }),
);

// PATCH /admin/meetings/:id -> update a logged meeting.
router.patch(
  "/admin/meetings/:id",
  requireAdmin,
  h(async (req, res) => {
    const existing = await q1<any>(`select id from onboarding_meetings where id = $1`, [
      req.params.id,
    ]);
    if (!existing) throw new NotFoundError("meeting not found");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const setCol = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };

    if (b.title !== undefined) setCol("title", str(b.title));
    if (b.scheduledAt !== undefined) setCol("scheduled_at", str(b.scheduledAt));
    if (b.notes !== undefined) setCol("notes", str(b.notes));
    if (b.requestedDocs !== undefined) setCol("requested_docs", toStringArray(b.requestedDocs));
    if (b.followUpTasks !== undefined) setCol("follow_up_tasks", toStringArray(b.followUpTasks));
    if (b.assignedAdmin !== undefined) setCol("assigned_admin", str(b.assignedAdmin));
    if (b.profileCompleteness !== undefined) {
      let completeness: number | null = null;
      if (b.profileCompleteness != null && b.profileCompleteness !== "") {
        const n = Number(b.profileCompleteness);
        if (Number.isFinite(n)) completeness = Math.max(0, Math.min(100, Math.trunc(n)));
      }
      setCol("profile_completeness", completeness);
    }
    if (b.status !== undefined) {
      if (typeof b.status !== "string" || !MEETING_STATUS.has(b.status)) {
        return res.status(400).json({ error: "valid status required" });
      }
      setCol("status", b.status);
    }

    if (sets.length === 0) {
      const meeting = await q1<any>(`select * from onboarding_meetings where id = $1`, [
        req.params.id,
      ]);
      return res.json({ meeting });
    }

    params.push(req.params.id);
    const meeting = await q1<any>(
      `update onboarding_meetings set ${sets.join(", ")}
        where id = $${params.length} returning *`,
      params,
    );
    res.json({ meeting });
  }),
);

export default router;
