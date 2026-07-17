/**
 * Procurement Intelligence layer for Divini Procure. Mounted under /api/intel.
 *
 * Every endpoint is DETERMINISTIC first: real scoring logic over the existing
 * schema (companies, vendor_profiles, packages, package_line_items, bids,
 * bid_line_items, reviews). The local LLM (lib/llm.ts) is an OPTIONAL enrichment
 * layer only: when llmEnabled() is false (the default) the deterministic result
 * is returned unchanged and no model is called, so the feature is cost-safe and
 * never a hard dependency.
 *
 * Guard: requireUser on every endpoint (any signed-in user).
 *
 * Endpoints:
 *   GET /intel/vendor-match?packageId=  (or ?category=&territory=)
 *   GET /intel/quote-analysis/:packageId
 *   GET /intel/alternatives?category=&excludeVendorId=  (&territory= optional)
 *   GET /intel/product-match?packageId=
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { llmEnabled, llmText } from "../lib/llm.js";
import { sendEmail } from "../lib/email.js";
import { PROCURE_MONETIZATION_V2 } from "../config.js";
import { llmRateLimit } from "../lib/rateLimit.js";

// 30 LLM-powered requests per user per hour. Applied to the quote-analysis
// endpoint which is the only one that conditionally calls llmText().
const intelLlmLimit = llmRateLimit({ max: 30, windowMs: 60 * 60_000 });

/**
 * Monetization V2 gate: when the flag is ON, only VERIFIED vendors may be
 * matched / recommended to a developer. The verified state on vendor_profiles
 * is 'approved' (the credential-review recompute writes that; the DB CHECK
 * permits pending|ai-verified|approved|flagged). 'verified' is also accepted for
 * forward-compatibility. When the flag is OFF this returns true for everyone, so
 * the recommendation surface is unchanged.
 */
function vendorPassesV2MatchGate(verifyStatus: string | null | undefined): boolean {
  if (!PROCURE_MONETIZATION_V2) return true;
  const s = String(verifyStatus ?? "").toLowerCase();
  return s === "approved" || s === "verified";
}

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Shared deterministic helpers
// ---------------------------------------------------------------------------

/** Lowercase, split into significant word tokens (3+ chars), de-duplicated. */
function tokens(...parts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const w of String(p).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (w.length >= 3) out.add(w);
    }
  }
  return out;
}

