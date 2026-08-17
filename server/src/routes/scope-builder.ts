/**
 * Divini Scope Builder - structured procurement requirement definitions.
 * Mounted under /api/scope in routes.ts.
 *
 * A scope_instance is the filled-out requirement set for a real bid package:
 * standard narrative sections (site conditions, access, delivery/install,
 * exclusions, acceptance criteria, change-order rules) live directly on the
 * row; trade-specific structured answers (from a scope_template's fields)
 * live in scope_responses, typed per field_type rather than free text.
 *
 * Publishing takes an immutable snapshot (scope_versions) and syncs the
 * scope into packages.requirements (text[]) - the shared record other parts
 * of the app already read (server/src/routes/intel.ts's vendor-package
 * matching). Publishing is never blocked on completeness: the completeness
 * score (server/src/lib/scope-completeness.ts) is informational, not a gate,
 * per "never make binding decisions for the user."
 *
 * Authorization: like Divini Pipeline, a scope_instance belongs to exactly
 * one organization_id. Access = member of that company, or admin. Templates
 * with organization_id = null are global reference data, readable by any
 * signed-in user; an org's own custom templates are scoped to its members.
 *
 * Tables live in db/schema-scope-builder.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { scoreScopeCompleteness } from "../lib/scope-completeness.js";
import { llmEnabled, llmJson } from "../lib/llm.js";
import { sanitizeForLlm } from "../lib/extract.js";
import { llmRateLimit } from "../lib/rateLimit.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const FIELD_TYPES = new Set(["text", "number", "quantity", "date", "boolean", "select", "multiselect"]);
const INSTANCE_STATUSES = new Set(["draft", "published", "archived"]);

// Fresh competitive scan (2026-08-17), gap #8: AI-generated scope-of-work
// draft from plans/specs. The AI freeze was explicitly opened for this by
// the user - shares the analyze route's rate limit and disclaimer shape
// (blueprint.ts) since it is the same class of feature: optional, capped,
// user-triggered, never auto-saved.
const aiDraftLimit = llmRateLimit({ max: 30, windowMs: 60 * 60_000 });
const AI_DRAFT_DISCLAIMER =
  "AI-drafted from your uploaded plans and specs. Review and edit before saving - nothing here is saved automatically.";
// Real content only - filename/extension classification (extraction_method
// 'none') and a failed extraction attempt carry no grounded text to draft
// from.
const GROUNDED_EXTRACTION_METHODS = ["pdf_text_layer", "ocr", "dxf_entities"];
// Keep the combined prompt body bounded regardless of how many/how large
// the linked documents are - this is a cost/latency cap, not a security
// control (sanitizeForLlm below is the security control).
const MAX_DOCUMENT_CHARS_TOTAL = 15000;

async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

async function authorizeInstance(req: Request, id: string): Promise<any> {
  const auth = getAuth(req);
  const inst = await q1<any>(`select * from scope_instances where id = $1`, [id]);
  if (!inst) throw new NotFoundError("scope not found");
  if (auth.isAdmin) return inst;
  if (await isMemberOfCompany(auth.userId!, inst.organization_id)) return inst;
  throw new ForbiddenError("not a member of this scope's organization");
}

async function loadTemplateFields(templateId: string | null): Promise<any[]> {
  if (!templateId) return [];
  return q(`select * from scope_template_fields where template_id = $1 order by sort_order asc`, [templateId]);
}

/** Parse a string[] from a body value (array of strings, or comma-separated string). */
function toTextArray(v: unknown): string[] | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function responseValue(r: any): unknown {
  if (r.value_text != null) return r.value_text;
  if (r.value_number != null) return Number(r.value_number);
  if (r.value_bool != null) return r.value_bool;
  if (r.value_date != null) return r.value_date;
  if (r.value_json != null) return r.value_json;
  return null;
}

