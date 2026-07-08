/**
 * RFQ Assist — CAD/spec file intake + DETERMINISTIC auto-suggestion of bid/RFQ
 * line items from the developer's typed needs and any text-based spec docs.
 *
 * Mounted under /api/rfq in routes.ts. Reuses Procure's documents + storage.ts
 * for file persistence and the q/q1 pool helpers + getAuth/requireUser guards.
 * Ownership is enforced the same way db.ts does it: a developer may only assist
 * a package whose building is owned by one of their companies.
 *
 * Endpoints:
 *   POST /rfq/documents              (owner) upload a categorised CAD/spec file
 *   GET  /rfq/documents/:packageId   list documents for a package
 *   POST /rfq/suggest-lines          (owner) generate + store suggested lines
 *   GET  /rfq/suggest-lines/:packageId  list stored suggestions
 *   POST /rfq/apply-lines            (owner) accept suggestions into the BOQ
 *
 * IMPORTANT: true binary CAD parsing (DWG/RVT/IFC) is OUT OF SCOPE. We store the
 * file but base suggestions on TEXT sources only: the typed `needs`, an optional
 * `specText`, and best-effort text extracted from attached text/PDF spec docs.
 * The suggester is fully deterministic — no LLM dependency.
 *
 * Zero em dashes by convention of the ported routers.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "node:fs";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { buildStorageKey, writeFile, readPath, fileExists } from "../storage.js";

// 50 MB cap for spec/CAD uploads via this module.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Allowed upload extensions. Binary CAD (dwg/dwf/rvt/ifc) is stored but never
// parsed; text/PDF/office/csv may contribute extracted text to suggestions.
const ALLOWED_EXT = new Set([
  "pdf", "png", "jpg", "jpeg", "dwg", "dwf", "rvt", "ifc", "doc", "docx", "csv", "txt",
]);

// Document categories used by the RFQ-assist UI.
const CATEGORIES = new Set(["cad", "spec", "drawing", "finish_schedule", "other"]);

// Extensions whose stored bytes we treat as a text source for the suggester.
const TEXT_EXT = new Set(["txt", "csv", "doc", "docx", "spec"]);

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Authorization helpers (mirror db.ts intent: package owner = building owner)
// ---------------------------------------------------------------------------

/** True when one of the user's companies owns the building behind the package. */
async function userOwnsPackage(userId: string, packageId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, userId],
  );
  return !!row;
}

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// Text extraction (best-effort, dependency-free)
// ---------------------------------------------------------------------------

/**
 * Pull readable text out of a stored document's bytes. txt/csv/doc are read as
 * UTF-8. PDFs are scanned for parenthesised text-show operands and Tj/TJ string
 * literals (works for many uncompressed/simple PDFs; compressed streams yield
 * little, which is acceptable since `needs`/`specText` drive suggestions). Never
 * throws; returns "" on any failure.
 */
function extractTextFromBytes(buf: Buffer, ext: string): string {
  try {
    if (ext === "pdf") return extractPdfText(buf);
    // Treat the rest of our text exts as UTF-8 (docx is zipped XML; best-effort
    // strips non-printables and still surfaces some readable words).
    const raw = buf.toString("utf8");
    return raw.replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ");
  } catch {
    return "";
  }
}

