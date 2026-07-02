/**
 * Divini Procure - MESSAGING BOUNDARIES policy (pure, no IO).
 *
 * Single source of truth for "may role A message role B". The marketplace has
 * hard boundaries so the platform stays the broker of record:
 *   - developer <-> vendor          allowed (the core procurement relationship)
 *   - admin     <-> everyone        allowed (platform operator)
 *   - developer <-> investor        allowed ONLY when an introduction is approved
 *   - vendor    <-> investor        blocked (no direct channel)
 *   - designer/gc <-> vendor        allowed ONLY when explicitly permissioned on
 *                                    the project
 *   - everything else               denied by default
 *
 * Roles are intentionally small: developer | vendor | investor | admin |
 * designer | gc. canMessage is symmetric in spirit but evaluated directionally
 * so callers can pass fromRole/toRole as they appear in a thread.
 *
 * Zero em dashes by convention.
 */

export const MESSAGING_ROLES = [
  "developer",
  "vendor",
  "investor",
  "admin",
  "designer",
  "gc",
] as const;
export type MessagingRole = (typeof MESSAGING_ROLES)[number];

export interface MessagingContext {
  /** True when an investor introduction request has been approved/made. */
  introApproved?: boolean;
  /** True when a designer/gc has been permissioned to a vendor on a project. */
  permissioned?: boolean;
}

export interface MessagingDecision {
  allowed: boolean;
  reason: string;
}

function pair(a: MessagingRole, b: MessagingRole, x: string, y: string): boolean {
  return (a === x && b === y) || (a === y && b === x);
}

/**
 * Resolve whether `fromRole` may message `toRole` in the given context.
 * Pure and deterministic; default is deny.
 */
export function canMessage(
  fromRole: MessagingRole | string,
  toRole: MessagingRole | string,
  context: MessagingContext = {},
): MessagingDecision {
  const a = String(fromRole) as MessagingRole;
  const b = String(toRole) as MessagingRole;

  if (!MESSAGING_ROLES.includes(a) || !MESSAGING_ROLES.includes(b)) {
    return { allowed: false, reason: "Unknown role. Messaging is denied by default." };
  }

  if (a === b) {
    // Same role talking to same role (e.g. admin to admin) is allowed.
    if (a === "admin") {
      return { allowed: true, reason: "Admins may message anyone." };
    }
    return { allowed: true, reason: "Same-role messaging is allowed." };
  }

  // Admin can message everyone, and everyone may reply to admin.
  if (a === "admin" || b === "admin") {
    return { allowed: true, reason: "Admins may message anyone, and anyone may message an admin." };
  }

  // Core procurement channel.
  if (pair(a, b, "developer", "vendor")) {
    return { allowed: true, reason: "Developers and vendors may message about procurement." };
  }

  // Investor introductions are gated by an approved introduction.
  if (pair(a, b, "developer", "investor")) {
    if (context.introApproved === true) {
      return { allowed: true, reason: "Introduction approved. Developer and investor may message." };
    }
    return {
      allowed: false,
      reason: "Developer and investor messaging requires an approved introduction.",
    };
  }

  // Vendors and investors have no direct channel.
  if (pair(a, b, "vendor", "investor")) {
    return { allowed: false, reason: "Vendors and investors may not message directly." };
  }

  // Designers / general contractors may reach vendors only when permissioned.
  if (pair(a, b, "designer", "vendor") || pair(a, b, "gc", "vendor")) {
    if (context.permissioned === true) {
      return {
        allowed: true,
        reason: "Permissioned on the project. Designer/GC and vendor may message.",
      };
    }
    return {
      allowed: false,
      reason: "Designer/GC must be permissioned on the project to message a vendor.",
    };
  }

  return { allowed: false, reason: "No messaging channel exists between these roles." };
}

/**
 * Human-readable description of the policy for display in the SPA. Each row is a
 * directional-agnostic pair plus the rule that governs it.
 */
export interface MessagingMatrixRow {
  from: MessagingRole;
  to: MessagingRole;
  status: "allowed" | "conditional" | "blocked";
  rule: string;
}

export const MESSAGING_MATRIX: MessagingMatrixRow[] = [
  { from: "developer", to: "vendor", status: "allowed", rule: "Open. The core procurement relationship." },
  { from: "admin", to: "developer", status: "allowed", rule: "Admins may message anyone." },
  { from: "admin", to: "vendor", status: "allowed", rule: "Admins may message anyone." },
  { from: "admin", to: "investor", status: "allowed", rule: "Admins may message anyone." },
  { from: "admin", to: "designer", status: "allowed", rule: "Admins may message anyone." },
  { from: "admin", to: "gc", status: "allowed", rule: "Admins may message anyone." },
  {
    from: "developer",
    to: "investor",
    status: "conditional",
    rule: "Allowed only after an introduction is approved.",
  },
  {
    from: "investor",
    to: "developer",
    status: "conditional",
    rule: "Allowed only after an introduction is approved.",
  },
  { from: "vendor", to: "investor", status: "blocked", rule: "No direct channel." },
  {
    from: "designer",
    to: "vendor",
    status: "conditional",
    rule: "Allowed only when permissioned on the project.",
  },
  {
    from: "gc",
    to: "vendor",
    status: "conditional",
    rule: "Allowed only when permissioned on the project.",
  },
];