function computeCompleteness(instance: any, fields: any[], responses: any[]) {
  const requiredFields = fields.filter((f) => f.required);
  const answeredKeys = new Set(responses.filter((r) => responseValue(r) != null && responseValue(r) !== "").map((r) => r.field_key));
  const requiredAnswered = requiredFields.filter((f) => answeredKeys.has(f.field_key)).length;
  return scoreScopeCompleteness({
    requiredFieldsTotal: requiredFields.length,
    requiredFieldsAnswered: requiredAnswered,
    siteConditions: instance.site_conditions,
    accessRestrictions: instance.access_restrictions,
    deliveryRequirements: instance.delivery_requirements,
    installRequirements: instance.install_requirements,
    exclusions: instance.exclusions,
    acceptanceCriteria: instance.acceptance_criteria,
    changeOrderRules: instance.change_order_rules,
  });
}

/** Build human-readable requirement lines for packages.requirements (text[]). */
function buildRequirementLines(instance: any, fields: any[], responses: any[]): string[] {
  const lines: string[] = [];
  const byKey = new Map(responses.map((r) => [r.field_key, r]));
  for (const f of fields) {
    const r = byKey.get(f.field_key);
    if (!r) continue;
    const v = responseValue(r);
    if (v == null || v === "") continue;
    lines.push(`${f.label}: ${v}${f.unit ? ` ${f.unit}` : ""}`);
  }
  if (instance.site_conditions) lines.push(`Site conditions: ${instance.site_conditions}`);
  if (instance.access_restrictions) lines.push(`Access restrictions: ${instance.access_restrictions}`);
  if (instance.delivery_requirements) lines.push(`Delivery: ${instance.delivery_requirements}`);
  if (instance.install_requirements) lines.push(`Install: ${instance.install_requirements}`);
  for (const ex of instance.exclusions ?? []) lines.push(`Exclusion: ${ex}`);
  for (const ac of instance.acceptance_criteria ?? []) lines.push(`Acceptance criteria: ${ac}`);
  if (instance.change_order_rules) lines.push(`Change-order rules: ${instance.change_order_rules}`);
  return lines;
}

// ---- GET /scope/templates?companyId=&category= ------------------------------
router.get(
  "/templates",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const rawCompanyId = req.query.companyId ? String(req.query.companyId) : null;
    // IDOR fix: only include this company's own custom scope templates if
    // the caller is a member (or admin) - otherwise fall back to
    // global-only, same as omitting companyId, rather than leaking another
    // company's private templates. The very next route (GET /templates/:id)
    // and every other route in this file already had this check; this list
    // route was the one outlier.
    const companyId =
      rawCompanyId && (auth.isAdmin || (await isMemberOfCompany(auth.userId!, rawCompanyId)))
        ? rawCompanyId
        : null;
    const category = req.query.category ? String(req.query.category) : null;
    const conditions = ["(t.organization_id is null or t.organization_id = $1)", "t.active = true"];
    const params: unknown[] = [companyId];
    let i = 2;
    if (category) {
      conditions.push(`t.category = $${i++}`);
      params.push(category);
    }
    const rows = await q(
      `select t.* from scope_templates t where ${conditions.join(" and ")}
        order by t.organization_id nulls last, t.category asc, t.name asc`,
      params,
    );
    res.json({ templates: rows });
  }),
);

