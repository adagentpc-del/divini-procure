/**
 * Divini Procure - OPPORTUNITY TEASERS + PUBLIC/PRIVATE DEVELOPER PROFILES +
 * EVENT-SPACE / VENUE BRIDGE routes.
 *
 * Self-pathed; mounted in routes.ts with `router.use(teasersProfilesRouter)`
 * (NO extra prefix), so the paths are /api/opportunity-teasers*, /api/teasers/*,
 * /api/developers/*, /api/developer-public-profile and /api/event-spaces*.
 *
 * Three concerns:
 *
 *   1. opportunity_teasers: a developer (member of the buyer company) builds a
 *      PUBLIC-SAFE teaser for an investment program. Member endpoints create /
 *      list / patch; /teasers/public returns ONLY is_public=true teasers with
 *      public-safe fields. Compliance: the request CTA is constrained to
 *      "Request access" / "Request information" / "Request introduction"; we
 *      never store or surface "invest now" language and never expose restricted
 *      program financials beyond the ranges the developer stored on the teaser.
 *
 *   2. developer_public_profiles: the developer's PUBLIC profile (one per
 *      company). A member upserts it; any authed user can read the public view.
 *      The private posture (subscriptions, fees, pipeline) stays in its own
 *      tables and is never returned here.
 *
 *   3. event_space_profiles: a developer manages event-space / venue bridge
 *      profiles; /event-spaces/public lists those marked available.
 *
 * Authorization mirrors the rest of Procure: membership is
 * `select 1 from company_members where user_id=$1 and company_id=$2`. Tables
 * live in db/schema-teasers-profiles.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// Compliance: the only call to action allowed on a public teaser. Never an
// "invest now" style solicitation.
const REQUEST_CTAS = new Set<string>([
  "Request access",
  "Request information",
  "Request introduction",
]);
const DEFAULT_CTA = "Request introduction";

function sanitizeCta(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return REQUEST_CTAS.has(s) ? s : DEFAULT_CTA;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => String(x)).filter((x) => x.trim() !== "") : [];
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.trim() === "" ? null : s;
}

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string | null, companyId: string | null): Promise<boolean> {
  if (!userId || !companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Throw ForbiddenError unless the user is an admin or a member of companyId. */
async function assertMemberOrAdmin(
  userId: string | null,
  isAdmin: boolean,
  companyId: string | null,
): Promise<void> {
  if (isAdmin) return;
  if (!(await isMemberOfCompany(userId, companyId))) throw new ForbiddenError();
}

// Public-safe teaser projection. NEVER selects internal program financials; only
// the deliberately public range strings stored on the teaser itself.
const TEASER_PUBLIC_COLUMNS = `id, program_id, company_id, headline, asset_class, market,
  target_raise_range, min_investment_range, investor_type, accredited_required,
  nda_required, public_highlights, request_cta, is_public, created_at, updated_at`;

// ===========================================================================
// OPPORTUNITY TEASERS
// ===========================================================================

// GET /opportunity-teasers?companyId= -> a developer's own teasers (member).
router.get(
  "/opportunity-teasers",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);
    const teasers = await q<any>(
      `select t.*, p.name as program_name
         from opportunity_teasers t
         left join investment_programs p on p.id = t.program_id
        where t.company_id = $1
        order by t.created_at desc`,
      [companyId],
    );
    res.json({ teasers });
  }),
);

// POST /opportunity-teasers -> create a teaser for a program (member of company).
router.post(
  "/opportunity-teasers",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = nullableStr(body.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);

    const programId = nullableStr(body.programId);
    if (programId) {
      // The program must belong to the same company (no cross-company teasing).
      const owns = await q1(
        `select 1 from investment_programs where id = $1 and company_id = $2`,
        [programId, companyId],
      );
      if (!owns) throw new ForbiddenError("program does not belong to company");
    }

    const teaser = await q1<any>(
      `insert into opportunity_teasers
         (program_id, company_id, headline, asset_class, market, target_raise_range,
          min_investment_range, investor_type, accredited_required, nda_required,
          public_highlights, request_cta, is_public, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning *`,
      [
        programId,
        companyId,
        nullableStr(body.headline),
        nullableStr(body.assetClass),
        nullableStr(body.market),
        nullableStr(body.targetRaiseRange),
        nullableStr(body.minInvestmentRange),
        nullableStr(body.investorType),
        asBool(body.accreditedRequired, true),
        asBool(body.ndaRequired, false),
        asStringArray(body.publicHighlights),
        sanitizeCta(body.requestCta),
        asBool(body.isPublic, false),
        auth.email ?? auth.userId,
      ],
    );
    res.status(201).json({ teaser });
  }),
);

