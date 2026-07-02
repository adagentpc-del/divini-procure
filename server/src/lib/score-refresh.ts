/**
 * Divini Procure - feedback-driven score refresh.
 *
 * When a review/rating is written for a company we want that company's
 * Divini Score (lib/procure-moat.ts) and Business Health (lib/procure-coo.ts)
 * to be recomputed and re-persisted, so the stored snapshots stay fresh
 * instead of only being computed on demand when a dashboard asks for them.
 *
 * BEST-EFFORT: refreshCompanyScores never throws. Callers fire it as
 * `void refreshCompanyScores(id)` so a slow or failing recompute can never
 * block, fail, or roll back the request that triggered it (for example the
 * response to a review insert). Errors are swallowed and logged only.
 *
 * Both diviniScore() and businessHealth() write their own snapshot rows
 * (divini_scores / business_health_scores) as a side effect, so simply
 * calling them is what keeps the stored scores up to date.
 *
 * Zero em dashes by convention.
 */
import { diviniScore } from "./procure-moat.js";
import { businessHealth } from "./procure-coo.js";

/**
 * Recompute and re-persist a company's Divini Score and Business Health.
 * Best-effort: each recompute is isolated so one failing does not stop the
 * other, and the function as a whole never rejects.
 */
export async function refreshCompanyScores(companyId: string): Promise<void> {
  if (!companyId) return;

  try {
    await diviniScore(companyId);
  } catch (err) {
    console.error(`[score-refresh] diviniScore failed for ${companyId}:`, err);
  }

  try {
    await businessHealth(companyId);
  } catch (err) {
    console.error(`[score-refresh] businessHealth failed for ${companyId}:`, err);
  }
}

/**
 * Alias fired after a review/rating is written for a company. Recomputes both
 * the ratee company's Divini Score and Business Health. Best-effort and
 * non-blocking by the same contract as refreshCompanyScores.
 */
export async function refreshAfterReview(rateeCompanyId: string): Promise<void> {
  return refreshCompanyScores(rateeCompanyId);
}
