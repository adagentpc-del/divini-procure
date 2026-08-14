/**
 * Divini Blueprint - BUDGET LINE TO PACKAGE MATCHER (pure, no IO).
 *
 * Deterministic keyword-overlap matching between an imported budget row's
 * category/description text and an existing project's bid packages. Never
 * a "smart"/fuzzy AI match - every result is inspectable (which words
 * overlapped) and always shown to the user as a suggestion, never silently
 * applied. Matches section 17's "map budget lines to bid packages, identify
 * unmapped lines" requirement without claiming any capability this
 * codebase does not have.
 *
 * Zero em dashes by convention.
 */

export type BudgetMapCandidate = { packageId: string; category: string };
export type BudgetMapResult = { packageId: string; category: string; confidence: "medium" | "low" } | null;

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * An exact (case-insensitive, trimmed) category-name match is the
 * strongest signal available and is "medium" confidence on its own.
 * Otherwise, the candidate whose category shares the most significant
 * words with the row's category+description wins: 2+ shared words is
 * "medium", exactly 1 is "low", 0 shared words is no match at all.
 */
export function matchBudgetRowToPackage(
  row: { category: string; description: string },
  candidates: BudgetMapCandidate[],
): BudgetMapResult {
  if (candidates.length === 0) return null;

  const rowCategory = row.category.trim().toLowerCase();
  if (rowCategory) {
    const exact = candidates.find((c) => c.category.trim().toLowerCase() === rowCategory);
    if (exact) return { packageId: exact.packageId, category: exact.category, confidence: "medium" };
  }

  const rowWords = new Set([...words(row.category), ...words(row.description)]);
  if (rowWords.size === 0) return null;

  let best: { candidate: BudgetMapCandidate; overlap: number } | null = null;
  for (const c of candidates) {
    const catWords = words(c.category);
    if (catWords.size === 0) continue;
    let overlap = 0;
    for (const w of catWords) if (rowWords.has(w)) overlap++;
    if (overlap === 0) continue;
    if (!best || overlap > best.overlap) best = { candidate: c, overlap };
  }
  if (!best) return null;
  return { packageId: best.candidate.packageId, category: best.candidate.category, confidence: best.overlap >= 2 ? "medium" : "low" };
}
