/**
 * Divini Blueprint - document intelligence for uploaded plans/CAD/specs/
 * budgets, feeding the EXISTING packages / scope_instances /
 * pipeline_opportunities tables rather than duplicating them.
 * Mounted under /api/blueprint in routes.ts.
 *
 * Uses the EXISTING /api/documents upload endpoint (server/src/routes.ts) -
 * this module only adds classification and review on top of documents
 * already uploaded there.
 *
 * HONESTY BOUNDARY (see db/schema-blueprint.sql for the original note, and
 * db/schema-blueprint-content-extraction.sql for the update): classifyDocument()
 * still reads filenames/extensions only and never exceeds "medium"
 * confidence. POST /documents/:id/extract-content is different: it actually
 * reads a PDF's text layer or OCRs an image (server/src/lib/text-extraction.ts,
 * server/src/lib/ocr.ts - both need no external service or API key) or a
 * DXF's real text/layers (server/src/lib/dxf-extraction.ts), then
 * reclassifies with classifyFromContent() at "high" confidence when a rule
 * matches real content. DWG/RVT/IFC still have no content-reading path - see
 * server/src/lib/cad-conversion.ts, the pluggable seam for a real CAD
 * conversion service once one is configured. The optional AI summary step
 * below uses the existing gracefully-degrading LLM client
 * (server/src/lib/llm.ts) to draft narrative from classification plus any
 * text the user explicitly supplies - never from file content it cannot
 * see, and always requiring user review before anything is created. When
 * the LLM is not configured, the deterministic classification + trade
 * suggestions still work in full - this is the "must work without an LLM"
 * baseline.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError, userCompanyIds } from "../db.js";
import { q, q1 } from "../pool.js";
import { classifyDocument, classifyFromContent, type Discipline } from "../lib/document-classifier.js";
import { suggestTrades } from "../lib/trade-suggester.js";
import { suggestRevisionMatches } from "../lib/revision-matcher.js";
import { llmEnabled, llmJson } from "../lib/llm.js";
import { sendEmail } from "../lib/email.js";
import { extractPdfText, renderPdfPageToPng } from "../lib/text-extraction.js";
import { ocrImage } from "../lib/ocr.js";
import { extractDxfInfo } from "../lib/dxf-extraction.js";
import { readFileBytes } from "../storage.js";
import { runAsAdmin } from "../lib/requestContext.js";
import { llmRateLimit } from "../lib/rateLimit.js";

// /analyze's classification work is deterministic and cheap regardless of
// LLM state, but it conditionally calls draftAiSummaryFields() (an LLM
// completion) when a projectDescription is supplied. A per-request limit
// keyed to only the LLM sub-call would be more precise, but rateLimit.ts's
// helpers are Express middleware, not a standalone check-and-consume
// function; applying it at the route level here (same pattern as intel.ts's
// own LLM route) is the simple, consistent fix. Sized generously (60/hour)
// so repeated legitimate classification-only runs (no LLM involved) are not
// squeezed by a budget meant for the optional AI narrative sub-feature.
const analyzeLlmLimit = llmRateLimit({ max: 60, windowMs: 60 * 60_000 });

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const SUGGESTION_STATUSES = new Set(["accepted", "rejected", "merged"]);
const DISCLAIMER =
  "AI-generated preliminary project information. Review and approval by the project owner and appropriate licensed professionals are required before use.";
// tesseract.js reads these directly - excludes heic (no native decode path
// without a conversion step this codebase does not have) and tif/tiff
// (tesseract.js support is unreliable enough to not promise here).
const IMAGE_EXTENSIONS_FOR_OCR = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Resolve a building's owning company, and authorize the caller against it. */
async function authorizeBuilding(req: Request, buildingId: string): Promise<{ id: string; company_id: string }> {
  const auth = getAuth(req);
  const building = await q1<{ id: string; company_id: string }>(`select id, company_id from buildings where id = $1`, [buildingId]);
  if (!building) throw new NotFoundError("project not found");
  if (auth.isAdmin) return building;
  if (await isMemberOfCompany(auth.userId!, building.company_id)) return building;
  throw new ForbiddenError("not a member of this project's organization");
}

function fileExtension(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

async function classifyAndSave(doc: any): Promise<any> {
  const result = classifyDocument(doc.name, fileExtension(doc.name));
  return q1(
    `update documents set
       discipline = $2, document_category = $3, classification_confidence = $4,
       classification_rule = $5, classified_at = now(), processing_status = 'classified'
     where id = $1 returning *`,
    [doc.id, result.discipline, result.category, result.confidence, result.matchedRule],
  );
}

// ---- POST /blueprint/documents/:id/classify -----------------------------------
router.post(
  "/documents/:id/classify",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const row = await classifyAndSave(doc);
    res.json({ document: row });
  }),
);

