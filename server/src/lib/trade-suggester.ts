/**
 * Divini Blueprint - TRADE / BID-PACKAGE SUGGESTION (pure, no IO).
 *
 * Deterministic: given the set of disciplines present among a project's
 * classified documents (server/src/lib/document-classifier.ts), suggest
 * likely bid-package trades from a fixed lookup table. This is explicitly a
 * SUGGESTION, never an automatic package - the spec requires every suggested
 * package to be reviewed, merged, split, renamed, or rejected by the user
 * before anything is created. Confidence reflects how many documents support
 * the discipline, not how "complete" the trade's scope actually is - this
 * module has no way to know that from filenames alone.
 *
 * Zero em dashes by convention.
 */
import type { Discipline } from "./document-classifier.js";

export interface TradeSuggestion {
  tradeCategory: string;
  packageTitle: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  supportingDocumentCount: number;
}

/** Disciplines that always imply at least one likely trade package when present. */
const DISCIPLINE_TRADES: Record<Discipline, { tradeCategory: string; packageTitle: string }[]> = {
  architectural: [{ tradeCategory: "general_conditions", packageTitle: "General Contractor / General Conditions" }],
  civil: [{ tradeCategory: "site_civil", packageTitle: "Site & Civil" }],
  structural: [
    { tradeCategory: "concrete", packageTitle: "Concrete" },
    { tradeCategory: "structural_steel", packageTitle: "Structural Steel" },
  ],
  mechanical: [{ tradeCategory: "hvac", packageTitle: "HVAC" }],
  electrical: [{ tradeCategory: "electrical", packageTitle: "Electrical" }],
  plumbing: [{ tradeCategory: "plumbing", packageTitle: "Plumbing" }],
  fire_protection: [{ tradeCategory: "fire_protection", packageTitle: "Fire Protection / Sprinklers" }],
  landscape: [{ tradeCategory: "landscaping", packageTitle: "Landscaping & Irrigation" }],
  interior: [{ tradeCategory: "interior_finishes", packageTitle: "Interior Finishes & Millwork" }],
  survey: [],
  geotechnical: [],
  environmental: [],
  general: [],
};

/**
 * Suggest trade packages from a discipline -> supporting-document-count map
 * (build this from classifyDocument() results across a project's documents).
 * Confidence: 2+ supporting documents = medium, 1 = low. Never "high" - a
 * filename-only signal can't earn that on its own.
 */
export function suggestTrades(disciplineCounts: Partial<Record<Discipline, number>>): TradeSuggestion[] {
  const suggestions: TradeSuggestion[] = [];
  for (const [discipline, count] of Object.entries(disciplineCounts) as [Discipline, number][]) {
    if (!count || count <= 0) continue;
    const trades = DISCIPLINE_TRADES[discipline] ?? [];
    for (const trade of trades) {
      suggestions.push({
        tradeCategory: trade.tradeCategory,
        packageTitle: trade.packageTitle,
        rationale: `${count} uploaded document${count === 1 ? "" : "s"} classified as ${discipline.replace(/_/g, " ")}.`,
        confidence: count >= 2 ? "medium" : "low",
        supportingDocumentCount: count,
      });
    }
  }
  // Stable order: highest supporting-document-count first, then alphabetical.
  return suggestions.sort((a, b) => b.supportingDocumentCount - a.supportingDocumentCount || a.packageTitle.localeCompare(b.packageTitle));
}