/** Naive PDF text scrape: collects literals inside ( ) used by Tj/TJ operators. */
function extractPdfText(buf: Buffer): string {
  const s = buf.toString("latin1");
  const out: string[] = [];
  // Match (...) string literals, handling escaped parens.
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const lit = m[0]
      .slice(1, -1)
      .replace(/\\(\d{1,3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\([()\\])/g, "$1");
    if (lit.trim()) out.push(lit);
  }
  return out.join(" ").replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ");
}

/** Read text from a package's text-category documents (best-effort, capped). */
async function gatherSpecDocText(packageId: string): Promise<string> {
  const docs = await q<{ storage_path: string; kind: string | null; category: string | null }>(
    `select storage_path, kind, category from documents
      where package_id = $1
      order by created_at desc
      limit 25`,
    [packageId],
  );
  const parts: string[] = [];
  let budget = 200_000; // cap total extracted chars to keep parsing bounded
  for (const d of docs) {
    if (budget <= 0) break;
    const ext = (d.kind || d.storage_path.split(".").pop() || "").toLowerCase();
    const isPdf = ext === "pdf";
    const isText = TEXT_EXT.has(ext) || d.category === "spec";
    if (!isPdf && !isText) continue; // skip binary CAD / images
    if (!d.storage_path || !fileExists(d.storage_path)) continue;
    try {
      const bytes = fs.readFileSync(readPath(d.storage_path));
      const text = extractTextFromBytes(bytes, isPdf ? "pdf" : ext);
      if (text) {
        const slice = text.slice(0, budget);
        budget -= slice.length;
        parts.push(slice);
      }
    } catch {
      /* unreadable file: skip */
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic line-item suggester
// ---------------------------------------------------------------------------

type Suggested = {
  name: string;
  category: string;
  qty: number;
  unit: string;
  spec: string;
  notes: string;
};

/**
 * Keyword/section heuristics + category templates. Each rule fires at most once.
 * Quantities are pulled from the text when an explicit "<n> <unit>" pattern sits
 * near the keyword, otherwise a sensible template default is used and noted.
 */
const RULES: Array<{
  cat: string;
  unit: string;
  defaultQty: number;
  keywords: string[];
  name: string;
  spec?: string;
}> = [
  { cat: "Doors & Hardware", unit: "ea", defaultQty: 1, name: "Interior doors + hardware sets", keywords: ["door", "doors", "hardware", "hinge", "lockset"], spec: "Solid-core doors with commercial-grade hardware" },
  { cat: "Doors & Hardware", unit: "ea", defaultQty: 1, name: "Entry / storefront doors", keywords: ["entry door", "storefront", "glass door", "automatic door"], spec: "Aluminum storefront entry, ADA-compliant" },
  { cat: "Windows & Glazing", unit: "ea", defaultQty: 1, name: "Windows / glazing units", keywords: ["window", "windows", "glazing", "curtain wall", "skylight"], spec: "Double-glazed, low-E, per energy spec" },
  { cat: "Flooring", unit: "sf", defaultQty: 1, name: "Flooring (finished)", keywords: ["floor", "flooring", "tile", "carpet", "hardwood", "lvt", "vinyl plank", "epoxy"], spec: "Per finish schedule" },
  { cat: "Painting & Coatings", unit: "sf", defaultQty: 1, name: "Painting / wall coatings", keywords: ["paint", "painting", "coating", "primer"], spec: "Two coats over primer, low-VOC" },
  { cat: "Drywall & Partitions", unit: "sf", defaultQty: 1, name: "Drywall / partitions", keywords: ["drywall", "gypsum", "partition", "stud wall", "framing"], spec: "Metal stud + gypsum board, taped and finished" },
  { cat: "Ceilings", unit: "sf", defaultQty: 1, name: "Ceilings (ACT / drywall)", keywords: ["ceiling", "ceilings", "acoustic", "act", "soffit"], spec: "Suspended acoustic tile or drywall, per RCP" },
  { cat: "Millwork & Casework", unit: "lf", defaultQty: 1, name: "Millwork / casework", keywords: ["millwork", "casework", "cabinet", "cabinetry", "countertop", "reception desk", "built-in"], spec: "Custom millwork per drawings" },
  { cat: "Electrical", unit: "ea", defaultQty: 1, name: "Electrical fixtures + devices", keywords: ["electrical", "outlet", "receptacle", "panel", "wiring", "circuit"], spec: "Per electrical drawings and code" },
  { cat: "Lighting", unit: "ea", defaultQty: 1, name: "Lighting fixtures", keywords: ["light", "lighting", "fixture", "downlight", "led", "luminaire"], spec: "LED fixtures per lighting schedule" },
  { cat: "Plumbing", unit: "ea", defaultQty: 1, name: "Plumbing fixtures", keywords: ["plumbing", "sink", "faucet", "toilet", "lavatory", "water heater", "fixture"], spec: "Commercial fixtures per plumbing drawings" },
  { cat: "HVAC", unit: "ea", defaultQty: 1, name: "HVAC equipment + distribution", keywords: ["hvac", "ductwork", "air handler", "rtu", "vav", "mini split", "thermostat", "ventilation"], spec: "Per mechanical drawings and load calcs" },
  { cat: "Fire Protection", unit: "ea", defaultQty: 1, name: "Fire protection / sprinklers", keywords: ["sprinkler", "fire protection", "fire alarm", "standpipe"], spec: "Per NFPA and AHJ requirements" },
  { cat: "Roofing", unit: "sf", defaultQty: 1, name: "Roofing system", keywords: ["roof", "roofing", "membrane", "tpo", "epdm", "shingle"], spec: "Per roofing assembly detail and warranty" },
  { cat: "Insulation", unit: "sf", defaultQty: 1, name: "Insulation", keywords: ["insulation", "batt", "spray foam", "rigid board"], spec: "Per energy code R-value" },
  { cat: "Concrete", unit: "cy", defaultQty: 1, name: "Concrete / slab work", keywords: ["concrete", "slab", "footing", "foundation", "rebar"], spec: "Per structural drawings, specified PSI" },
  { cat: "Masonry", unit: "sf", defaultQty: 1, name: "Masonry", keywords: ["masonry", "brick", "block", "cmu", "stone veneer"], spec: "Per elevations and details" },
  { cat: "Demolition", unit: "ls", defaultQty: 1, name: "Demolition / selective removal", keywords: ["demolition", "demo", "remove existing", "tear out"], spec: "Selective demolition per scope" },
  { cat: "Appliances & Equipment", unit: "ea", defaultQty: 1, name: "Appliances / FF&E", keywords: ["appliance", "refrigerator", "oven", "dishwasher", "equipment", "ff&e", "ffe"], spec: "Per equipment schedule" },
  { cat: "Site & Landscaping", unit: "ls", defaultQty: 1, name: "Site work / landscaping", keywords: ["landscaping", "site work", "paving", "grading", "irrigation", "hardscape"], spec: "Per civil / landscape drawings" },
  { cat: "Signage", unit: "ea", defaultQty: 1, name: "Signage / wayfinding", keywords: ["signage", "sign", "wayfinding", "monument sign"], spec: "Per signage package and code" },
];

const NUM_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, hundred: 100,
};

/** Find an explicit quantity near a keyword occurrence (e.g. "12 doors"). */
function qtyNearKeyword(text: string, keyword: string): number | null {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "<digits> ... keyword"  OR  "keyword ... <digits>"
  const before = new RegExp(`(\\d[\\d,\\.]*)\\s+(?:[a-z]+\\s+){0,2}${escaped}`, "i");
  const after = new RegExp(`${escaped}[^\\d]{0,12}(\\d[\\d,\\.]*)`, "i");
  const word = new RegExp(`\\b(${Object.keys(NUM_WORD).join("|")})\\s+(?:[a-z]+\\s+){0,2}${escaped}`, "i");
  let m = before.exec(text) || after.exec(text);
  if (m) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  }
  m = word.exec(text);
  if (m) {
    const n = NUM_WORD[m[1].toLowerCase()];
    if (n) return n;
  }
  return null;
}

/**
 * The deterministic suggester. Combines typed needs + specText + extracted doc
 * text, lower-cases for matching, and returns one line per matched template.
 * If nothing matches, returns a single generic "scope of work" line so the
 * developer always has a starting point.
 */
function suggestLines(needs: string, specText: string, docText: string): Suggested[] {
  const combined = [needs || "", specText || "", docText || ""].join("\n");
  const hay = combined.toLowerCase();
  const out: Suggested[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    const hit = rule.keywords.find((k) => hay.includes(k.toLowerCase()));
    if (!hit) continue;
    if (seen.has(rule.name)) continue;
    seen.add(rule.name);
    const explicitQty = qtyNearKeyword(hay, hit);
    const qty = explicitQty ?? rule.defaultQty;
    out.push({
      name: rule.name,
      category: rule.cat,
      qty,
      unit: rule.unit,
      spec: rule.spec ?? "",
      notes: explicitQty
        ? `Matched "${hit}"; quantity read from text.`
        : `Matched "${hit}"; confirm quantity and unit.`,
    });
  }

  if (out.length === 0) {
    out.push({
      name: "General scope of work",
      category: "General",
      qty: 1,
      unit: "ls",
      spec: needs.trim().slice(0, 400) || "Define scope from project needs",
      notes: "No specific trades detected; refine the needs description or upload a text spec.",
    });
  }
  return out;
}

// ===========================================================================
// 1) CAD / SPEC FILE UPLOAD (categorised) + LIST
// ===========================================================================

// POST /rfq/documents  (multipart: file + companyId + packageId + category)
// Owner-only: must own the package AND be a member of companyId.
router.post(
  "/rfq/documents",
  requireUser,
  upload.single("file"),
  h(async (req, res) => {
    const auth = getAuth(req);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file required" });
    const companyId = String(req.body.companyId || "");
    const packageId = String(req.body.packageId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!packageId) return res.status(400).json({ error: "packageId required" });

    const category = String(req.body.category || "other");
    if (!CATEGORIES.has(category)) {
      return res.status(400).json({ error: "invalid category" });
    }
    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({ error: `file type .${ext} not allowed` });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: "file too large" });
    }
    // Authorize before touching disk: package owner + company member.
    if (!(await userOwnsPackage(auth.userId!, packageId))) {
      return res.status(403).json({ error: "not the owner of this package" });
    }
    if (!(await isMemberOfCompany(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }

    // Find the building so the document is also linked to the project.
    const pkg = await q1<{ building_id: string }>(
      `select building_id from packages where id = $1`,
      [packageId],
    );

    const storageKey = buildStorageKey({
      companyId,
      packageId,
      buildingId: pkg?.building_id ?? null,
      fileName: file.originalname,
    });
    const doc = await q1(
      `insert into documents (company_id, building_id, package_id, name, kind, category, storage_path, size, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        companyId,
        pkg?.building_id ?? null,
        packageId,
        file.originalname,
        ext,
        category,
        storageKey,
        file.size,
        auth.userId,
      ],
    );
    writeFile(storageKey, file.buffer);
    res.status(201).json(doc);
  }),
);

// GET /rfq/documents/:packageId  -> documents for the package (any authed user;
// docs are readable to authed users per the existing docs_read policy).
router.get(
  "/rfq/documents/:packageId",
  requireUser,
  h(async (req, res) => {
    const rows = await q(
      `select * from documents where package_id = $1 order by created_at desc`,
      [req.params.packageId],
    );
    res.json(rows);
  }),
);

// ===========================================================================
// 2) AUTO-SUGGEST LINE ITEMS (deterministic)
// ===========================================================================

// POST /rfq/suggest-lines { packageId, needs?, specText? }
// Owner-only. Generates suggestions from needs + specText + attached spec text,
// stores them as rfq_suggested_lines (status 'suggested'), and returns them.
// Does NOT touch package_line_items.
router.post(
  "/rfq/suggest-lines",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { packageId, needs, specText } = (req.body ?? {}) as {
      packageId?: string;
      needs?: string;
      specText?: string;
    };
    if (!packageId) return res.status(400).json({ error: "packageId required" });
    if (!(await userOwnsPackage(auth.userId!, packageId))) {
      return res.status(403).json({ error: "not the owner of this package" });
    }

    const docText = await gatherSpecDocText(packageId).catch(() => "");
    const suggestions = suggestLines(String(needs || ""), String(specText || ""), docText);

    // Persist each suggestion (fresh batch; we do not dedupe against history).
    const inserted: any[] = [];
    for (const s of suggestions) {
      const row = await q1(
        `insert into rfq_suggested_lines (package_id, name, category, qty, unit, spec, notes, status)
         values ($1,$2,$3,$4,$5,$6,$7,'suggested') returning *`,
        [packageId, s.name, s.category, s.qty, s.unit, s.spec, s.notes],
      );
      inserted.push(row);
    }
    res.status(201).json({ suggestions: inserted, sourceUsedDocText: docText.length > 0 });
  }),
);

// GET /rfq/suggest-lines/:packageId -> list stored suggestions (newest first).
router.get(
  "/rfq/suggest-lines/:packageId",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    if (!(await userOwnsPackage(auth.userId!, req.params.packageId))) {
      return res.status(403).json({ error: "not the owner of this package" });
    }
    const rows = await q(
      `select * from rfq_suggested_lines where package_id = $1 order by created_at desc`,
      [req.params.packageId],
    );
    res.json({ suggestions: rows });
  }),
);

// ===========================================================================
// 3) APPLY SUGGESTIONS INTO THE REAL BOQ (package_line_items)
// ===========================================================================

// POST /rfq/apply-lines { packageId, lineIds?: string[], lines?: Suggested[] }
// Owner-only. Inserts accepted suggestions into package_line_items and marks the
// matching rfq_suggested_lines 'applied'. `lineIds` accepts stored suggestion
// ids; `lines` accepts ad-hoc/edited rows (which are inserted but have no
// suggestion row to mark).
router.post(
  "/rfq/apply-lines",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { packageId, lineIds, lines } = (req.body ?? {}) as {
      packageId?: string;
      lineIds?: string[];
      lines?: Array<{ name?: string; description?: string; qty?: number; unit?: string; notes?: string; cost_code?: string }>;
    };
    if (!packageId) return res.status(400).json({ error: "packageId required" });
    if (!(await userOwnsPackage(auth.userId!, packageId))) {
      return res.status(403).json({ error: "not the owner of this package" });
    }

    let applied = 0;

    // a) Apply stored suggestions by id (validated against this package).
    if (Array.isArray(lineIds) && lineIds.length) {
      const rows = await q<{ id: string; name: string | null; qty: any; unit: string | null; spec: string | null; notes: string | null }>(
        `select id, name, qty, unit, spec, notes from rfq_suggested_lines
          where package_id = $1 and id = any($2) and status <> 'applied'`,
        [packageId, lineIds],
      );
      for (const r of rows) {
        const description = [r.name, r.spec].filter(Boolean).join(" — ") || (r.name ?? "Line item");
        await q(
          `insert into package_line_items (package_id, description, qty, unit, notes)
           values ($1,$2,coalesce($3,1),$4,$5)`,
          [packageId, description, r.qty ?? null, r.unit ?? null, r.notes ?? null],
        );
        await q(`update rfq_suggested_lines set status = 'applied' where id = $1`, [r.id]);
        applied++;
      }
    }

    // b) Apply ad-hoc/edited lines passed directly.
    if (Array.isArray(lines) && lines.length) {
      for (const l of lines) {
        const description = String(l.description || l.name || "").trim();
        if (!description) continue;
        await q(
          `insert into package_line_items (package_id, description, qty, unit, cost_code, notes)
           values ($1,$2,coalesce($3,1),$4,$5,$6)`,
          [packageId, description, l.qty ?? null, l.unit ?? null, l.cost_code ?? null, l.notes ?? null],
        );
        applied++;
      }
    }

    if (applied === 0) {
      return res.status(400).json({ error: "no lines to apply" });
    }
    const items = await q(
      `select * from package_line_items where package_id = $1 order by sort, created_at`,
      [packageId],
    );
    res.json({ applied, lineItems: items });
  }),
);

export default router;