/**
 * Actually reads a document's content and returns extracted text plus how
 * it was obtained. Never throws - every branch returns a result object,
 * since a failure to extract content is an expected, common outcome (a
 * scanned PDF with an unreadable scan, an unsupported CAD format, a
 * corrupted file) and must never take the request down with it.
 */
async function extractContent(doc: any): Promise<{ text: string; method: "pdf_text_layer" | "ocr" | "dxf_entities" | "none" | "failed"; error?: string }> {
  const ext = fileExtension(doc.name);
  let bytes: Buffer;
  try {
    bytes = readFileBytes(doc.storage_path);
  } catch (e: any) {
    return { text: "", method: "failed", error: `could not read the stored file: ${e?.message ?? "unknown error"}` };
  }

  if (ext === "pdf") {
    const textLayer = await extractPdfText(bytes);
    if (textLayer) return { text: textLayer.text, method: "pdf_text_layer" };
    // No text layer - likely a scanned PDF. Fall back to OCR on page 1 only:
    // OCRing every page of a large scanned set is expensive and page 1
    // (a cover sheet or title block) is usually the highest-signal page for
    // classification purposes.
    const png = await renderPdfPageToPng(bytes, 1);
    if (!png) return { text: "", method: "failed", error: "could not extract a text layer or render this PDF for OCR" };
    const ocr = await ocrImage(png);
    if (!ocr) return { text: "", method: "failed", error: "OCR could not read this PDF's first page with usable confidence" };
    return { text: ocr.text, method: "ocr" };
  }

  if (IMAGE_EXTENSIONS_FOR_OCR.has(ext)) {
    const ocr = await ocrImage(bytes);
    if (!ocr) return { text: "", method: "failed", error: "OCR could not read this image with usable confidence" };
    return { text: ocr.text, method: "ocr" };
  }

  if (ext === "dxf") {
    const info = extractDxfInfo(bytes.toString("utf8"));
    if (!info) return { text: "", method: "failed", error: "could not parse this file as DXF" };
    const text = [...info.layers, ...info.textEntities].join(" ");
    if (!text.trim()) return { text: "", method: "dxf_entities", error: "parsed successfully but the file has no layer names or text entities to classify from" };
    return { text, method: "dxf_entities" };
  }

  return { text: "", method: "none", error: `no content-reading path for .${ext} files yet - CAD_CONVERSION_PROVIDER is not configured (see server/src/lib/cad-conversion.ts) or this format has no reader at all` };
}

// ---- POST /blueprint/documents/:id/extract-content -----------------------------
// Reads the document's real content where this codebase can (PDF text
// layer, OCR, or DXF entities - see extractContent() above), stores it, and
// reclassifies at "high" confidence if a keyword rule matches the real
// content. Never overwrites a user's manual category/discipline override.
router.post(
  "/documents/:id/extract-content",
  requireUser,
  h(async (req, res) => {
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    const auth = getAuth(req);
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }

    const result = await extractContent(doc);
    const truncated = result.text.slice(0, 20000);

    let updated = await q1<any>(
      `update documents set extracted_text = $2, extraction_method = $3, extraction_error = $4, extracted_at = now()
       where id = $1 returning *`,
      [doc.id, truncated || null, result.method, result.error ?? null],
    );

    if (truncated && !updated.category_overridden_by_user) {
      const contentMatch = classifyFromContent(truncated);
      if (contentMatch) {
        updated = await q1<any>(
          `update documents set discipline = $2, document_category = $3, classification_confidence = $4,
             classification_rule = $5, classified_at = now(), processing_status = 'classified'
           where id = $1 returning *`,
          [doc.id, contentMatch.discipline, contentMatch.category, contentMatch.confidence, `content:${contentMatch.matchedRule}`],
        );
      }
    }

    res.json({ document: updated, extraction: result });
  }),
);

// ---- PATCH /blueprint/documents/:id {documentCategory?, discipline?} ----------
// User override of a classification - always allowed, marks it as user-set so
// a later batch re-classify never silently reverts a human correction.
router.patch(
  "/documents/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.documentCategory !== undefined) {
      sets.push(`document_category = $${i++}`);
      vals.push(b.documentCategory);
    }
    if (b.discipline !== undefined) {
      sets.push(`discipline = $${i++}`);
      vals.push(b.discipline);
    }
    if (sets.length === 0) return res.json({ document: doc });
    sets.push(`category_overridden_by_user = true`);
    vals.push(doc.id);
    const row = await q1(`update documents set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ document: row });
  }),
);

// ---- GET /blueprint/documents?buildingId= --------------------------------------
router.get(
  "/documents",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);
    const rows = await q(`select * from documents where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ documents: rows });
  }),
);

