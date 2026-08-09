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
/**
 * A caller-facing 400: valid request shape, but the operation is not legal
 * right now (e.g. "revision is already declined", "this bid has already
 * been awarded"). Distinct from a plain malformed-input 400 that a route
 * would normally just `return res.status(400)` for directly - this class
 * exists specifically so financial write paths that must run INSIDE a
 * withTransaction() callback (pool.ts) can throw to trigger a rollback and
 * still have the error handler below map it to 400, not the generic 500
 * every other uncaught throw becomes.
 */
export class ValidationError extends Error {
  status = 400;
  constructor(msg = "invalid request") {
    super(msg);
    this.name = "ValidationError";
  }
}
