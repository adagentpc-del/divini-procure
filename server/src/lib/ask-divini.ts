/**
 * Ask Divini - narrow first slice (docs/ai-layer-design.md section 4 and 7).
 *
 * Single-project, financial-questions-only. The one hard security rule from
 * the design doc: this NEVER writes or executes its own database query. It
 * only narrates a pre-computed, pre-authorized JSON payload assembled from
 * the EXISTING canonical financial-summary services (Phase 1) - the exact
 * same retrieval-then-narrate pattern already used by
 * routes/intel.ts's quote-comparison narrative ("Use ONLY the numbers
 * provided... do not invent figures").
 *
 * Route-level authorization (developer/admin only, same as
 * financial-summary.ts) happens BEFORE this module is ever called - this
 * module assumes the caller has already been authorized for buildingId and
 * does no authorization of its own, matching computeProjectFinancialSummary's
 * own contract.
 *
 * Zero em dashes by convention.
 */
import { q } from "../pool.js";
import { computeProjectFinancialSummary, computePackageFinancialSummary } from "./financial-summary.js";
import { llmEnabled, llmText } from "./llm.js";
import { TtlCache, hashInput } from "./cache.js";

export interface AskDiviniAnswer {
  ok: boolean;
  answer: string | null;
  reason?: string;
  disclosure: string;
}

const DISCLOSURE =
  "AI-generated summary of your own project's financial data. Every figure comes from Divini Procure's canonical financial records, never invented by the AI - verify against the Project Financials panel for the authoritative numbers.";

const answerCache = new TtlCache<string>();
const ANSWER_TTL_MS = 15 * 60_000;
const MAX_QUESTION_LENGTH = 400;

/**
 * Pre-computed, pre-scoped payload for one project: the project financial
 * summary plus each package's own summary and identifying label (trade
 * category, status). This IS the entire universe of facts Ask Divini is
 * allowed to answer from - nothing else is ever passed into the prompt.
 */
export async function buildProjectPayload(buildingId: string): Promise<Record<string, unknown> | null> {
  const building = await q<{ id: string; name: string }>(`select id, name from buildings where id = $1`, [
    buildingId,
  ]);
  if (building.length === 0) return null;

  const projectSummary = await computeProjectFinancialSummary(buildingId);
  if (!projectSummary) return null;

  const packages = await q<{ id: string; category: string; status: string }>(
    `select id, category, status from packages where building_id = $1 order by created_at`,
    [buildingId],
  );
  const packageSummaries = (
    await Promise.all(
      packages.map(async (p) => {
        const s = await computePackageFinancialSummary(p.id);
        if (!s) return null;
        return {
          category: p.category,
          packageStatus: p.status,
          financialStatus: s.status,
          allowanceCurrentCents: s.allowanceCurrentCents,
          revisedCommitmentCents: s.revisedCommitmentCents,
          invoicedGrossCents: s.invoicedGrossCents,
          paidCents: s.paidCents,
          retainageHeldCents: s.retainageHeldCents,
          varianceCents: s.varianceCents,
          forecastFinalCents: s.forecastFinalCents,
        };
      }),
    )
  ).filter((s): s is NonNullable<typeof s> => s != null);

  return {
    projectName: building[0].name,
    budgetHealth: projectSummary.budgetHealth,
    budgetOriginalCents: projectSummary.budgetOriginalCents,
    budgetCurrentCents: projectSummary.budgetCurrentCents,
    contingencyCents: projectSummary.contingencyCents,
    allocatedCents: projectSummary.allocatedCents,
    unallocatedCents: projectSummary.unallocatedCents,
    allocationState: projectSummary.allocationState,
    committedCents: projectSummary.committedCents,
    contractedCents: projectSummary.contractedCents,
    approvedChangeOrdersCents: projectSummary.approvedChangeOrdersCents,
    revisedCommitmentCents: projectSummary.revisedCommitmentCents,
    invoicedGrossCents: projectSummary.invoicedGrossCents,
    approvedForPaymentCents: projectSummary.approvedForPaymentCents,
    paidCents: projectSummary.paidCents,
    retainageHeldCents: projectSummary.retainageHeldCents,
    remainingCommitmentCents: projectSummary.remainingCommitmentCents,
    forecastAtCompletionCents: projectSummary.forecastAtCompletionCents,
    varianceCents: projectSummary.varianceCents,
    packageCount: projectSummary.packageCount,
    packagesOverAllowance: projectSummary.packagesOverAllowance,
    packages: packageSummaries,
  };
}

/**
 * Answer a natural-language question about ONE project's financial state.
 * Never throws for a disabled/failed LLM - returns ok:false with a reason
 * instead, matching this codebase's established "AI is optional enrichment,
 * never a hard dependency" contract.
 */
export async function askAboutProject(buildingId: string, question: string): Promise<AskDiviniAnswer> {
  const trimmed = question.trim().slice(0, MAX_QUESTION_LENGTH);
  if (!trimmed) {
    return { ok: false, answer: null, reason: "question required", disclosure: DISCLOSURE };
  }
  if (!llmEnabled()) {
    return { ok: false, answer: null, reason: "AI is not enabled on this deployment", disclosure: DISCLOSURE };
  }

  const payload = await buildProjectPayload(buildingId);
  if (!payload) {
    return { ok: false, answer: null, reason: "project not found", disclosure: DISCLOSURE };
  }

  // Cache key includes the question text AND a hash of the payload, so the
  // moment any underlying number changes (a new invoice, an approved change
  // order) the cache naturally misses and the answer is recomputed - never
  // manually invalidated, never stale beyond the TTL.
  const cacheKey = `ask-divini:${buildingId}:${hashInput({ question: trimmed, payload })}`;
  const cached = answerCache.get(cacheKey);
  if (cached !== undefined) {
    return { ok: true, answer: cached, disclosure: DISCLOSURE };
  }

  const system =
    "You are Ask Divini, a financial data assistant for a construction procurement platform. " +
    "You answer ONLY using the JSON data provided below - it is the complete and authoritative set " +
    "of financial facts for this project, already computed correctly by the platform. " +
    "You NEVER invent a number, NEVER estimate or predict a figure not present in the data, and NEVER " +
    "give legal, financial, or investment advice. If the data does not answer the question, say so " +
    "plainly instead of guessing. Money values are in cents; convert to dollars in your answer. " +
    "Keep the answer to 2-4 sentences, in plain language a real-estate developer would use " +
    "(Budget, Committed, Contracted, Invoiced, Paid, Retainage, Forecast, Variance).";

  const prompt = `Project financial data:\n${JSON.stringify(payload)}\n\nQuestion: ${trimmed}`;

  const text = await llmText(prompt, { system, timeoutMs: 15000 });
  const answer = text.trim() ? text.trim().slice(0, 1500) : null;
  if (!answer) {
    return { ok: false, answer: null, reason: "no answer generated", disclosure: DISCLOSURE };
  }
  answerCache.set(cacheKey, answer, ANSWER_TTL_MS);
  return { ok: true, answer, disclosure: DISCLOSURE };
}
