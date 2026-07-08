/**
 * Project Roles: Designer + GC workspaces for Divini Procure. Self-pathed;
 * mounted in routes.ts with `router.use(projectRolesRouter)` (NO extra prefix),
 * so the paths are /api/projects/:projectId/* and friends.
 *
 * A project is a `buildings` row owned by a DEVELOPER company (buildings.
 * company_id). A developer (member of that company) invites per-project
 * stakeholders by role and works the project; Designers and General Contractors
 * see and advance their own item workspaces. Access is gated by
 * lib/project-access.canAccessProject (developer member OR project stakeholder
 * matching email/role OR admin).
 *
 * Tables live in db/schema-project-roles.sql. Zero em dashes by convention.
 *
 * Endpoints (all requireUser):
 *   GET    /my-projects                              -> { projects: [{id,name,role}] }
 *   GET    /projects/:projectId/stakeholders         -> { stakeholders: [...] }
 *   POST   /projects/:projectId/stakeholders         -> { stakeholder }
 *   DELETE /project-stakeholders/:id                 -> { ok: true }
 *   GET    /projects/:projectId/designer-items       -> { items: [...] }
 *   POST   /projects/:projectId/designer-items       -> { item }
 *   PATCH  /designer-items/:id                        -> { item }
 *   GET    /projects/:projectId/gc-items             -> { items: [...] }
 *   POST   /projects/:projectId/gc-items             -> { item }
 *   PATCH  /gc-items/:id                              -> { item }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { canAccessProject } from "../lib/project-access.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const DESIGNER_KINDS = new Set([
  "finish_schedule",
  "sample",
  "substitution",
  "aesthetic_approval",
  "ffe_comment",
]);
const DESIGNER_STATUSES = new Set(["open", "in_review", "approved", "rejected", "closed"]);

const GC_KINDS = new Set([
  "install_requirement",
  "logistics",
  "dimension",
  "delivery_coordination",
  "license",
  "insurance",
  "field_conflict",
]);
const GC_STATUSES = new Set(["open", "in_progress", "resolved", "blocked", "closed"]);

const STAKEHOLDER_ROLES = new Set([
  "designer",
  "gc",
  "owner",
  "asset_manager",
  "procurement_manager",
  "read_only",
]);

/** True when the user is a member of the building's developer (owning) company. */
async function isDeveloperMember(userId: string | null, projectId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await q1(
    `select 1
       from buildings b
       join company_members m on m.company_id = b.company_id
      where b.id = $1 and m.user_id = $2`,
    [projectId, userId],
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// GET /my-projects -> projects the user is a developer member of OR a stakeholder
// in. Returns [{ id, name, role }] where role is 'developer' for owned projects
// or the stakeholder role otherwise.
// ---------------------------------------------------------------------------
router.get(
  "/my-projects",
  requireUser,
  h(async (req, res) => {
    const { userId, email } = getAuth(req);
    const rows = await q<{ id: string; name: string; role: string }>(
      `select b.id, b.name, 'developer'::text as role
         from buildings b
         join company_members m on m.company_id = b.company_id
        where m.user_id = $1
       union
       select b.id, b.name, s.role
         from project_stakeholders s
         join buildings b on b.id = s.project_id
        where lower(s.email) = lower($2)
        order by name asc`,
      [userId, email ?? ""],
    );
    res.json({ projects: rows });
  }),
);

// ---------------------------------------------------------------------------
// Stakeholders
// ---------------------------------------------------------------------------
router.get(
  "/projects/:projectId/stakeholders",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!(await canAccessProject(userId, email, projectId, undefined, isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const rows = await q(
      `select * from project_stakeholders where project_id = $1 order by created_at asc`,
      [projectId],
    );
    res.json({ stakeholders: rows });
  }),
);

router.post(
  "/projects/:projectId/stakeholders",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!isAdmin && !(await isDeveloperMember(userId, projectId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const inviteEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body.role === "string" ? body.role : "";
    const companyId = typeof body.companyId === "string" ? body.companyId : null;
    if (!inviteEmail) return res.status(400).json({ error: "email is required" });
    if (!STAKEHOLDER_ROLES.has(role)) return res.status(400).json({ error: "invalid role" });

    const row = await q1(
      `insert into project_stakeholders (project_id, company_id, email, role, invited_by)
            values ($1, $2, $3, $4, $5)
       on conflict (project_id, email, role) do update set company_id = excluded.company_id
        returning *`,
      [projectId, companyId, inviteEmail, role, email ?? userId ?? null],
    );
    res.json({ stakeholder: row });
  }),
);

router.delete(
  "/project-stakeholders/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, isAdmin } = getAuth(req);
    const row = await q1<{ project_id: string }>(
      `select project_id from project_stakeholders where id = $1`,
      [req.params.id],
    );
    if (!row) return res.status(404).json({ error: "not found" });
    if (!isAdmin && !(await isDeveloperMember(userId, row.project_id))) {
      return res.status(403).json({ error: "forbidden" });
    }
    await q(`delete from project_stakeholders where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Designer items (accessible to designer / owner roles + developer + admin)
// ---------------------------------------------------------------------------
router.get(
  "/projects/:projectId/designer-items",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!(await canAccessProject(userId, email, projectId, ["designer", "owner"], isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const rows = await q(
      `select * from designer_items where project_id = $1 order by created_at desc`,
      [projectId],
    );
    res.json({ items: rows });
  }),
);

router.post(
  "/projects/:projectId/designer-items",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!(await canAccessProject(userId, email, projectId, ["designer", "owner"], isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const detail = typeof body.detail === "string" ? body.detail : null;
    const link = typeof body.link === "string" ? body.link : null;
    if (!DESIGNER_KINDS.has(kind)) return res.status(400).json({ error: "invalid kind" });
    if (!title) return res.status(400).json({ error: "title is required" });

    const row = await q1(
      `insert into designer_items (project_id, kind, title, detail, link, created_by)
            values ($1, $2, $3, $4, $5, $6) returning *`,
      [projectId, kind, title, detail, link, email ?? userId ?? null],
    );
    res.json({ item: row });
  }),
);

router.patch(
  "/designer-items/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const existing = await q1<{ project_id: string }>(
      `select project_id from designer_items where id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "not found" });
    if (
      !(await canAccessProject(userId, email, existing.project_id, ["designer", "owner"], isAdmin))
    ) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (typeof body.status === "string") {
      if (!DESIGNER_STATUSES.has(body.status)) return res.status(400).json({ error: "invalid status" });
      sets.push(`status = $${i++}`);
      vals.push(body.status);
    }
    if (typeof body.title === "string") {
      sets.push(`title = $${i++}`);
      vals.push(body.title.trim());
    }
    if (typeof body.detail === "string") {
      sets.push(`detail = $${i++}`);
      vals.push(body.detail);
    }
    if (!sets.length) return res.status(400).json({ error: "nothing to update" });
    sets.push(`updated_at = now()`);
    vals.push(req.params.id);
    const row = await q1(
      `update designer_items set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );
    res.json({ item: row });
  }),
);

// ---------------------------------------------------------------------------
// GC items (accessible to gc / owner roles + developer + admin)
// ---------------------------------------------------------------------------
router.get(
  "/projects/:projectId/gc-items",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!(await canAccessProject(userId, email, projectId, ["gc", "owner"], isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const rows = await q(
      `select * from gc_items where project_id = $1 order by created_at desc`,
      [projectId],
    );
    res.json({ items: rows });
  }),
);

router.post(
  "/projects/:projectId/gc-items",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const projectId = req.params.projectId;
    if (!(await canAccessProject(userId, email, projectId, ["gc", "owner"], isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const detail = typeof body.detail === "string" ? body.detail : null;
    if (!GC_KINDS.has(kind)) return res.status(400).json({ error: "invalid kind" });
    if (!title) return res.status(400).json({ error: "title is required" });

    const row = await q1(
      `insert into gc_items (project_id, kind, title, detail, created_by)
            values ($1, $2, $3, $4, $5) returning *`,
      [projectId, kind, title, detail, email ?? userId ?? null],
    );
    res.json({ item: row });
  }),
);

router.patch(
  "/gc-items/:id",
  requireUser,
  h(async (req, res) => {
    const { userId, email, isAdmin } = getAuth(req);
    const existing = await q1<{ project_id: string }>(
      `select project_id from gc_items where id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "not found" });
    if (!(await canAccessProject(userId, email, existing.project_id, ["gc", "owner"], isAdmin))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (typeof body.status === "string") {
      if (!GC_STATUSES.has(body.status)) return res.status(400).json({ error: "invalid status" });
      sets.push(`status = $${i++}`);
      vals.push(body.status);
    }
    if (typeof body.title === "string") {
      sets.push(`title = $${i++}`);
      vals.push(body.title.trim());
    }
    if (typeof body.detail === "string") {
      sets.push(`detail = $${i++}`);
      vals.push(body.detail);
    }
    if (!sets.length) return res.status(400).json({ error: "nothing to update" });
    sets.push(`updated_at = now()`);
    vals.push(req.params.id);
    const row = await q1(`update gc_items set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ item: row });
  }),
);

export default router;
