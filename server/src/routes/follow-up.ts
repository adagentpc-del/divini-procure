/**
 * Divini Follow-Up Desk - rules-based reminder/workflow engine.
 * Mounted under /api/follow-up in routes.ts.
 *
 * A workflow enrollment advances one step at a time: at its next_action_at,
 * check the linked record's current status against the workflow's
 * stop_on_statuses (already resolved -> complete, don't fire), then check the
 * step's condition_code (a named, deterministic check against the record's
 * current state - never a generated judgment), then execute the step's
 * action (send a templated email, an in-app notification, or a task) if the
 * condition holds, then advance to the next step or complete.
 *
 * processDueFollowUps() is called both from an admin-triggered HTTP endpoint
 * and from an in-process interval (server/src/index.ts) - this is a
 * persistent Node server (app.listen), not serverless, so an in-process
 * interval is a real, working scheduler with no external cron dependency.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { addDelay, renderTemplate, isApproaching, isStale, type DelayUnit } from "../lib/follow-up-scheduling.js";
import { sendEmail } from "../lib/email.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const CONTEXT_TYPES = new Set(["pipeline_opportunity", "bid_draft", "bid_submitted", "scope_instance", "vendor_credential"]);
const ENROLLMENT_STATUSES = new Set(["active", "paused", "stopped"]);

async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

// ---------------------------------------------------------------------------
// Context record loading + deterministic condition/status evaluation
// ---------------------------------------------------------------------------

async function loadContextRecord(contextType: string, contextId: string): Promise<any | null> {
  if (contextType === "pipeline_opportunity") return q1(`select * from pipeline_opportunities where id = $1`, [contextId]);
  if (contextType === "bid_draft" || contextType === "bid_submitted") return q1(`select * from bids where id = $1`, [contextId]);
  if (contextType === "scope_instance") return q1(`select * from scope_instances where id = $1`, [contextId]);
  if (contextType === "vendor_credential") return q1(`select * from vendor_credentials where id = $1`, [contextId]);
  return null;
}

/** The status field to compare against a workflow's stop_on_statuses. */
function recordStatus(contextType: string, record: any): string | null {
  if (!record) return null;
  if (contextType === "vendor_credential") return record.status;
  return record.status ?? null;
}

/** Named, deterministic conditions. An unrecognized code fails CLOSED (skip) rather than firing blindly. */
function conditionMet(conditionCode: string | null, record: any, now: Date): boolean {
  if (!conditionCode) return true;
  switch (conditionCode) {
    case "no_recent_activity_14d":
      return record.status === "open" && isStale(record.last_activity_at, 14, now);
    case "draft_still_open":
      return record.status === "draft";
    case "still_submitted":
      return record.status === "submitted";
    case "expiring_within_3d":
      return record.status === "submitted" && isApproaching(record.expires_at, 3, now);
    case "still_draft":
      return record.status === "draft";
    case "credential_expiring_30d":
      return record.status !== "expired" && isApproaching(record.expires_at, 30, now);
    default:
      return false;
  }
}

/** Resolve a company + user to notify/email for this context record. */
async function resolveNotifyTarget(contextType: string, record: any): Promise<{ userId: string | null; email: string | null }> {
  let companyId: string | null = null;
  let userId: string | null = null;
  if (contextType === "pipeline_opportunity") {
    companyId = record.organization_id;
    userId = record.owner_user_id ?? record.created_by ?? null;
  } else if (contextType === "bid_draft" || contextType === "bid_submitted") {
    companyId = record.vendor_company_id;
  } else if (contextType === "scope_instance") {
    companyId = record.organization_id;
    userId = record.created_by ?? null;
  } else if (contextType === "vendor_credential") {
    companyId = record.company_id;
  }

  if (!userId && companyId) {
    const m = await q1<{ user_id: string }>(
      `select user_id from company_members where company_id = $1 order by created_at asc limit 1`,
      [companyId],
    );
    userId = m?.user_id ?? null;
  }
  let email: string | null = null;
  if (userId) {
    const u = await q1<{ email: string }>(`select email from users where id = $1`, [userId]);
    email = u?.email ?? null;
  }
  return { userId, email };
}

function mergeFieldsFor(contextType: string, record: any): Record<string, string | number | null> {
  if (contextType === "pipeline_opportunity") {
    return { opportunityName: record.name, stage: record.stage_key };
  }
  if (contextType === "bid_draft" || contextType === "bid_submitted") {
    return { packageId: record.package_id, expiresAt: record.expires_at ? String(record.expires_at).slice(0, 10) : "" };
  }
  if (contextType === "scope_instance") {
    return { scopeTitle: record.title, category: record.category };
  }
  if (contextType === "vendor_credential") {
    return { credentialType: record.type, expiresAt: record.expires_at ? String(record.expires_at).slice(0, 10) : "" };
  }
  return {};
}