// ---- GET /scope/templates/:id ------------------------------------------------
router.get(
  "/templates/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const tmpl = await q1<any>(`select * from scope_templates where id = $1`, [req.params.id]);
    if (!tmpl) throw new NotFoundError("template not found");
    if (tmpl.organization_id && !auth.isAdmin && !(await isMemberOfCompany(auth.userId!, tmpl.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const fields = await loadTemplateFields(tmpl.id);
    res.json({ template: tmpl, fields });
  }),
);

// ---- POST /scope/templates {companyId, category, name, description?, fields:[]} ----
router.post(
  "/templates",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const companyId = String(b.companyId || "");
    const category = String(b.category || "").trim();
    const name = String(b.name || "").trim();
    if (!companyId || !category || !name) {
      return res.status(400).json({ error: "companyId, category, and name required" });
    }
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const fieldsIn: any[] = Array.isArray(b.fields) ? b.fields : [];
    for (const f of fieldsIn) {
      if (!f.fieldKey || !f.label || !FIELD_TYPES.has(f.fieldType)) {
        return res.status(400).json({ error: "each field requires fieldKey, label, and a valid fieldType" });
      }
    }

    const tmpl = await q1<any>(
      `insert into scope_templates (organization_id, category, name, description, created_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [companyId, category, name, b.description ?? null, auth.userId],
    );
    for (let idx = 0; idx < fieldsIn.length; idx++) {
      const f = fieldsIn[idx];
      await q(
        `insert into scope_template_fields
           (template_id, field_key, label, field_type, unit, options, required, section, sort_order, help_text)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tmpl.id,
          String(f.fieldKey),
          String(f.label),
          String(f.fieldType),
          f.unit ?? null,
          f.options ? JSON.stringify(f.options) : null,
          !!f.required,
          f.section ?? null,
          f.sortOrder ?? idx * 10,
          f.helpText ?? null,
        ],
      );
    }
    const fields = await loadTemplateFields(tmpl.id);
    res.status(201).json({ template: tmpl, fields });
  }),
);

// ---- GET /scope/instances?companyId=&packageId= ------------------------------
router.get(
  "/instances",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const conditions = ["organization_id = $1"];
    const params: unknown[] = [companyId];
    let i = 2;
    if (req.query.packageId) {
      conditions.push(`package_id = $${i++}`);
      params.push(String(req.query.packageId));
    }
    if (req.query.status) {
      const status = String(req.query.status);
      if (!INSTANCE_STATUSES.has(status)) {
        return res.status(400).json({ error: `invalid status: ${status}` });
      }
      conditions.push(`status = $${i++}`);
      params.push(status);
    }
    const rows = await q(
      `select * from scope_instances where ${conditions.join(" and ")} order by updated_at desc limit 500`,
      params,
    );
    res.json({ instances: rows });
  }),
);

