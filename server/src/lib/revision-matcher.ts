/**
 * Deterministic filename-based "possible revision of" suggester for Divini
 * Blueprint. No content reading - compares normalized base filenames only,
 * after stripping common revision/version/addendum tokens. This never
 * returns a confirmed match: callers always require an explicit user
 * confirmation (POST /blueprint/documents/:id/link-revision) before two
 * documents are actually linked as revisions of each other.
 *
 * Zero em dashes by convention.
 */

export type RevisionMatch = { documentId: string; name: string; confidence: "medium" | "low" };

const REVISION_TOKEN = /\b(rev|revision|r|v|version|addendum|add)[\s_-]?\d+\b/gi;

function normalize(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]+$/, "");
  return withoutExt
    .toLowerCase()
    .replace(REVISION_TOKEN, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * `candidates` should already exclude the document being matched. Sorted
 * with the strongest (exact normalized-name) matches first.
 */
export function suggestRevisionMatches(
  newName: string,
  candidates: { id: string; name: string }[],
): RevisionMatch[] {
  const base = normalize(newName);
  if (!base) return [];
  const medium: RevisionMatch[] = [];
  const low: RevisionMatch[] = [];
  for (const c of candidates) {
    const candBase = normalize(c.name);
    if (!candBase) continue;
    if (candBase === base) {
      medium.push({ documentId: c.id, name: c.name, confidence: "medium" });
    } else if (base.length > 3 && candBase.length > 3 && (base.includes(candBase) || candBase.includes(base))) {
      low.push({ documentId: c.id, name: c.name, confidence: "low" });
    }
  }
  return [...medium, ...low];
}
