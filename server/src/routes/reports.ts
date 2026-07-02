/**
 * Reporting Exports for Divini Procure. Self-pathed (mounted with no prefix in
 * routes.ts), so every route declares its own /reports/... path.
 *
 * Provides:
 *   - CSV downloads (bid comparison per package, vendor directory) with the
 *     right Content-Type + Content-Disposition so the browser saves a file.
 *   - JSON aggregates that the SPA renders into printable HTML reports
 *     (procurement budget, savings, capital pipeline, investor report). These
 *     are print-to-PDF on the client via window.print().
 *
 * Authorization reuses Procure's existing primitives:
 *   - bid-comparison CSV: the package's building owner OR a super-admin.
 *   - vendors CSV: super-admin only (requireAdmin).
 *   - everything else: the signed-in user must be a member of the companyId /
 *     building owner they are reporting on.
 *
 * Every handler is wrapped so that if an underlying table does not exist (a
 * deferred migration), the report degrades to a safe empty shape rather than a
 * 500. No new tables / no schema changes. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { toCsv } from "../lib/csv.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---- helpers ---------------------------------------------------------------

/** Dollars (numeric) -> integer cents, rounding to the nearest cent. */
function dollarsToCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Assert the user is a member of the company (mirrors company_members RLS). */
async function assertMember(userId: string | null, companyId: string): Promise<void> {
  if (!userId) throw new ForbiddenError("unauthorized");
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  if (!row) throw new ForbiddenError("not a member of this company");
}

/** Postgres "undefined_table" (missing relation) error code. */
function isMissingTable(e: any): boolean {
  return e?.code === "42P01" || e?.code === "42703"; // undefined_table or undefined_column
}

/** Set CSV download headers + send the body. */
function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.send(csv);
}

// ===========================================================================
// 1. BID COMPARISON CSV (per package). Owner of the package OR admin.
// ===========================================================================
router.get(
  "/reports/bid-comparison/:packageId.csv",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const packageId = req.params.packageId;

    const pkg = await q1<{ id: string }>(`select id from packages where id = $1`, [packageId]);
    if (!pkg) throw new NotFoundError("package not found");

    if (!auth.isAdmin) {
      const owned = await q1(
        `select 1 from packages p
           join buildings b on b.id = p.building_id
           join company_members cm on cm.company_id = b.company_id
          where p.id = $1 and cm.user_id = $2`,
        [packageId, auth.userId],
      );
      if (!owned) throw new ForbiddenError("not the owner of this package");
    }

    const bids = await q<any>(
      `select c.name as vendor, bd.price, bd.days, bd.status, bd.awarded
         from bids bd
         join companies c on c.id = bd.vendor_company_id
        where bd.package_id = $1
        order by bd.price asc nulls last`,
      [packageId],
    );

    const rows = bids.map((b) => ({
      vendor: b.vendor ?? "",
      price: b.price ?? "",
      days: b.days ?? "",
      status: b.status ?? "",
      awarded: b.awarded ? "yes" : "no",
    }));
    const csv = toCsv(rows, ["vendor", "price", "days", "status", "awarded"]);
    sendCsv(res, `bid-comparison-${packageId}.csv`, csv);
  }),
);

// ===========================================================================
// 2. VENDOR DIRECTORY CSV. Super-admin only.
// ===========================================================================
router.get(
  "/reports/vendors.csv",
  requireAdmin,
  h(async (_req, res) => {
    let vendors: any[] = [];
    try {
      vendors = await q<any>(
        `select name, email, city, region from companies where kind = 'vendor' order by name asc`,
      );
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      vendors = [];
    }
    const rows = vendors.map((v) => ({
      name: v.name ?? "",
      email: v.email ?? "",
      city: v.city ?? "",
      region: v.region ?? "",
    }));
    const csv = toCsv(rows, ["name", "email", "city", "region"]);
    sendCsv(res, `vendors.csv`, csv);
  }),
);