// ---- GET /blueprint/documents/:id/suggest-revision-of --------------------------
// Deterministic filename-pattern suggestion only - never a confirmed link.
router.get(
  "/documents/:id/suggest-revision-of",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    if (!doc.building_id) return res.json({ matches: [] });
    const others = await q<{ id: string; name: string }>(
      `select id, name from documents where building_id = $1 and id <> $2`,
      [doc.building_id, doc.id],
    );
    res.json({ matches: suggestRevisionMatches(doc.name, others) });
  }),
);

// ---- POST /blueprint/documents/:id/link-revision {parentDocumentId, revisionLabel?}
router.post(
  "/documents/:id/link-revision",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const parentId = String(req.body?.parentDocumentId || "");
    if (!parentId) return res.status(400).json({ error: "parentDocumentId required" });
    if (parentId === doc.id) return res.status(400).json({ error: "a document cannot be a revision of itself" });
    const parent = await q1<any>(`select * from documents where id = $1`, [parentId]);
    if (!parent) throw new NotFoundError("parent document not found");
    if (parent.building_id !== doc.building_id) {
      return res.status(400).json({ error: "the parent document must belong to the same project" });
    }
    // Reject anything that would create a cycle: walk the proposed parent's own
    // ancestor chain and make sure doc.id does not already appear in it.
    let ancestor = parent;
    const walked = new Set([parent.id]);
    while (ancestor.parent_document_id) {
      if (ancestor.parent_document_id === doc.id) {
        return res.status(400).json({ error: "that would create a circular revision chain" });
      }
      if (walked.has(ancestor.parent_document_id)) break; // an existing cycle elsewhere; stop rather than loop
      walked.add(ancestor.parent_document_id);
      const next = await q1<any>(`select * from documents where id = $1`, [ancestor.parent_document_id]);
      if (!next) break;
      ancestor = next;
    }
    const revisionLabel = req.body?.revisionLabel ? String(req.body.revisionLabel) : null;
    const row = await q1(
      `update documents set parent_document_id = $2, revision_number = $3, revision_label = $4 where id = $1 returning *`,
      [doc.id, parentId, (parent.revision_number ?? 1) + 1, revisionLabel],
    );
    res.json({ document: row });
  }),
);

// ---- GET /blueprint/documents/:id/revisions -------------------------------------
// Walks to the root of the revision chain, then returns every document in it.
router.get(
  "/documents/:id/revisions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    let root = doc;
    const seen = new Set([root.id]);
    while (root.parent_document_id && !seen.has(root.parent_document_id)) {
      const parent = await q1<any>(`select * from documents where id = $1`, [root.parent_document_id]);
      if (!parent) break;
      root = parent;
      seen.add(root.id);
    }
    const chain = await q<any>(
      `with recursive chain as (
         select d.*, array[d.id] as visited from documents d where d.id = $1
         union all
         select d.*, c.visited || d.id from documents d
           join chain c on d.parent_document_id = c.id
           where not d.id = any(c.visited)
       )
       select * from chain order by revision_number asc, created_at asc`,
      [root.id],
    );
    res.json({ revisions: chain.map((r: any) => { delete r.visited; return r; }) });
  }),
);

/**
 * Draft ADDITIONAL narrative summary fields with the optional LLM client.
 * Strictly grounded in the classification + user-supplied text only - never
 * given file bytes it cannot actually read. Returns [] on any failure or
 * when the LLM is not configured, so the deterministic fields below always
 * stand on their own.
 */
