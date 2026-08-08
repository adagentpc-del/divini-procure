/**
 * Per-request identity context, propagated to the database layer for Row-
 * Level Security (see db/schema-rls.sql and pool.ts's q()/q1()).
 *
 * Uses node:async_hooks AsyncLocalStorage so every db.ts function keeps its
 * existing signature - no call site needs to thread userId through 150+
 * query calls. authMiddleware sets this once per request, right after it
 * resolves the session; every q()/q1() call made anywhere during that
 * request's handling reads it back automatically.
 *
 * Outside of a request (background jobs: the follow-up processor, the
 * marketplace-publication scheduler, one-off scripts), there is no context.
 * Those jobs are trusted server-internal batch processes that already
 * operate across every tenant by design, so pool.ts treats a missing
 * context as admin-equivalent for RLS purposes - not as "no user," which
 * would make every RLS-protected table invisible to them and silently
 * break them. This mirrors their existing behavior (they already query
 * across all companies unrestricted today); RLS does not change what they
 * can see, only what a compromised or buggy *user-facing* route can see.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userId: string | null;
  isAdmin: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