// ---- POST /scope/instances {companyId, packageId?, templateId?, category, title} ----
router.post(
  "/instances",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const companyId = String(b.companyId || "");
    const category = String(b.category || "").trim();
    const title = String(b.title || "").trim();
    if (!companyId || !category || !title) {
      return res.status(400).json({ error: "companyId, category, and title required" });
    }
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const row = await q1<any>(
      `insert into scope_instances (organization_id, package_id, template_id, category, title, created_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [companyId, b.packageId ?? null, b.templateId ?? null, category, title, auth.userId],
    );
    await q(
      `insert into scope_change_events (scope_instance_id, event_type, actor) values ($1,'created',$2)`,
      [row.id, auth.userId],
    );
    res.status(201).json({ instance: row });
  }),
);

// ---- GET /scope/instances/:id -------------------------------------------------
router.get(
  "/instances/:id",
  requireUser,
  h(async (req, res) => {
    const inst = await authorizeInstance(req, req.params.id);
    const [fields, responses, versions, changeEvents] = await Promise.all([
      loadTemplateFields(inst.template_id),
      q(`select * from scope_responses where scope_instance_id = $1`, [inst.id]),
      q(`select * from scope_versions where scope_instance_id = $1 order by version_number desc`, [inst.id]),
      q(`select * from scope_change_events where scope_instance_id = $1 order by created_at desc`, [inst.id]),
    ]);
    const completeness = computeCompleteness(inst, fields, responses as any[]);
    res.json({ instance: inst, fields, responses, completeness, versions, changeEvents });
  }),
);

const EDITABLE_INSTANCE_FIELDS: Record<string, string> = {
  title: "title",
  siteConditions: "site_conditions",
  accessRestrictions: "access_restrictions",
  deliveryRequirements: "delivery_requirements",
  installRequirements: "install_requirements",
  exclusions: "exclusions",
  acceptanceCriteria: "acceptance_criteria",
  changeOrderRules: "change_order_rules",
};
const ARRAY_FIELDS = new Set(["exclusions", "acceptanceCriteria"]);

// ---- PATCH /scope/instances/:id -----------------------------------------------
router.patch(
  "/instances/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const inst = await authorizeInstance(req, req.params.id);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const changed: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(EDITABLE_INSTANCE_FIELDS)) {
      if (b[key] !== undefined) {
        const isArray = ARRAY_FIELDS.has(key);
        const value = isArray ? toTextArray(b[key]) : b[key];
        sets.push(`${column} = $${i++}${isArray ? "::text[]" : ""}`);
        vals.push(value);
        changed[key] = value;
      }
    }
    if (sets.length === 0) return res.json({ instance: inst });
    sets.push(`updated_at = now()`);
    vals.push(inst.id);
    const row = await q1(`update scope_instances set ${sets.join(", ")} where id = $${i} returning *`, vals);
    await q(
      `insert into scope_change_events (scope_instance_id, event_type, new_value, actor)
       values ($1,'field_updated',$2,$3)`,
      [inst.id, JSON.stringify(changed), auth.userId],
    );
    res.json({ instance: row });
  }),
);

/**
 * Draft the standard narrative fields from real, extracted document text -
 * grounded, not from file bytes it cannot see, same trust boundary every
 * other AI touch point in this codebase already enforces. Returns the
 * draft only; NEVER writes to scope_instances. The caller (ScopeBuilder.tsx)
 * pre-fills the already-editable form with it and the user explicitly
 * saves via the existing PATCH /instances/:id, unchanged.
 */
async function draftScopeFromDocuments(
  docs: { name: string; extracted_text: string }[],
): Promise<{
  siteConditions?: string;
  accessRestrictions?: string;
  deliveryRequirements?: string;
  installRequirements?: string;
  exclusions?: string[];
  acceptanceCriteria?: string[];
} | null> {
  if (!llmEnabled() || docs.length === 0) return null;

  let budget = MAX_DOCUMENT_CHARS_TOTAL;
  const perDocBudget = Math.floor(MAX_DOCUMENT_CHARS_TOTAL / docs.length);
  const sourceText = docs
    .map((d) => {
      const take = Math.min(perDocBudget, budget);
      budget -= take;
      return `--- ${sanitizeForLlm(d.name).slice(0, 200)} ---\n${sanitizeForLlm(d.extracted_text).slice(0, take)}`;
    })
    .join("\n\n");

  const system =
    "You draft PRELIMINARY, EDITABLE scope-of-work narrative fields for a construction bid package, for a " +
    "human to review and edit before anything is saved. You are given real text extracted from the project's " +
    "own uploaded plans/specs - use ONLY what is explicitly stated in that text. You must NEVER invent " +
    "quantities, dimensions, materials, brand names, code requirements, or any specific fact not clearly " +
    "present in the source text. If a field cannot be grounded in the source text, omit it entirely rather " +
    "than guessing or writing a generic placeholder. Reply with JSON only.";
  const prompt =
    `Source document text (extracted from this package's own uploaded plans/specs):\n\n${sourceText}\n\n` +
    "Return JSON with any of these keys you can ground in the source text above (omit any you cannot): " +
    '{"siteConditions": string, "accessRestrictions": string, "deliveryRequirements": string, ' +
    '"installRequirements": string, "exclusions": string[], "acceptanceCriteria": string[]}. ' +
    "siteConditions: existing conditions at the site relevant to this trade, if stated. accessRestrictions: " +
    "any stated access/scheduling constraints. deliveryRequirements: stated material delivery requirements. " +
    "installRequirements: stated installation requirements or sequencing. exclusions: specific items the " +
    "source text explicitly excludes from this scope. acceptanceCriteria: specific, explicitly stated " +
    "completion/acceptance criteria. Keep each string field under 500 characters.";

  const out = await llmJson<{
    siteConditions?: unknown;
    accessRestrictions?: unknown;
    deliveryRequirements?: unknown;
    installRequirements?: unknown;
    exclusions?: unknown;
    acceptanceCriteria?: unknown;
  }>(prompt, { system, timeoutMs: 25000 });
  if (!out) return null;

  const draft: Awaited<ReturnType<typeof draftScopeFromDocuments>> = {};
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 300)).slice(0, 20)
      : undefined;
  const siteConditions = str(out.siteConditions);
  const accessRestrictions = str(out.accessRestrictions);
  const deliveryRequirements = str(out.deliveryRequirements);
  const installRequirements = str(out.installRequirements);
  const exclusions = strArr(out.exclusions);
  const acceptanceCriteria = strArr(out.acceptanceCriteria);
  if (siteConditions) draft!.siteConditions = siteConditions;
  if (accessRestrictions) draft!.accessRestrictions = accessRestrictions;
  if (deliveryRequirements) draft!.deliveryRequirements = deliveryRequirements;
  if (installRequirements) draft!.installRequirements = installRequirements;
  if (exclusions?.length) draft!.exclusions = exclusions;
  if (acceptanceCriteria?.length) draft!.acceptanceCriteria = acceptanceCriteria;
  return Object.keys(draft!).length > 0 ? draft : null;
}

