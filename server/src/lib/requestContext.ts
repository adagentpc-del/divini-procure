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
  /**
   * The verified session email (server-derived from the session JWT in
   * auth.ts, never client-supplied) - propagated to Postgres as
   * app.user_email so RLS policies can match it against columns like
   * agreements.counterparty_email, the same trust model the app layer
   * already uses (see agreements.ts's isCounterparty()).
   */
  email: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Run fn() with an admin-equivalent RLS context for THIS request, even
 * though authMiddleware already established a real (non-admin) one for it.
 *
 * Two real code paths need this, both discovered live during Section 06
 * testing, not written speculatively:
 *   - The Stripe webhook handler (routes/subscriptions.ts): authenticity is
 *     already verified via the Stripe signature before any DB write runs,
 *     but the request still passed through authMiddleware with no user
 *     session, so its context is {userId: null, isAdmin: false} - NOT the
 *     same as a truly absent context (a setInterval background job, which
 *     never entered Express's request pipeline at all and so gets treated
 *     as admin-equivalent by pool.ts automatically). Without this, the
 *     webhook's `insert into subscription_entitlements` hard-fails RLS on
 *     every real checkout completion.
 *   - Cross-tenant fan-out notifications already gated by an app-layer
 *     ownership check before they run (e.g. blueprint.ts's addendum-publish
 *     notifying every bidding vendor company's members - authorizeAddendum
 *     already confirmed the caller owns the addendum's own organization
 *     before this runs). The company_members lookup needs to see OTHER
 *     users' rows, which company_members' own RLS policy (deliberately
 *     narrowed to "your own row only" - see db/schema-rls.sql's comment on
 *     why) cannot provide from the acting user's own restricted context.
 *
 * Use this ONLY for a block of code that is already fully authorized by
 * something upstream (a verified signature, an explicit ownership check) -
 * never to route around an authorization decision RLS should actually be
 * enforcing.
 */
export function runAsAdmin<T>(fn: () => T): T {
  const ctx = getRequestContext();
  return runWithRequestContext({ userId: ctx?.userId ?? null, isAdmin: true, email: ctx?.email ?? null }, fn);
}
