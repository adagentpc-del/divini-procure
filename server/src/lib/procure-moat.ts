/**
 * Intelligence Moat engine for Divini Procure. PURE deterministic logic over
 * the existing procurement schema (companies, buildings, packages, bids,
 * submittals, deliveries, developer_vendor_relationships, current_engagements,
 * reviews, documents). No external LLM, no randomness: the same data always
 * yields the same score / graph / flags.
 *
 * Three capabilities, mapped to the procurement domain:
 *
 *   1. Divini Score   diviniScore(companyId) computes and persists a 0..100
 *                     reputation/health score for a company. Vendors are scored
 *                     on win rate, on-time delivery, submittal approval, reviews
 *                     and profile completeness; developers (buyers) on project
 *                     volume, award activity, payment reliability and
 *                     relationship breadth.
 *
 *   2. Relationship   buildRelationshipEdges() materializes the company graph;
 *      Graph          relationshipGraph(companyId) returns a company's
 *                     neighborhood as nodes + edges.
 *
 *   3. War Room       warRoom(buildingId) and portfolioWarRoom(companyId) return
 *                     ranked health flags for a project / a developer's whole
 *                     portfolio.
 *
 * Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ScoreFactor = {
  key: string;
  label: string;
  /** Points this factor contributed to the final score. */
  points: number;
  /** Maximum the factor could contribute (for the UI bar denominator). */
  max: number;
  detail: string;
};

export type DiviniScore = {
  company_id: string;
  entity_kind: "buyer" | "vendor";
  score: number; // 0..100
  factors: ScoreFactor[];
  computed_at: string;
};

