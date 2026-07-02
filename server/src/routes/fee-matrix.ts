/**
 * Divini Procure - FEE MATRIX routes.
 *
 * Mounted under /api in routes.ts, so full paths are /api/admin/fee-rules... and
 * /api/fees/resolve.
 *
 * Admin endpoints (requireAdmin):
 *   GET    /admin/fee-rules            list every fee rule (active and inactive)
 *   POST   /admin/fee-rules            create a fee rule (+ audit)
 *   PATCH  /admin/fee-rules/:id        update active/percentage/flat/payer_type/notes (+ audit)
 *   DELETE /admin/fee-rules/:id        soft delete -> active = false (+ audit)
 *
 * Member endpoint (requireUser, member of either company or admin):
 *   GET    /fees/resolve?developerCompanyId=&vendorCompanyId=&ruleType=&programId=
 *          resolveContextFee result. Grandfathered pairs always win.
 *
 * Read-only resolution lives in lib/fee-matrix.ts. Every write path appends to
 * fee_rule_audit. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import {
  resolveContextFee,
  FEE_RULE_TYPES,
  FEE_SCOPES,
  PAYER_TYPES,
  type FeeRuleRow,
} from "../lib/fee-matrix.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

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

async function addAudit(
  feeRuleId: string | null,
  actorEmail: string | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await q(
    `insert into fee_rule_audit (fee_rule_id, actor_email, action, detail)
     values ($1, $2, $3, $4)`,
    [feeRuleId, actorEmail, action, JSON.stringify(detail)],
  );
}

// ---------------------------------------------------------------------------
// Admin: list
// ---------------------------------------------------------------------------
router.get(
  "/admin/fee-rules",
  requireAdmin,
  h(async (_req, res) => {
    const rules = await q<FeeRuleRow>(
      `select * from fee_rules
        order by case scope
                   when 'pair'      then 1
                   when 'program'   then 2
                   when 'developer' then 3
                   when 'vendor'    then 4
                   when 'global'    then 5
                   else 6
                 end,
                 rule_type asc,
                 updated_at desc`,
    );
    res.json({ rules });
  }),
);

// ---------------------------------------------------------------------------
// Admin: create
// ---------------------------------------------------------------------------
router.post(
  "/admin/fee-rules",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const ruleType = str(b.rule_type);
    if (!ruleType || !(FEE_RULE_TYPES as readonly string[]).includes(ruleType)) {
      throw new ForbiddenError("invalid rule_type");
    }
    const scope = str(b.scope) ?? "global";
    if (!(FEE_SCOPES as readonly string[]).includes(scope)) {
      throw new ForbiddenError("invalid scope");
    }
    const payerType = str(b.payer_type) ?? "admin_configured";
    if (!(PAYER_TYPES as readonly string[]).includes(payerType)) {
      throw new ForbiddenError("invalid payer_type");
    }

    const row = await q1<FeeRuleRow>(
      `insert into fee_rules
         (rule_type, scope, developer_company_id, vendor_company_id, program_id,
          percentage, flat_cents, payer_type, billing_cycle, active, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        ruleType,
        scope,
        str(b.developer_company_id),
        str(b.vendor_company_id),
        str(b.program_id),
        numOrNull(b.percentage),
        numOrNull(b.flat_cents),
        payerType,
        str(b.billing_cycle),
        b.active === false ? false : true,
        str(b.notes),
        auth.email,
      ],
    );

    await addAudit(row!.id, auth.email, "create", { rule: row });
    res.status(201).json({ rule: row });
  }),
);

// ---------------------------------------------------------------------------
// Admin: update (active / percentage / flat_cents / payer_type / notes)
// ---------------------------------------------------------------------------
router.patch(
  "/admin/fee-rules/:id",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const existing = await q1<FeeRuleRow>(`select * from fee_rules where id = $1`, [
      req.params.id,
    ]);
    if (!existing) throw new NotFoundError("fee rule not found");

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const changed: Record<string, unknown> = {};

    if (typeof b.active === "boolean") {
      sets.push(`active = $${i++}`);
      vals.push(b.active);
      changed.active = b.active;
    }
    if (b.percentage !== undefined) {
      sets.push(`percentage = $${i++}`);
      vals.push(numOrNull(b.percentage));
      changed.percentage = numOrNull(b.percentage);
    }
    if (b.flat_cents !== undefined) {
      sets.push(`flat_cents = $${i++}`);
      vals.push(numOrNull(b.flat_cents));
      changed.flat_cents = numOrNull(b.flat_cents);
    }
    if (b.payer_type !== undefined) {
      const payerType = str(b.payer_type) ?? "admin_configured";
      if (!(PAYER_TYPES as readonly string[]).includes(payerType)) {
        throw new ForbiddenError("invalid payer_type");
      }
      sets.push(`payer_type = $${i++}`);
      vals.push(payerType);
      changed.payer_type = payerType;
    }
    if (b.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      vals.push(str(b.notes));
      changed.notes = str(b.notes);
    }

    if (sets.length === 0) {
      res.json({ rule: existing });
      return;
    }

    sets.push(`updated_at = now()`);
    vals.push(req.params.id);
    const row = await q1<FeeRuleRow>(
      `update fee_rules set ${sets.join(", ")} where id = $${i} returning *`,
      vals,
    );

    await addAudit(req.params.id, auth.email, "update", { changed });
    res.json({ rule: row });
  }),
);

// ---------------------------------------------------------------------------
// Admin: soft delete (active = false)
// ---------------------------------------------------------------------------
router.delete(
  "/admin/fee-rules/:id",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<FeeRuleRow>(`select * from fee_rules where id = $1`, [
      req.params.id,
    ]);
    if (!existing) throw new NotFoundError("fee rule not found");

    const row = await q1<FeeRuleRow>(
      `update fee_rules set active = false, updated_at = now() where id = $1 returning *`,
      [req.params.id],
    );
    await addAudit(req.params.id, auth.email, "soft_delete", { active: false });
    res.json({ rule: row });
  }),
);

// ---------------------------------------------------------------------------
// Member: resolve the effective fee for a context.
// ---------------------------------------------------------------------------
router.get(
  "/fees/resolve",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const developerCompanyId = str(req.query.developerCompanyId);
    const vendorCompanyId = str(req.query.vendorCompanyId);
    const ruleType = str(req.query.ruleType);
    const programId = str(req.query.programId);

    // Authorization: admin, or a member of either named company.
    if (!auth.isAdmin) {
      const ids = [developerCompanyId, vendorCompanyId].filter(Boolean) as string[];
      let isMember = false;
      for (const cid of ids) {
        const row = await q1(
          `select 1 from company_members where user_id = $1 and company_id = $2`,
          [auth.userId, cid],
        );
        if (row) {
          isMember = true;
          break;
        }
      }
      if (!isMember) throw new ForbiddenError("not a member of either company");
    }

    const fee = await resolveContextFee({
      developerCompanyId,
      vendorCompanyId,
      ruleType,
      programId,
    });
    res.json({ fee });
  }),
);

export default router;
