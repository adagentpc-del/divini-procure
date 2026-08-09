/**
 * Shared in-app notification fan-out helper for Phase 0's transactional
 * notifications (bid invite + award - see routes/intel.ts and
 * routes/award-workflow.ts). Mirrors the cross-tenant fan-out pattern
 * blueprint.ts's addendum-publish already established (see
 * lib/requestContext.ts's runAsAdmin() header comment): the caller has
 * already been authorized to act on the resource that triggers the
 * notification (invite-vendor / award confirm both check this before ever
 * calling in here), but reading ANOTHER company's company_members rows
 * needs an admin-equivalent context because company_members' own RLS
 * policy is deliberately narrowed to "your own row only".
 *
 * Best-effort by design: a failure here must never corrupt the caller's
 * own transaction or fail its response. Every call site awaits this AFTER
 * its own database work has already committed, and this function itself
 * never throws - it logs and returns an empty result instead.
 */
import { q } from "../pool.js";
import { runAsAdmin } from "./requestContext.js";

export interface NotifyResult {
  userId: string;
  email: string | null;
}

/**
 * Insert one notifications row per member of `companyId` and return the
 * member list (id + email) so the caller can also send a best-effort email
 * without a second cross-tenant company_members lookup.
 */
export async function notifyCompanyMembers(
  companyId: string,
  notification: { title: string; detail: string; kind: string },
): Promise<NotifyResult[]> {
  try {
    const members = await runAsAdmin(() =>
      q<{ user_id: string; email: string | null }>(
        `select cm.user_id, u.email
           from company_members cm
           join users u on u.id = cm.user_id
          where cm.company_id = $1`,
        [companyId],
      ),
    );
    if (members.length === 0) return [];

    await runAsAdmin(() =>
      q(
        `insert into notifications (user_id, title, detail, kind)
         select uid, $2, $3, $4 from unnest($1::text[]) as uid`,
        [members.map((m) => m.user_id), notification.title, notification.detail, notification.kind],
      ),
    );

    return members.map((m) => ({ userId: m.user_id, email: m.email }));
  } catch (e) {
    console.error("notifyCompanyMembers failed (non-fatal)", {
      companyId,
      kind: notification.kind,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