/** Count of shared tokens between two sets. */
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Normalize a region/territory string for loose matching. */
function normRegion(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type VendorRow = {
  id: string;
  name: string;
  region: string | null;
  company_rating: number | null;
  trust: number | null;
  verify_status: string | null;
  vp_rating: number | null;
  services: string[] | null;
  bids_total: number | null;
  bids_awarded: number | null;
  review_avg: number | null;
  review_count: number | null;
  /** Latest persisted Divini Score for this vendor company (null if never computed). */
  divini_score: number | null;
  /** Relationship status for the (developer, vendor) pair, when a developer is in scope. */
  relationship_status: string | null;
};

export type RankedVendor = {
  vendor_company_id: string;
  name: string;
  score: number; // 0..100
  reasons: string[];
};

/**
 * Pull every vendor company with its profile + performance aggregates in one
 * query. Performance is derived deterministically from real rows: bid volume,
 * award (completion) rate, and review average.
 *
 * Also reads two moat signals so ranking can blend them in (see scoreVendor):
 *   - divini_score: the LATEST persisted Divini Score for the vendor company
 *     (subquery, ordered by computed_at desc). Null when never computed.
 *   - relationship_status: the developer_vendor_relationships.relationship_status
 *     for the (developer, vendor) pair, when a developerCompanyId is in scope.
 *     This makes existing / grandfathered vendors rank higher for THAT developer.
 */
async function loadVendors(developerCompanyId?: string | null): Promise<VendorRow[]> {
  return q<VendorRow>(
    `select c.id,
            c.name,
            c.region,
            c.rating                         as company_rating,
            vp.trust,
            vp.verify_status,
            vp.rating                        as vp_rating,
            vp.services,
            (select count(*) from bids b where b.vendor_company_id = c.id)                       as bids_total,
            (select count(*) from bids b where b.vendor_company_id = c.id and b.awarded = true)  as bids_awarded,
            (select avg(r.stars) from reviews r where r.ratee_company_id = c.id)                 as review_avg,
            (select count(*) from reviews r where r.ratee_company_id = c.id)                     as review_count,
            (select ds.score from divini_scores ds
              where ds.company_id = c.id
              order by ds.computed_at desc
              limit 1)                                                                            as divini_score,
            (case when $1::uuid is null then null else (
               select dvr.relationship_status from developer_vendor_relationships dvr
                where dvr.vendor_company_id = c.id
                  and dvr.developer_company_id = $1::uuid
                limit 1
             ) end)                                                                              as relationship_status
       from companies c
       left join vendor_profiles vp on vp.company_id = c.id
      where c.kind = 'vendor'`,
    [developerCompanyId ?? null],
  );
}

/**
 * Deterministic vendor score in 0..100 against a category + territory + a set
 * of requirement keyword tokens. Returns null when there is no category overlap
 * at all (keeps the ranked list relevant) unless requirements still match.
 */
function scoreVendor(
  v: VendorRow,
  opts: { category: string; territory: string; reqTokens: Set<string> },
): RankedVendor | null {
  const reasons: string[] = [];
  let score = 0;

  // ---- 1) Category / services overlap (up to 40) -------------------------
  const catTokens = tokens(opts.category);
  const svcTokens = tokens(...(v.services ?? []));
  const catHit = overlap(catTokens, svcTokens);
  const reqHit = overlap(opts.reqTokens, svcTokens);
  if (catHit > 0) {
    score += Math.min(40, catHit * 20);
    reasons.push(`Services match category "${opts.category}"`);
  }
  if (reqHit > 0) {
    score += Math.min(15, reqHit * 5);
    reasons.push(`Covers ${reqHit} of the stated requirement${reqHit === 1 ? "" : "s"}`);
  }
  // Vendors with no listed services cannot be category-matched, but should not
  // be dropped entirely; give a small baseline so they still rank below matches.
  const hasServiceSignal = (v.services?.length ?? 0) > 0;
  if (!hasServiceSignal && catHit === 0 && reqHit === 0) {
    score += 5;
    reasons.push("No published service list (unscored on category)");
  }

  // ---- 2) Territory / coverage match (up to 20) --------------------------
  const wantRegion = normRegion(opts.territory);
  const haveRegion = normRegion(v.region);
  if (wantRegion && haveRegion) {
    if (haveRegion === wantRegion) {
      score += 20;
      reasons.push(`Located in ${v.region}`);
    } else if (haveRegion.includes(wantRegion) || wantRegion.includes(haveRegion)) {
      score += 12;
      reasons.push(`Coverage overlaps ${opts.territory}`);
    }
  } else if (!wantRegion) {
    score += 6; // no territory requested -> mild neutral credit
  }

  // ---- 3) Trust + verification (up to 20) --------------------------------
  const trust = Number(v.trust ?? 0);
  score += Math.round((Math.max(0, Math.min(100, trust)) / 100) * 12);
  if (trust >= 70) reasons.push(`High trust score (${trust})`);
  if (v.verify_status === "approved") {
    score += 8;
    reasons.push("Verified / approved vendor");
  } else if (v.verify_status === "ai-verified") {
    score += 5;
    reasons.push("AI-verified vendor");
  }

  // ---- 4) Performance: rating, reviews, completion (up to 20) ------------
  const rating = Number(v.vp_rating ?? v.company_rating ?? 0);
  if (rating > 0) {
    score += Math.round((Math.max(0, Math.min(5, rating)) / 5) * 8);
    reasons.push(`Rating ${rating.toFixed(1)} / 5`);
  }
  const reviewAvg = v.review_avg == null ? null : Number(v.review_avg);
  const reviewCount = Number(v.review_count ?? 0);
  if (reviewAvg != null && reviewCount > 0) {
    score += Math.round((Math.max(0, Math.min(5, reviewAvg)) / 5) * 4);
    reasons.push(`${reviewAvg.toFixed(1)} avg over ${reviewCount} review${reviewCount === 1 ? "" : "s"}`);
  }
  const bidsTotal = Number(v.bids_total ?? 0);
  const bidsAwarded = Number(v.bids_awarded ?? 0);
  if (bidsTotal > 0) {
    const completion = bidsAwarded / bidsTotal;
    score += Math.round(completion * 8);
    if (bidsAwarded > 0) {
      reasons.push(`${bidsAwarded} awarded of ${bidsTotal} bid${bidsTotal === 1 ? "" : "s"} (${Math.round(completion * 100)}% win rate)`);
    } else {
      reasons.push(`${bidsTotal} prior bid${bidsTotal === 1 ? "" : "s"}`);
    }
  }

  // ---- 5) Divini Score factor (up to +15, neutral 0 when never computed) ---
  // Blend in the vendor's compounding-intelligence Divini Score. No score row
  // is treated as neutral (no bonus, no penalty), so unscored vendors are not
  // pushed below scored ones for the wrong reason.
  if (v.divini_score != null) {
    const ds = Math.max(0, Math.min(100, Number(v.divini_score)));
    score += Math.round((ds / 100) * 15);
    reasons.push(`Divini Score ${ds} / 100`);
  }

  // ---- 6) Relationship factor (pair-specific, up to +10) -------------------
  // Existing / grandfathered vendors for THIS developer rank higher. Active
  // (grandfathered or standard fee) relationships earn the full bonus; a
  // claimed / pending-review relationship earns a partial bonus.
  const rel = v.relationship_status;
  if (rel === "grandfathered_2_percent" || rel === "standard_fee") {
    score += 10;
    reasons.push(
      rel === "grandfathered_2_percent"
        ? "Existing grandfathered (2%) relationship with you"
        : "Active vendor relationship with you",
    );
  } else if (rel === "existing_relationship_claimed" || rel === "existing_relationship_under_review") {
    score += 5;
    reasons.push("Relationship with you claimed / pending review");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  if (finalScore <= 0) return null;
  return {
    vendor_company_id: v.id,
    name: v.name,
    score: finalScore,
    reasons,
  };
}

/** Resolve a package's category + territory + requirement tokens + owning developer. */
async function packageContext(
  packageId: string,
): Promise<{
  category: string;
  territory: string;
  reqTokens: Set<string>;
  budgetMin: number | null;
  budgetMax: number | null;
  developerCompanyId: string | null;
} | null> {
  const row = await q1<{
    category: string;
    requirements: string[] | null;
    budget_min: number | null;
    budget_max: number | null;
    region: string | null;
    location: string | null;
    developer_company_id: string | null;
  }>(
    `select p.category, p.requirements, p.budget_min, p.budget_max,
            bc.region as region, b.location as location,
            b.company_id as developer_company_id
       from packages p
       join buildings b on b.id = p.building_id
       left join companies bc on bc.id = b.company_id
      where p.id = $1`,
    [packageId],
  );
  if (!row) return null;
  return {
    category: row.category ?? "",
    territory: row.location || row.region || "",
    reqTokens: tokens(...(row.requirements ?? [])),
    budgetMin: row.budget_min == null ? null : Number(row.budget_min),
    budgetMax: row.budget_max == null ? null : Number(row.budget_max),
    developerCompanyId: row.developer_company_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /intel/vendor-match
// ---------------------------------------------------------------------------
router.get(
  "/intel/vendor-match",
  requireUser,
  h(async (req, res) => {
    const packageId = req.query.packageId ? String(req.query.packageId) : "";
    let category = req.query.category ? String(req.query.category) : "";
    let territory = req.query.territory ? String(req.query.territory) : "";
    let reqTokens = new Set<string>();
    let developerCompanyId: string | null = null;

    if (packageId) {
      const ctx = await packageContext(packageId);
      if (!ctx) return res.status(404).json({ error: "package not found" });
      category = ctx.category;
      territory = ctx.territory;
      reqTokens = ctx.reqTokens;
      developerCompanyId = ctx.developerCompanyId;
    }
    if (!category && !territory) {
      return res.status(400).json({ error: "packageId, or category/territory, required" });
    }

    const vendors = await loadVendors(developerCompanyId);
    const ranked = vendors
      // Monetization V2 (flag-gated): only verified vendors are recommended to a
      // developer. No-op when the flag is off.
      .filter((v) => vendorPassesV2MatchGate(v.verify_status))
      .map((v) => scoreVendor(v, { category, territory, reqTokens }))
      .filter((r): r is RankedVendor => r != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    res.json({
      packageId: packageId || null,
      category,
      territory,
      results: ranked,
      ai_enabled: llmEnabled(),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /intel/alternatives  (same ranking, excluding a vendor)
// ---------------------------------------------------------------------------
router.get(
  "/intel/alternatives",
  requireUser,
  h(async (req, res) => {
    const category = req.query.category ? String(req.query.category) : "";
    const territory = req.query.territory ? String(req.query.territory) : "";
    const excludeVendorId = req.query.excludeVendorId ? String(req.query.excludeVendorId) : "";
    if (!category && !territory) {
      return res.status(400).json({ error: "category or territory required" });
    }
    const vendors = await loadVendors();
    const ranked = vendors
      .filter((v) => v.id !== excludeVendorId)
      // Monetization V2 (flag-gated): only verified vendors are recommended.
      .filter((v) => vendorPassesV2MatchGate(v.verify_status))
      .map((v) => scoreVendor(v, { category, territory, reqTokens: new Set<string>() }))
      .filter((r): r is RankedVendor => r != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    res.json({
      category,
      territory,
      excludeVendorId: excludeVendorId || null,
      results: ranked,
      ai_enabled: llmEnabled(),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /intel/quote-analysis/:packageId
// ---------------------------------------------------------------------------
type BidRow = {
  id: string;
  vendor_company_id: string;
  vendor_name: string | null;
  price: number | null;
  days: number | null;
  status: string | null;
  awarded: boolean | null;
  line_count: number | null;
};

router.get(
  "/intel/quote-analysis/:packageId",
  requireUser,
  intelLlmLimit,
  h(async (req, res) => {
    const packageId = req.params.packageId;
    const ctx = await packageContext(packageId);
    if (!ctx) return res.status(404).json({ error: "package not found" });

    const bids = await q<BidRow>(
      `select b.id,
              b.vendor_company_id,
              c.name as vendor_name,
              b.price,
              b.days,
              b.status,
              b.awarded,
              (select count(*) from bid_items bi where bi.bid_id = b.id) as line_count
         from bids b
         left join companies c on c.id = b.vendor_company_id
        where b.package_id = $1
          and coalesce(b.is_draft, false) = false
          and coalesce(b.status, 'submitted') not in ('withdrawn', 'rejected')`,
      [packageId],
    );

    const priced = bids.filter((b) => b.price != null && Number(b.price) > 0);
    if (priced.length === 0) {
      return res.json({
        packageId,
        bid_count: bids.length,
        priced_count: 0,
        flags: [],
        savings_opportunity: 0,
        recommended_bid_id: null,
        recommended_reasons: ["No priced bids to analyze yet."],
        budget: { min: ctx.budgetMin, max: ctx.budgetMax },
        narrative: null,
        ai_enabled: llmEnabled(),
      });
    }

    const prices = priced.map((b) => Number(b.price));
    const lowest = priced.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
    const highest = priced.reduce((a, b) => (Number(b.price) > Number(a.price) ? b : a));
    const minP = Number(lowest.price);
    const maxP = Number(highest.price);
    const avg = prices.reduce((s, n) => s + n, 0) / prices.length;
    const spreadPct = minP > 0 ? Math.round(((maxP - minP) / minP) * 100) : 0;

    // Standard-deviation outliers (> 1.5 sigma from mean), deterministic.
    const variance = prices.reduce((s, n) => s + (n - avg) ** 2, 0) / prices.length;
    const sigma = Math.sqrt(variance);
    const outliers = priced
      .filter((b) => sigma > 0 && Math.abs(Number(b.price) - avg) > 1.5 * sigma)
      .map((b) => ({
        bid_id: b.id,
        vendor: b.vendor_name,
        price: Number(b.price),
        direction: Number(b.price) > avg ? "high" : "low",
      }));

    // Missing-scope flag: bids with fewer priced lines than the package defines.
    const pkgLineCount = Number(
      (await q1<{ n: number }>(`select count(*)::int as n from package_line_items where package_id = $1`, [packageId]))?.n ?? 0,
    );
    const missingScope =
      pkgLineCount > 0
        ? priced
            .filter((b) => Number(b.line_count ?? 0) < pkgLineCount)
            .map((b) => ({
              bid_id: b.id,
              vendor: b.vendor_name,
              priced_lines: Number(b.line_count ?? 0),
              expected_lines: pkgLineCount,
            }))
        : [];

    const flags: Array<{ type: string; label: string; bid_id?: string; value?: number }> = [];
    flags.push({ type: "lowest_total", label: `Lowest bid: ${lowest.vendor_name ?? "vendor"} at $${minP.toLocaleString()}`, bid_id: lowest.id, value: minP });
    flags.push({ type: "highest_total", label: `Highest bid: ${highest.vendor_name ?? "vendor"} at $${maxP.toLocaleString()}`, bid_id: highest.id, value: maxP });
    flags.push({ type: "price_spread_pct", label: `Price spread is ${spreadPct}% between low and high`, value: spreadPct });
    for (const o of outliers) {
      flags.push({ type: "outlier", label: `${o.vendor ?? "Vendor"} is a ${o.direction} outlier at $${o.price.toLocaleString()}`, bid_id: o.bid_id, value: o.price });
    }
    for (const m of missingScope) {
      flags.push({ type: "missing_scope", label: `${m.vendor ?? "Vendor"} priced only ${m.priced_lines} of ${m.expected_lines} scope lines`, bid_id: m.bid_id });
    }

    // Budget comparison (if the package carries a budget range).
    if (ctx.budgetMax != null) {
      const over = priced.filter((b) => Number(b.price) > Number(ctx.budgetMax));
      if (over.length > 0) {
        flags.push({ type: "over_budget", label: `${over.length} bid${over.length === 1 ? "" : "s"} exceed the $${Number(ctx.budgetMax).toLocaleString()} budget cap` });
      }
      if (minP <= Number(ctx.budgetMax)) {
        flags.push({ type: "within_budget", label: `Lowest bid is within the $${Number(ctx.budgetMax).toLocaleString()} budget`, value: minP });
      }
    }

    // Savings opportunity: gap from average to the lowest credible (non-low-outlier) bid.
    const lowOutlierIds = new Set(outliers.filter((o) => o.direction === "low").map((o) => o.bid_id));
    const credible = priced.filter((b) => !lowOutlierIds.has(b.id));
    const credibleMin = credible.length > 0 ? Math.min(...credible.map((b) => Number(b.price))) : minP;
    const savings = Math.max(0, Math.round(avg - credibleMin));

    // Recommended bid: deterministic. Prefer the lowest credible (non-outlier,
    // full-scope) bid; tie-break on shorter timeline.
    const missingIds = new Set(missingScope.map((m) => m.bid_id));
    const recommendPool = (credible.length > 0 ? credible : priced).filter((b) => !missingIds.has(b.id));
    const pool = recommendPool.length > 0 ? recommendPool : priced;
    const recommended = [...pool].sort((a, b) => {
      const pa = Number(a.price), pb = Number(b.price);
      if (pa !== pb) return pa - pb;
      return Number(a.days ?? 0) - Number(b.days ?? 0);
    })[0];
    const recReasons: string[] = [];
    if (recommended) {
      recReasons.push(`Lowest credible full-scope bid at $${Number(recommended.price).toLocaleString()}`);
      if (!lowOutlierIds.has(recommended.id)) recReasons.push("Not a low-side pricing outlier");
      if (!missingIds.has(recommended.id)) recReasons.push("Prices the full defined scope");
      if (recommended.days != null) recReasons.push(`${recommended.days}-day timeline`);
      if (ctx.budgetMax != null && Number(recommended.price) <= Number(ctx.budgetMax)) recReasons.push("Within budget");
    }

    // ---- OPTIONAL LLM narrative (never blocks; deterministic result stands) ----
    let narrative: string | null = null;
    if (llmEnabled()) {
      const summaryInput = {
        category: ctx.category,
        budget: { min: ctx.budgetMin, max: ctx.budgetMax },
        bids: priced.map((b) => ({ vendor: b.vendor_name, price: Number(b.price), days: b.days })),
        lowest: minP,
        highest: maxP,
        average: Math.round(avg),
        spread_pct: spreadPct,
        recommended: recommended ? { vendor: recommended.vendor_name, price: Number(recommended.price) } : null,
        savings_opportunity: savings,
      };
      const text = await llmText(
        "You are a procurement analyst. In 2 to 4 short sentences, summarize this bid comparison " +
          "for a buyer. Use ONLY the numbers provided. Do not invent figures, do not give legal or " +
          "financial advice, and do not recommend anything beyond what the data supports. Data:\n" +
          JSON.stringify(summaryInput),
        { timeoutMs: 15000 },
      );
      narrative = text.trim() ? text.trim().slice(0, 1200) : null;
    }

    res.json({
      packageId,
      bid_count: bids.length,
      priced_count: priced.length,
      stats: { lowest: minP, highest: maxP, average: Math.round(avg), spread_pct: spreadPct },
      flags,
      savings_opportunity: savings,
      recommended_bid_id: recommended?.id ?? null,
      recommended_reasons: recReasons,
      budget: { min: ctx.budgetMin, max: ctx.budgetMax },
      narrative, // omitted (null) unless the LLM is enabled and returns text
      ai_enabled: llmEnabled(),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /intel/product-match?packageId=
// ---------------------------------------------------------------------------
router.get(
  "/intel/product-match",
  requireUser,
  h(async (req, res) => {
    const packageId = req.query.packageId ? String(req.query.packageId) : "";
    if (!packageId) return res.status(400).json({ error: "packageId required" });

    const ctx = await packageContext(packageId);
    if (!ctx) return res.status(404).json({ error: "package not found" });

    // Package line items describe what the buyer needs.
    const lines = await q<{ id: string; description: string; cost_code: string | null; unit: string | null; qty: number | null }>(
      `select id, description, cost_code, unit, qty from package_line_items where package_id = $1 order by sort, created_at`,
      [packageId],
    );

    // There is no products catalog table in the current schema; match each
    // line item against the closest published vendor service offerings instead,
    // by category + spec keyword overlap. Graceful: returns [] when no line
    // items exist or nothing matches.
    if (lines.length === 0) {
      return res.json({ packageId, results: [], note: "No line items to match.", ai_enabled: llmEnabled() });
    }

    const vendors = await q<{ id: string; name: string; services: string[] | null }>(
      `select c.id, c.name, vp.services
         from companies c
         join vendor_profiles vp on vp.company_id = c.id
        where c.kind = 'vendor' and vp.services is not null and array_length(vp.services, 1) > 0`,
    );

    const catTokens = tokens(ctx.category);
    const results = lines.map((li) => {
      const lineTokens = tokens(li.description, li.cost_code);
      const matches = vendors
        .map((v) => {
          let best = "";
          let bestScore = 0;
          for (const svc of v.services ?? []) {
            const svcTokens = tokens(svc);
            const sc = overlap(lineTokens, svcTokens) * 3 + overlap(catTokens, svcTokens);
            if (sc > bestScore) {
              bestScore = sc;
              best = svc;
            }
          }
          return bestScore > 0 ? { vendor_company_id: v.id, vendor_name: v.name, offering: best, score: bestScore } : null;
        })
        .filter((m): m is { vendor_company_id: string; vendor_name: string; offering: string; score: number } => m != null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return {
        line_item_id: li.id,
        description: li.description,
        unit: li.unit,
        qty: li.qty,
        suggestions: matches,
      };
    });

    res.json({ packageId, results, ai_enabled: llmEnabled() });
  }),
);

// ---------------------------------------------------------------------------
// INVITE HANDOFF: one-click invite-matched-vendor -> bid_invites
// ---------------------------------------------------------------------------

/** True when the user is a member of the company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [userId, companyId]);
  return !!row;
}

// POST /intel/invite-vendor
// Developer (member of the package's owning developer company) invites a matched
// vendor to bid. Upserts one bid_invites row per (package, vendor) pair.
router.post(
  "/intel/invite-vendor",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as {
      packageId?: string;
      vendorCompanyId?: string;
      matchScore?: number;
      message?: string;
    };
    const packageId = body.packageId ? String(body.packageId) : "";
    const vendorCompanyId = body.vendorCompanyId ? String(body.vendorCompanyId) : "";
    if (!packageId || !vendorCompanyId) {
      return res.status(400).json({ error: "packageId and vendorCompanyId required" });
    }

    // Resolve the package's owning developer company and verify membership.
    const pkg = await q1<{ developer_company_id: string | null; category: string }>(
      `select b.company_id as developer_company_id, p.category
         from packages p
         join buildings b on b.id = p.building_id
        where p.id = $1`,
      [packageId],
    );
    if (!pkg) return res.status(404).json({ error: "package not found" });
    if (!pkg.developer_company_id || !(await isMember(auth.userId!, pkg.developer_company_id))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const matchScore =
      body.matchScore == null || !Number.isFinite(Number(body.matchScore))
        ? null
        : Math.max(0, Math.min(100, Math.round(Number(body.matchScore))));
    const message = body.message ? String(body.message).slice(0, 2000) : null;

    const row = await q1<{ id: string; status: string; match_score: number | null; created_at: string }>(
      `insert into bid_invites
         (package_id, vendor_company_id, developer_company_id, status, match_score, message, invited_by)
       values ($1, $2, $3, 'invited', $4, $5, $6)
       on conflict (package_id, vendor_company_id)
         do update set match_score = coalesce(excluded.match_score, bid_invites.match_score),
                       message = coalesce(excluded.message, bid_invites.message),
                       invited_by = excluded.invited_by,
                       updated_at = now()
       returning id, status, match_score, created_at`,
      [packageId, vendorCompanyId, pkg.developer_company_id, matchScore, message, auth.email ?? auth.userId],
    );

    // Best-effort email to the vendor company (never blocks the invite).
    let emailed = false;
    try {
      const vendor = await q1<{ email: string | null; billing_email: string | null; name: string }>(
        `select email, billing_email, name from companies where id = $1`,
        [vendorCompanyId],
      );
      const to = vendor?.email || vendor?.billing_email || null;
      if (to) {
        const r = await sendEmail({
          to,
          subject: "You have been invited to bid",
          text:
            `Hello ${vendor?.name ?? "there"},\n\n` +
            `You have been invited to submit a bid for a ${pkg.category} package on Divini Procure.\n` +
            (message ? `\nMessage from the developer:\n${message}\n` : "") +
            `\nSign in to Divini Procure to view the opportunity and respond.\n`,
        });
        emailed = !!r.ok;
      }
    } catch {
      /* email is best-effort */
    }

    res.json({ ok: true, invite: row, emailed });
  }),
);

// GET /intel/invites?packageId=
// List invites for a package (developer member of the package's developer company).
router.get(
  "/intel/invites",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.query.packageId ? String(req.query.packageId) : "";
    if (!packageId) return res.status(400).json({ error: "packageId required" });

    const pkg = await q1<{ developer_company_id: string | null }>(
      `select b.company_id as developer_company_id
         from packages p
         join buildings b on b.id = p.building_id
        where p.id = $1`,
      [packageId],
    );
    if (!pkg) return res.status(404).json({ error: "package not found" });
    if (!pkg.developer_company_id || !(await isMember(auth.userId!, pkg.developer_company_id))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const invites = await q(
      `select bi.id, bi.package_id, bi.vendor_company_id, c.name as vendor_name,
              bi.status, bi.match_score, bi.message, bi.invited_by, bi.created_at, bi.updated_at
         from bid_invites bi
         left join companies c on c.id = bi.vendor_company_id
        where bi.package_id = $1
        order by bi.created_at desc`,
      [packageId],
    );
    res.json({ packageId, invites });
  }),
);

// GET /intel/my-invites?companyId=
// Invites addressed to a vendor company (vendor member sees opportunities).
router.get(
  "/intel/my-invites",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : "";
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!(await isMember(auth.userId!, companyId))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const invites = await q(
      `select bi.id, bi.package_id, p.category as package_category, p.status as package_status,
              b.name as project_name, bi.status, bi.match_score, bi.message,
              bi.created_at, bi.updated_at
         from bid_invites bi
         left join packages p on p.id = bi.package_id
         left join buildings b on b.id = p.building_id
        where bi.vendor_company_id = $1
        order by bi.created_at desc`,
      [companyId],
    );
    res.json({ companyId, invites });
  }),
);

export default router;