// PATCH /opportunity-teasers/:id -> update a teaser (member of its company / admin).
router.patch(
  "/opportunity-teasers/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from opportunity_teasers where id = $1`, [
      req.params.id,
    ]);
    if (!existing) throw new NotFoundError();
    // Catch 403 from assertMemberOrAdmin and surface as 404 to prevent
    // enumeration: an attacker must not learn whether an ID exists vs. whether
    // they are simply not authorised to access it.
    try { await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id); }
    catch { throw new NotFoundError(); }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const teaser = await q1<any>(
      `update opportunity_teasers set
         headline = $2,
         asset_class = $3,
         market = $4,
         target_raise_range = $5,
         min_investment_range = $6,
         investor_type = $7,
         accredited_required = $8,
         nda_required = $9,
         public_highlights = $10,
         request_cta = $11,
         is_public = $12,
         updated_at = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        "headline" in body ? nullableStr(body.headline) : existing.headline,
        "assetClass" in body ? nullableStr(body.assetClass) : existing.asset_class,
        "market" in body ? nullableStr(body.market) : existing.market,
        "targetRaiseRange" in body
          ? nullableStr(body.targetRaiseRange)
          : existing.target_raise_range,
        "minInvestmentRange" in body
          ? nullableStr(body.minInvestmentRange)
          : existing.min_investment_range,
        "investorType" in body ? nullableStr(body.investorType) : existing.investor_type,
        "accreditedRequired" in body
          ? asBool(body.accreditedRequired, existing.accredited_required)
          : existing.accredited_required,
        "ndaRequired" in body ? asBool(body.ndaRequired, existing.nda_required) : existing.nda_required,
        "publicHighlights" in body
          ? asStringArray(body.publicHighlights)
          : existing.public_highlights,
        "requestCta" in body ? sanitizeCta(body.requestCta) : existing.request_cta,
        "isPublic" in body ? asBool(body.isPublic, existing.is_public) : existing.is_public,
      ],
    );
    res.json({ teaser });
  }),
);

// GET /teasers/public -> public-safe teasers (any authed user). is_public only,
// public-safe fields only, with a request CTA that is never "invest now".
router.get(
  "/teasers/public",
  requireUser,
  h(async (_req, res) => {
    const teasers = await q<any>(
      `select ${TEASER_PUBLIC_COLUMNS}, c.name as developer_name
         from opportunity_teasers t
         left join companies c on c.id = t.company_id
        where t.is_public = true
        order by t.created_at desc`,
    );
    // Belt and braces: force every CTA to the sanitized allow-list before it
    // ever leaves the server, so no legacy / bad row can surface a solicitation.
    const safe = teasers.map((t) => ({ ...t, request_cta: sanitizeCta(t.request_cta) }));
    res.json({ teasers: safe });
  }),
);

// ===========================================================================
// DEVELOPER PUBLIC PROFILE
// ===========================================================================

// GET /developers/:companyId/public -> the developer's PUBLIC profile (authed).
// Returns public fields only; private posture is never exposed here.
router.get(
  "/developers/:companyId/public",
  requireUser,
  h(async (req, res) => {
    const row = await q1<any>(
      `select p.company_id, p.bio, p.markets, p.asset_classes, p.completed_projects,
              p.public_opportunities, p.is_public, p.updated_at, c.name as company_name
         from developer_public_profiles p
         left join companies c on c.id = p.company_id
        where p.company_id = $1 and p.is_public = true`,
      [req.params.companyId],
    );
    if (!row) throw new NotFoundError();
    res.json({ profile: row });
  }),
);

// PUT /developer-public-profile -> upsert the PUBLIC profile (member of company).
router.put(
  "/developer-public-profile",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = nullableStr(body.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);

    const profile = await q1<any>(
      `insert into developer_public_profiles
         (company_id, bio, markets, asset_classes, completed_projects, public_opportunities, is_public)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (company_id) do update set
         bio = excluded.bio,
         markets = excluded.markets,
         asset_classes = excluded.asset_classes,
         completed_projects = excluded.completed_projects,
         public_opportunities = excluded.public_opportunities,
         is_public = excluded.is_public,
         updated_at = now()
       returning *`,
      [
        companyId,
        nullableStr(body.bio),
        asStringArray(body.markets),
        asStringArray(body.assetClasses),
        nullableStr(body.completedProjects),
        asBool(body.publicOpportunities, true),
        asBool(body.isPublic, true),
      ],
    );
    res.json({ profile });
  }),
);

// ===========================================================================
// EVENT-SPACE / VENUE BRIDGE PROFILES
// ===========================================================================

// GET /event-spaces?companyId= -> a developer's event spaces (member).
router.get(
  "/event-spaces",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);
    const eventSpaces = await q<any>(
      `select e.*, b.name as project_name
         from event_space_profiles e
         left join buildings b on b.id = e.project_id
        where e.company_id = $1
        order by e.created_at desc`,
      [companyId],
    );
    res.json({ eventSpaces });
  }),
);

// POST /event-spaces -> create an event-space profile (member of company).
router.post(
  "/event-spaces",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = nullableStr(body.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);

    const projectId = nullableStr(body.projectId);
    if (projectId) {
      const owns = await q1(`select 1 from buildings where id = $1 and company_id = $2`, [
        projectId,
        companyId,
      ]);
      if (!owns) throw new ForbiddenError("project does not belong to company");
    }

    const capacityRaw = body.capacity;
    const capacity =
      capacityRaw == null || capacityRaw === "" ? null : Math.trunc(Number(capacityRaw));

    const eventSpace = await q1<any>(
      `insert into event_space_profiles
         (company_id, project_id, name, event_space_available, capacity, photos,
          venue_profile_link, preferred_vendors, procurement_needs,
          sponsorship_opportunities, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning *`,
      [
        companyId,
        projectId,
        nullableStr(body.name),
        asBool(body.eventSpaceAvailable, true),
        Number.isFinite(capacity as number) ? capacity : null,
        asStringArray(body.photos),
        nullableStr(body.venueProfileLink),
        asStringArray(body.preferredVendors),
        nullableStr(body.procurementNeeds),
        nullableStr(body.sponsorshipOpportunities),
        auth.email ?? auth.userId,
      ],
    );
    res.status(201).json({ eventSpace });
  }),
);

// PATCH /event-spaces/:id -> update an event space (member of its company / admin).
router.patch(
  "/event-spaces/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from event_space_profiles where id = $1`, [
      req.params.id,
    ]);
    if (!existing) throw new NotFoundError();
    try { await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id); }
    catch { throw new NotFoundError(); }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const capacity =
      "capacity" in body
        ? body.capacity == null || body.capacity === ""
          ? null
          : Math.trunc(Number(body.capacity))
        : existing.capacity;

    const eventSpace = await q1<any>(
      `update event_space_profiles set
         name = $2,
         event_space_available = $3,
         capacity = $4,
         photos = $5,
         venue_profile_link = $6,
         preferred_vendors = $7,
         procurement_needs = $8,
         sponsorship_opportunities = $9,
         updated_at = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        "name" in body ? nullableStr(body.name) : existing.name,
        "eventSpaceAvailable" in body
          ? asBool(body.eventSpaceAvailable, existing.event_space_available)
          : existing.event_space_available,
        Number.isFinite(capacity as number) ? capacity : null,
        "photos" in body ? asStringArray(body.photos) : existing.photos,
        "venueProfileLink" in body
          ? nullableStr(body.venueProfileLink)
          : existing.venue_profile_link,
        "preferredVendors" in body
          ? asStringArray(body.preferredVendors)
          : existing.preferred_vendors,
        "procurementNeeds" in body
          ? nullableStr(body.procurementNeeds)
          : existing.procurement_needs,
        "sponsorshipOpportunities" in body
          ? nullableStr(body.sponsorshipOpportunities)
          : existing.sponsorship_opportunities,
      ],
    );
    res.json({ eventSpace });
  }),
);

// GET /event-spaces/public -> available event spaces (any authed user).
router.get(
  "/event-spaces/public",
  requireUser,
  h(async (_req, res) => {
    const eventSpaces = await q<any>(
      `select e.id, e.company_id, e.project_id, e.name, e.event_space_available, e.capacity,
              e.photos, e.venue_profile_link, e.preferred_vendors, e.procurement_needs,
              e.sponsorship_opportunities, e.created_at, e.updated_at,
              c.name as developer_name
         from event_space_profiles e
         left join companies c on c.id = e.company_id
        where e.event_space_available = true
        order by e.created_at desc`,
    );
    res.json({ eventSpaces });
  }),
);

export default router;
