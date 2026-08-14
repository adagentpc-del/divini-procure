/**
 * Server-side marketplace search (Phase 0 item 21).
 *
 * Modest, Postgres-native (pg_trgm-backed) search over open packages:
 * free-text query, category, and geography (building location) filters,
 * real pagination. Not semantic/vector search, not Elasticsearch - see
 * db/schema-marketplace-search.sql's header for why.
 *
 * Authorization runs BEFORE results are ever queried, reusing the exact
 * same allowedBrowseVisibilities() gate Phase 0 item 20 added to
 * db.ts's getOpenPackages() - this endpoint must never become a second,
 * unguarded path to the same data getOpenPackages now correctly scopes.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { allowedBrowseVisibilities } from "../lib/marketplace-visibility.js";
import { TtlCache, hashInput } from "../lib/cache.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

interface SearchResult {
  results: unknown[];
  total: number;
  limit: number;
  offset: number;
}

// Short TTL cache: absorbs repeated/duplicate identical searches under load
// (a debounced search box firing more than once, several users searching
// the same common term at the same time) without risking meaningfully
// stale listings - 30 seconds is short enough that a package closing or a
// new one publishing is never hidden/shown wrong for long. The cache key
// MUST include `allowed` (the caller's own visibility scope from
// allowedBrowseVisibilities()), not just the raw query params - two users
// with different visibility permissions must never share a cache entry, or
// this would become a cross-tenant data leak.
const searchCache = new TtlCache<SearchResult>();
const SEARCH_TTL_MS = 30_000;

router.get(
  "/marketplace/search",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const allowed = await allowedBrowseVisibilities({ userId: auth.userId, isAdmin: auth.isAdmin });

    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const categories = typeof req.query.categories === "string"
      ? req.query.categories.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    const location = typeof req.query.location === "string" ? req.query.location.trim().slice(0, 200) : "";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const conditions: string[] = [`p.status in ('open','shortlisting')`, `p.visibility = any($1::text[])`];
    const params: unknown[] = [allowed];

    if (query) {
      params.push(`%${query}%`);
      const i = params.length;
      conditions.push(`(b.name ilike $${i} or b.location ilike $${i} or b.developer ilike $${i} or p.category ilike $${i})`);
    }
    if (categories.length) {
      params.push(categories);
      conditions.push(`p.category = any($${params.length}::text[])`);
    }
    if (location) {
      params.push(`%${location}%`);
      conditions.push(`b.location ilike $${params.length}`);
    }

    const where = conditions.join(" and ");

    const cacheKey = `marketplace-search:${hashInput({ where, params, limit, offset, allowed })}`;
    const payload = await searchCache.getOrCompute(cacheKey, SEARCH_TTL_MS, async () => {
      const countRow = await q1<{ total: string }>(
        `select count(*) as total
           from packages p join buildings b on b.id = p.building_id
          where ${where}`,
        params,
      );

      const rowParams = [...params, limit, offset];
      const rows = await q<any>(
        `select p.*, b.name as _bname, b.location as _bloc, b.developer as _bdev
           from packages p join buildings b on b.id = p.building_id
          where ${where}
          order by p.deadline asc nulls last
          limit $${rowParams.length - 1} offset $${rowParams.length}`,
        rowParams,
      );

      const results = rows.map((r) => {
        const { _bname, _bloc, _bdev, ...pkg } = r;
        return { ...pkg, building: { name: _bname, location: _bloc, developer: _bdev } };
      });

      return { results, total: Number(countRow?.total ?? 0), limit, offset };
    });

    res.json(payload);
  }),
);

export default router;
