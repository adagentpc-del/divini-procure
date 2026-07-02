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

function clientIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.socket.remoteAddress || "unknown";
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
 * Tight limiter for the auth surface (login, register, forgot, resend, verify):
 * 20 requests per IP per minute. Applied ahead of the auth router in app.ts.
 */
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 20 });
