import { createHash } from "node:crypto";

/**
 * Lightweight in-memory TTL cache (no dependencies), matching this
 * codebase's established hand-rolled-infra convention (see rateLimit.ts's
 * identical caveat).
 *
 * Single-process only: entries live in this process's memory and are NOT
 * shared across replicas. That is an acceptable ceiling for what this cache
 * is for - avoiding redundant expensive/costed work (an LLM call, a heavy
 * aggregate query) within one process's uptime, not a distributed cache
 * invalidation system. For multi-replica production, a shared store (Redis)
 * would tighten the hit rate but is not required for correctness: every
 * cached value here is either safely stale-tolerant for its TTL (an AI
 * narrative that only changes when its own inputs change) or the caller
 * derives the cache key from a content hash of those inputs, so a miss just
 * means "recompute," never "serve wrong data."
 *
 * NEVER use this for canonical financial data. Project/package financial
 * summaries (server/src/lib/financial-summary.ts) are deliberately computed
 * live from source on every read, by explicit design (see that file's own
 * header and docs/phase1-financial-spine-implementation.md section 2) - a
 * cached total that can silently drift from the real committed/paid amount
 * is exactly the failure mode Phase 1 was built to eliminate. This cache
 * exists for read-heavy, tolerant-of-staleness, or content-hash-keyed data:
 * AI-generated narratives, marketplace search results, and similar.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T = unknown> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly maxEntries: number;

  constructor(opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 5000;
  }

  private sweep(now: number): void {
    if (this.store.size < this.maxEntries) return;
    for (const [k, e] of this.store) if (e.expiresAt <= now) this.store.delete(k);
    // Still over budget after sweeping expired entries: evict the oldest
    // (Map preserves insertion order) rather than growing without bound.
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.sweep(now);
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Cache-aside helper: return the cached value, or compute, store, and return it. Never caches a rejected promise. */
  async getOrCompute(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }
}

/**
 * Deterministic short hash of arbitrary JSON-serializable input, for
 * building content-addressed cache keys (e.g. "narrative:${packageId}:
 * ${hashInput(bidsAndPrices)}") so a cache entry naturally invalidates the
 * moment its real inputs change, with no manual invalidation bookkeeping.
 */
export function hashInput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}