async function draftAiSummaryFields(
  disciplines: string[],
  categoryCounts: Record<string, number>,
  projectDescription: string | undefined,
): Promise<{ fieldKey: string; fieldLabel: string; suggestedValue: string }[]> {
  if (!llmEnabled()) return [];
  const system =
    "You draft a PRELIMINARY, EDITABLE project summary for a construction procurement platform. " +
    "You have NOT seen any drawing, CAD, or document content - only a list of document categories " +
    "and disciplines that were uploaded (by filename classification), plus optional text the user " +
    "typed themselves. You must NEVER invent square footage, unit counts, dimensions, quantities, " +
    "material choices, or any specific fact not explicitly present in the user-supplied text. If you " +
    "have nothing grounded to say for a field, omit it entirely rather than guessing. Reply with JSON only.";
  const prompt =
    `Uploaded document disciplines present: ${disciplines.join(", ") || "none"}.\n` +
    `Uploaded document category counts: ${JSON.stringify(categoryCounts)}.\n` +
    `User-supplied project description (may be empty): ${projectDescription || "(none provided)"}\n\n` +
    "Return JSON: {\"projectTypeGuess\": string, \"observedScopeNote\": string, \"missingInformationNote\": string}. " +
    "projectTypeGuess: a short, hedged guess at project type based ONLY on the disciplines/categories present " +
    "(e.g. \"Likely a renovation with electrical and plumbing scope, based on uploaded drawing disciplines\") - " +
    "omit if disciplines list is empty. observedScopeNote: 1-2 sentences summarizing what document TYPES were " +
    "uploaded (not their content). missingInformationNote: 1-2 sentences naming common document types that were " +
    "NOT uploaded (e.g. no specifications, no survey) if that is evident from the category counts. Omit any field " +
    "you cannot ground in the input above.";

  const out = await llmJson<{ projectTypeGuess?: unknown; observedScopeNote?: unknown; missingInformationNote?: unknown }>(
    prompt,
    { system, timeoutMs: 20000 },
  );
  if (!out) return [];
  const fields: { fieldKey: string; fieldLabel: string; suggestedValue: string }[] = [];
  if (typeof out.projectTypeGuess === "string" && out.projectTypeGuess.trim()) {
    fields.push({ fieldKey: "ai_project_type_guess", fieldLabel: "Likely project type (AI guess)", suggestedValue: out.projectTypeGuess.trim().slice(0, 500) });
  }
  if (typeof out.observedScopeNote === "string" && out.observedScopeNote.trim()) {
    fields.push({ fieldKey: "ai_observed_scope_note", fieldLabel: "Observed scope (AI note)", suggestedValue: out.observedScopeNote.trim().slice(0, 800) });
  }
  if (typeof out.missingInformationNote === "string" && out.missingInformationNote.trim()) {
    fields.push({ fieldKey: "ai_missing_information_note", fieldLabel: "Possibly missing information (AI note)", suggestedValue: out.missingInformationNote.trim().slice(0, 800) });
  }
  return fields;
}

// ---- POST /blueprint/analyze {buildingId, documentIds?, projectDescription?} ----
router.post(
  "/analyze",
  requireUser,
  analyzeLlmLimit,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const buildingId = String(b.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    const building = await authorizeBuilding(req, buildingId);

    const documentIds: string[] | undefined = Array.isArray(b.documentIds) ? b.documentIds : undefined;
    const docs = documentIds && documentIds.length
      ? await q<any>(`select * from documents where id = any($1) and building_id = $2`, [documentIds, buildingId])
      : await q<any>(`select * from documents where building_id = $1`, [buildingId]);

    if (docs.length === 0) {
      return res.status(400).json({ error: "no documents to analyze - upload files to this project first" });
    }

    // Classify anything not yet classified (never re-classify a user override).
    const classified: any[] = [];
    for (const doc of docs) {
      if (doc.processing_status === "classified" || doc.category_overridden_by_user) {
        classified.push(doc);
      } else {
        classified.push(await classifyAndSave(doc));
      }
    }

    const run = await q1<any>(
      `insert into ai_extraction_runs (organization_id, building_id, input_document_ids, used_ai, ai_model, status, created_by)
       values ($1,$2,$3,$4,$5,'running',$6) returning *`,
      [building.company_id, buildingId, classified.map((d) => d.id), llmEnabled(), llmEnabled() ? process.env.LLM_MODEL ?? null : null, auth.userId],
    );

    // Deterministic summary fields: pure counts of what was uploaded, so
    // these are always high confidence - no inference involved.
    const categoryCounts: Record<string, number> = {};
    const disciplineCounts: Partial<Record<Discipline, number>> = {};
    for (const d of classified) {
      if (d.document_category) categoryCounts[d.document_category] = (categoryCounts[d.document_category] ?? 0) + 1;
      if (d.discipline) disciplineCounts[d.discipline as Discipline] = (disciplineCounts[d.discipline as Discipline] ?? 0) + 1;
    }

    const summaryFieldRows: { fieldKey: string; fieldLabel: string; value: string; confidence: string; note: string }[] = [
      { fieldKey: "document_count", fieldLabel: "Documents uploaded", value: String(classified.length), confidence: "high", note: "Count of uploaded files." },
      {
        fieldKey: "disciplines_present",
        fieldLabel: "Disciplines represented",
        value: Object.keys(disciplineCounts).length ? Object.keys(disciplineCounts).join(", ") : "none identified",
        confidence: "high",
        note: "Derived from filename/extension classification, not document content.",
      },
      {
        fieldKey: "categories_present",
        fieldLabel: "Document categories represented",
        value: Object.entries(categoryCounts).map(([k, v]) => `${k} (${v})`).join(", ") || "none identified",
        confidence: "high",
        note: "Derived from filename/extension classification, not document content.",
      },
    ];
    const commonExpected = ["specification", "survey", "budget"];
    const missing = commonExpected.filter((c) => !categoryCounts[c]);
    if (missing.length) {
      summaryFieldRows.push({
        fieldKey: "missing_common_categories",
        fieldLabel: "Common document types not detected",
        value: missing.join(", "),
        confidence: "medium",
        note: "Based on filename classification only - these may exist but be misclassified or embedded in another file.",
      });
    }

    if (llmEnabled() && b.projectDescription) {
      const aiFields = await draftAiSummaryFields(Object.keys(disciplineCounts), categoryCounts, String(b.projectDescription || ""));
      for (const f of aiFields) {
        summaryFieldRows.push({ fieldKey: f.fieldKey, fieldLabel: f.fieldLabel, value: f.suggestedValue, confidence: "manual_confirmation_required", note: "AI-drafted from document categories and your description text only - not from file content." });
      }
    }

    for (const f of summaryFieldRows) {
      await q(
        `insert into blueprint_summary_fields (extraction_run_id, building_id, field_key, field_label, suggested_value, source_note, confidence)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [run.id, buildingId, f.fieldKey, f.fieldLabel, f.value, f.note, f.confidence],
      );
    }

    const tradeSuggestions = suggestTrades(disciplineCounts);
    for (const t of tradeSuggestions) {
      await q(
        `insert into blueprint_trade_suggestions
           (extraction_run_id, building_id, trade_category, package_title, rationale, confidence, supporting_document_count)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [run.id, buildingId, t.tradeCategory, t.packageTitle, t.rationale, t.confidence, t.supportingDocumentCount],
      );
    }

    const completedRun = await q1(`update ai_extraction_runs set status = 'complete', completed_at = now() where id = $1 returning *`, [run.id]);
    const [savedFields, savedSuggestions] = await Promise.all([
      q(`select * from blueprint_summary_fields where extraction_run_id = $1 order by created_at asc`, [run.id]),
      q(`select * from blueprint_trade_suggestions where extraction_run_id = $1 order by supporting_document_count desc`, [run.id]),
    ]);

    res.status(201).json({ run: completedRun, summaryFields: savedFields, tradeSuggestions: savedSuggestions, disclaimer: DISCLAIMER });
  }),
);

