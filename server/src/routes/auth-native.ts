/**
 * Native email/password auth for Divini Procure (mounted at /api/auth).
 *
 * Replaces Authentik OIDC. Endpoints:
 *   POST /auth/register             { email, password, passwordConfirm } -> { ok, needsVerification }
 *   GET  /auth/verify?token=        -> verify email, issue session, { user, isAdmin }
 *   POST /auth/verify               { token }    (same as GET)
 *   POST /auth/resend-verification  { email }    -> always { ok: true }
 *   POST /auth/login                { email, password } -> issue session, { user, isAdmin }
 *   POST /auth/logout               -> clears the session cookie
 *   GET  /auth/me                   -> { user, isAdmin, company } (matches /api/me)
 *   POST /auth/forgot               { email }    -> always { ok: true }
 *   POST /auth/reset                { token, password, passwordConfirm } -> issue session
 *   POST /auth/transfer-ownership   { companyId, newEmail } (owner/admin) -> { ok }
 *
 * The session is delivered as an httpOnly Secure SameSite=Lax cookie
 * `divini_session`. The token is NOT returned in the response body to prevent
 * leakage via logs, XSS, or JS access. Use the cookie for all authenticated
 * requests. Generic errors on auth failure.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { getAuth, requireUser } from "../auth.js";
import { loginRateLimit, registerRateLimit } from "../lib/rateLimit.js";
import * as db from "../db.js";
import { sendEmail } from "../lib/email.js";
import {
  hashPassword,
  verifyPassword,
  signSession,
  randomToken,
  isValidEmail,
  normalizeEmail,
} from "../lib/native-auth.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  VERIFY_TTL_MS,
  RESET_TTL_MS,
  PUBLIC_APP_URL,
  IS_PROD,
} from "../config.js";
import { createSession, revokeSession } from "../db.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// cookie helpers (no cookie-parser dependency)
// ---------------------------------------------------------------------------
function setSessionCookie(res: Response, token: string): void {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  // Always set Secure in production. In development, omit it so cookies work
  // over http://localhost without requiring HTTPS.
  if (IS_PROD) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res: Response): void {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (IS_PROD) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

// ---------------------------------------------------------------------------
// email senders
// ---------------------------------------------------------------------------
function appUrl(path: string): string {
  const base = PUBLIC_APP_URL || "https://diviniprocure.com";
  return `${base}${path}`;
}

async function sendVerifyEmail(email: string, token: string): Promise<void> {
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: "Verify your Divini Procure email",
    text:
      `Welcome to Divini Procure.\n\n` +
      `Please confirm your email address to activate your account:\n\n` +
      `${link}\n\n` +
      `This link expires in 24 hours. If you did not create this account you can ignore this email.`,
  });
}

async function sendClaimEmail(email: string, token: string, companyName: string | null): Promise<void> {
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  const who = companyName ? ` for ${companyName}` : "";
  await sendEmail({
    to: email,
    subject: "You now control a Divini Procure company",
    text:
      `You have been made the owner of a company on Divini Procure${who}.\n\n` +
      `Confirm your email and set your password to take over the account:\n\n` +
      `${link}\n\n` +
      `This link expires in 24 hours.`,
  });
}

async function sendResetEmail(email: string, token: string): Promise<void> {
  const link = appUrl(`/reset?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: "Reset your Divini Procure password",
    text:
      `We received a request to reset your Divini Procure password.\n\n` +
      `Set a new password here:\n\n` +
      `${link}\n\n` +
      `This link expires in 1 hour. If you did not request this you can ignore this email.`,
  });
}

// ---------------------------------------------------------------------------
// shared: issue a session for a user + return the standard payload
// ---------------------------------------------------------------------------
async function issueSessionResponse(res: Response, user: db.UserRow): Promise<void> {
  const { token, jti } = await signSession(user.id, user.email);
  // Persist the session so it can be truly revoked on logout.
  await createSession(jti, user.id, user.email, SESSION_TTL_SECONDS);
  setSessionCookie(res, token);
  const company = await db.getMyCompany(user.id);
  const isAdmin = db.isAdminEmail(user.email);
  // Token is set as an httpOnly cookie only - never returned in the response
  // body to prevent exposure via XSS, browser history, or server logs.
  res.json({
    user: { id: user.id, email: user.email },
    isAdmin,
    company: company ?? null,
  });
}

// ===========================================================================
// REGISTER
// ===========================================================================
router.post(
  "/auth/register",
  registerRateLimit,
  h(async (req, res) => {
    const { email, password, passwordConfirm } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      passwordConfirm?: string;
    };
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const normEmail = normalizeEmail(email);
    const passwordHash = await hashPassword(password);
    const verifyToken = randomToken();
    const verifyExpires = new Date(Date.now() + VERIFY_TTL_MS);

    await db.upsertUserForRegistration({
      newUserId: randomUUID(),
      email: normEmail,
      passwordHash,
      verifyToken,
      verifyExpires,
    });

    await sendVerifyEmail(normEmail, verifyToken);
    // No session until verified.
    res.json({ ok: true, needsVerification: true });
  }),
);

// ===========================================================================
// VERIFY EMAIL (GET + POST)
// ===========================================================================
async function handleVerify(req: Request, res: Response): Promise<void> {
  const token =
    (req.method === "GET" ? (req.query.token as string | undefined) : (req.body?.token as string | undefined)) ??
    "";
  if (!token) {
    res.status(400).json({ error: "Missing verification token." });
    return;
  }
  const user = await db.getUserByVerifyToken(token);
  if (!user || !user.verify_expires || new Date(user.verify_expires).getTime() < Date.now()) {
    res.status(400).json({ error: "This verification link is invalid or has expired." });
    return;
  }
  const verified = await db.markEmailVerified(user.id);
  if (!verified) {
    res.status(400).json({ error: "Could not verify this account." });
    return;
  }
  await issueSessionResponse(res, verified);
}

router.get("/auth/verify", h(handleVerify));
router.post("/auth/verify", h(handleVerify));

// ===========================================================================
// RESEND VERIFICATION (always 200 to avoid account enumeration)
// ===========================================================================
router.post(
  "/auth/resend-verification",
  h(async (req, res) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (isValidEmail(email)) {
      const user = await db.getUserByEmail(normalizeEmail(email));
      if (user && !user.email_verified) {
        const token = randomToken();
        await db.setVerifyToken(user.id, token, new Date(Date.now() + VERIFY_TTL_MS));
        await sendVerifyEmail(normalizeEmail(email), token);
      }
    }
    res.json({ ok: true });
  }),
);

// ===========================================================================
// LOGIN
// ===========================================================================
router.post(
  "/auth/login",
  loginRateLimit,
  h(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const GENERIC = "Incorrect email or password.";
    if (!isValidEmail(email) || typeof password !== "string" || !password) {
      return res.status(401).json({ error: GENERIC });
    }
    const user = await db.getUserByEmail(normalizeEmail(email));
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: GENERIC });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: "Please verify your email before signing in.", needsVerification: true });
    }
    await issueSessionResponse(res, user);
  }),
);

// ===========================================================================
// LOGOUT
// ===========================================================================
router.post(
  "/auth/logout",
  h(async (req, res) => {
    // Revoke the server-side session so the JWT cannot be replayed.
    const { getAuth } = await import("../auth.js");
    const auth = getAuth(req);
    if (auth.claims?.jti) {
      await revokeSession(auth.claims.jti);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

// ===========================================================================
// ME (matches the shape /api/me returns: { user, isAdmin, company })
// ===========================================================================
router.get(
  "/auth/me",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    await db.ensureUser(auth.userId!, auth.email);
    const company = await db.getMyCompany(auth.userId!);
    res.json({
      user: { id: auth.userId, email: auth.email },
      isAdmin: auth.isAdmin,
      company: company ?? null,
    });
  }),
);

// ===========================================================================
// FORGOT PASSWORD (always 200 to avoid account enumeration)
// ===========================================================================
router.post(
  "/auth/forgot",
  h(async (req, res) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (isValidEmail(email)) {
      const user = await db.getUserByEmail(normalizeEmail(email));
      if (user) {
        const token = randomToken();
        await db.setResetToken(user.id, token, new Date(Date.now() + RESET_TTL_MS));
        await sendResetEmail(normalizeEmail(email), token);
      }
    }
    res.json({ ok: true });
  }),
);

// ===========================================================================
// RESET PASSWORD
// ===========================================================================
router.post(
  "/auth/reset",
  h(async (req, res) => {
    const { token, password, passwordConfirm } = (req.body ?? {}) as {
      token?: string;
      password?: string;
      passwordConfirm?: string;
    };
    if (!token) {
      return res.status(400).json({ error: "Missing reset token." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: "Passwords do not match." });
    }
    const user = await db.getUserByResetToken(token);
    if (!user || !user.reset_expires || new Date(user.reset_expires).getTime() < Date.now()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }
    const passwordHash = await hashPassword(password);
    await db.applyPasswordReset(user.id, passwordHash);
    // Resetting the password also confirms control of the inbox, so a never
    // verified account becomes verified here and is logged straight in.
    let fresh = await db.getUserById(user.id);
    if (fresh && !fresh.email_verified) {
      fresh = await db.markEmailVerified(fresh.id);
    }
    await issueSessionResponse(res, fresh ?? user);
  }),
);

// ===========================================================================
// OWNER-EMAIL TRANSFER (owner/admin of the company)
// ===========================================================================
router.post(
  "/auth/transfer-ownership",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { companyId, newEmail } = (req.body ?? {}) as { companyId?: string; newEmail?: string };
    if (!companyId || typeof companyId !== "string") {
      return res.status(400).json({ error: "companyId required" });
    }
    if (!isValidEmail(newEmail)) {
      return res.status(400).json({ error: "Enter a valid new owner email address." });
    }
    const company = await db.getMyCompany(auth.userId!);
    const verifyToken = randomToken();
    const verifyExpires = new Date(Date.now() + VERIFY_TTL_MS);
    const { user } = await db.transferCompanyOwnerEmail({
      actingUserId: auth.userId!,
      companyId,
      newEmail: normalizeEmail(newEmail),
      newUserId: randomUUID(),
      verifyToken,
      verifyExpires,
    });
    await sendClaimEmail(normalizeEmail(newEmail), verifyToken, company?.name ?? null);
    res.json({ ok: true, newOwner: { id: user.id, email: user.email } });
  }),
);

export default router;