// ---- POST /scope/instances/:id/ai-draft ----------------------------------------
router.post(
  "/instances/:id/ai-draft",
  requireUser,
  aiDraftLimit,
  h(async (req, res) => {
    const inst = await authorizeInstance(req, req.params.id);
    if (!inst.package_id) {
      return res.json({ draft: null, reason: "This scope isn't linked to a bid package yet - link a package first." });
    }
    if (!llmEnabled()) {
      return res.json({ draft: null, reason: "AI drafting is not configured in this environment." });
    }

    // Documents linked either directly (documents.package_id) or via a
    // building-level upload later tagged to this package
    // (blueprint_document_package_links) - Divini Blueprint's own model
    // for "a source drawing set often applies to more than one package".
    const docs = await q<{ name: string; extracted_text: string }>(
      `select distinct d.name, d.extracted_text
         from documents d
        where (
          d.package_id = $1
          or d.id in (select document_id from blueprint_document_package_links where package_id = $1)
        )
          and d.extraction_method = any($2)
          and d.extracted_text is not null
          and length(trim(d.extracted_text)) > 0`,
      [inst.package_id, GROUNDED_EXTRACTION_METHODS],
    );
    if (docs.length === 0) {
      return res.json({
        draft: null,
        reason: "No analyzable document content found for this package's linked plans/specs - upload plans and run content extraction (Divini Blueprint) first.",
      });
    }

    const draft = await draftScopeFromDocuments(docs);
    if (!draft) {
      return res.json({ draft: null, reason: "Could not draft grounded content from the linked documents - try again, or fill in manually." });
    }
    res.json({ draft, disclaimer: AI_DRAFT_DISCLAIMER, sourceDocumentCount: docs.length });
  }),
);

// ---- PUT /scope/instances/:id/responses {responses:[{fieldKey,value}]} -------
router.put(
  "/instances/:id/responses",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const inst = await authorizeInstance(req, req.params.id);
    const responsesIn: { fieldKey: string; value: unknown }[] = Array.isArray(req.body?.responses)
      ? req.body.responses
      : [];
    if (responsesIn.length === 0) return res.status(400).json({ error: "responses required" });

    const fields = await loadTemplateFields(inst.template_id);
    const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));

    for (const r of responsesIn) {
      const field = fieldByKey.get(r.fieldKey);
      const type = field?.field_type ?? "text";
      const cols = { text: null as unknown, number: null as unknown, bool: null as unknown, date: null as unknown, json: null as unknown };
      if (type === "number" || type === "quantity") cols.number = r.value == null ? null : Number(r.value);
      else if (type === "boolean") cols.bool = r.value == null ? null : !!r.value;
      else if (type === "date") cols.date = r.value ?? null;
      else if (type === "select" || type === "multiselect") cols.json = r.value == null ? null : JSON.stringify(r.value);
      else cols.text = r.value == null ? null : String(r.value);

      await q(
        `insert into scope_responses (scope_instance_id, field_key, value_text, value_number, value_bool, value_date, value_json)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (scope_instance_id, field_key) do update set
           value_text = excluded.value_text, value_number = excluded.value_number,
           value_bool = excluded.value_bool, value_date = excluded.value_date,
           value_json = excluded.value_json, updated_at = now()`,
        [inst.id, r.fieldKey, cols.text, cols.number, cols.bool, cols.date, cols.json],
      );
    }
    await q(`update scope_instances set updated_at = now() where id = $1`, [inst.id]);
    await q(
      `insert into scope_change_events (scope_instance_id, event_type, new_value, actor)
       values ($1,'field_updated',$2,$3)`,
      [inst.id, JSON.stringify({ responses: responsesIn.map((r) => r.fieldKey) }), auth.userId],
    );
    const responses = await q(`select * from scope_responses where scope_instance_id = $1`, [inst.id]);
    res.json({ responses });
  }),
);

