/**
 * Per-project access control for the Designer + GC role workspaces.
 *
 * A project is a `buildings` row; its DEVELOPER (owning) company is
 * buildings.company_id. Access to a project is granted to:
 *   1. ADMIN (full access everywhere), OR
 *   2. a member of the project's developer company (company_members), OR
 *   3. anyone holding a project_stakeholders row for that project whose email
 *      matches the caller (and, when `roles` is given, whose role is in that
 *      list).
 *
 * Tables live in db/schema-project-roles.sql. Zero em dashes by convention.
 */
import { q1 } from "../pool.js";

/**
 * True when the user may access the given project. When `roles` is supplied, a
 * stakeholder match additionally requires the stakeholder's role to be one of
 * them (developer membership and admin always pass regardless of `roles`).
 */
export async function canAccessProject(
  userId: string | null,
  email: string | null,
  projectId: string,
  roles?: string[],
  isAdmin = false,
): Promise<boolean> {
  if (isAdmin) return true;
  if (!projectId) return false;

  // 2. developer company member
  if (userId) {
    const owner = await q1(
      `select 1
         from buildings b
         join company_members m on m.company_id = b.company_id
        where b.id = $1 and m.user_id = $2`,
      [projectId, userId],
    );
    if (owner) return true;
  }

  // 3. project stakeholder matching email (and role, when constrained)
  if (email) {
    if (roles && roles.length) {
      const row = await q1(
        `select 1 from project_stakeholders
          where project_id = $1 and lower(email) = lower($2) and role = any($3::text[])`,
        [projectId, email, roles],
      );
      if (row) return true;
    } else {
      const row = await q1(
        `select 1 from project_stakeholders
          where project_id = $1 and lower(email) = lower($2)`,
        [projectId, email],
      );
      if (row) return true;
    }
  }

  return false;
}
