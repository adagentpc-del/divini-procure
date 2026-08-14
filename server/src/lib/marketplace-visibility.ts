/**
 * Phase 0 item 20: server-side enforcement for packages.visibility
 * (db/schema-marketplace-publication.sql), matching the labels a developer
 * actually picks when publishing ("Qualified Vendors Only", "Divini
 * Verified Only", etc). Before this, db.ts's getOpenPackages() filtered
 * the visibility COLUMN's allowed values into the query but never checked
 * whether the CALLER actually qualified for the tier they were about to
 * see, and getPackage() (GET /packages/:id) had no visibility check at
 * all - any authenticated user could read any package by id regardless of
 * visibility, including 'private_draft'. The labels existed; nothing
 * server-side ever enforced them.
 *
 * "Qualified" / "Divini Verified" are defined from the ONE verification
 * signal that actually exists in this schema - vendor_profiles.verify_status
 * ('pending' | 'ai-verified' | 'approved' | 'flagged', see schema-rls.sql's
 * own comment describing 'approved' as the public "verified" badge):
 *   - qualified_vendors: verify_status IN ('ai-verified', 'approved') -
 *     passed at least automated verification.
 *   - divini_verified:   verify_status = 'approved' only - the highest,
 *     human-reviewed tier.
 * No new qualification concept was invented; this is the closest honest
 * mapping onto what the product already tracks.
 *
 * Zero em dashes by convention.
 */
import { q1 } from "../pool.js";

export interface ViewerContext {
  userId: string | null;
  isAdmin: boolean;
}

/** The visibility values a public/vendor-facing marketplace BROWSE ever surfaces. */
export const BROWSABLE_VISIBILITIES = ["public_marketplace", "qualified_vendors", "divini_verified"] as const;

/**
 * The subset of BROWSABLE_VISIBILITIES the caller is actually allowed to
 * see, given their OWN vendor company's verify_status (the best one across
 * every company they belong to, if they belong to more than one vendor
 * company). Admins get every browsable tier. A caller with no vendor
 * company at all (a pure developer/buyer, or an unauthenticated/anonymous
 * caller) only ever gets 'public_marketplace' - the qualified/verified
 * tiers are specifically a VENDOR eligibility bar.
 */
export async function allowedBrowseVisibilities(viewer: ViewerContext): Promise<string[]> {
  if (viewer.isAdmin) return [...BROWSABLE_VISIBILITIES];
  if (!viewer.userId) return ["public_marketplace"];

  const best = await q1<{ verify_status: string | null }>(
    `select vp.verify_status
       from vendor_profiles vp
       join company_members cm on cm.company_id = vp.company_id
      where cm.user_id = $1
      order by case vp.verify_status when 'approved' then 3 when 'ai-verified' then 2 when 'pending' then 1 else 0 end desc
      limit 1`,
    [viewer.userId],
  );
  const status = best?.verify_status ?? null;
  if (status === "approved") return [...BROWSABLE_VISIBILITIES];
  if (status === "ai-verified") return ["public_marketplace", "qualified_vendors"];
  return ["public_marketplace"];
}

/**
 * Full single-package view authorization, for GET /packages/:id. Broader
 * than allowedBrowseVisibilities (which only covers the public browse
 * list): also allows the building's owning company (the developer who
 * created it, regardless of visibility - they must always be able to see
 * their own package) and any vendor with a real bid_invites row for this
 * exact package (the existing, legitimate distribution channel for the
 * restrictive tiers - organization_only/selected_team/invite_only/
 * preferred_vendors/private_group - surfaced today via GET
 * /intel/my-invites). 'private_draft' and 'hidden_scheduled' are visible
 * to the owner/admin only - nothing else, even an invited vendor, since
 * neither state means "published" yet.
 */
export async function canViewPackage(
  viewer: ViewerContext,
  pkg: { visibility: string | null; buildingCompanyId: string | null; id: string },
): Promise<boolean> {
  if (viewer.isAdmin) return true;
  if (!viewer.userId) return false;

  if (pkg.buildingCompanyId) {
    const owns = await q1(
      `select 1 from company_members where user_id = $1 and company_id = $2`,
      [viewer.userId, pkg.buildingCompanyId],
    );
    if (owns) return true;
  }

  const visibility = pkg.visibility ?? "public_marketplace";
  if (visibility === "private_draft" || visibility === "hidden_scheduled") return false;

  if ((BROWSABLE_VISIBILITIES as readonly string[]).includes(visibility)) {
    const allowed = await allowedBrowseVisibilities(viewer);
    return allowed.includes(visibility);
  }

  // organization_only / selected_team / invite_only / preferred_vendors /
  // private_group: distributed only via a real invite.
  const invited = await q1(
    `select 1 from bid_invites bi
       join company_members cm on cm.company_id = bi.vendor_company_id
      where bi.package_id = $1 and cm.user_id = $2`,
    [pkg.id, viewer.userId],
  );
  return !!invited;
}