/** Shared publish/republish logic: snapshot + sync into packages.requirements. */
async function publishInstance(
  instanceId: string,
  eventType: "published" | "republished",
  actorUserId: string | null,
  changeSummary: string | null,
): Promise<any> {
  const inst = await q1<any>(`select * from scope_instances where id = $1`, [instanceId]);
  const fields = await loadTemplateFields(inst.template_id);
  const responses = await q(`select * from scope_responses where scope_instance_id = $1`, [instanceId]);

  const nextVersion = (inst.current_version ?? 0) + 1;
  const snapshot = {
    instance: inst,
    fields,
    responses,
    versionedAt: new Date().toISOString(),
  };
  await q(
    `insert into scope_versions (scope_instance_id, version_number, snapshot_json, change_summary, created_by)
     values ($1,$2,$3,$4,$5)`,
    [instanceId, nextVersion, JSON.stringify(snapshot), changeSummary, actorUserId],
  );

  const row = await q1<any>(
    `update scope_instances set status = 'published', current_version = $2, updated_at = now()
       where id = $1 returning *`,
    [instanceId, nextVersion],
  );

  if (row.package_id) {
    const lines = buildRequirementLines(row, fields, responses as any[]);
    await q(`update packages set requirements = $2::text[] where id = $1`, [row.package_id, lines]);
  }

  await q(
    `insert into scope_change_events (scope_instance_id, event_type, new_value, actor)
     values ($1,$2,$3,$4)`,
    [instanceId, eventType, JSON.stringify({ version: nextVersion }), actorUserId],
  );

  return row;
}

// ---- POST /scope/instances/:id/publish ----------------------------------------
router.post(
  "/instances/:id/publish",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const inst = await authorizeInstance(req, req.params.id);
    if (inst.status === "published") {
      return res.status(400).json({ error: "already published; use republish to snapshot changes" });
    }
    const row = await publishInstance(inst.id, "published", auth.userId, req.body?.changeSummary ?? null);
    res.status(201).json({ instance: row });
  }),
);

// ---- POST /scope/instances/:id/republish {changeSummary?} --------------------
router.post(
  "/instances/:id/republish",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const inst = await authorizeInstance(req, req.params.id);
    if (inst.status !== "published") {
      return res.status(400).json({ error: "scope is not published yet; use publish" });
    }
    const row = await publishInstance(inst.id, "republished", auth.userId, req.body?.changeSummary ?? null);
    res.json({ instance: row });
  }),
);

// ---- PATCH /scope/instances/:id/archive ---------------------------------------
router.patch(
  "/instances/:id/archive",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const inst = await authorizeInstance(req, req.params.id);
    const row = await q1(
      `update scope_instances set status = 'archived', updated_at = now() where id = $1 returning *`,
      [inst.id],
    );
    await q(
      `insert into scope_change_events (scope_instance_id, event_type, actor) values ($1,'archived',$2)`,
      [inst.id, auth.userId],
    );
    res.json({ instance: row });
  }),
);

export default router;