// ---- GET /blueprint/runs?buildingId= -------------------------------------------
router.get(
  "/runs",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);
    const rows = await q(`select * from ai_extraction_runs where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ runs: rows });
  }),
);

// ---- GET /blueprint/runs/:id ----------------------------------------------------
router.get(
  "/runs/:id",
  requireUser,
  h(async (req, res) => {
    const run = await q1<any>(`select * from ai_extraction_runs where id = $1`, [req.params.id]);
    if (!run) throw new NotFoundError("run not found");
    const auth = getAuth(req);
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, run.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const [summaryFields, tradeSuggestions] = await Promise.all([
      q(`select * from blueprint_summary_fields where extraction_run_id = $1 order by created_at asc`, [run.id]),
      q(`select * from blueprint_trade_suggestions where extraction_run_id = $1 order by supporting_document_count desc`, [run.id]),
    ]);
    res.json({ run, summaryFields, tradeSuggestions, disclaimer: DISCLAIMER });
  }),
);

async function authorizeSummaryField(req: Request, id: string): Promise<any> {
  const field = await q1<any>(`select * from blueprint_summary_fields where id = $1`, [id]);
  if (!field) throw new NotFoundError("field not found");
  const run = await q1<any>(`select * from ai_extraction_runs where id = $1`, [field.extraction_run_id]);
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, run.organization_id))) {
    throw new ForbiddenError("not a member of this organization");
  }
  return field;
}

// ---- PATCH /blueprint/summary-fields/:id {userEditedValue?, userConfirmed?} ---
router.patch(
  "/summary-fields/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const field = await authorizeSummaryField(req, req.params.id);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.userEditedValue !== undefined) {
      sets.push(`user_edited_value = $${i++}`, `edited_by = $${i++}`, `edited_at = now()`);
      vals.push(b.userEditedValue, auth.userId);
    }
    if (b.userConfirmed !== undefined) {
      sets.push(`user_confirmed = $${i++}`);
      vals.push(!!b.userConfirmed);
    }
    if (sets.length === 0) return res.json({ field });
    vals.push(field.id);
    const row = await q1(`update blueprint_summary_fields set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ field: row });
  }),
);