// ===========================================================================
// 3. PROCUREMENT BUDGET (JSON). Member of companyId.
//    Per project: package count + total of awarded bids (dollars -> cents).
// ===========================================================================
router.get(
  "/reports/procurement-budget",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId, companyId);

    try {
      const projects = await q<any>(
        `select b.id, b.name,
                (select count(*) from packages p where p.building_id = b.id) as packages,
                coalesce((
                  select sum(bd.price)
                    from bids bd
                    join packages p on p.id = bd.package_id
                   where p.building_id = b.id and bd.awarded = true
                ), 0) as awarded_total
           from buildings b
          where b.company_id = $1
          order by b.created_at asc`,
        [companyId],
      );
      const mapped = projects.map((p) => ({
        name: p.name ?? "",
        packages: Number(p.packages) || 0,
        awardedTotalCents: dollarsToCents(p.awarded_total),
      }));
      const totals = {
        projects: mapped.length,
        packages: mapped.reduce((s, p) => s + p.packages, 0),
        awardedTotalCents: mapped.reduce((s, p) => s + p.awardedTotalCents, 0),
      };
      res.json({ projects: mapped, totals });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ projects: [], totals: { projects: 0, packages: 0, awardedTotalCents: 0 } });
    }
  }),
);

// ===========================================================================
// 4. PROJECT DOCUMENT INDEX (JSON). Member of the building's company.
// ===========================================================================
router.get(
  "/reports/project-doc-index",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });

    const building = await q1<{ id: string; company_id: string; name: string }>(
      `select id, company_id, name from buildings where id = $1`,
      [buildingId],
    );
    if (!building) throw new NotFoundError("project not found");
    if (!auth.isAdmin) await assertMember(auth.userId, building.company_id);

    try {
      const docs = await q<any>(
        `select id, name, kind, size, package_id, created_at
           from documents where building_id = $1 order by created_at desc`,
        [buildingId],
      );
      res.json({
        project: { id: building.id, name: building.name },
        documents: docs.map((d) => ({
          id: d.id,
          name: d.name ?? "",
          kind: d.kind ?? "",
          size: d.size == null ? null : Number(d.size),
          packageId: d.package_id ?? null,
          created_at: d.created_at ?? null,
        })),
      });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ project: { id: building.id, name: building.name }, documents: [] });
    }
  }),
);

// ===========================================================================
// 5. CAPITAL PIPELINE (JSON). Member of companyId.
//    investment_programs + investor_introduction_requests pipeline counts.
// ===========================================================================
router.get(
  "/reports/capital-pipeline",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId, companyId);

    try {
      const programs = await q<any>(
        `select id, name, target_raise_cents from investment_programs
          where company_id = $1 order by created_at asc`,
        [companyId],
      );
      const out = [];
      for (const p of programs) {
        let counts: Record<string, number> = {};
        try {
          const rows = await q<any>(
            `select coalesce(pipeline_status, 'unknown') as status, count(*) as n
               from investor_introduction_requests
              where program_id = $1 group by 1`,
            [p.id],
          );
          for (const r of rows) counts[r.status] = Number(r.n) || 0;
        } catch (e) {
          if (!isMissingTable(e)) throw e;
          counts = {};
        }
        out.push({
          name: p.name ?? "",
          targetRaiseCents: p.target_raise_cents == null ? 0 : Number(p.target_raise_cents),
          pipelineCounts: counts,
        });
      }
      res.json({ programs: out });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ programs: [] });
    }
  }),
);

