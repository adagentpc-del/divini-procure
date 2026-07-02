/**
 * Divini Procure - DEVELOPER TRUST SCORE.
 *
 * A 0..100 REPUTATIONAL score for a sponsor/developer, built from the exact
 * signals passive LPs say they vet: verification, track record, team, and
 * alignment (co-invest, rate caps, true preferred return). It is a rating of the
 * OPERATOR's transparency and credibility - never of any investment or expected
 * return - so it stays clear of investment-advice territory.
 *
 * The compute is a PURE function so it can be reasoned about and tested without a
 * database. Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";

export interface TrustProfile {
  company_id: string;
  years_operating: number | null;
  projects_completed: number | null;
  total_value_cents: number | null;
  team_size: number | null;
  markets: string[] | null;
  full_cycle_track_record: boolean | null;
  full_cycle_detail: string | null;
  co_invests: boolean | null;
  uses_rate_caps: boolean | null;
  preferred_return_structure: string | null;
  identity_verified: boolean | null;
  entity_verified: boolean | null;
}

export interface TrustFactor { label: string; points: number; max: number }
export interface TrustScore {
  score: number;
  band: "new" | "building" | "established" | "trusted";
  factors: TrustFactor[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Deterministic 0..100 trust score from a (possibly sparse) profile. */
export function computeTrust(p: Partial<TrustProfile> | null): TrustScore {
  const factors: TrustFactor[] = [];
  const add = (label: string, points: number, max: number) => factors.push({ label, points: Math.round(points), max });

  add("Identity verified", p?.identity_verified ? 15 : 0, 15);
  add("Entity verified", p?.entity_verified ? 15 : 0, 15);

  const years = Number(p?.years_operating ?? 0);
  add("Years operating", clamp((years / 5) * 15, 0, 15), 15);

  const projects = Number(p?.projects_completed ?? 0);
  add("Projects completed", clamp((projects / 10) * 15, 0, 15), 15);

  add("Team (2+ partners)", Number(p?.team_size ?? 0) >= 2 ? 10 : 0, 10);

  add("Full-cycle track record shared", p?.full_cycle_track_record ? 15 : 0, 15);

  let alignment = 0;
  if (p?.co_invests) alignment += 8;
  if (p?.uses_rate_caps) alignment += 5;
  if (p?.preferred_return_structure && String(p.preferred_return_structure).trim()) alignment += 2;
  add("Alignment (co-invest, caps, pref)", clamp(alignment, 0, 15), 15);

  const score = clamp(Math.round(factors.reduce((s, f) => s + f.points, 0)), 0, 100);
  const band = score >= 75 ? "trusted" : score >= 50 ? "established" : score >= 25 ? "building" : "new";
  return { score, band, factors };
}

export async function getTrustProfile(companyId: string): Promise<TrustProfile | null> {
  return q1<TrustProfile>(`select * from developer_trust_profiles where company_id = $1`, [companyId]);
}

const EDITABLE = [
  "years_operating",
  "projects_completed",
  "total_value_cents",
  "team_size",
  "markets",
  "full_cycle_track_record",
  "full_cycle_detail",
  "co_invests",
  "uses_rate_caps",
  "preferred_return_structure",
] as const;

/** Upsert the editable fields of a developer trust profile (verification flags are admin-set elsewhere). */
export async function upsertTrustProfile(
  companyId: string,
  patch: Record<string, unknown>,
): Promise<TrustProfile> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const c of EDITABLE) {
    if (patch[c] !== undefined) {
      cols.push(c);
      vals.push(patch[c]);
    }
  }
  if (cols.length === 0) {
    const existing = await getTrustProfile(companyId);
    if (existing) return existing;
    return (await q1<TrustProfile>(
      `insert into developer_trust_profiles (company_id) values ($1)
       on conflict (company_id) do update set updated_at = now() returning *`,
      [companyId],
    ))!;
  }
  const insertCols = ["company_id", ...cols];
  const insertPlaceholders = insertCols.map((_c, i) => `$${i + 1}`);
  const updates = cols.map((c, i) => `${c} = $${i + 2}`);
  const row = await q1<TrustProfile>(
    `insert into developer_trust_profiles (${insertCols.join(",")})
     values (${insertPlaceholders.join(",")})
     on conflict (company_id) do update set ${updates.join(",")}, updated_at = now()
     returning *`,
    [companyId, ...vals],
  );
  return row!;
}

/** Profile + computed score in one shot. */
export async function getTrustScore(companyId: string): Promise<TrustScore & { profile: TrustProfile | null }> {
  const profile = await getTrustProfile(companyId);
  return { ...computeTrust(profile), profile };
}