async function authorizeSuggestion(req: Request, id: string): Promise<{ suggestion: any; run: any }> {
  const suggestion = await q1<any>(`select * from blueprint_trade_suggestions where id = $1`, [id]);
  if (!suggestion) throw new NotFoundError("suggestion not found");
  const run = await q1<any>(`select * from ai_extraction_runs where id = $1`, [suggestion.extraction_run_id]);
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, run.organization_id))) {
    throw new ForbiddenError("not a member of this organization");
  }
  return { suggestion, run };
}

// ---- PATCH /blueprint/trade-suggestions/:id {status} ---------------------------
router.patch(
  "/trade-suggestions/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { suggestion } = await authorizeSuggestion(req, req.params.id);
    const status = String(req.body?.status || "");
    if (!SUGGESTION_STATUSES.has(status)) return res.status(400).json({ error: `status must be one of ${[...SUGGESTION_STATUSES].join(", ")}` });
    const row = await q1(
      `update blueprint_trade_suggestions set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1 returning *`,
      [suggestion.id, status, auth.userId],
    );
    res.json({ suggestion: row });
  }),
);

// ---- POST /blueprint/trade-suggestions/:id/create-package ----------------------
// Requires the suggestion to already be 'accepted' - review-before-create.
router.post(
  "/trade-suggestions/:id/create-package",
  requireUser,
  h(async (req, res) => {
    const { suggestion, run } = await authorizeSuggestion(req, req.params.id);
    if (suggestion.status !== "accepted") {
      return res.status(400).json({ error: "suggestion must be accepted before creating a package" });
    }
    if (suggestion.created_package_id) {
      return res.status(400).json({ error: "a package was already created from this suggestion" });
    }
    const pkg = await q1<any>(
      `insert into packages (building_id, category, status) values ($1,$2,'draft') returning *`,
      [run.building_id, suggestion.trade_category],
    );
    for (const docId of run.input_document_ids ?? []) {
      await q(`insert into blueprint_document_package_links (document_id, package_id) values ($1,$2) on conflict do nothing`, [docId, pkg.id]);
    }
    const updated = await q1(`update blueprint_trade_suggestions set created_package_id = $2 where id = $1 returning *`, [suggestion.id, pkg.id]);
    res.status(201).json({ package: pkg, suggestion: updated });
  }),
);

// ---- POST /blueprint/trade-suggestions/:id/create-scope -------------------------
// Creates a Divini Scope Builder draft scope from an accepted suggestion.
router.post(
  "/trade-suggestions/:id/create-scope",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { suggestion, run } = await authorizeSuggestion(req, req.params.id);
    if (suggestion.status !== "accepted") {
      return res.status(400).json({ error: "suggestion must be accepted before creating a scope" });
    }
    if (suggestion.created_scope_instance_id) {
      return res.status(400).json({ error: "a scope was already created from this suggestion" });
    }
    const scope = await q1<any>(
      `insert into scope_instances (organization_id, package_id, category, title, created_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [run.organization_id, suggestion.created_package_id, suggestion.trade_category, suggestion.package_title, auth.userId],
    );
    const updated = await q1(`update blueprint_trade_suggestions set created_scope_instance_id = $2 where id = $1 returning *`, [suggestion.id, scope.id]);
    res.status(201).json({ scope, suggestion: updated });
  }),
);

// ---- POST /blueprint/runs/:id/create-opportunity ---------------------------------
// Creates a Divini Pipeline opportunity for the overall project (developer profile).
router.post(
  "/runs/:id/create-opportunity",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const run = await q1<any>(`select * from ai_extraction_runs where id = $1`, [req.params.id]);
    if (!run) throw new NotFoundError("run not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, run.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const building = await q1<any>(`select * from buildings where id = $1`, [run.building_id]);
    const name = String(req.body?.name || `${building?.name ?? "Project"} - procurement`);
    const opp = await q1<any>(
      `insert into pipeline_opportunities (organization_id, profile_type, name, building_id, stage_key, owner_user_id, created_by)
       values ($1,'developer',$2,$3,'new',$4,$5) returning *`,
      [run.organization_id, name, run.building_id, auth.userId, auth.userId],
    );
    await q(
      `insert into pipeline_stage_history (opportunity_id, from_stage_key, to_stage_key, changed_by) values ($1,null,'new',$2)`,
      [opp.id, auth.userId],
    );
    res.status(201).json({ opportunity: opp });
  }),
);

// ---------------------------------------------------------------------------
// Revision and addendum management
// ---------------------------------------------------------------------------

async function authorizeAddendum(req: Request, id: string): Promise<any> {
  const addendum = await q1<any>(`select * from document_addenda where id = $1`, [id]);
  if (!addendum) throw new NotFoundError("addendum not found");
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, addendum.organization_id))) {
    throw new ForbiddenError("not a member of this organization");
  }
  return addendum;
}

/** A document's own package_id, plus any extra packages it was manually linked to. */
async function derivedPackageIds(documentIds: string[]): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const rows = await q<{ package_id: string | null }>(
    `select package_id from documents where id = any($1) and package_id is not null
     union
     select package_id from blueprint_document_package_links where document_id = any($1)`,
    [documentIds],
  );
  return [...new Set(rows.map((r) => r.package_id).filter((x): x is string => !!x))];
}

// ---- POST /blueprint/addenda {buildingId, title, description?, documentIds?} ----
router.post(
  "/addenda",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const buildingId = String(b.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const building = await authorizeBuilding(req, buildingId);
    const documentIds: string[] = Array.isArray(b.documentIds) ? b.documentIds : [];
    const packageIds = await derivedPackageIds(documentIds);
    const row = await q1<any>(
      `insert into document_addenda
         (organization_id, building_id, title, description, affected_document_ids, affected_package_ids, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [building.company_id, buildingId, title, b.description ? String(b.description) : null, documentIds, packageIds, auth.userId],
    );
    res.status(201).json({ addendum: row });
  }),
);

