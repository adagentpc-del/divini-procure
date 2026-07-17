/**
 * Native auth primitives for Divini Procure (replaces Authentik OIDC).
 *
 * SECURITY (identical contract to Divini Partners):
 *   - Passwords are hashed with node:crypto scrypt and stored as
 *     `scrypt$<saltHex>$<hashHex>` (16-byte random salt, 64-byte derived key).
 *     Verification uses timingSafeEqual. Plaintext is never stored or logged.
 *   - Sessions are jose HS256 JWTs signed with SESSION_SECRET, payload
 *     { sub: userId, email }, 30-day expiry.
 *
 * Zero em dashes by convention.
 */
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import {
  getSessionSecret,
  SESSION_TTL_SECONDS,
} from "../config.js";

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

// The pure scrypt hash/verify primitives live in the dependency-free module
// ./passwordHash.js and are re-exported here so this module's public API is
// unchanged. Importers keep using hashPassword/verifyPassword from native-auth.
export { hashPassword, verifyPassword } from "./passwordHash.js";

// ---------------------------------------------------------------------------
// Session JWTs (HS256)
// ---------------------------------------------------------------------------

export interface SessionClaims {
  sub: string;   // userId
  email: string | null;
  jti: string;   // JWT ID -- used for server-side revocation
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

/**
 * Sign a 30-day session token for a user.
 * Returns both the signed JWT and the jti so callers can persist the session.
 */
export async function signSession(
  userId: string,
  email: string | null,
): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({ email: email ?? null })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
  return { token, jti };
}

/**
 * Verify a session token cryptographically; returns its claims or null.
 * NOTE: callers must also check user_sessions to confirm the session has not
 * been revoked server-side (i.e. the user has not logged out).
 */
export async function verifySession(token: string | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const email = (payload.email as string | undefined) ?? null;
    const jti = payload.jti;
    if (!jti) return null; // reject legacy tokens without jti
    return {
      sub: String(payload.sub),
      email: email ? email.toLowerCase() : null,
      jti: String(jti),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tokens (verify / reset)
// ---------------------------------------------------------------------------

/** A 32-byte random hex token (used for email-verify and password-reset). */
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
