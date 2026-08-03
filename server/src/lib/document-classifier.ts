/**
 * Divini Blueprint - DOCUMENT CLASSIFICATION (pure, no IO).
 *
 * Deterministic filename/extension classification: this is the "failure
 * fallback" baseline the spec requires ("must work without an LLM") and the
 * ONLY classification this module can honestly claim to do - it reads a
 * filename and extension, never the actual drawing/CAD/PDF content (no
 * OCR or CAD-parsing library exists in this codebase). An optional LLM step
 * elsewhere may draft additional narrative from this classification plus
 * user-supplied text, but it never reads inside the files either.
 *
 * Zero em dashes by convention.
 */

export type Discipline =
  | "architectural" | "civil" | "structural" | "mechanical" | "electrical"
  | "plumbing" | "fire_protection" | "landscape" | "interior" | "survey"
  | "geotechnical" | "environmental" | "general";

export type DocumentCategory =
  | "drawing" | "specification" | "schedule" | "budget" | "estimate"
  | "survey" | "geotechnical_report" | "environmental_report" | "permit"
  | "contract" | "photo" | "rendering" | "addendum" | "other";

export interface ClassificationResult {
  category: DocumentCategory;
  discipline: Discipline;
  isCadFile: boolean;
  confidence: "high" | "medium" | "low";
  matchedRule: string;
}

const CAD_EXTENSIONS = new Set([
  "dwg", "dxf", "dgn", "ifc", "rvt", "rfa", "nwc", "nwd",
  "step", "stp", "iges", "igs", "skp", "obj", "stl", "3dm", "pln",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff", "heic", "gif"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);

/** Ordered filename keyword rules: first match wins. Order matters (more specific first). */
const KEYWORD_RULES: { pattern: RegExp; category: DocumentCategory; discipline: Discipline }[] = [
  { pattern: /\b(spec|specification|project manual|csi)\b/i, category: "specification", discipline: "general" },
  { pattern: /\b(addendum|addenda)\b/i, category: "addendum", discipline: "general" },
  { pattern: /\b(budget)\b/i, category: "budget", discipline: "general" },
  { pattern: /\b(estimate|cost estimate)\b/i, category: "estimate", discipline: "general" },
  { pattern: /\b(bid tab|schedule of values|sov|quantity takeoff|takeoff)\b/i, category: "schedule", discipline: "general" },
  { pattern: /\b(schedule|door schedule|window schedule|finish schedule|fixture schedule)\b/i, category: "schedule", discipline: "general" },
  { pattern: /\b(geotech|soil report|boring log)\b/i, category: "geotechnical_report", discipline: "geotechnical" },
  { pattern: /\b(environmental|phase i|phase 1 esa)\b/i, category: "environmental_report", discipline: "environmental" },
  { pattern: /\b(survey|topographic|boundary survey)\b/i, category: "survey", discipline: "survey" },
  { pattern: /\b(permit|entitlement|zoning)\b/i, category: "permit", discipline: "general" },
  { pattern: /\b(contract|agreement|proposal)\b/i, category: "contract", discipline: "general" },
  { pattern: /\b(rendering|render|3d view|perspective)\b/i, category: "rendering", discipline: "general" },
  { pattern: /\b(photo|site photo|existing conditions photo)\b/i, category: "photo", discipline: "general" },
  { pattern: /\b(civil|grading|site plan|utility plan|c-\d)\b/i, category: "drawing", discipline: "civil" },
  { pattern: /\b(structural|foundation|framing plan|s-\d)\b/i, category: "drawing", discipline: "structural" },
  { pattern: /\b(mechanical|hvac|m-\d)\b/i, category: "drawing", discipline: "mechanical" },
  { pattern: /\b(electrical|lighting plan|power plan|e-\d)\b/i, category: "drawing", discipline: "electrical" },
  { pattern: /\b(plumbing|p-\d)\b/i, category: "drawing", discipline: "plumbing" },
  { pattern: /\b(fire protection|sprinkler|fp-\d)\b/i, category: "drawing", discipline: "fire_protection" },
  { pattern: /\b(landscape|irrigation|l-\d)\b/i, category: "drawing", discipline: "landscape" },
  { pattern: /\b(interior|millwork|id-\d)\b/i, category: "drawing", discipline: "interior" },
  { pattern: /\b(architectural|floor plan|elevation|section|a-\d)\b/i, category: "drawing", discipline: "architectural" },
];

/**
 * Classify a document from its filename and extension only. Never claims to
 * have read the file's content - confidence is capped at "medium" for any
 * keyword match, and CAD/image files with no keyword match are "low"
 * confidence, generic "drawing" guesses (the extension strongly implies a
 * drawing, but the discipline is unknown without reading it).
 */
export function classifyDocument(filename: string, extension: string): ClassificationResult {
  const ext = (extension || "").toLowerCase().replace(/^\./, "");
  const isCadFile = CAD_EXTENSIONS.has(ext);
  const name = filename || "";

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(name)) {
      return { category: rule.category, discipline: rule.discipline, isCadFile, confidence: "medium", matchedRule: rule.pattern.source };
    }
  }

  if (isCadFile) {
    return { category: "drawing", discipline: "general", isCadFile: true, confidence: "low", matchedRule: "cad_extension_only" };
  }
  if (ext === "pdf") {
    return { category: "drawing", discipline: "general", isCadFile: false, confidence: "low", matchedRule: "pdf_default" };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { category: "photo", discipline: "general", isCadFile: false, confidence: "low", matchedRule: "image_extension_only" };
  }
  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    return { category: "schedule", discipline: "general", isCadFile: false, confidence: "low", matchedRule: "spreadsheet_extension_only" };
  }
  return { category: "other", discipline: "general", isCadFile: false, confidence: "low", matchedRule: "no_match" };
}