// ---- GET /blueprint/addenda?buildingId= ------------------------------------------
router.get(
  "/addenda",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);
    const rows = await q(`select * from document_addenda where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ addenda: rows });
  }),
);

// ---- GET /blueprint/addenda/for-vendor?companyId= ---------------------------------
// Vendor-side: every published addendum a vendor company was notified of.
// Registered before /addenda/:id so "for-vendor" is never captured as an id.
router.get(
  "/addenda/for-vendor",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const rows = await q(
      `select a.*, ack.notified_at, ack.acknowledged_at
       from document_addenda a
       join document_addendum_acknowledgments ack on ack.addendum_id = a.id
       where ack.vendor_company_id = $1 and a.status = 'published'
       order by a.published_at desc`,
      [companyId],
    );
    res.json({ addenda: rows });
  }),
);

// ---- GET /blueprint/addenda/:id ---------------------------------------------------
router.get(
  "/addenda/:id",
  requireUser,
  h(async (req, res) => {
    const addendum = await authorizeAddendum(req, req.params.id);
    const acknowledgments = await q(`select * from document_addendum_acknowledgments where addendum_id = $1`, [addendum.id]);
    res.json({ addendum, acknowledgments });
  }),
);

// ---- PATCH /blueprint/addenda/:id {title?, description?, documentIds?, status?, bidDeadlineExtendedTo?}
// Structural fields stay editable through draft/review - same "not editable once
// published" invariant used by change-orders and Divini Bid Studio drafts.
// status here only moves between draft and review; POST /publish is the only
// way to reach published, since that is also the action that notifies vendors.
router.patch(
  "/addenda/:id",
  requireUser,
  h(async (req, res) => {
    const addendum = await authorizeAddendum(req, req.params.id);
    if (addendum.status === "published") {
      return res.status(400).json({ error: "a published addendum cannot be edited" });
    }
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.title !== undefined) { sets.push(`title = $${i++}`); vals.push(String(b.title)); }
    if (b.description !== undefined) { sets.push(`description = $${i++}`); vals.push(b.description ? String(b.description) : null); }
    if (b.bidDeadlineExtendedTo !== undefined) { sets.push(`bid_deadline_extended_to = $${i++}`); vals.push(b.bidDeadlineExtendedTo || null); }
    if (Array.isArray(b.documentIds)) {
      const packageIds = await derivedPackageIds(b.documentIds);
      sets.push(`affected_document_ids = $${i++}`); vals.push(b.documentIds);
      sets.push(`affected_package_ids = $${i++}`); vals.push(packageIds);
    }
    if (b.status !== undefined) {
      const status = String(b.status);
      if (status !== "draft" && status !== "review") {
        return res.status(400).json({ error: "status must be draft or review here - use POST /publish to publish" });
      }
      sets.push(`status = $${i++}`); vals.push(status);
    }
    if (sets.length === 0) return res.json({ addendum });
    sets.push(`updated_at = now()`);
    vals.push(addendum.id);
    const row = await q1(`update document_addenda set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ addendum: row });
  }),
);

