/**
 * Divini Procure - PROFILE COLLATERAL routes: pitch decks / marketing collateral
 * + custom programs / offerings shown on a company profile.
 *
 * Self-pathed; mounted in routes.ts with `router.use(profileCollateralRouter)`
 * (NO extra prefix), so the paths are /api/profile-decks*, /api/profile-programs*
 * and the public reads /api/profiles/:companyId/decks|programs.
 *
 * This FILLS GAPS the teasers-profiles layer does not cover:
 *
 *   1. profile_decks: a company (developer / buyer OR vendor) attaches an
 *      uploaded pitch deck / marketing collateral to its profile. Decks REUSE
 *      the existing documents pipeline: the file is uploaded via the standard
 *      POST /api/documents multipart route, then a profile_decks row references
 *      that document's storage_path. Downloads reuse signDownloadUrl from
 *      storage.ts, exactly like the rest of Procure. We never invent new storage.
 *
 *   2. profile_programs: a company publishes general custom programs / offerings
 *      (title, summary, details, price/terms text, CTA, active, sort). Unlike
 *      opportunity_teasers these are NOT investment-compliance-constrained, so
 *      the CTA is free-form. CRUD for the owner; PUBLIC read of active programs.
 *
 * Authorization mirrors the rest of Procure: membership is
 * `select 1 from company_members where user_id=$1 and company_id=$2`. Tables
 * live in db/schema-profile-collateral.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { signDownloadUrl } from "../storage.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

function nullableStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.trim() === "" ? null : s;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
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

// ===========================================================================
// PROFILE DECKS (pitch decks / marketing collateral)
// ===========================================================================

// GET /profile-decks?companyId= -> a company's own decks (member / admin).
router.get(
  "/profile-decks",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);
    const decks = await q<any>(
      `select * from profile_decks where company_id = $1 order by sort asc, created_at desc`,
      [companyId],
    );
    // Attach a fresh signed download URL for each deck (same pipeline as documents).
    const withUrls = decks.map((d) => ({ ...d, download_url: signDownloadUrl(d.storage_path) }));
    res.json({ decks: withUrls });
  }),
);

// POST /profile-decks -> attach an already-uploaded document as a deck (member).
// The file itself is uploaded first via POST /api/documents (multipart); this
// endpoint records the title / visibility and links the storage_path.
router.post(
  "/profile-decks",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = nullableStr(body.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);

    const storagePath = nullableStr(body.storagePath);
    if (!storagePath) return res.status(400).json({ error: "storagePath required" });

    // The document must exist and belong to the same company (no cross-company
    // attaching). documents is the canonical upload record.
    const doc = await q1<any>(
      `select id, company_id, name from documents where storage_path = $1`,
      [storagePath],
    );
    if (!doc) throw new NotFoundError("document not found");
    if (!auth.isAdmin && doc.company_id !== companyId) {
      throw new ForbiddenError("document does not belong to company");
    }

    const deck = await q1<any>(
      `insert into profile_decks
         (company_id, document_id, storage_path, title, description, file_name, is_public, sort, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        companyId,
        doc.id,
        storagePath,
        nullableStr(body.title) ?? doc.name,
        nullableStr(body.description),
        nullableStr(body.fileName) ?? doc.name,
        asBool(body.isPublic, true),
        asInt(body.sort, 0),
        auth.email ?? auth.userId,
      ],
    );
    res.status(201).json({ deck: { ...deck, download_url: signDownloadUrl(deck.storage_path) } });
  }),
);

// PATCH /profile-decks/:id -> update deck metadata (member of its company / admin).
router.patch(
  "/profile-decks/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from profile_decks where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError();
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const deck = await q1<any>(
      `update profile_decks set
         title = $2,
         description = $3,
         is_public = $4,
         sort = $5,
         updated_at = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        "title" in body ? nullableStr(body.title) : existing.title,
        "description" in body ? nullableStr(body.description) : existing.description,
        "isPublic" in body ? asBool(body.isPublic, existing.is_public) : existing.is_public,
        "sort" in body ? asInt(body.sort, existing.sort) : existing.sort,
      ],
    );
    res.json({ deck: { ...deck, download_url: signDownloadUrl(deck.storage_path) } });
  }),
);

// DELETE /profile-decks/:id -> remove the deck link (member of its company / admin).
// Leaves the underlying document row / file intact (it may be referenced elsewhere).
router.delete(
  "/profile-decks/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from profile_decks where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError();
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id);
    await q(`delete from profile_decks where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

// GET /profiles/:companyId/decks -> PUBLIC decks for a company (any authed user).
// storage_path is intentionally omitted from the response: callers receive a
// signed download_url that expires, not the raw storage key.
router.get(
  "/profiles/:companyId/decks",
  requireUser,
  h(async (req, res) => {
    const decks = await q<any>(
      `select id, company_id, title, description, file_name, storage_path, sort, created_at
         from profile_decks
        where company_id = $1 and is_public = true
        order by sort asc, created_at desc`,
      [req.params.companyId],
    );
    const withUrls = decks.map(({ storage_path, ...d }: any) => ({
      ...d,
      download_url: signDownloadUrl(storage_path),
    }));
    res.json({ decks: withUrls });
  }),
);

// ===========================================================================
// PROFILE PROGRAMS / OFFERINGS
// ===========================================================================

// GET /profile-programs?companyId= -> a company's own programs (member / admin).
router.get(
  "/profile-programs",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);
    const programs = await q<any>(
      `select * from profile_programs where company_id = $1 order by sort asc, created_at desc`,
      [companyId],
    );
    res.json({ programs });
  }),
);

// POST /profile-programs -> create a custom program / offering (member of company).
router.post(
  "/profile-programs",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = nullableStr(body.companyId);
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, companyId);

    const program = await q1<any>(
      `insert into profile_programs
         (company_id, title, summary, details, price_terms, cta_label, cta_url, active, sort, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning *`,
      [
        companyId,
        nullableStr(body.title),
        nullableStr(body.summary),
        nullableStr(body.details),
        nullableStr(body.priceTerms),
        nullableStr(body.ctaLabel),
        nullableStr(body.ctaUrl),
        asBool(body.active, true),
        asInt(body.sort, 0),
        auth.email ?? auth.userId,
      ],
    );
    res.status(201).json({ program });
  }),
);

// PATCH /profile-programs/:id -> update a program (member of its company / admin).
router.patch(
  "/profile-programs/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from profile_programs where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError();
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const program = await q1<any>(
      `update profile_programs set
         title = $2,
         summary = $3,
         details = $4,
         price_terms = $5,
         cta_label = $6,
         cta_url = $7,
         active = $8,
         sort = $9,
         updated_at = now()
       where id = $1
       returning *`,
      [
        req.params.id,
        "title" in body ? nullableStr(body.title) : existing.title,
        "summary" in body ? nullableStr(body.summary) : existing.summary,
        "details" in body ? nullableStr(body.details) : existing.details,
        "priceTerms" in body ? nullableStr(body.priceTerms) : existing.price_terms,
        "ctaLabel" in body ? nullableStr(body.ctaLabel) : existing.cta_label,
        "ctaUrl" in body ? nullableStr(body.ctaUrl) : existing.cta_url,
        "active" in body ? asBool(body.active, existing.active) : existing.active,
        "sort" in body ? asInt(body.sort, existing.sort) : existing.sort,
      ],
    );
    res.json({ program });
  }),
);

// DELETE /profile-programs/:id -> remove a program (member of its company / admin).
router.delete(
  "/profile-programs/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<any>(`select * from profile_programs where id = $1`, [req.params.id]);
    if (!existing) throw new NotFoundError();
    await assertMemberOrAdmin(auth.userId, auth.isAdmin, existing.company_id);
    await q(`delete from profile_programs where id = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

// GET /profiles/:companyId/programs -> PUBLIC active programs (any authed user).
router.get(
  "/profiles/:companyId/programs",
  requireUser,
  h(async (req, res) => {
    const programs = await q<any>(
      `select id, company_id, title, summary, details, price_terms, cta_label, cta_url, sort, created_at
         from profile_programs
        where company_id = $1 and active = true
        order by sort asc, created_at desc`,
      [req.params.companyId],
    );
    res.json({ programs });
  }),
);

export default router;
