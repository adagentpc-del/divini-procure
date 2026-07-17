/**
 * Lightweight in-memory per-IP fixed-window rate limiter (no dependencies).
 *
 * Single-process only: counters live in this process's memory and are NOT shared
 * across replicas. It is a courtesy throttle to blunt credential-stuffing and
 * email-bomb abuse on the auth endpoints, not DDoS protection. For multi-replica
 * production, front it with an edge/WAF limiter or a shared store. Zero em dashes.
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

/**
 * Return the client IP using Express's already-processed req.ip.
 * Express normalises the X-Forwarded-For chain according to the `trust proxy`
 * setting in app.ts (`trust proxy: 1`), so req.ip is the correct client IP
 * and cannot be spoofed by injecting extra values into the XFF header.
 * Reading the raw XFF header here would bypass that protection.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Build a fixed-window limiter middleware. `max` requests per `windowMs` per IP.
 * Returns 429 with a Retry-After header when the window is exceeded.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const { windowMs, max } = opts;
  const buckets = new Map<string, Bucket>();

  // Opportunistic sweep so the map cannot grow without bound.
  function sweep(now: number) {
    if (buckets.size < 5000) return;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  return function rateLimitMw(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    sweep(now);
    const ip = clientIp(req);
    let b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySec));
      return res.status(429).json({ error: "Too many requests. Please slow down and try again." });
    }
    next();
  };
}

/**
 * Global auth-surface limiter: 20 requests per IP per minute.
 * Applied ahead of the entire auth router in app.ts.
 */
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 20 });

/**
 * Strict limiter for login: 5 attempts per IP per 15 minutes.
 * Prevents credential-stuffing without a full account-lockout mechanism.
 * Apply per-route, BEFORE the handler.
 */
export const loginRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 5 });

/**
 * Strict limiter for register: 10 attempts per IP per 15 minutes.
 * Prevents an attacker from repeatedly overwriting a victim's verify token.
 */
export const registerRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });

/**
 * Strict limiter for forgot-password and resend-verification: 5 per IP per hour.
 * Prevents email bombing and token regeneration loops.
 */
export const forgotRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5 });

/**
 * Strict limiter for resend-verification: 5 per IP per hour.
 */
export const resendVerifyRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5 });

/**
 * LLM endpoint limiter: 30 requests per authenticated user per hour.
 *
 * Each LLM call can take 15-20 seconds and costs real compute. This prevents
 * a single user from flooding the inference backend and running up costs.
 * Applied per userId (not IP) so VPN users don't share a bucket.
 *
 * Falls back to IP when no userId is available (unauthenticated calls should
 * never reach LLM endpoints, but this provides defense in depth).
 */
export function llmRateLimit(opts: { max?: number; windowMs?: number } = {}) {
  const { max = 30, windowMs = 60 * 60_000 } = opts;
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    if (buckets.size < 5000) return;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  return function llmRateLimitMw(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    sweep(now);
    // Key on userId when available (set by requireUser); fallback to IP.
    const key: string = (req as any).userId ?? clientIp(req);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySec));
      return res.status(429).json({ error: "LLM rate limit exceeded. Please try again later." });
    }
    next();
  };
}