export type GraphNode = { id: string; name: string; kind: string };
export type GraphEdge = {
  from: string;
  to: string;
  type: string;
  weight: number;
  detail?: Record<string, unknown> | null;
};
export type RelationshipGraphResult = {
  company_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type FlagLevel = "low" | "medium" | "high" | "critical";
export type WarRoomFlag = {
  level: FlagLevel;
  title: string;
  detail: string;
  link: string | null;
};

const LEVEL_RANK: Record<FlagLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Sort flags by severity (critical first), stable on insertion order. */
function rankFlags(flags: WarRoomFlag[]): WarRoomFlag[] {
  return flags
    .map((f, i) => ({ f, i }))
    .sort((a, b) => LEVEL_RANK[a.f.level] - LEVEL_RANK[b.f.level] || a.i - b.i)
    .map((x) => x.f);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// 1) Divini Score
// ---------------------------------------------------------------------------

type CompanyRow = { id: string; kind: "buyer" | "vendor"; name: string; rating: number | null };

async function loadCompany(companyId: string): Promise<CompanyRow | null> {
  return q1<CompanyRow>(`select id, kind, name, rating from companies where id = $1`, [companyId]);
}

/**
 * Build the deterministic vendor score (win rate, delivery, submittals, reviews, profile).
 * `asOfDate`, when provided, restricts every event-based factor to rows that
 * existed by that date (created_at <= asOfDate), for score-history (G-03,
 * docs/ai-layer-design.md section 3.3) - recomputed fresh from source rows,
 * never a stored/cached historical snapshot, matching this codebase's
 * established "recompute from source" convention. Profile completeness
 * cannot be reconstructed historically (vendor_profiles has no version
 * history) and is honestly reported as current-state-only in that case,
 * never presented as if it were accurate for the requested date.
 */
async function scoreVendor(c: CompanyRow, asOfDate: Date | null = null): Promise<ScoreFactor[]> {
  const factors: ScoreFactor[] = [];
  const cutoff = asOfDate ? asOfDate.toISOString() : null;

  // ---- Bid win rate (up to 30) -------------------------------------------
  const bidAgg = await q1<{ total: number; awarded: number }>(
    `select count(*)::int as total,
            count(*) filter (where awarded = true)::int as awarded
       from bids
      where vendor_company_id = $1 and coalesce(is_draft, false) = false
        ${cutoff ? "and created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const bidsTotal = num(bidAgg?.total);
  const bidsAwarded = num(bidAgg?.awarded);
  const winRate = bidsTotal > 0 ? bidsAwarded / bidsTotal : 0;
  factors.push({
    key: "win_rate",
    label: "Bid win rate",
    points: Math.round(winRate * 30),
    max: 30,
    detail:
      bidsTotal > 0
        ? `${bidsAwarded} awarded of ${bidsTotal} bid${bidsTotal === 1 ? "" : "s"} (${Math.round(winRate * 100)}%)`
        : "No bids submitted yet",
  });

  // ---- On-time delivery (up to 25) ---------------------------------------
  const delAgg = await q1<{ total: number; on_time: number; completed: number }>(
    `select count(*)::int as total,
            count(*) filter (
              where completion_date is not null
                and (expected_delivery is null or completion_date <= expected_delivery)
            )::int as on_time,
            count(*) filter (where completion_date is not null)::int as completed
       from deliveries
      where vendor_company_id = $1
        ${cutoff ? "and created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const delCompleted = num(delAgg?.completed);
  const delOnTime = num(delAgg?.on_time);
  const onTimeRate = delCompleted > 0 ? delOnTime / delCompleted : 0;
  factors.push({
    key: "on_time_delivery",
    label: "On-time delivery",
    points: delCompleted > 0 ? Math.round(onTimeRate * 25) : 0,
    max: 25,
    detail:
      delCompleted > 0
        ? `${delOnTime} of ${delCompleted} completed deliveries on time (${Math.round(onTimeRate * 100)}%)`
        : "No completed deliveries yet",
  });

  // ---- Submittal approval rate (up to 20) --------------------------------
  const subAgg = await q1<{ total: number; approved: number; decided: number }>(
    `select count(*)::int as total,
            count(*) filter (where current_status = 'approved')::int as approved,
            count(*) filter (where current_status in ('approved','rejected','revise_resubmit'))::int as decided
       from submittals
      where vendor_company_id = $1
        ${cutoff ? "and created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const subDecided = num(subAgg?.decided);
  const subApproved = num(subAgg?.approved);
  const subRate = subDecided > 0 ? subApproved / subDecided : 0;
  factors.push({
    key: "submittal_approval",
    label: "Submittal approval rate",
    points: subDecided > 0 ? Math.round(subRate * 20) : 0,
    max: 20,
    detail:
      subDecided > 0
        ? `${subApproved} of ${subDecided} reviewed submittals approved (${Math.round(subRate * 100)}%)`
        : "No reviewed submittals yet",
  });

  // ---- Reviews (up to 15) ------------------------------------------------
  const revAgg = await q1<{ avg: number | null; cnt: number }>(
    `select avg(stars) as avg, count(*)::int as cnt from reviews
      where ratee_company_id = $1
        ${cutoff ? "and created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const reviewAvg = revAgg?.avg == null ? null : num(revAgg.avg);
  const reviewCount = num(revAgg?.cnt);
  factors.push({
    key: "reviews",
    label: "Client reviews",
    points: reviewAvg != null && reviewCount > 0 ? Math.round((clamp(reviewAvg, 0, 5) / 5) * 15) : 0,
    max: 15,
    detail:
      reviewAvg != null && reviewCount > 0
        ? `${reviewAvg.toFixed(1)} / 5 over ${reviewCount} review${reviewCount === 1 ? "" : "s"}`
        : "No reviews yet",
  });

  // ---- Profile completeness (up to 10) -----------------------------------
  const vp = await q1<{ services: string[] | null; verify_status: string | null; trust: number | null }>(
    `select services, verify_status, trust from vendor_profiles where company_id = $1`,
    [c.id],
  );
  let profilePts = 0;
  const profileBits: string[] = [];
  if ((vp?.services?.length ?? 0) > 0) {
    profilePts += 4;
    profileBits.push("services listed");
  }
  if (vp?.verify_status === "approved" || vp?.verify_status === "ai-verified") {
    profilePts += 4;
    profileBits.push("verified");
  }
  if (num(vp?.trust) >= 50) {
    profilePts += 2;
    profileBits.push(`trust ${num(vp?.trust)}`);
  }
  factors.push({
    key: "profile_completeness",
    label: "Profile completeness",
    points: profilePts,
    max: 10,
    detail: cutoff
      ? `${profileBits.length ? profileBits.join(", ") : "Incomplete vendor profile"} (current profile state - vendor_profiles has no version history, so this factor cannot be reconstructed as of a past date)`
      : profileBits.length
        ? profileBits.join(", ")
        : "Incomplete vendor profile",
  });

  return factors;
}

/**
 * Build the deterministic developer score (volume, awards, payment, breadth).
 * See scoreVendor()'s docstring for the asOfDate/score-history contract.
 */
async function scoreDeveloper(c: CompanyRow, asOfDate: Date | null = null): Promise<ScoreFactor[]> {
  const factors: ScoreFactor[] = [];
  const cutoff = asOfDate ? asOfDate.toISOString() : null;

  // ---- Project volume (up to 25) -----------------------------------------
  const projAgg = await q1<{ buildings: number; packages: number }>(
    `select (select count(*) from buildings b where b.company_id = $1 ${cutoff ? "and b.created_at <= $2" : ""})::int as buildings,
            (select count(*) from packages p
               join buildings b on b.id = p.building_id
              where b.company_id = $1 ${cutoff ? "and p.created_at <= $2" : ""})::int as packages`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const buildings = num(projAgg?.buildings);
  const packages = num(projAgg?.packages);
  // 5 points per project + 1 per package, capped at 25.
  const volumePts = clamp(buildings * 5 + packages, 0, 25);
  factors.push({
    key: "project_volume",
    label: "Project volume",
    points: volumePts,
    max: 25,
    detail: `${buildings} project${buildings === 1 ? "" : "s"}, ${packages} package${packages === 1 ? "" : "s"}`,
  });

  // ---- Award activity (up to 25) -----------------------------------------
  const awardAgg = await q1<{ open_pkgs: number; awarded_pkgs: number }>(
    `select count(*) filter (where p.status in ('open','shortlisting'))::int as open_pkgs,
            count(*) filter (where p.status = 'awarded')::int as awarded_pkgs
       from packages p
       join buildings b on b.id = p.building_id
      where b.company_id = $1
        ${cutoff ? "and p.created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const openPkgs = num(awardAgg?.open_pkgs);
  const awardedPkgs = num(awardAgg?.awarded_pkgs);
  const decided = openPkgs + awardedPkgs;
  const awardRate = decided > 0 ? awardedPkgs / decided : 0;
  factors.push({
    key: "award_activity",
    label: "Award activity",
    points: decided > 0 ? Math.round(awardRate * 25) : 0,
    max: 25,
    detail:
      decided > 0
        ? `${awardedPkgs} of ${decided} open/awarded packages awarded (${Math.round(awardRate * 100)}%)`
        : "No open or awarded packages yet",
  });

  // ---- Payment reliability (up to 25) ------------------------------------
  // Of the bids this developer awarded, how many are marked paid.
  const payAgg = await q1<{ awarded: number; paid: number }>(
    `select count(*) filter (where bd.awarded = true)::int as awarded,
            count(*) filter (where bd.awarded = true and bd.paid = true)::int as paid
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      where b.company_id = $1
        ${cutoff ? "and bd.created_at <= $2" : ""}`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const awardedBids = num(payAgg?.awarded);
  const paidBids = num(payAgg?.paid);
  const payRate = awardedBids > 0 ? paidBids / awardedBids : 0;
  factors.push({
    key: "payment_reliability",
    label: "Payment reliability",
    points: awardedBids > 0 ? Math.round(payRate * 25) : 0,
    max: 25,
    detail:
      awardedBids > 0
        ? `${paidBids} of ${awardedBids} awarded bid${awardedBids === 1 ? "" : "s"} paid (${Math.round(payRate * 100)}%)`
        : "No awarded bids yet",
  });

  // ---- Relationship breadth (up to 25) -----------------------------------
  // Distinct vendors the developer has engaged across bids + tracked relationships.
  const breadth = await q1<{ vendors: number }>(
    `select count(distinct vendor_company_id)::int as vendors from (
        select bd.vendor_company_id
          from bids bd
          join packages p on p.id = bd.package_id
          join buildings b on b.id = p.building_id
         where b.company_id = $1 and bd.vendor_company_id is not null
           ${cutoff ? "and bd.created_at <= $2" : ""}
        union
        select dvr.vendor_company_id
          from developer_vendor_relationships dvr
         where dvr.developer_company_id = $1
           ${cutoff ? "and dvr.created_at <= $2" : ""}
     ) t`,
    cutoff ? [c.id, cutoff] : [c.id],
  );
  const vendors = num(breadth?.vendors);
  // 4 points per distinct vendor, capped at 25.
  factors.push({
    key: "relationship_breadth",
    label: "Relationship breadth",
    points: clamp(vendors * 4, 0, 25),
    max: 25,
    detail: `${vendors} distinct vendor relationship${vendors === 1 ? "" : "s"}`,
  });

  return factors;
}

/**
 * Compute and PERSIST the Divini Score for a company. Appends a row to
 * divini_scores and returns the computed score + factor breakdown.
 */
export async function diviniScore(companyId: string): Promise<DiviniScore | null> {
  const c = await loadCompany(companyId);
  if (!c) return null;

  const entity_kind: "buyer" | "vendor" = c.kind === "vendor" ? "vendor" : "buyer";
  const factors = entity_kind === "vendor" ? await scoreVendor(c) : await scoreDeveloper(c);
  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = clamp(Math.round(raw), 0, 100);

  const inserted = await q1<{ computed_at: string }>(
    `insert into divini_scores (company_id, entity_kind, score, factors)
       values ($1, $2, $3, $4::jsonb)
     returning computed_at`,
    [companyId, entity_kind, score, JSON.stringify(factors)],
  );

  return {
    company_id: companyId,
    entity_kind,
    score,
    factors,
    computed_at: inserted?.computed_at ?? new Date().toISOString(),
  };
}

export type DiviniScoreAsOf = {
  company_id: string;
  entity_kind: "buyer" | "vendor";
  as_of: string;
  score: number;
  factors: ScoreFactor[];
  historical_note: string;
};

/**
 * Procurement Graph G-03 (docs/ai-layer-design.md section 3.3): the Divini
 * Score as it would have been on a past date, recomputed fresh from
 * timestamped source rows - NEVER persisted (this must not write a
 * backdated row into divini_scores, which would corrupt the real audit
 * trail of when a score was actually computed). Every event-based factor
 * (bids, deliveries, submittals, reviews, relationships) is scoped to rows
 * that existed by asOfDate; every STATUS-based check (a bid's `awarded`
 * flag, a package's `status`) reflects that row's CURRENT status, not a
 * true point-in-time snapshot of status - this codebase has no status-
 * history table for any of these, so a perfectly accurate historical
 * status is not reconstructable. This is a deliberate, documented
 * approximation ("existed by this date, in its current state") rather
 * than a false claim of full historical precision - see scoreVendor()'s
 * profile-completeness handling for the one factor that is entirely
 * current-state (vendor_profiles has no history at all).
 */
export async function diviniScoreAsOf(companyId: string, asOfDate: Date): Promise<DiviniScoreAsOf | null> {
  const c = await loadCompany(companyId);
  if (!c) return null;

  const entity_kind: "buyer" | "vendor" = c.kind === "vendor" ? "vendor" : "buyer";
  const factors =
    entity_kind === "vendor" ? await scoreVendor(c, asOfDate) : await scoreDeveloper(c, asOfDate);
  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = clamp(Math.round(raw), 0, 100);

  return {
    company_id: companyId,
    entity_kind,
    as_of: asOfDate.toISOString(),
    score,
    factors,
    historical_note:
      "Recomputed from source rows that existed by this date. Status-based factors (e.g. a bid's awarded flag) reflect each row's current status, not a true historical snapshot - this system has no status-history table. Never a cached/stored score.",
  };
}

/** Latest persisted score per company, highest first. Optional kind filter + limit. */
export async function listScores(
  entityKind?: string,
  limit = 100,
): Promise<Array<{ company_id: string; name: string; entity_kind: string; score: number; computed_at: string }>> {
  const params: any[] = [];
  let where = "";
  if (entityKind === "buyer" || entityKind === "vendor") {
    params.push(entityKind);
    where = `where ds.entity_kind = $${params.length}`;
  }
  params.push(clamp(limit, 1, 500));
  return q(
    `select distinct on (ds.company_id)
            ds.company_id, c.name, ds.entity_kind, ds.score, ds.computed_at
       from divini_scores ds
       join companies c on c.id = ds.company_id
       ${where}
      order by ds.company_id, ds.computed_at desc`,
    params,
  ).then((rows) =>
    (rows as any[])
      .sort((a, b) => num(b.score) - num(a.score))
      .slice(0, num(params[params.length - 1])),
  );
}

// ---------------------------------------------------------------------------
// 2) Relationship Graph
// ---------------------------------------------------------------------------

/** Upsert one edge, accumulating weight and replacing detail. */
async function upsertEdge(
  from: string,
  to: string,
  type: string,
  weight: number,
  detail: Record<string, unknown>,
): Promise<void> {
  await q1(
    `insert into relationship_edges (from_company_id, to_company_id, edge_type, weight, detail, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, now())
     on conflict (from_company_id, to_company_id, edge_type)
       do update set weight = excluded.weight, detail = excluded.detail, updated_at = now()`,
    [from, to, type, weight, JSON.stringify(detail)],
  );
}

/**
 * Materialize the company-to-company graph from real procurement signals.
 * Edges are directed developer -> vendor (the developer is the relationship
 * owner). Returns the number of edges written. Safe to re-run (upserts).
 */
export async function buildRelationshipEdges(): Promise<number> {
  let count = 0;

  // ---- 'bid' + 'awarded': developer (building.company_id) <-> bidding vendor.
  const bidPairs = await q<{
    developer_company_id: string;
    vendor_company_id: string;
    bids: number;
    awarded: number;
  }>(
    `select b.company_id as developer_company_id,
            bd.vendor_company_id,
            count(*)::int as bids,
            count(*) filter (where bd.awarded = true)::int as awarded
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      where b.company_id is not null and bd.vendor_company_id is not null
        and coalesce(bd.is_draft, false) = false
      group by b.company_id, bd.vendor_company_id`,
  );
  for (const r of bidPairs) {
    if (r.developer_company_id === r.vendor_company_id) continue;
    await upsertEdge(r.developer_company_id, r.vendor_company_id, "bid", num(r.bids), {
      bids: num(r.bids),
      awarded: num(r.awarded),
    });
    count++;
    if (num(r.awarded) > 0) {
      await upsertEdge(r.developer_company_id, r.vendor_company_id, "awarded", num(r.awarded), {
        awarded: num(r.awarded),
        bids: num(r.bids),
      });
      count++;
    }
  }

  // ---- 'grandfathered' / 'relationship': tracked developer-vendor pairs.
  const relPairs = await q<{
    developer_company_id: string;
    vendor_company_id: string;
    relationship_status: string;
    grandfathered_fee_eligible: boolean;
    fee_pct: number | string;
  }>(
    `select developer_company_id, vendor_company_id, relationship_status,
            grandfathered_fee_eligible, grandfathered_fee_percentage as fee_pct
       from developer_vendor_relationships`,
  );
  for (const r of relPairs) {
    if (r.developer_company_id === r.vendor_company_id) continue;
    const grandfathered =
      r.grandfathered_fee_eligible === true || r.relationship_status === "grandfathered_2_percent";
    await upsertEdge(
      r.developer_company_id,
      r.vendor_company_id,
      grandfathered ? "grandfathered" : "relationship",
      1,
      { relationship_status: r.relationship_status, fee_percentage: num(r.fee_pct) },
    );
    count++;
  }

  // ---- 'engagement': counterparty named on a company's current engagements.
  // counterparty is free text; match it to a company by name when possible.
  const engagements = await q<{ company_id: string; counterparty: string | null; title: string }>(
    `select company_id, counterparty, title
       from current_engagements
      where counterparty is not null and length(trim(counterparty)) > 0`,
  );
  for (const e of engagements) {
    const match = await q1<{ id: string }>(
      `select id from companies where lower(name) = lower($1) limit 1`,
      [String(e.counterparty).trim()],
    );
    if (match && match.id !== e.company_id) {
      await upsertEdge(e.company_id, match.id, "engagement", 1, { title: e.title });
      count++;
    }
  }

  // ---- 'commitment': recency-decayed real dollar volume, developer <-> vendor.
  // Procurement Graph G-01 (docs/ai-layer-design.md section 3.1). Distinct
  // from the 'bid'/'awarded' edges above, which weight by raw event COUNT
  // (how many bids/awards) - this weights by actual COMMITTED MONEY (awards
  // is the canonical commitment event per Phase 1's financial model),
  // decayed by age so a $2M relationship from 3 years ago does not outweigh
  // an active $200K one from last month. Half-life of 365 days: an award's
  // dollar contribution to the edge weight halves every year it ages,
  // recomputed fresh from source every rebuild (never a stored decay that
  // itself needs re-decaying).
  const COMMITMENT_HALF_LIFE_DAYS = 365;
  const commitmentPairs = await q<{
    developer_company_id: string;
    vendor_company_id: string;
    award_count: number;
    total_amount_cents: string;
    decayed_weight: string;
  }>(
    `select developer_company_id, vendor_company_id,
            count(*)::int as award_count,
            sum(awarded_amount_cents)::text as total_amount_cents,
            sum(
              (awarded_amount_cents::numeric / 100.0)
              * power(0.5, extract(epoch from (now() - created_at)) / 86400.0 / $1)
            )::text as decayed_weight
       from awards
      where status = 'active'
        and developer_company_id is not null
        and vendor_company_id is not null
      group by developer_company_id, vendor_company_id`,
    [COMMITMENT_HALF_LIFE_DAYS],
  );
  for (const r of commitmentPairs) {
    if (r.developer_company_id === r.vendor_company_id) continue;
    await upsertEdge(r.developer_company_id, r.vendor_company_id, "commitment", num(r.decayed_weight), {
      awardCount: num(r.award_count),
      totalAmountCents: num(r.total_amount_cents),
      halfLifeDays: COMMITMENT_HALF_LIFE_DAYS,
    });
    count++;
  }

  // ---- 'co_bid': vendor <-> vendor, both bid on the same package(s).
  // Procurement Graph G-02a. Undirected (one edge per unordered pair,
  // ordered by id so a rebuild never creates both (A,B) and (B,A)).
  // Weight = number of distinct packages both vendors bid on together.
  const coBidPairs = await q<{ vendor_a: string; vendor_b: string; shared_packages: number }>(
    `select a.vendor_company_id as vendor_a, b.vendor_company_id as vendor_b,
            count(distinct a.package_id)::int as shared_packages
       from bids a
       join bids b
         on a.package_id = b.package_id
        and a.vendor_company_id < b.vendor_company_id
      where a.vendor_company_id is not null and b.vendor_company_id is not null
        and coalesce(a.is_draft, false) = false and coalesce(b.is_draft, false) = false
      group by a.vendor_company_id, b.vendor_company_id`,
  );
  for (const r of coBidPairs) {
    await upsertEdge(r.vendor_a, r.vendor_b, "co_bid", num(r.shared_packages), {
      sharedPackages: num(r.shared_packages),
    });
    count++;
  }

  return count;
}

/**
 * Return the neighborhood graph for one company: the company itself plus every
 * directly-connected company (in either direction), and the edges between them.
 */
export async function relationshipGraph(companyId: string): Promise<RelationshipGraphResult | null> {
  const self = await loadCompany(companyId);
  if (!self) return null;

  const edgeRows = await q<{
    from_company_id: string;
    to_company_id: string;
    edge_type: string;
    weight: number | string;
    detail: Record<string, unknown> | null;
  }>(
    `select from_company_id, to_company_id, edge_type, weight, detail
       from relationship_edges
      where from_company_id = $1 or to_company_id = $1`,
    [companyId],
  );

  const nodeIds = new Set<string>([companyId]);
  for (const e of edgeRows) {
    nodeIds.add(e.from_company_id);
    nodeIds.add(e.to_company_id);
  }

  const nodes: GraphNode[] =
    nodeIds.size > 0
      ? await q<GraphNode>(
          `select id, name, kind from companies where id = any($1::uuid[])`,
          [Array.from(nodeIds)],
        )
      : [{ id: self.id, name: self.name, kind: self.kind }];

  const edges: GraphEdge[] = edgeRows.map((e) => ({
    from: e.from_company_id,
    to: e.to_company_id,
    type: e.edge_type,
    weight: num(e.weight),
    detail: e.detail ?? null,
  }));

  return { company_id: companyId, nodes, edges };
}

export type RelatedPackage = {
  id: string;
  category: string;
  status: string;
  building_id: string;
  building_name: string;
  relation: "same_project" | "same_trade_portfolio";
};

/**
 * Procurement Graph G-02b (docs/ai-layer-design.md section 3.2):
 * package-to-package relatedness. Deliberately NOT stored/materialized
 * edges (packages are not companies - relationship_edges's schema is
 * company-to-company only) and deliberately NOT cross-tenant: this only
 * ever returns packages from the SAME developer company as the input
 * package (either the same building, or the same trade category elsewhere
 * in that company's own portfolio), never another developer's packages.
 * Surfacing "similar packages at other companies" would be a cross-tenant
 * competitive-intelligence feature this document's design explicitly does
 * not propose. Computed on demand, no new table, matching this codebase's
 * "recompute from source" convention.
 */
export async function relatedPackages(packageId: string): Promise<RelatedPackage[]> {
  const self = await q1<{ id: string; category: string; building_id: string; company_id: string | null }>(
    `select p.id, p.category, p.building_id, b.company_id
       from packages p join buildings b on b.id = p.building_id
      where p.id = $1`,
    [packageId],
  );
  if (!self || !self.company_id) return [];

  const sameProject = await q<RelatedPackage>(
    `select p.id, p.category, p.status, p.building_id, b.name as building_name,
            'same_project' as relation
       from packages p join buildings b on b.id = p.building_id
      where p.building_id = $1 and p.id != $2
      order by p.created_at desc`,
    [self.building_id, self.id],
  );

  const sameTradeElsewhere = await q<RelatedPackage>(
    `select p.id, p.category, p.status, p.building_id, b.name as building_name,
            'same_trade_portfolio' as relation
       from packages p join buildings b on b.id = p.building_id
      where b.company_id = $1 and p.category = $2 and p.building_id != $3 and p.id != $4
      order by p.created_at desc
      limit 25`,
    [self.company_id, self.category, self.building_id, self.id],
  );

  return [...sameProject, ...sameTradeElsewhere];
}

// ---------------------------------------------------------------------------
// 3) War Room
// ---------------------------------------------------------------------------

type BuildingRow = { id: string; name: string; company_id: string | null };

/**
 * Per-project health scan. Returns ranked flags across documents, submittals,
 * deliveries, awarded-bid relationship coverage, fee-rule gaps and bid thinness.
 */
export async function warRoom(buildingId: string): Promise<{
  building: { id: string; name: string } | null;
  flags: WarRoomFlag[];
} | null> {
  const b = await q1<BuildingRow>(`select id, name, company_id from buildings where id = $1`, [buildingId]);
  if (!b) return null;
  const flags: WarRoomFlag[] = [];
  const link = `/building/${b.id}`;

  // ---- Missing project documents -----------------------------------------
  const docCount = num(
    (await q1<{ n: number }>(`select count(*)::int as n from documents where building_id = $1`, [b.id]))?.n,
  );
  if (docCount === 0) {
    flags.push({
      level: "medium",
      title: "No project documents uploaded",
      detail: `Project "${b.name}" has no documents on file. Upload plans, specs or contracts to support its packages.`,
      link,
    });
  }

  // ---- Overdue submittals (not approved, package deadline passed) ---------
  const overdueSubs = await q<{ title: string; current_status: string; deadline: string | null }>(
    `select s.title, s.current_status, p.deadline
       from submittals s
       join packages p on p.id = s.package_id
       join buildings b on b.id = p.building_id
      where b.id = $1
        and s.current_status not in ('approved')
        and p.deadline is not null
        and p.deadline < current_date`,
    [b.id],
  );
  for (const s of overdueSubs) {
    flags.push({
      level: "high",
      title: "Overdue submittal not approved",
      detail: `Submittal "${s.title}" is "${s.current_status}" and the package deadline (${s.deadline}) has passed.`,
      link,
    });
  }

  // ---- Late / blocked deliveries -----------------------------------------
  const lateDeliveries = await q<{
    id: string;
    status: string;
    expected_delivery: string | null;
    completion_date: string | null;
    vendor: string | null;
  }>(
    `select d.id, d.status, d.expected_delivery, d.completion_date, c.name as vendor
       from deliveries d
       join packages p on p.id = d.package_id
       join buildings b on b.id = p.building_id
       left join companies c on c.id = d.vendor_company_id
      where b.id = $1
        and d.completion_date is null
        and (
             (d.expected_delivery is not null and d.expected_delivery < current_date)
          or d.status in ('blocked','delayed','on_hold')
        )`,
    [b.id],
  );
  for (const d of lateDeliveries) {
    const blocked = ["blocked", "delayed", "on_hold"].includes(String(d.status));
    flags.push({
      level: blocked ? "high" : "medium",
      title: blocked ? "Delivery blocked or delayed" : "Delivery past expected date",
      detail: `${d.vendor ?? "Vendor"} delivery is "${d.status}"${
        d.expected_delivery ? ` (expected ${d.expected_delivery})` : ""
      } and not yet complete.`,
      link,
    });
  }

  // ---- Awarded bid to a vendor with no approved relationship -------------
  const orphanAwards = await q<{ vendor_company_id: string; vendor: string | null }>(
    `select distinct bd.vendor_company_id, c.name as vendor
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
       left join companies c on c.id = bd.vendor_company_id
      where b.id = $1 and bd.awarded = true and bd.vendor_company_id is not null
        and not exists (
          select 1 from developer_vendor_relationships dvr
           where dvr.vendor_company_id = bd.vendor_company_id
             and dvr.developer_company_id = b.company_id
             and dvr.relationship_status in ('grandfathered_2_percent','standard_fee')
        )`,
    [b.id],
  );
  for (const o of orphanAwards) {
    flags.push({
      level: "medium",
      title: "Awarded vendor has no confirmed fee relationship",
      detail: `${o.vendor ?? "A vendor"} was awarded work but has no confirmed fee relationship on record. Confirm the relationship and fee rule.`,
      link: "/relationships",
    });
  }

  // ---- Fee-rule gaps: relationships pending admin review -----------------
  if (b.company_id) {
    const pending = num(
      (await q1<{ n: number }>(
        `select count(*)::int as n from developer_vendor_relationships
          where developer_company_id = $1 and admin_review_status = 'pending_review'`,
        [b.company_id],
      ))?.n,
    );
    if (pending > 0) {
      flags.push({
        level: "low",
        title: "Relationship fee awaiting admin confirmation",
        detail: `${pending} vendor relationship${pending === 1 ? "" : "s"} pending admin review for the grandfathered fee.`,
        link: "/relationships",
      });
    }
  }

  // ---- Too few bids on open packages -------------------------------------
  const thinPackages = await q<{ id: string; category: string; bid_count: number }>(
    `select p.id, p.category,
            (select count(*) from bids bd
              where bd.package_id = p.id and coalesce(bd.is_draft, false) = false)::int as bid_count
       from packages p
       join buildings b on b.id = p.building_id
      where b.id = $1 and p.status in ('open','shortlisting')`,
    [b.id],
  );
  for (const p of thinPackages) {
    if (num(p.bid_count) === 0) {
      flags.push({
        level: "high",
        title: "Open package has no bids",
        detail: `Package "${p.category}" is open with no bids. Invite vendors to keep the project on schedule.`,
        link: `/package/${p.id}`,
      });
    } else if (num(p.bid_count) < 3) {
      flags.push({
        level: "low",
        title: "Open package has thin bid coverage",
        detail: `Package "${p.category}" has only ${p.bid_count} bid${num(p.bid_count) === 1 ? "" : "s"}. Three or more gives better price competition.`,
        link: `/package/${p.id}`,
      });
    }
  }

  return { building: { id: b.id, name: b.name }, flags: rankFlags(flags) };
}

/**
 * Portfolio war room: aggregate ranked flags across every building owned by a
 * developer company, each flag tagged with the originating project.
 */
export async function portfolioWarRoom(companyId: string): Promise<{
  company_id: string;
  building_count: number;
  flags: Array<WarRoomFlag & { building_id: string; building_name: string }>;
}> {
  const buildings = await q<{ id: string; name: string }>(
    `select id, name from buildings where company_id = $1 order by created_at desc`,
    [companyId],
  );

  const all: Array<WarRoomFlag & { building_id: string; building_name: string }> = [];
  for (const b of buildings) {
    const room = await warRoom(b.id);
    if (!room) continue;
    for (const f of room.flags) {
      all.push({ ...f, building_id: b.id, building_name: b.name });
    }
  }

  const ranked = all
    .map((f, i) => ({ f, i }))
    .sort((a, b) => LEVEL_RANK[a.f.level] - LEVEL_RANK[b.f.level] || a.i - b.i)
    .map((x) => x.f);

  return { company_id: companyId, building_count: buildings.length, flags: ranked };
}
