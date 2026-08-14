/**
 * NATIVE session auth (replaces the retired Authentik OIDC verification).
 *
 * The SPA signs in with email + password against /api/auth/* and receives a
 * session JWT delivered as an httpOnly `divini_session` cookie AND (for clients
 * that prefer it) as a Bearer token. This module:
 *   1. Reads the session token from the cookie OR the Authorization header.
 *   2. Verifies it (HS256 / SESSION_SECRET) via lib/native-auth.
 *   3. Exposes `getAuth(req)` returning the SAME { userId, email, isAdmin }
 *      shape the rest of the app already depends on, so every existing route +
 *      requireUser / requireAdmin keeps working unchanged.
 *
 * isAdmin is computed from the verified email against ADMIN_ALLOWED_EMAILS.
 *
 * Zero em dashes by convention.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getAdminAllowedEmails, SESSION_COOKIE } from "./config.js";
import { verifySession, type SessionClaims } from "./lib/native-auth.js";
import { isSessionActive } from "./db.js";
import { runWithRequestContext } from "./lib/requestContext.js";
import { looksLikeApiKey, verifyApiKey, touchApiKeyLastUsed, type ApiKeyScope } from "./lib/api-keys.js";

export interface AuthResult {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  claims: SessionClaims | null;
  /** Set only when this request authenticated via an API key (developer
   * platform, competitive gap closure) rather than a session cookie/JWT.
   * Every route continues to see the SAME userId/email/isAdmin either
   * way - a key authenticates as its creating user, nothing more - this
   * is only present so requireScope() below can enforce the key's own
   * optional read/write narrowing. */
  apiKey: { id: string; scopes: ApiKeyScope[] } | null;
}

const EMPTY_AUTH: AuthResult = { userId: null, email: null, isAdmin: false, claims: null, apiKey: null };
const AUTH_KEY = Symbol.for("divini.procure.session.auth");

interface AuthedRequest extends Request {
  [AUTH_KEY]?: AuthResult;
}

/** Parse a single cookie value from the Cookie header (no cookie-parser dep). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function bearer(req: Request): string | null {
  const header = (req.headers.authorization as string | undefined) ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** The session token from cookie first, then Authorization Bearer. */
function sessionToken(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE) ?? bearer(req);
}

function computeIsAdmin(email: string | null): boolean {
  if (!email) return false;
  return getAdminAllowedEmails().includes(email.toLowerCase());
}

async function verify(token: string | null): Promise<AuthResult> {
  const claims = await verifySession(token);
  if (!claims) return EMPTY_AUTH;
  // Server-side revocation check: the jti must exist in user_sessions.
  // If the user logged out, revokeSession() deleted the row and this returns false.
  const active = await isSessionActive(claims.jti);
  if (!active) return EMPTY_AUTH;
  return {
    userId: claims.sub,
    email: claims.email,
    isAdmin: computeIsAdmin(claims.email),
    claims,
    apiKey: null,
  };
}

/**
 * Developer API platform: an Authorization: Bearer token in our key
 * format (dvp_live_...) authenticates via api_keys instead of a session
 * JWT. Returns EMPTY_AUTH for a token that looks like a key but doesn't
 * verify (revoked/unknown) - same "just unauthenticated" shape verify()
 * already uses for a bad session token, never a distinct error path an
 * attacker could use to distinguish "wrong key" from "no key".
 */
async function verifyApiKeyBearer(rawKey: string): Promise<AuthResult> {
  const result = await verifyApiKey(rawKey);
  if (!result) return EMPTY_AUTH;
  touchApiKeyLastUsed(result.apiKeyId);
  return {
    userId: result.userId,
    email: result.email,
    isAdmin: computeIsAdmin(result.email),
    claims: null,
    apiKey: { id: result.apiKeyId, scopes: result.scopes },
  };
}

/**
 * Express middleware: verify the session once, stash on req, and establish
 * the AsyncLocalStorage request context (see lib/requestContext.ts) that
 * pool.ts's q()/q1() read on every query for Row-Level Security. Always
 * calls next() - never blocks a request, even on a verification error
 * (routes that need a user still reject via requireUser downstream).
 */
export function authMiddleware(): RequestHandler {
  return async function sessionAuthMw(req: AuthedRequest, _res: Response, next: NextFunction) {
    let auth: AuthResult;
    try {
      const bearerToken = bearer(req);
      if (bearerToken && looksLikeApiKey(bearerToken)) {
        auth = await verifyApiKeyBearer(bearerToken);
      } else {
        auth = await verify(sessionToken(req));
      }
    } catch (e) {
      // verify() itself already treats an invalid/expired/malformed token as
      // a normal, silent "not logged in" (returns EMPTY_AUTH, never throws)
      // - so reaching this catch means something genuinely unexpected broke
      // (e.g. the session-revocation DB check itself failed). That is a
      // security-relevant failure mode - every request platform-wide would
      // silently start looking logged-out - and must never go unlogged.
      console.error("[auth] session verification threw unexpectedly, treating request as unauthenticated", {
        path: req.path,
        error: e instanceof Error ? e.message : String(e),
      });
      auth = EMPTY_AUTH;
    }
    req[AUTH_KEY] = auth;
    runWithRequestContext({ userId: auth.userId, isAdmin: auth.isAdmin, email: auth.email }, () => next());
  };
}

export function getAuth(req: Request): AuthResult {
  return (req as AuthedRequest)[AUTH_KEY] ?? EMPTY_AUTH;
}

/** Guard: require a signed-in user. 401 otherwise. */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Guard: require an admin (ADMIN_ALLOWED_EMAILS). 403 otherwise. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!auth.isAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

/**
 * Global write-scope gate for the developer API platform: a request
 * authenticated via an API key whose scopes don't include 'write' may
 * only make safe (GET/HEAD/OPTIONS) requests. A session-cookie/JWT
 * request (apiKey === null) is entirely unaffected - this only narrows
 * what a KEY can do, never what a logged-in browser session can do.
 * Applied globally in app.ts so a read-only key is enforced platform-
 * wide without every route needing to remember to check it.
 */
export function requireApiKeyWriteScope(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const safeMethod = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  if (auth.apiKey && !safeMethod && !auth.apiKey.scopes.includes("write")) {
    res.status(403).json({ error: "this API key does not have write scope" });
    return;
  }
  next();
}