// ---------------------------------------------------------------------------
// GET /follow-up/workflows?companyId= -> org + global workflows, with steps
// ---------------------------------------------------------------------------
router.get(
  "/workflows",
  requireUser,
  h(async (req, res) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    const workflows = await q<any>(
      `select * from follow_up_workflows
        where active = true and (organization_id is null or organization_id = $1)
        order by organization_id nulls last, name asc`,
      [companyId],
    );
    const ids = workflows.map((w) => w.id);
    const steps = ids.length
      ? await q<any>(`select * from follow_up_steps where workflow_id = any($1) order by step_order asc`, [ids])
      : [];
    res.json({
      workflows: workflows.map((w) => ({ ...w, steps: steps.filter((s) => s.workflow_id === w.id) })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /follow-up/enrollments?companyId=&status=&contextType= -----------------
// ---------------------------------------------------------------------------
router.get(
  "/enrollments",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const conditions = ["organization_id = $1"];
    const params: unknown[] = [companyId];
    let i = 2;
    if (req.query.status) {
      conditions.push(`status = $${i++}`);
      params.push(String(req.query.status));
    }
    if (req.query.contextType) {
      conditions.push(`context_type = $${i++}`);
      params.push(String(req.query.contextType));
    }
    const rows = await q(
      `select * from follow_up_enrollments where ${conditions.join(" and ")} order by next_action_at asc nulls last limit 300`,
      params,
    );
    res.json({ enrollments: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /follow-up/enroll {companyId, workflowKey, contextType, contextId} ---
// ---------------------------------------------------------------------------
router.post(
  "/enroll",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const companyId = String(b.companyId || "");
    const workflowKey = String(b.workflowKey || "");
    const contextType = String(b.contextType || "");
    const contextId = String(b.contextId || "");
    if (!companyId || !workflowKey || !contextType || !contextId) {
      return res.status(400).json({ error: "companyId, workflowKey, contextType, and contextId required" });
    }
    if (!CONTEXT_TYPES.has(contextType)) return res.status(400).json({ error: `invalid contextType: ${contextType}` });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }

    const workflow = await q1<any>(
      `select * from follow_up_workflows
        where workflow_key = $1 and context_type = $2 and active = true
          and (organization_id = $3 or organization_id is null)
        order by organization_id nulls last limit 1`,
      [workflowKey, contextType, companyId],
    );
    if (!workflow) return res.status(404).json({ error: `no active workflow for key ${workflowKey}` });

    const firstStep = await q1<any>(
      `select * from follow_up_steps where workflow_id = $1 order by step_order asc limit 1`,
      [workflow.id],
    );
    const nextActionAt = firstStep ? addDelay(new Date(), firstStep.delay_value, firstStep.delay_unit as DelayUnit) : null;

    const row = await q1(
      `insert into follow_up_enrollments (workflow_id, organization_id, context_type, context_id, next_action_at, created_by)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (workflow_id, context_type, context_id) do update set
         status = 'active', current_step = 0, next_action_at = excluded.next_action_at,
         completed_at = null, stop_reason = null
       returning *`,
      [workflow.id, companyId, contextType, contextId, nextActionAt, auth.userId],
    );
    res.status(201).json({ enrollment: row });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /follow-up/enrollments/:id {status} - pause / resume / stop --------
// ---------------------------------------------------------------------------
router.patch(
  "/enrollments/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const enrollment = await q1<any>(`select * from follow_up_enrollments where id = $1`, [req.params.id]);
    if (!enrollment) throw new NotFoundError("enrollment not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, enrollment.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const status = String(req.body?.status || "");
    if (!ENROLLMENT_STATUSES.has(status)) return res.status(400).json({ error: `status must be one of ${[...ENROLLMENT_STATUSES].join(", ")}` });
    const row = await q1(
      `update follow_up_enrollments set status = $2, stop_reason = $3 where id = $1 returning *`,
      [enrollment.id, status, status === "stopped" ? (req.body?.stopReason ?? "manually stopped") : null],
    );
    res.json({ enrollment: row });
  }),
);

// ---------------------------------------------------------------------------
// GET /follow-up/actions?enrollmentId= ---------------------------------------
// ---------------------------------------------------------------------------
router.get(
  "/actions",
  requireUser,
  h(async (req, res) => {
    const enrollmentId = String(req.query.enrollmentId || "");
    if (!enrollmentId) return res.status(400).json({ error: "enrollmentId required" });
    const auth = getAuth(req);
    const enrollment = await q1<any>(`select * from follow_up_enrollments where id = $1`, [enrollmentId]);
    if (!enrollment) throw new NotFoundError("enrollment not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, enrollment.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const rows = await q(`select * from follow_up_actions where enrollment_id = $1 order by created_at desc`, [enrollmentId]);
    res.json({ actions: rows });
  }),
);

/** Actually perform a step's action. Shared by the automatic run and the manual-approval path. */
async function executeStepAction(
  step: any,
  workflow: any,
  contextType: string,
  contextId: string,
  record: any,
): Promise<{ ok: boolean; failureReason: string | null }> {
  const template = step.template_id ? await q1<any>(`select * from follow_up_templates where id = $1`, [step.template_id]) : null;
  const fields = mergeFieldsFor(contextType, record);
  const target = await resolveNotifyTarget(contextType, record);

  if (step.action_type === "send_email") {
    if (!target.email) return { ok: false, failureReason: "no email on file" };
    if (!template) return { ok: false, failureReason: "no template" };
    const result = await sendEmail({
      to: target.email,
      subject: renderTemplate(template.subject || workflow.name, fields),
      text: renderTemplate(template.body, fields),
    });
    // "skipped" (email provider disabled) still counts as handled, not failed.
    if (result.ok || result.skipped) return { ok: true, failureReason: null };
    return { ok: false, failureReason: result.error ?? "send failed" };
  }

  if (step.action_type === "notify") {
    if (!target.userId) return { ok: false, failureReason: "no user to notify" };
    if (!template) return { ok: false, failureReason: "no template" };
    await q(`insert into notifications (user_id, title, detail, kind) values ($1,$2,$3,'follow_up')`, [
      target.userId,
      workflow.name,
      renderTemplate(template.body, fields),
    ]);
    return { ok: true, failureReason: null };
  }

  if (step.action_type === "create_task" && contextType === "pipeline_opportunity") {
    await q(
      `insert into pipeline_tasks (opportunity_id, title, assigned_to, created_by) values ($1,$2,$3,$4)`,
      [contextId, template ? renderTemplate(template.body, fields) : workflow.name, target.userId, target.userId],
    );
    return { ok: true, failureReason: null };
  }

  return { ok: false, failureReason: `no handler for action_type=${step.action_type} on context_type=${contextType}` };
}

/** Move an enrollment to its next step (recomputing next_action_at), or mark it completed if there is none. */
async function advanceEnrollment(enrollment: any, steps: any[], now: Date): Promise<"advanced" | "completed"> {
  const nextStep = steps[enrollment.current_step + 1];
  if (nextStep) {
    await q(
      `update follow_up_enrollments set current_step = current_step + 1, next_action_at = $2 where id = $1`,
      [enrollment.id, addDelay(now, nextStep.delay_value, nextStep.delay_unit as DelayUnit)],
    );
    return "advanced";
  }
  await q(
    `update follow_up_enrollments set status = 'completed', completed_at = now(), stop_reason = 'sequence finished' where id = $1`,
    [enrollment.id],
  );
  return "completed";
}

// ---------------------------------------------------------------------------
// The processing engine. Exported so index.ts can call it on an interval.
// ---------------------------------------------------------------------------
export async function processDueFollowUps(now: Date = new Date()): Promise<{ processed: number; sent: number; skipped: number; awaitingApproval: number; completed: number; failed: number }> {
  const due = await q<any>(
    `select * from follow_up_enrollments where status = 'active' and next_action_at is not null and next_action_at <= $1 limit 200`,
    [now],
  );
  let sent = 0, skipped = 0, awaitingApproval = 0, completed = 0, failed = 0;

  for (const enrollment of due) {
    try {
      const workflow = await q1<any>(`select * from follow_up_workflows where id = $1`, [enrollment.workflow_id]);
      const steps = await q<any>(`select * from follow_up_steps where workflow_id = $1 order by step_order asc`, [enrollment.workflow_id]);
      const step = steps[enrollment.current_step];
      const record = await loadContextRecord(enrollment.context_type, enrollment.context_id);

      if (!record) {
        await q(`update follow_up_enrollments set status = 'stopped', stop_reason = 'record not found' where id = $1`, [enrollment.id]);
        completed++;
        continue;
      }

      const status = recordStatus(enrollment.context_type, record);
      if (workflow.stop_on_statuses?.includes(status)) {
        await q(
          `update follow_up_enrollments set status = 'completed', completed_at = now(), stop_reason = $2 where id = $1`,
          [enrollment.id, `record status is now "${status}"`],
        );
        completed++;
        continue;
      }

      if (!step) {
        await q(`update follow_up_enrollments set status = 'completed', completed_at = now(), stop_reason = 'no steps' where id = $1`, [enrollment.id]);
        completed++;
        continue;
      }

      const conditionOk = conditionMet(step.condition_code, record, now);
      const actionRow = await q1<any>(
        `insert into follow_up_actions (enrollment_id, step_id, action_type, status, scheduled_at)
         values ($1,$2,$3,'pending',$4) returning *`,
        [enrollment.id, step.id, step.action_type, enrollment.next_action_at],
      );

      if (!conditionOk) {
        // Condition no longer holds (e.g. activity was logged before the delay
        // elapsed) - skip firing and advance/complete as usual.
        await q(`update follow_up_actions set status = 'skipped', executed_at = now() where id = $1`, [actionRow.id]);
        skipped++;
        if ((await advanceEnrollment(enrollment, steps, now)) === "completed") completed++;
        continue;
      }

      if (step.requires_approval) {
        // PAUSE here - do NOT advance. The message has not been sent yet;
        // advancing now would silently skip a step that's supposed to be
        // gated on a human decision. POST /follow-up/actions/:id/approve
        // executes the action and resumes the enrollment.
        await q(`update follow_up_actions set status = 'awaiting_approval' where id = $1`, [actionRow.id]);
        await q(
          `update follow_up_enrollments set status = 'paused', stop_reason = 'awaiting approval on step' where id = $1`,
          [enrollment.id],
        );
        awaitingApproval++;
        continue;
      }

      const { ok, failureReason } = await executeStepAction(step, workflow, enrollment.context_type, enrollment.context_id, record);
      await q(`update follow_up_actions set status = $2, executed_at = now(), failure_reason = $3 where id = $1`, [
        actionRow.id,
        ok ? "sent" : "failed",
        failureReason,
      ]);
      if (ok) sent++; else failed++;

      const outcome = await advanceEnrollment(enrollment, steps, now);
      if (outcome === "completed") completed++;
    } catch (e: any) {
      failed++;
      await q(`update follow_up_enrollments set status = 'stopped', stop_reason = $2 where id = $1`, [
        enrollment.id,
        `processing error: ${e?.message ?? "unknown"}`,
      ]).catch(() => {});
    }
  }

  return { processed: due.length, sent, skipped, awaitingApproval, completed, failed };
}

// ---- POST /follow-up/process-due (admin) -----------------------------------
router.post(
  "/process-due",
  requireAdmin,
  h(async (_req, res) => {
    const result = await processDueFollowUps();
    res.json(result);
  }),
);

// ---- POST /follow-up/actions/:id/approve -------------------------------------
// Executes an action that was gated by requires_approval, then resumes the
// enrollment (advancing to the next step, or completing it).
router.post(
  "/actions/:id/approve",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const action = await q1<any>(`select * from follow_up_actions where id = $1`, [req.params.id]);
    if (!action) throw new NotFoundError("action not found");
    if (action.status !== "awaiting_approval") {
      return res.status(400).json({ error: `action is ${action.status}, not awaiting_approval` });
    }
    const enrollment = await q1<any>(`select * from follow_up_enrollments where id = $1`, [action.enrollment_id]);
    if (!enrollment) throw new NotFoundError("enrollment not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, enrollment.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }

    const workflow = await q1<any>(`select * from follow_up_workflows where id = $1`, [enrollment.workflow_id]);
    const steps = await q<any>(`select * from follow_up_steps where workflow_id = $1 order by step_order asc`, [enrollment.workflow_id]);
    const step = await q1<any>(`select * from follow_up_steps where id = $1`, [action.step_id]);
    const record = await loadContextRecord(enrollment.context_type, enrollment.context_id);
    if (!record || !step) {
      return res.status(400).json({ error: "linked record or step no longer exists" });
    }

    const { ok, failureReason } = await executeStepAction(step, workflow, enrollment.context_type, enrollment.context_id, record);
    await q(
      `update follow_up_actions set status = $2, executed_at = now(), approved_by = $3, failure_reason = $4 where id = $1`,
      [action.id, ok ? "sent" : "failed", auth.userId, failureReason],
    );
    await q(`update follow_up_enrollments set status = 'active' where id = $1`, [enrollment.id]);
    await advanceEnrollment(enrollment, steps, new Date());

    res.json({ ok, failureReason });
  }),
);

export default router;
