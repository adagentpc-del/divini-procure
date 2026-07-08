/**
 * Plan-limit enforcement at create-time for Divini Procure.
 *
 * Turns subscription tier limits into a real, monetizable upgrade reason: when a
 * company is at or over its plan limit for a metered resource, the create is
 * BLOCKED with a clear "upgrade your plan" message. When under the limit (or the
 * limit is NULL = unlimited) the create proceeds.
 *
 * PlanLimitError extends ForbiddenError so the existing routes.ts errorHandler
 * maps it to HTTP 403 and surfaces its message (which carries the upgrade text).
 * It also exposes machine-readable `code` and `upgrade` fields for the frontend.
 *
 * Reuses the single source of truth in entitlements.ts (checkLimit). Integer
 * counts only. Zero em dashes by convention.
 */
import { ForbiddenError } from "../db.js";
import { checkLimit, type LimitKey } from "./entitlements.js";

/** Friendly noun for each limit key, used in the upgrade message. */
const LIMIT_NOUNS: Record<LimitKey, string> = {
  active_project_limit: "active projects",
  bid_package_limit: "bid packages",
  vendor_invite_limit: "vendor invites",
  investment_program_limit: "investment programs",
  investor_match_limit: "investor matches",
  seat_limit: "seats",
};

export interface PlanLimitUpgrade {
  limitKey: LimitKey;
  limit: number;
  used: number;
}

/**
 * Thrown when a create is blocked by a plan limit. Extends ForbiddenError so it
 * is caught by routes.ts and returned as HTTP 403 with the message below.
 */
export class PlanLimitError extends ForbiddenError {
  code = "plan_limit" as const;
  upgrade: PlanLimitUpgrade;
  constructor(message: string, upgrade: PlanLimitUpgrade) {
    super(message);
    this.name = "PlanLimitError";
    this.upgrade = upgrade;
  }
}

/**
 * Enforce a single plan limit for a company before a create.
 *
 * Reads checkLimit(companyId, limitKey) from entitlements.ts (which synthesizes
 * a free-tier default when no entitlement row exists and defensively degrades
 * usage to 0 on any error). If NOT allowed, throws PlanLimitError. If allowed
 * (or unlimited), returns. Only PlanLimitError is ever thrown.
 */
export async function enforceLimit(companyId: string, limitKey: LimitKey): Promise<void> {
  const check = await checkLimit(companyId, limitKey);
  // NULL limit = unlimited: checkLimit returns allowed=true, nothing to do.
  if (check.allowed) return;
  const limit = check.limit ?? 0;
  const used = check.used ?? 0;
  const noun = LIMIT_NOUNS[limitKey] ?? "items";
  const message = `Your plan allows ${limit} ${noun}; you have used ${used}. Upgrade your plan to add more.`;
  throw new PlanLimitError(message, { limitKey, limit, used });
}
