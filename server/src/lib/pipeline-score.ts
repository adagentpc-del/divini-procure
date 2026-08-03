/**
 * Divini Pipeline - OPPORTUNITY READINESS SCORE (pure, no IO).
 *
 * Deterministic, rule-based, and fully explainable: every point on the score
 * traces back to a specific stored field or a computed recency check, never
 * a generated judgment. This is NOT a prediction of whether the opportunity
 * will close - it is a checklist of "is this opportunity in good shape,"
 * surfaced as a score plus the exact positives/missing list that produced it.
 *
 * Zero em dashes by convention.
 */

export interface OpportunitySignals {
  estimatedValueCents?: number | string | null;
  nextAction?: string | null;
  nextActionDate?: string | Date | null;
  expectedCloseDate?: string | Date | null;
  category?: string | null;
  packageId?: string | null;
  bidId?: string | null;
  clientCompanyId?: string | null;
  clientEmail?: string | null;
  lastActivityAt?: string | Date | null;
  hasOpenTask?: boolean;
  hasOverdueTask?: boolean;
}

export interface ReadinessFactor {
  code: string;
  label: string;
  missingLabel: string;
  points: number;
  met: boolean;
}

export interface ReadinessResult {
  score: number;
  positives: string[];
  missing: string[];
  factors: ReadinessFactor[];
}

/** How recent "recent activity" means, in days. */
export const RECENT_ACTIVITY_DAYS = 14;

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Score an opportunity's readiness 0-100. Every factor is worth a fixed,
 * documented number of points that sum to exactly 100 when all are met.
 * Returns the factor-by-factor breakdown so the UI can show "why this score"
 * rather than a bare number.
 */
export function scoreOpportunityReadiness(
  signals: OpportunitySignals,
  now: Date = new Date(),
): ReadinessResult {
  const factors: ReadinessFactor[] = [];

  const hasValue = num(signals.estimatedValueCents) > 0;
  factors.push({ code: "value", label: "Estimated value set", missingLabel: "Estimated value not set", points: 15, met: hasValue });

  const hasNextAction = !!(signals.nextAction && toDate(signals.nextActionDate));
  factors.push({ code: "next_action", label: "Next action scheduled", missingLabel: "Next action not scheduled", points: 15, met: hasNextAction });

  const hasCloseDate = !!toDate(signals.expectedCloseDate);
  factors.push({ code: "close_date", label: "Expected close date set", missingLabel: "Expected close date not set", points: 10, met: hasCloseDate });

  const hasCategory = !!signals.category;
  factors.push({ code: "category", label: "Category set", missingLabel: "Category not set", points: 5, met: hasCategory });

  const isLinked = !!(signals.packageId || signals.bidId);
  factors.push({ code: "linked", label: "Linked to a real bid package", missingLabel: "Not yet linked to a bid package", points: 15, met: isLinked });

  const hasContact = !!(signals.clientCompanyId || signals.clientEmail);
  factors.push({ code: "contact", label: "Client contact on file", missingLabel: "Client contact info missing", points: 10, met: hasContact });

  const lastActivity = toDate(signals.lastActivityAt);
  const daysSinceActivity = lastActivity ? (now.getTime() - lastActivity.getTime()) / 86_400_000 : null;
  const isRecent = daysSinceActivity != null && daysSinceActivity <= RECENT_ACTIVITY_DAYS;
  factors.push({
    code: "recent_activity",
    label: `Activity logged in the last ${RECENT_ACTIVITY_DAYS} days`,
    missingLabel: `No activity in the last ${RECENT_ACTIVITY_DAYS} days`,
    points: 15,
    met: isRecent,
  });

  const taskOnTrack = !!signals.hasOpenTask && !signals.hasOverdueTask;
  factors.push({
    code: "task_on_track",
    label: "Open task, not overdue",
    missingLabel: signals.hasOverdueTask ? "Has an overdue task" : "No open task",
    points: 15,
    met: taskOnTrack,
  });

  let score = 0;
  const positives: string[] = [];
  const missing: string[] = [];
  for (const f of factors) {
    if (f.met) {
      score += f.points;
      positives.push(f.label);
    } else {
      missing.push(f.missingLabel);
    }
  }

  return { score: Math.max(0, Math.min(100, score)), positives, missing, factors };
}