// ---- POST /blueprint/addenda/:id/publish -------------------------------------------
// Requires status = 'review' first (explicit review-before-publish gate). Notifies
// every member of every vendor company with a bid_invites or bids row on an
// affected package: an in-app notification always, plus best-effort email via the
// existing gracefully-degrading lib/email.ts.
router.post(
  "/addenda/:id/publish",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const addendum = await authorizeAddendum(req, req.params.id);
    if (addendum.status !== "review") {
      return res.status(400).json({ error: "an addendum must be in review before it can be published" });
    }
    const packageIds: string[] = addendum.affected_package_ids ?? [];
    let vendorCompanyIds: string[] = [];
    if (packageIds.length) {
      const rows = await q<{ vendor_company_id: string }>(
        `select vendor_company_id from bid_invites where package_id = any($1)
         union
         select vendor_company_id from bids where package_id = any($1)`,
        [packageIds],
      );
      vendorCompanyIds = [...new Set(rows.map((r) => r.vendor_company_id).filter(Boolean))];
    }

    const building = await q1<any>(`select * from buildings where id = $1`, [addendum.building_id]);
    for (const vendorCompanyId of vendorCompanyIds) {
      await q(
        `insert into document_addendum_acknowledgments (addendum_id, vendor_company_id, notified_at)
         values ($1,$2,now())
         on conflict (addendum_id, vendor_company_id) do update set notified_at = now()`,
        [addendum.id, vendorCompanyId],
      );
      // authorizeAddendum (above) already confirmed the caller owns this
      // addendum's own organization, so notifying every member of an
      // UNRELATED vendor company bidding on it is already authorized - but
      // company_members' own RLS policy only allows seeing your own row
      // (see db/schema-rls.sql's comment on why), which would silently
      // return zero members for a company the caller doesn't belong to.
      // Reproduced live: addendum-publish notifications stopped reaching
      // any bidder before this was added. See requestContext.ts's runAsAdmin.
      const members = await runAsAdmin(() =>
        q<{ user_id: string }>(`select user_id from company_members where company_id = $1`, [vendorCompanyId]),
      );
      for (const m of members) {
        await q(`insert into notifications (user_id, title, detail, kind) values ($1,$2,$3,'addendum')`, [
          m.user_id,
          `Addendum: ${addendum.title}`,
          `${building?.name ?? "A project"} you are bidding on has a new addendum. Review the updated documents before your bid deadline.`,
        ]);
        const u = await q1<{ email: string }>(`select email from users where id = $1`, [m.user_id]);
        if (u?.email) {
          await sendEmail({
            to: u.email,
            subject: `Addendum published: ${addendum.title}`,
            text:
              `${building?.name ?? "A project"} you are bidding on has published an addendum: ${addendum.title}.\n\n` +
              `${addendum.description ?? ""}\n\nPlease review the updated documents before your bid deadline.`,
          });
        }
      }
    }

    const row = await q1(
      `update document_addenda set status = 'published', published_by = $2, published_at = now(), updated_at = now()
       where id = $1 returning *`,
      [addendum.id, auth.userId],
    );
    res.json({ addendum: row, notifiedVendorCompanies: vendorCompanyIds.length });
  }),
);

// ---- POST /blueprint/addenda/:id/acknowledge ---------------------------------------
// Vendor-side: a member of a vendor company that was actually notified of this
// addendum (a document_addendum_acknowledgments row already exists from /publish)
// can mark their company's acknowledgment. Never lets a company acknowledge an
// addendum it was never notified of.
router.post(
  "/addenda/:id/acknowledge",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const addendum = await q1<any>(`select * from document_addenda where id = $1`, [req.params.id]);
    if (!addendum) throw new NotFoundError("addendum not found");
    if (addendum.status !== "published") {
      return res.status(400).json({ error: "only a published addendum can be acknowledged" });
    }
    const myCompanyIds = auth.isAdmin ? [] : await userCompanyIds(auth.userId!);
    let vendorCompanyId = String(req.body?.vendorCompanyId || "");
    if (!auth.isAdmin) {
      const ack = await q1<any>(
        `select * from document_addendum_acknowledgments where addendum_id = $1 and vendor_company_id = any($2)`,
        [addendum.id, myCompanyIds],
      );
      if (!ack) throw new ForbiddenError("your company was not notified of this addendum");
      vendorCompanyId = ack.vendor_company_id;
    }
    if (!vendorCompanyId) return res.status(400).json({ error: "vendorCompanyId required" });
    const row = await q1(
      `update document_addendum_acknowledgments set acknowledged_at = now(), acknowledged_by = $3
       where addendum_id = $1 and vendor_company_id = $2 returning *`,
      [addendum.id, vendorCompanyId, auth.userId],
    );
    if (!row) throw new NotFoundError("this vendor company was not notified of this addendum");
    res.json({ acknowledgment: row });
  }),
);

export default router;
