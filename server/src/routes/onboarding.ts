/**
 * Developer onboarding helpers for Divini Procure. Mounted under /api in
 * routes.ts (so paths are /api/onboarding/...). Reuses the existing local-model
 * profile extractor (lib/extract.ts), local-disk storage (storage.ts), and the
 * same getAuth/requireUser guards + q/q1 pool helpers the other routers use.
 *
 * Endpoints:
 *   POST /onboarding/extract   (user) pull a public profile from a website URL
 *   POST /onboarding/media     (user) upload company brand media (logo/image/deck)
 *
 * The extractor is best-effort and never a hard dependency: when the local LLM
 * is off it returns { available: false } so the UI degrades gracefully.
 *
 * Zero em dashes by convention of the ported routers.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { extractProfileFromUrl } from "../lib/extract.js";
import { buildStorageKey, writeFile } from "../storage.js";

// 25 MB cap for brand media (logos/images/decks).
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Allowed brand-media extensions.
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "pdf", "webp", "svg"]);
// Allowed media categories. Covers developer brand media (logo/image/deck/
// brochure) plus vendor compliance/portfolio docs (doc/cert/insurance/license/w9).
const CATEGORIES = new Set([
  "logo",
  "image",
  "deck",
  "brochure",
  "doc",
  "cert",
  "insurance",
  "license",
  "w9",
  "other",
]);

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

/** True when the user is a member of the given company. */
async function isMemberOfCompany(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// POST /onboarding/extract  { url }
//   -> { available, name?, description?, services?, tags? }
// available:false when the local LLM is off or nothing could be extracted.
// ---------------------------------------------------------------------------
router.post(
  "/onboarding/extract",
  requireUser,
  h(async (req, res) => {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "url required" });
    let profile = null;
    try {
      profile = await extractProfileFromUrl(url);
    } catch {
      profile = null;
    }
    if (!profile) {
      return res.json({ available: false });
    }
    return res.json({
      available: true,
      name: profile.name ?? null,
      description: profile.description ?? null,
      services: profile.services ?? [],
      tags: profile.tags ?? [],
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /onboarding/media   multipart: file + companyId + category
//   -> the created documents row (with company_id + category)
// ---------------------------------------------------------------------------
router.post(
  "/onboarding/media",
  requireUser,
  upload.single("file"),
  h(async (req, res) => {
    const auth = getAuth(req);
    const userId = auth.userId!;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file required" });

    const companyId = String(req.body.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });

    let category = String(req.body.category || "other").toLowerCase();
    if (!CATEGORIES.has(category)) category = "other";

    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return res
        .status(400)
        .json({ error: `unsupported file type .${ext} (allowed: png, jpg, jpeg, pdf, webp, svg)` });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: "file too large (max 25 MB)" });
    }

    // Membership check mirrors db.insertDocument's authz before touching disk.
    if (!(await isMemberOfCompany(userId, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }

    const storageKey = buildStorageKey({ companyId, fileName: file.originalname });
    const doc = await q1(
      `insert into documents (company_id, name, kind, category, storage_path, size, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [companyId, file.originalname, ext, category, storageKey, file.size, userId],
    );
    writeFile(storageKey, file.buffer);
    return res.status(201).json(doc);
  }),
);

export default router;
