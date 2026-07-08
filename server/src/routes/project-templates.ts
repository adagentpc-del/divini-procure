/**
 * Project Templates: reusable, asset-type-specific procurement blueprints for
 * Divini Procure. Self-pathed; mounted in routes.ts with
 * `router.use(projectTemplatesRouter)` (NO extra prefix), so paths are
 * /api/project-templates/* and /api/admin/project-templates.
 *
 * A template suggests bid packages (CSI-style categories), documents, vendor
 * categories, a phased timeline, risk flags, and investor-report sections. A
 * developer applies a template to a project (a `buildings` row owned by their
 * company) and may optionally materialize draft bid packages from the suggested
 * categories.
 *
 * Tables live in db/schema-project-templates.sql. Zero em dashes by convention.
 *
 * Endpoints:
 *   GET  /project-templates              (requireUser) -> { templates: [...] }
 *   GET  /project-templates/:key         (requireUser) -> { template }
 *   POST /admin/project-templates        (requireAdmin) -> { template }  (upsert custom)
 *   POST /project-templates/:key/apply   (requireUser, building member)
 *        body { buildingId, createPackages?: boolean }
 *        -> { template, applied:{ buildingId, suggested_bid_packages, ... },
 *             createdPackages:[{ id, category }] }
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  asset_type: string | null;
  description: string | null;
  suggested_bid_packages: string[];
  suggested_documents: string[];
  vendor_categories: string[];
  timeline: unknown;
  risk_flags: string[];
  investor_report_sections: string[];
  builtin: boolean;
  created_by: string | null;
  created_at: string;
}

/** True when the user is a member of the building's developer (owning) company. */
async function isBuildingMember(userId: string | null, buildingId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await q1(
    `select 1
       from buildings b
       join company_members m on m.company_id = b.company_id
      where b.id = $1 and m.user_id = $2`,
    [buildingId, userId],
  );
  return !!row;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// GET /project-templates -> all templates (built-in + custom)
// ---------------------------------------------------------------------------
router.get(
  "/project-templates",
  requireUser,
  h(async (_req, res) => {
    const rows = await q<TemplateRow>(
      `select * from project_templates order by builtin desc, asset_type asc, name asc`,
    );
    res.json({ templates: rows });
  }),
);

// ---------------------------------------------------------------------------
// GET /project-templates/:key -> one template
// ---------------------------------------------------------------------------
router.get(
  "/project-templates/:key",
  requireUser,
  h(async (req, res) => {
    const row = await q1<TemplateRow>(`select * from project_templates where key = $1`, [
      req.params.key,
    ]);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ template: row });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/project-templates -> upsert a custom template (builtin=false)
// ---------------------------------------------------------------------------
router.post(
  "/admin/project-templates",
  requireAdmin,
  h(async (req, res) => {
    const { email, userId } = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim().toLowerCase().replace(/\s+/g, "_") : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!key) return res.status(400).json({ error: "key is required" });
    if (!name) return res.status(400).json({ error: "name is required" });

    const assetType = typeof body.asset_type === "string" ? body.asset_type.trim() : null;
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const suggestedBidPackages = asStringArray(body.suggested_bid_packages);
    const suggestedDocuments = asStringArray(body.suggested_documents);
    const vendorCategories = asStringArray(body.vendor_categories);
    const riskFlags = asStringArray(body.risk_flags);
    const investorReportSections = asStringArray(body.investor_report_sections);
    // timeline: accept an array; default to [] if absent or malformed
    const timeline = Array.isArray(body.timeline) ? body.timeline : [];

    const row = await q1<TemplateRow>(
      `insert into project_templates
         (key, name, asset_type, description, suggested_bid_packages, suggested_documents,
          vendor_categories, timeline, risk_flags, investor_report_sections, builtin, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,false,$11)
       on conflict (key) do update set
          name = excluded.name,
          asset_type = excluded.asset_type,
          description = excluded.description,
          suggested_bid_packages = excluded.suggested_bid_packages,
          suggested_documents = excluded.suggested_documents,
          vendor_categories = excluded.vendor_categories,
          timeline = excluded.timeline,
          risk_flags = excluded.risk_flags,
          investor_report_sections = excluded.investor_report_sections,
          builtin = false
       returning *`,
      [
        key,
        name,
        assetType,
        description,
        suggestedBidPackages,
        suggestedDocuments,
        vendorCategories,
        JSON.stringify(timeline),
        riskFlags,
        investorReportSections,
        email ?? userId ?? null,
      ],
    );
    res.json({ template: row });
  }),
);

// ---------------------------------------------------------------------------
// POST /project-templates/:key/apply -> return suggestions for a building, and
// optionally create one draft bid package per suggested category.
//
// `packages` columns are confirmed (db/schema.sql): (building_id, category,
// status). status CHECK allows 'draft'. So createPackages inserts are safe.
// ---------------------------------------------------------------------------
router.post(
  "/project-templates/:key/apply",
  requireUser,
  h(async (req, res) => {
    const { userId, isAdmin } = getAuth(req);
    const template = await q1<TemplateRow>(`select * from project_templates where key = $1`, [
      req.params.key,
    ]);
    if (!template) return res.status(404).json({ error: "template not found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const buildingId = typeof body.buildingId === "string" ? body.buildingId : "";
    const createPackages = body.createPackages === true;
    if (!buildingId) return res.status(400).json({ error: "buildingId is required" });

    const building = await q1<{ id: string }>(`select id from buildings where id = $1`, [
      buildingId,
    ]);
    if (!building) return res.status(404).json({ error: "building not found" });

    if (!isAdmin && !(await isBuildingMember(userId, buildingId))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const applied = {
      buildingId,
      templateKey: template.key,
      templateName: template.name,
      suggested_bid_packages: template.suggested_bid_packages,
      suggested_documents: template.suggested_documents,
      vendor_categories: template.vendor_categories,
      timeline: template.timeline,
      risk_flags: template.risk_flags,
      investor_report_sections: template.investor_report_sections,
    };

    let createdPackages: { id: string; category: string }[] = [];
    if (createPackages && template.suggested_bid_packages.length) {
      for (const category of template.suggested_bid_packages) {
        const cat = String(category).trim();
        if (!cat) continue;
        const pkg = await q1<{ id: string; category: string }>(
          `insert into packages (building_id, category, status)
                values ($1, $2, 'draft')
             returning id, category`,
          [buildingId, cat],
        );
        if (pkg) createdPackages.push(pkg);
      }
    }

    res.json({ template, applied, createdPackages });
  }),
);

export default router;
