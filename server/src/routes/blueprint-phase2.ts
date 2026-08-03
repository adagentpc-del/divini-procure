/**
 * Divini Blueprint Phase 2 - the pieces of the CAD/Drawing/Plan/
 * Specification/Bid Intelligence master spec buildable with NO additional
 * backend service or API key: CSI division tagging (from the already-
 * classified discipline, never document content), CSV-only budget import
 * and reconciliation, and manual (never AI) quantity observations.
 * Mounted at /api/blueprint alongside server/src/routes/blueprint.ts, in a
 * separate file to keep each slice's route surface readable.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { guessCsiDivision, divisionByCode, missingDivisionsForDrawingDisciplines } from "../lib/csi-divisions.js";
import { parseBudgetCsv } from "../lib/csv-parser.js";
import { matchBudgetRowToPackage } from "../lib/budget-mapper.js";
import type { Discipline } from "../lib/document-classifier.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

async function isMemberOfCompany(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [userId, companyId]);
  return !!row;
}

async function authorizeBuilding(req: Request, buildingId: string): Promise<{ id: string; company_id: string }> {
  const auth = getAuth(req);
  const building = await q1<{ id: string; company_id: string }>(`select id, company_id from buildings where id = $1`, [buildingId]);
  if (!building) throw new NotFoundError("project not found");
  if (auth.isAdmin) return building;
  if (await isMemberOfCompany(auth.userId!, building.company_id)) return building;
  throw new ForbiddenError("not a member of this project's organization");
}

// ===========================================================================
// CSI division tagging
// ===========================================================================

// ---- POST /blueprint/documents/:id/guess-csi-division ----------------------------
// Never overwrites a user override. Guesses purely from the document's
// already-classified discipline (never content) - null if that discipline
// has no reasonable single-division mapping.
router.post(
  "/documents/:id/guess-csi-division",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    if (doc.csi_division_overridden_by_user) return res.json({ document: doc });
    const division = doc.discipline ? guessCsiDivision(doc.discipline as Discipline) : null;
    const row = await q1(
      `update documents set csi_division_code = $2, csi_division_name = $3, csi_division_confidence = $4 where id = $1 returning *`,
      [doc.id, division?.code ?? null, division?.name ?? null, division ? "low" : null],
    );
    res.json({ document: row });
  }),
);

// ---- PATCH /blueprint/documents/:id/csi-division {csiDivisionCode} ---------------
router.patch(
  "/documents/:id/csi-division",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const doc = await q1<any>(`select * from documents where id = $1`, [req.params.id]);
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, doc.company_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const code = req.body?.csiDivisionCode ? String(req.body.csiDivisionCode) : null;
    const division = code ? divisionByCode(code) : null;
    if (code && !division) return res.status(400).json({ error: "unknown CSI division code" });
    const row = await q1(
      `update documents set csi_division_code = $2, csi_division_name = $3, csi_division_confidence = null, csi_division_overridden_by_user = true
       where id = $1 returning *`,
      [doc.id, division?.code ?? null, division?.name ?? null],
    );
    res.json({ document: row });
  }),
);

// ---- GET /blueprint/specification-index?buildingId= -------------------------------
router.get(
  "/specification-index",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);

    const specs = await q<any>(
      `select id, name, discipline, csi_division_code, csi_division_name, csi_division_confidence, csi_division_overridden_by_user
       from documents where building_id = $1 and document_category = 'specification' order by csi_division_code nulls last`,
      [buildingId],
    );
    const drawingDisciplines = await q<{ discipline: string }>(
      `select distinct discipline from documents where building_id = $1 and document_category = 'drawing' and discipline is not null`,
      [buildingId],
    );
    const specDivisionCodes = [...new Set(specs.map((s: any) => s.csi_division_code).filter(Boolean))] as string[];
    const missing = missingDivisionsForDrawingDisciplines(
      drawingDisciplines.map((d) => d.discipline as Discipline),
      specDivisionCodes,
    );
    res.json({
      specifications: specs,
      missingDivisions: missing,
      note: "Missing divisions are inferred from drawing disciplines present, not confirmed from specification content - documents may exist but be misclassified.",
    });
  }),
);

// ===========================================================================
// Budget import and reconciliation (CSV only)
// ===========================================================================

// ---- POST /blueprint/budget-imports {buildingId, csvText, filename?, sourceDocumentId?}
router.post(
  "/budget-imports",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const buildingId = String(b.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    const csvText = typeof b.csvText === "string" ? b.csvText : "";
    if (!csvText) return res.status(400).json({ error: "csvText required" });
    const building = await authorizeBuilding(req, buildingId);

    const parsed = parseBudgetCsv(csvText);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const packageRows = await q<{ id: string; category: string }>(
      `select id, category from packages where building_id = $1`,
      [buildingId],
    );
    const packages = packageRows.map((p) => ({ packageId: p.id, category: p.category }));

    const importRow = await q1<any>(
      `insert into budget_imports (organization_id, building_id, source_document_id, filename, row_count, skipped_row_count, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        building.company_id, buildingId,
        b.sourceDocumentId ? String(b.sourceDocumentId) : null,
        b.filename ? String(b.filename) : null,
        parsed.rows.length, parsed.skipped, auth.userId,
      ],
    );

    for (const row of parsed.rows) {
      const match = matchBudgetRowToPackage(row, packages);
      await q(
        `insert into budget_import_lines
           (import_id, raw_category, raw_description, raw_amount, amount_cents, matched_package_id, match_confidence, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          importRow.id, row.category || null, row.description || null, row.rawAmount, row.amountCents,
          match?.packageId ?? null, match?.confidence ?? null, match ? "mapped" : "unmapped",
        ],
      );
    }

    const lines = await q(`select * from budget_import_lines where import_id = $1 order by created_at asc`, [importRow.id]);
    res.status(201).json({ import: importRow, lines });
  }),
);

// ---- GET /blueprint/budget-imports?buildingId= -------------------------------------
router.get(
  "/budget-imports",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);
    const rows = await q(`select * from budget_imports where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ imports: rows });
  }),
);

// ---- GET /blueprint/budget-imports/:id ----------------------------------------------
router.get(
  "/budget-imports/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const imp = await q1<any>(`select * from budget_imports where id = $1`, [req.params.id]);
    if (!imp) throw new NotFoundError("import not found");
    if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, imp.organization_id))) {
      throw new ForbiddenError("not a member of this organization");
    }
    const lines = await q(`select * from budget_import_lines where import_id = $1 order by created_at asc`, [imp.id]);
    res.json({ import: imp, lines });
  }),
);

async function authorizeImportLine(req: Request, lineId: string): Promise<{ line: any; imp: any }> {
  const line = await q1<any>(`select * from budget_import_lines where id = $1`, [lineId]);
  if (!line) throw new NotFoundError("budget line not found");
  const imp = await q1<any>(`select * from budget_imports where id = $1`, [line.import_id]);
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, imp.organization_id))) {
    throw new ForbiddenError("not a member of this organization");
  }
  return { line, imp };
}

// ---- PATCH /blueprint/budget-import-lines/:id {matchedPackageId?, status?} ----------
router.patch(
  "/budget-import-lines/:id",
  requireUser,
  h(async (req, res) => {
    const { line } = await authorizeImportLine(req, req.params.id);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    let statusExplicit = false;
    if (b.matchedPackageId !== undefined) {
      sets.push(`matched_package_id = $${i++}`, `match_overridden_by_user = true`);
      vals.push(b.matchedPackageId || null);
    }
    if (b.status !== undefined) {
      statusExplicit = true;
      const status = String(b.status);
      if (!["unmapped", "mapped", "ignored"].includes(status)) return res.status(400).json({ error: "invalid status" });
      sets.push(`status = $${i++}`); vals.push(status);
    }
    // Reassigning matchedPackageId always implies a status, unless the
    // caller also passed one explicitly: assigning a package -> 'mapped',
    // clearing it -> 'unmapped'. Otherwise budget-reconciliation's
    // status = 'mapped' filter would silently exclude a line the user just
    // pointed at a package because status never followed along.
    if (b.matchedPackageId !== undefined && !statusExplicit) {
      sets.push(`status = $${i++}`);
      vals.push(b.matchedPackageId ? "mapped" : "unmapped");
    }
    if (sets.length === 0) return res.json({ line });
    vals.push(line.id);
    const row = await q1(`update budget_import_lines set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ line: row });
  }),
);

// ---- GET /blueprint/budget-reconciliation?buildingId= -------------------------------
router.get(
  "/budget-reconciliation",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);

    const packages = await q<any>(`select id, category, budget_min, budget_max from packages where building_id = $1`, [buildingId]);
    const mappedTotals = await q<{ matched_package_id: string; total_cents: string; line_count: string }>(
      `select l.matched_package_id, sum(l.amount_cents)::bigint as total_cents, count(*)::int as line_count
         from budget_import_lines l join budget_imports i on i.id = l.import_id
        where i.building_id = $1 and l.status = 'mapped' and l.matched_package_id is not null
        group by l.matched_package_id`,
      [buildingId],
    );
    const totalsByPackage = new Map(mappedTotals.map((m) => [m.matched_package_id, m]));

    const unmappedLines = await q<any>(
      `select l.* from budget_import_lines l join budget_imports i on i.id = l.import_id
        where i.building_id = $1 and l.status = 'unmapped'
        order by l.created_at desc`,
      [buildingId],
    );

    const packagesWithBudget = packages.filter((p: any) => totalsByPackage.has(p.id));
    const packagesMissingBudget = packages.filter((p: any) => !totalsByPackage.has(p.id));

    res.json({
      packagesWithImportedBudget: packagesWithBudget.map((p: any) => ({
        packageId: p.id, category: p.category,
        importedTotalCents: Number(totalsByPackage.get(p.id)!.total_cents),
        lineCount: Number(totalsByPackage.get(p.id)!.line_count),
        budgetMin: p.budget_min, budgetMax: p.budget_max,
      })),
      packagesMissingBudget: packagesMissingBudget.map((p: any) => ({ packageId: p.id, category: p.category })),
      unmappedLines,
    });
  }),
);

// ===========================================================================
// Quantity observations - MANUAL ONLY. No AI, no filename inference. See
// db/schema-blueprint-phase2.sql for why source is hard-constrained.
// ===========================================================================

// ---- POST /blueprint/quantity-observations {buildingId, packageId?, description, quantity, unit?, notes?}
router.post(
  "/quantity-observations",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const buildingId = String(b.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    const description = String(b.description || "").trim();
    if (!description) return res.status(400).json({ error: "description required" });
    const quantity = Number(b.quantity);
    if (!Number.isFinite(quantity)) return res.status(400).json({ error: "a numeric quantity is required" });
    const building = await authorizeBuilding(req, buildingId);
    const row = await q1<any>(
      `insert into quantity_observations
         (organization_id, building_id, package_id, description, quantity, unit, notes, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning *`,
      [building.company_id, buildingId, b.packageId || null, description, quantity, b.unit ? String(b.unit) : null, b.notes ? String(b.notes) : null, auth.userId],
    );
    res.status(201).json({ observation: row });
  }),
);

// ---- GET /blueprint/quantity-observations?buildingId= -------------------------------
router.get(
  "/quantity-observations",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await authorizeBuilding(req, buildingId);
    const rows = await q(`select * from quantity_observations where building_id = $1 order by created_at desc`, [buildingId]);
    res.json({ observations: rows });
  }),
);

async function authorizeObservation(req: Request, id: string): Promise<any> {
  const obs = await q1<any>(`select * from quantity_observations where id = $1`, [id]);
  if (!obs) throw new NotFoundError("observation not found");
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMemberOfCompany(auth.userId!, obs.organization_id))) {
    throw new ForbiddenError("not a member of this organization");
  }
  return obs;
}

// ---- PATCH /blueprint/quantity-observations/:id {description?, quantity?, unit?, notes?, verificationStatus?}
router.patch(
  "/quantity-observations/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const obs = await authorizeObservation(req, req.params.id);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (b.description !== undefined) { sets.push(`description = $${i++}`); vals.push(String(b.description)); }
    if (b.quantity !== undefined) {
      const quantity = Number(b.quantity);
      if (!Number.isFinite(quantity)) return res.status(400).json({ error: "a numeric quantity is required" });
      sets.push(`quantity = $${i++}`); vals.push(quantity);
    }
    if (b.unit !== undefined) { sets.push(`unit = $${i++}`); vals.push(b.unit || null); }
    if (b.notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(b.notes || null); }
    if (b.verificationStatus !== undefined) {
      const status = String(b.verificationStatus);
      if (!["unverified", "verified"].includes(status)) return res.status(400).json({ error: "invalid verification status" });
      sets.push(`verification_status = $${i++}`); vals.push(status);
    }
    if (sets.length === 0) return res.json({ observation: obs });
    sets.push(`updated_by = $${i++}`, `updated_at = now()`);
    vals.push(auth.userId);
    vals.push(obs.id);
    const row = await q1(`update quantity_observations set ${sets.join(", ")} where id = $${i} returning *`, vals);
    res.json({ observation: row });
  }),
);

// ---- DELETE /blueprint/quantity-observations/:id -------------------------------------
router.delete(
  "/quantity-observations/:id",
  requireUser,
  h(async (req, res) => {
    const obs = await authorizeObservation(req, req.params.id);
    await q(`delete from quantity_observations where id = $1`, [obs.id]);
    res.json({ ok: true });
  }),
);

export default router;
