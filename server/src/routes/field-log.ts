/**
 * Field Log for Divini Procure: daily logs and a time clock for a vendor's
 * field crew (competitive gap closure - docs/competitive-analysis-2026-08.md
 * gap #10: "Mobile-first field execution app (daily logs, time clock,
 * photos, punch lists)"). Photos (progress-photos.ts) and punch lists
 * (delivery.ts) already exist; this adds the two missing pieces as ordinary
 * mobile-responsive web routes - there is no native mobile build tooling in
 * this environment, so this is not a native app and does not pretend to be.
 * Self-pathed under /field-log, mounted in routes.ts.
 *
 * Vendor-write / developer-read-only: a vendor's own crew logs its work and
 * clocks in/out at a building; the building's developer can see it (all
 * vendors' entries) but never creates one. A vendor sees only its own
 * company's entries - two different vendors both working at the same
 * building (under different packages) must not see each other's field log,
 * unlike progress_photos' deliberately shared visibility. RLS
 * (db/schema-field-log.sql) enforces this at the data level; the checks
 * here are the same defense-in-depth app-layer gate every sibling route in
 * this codebase (delivery.ts, progress-photos.ts) also has.
 *
 * Writing (a daily log or a clock-in) requires an ACTIVE award for that
 * vendor at that building (schema-awards.sql) - stricter than
 * progress_photos' "any bid" rule, since "log today's work at this site"
 * implies the vendor actually won work there. Reading a building's field
 * log only requires having EVER held an award there (active or cancelled),
 * so a vendor keeps read access to its own historical entries after a
 * project or award ends.
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { ForbiddenError, NotFoundError } from "../db.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** True when the user is a member of the given company. */
async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/**
 * Read access to a building's field log: the building owner, a member of a
 * vendor company with any award (active or cancelled) at this building, or
 * admin. Throws NotFoundError when the building does not exist,
 * ForbiddenError otherwise.
 */
async function assertCanReadFieldLog(req: Request, buildingId: string): Promise<void> {
  const auth = getAuth(req);
  const building = await q1<{ id: string }>(`select id from buildings where id = $1`, [buildingId]);
  if (!building) throw new NotFoundError("building not found");
  if (auth.isAdmin) return;

  const owned = await q1(
    `select 1 from buildings b
       join company_members cm on cm.company_id = b.company_id
      where b.id = $1 and cm.user_id = $2`,
    [buildingId, auth.userId],
  );
  if (owned) return;

  const vendor = await q1(
    `select 1 from awards a
       join company_members cm on cm.company_id = a.vendor_company_id
      where a.building_id = $1 and cm.user_id = $2`,
    [buildingId, auth.userId],
  );
  if (vendor) return;

  throw new ForbiddenError("not authorized to view this site's field log");
}

/**
 * Write access (a daily log entry, or clocking in) for a specific vendor
 * company at a building: the caller must be a member of that vendor
 * company, AND that vendor must hold an ACTIVE award at this building.
 */
async function assertVendorCanLogAt(req: Request, buildingId: string, vendorCompanyId: string): Promise<void> {
  const auth = getAuth(req);
  if (!auth.isAdmin && !(await isMember(auth.userId!, vendorCompanyId))) {
    throw new ForbiddenError("not a member of this vendor company");
  }
  const active = await q1(
    `select 1 from awards where building_id = $1 and vendor_company_id = $2 and status = 'active'`,
    [buildingId, vendorCompanyId],
  );
  if (!active) throw new ForbiddenError("no active award for this vendor at this building");
}

// GET /field-log/my-sites?companyId= -- buildings where this vendor company
// currently holds an active award, for the site picker.
router.get(
  "/field-log/my-sites",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin && !(await isMember(auth.userId!, companyId))) {
      throw new ForbiddenError("not a member of this company");
    }
    const sites = await q(
      `select distinct b.id, b.name, b.location
         from awards a
         join buildings b on b.id = a.building_id
        where a.vendor_company_id = $1 and a.status = 'active'
        order by b.name`,
      [companyId],
    );
    res.json({ sites });
  }),
);

// GET /field-log/daily-logs?buildingId=
router.get(
  "/field-log/daily-logs",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await assertCanReadFieldLog(req, buildingId);
    // RLS further restricts a vendor caller to only its own company's rows;
    // the building owner/admin see every vendor's entries at this building.
    const logs = await q(
      `select * from daily_logs where building_id = $1 order by log_date desc, created_at desc`,
      [buildingId],
    );
    res.json({ logs });
  }),
);

