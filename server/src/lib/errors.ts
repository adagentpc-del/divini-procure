/**
 * Shared HTTP error classes. Kept dependency-free and separate from db.ts
 * on purpose: db.ts and lib/entitlement-guard.ts both need these, and
 * entitlement-guard.ts also gets imported BY db.ts (PlanLimitError,
 * enforceLimit) - defining these classes in db.ts created a circular
 * import where PlanLimitError extends ForbiddenError at module-evaluation
 * time, before db.ts had finished evaluating far enough to define
 * ForbiddenError. That's a TDZ crash on every real (non-typecheck-only)
 * server startup, not just a lint nit.
 */
export class ForbiddenError extends Error {
  status = 403;
  constructor(msg = "forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  status = 404;
  constructor(msg = "not found") {
    super(msg);
    this.name = "NotFoundError";
  }
}