// ===========================================================================
// 6. SAVINGS (JSON). Member of companyId.
//    Per project: lowest bid total vs awarded bid total (dollars -> cents).
//    Computed per package, then summed across the project's packages.
// ===========================================================================
router.get(
  "/reports/savings",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId, companyId);

    try {
      // For each package in a company's buildings, lowest non-null bid price and
      // the awarded bid price. Aggregate to the project level.
      const rows = await q<any>(
        `select b.id as building_id, b.name as building_name,
                (select min(bd.price) from bids bd where bd.package_id = p.id and bd.price is not null) as lowest,
                (select min(bd.price) from bids bd where bd.package_id = p.id and bd.awarded = true) as awarded
           from buildings b
           join packages p on p.building_id = b.id
          where b.company_id = $1`,
        [companyId],
      );
      const byProject = new Map<string, { name: string; lowest: number; awarded: number }>();
      for (const r of rows) {
        const key = r.building_id;
        const cur = byProject.get(key) ?? { name: r.building_name ?? "", lowest: 0, awarded: 0 };
        // Only count packages that actually have an award (so savings are real).
        if (r.awarded != null) {
          cur.awarded += dollarsToCents(r.awarded);
          cur.lowest += dollarsToCents(r.lowest != null ? r.lowest : r.awarded);
        }
        byProject.set(key, cur);
      }
      const projects = [...byProject.values()].map((p) => ({
        name: p.name,
        lowestBidCents: p.lowest,
        awardedBidCents: p.awarded,
        savingsCents: p.awarded - p.lowest,
      }));
      res.json({ projects });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      res.json({ projects: [] });
    }
  }),
);

// ===========================================================================
// 7. INVESTOR REPORT (JSON aggregate). Member of companyId.
//    Budget (awarded total), committed (capital raise target), savings,
//    vendor awards count, and a risk-count placeholder.
// ===========================================================================
router.get(
  "/reports/investor-report",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId, companyId);

    const company = await q1<{ name: string }>(`select name from companies where id = $1`, [
      companyId,
    ]);

    let awardedTotalCents = 0;
    let vendorAwards = 0;
    let savingsCents = 0;
    let committedCents = 0;
    let projectCount = 0;

    try {
      const budget = await q1<any>(
        `select
           coalesce(sum(case when bd.awarded then bd.price else 0 end), 0) as awarded_total,
           count(*) filter (where bd.awarded) as vendor_awards
         from buildings b
         join packages p on p.building_id = b.id
         join bids bd on bd.package_id = p.id
        where b.company_id = $1`,
        [companyId],
      );
      awardedTotalCents = dollarsToCents(budget?.awarded_total);
      vendorAwards = Number(budget?.vendor_awards) || 0;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }

    try {
      const pc = await q1<any>(`select count(*) as n from buildings where company_id = $1`, [
        companyId,
      ]);
      projectCount = Number(pc?.n) || 0;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }

    // Savings: lowest vs awarded across awarded packages.
    try {
      const rows = await q<any>(
        `select
           (select min(bd.price) from bids bd where bd.package_id = p.id and bd.price is not null) as lowest,
           (select min(bd.price) from bids bd where bd.package_id = p.id and bd.awarded = true) as awarded
           from buildings b
           join packages p on p.building_id = b.id
          where b.company_id = $1`,
        [companyId],
      );
      for (const r of rows) {
        if (r.awarded != null) {
          const aw = dollarsToCents(r.awarded);
          const lo = dollarsToCents(r.lowest != null ? r.lowest : r.awarded);
          savingsCents += aw - lo;
        }
      }
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }

    // Committed capital: sum of investment program target raises.
    try {
      const cap = await q1<any>(
        `select coalesce(sum(target_raise_cents), 0) as committed
           from investment_programs where company_id = $1`,
        [companyId],
      );
      committedCents = Number(cap?.committed) || 0;
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }

    res.json({
      company: { name: company?.name ?? "" },
      projectCount,
      budgetCents: awardedTotalCents,
      committedCents,
      savingsCents,
      vendorAwardsCount: vendorAwards,
      riskCount: 0, // placeholder until a risk register is wired in
      generatedAt: new Date().toISOString(),
    });
  }),
);

export default router;