// POST /field-log/daily-logs
router.post(
  "/field-log/daily-logs",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as {
      buildingId?: string;
      vendorCompanyId?: string;
      workPerformed?: string;
      crewCount?: number;
      weather?: string;
      delays?: string;
      logDate?: string;
    };
    const buildingId = body.buildingId ? String(body.buildingId) : "";
    const vendorCompanyId = body.vendorCompanyId ? String(body.vendorCompanyId) : "";
    const workPerformed = body.workPerformed ? String(body.workPerformed).trim() : "";
    if (!buildingId || !vendorCompanyId || !workPerformed) {
      return res.status(400).json({ error: "buildingId, vendorCompanyId, and workPerformed are required" });
    }
    await assertVendorCanLogAt(req, buildingId, vendorCompanyId);

    const crewCount =
      body.crewCount == null || !Number.isFinite(Number(body.crewCount))
        ? null
        : Math.max(0, Math.round(Number(body.crewCount)));
    // FieldLog.tsx always sends the crew's own local date explicitly
    // (todayLocalDate()) rather than relying on this fallback - current_date
    // below is evaluated in the DATABASE session's timezone, which would
    // record the wrong day for a crew logging work in the evening in a
    // timezone west of the server. The fallback stays for any other API
    // caller that omits logDate; it is a defensive default, not the path
    // the UI itself relies on.
    const logDate = body.logDate ? String(body.logDate) : null;

    const log = await q1(
      `insert into daily_logs (building_id, vendor_company_id, logged_by_email, log_date, work_performed, crew_count, weather, delays)
       values ($1, $2, $3, coalesce($4::date, current_date), $5, $6, $7, $8)
       returning *`,
      [buildingId, vendorCompanyId, auth.email ?? null, logDate, workPerformed, crewCount, body.weather ?? null, body.delays ?? null],
    );
    res.status(201).json({ log });
  }),
);

// GET /field-log/time-entries?buildingId=
router.get(
  "/field-log/time-entries",
  requireUser,
  h(async (req, res) => {
    const buildingId = String(req.query.buildingId || "");
    if (!buildingId) return res.status(400).json({ error: "buildingId required" });
    await assertCanReadFieldLog(req, buildingId);
    const entries = await q(
      `select * from time_entries where building_id = $1 order by clock_in desc`,
      [buildingId],
    );
    res.json({ entries });
  }),
);

// GET /field-log/time-entries/open?buildingId=&vendorCompanyId= -- the
// caller's own currently-open (not yet clocked out) entry at this site, if
// any, so the UI knows whether to show "Clock in" or "Clock out".
router.get(
  "/field-log/time-entries/open",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const buildingId = String(req.query.buildingId || "");
    const vendorCompanyId = String(req.query.vendorCompanyId || "");
    if (!buildingId || !vendorCompanyId) {
      return res.status(400).json({ error: "buildingId and vendorCompanyId required" });
    }
    if (!auth.isAdmin && !(await isMember(auth.userId!, vendorCompanyId))) {
      throw new ForbiddenError("not a member of this vendor company");
    }
    const entry = await q1(
      `select * from time_entries
        where building_id = $1 and vendor_company_id = $2 and logged_by_email = $3 and clock_out is null
        order by clock_in desc limit 1`,
      [buildingId, vendorCompanyId, auth.email ?? ""],
    );
    res.json({ entry: entry ?? null });
  }),
);

// POST /field-log/time-entries/clock-in
router.post(
  "/field-log/time-entries/clock-in",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as { buildingId?: string; vendorCompanyId?: string };
    const buildingId = body.buildingId ? String(body.buildingId) : "";
    const vendorCompanyId = body.vendorCompanyId ? String(body.vendorCompanyId) : "";
    if (!buildingId || !vendorCompanyId) {
      return res.status(400).json({ error: "buildingId and vendorCompanyId are required" });
    }
    await assertVendorCanLogAt(req, buildingId, vendorCompanyId);

    const existing = await q1(
      `select id from time_entries
        where building_id = $1 and vendor_company_id = $2 and logged_by_email = $3 and clock_out is null`,
      [buildingId, vendorCompanyId, auth.email ?? ""],
    );
    if (existing) {
      return res.status(409).json({ error: "already clocked in at this site - clock out first" });
    }

    const entry = await q1(
      `insert into time_entries (building_id, vendor_company_id, logged_by_email)
       values ($1, $2, $3)
       returning *`,
      [buildingId, vendorCompanyId, auth.email ?? ""],
    );
    res.status(201).json({ entry });
  }),
);

// PATCH /field-log/time-entries/:id/clock-out
router.patch(
  "/field-log/time-entries/:id/clock-out",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const id = req.params.id;
    const notes = req.body?.notes ? String(req.body.notes) : null;

    const row = await q1<{ vendor_company_id: string; logged_by_email: string | null; clock_out: string | null }>(
      `select vendor_company_id, logged_by_email, clock_out from time_entries where id = $1`,
      [id],
    );
    if (!row) throw new NotFoundError("time entry not found");
    if (!auth.isAdmin && !(await isMember(auth.userId!, row.vendor_company_id))) {
      throw new ForbiddenError("not a member of this vendor company");
    }
    // A vendor company can have more than one individual login
    // (company_members). Clocking out is a personal action - a coworker
    // seeing an open entry in the shared building-level listing must not be
    // able to close someone else's shift or overwrite their notes.
    if (!auth.isAdmin && row.logged_by_email !== auth.email) {
      throw new ForbiddenError("only the person who clocked in can clock out this entry");
    }
    if (row.clock_out) {
      return res.status(409).json({ error: "already clocked out" });
    }

    const entry = await q1(
      `update time_entries set clock_out = now(), notes = coalesce($2, notes) where id = $1 returning *`,
      [id, notes],
    );
    res.json({ entry });
  }),
);

export default router;
