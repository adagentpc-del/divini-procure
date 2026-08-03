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
 * HONESTY BOUNDARY (see db/schema-blueprint.sql for the full note): this
 * codebase has no CAD-parsing or OCR library. Classification
 * (server/src/lib/document-classifier.ts) reads filenames/extensions only,
 * never file content, and never returns "high" confidence for that reason.
 * The optional AI summary step below uses the existing gracefully-degrading
 * LLM client (server/src/lib/llm.ts) to draft narrative from that
 * classification plus any text the user explicitly supplies - never from
 * file content it cannot see, and always requiring user review before
 * anything is created. When the LLM is not configured, the deterministic
 * classification + trade suggestions still work in full - this is the
 * "must work without an LLM" baseline.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { classifyDocument, type Discipline } from "../lib/document-classifier.js";
import { suggestTrades } from "../lib/trade-suggester.js";
import { llmEnabled, llmJson } from "../lib/llm.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const SUGGESTION_STATUSES = new Set(["accepted", "rejected", "merged"]);
const DISCLAIMER =
  "AI-generated preliminary project information. Review and approval by the project owner and appropriate licensed professionals are required before use.";

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

export default router;
