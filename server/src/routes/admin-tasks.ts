/**
 * Divini Procure - ADMIN TASK MANAGEMENT + UNIFIED AUDIT FEED.
 *
 * Self-pathed; mounted under /api in routes.ts with no prefix, so full paths
 * are /api/admin/tasks... and /api/admin/audit. Every endpoint is requireAdmin.
 *
 * Tasks:
 *   GET    /admin/tasks?status=&assignedTo=&linkedType=   list (newest first)
 *   POST   /admin/tasks                                   create
 *   PATCH  /admin/tasks/:id                               update mutable fields
 *   DELETE /admin/tasks/:id                               remove
 *
 * Audit:
 *   GET /admin/audit?action=&limit=   normalized cross-table feed. Each known
 *   audit table is probed with to_regclass first, so a table that has not been
 *   created yet is skipped gracefully instead of erroring.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const LINKED_TYPES = [
  "account",
  "project",
  "vendor",
  "investor",
  "document",
  "claim",
  "bid",
  "opportunity",
  "program",
  "other",
];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["open", "in_progress", "done", "dismissed"];

// ===========================================================================
// TASKS
// ===========================================================================
router.get(
  "/admin/tasks",
  requireAdmin,
  h(async (req, res) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const status = req.query.status ? String(req.query.status) : "";
    const assignedTo = req.query.assignedTo ? String(req.query.assignedTo) : "";
    const linkedType = req.query.linkedType ? String(req.query.linkedType) : "";
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (assignedTo) {
      params.push(assignedTo);
      where.push(`assigned_to = $${params.length}`);
    }
    if (linkedType) {
      params.push(linkedType);
      where.push(`linked_type = $${params.length}`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";
    const tasks = await q(
      `select * from admin_tasks ${clause} order by
         case status when 'open' then 0 when 'in_progress' then 1 when 'done' then 2 else 3 end,
         case priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
         created_at desc`,
      params,
    );
    res.json({ tasks });
  }),
);

router.post(
  "/admin/tasks",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = body.title ? String(body.title).trim() : "";
    if (!title) return res.status(400).json({ error: "title required" });

    const detail = body.detail ? String(body.detail) : null;
    const linkedType =
      body.linkedType && LINKED_TYPES.includes(String(body.linkedType))
        ? String(body.linkedType)
        : null;
    const linkedId = body.linkedId ? String(body.linkedId) : null;
    const assignedTo = body.assignedTo ? String(body.assignedTo) : null;
    const priority = PRIORITIES.includes(String(body.priority)) ? String(body.priority) : "medium";
    const dueDate = body.dueDate ? String(body.dueDate) : null;

    const task = await q1(
      `insert into admin_tasks
         (title, detail, linked_type, linked_id, assigned_to, priority, due_date, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [title, detail, linkedType, linkedId, assignedTo, priority, dueDate, auth.email],
    );
    res.status(201).json({ task });
  }),
);

router.patch(
  "/admin/tasks/:id",
  requireAdmin,
  h(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.status !== undefined) {
      if (!STATUSES.includes(String(body.status)))
        return res.status(400).json({ error: "invalid status" });
      params.push(String(body.status));
      sets.push(`status = $${params.length}`);
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(String(body.priority)))
        return res.status(400).json({ error: "invalid priority" });
      params.push(String(body.priority));
      sets.push(`priority = $${params.length}`);
    }
    if (body.assignedTo !== undefined) {
      params.push(body.assignedTo ? String(body.assignedTo) : null);
      sets.push(`assigned_to = $${params.length}`);
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return res.status(400).json({ error: "title cannot be empty" });
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (body.detail !== undefined) {
      params.push(body.detail ? String(body.detail) : null);
      sets.push(`detail = $${params.length}`);
    }
    if (body.dueDate !== undefined) {
      params.push(body.dueDate ? String(body.dueDate) : null);
      sets.push(`due_date = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "no updatable fields supplied" });

    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    const task = await q1(
      `update admin_tasks set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!task) return res.status(404).json({ error: "task not found" });
    res.json({ task });
  }),
);

router.delete(
  "/admin/tasks/:id",
  requireAdmin,
  h(async (req, res) => {
    const row = await q1(`delete from admin_tasks where id = $1 returning id`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "task not found" });
    res.json({ ok: true });
  }),
);

// ===========================================================================
// UNIFIED AUDIT FEED
// ===========================================================================
// Each source contributes a normalized shape:
//   { source, action, actor_email, subject, detail, created_at }
// Probe each table with to_regclass so a not-yet-created table is skipped.
const AUDIT_SOURCES: { table: string; select: (alias: string) => string }[] = [
  {
    table: "dvr_audit_log",
    select: (a) => `select
        'dvr_audit_log'::text       as source,
        ${a}.action::text           as action,
        ${a}.actor_email::text      as actor_email,
        ${a}.relationship_id::text  as subject,
        ${a}.detail::text           as detail,
        ${a}.created_at             as created_at
      from dvr_audit_log ${a}`,
  },
  {
    table: "change_order_audit",
    select: (a) => `select
        'change_order_audit'::text     as source,
        ${a}.action::text              as action,
        ${a}.actor_email::text         as actor_email,
        ${a}.change_order_id::text     as subject,
        ${a}.detail::text              as detail,
        ${a}.created_at                as created_at
      from change_order_audit ${a}`,
  },
  {
    table: "fee_rule_audit",
    select: (a) => `select
        'fee_rule_audit'::text   as source,
        ${a}.action::text        as action,
        ${a}.actor_email::text   as actor_email,
        ${a}.fee_rule_id::text   as subject,
        ${a}.detail::text        as detail,
        ${a}.created_at          as created_at
      from fee_rule_audit ${a}`,
  },
  {
    table: "investment_audit_log",
    select: (a) => `select
        'investment_audit_log'::text                              as source,
        ${a}.action::text                                         as action,
        ${a}.actor_email::text                                    as actor_email,
        (${a}.subject_type::text || ':' || ${a}.subject_id::text) as subject,
        ${a}.detail::text                                         as detail,
        ${a}.created_at                                           as created_at
      from investment_audit_log ${a}`,
  },
];

async function tableExists(table: string): Promise<boolean> {
  const row = await q1<{ exists: string | null }>(
    `select to_regclass($1) as exists`,
    [`public.${table}`],
  );
  return !!row?.exists;
}

router.get(
  "/admin/audit",
  requireAdmin,
  h(async (req, res) => {
    const action = req.query.action ? String(req.query.action) : "";
    let limit = Number.parseInt(String(req.query.limit ?? ""), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 200;
    if (limit > 1000) limit = 1000;

    const present = [];
    for (const s of AUDIT_SOURCES) {
      if (await tableExists(s.table)) present.push(s);
    }

    if (present.length === 0) {
      return res.json({ entries: [], sources: AUDIT_SOURCES.map((s) => s.table), present: [] });
    }

    const params: unknown[] = [];
    let actionClause = "";
    if (action) {
      params.push(action);
      actionClause = `where action = $${params.length}`;
    }
    params.push(limit);
    const limitClause = `limit $${params.length}`;

    const union = present.map((s, i) => s.select(`t${i}`)).join("\n      union all\n      ");
    const sql = `
      select * from (
        ${union}
      ) feed
      ${actionClause}
      order by created_at desc
      ${limitClause}`;

    const entries = await q(sql, params);
    res.json({
      entries,
      sources: AUDIT_SOURCES.map((s) => s.table),
      present: present.map((s) => s.table),
    });
  }),
);

export default router;
