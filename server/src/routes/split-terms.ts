/**
 * Divini Procure - SPLIT TERMS routes.
 *
 * Self-pathed under /api (mounted with router.use(splitTermsRouter), no prefix),
 * so full paths are /api/admin/split-terms...
 *
 * Admin surface (requireAdmin):
 *   GET    /admin/split-terms[?developerCompanyId=]  list every split term
 *   POST   /admin/split-terms                        create a split term
 *   PATCH  /admin/split-terms/:id                    update active/percentage/flat/notes
 *   DELETE /admin/split-terms/:id                    soft delete -> active = false
 *
 * These terms feed the payout split engine (lib/split-engine.ts): when a
 * platform_revenue row is collected, every ACTIVE term whose scope matches the
 * revenue context produces a payout_instructions row in the 1-click payout
 * queue. Nothing here moves money; it only defines the agreed shares.
 *
 * Zero em dashes by convention. Integer cents throughout.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const RECIPIENT_KINDS = [
  "referral_partner",
  "client",
  "vendor",
  "profile",
  "other",
] as const;
const BASES = ["fee", "payment"] as const;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface SplitTermRow {
  id: string;
  recipient_kind: string | null;
  recipient_company_id: string | null;
  recipient_user_id: string | null;
  recipient_referral_partner_id: string | null;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  program_id: string | null;
  basis: string | null;
  percentage: number | string | null;
  flat_cents: number | string | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const router = Router();

// ---------------------------------------------------------------------------
// GET /admin/split-terms[?developerCompanyId=]
// ---------------------------------------------------------------------------
router.get(
  "/admin/split-terms",
  requireAdmin,
  h(async (req, res) => {
    const developerCompanyId = str(req.query.developerCompanyId);
    const rows = developerCompanyId
      ? await q<SplitTermRow>(
          `select * from split_terms where developer_company_id = $1
            order by active desc, created_at desc`,
          [developerCompanyId],
        )
      : await q<SplitTermRow>(
          `select * from split_terms order by active desc, created_at desc`,
        );
    res.json({ terms: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/split-terms
// ---------------------------------------------------------------------------
router.post(
  "/admin/split-terms",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const recipientKind = str(b.recipient_kind);
    if (
      !recipientKind ||
      !(RECIPIENT_KINDS as readonly string[]).includes(recipientKind)
    ) {
      return res.status(400).json({ error: "invalid recipient_kind" });
    }
    const basis = str(b.basis) ?? "fee";
    if (!(BASES as readonly string[]).includes(basis)) {
      return res.status(400).json({ error: "basis must be fee or payment" });
    }

    const recipientCompanyId = str(b.recipient_company_id);
    const recipientUserId = str(b.recipient_user_id);
    const recipientReferralPartnerId = str(b.recipient_referral_partner_id);
    if (!recipientCompanyId && !recipientUserId && !recipientReferralPartnerId) {
      return res
        .status(400)
        .json({ error: "a recipient id (company, user, or referral partner) is required" });
    }

    const row = await q1<SplitTermRow>(
      `insert into split_terms
         (recipient_kind, recipient_company_id, recipient_user_id,
          recipient_referral_partner_id, developer_company_id, vendor_company_id,
          program_id, basis, percentage, flat_cents, active, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [
        recipientKind,
        recipientCompanyId,
        recipientUserId,
        recipientReferralPartnerId,
        str(b.developer_company_id),
        str(b.vendor_company_id),
        str(b.program_id),
        basis,
        numOrNull(b.percentage),
        numOrNull(b.flat_cents),
        b.active === false ? false : true,
        str(b.notes),
        auth.email,
      ],
    );
    res.status(201).json({ term: row });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /admin/split-terms/:id  (active / percentage / flat_cents / notes / basis)
// ---------------------------------------------------------------------------
router.patch(
  "/admin/split-terms/:id",
  requireAdmin,
  h(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const existing = await q1<SplitTermRow>(
      `select * from split_terms where id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "split term not found" });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (typeof b.active === "boolean") {
      sets.push(`active = $${i++}`);
      vals.push(b.active);
    }
    if (b.percentage !== undefined) {
      sets.push(`percentage = $${i++}`);
      vals.push(numOrNull(b.percentage));
    }
    if (b.flat_cents !== undefined) {
      sets.push(`flat_cents = $${i++}`);
      vals.push(numOrNull(b.flat_cents));
    }
    if (b.basis !== undefined) {
      const basis = str(b.basis) ?? "fee";
      if (!(BASES as readonly string[]).includes(basis)) {
        return res.status(400).json({ error: "basis must be fee or payment" });
      }
      sets.push(`basis = $${i++}`);
      vals.push(basis);
    }
    if (b.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      vals.push(str(b.notes));
    }

    if (!sets.length) return res.json({ term: existing });

    sets.push(`updated_at = now()`);
    vals.push(req.params.id);
    const row = await q1<SplitTermRow>(
      `update split_terms set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );
    res.json({ term: row });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /admin/split-terms/:id  (soft delete -> active = false)
// ---------------------------------------------------------------------------
router.delete(
  "/admin/split-terms/:id",
  requireAdmin,
  h(async (req, res) => {
    const existing = await q1<SplitTermRow>(
      `select * from split_terms where id = $1`,
      [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "split term not found" });
    const row = await q1<SplitTermRow>(
      `update split_terms set active = false, updated_at = now() where id = $1 returning *`,
      [req.params.id],
    );
    res.json({ term: row });
  }),
);

export default router;
