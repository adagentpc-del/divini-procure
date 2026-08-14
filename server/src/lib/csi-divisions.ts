/**
 * Divini Blueprint - CSI DIVISION LOOKUP (pure, no IO).
 *
 * The standard 2004 MasterFormat division numbers/titles named in the CAD/
 * Drawing/Plan/Specification/Bid Intelligence master spec section 11. A
 * document's division is only ever a GUESS derived from its already-
 * classified discipline (see document-classifier.ts) - this codebase
 * cannot read specification text, so it can never confirm which division
 * a document actually covers. Confidence is always "low" and every guess
 * is user-overridable and never silently reapplied over a user's override
 * (same pattern as document category/discipline overrides).
 *
 * Zero em dashes by convention.
 */
import type { Discipline } from "./document-classifier.js";

export type CsiDivision = { code: string; name: string };

export const CSI_DIVISIONS: CsiDivision[] = [
  { code: "00", name: "Procurement and Contracting Requirements" },
  { code: "01", name: "General Requirements" },
  { code: "02", name: "Existing Conditions" },
  { code: "03", name: "Concrete" },
  { code: "04", name: "Masonry" },
  { code: "05", name: "Metals" },
  { code: "06", name: "Wood, Plastics, and Composites" },
  { code: "07", name: "Thermal and Moisture Protection" },
  { code: "08", name: "Openings" },
  { code: "09", name: "Finishes" },
  { code: "10", name: "Specialties" },
  { code: "11", name: "Equipment" },
  { code: "12", name: "Furnishings" },
  { code: "13", name: "Special Construction" },
  { code: "14", name: "Conveying Equipment" },
  { code: "21", name: "Fire Suppression" },
  { code: "22", name: "Plumbing" },
  { code: "23", name: "HVAC" },
  { code: "25", name: "Integrated Automation" },
  { code: "26", name: "Electrical" },
  { code: "27", name: "Communications" },
  { code: "28", name: "Electronic Safety and Security" },
  { code: "31", name: "Earthwork" },
  { code: "32", name: "Exterior Improvements" },
  { code: "33", name: "Utilities" },
];

// A discipline can only be mapped to ONE division here (this is a guess
// from a filename-derived discipline, not content), so where a discipline
// legitimately spans multiple real-world divisions (e.g. structural work
// touches both 03 Concrete and 05 Metals) this picks the single most
// common one - the same simplification trade-suggester.ts already makes
// for the same discipline. Disciplines with no reasonable single division
// (survey, geotechnical, environmental, general) are intentionally absent.
const DISCIPLINE_TO_DIVISION: Partial<Record<Discipline, string>> = {
  civil: "31",
  structural: "05",
  mechanical: "23",
  electrical: "26",
  plumbing: "22",
  fire_protection: "21",
  landscape: "32",
  interior: "09",
  architectural: "08",
};

export function divisionByCode(code: string): CsiDivision | null {
  return CSI_DIVISIONS.find((d) => d.code === code) ?? null;
}

/** A low-confidence guess at a document's primary CSI division, from its already-classified discipline. Null when there is no reasonable single-division mapping for that discipline. */
export function guessCsiDivision(discipline: Discipline): CsiDivision | null {
  const code = DISCIPLINE_TO_DIVISION[discipline];
  return code ? divisionByCode(code) : null;
}

/**
 * Given the disciplines actually present among a project's DRAWINGS and the
 * CSI division codes actually tagged among its SPECIFICATION documents,
 * return the divisions a drawing discipline implies but no specification
 * document has been tagged with. This is a classification-derived signal,
 * not proof a specification section is missing - documents may exist but
 * be misclassified, or a division may be embedded in a combined document.
 */
export function missingDivisionsForDrawingDisciplines(
  drawingDisciplines: Discipline[],
  specDivisionCodesPresent: string[],
): CsiDivision[] {
  const present = new Set(specDivisionCodesPresent);
  const seen = new Set<string>();
  const missing: CsiDivision[] = [];
  for (const discipline of drawingDisciplines) {
    const division = guessCsiDivision(discipline);
    if (!division || present.has(division.code) || seen.has(division.code)) continue;
    seen.add(division.code);
    missing.push(division);
  }
  return missing;
}
