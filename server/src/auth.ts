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

export interface AuthResult {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  claims: SessionClaims | null;
}

const EMPTY_AUTH: AuthResult = { userId: null, email: null, isAdmin: false, claims: null };
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
  };
}

/** Express middleware: verify the session once, stash on req. Always next(). */
export function authMiddleware(): RequestHandler {
  return async function sessionAuthMw(req: AuthedRequest, _res: Response, next: NextFunction) {
    try {
      req[AUTH_KEY] = await verify(sessionToken(req));
    } catch {
      req[AUTH_KEY] = EMPTY_AUTH;
    }
    next();
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
