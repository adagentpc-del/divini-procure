/**
 * Divini Procure - STRIPE CONNECT PAYOUT RAIL routes.
 *
 * Self-pathed under /api (mounted with router.use(payoutsRouter), no prefix), so
 * the full paths are /api/payouts/... and /api/admin/payouts/...
 *
 * Recipient surface (requireUser, member of the owner):
 *   POST /payouts/connect/start    create/reuse a Connect account + onboarding link
 *   GET  /payouts/connect/status   refresh capability flags from Stripe + persist
 *   GET  /payouts/mine             my queued + paid payout instructions
 *
 * Admin surface (requireAdmin):
 *   GET   /admin/payouts/queue        instructions to act on, with recipient names + totals
 *   POST  /admin/payouts/:id/release  THE 1-CLICK RELEASE (instructs Stripe to transfer)
 *   POST  /admin/payouts/enqueue      manual enqueue for a collected revenue row
 *   PATCH /admin/payouts/:id          { status: held|canceled, notes }
 *
 * SAFETY: bank numbers are NEVER stored here; onboarding is a Stripe-hosted link
 * and we keep only the acct_... id, status flags, and a masked bank last4. The
 * live transfer in /release is gated: it runs ONLY when Stripe is configured AND
 * the recipient account has payouts_enabled. Otherwise the instruction is marked
 * 'blocked' with a clear message and NO error. Every Stripe call is wrapped so a
 * Stripe failure can never crash the server. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { PUBLIC_APP_URL } from "../config.js";
import { sendEmail } from "../lib/email.js";
import {
  isConfigured as stripeConfigured,
  createConnectAccount,
  createOnboardingLink,
  getAccount,
  createTransfer,
  StripeNotConfigured,
} from "../lib/stripe-connect.js";
import { enqueueSplitsForRevenue } from "../lib/split-engine.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/** Membership check (the project convention). */
async function isMemberOf(userId: string, companyId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return !!row;
}

async function audit(
  instructionId: string | null,
  actorEmail: string | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await q(
      `insert into payout_audit (instruction_id, actor_email, action, detail)
       values ($1,$2,$3,$4::jsonb)`,
      [instructionId, actorEmail, action, JSON.stringify(detail)],
    );
  } catch {
    // Audit is best effort; never break the request on a log failure.
  }
}

/** Map the live Stripe flags onto the row status. */
function statusFromFlags(f: {
  payouts_enabled: boolean;
  details_submitted: boolean;
}): string {
  if (f.payouts_enabled) return "enabled";
  if (f.details_submitted) return "restricted";
  return "onboarding";
}

const router = Router();

// ---------------------------------------------------------------------------
// POST /payouts/connect/start  (requireUser, member of the owner company)
//   { ownerKind, companyId?, referralPartnerId? }
//   Create or reuse a connect_accounts row + Stripe account, then return a
//   Stripe-hosted onboarding link. If Stripe is not configured, returns
//   { configured: false } with a clear message instead of erroring.
// ---------------------------------------------------------------------------
router.post(
  "/payouts/connect/start",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerKind = String(body.ownerKind ?? "company");
    const companyId = body.companyId ? String(body.companyId) : null;
    const referralPartnerId = body.referralPartnerId ? String(body.referralPartnerId) : null;

    if (!["company", "investor", "referral_partner"].includes(ownerKind)) {
      return res.status(400).json({ error: "invalid ownerKind" });
    }
    // company / investor owners are scoped to a company the caller belongs to.
    if (ownerKind === "company" || ownerKind === "investor") {
      if (!companyId) return res.status(400).json({ error: "companyId required" });
      if (!(await isMemberOf(auth.userId!, companyId))) {
        return res.status(403).json({ error: "not a member of this company" });
      }
    }
    if (ownerKind === "referral_partner" && !referralPartnerId && !companyId) {
      return res.status(400).json({ error: "referralPartnerId or companyId required" });
    }

    // Find or create the connect_accounts row for this owner.
    let acct = await q1<{
      id: string;
      stripe_account_id: string | null;
    }>(
      `select id, stripe_account_id from connect_accounts
        where owner_kind = $1
          and owner_company_id is not distinct from $2
          and owner_user_id is not distinct from $3
          and owner_referral_partner_id is not distinct from $4
        limit 1`,
      [
        ownerKind,
        ownerKind === "investor" ? null : companyId,
        ownerKind === "investor" ? auth.userId : null,
        referralPartnerId,
      ],
    );
    if (!acct) {
      acct = await q1(
        `insert into connect_accounts
           (owner_kind, owner_company_id, owner_user_id, owner_referral_partner_id,
            status, created_by)
         values ($1,$2,$3,$4,'not_started',$5)
         returning id, stripe_account_id`,
        [
          ownerKind,
          ownerKind === "investor" ? null : companyId,
          ownerKind === "investor" ? auth.userId : null,
          referralPartnerId,
          auth.email ?? null,
        ],
      );
    }

    if (!stripeConfigured()) {
      return res.json({
        configured: false,
        message:
          "Stripe is not connected yet. Set STRIPE_SECRET_KEY to enable bank onboarding and payouts.",
      });
    }

    try {
      // Create the Stripe account on first use, then mint an onboarding link.
      let stripeAccountId = acct!.stripe_account_id;
      if (!stripeAccountId) {
        const created = await createConnectAccount({ email: auth.email, country: "US" });
        stripeAccountId = created.accountId;
        await q(
          `update connect_accounts set stripe_account_id = $2, status = 'onboarding', updated_at = now()
            where id = $1`,
          [acct!.id, stripeAccountId],
        );
      }
      const base = PUBLIC_APP_URL || "";
      const returnUrl = `${base}/payout-settings?connect=return`;
      const refreshUrl = `${base}/payout-settings?connect=refresh`;
      const link = await createOnboardingLink(stripeAccountId, returnUrl, refreshUrl);
      await audit(null, auth.email, "connect_start", { connect_account_id: acct!.id });
      return res.json({ configured: true, url: link.url });
    } catch (e) {
      if (e instanceof StripeNotConfigured) {
        return res.json({ configured: false, message: e.message });
      }
      // Any Stripe failure: report cleanly, never crash.
      return res.status(502).json({ error: "Could not start Stripe onboarding", detail: (e as Error).message });
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /payouts/connect/status?companyId=  (member)
//   Refresh capability flags from Stripe (when configured), persist them, and
//   return the account row. Degrades to the stored row when Stripe is off.
// ---------------------------------------------------------------------------
router.get(
  "/payouts/connect/status",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    const referralPartnerId = req.query.referralPartnerId
      ? String(req.query.referralPartnerId)
      : null;

    if (companyId && !(await isMemberOf(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }

    const account = await q1<any>(
      `select * from connect_accounts
        where (owner_company_id is not distinct from $1)
          and (owner_referral_partner_id is not distinct from $2)
          and ($1 is not null or $2 is not null or owner_user_id = $3)
        order by updated_at desc limit 1`,
      [companyId, referralPartnerId, auth.userId],
    );
    if (!account) return res.json({ configured: stripeConfigured(), account: null });

    if (stripeConfigured() && account.stripe_account_id) {
      try {
        const flags = await getAccount(account.stripe_account_id);
        const updated = await q1<any>(
          `update connect_accounts set
             charges_enabled = $2, payouts_enabled = $3, details_submitted = $4,
             bank_last4 = coalesce($5, bank_last4),
             country = coalesce($6, country),
             default_currency = coalesce($7, default_currency),
             status = $8, updated_at = now()
           where id = $1 returning *`,
          [
            account.id,
            flags.charges_enabled,
            flags.payouts_enabled,
            flags.details_submitted,
            flags.bank_last4 ?? null,
            flags.country ?? null,
            flags.default_currency ?? null,
            statusFromFlags(flags),
          ],
        );
        // When the recipient just became payable, promote their pending
        // instructions to 'ready' so the admin can release them.
        if (flags.payouts_enabled) {
          await q(
            `update payout_instructions set status = 'ready', connect_account_id = $1, updated_at = now()
              where connect_account_id = $1 and status = 'pending'`,
            [account.id],
          );
        }
        return res.json({ configured: true, account: updated });
      } catch {
        // Stripe read failed: hand back the stored row unchanged.
        return res.json({ configured: true, account });
      }
    }
    return res.json({ configured: stripeConfigured(), account });
  }),
);

// ---------------------------------------------------------------------------
// GET /payouts/mine?companyId=  (member)
//   The recipient's own payout instructions (paid + pending + everything).
// ---------------------------------------------------------------------------
router.get(
  "/payouts/mine",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    if (companyId && !(await isMemberOf(auth.userId!, companyId))) {
      return res.status(403).json({ error: "not a member of this company" });
    }
    const rows = await q<any>(
      `select * from payout_instructions
        where (recipient_company_id is not distinct from $1 and $1 is not null)
           or recipient_user_id = $2
        order by created_at desc limit 500`,
      [companyId, auth.userId],
    );
    res.json({ instructions: rows });
  }),
);

// ===========================================================================
// ADMIN
// ===========================================================================
router.use("/admin/payouts", requireAdmin);

// ---------------------------------------------------------------------------
// GET /admin/payouts/queue
//   Instructions to act on (ready, pending, blocked, failed) with recipient
//   names + dashboard totals across all statuses.
// ---------------------------------------------------------------------------
router.get(
  "/admin/payouts/queue",
  h(async (_req, res) => {
    const rows = await q<any>(
      `select pi.*,
              c.name as recipient_company_name,
              rp.name as recipient_partner_name,
              ca.payouts_enabled as account_payouts_enabled,
              ca.bank_last4 as account_bank_last4,
              ca.stripe_account_id as account_stripe_id
         from payout_instructions pi
         left join companies c on c.id = pi.recipient_company_id
         left join referral_partners rp on rp.id = pi.recipient_referral_partner_id
         left join connect_accounts ca on ca.id = pi.connect_account_id
        where pi.status in ('ready','pending','blocked','failed')
        order by pi.created_at desc
        limit 1000`,
    );
    const t = await q1<{
      pending: string;
      ready: string;
      paid: string;
    }>(
      `select coalesce(sum(amount_cents) filter (where status in ('pending','blocked','held')),0) as pending,
              coalesce(sum(amount_cents) filter (where status = 'ready'),0)                       as ready,
              coalesce(sum(amount_cents) filter (where status = 'paid'),0)                        as paid
         from payout_instructions`,
    );
    res.json({
      rows,
      configured: stripeConfigured(),
      totals: {
        pendingCents: num(t?.pending),
        readyCents: num(t?.ready),
        paidCents: num(t?.paid),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/payouts/enqueue  { revenueId }
//   Manual enqueue of splits for a collected revenue row.
// ---------------------------------------------------------------------------
router.post(
  "/admin/payouts/enqueue",
  h(async (req, res) => {
    const auth = getAuth(req);
    const revenueId = String((req.body ?? {}).revenueId ?? "").trim();
    if (!revenueId) return res.status(400).json({ error: "revenueId required" });
    const result = await enqueueSplitsForRevenue(revenueId, auth.email);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /admin/payouts/:id  { status: held|canceled, notes }
//   Admin control over a queued instruction (hold / cancel + notes).
// ---------------------------------------------------------------------------
router.patch(
  "/admin/payouts/:id",
  h(async (req, res) => {
    const auth = getAuth(req);
    const { status, notes } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (status !== undefined) {
      if (!["held", "canceled"].includes(String(status))) {
        return res.status(400).json({ error: "status must be held or canceled" });
      }
      add("status", String(status));
    }
    if (notes !== undefined) add("notes", notes === "" ? null : String(notes));
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    sets.push("updated_at = now()");
    params.push(req.params.id);
    const row = await q1<any>(
      `update payout_instructions set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!row) return res.status(404).json({ error: "instruction not found" });
    await audit(row.id, auth.email, "admin_patch", { status: row.status, notes: row.notes });
    res.json({ instruction: row });
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/payouts/:id/release   THE 1-CLICK RELEASE.
//   Loads the instruction + recipient connect account. If Stripe is not
//   configured OR the recipient is not payouts_enabled, marks 'blocked' and
//   returns { released: false, reason } WITHOUT erroring. Otherwise instructs
//   Stripe to transfer the funds, marks 'paid' (or 'failed' on a Stripe error),
//   and best-effort emails the recipient. Wrapped so no Stripe error crashes the
//   server. This is the ONLY place money moves.
// ---------------------------------------------------------------------------
router.post(
  "/admin/payouts/:id/release",
  h(async (req, res) => {
    const auth = getAuth(req);
    const instr = await q1<any>(
      `select pi.*, ca.stripe_account_id, ca.payouts_enabled
         from payout_instructions pi
         left join connect_accounts ca on ca.id = pi.connect_account_id
        where pi.id = $1`,
      [req.params.id],
    );
    if (!instr) return res.status(404).json({ error: "instruction not found" });

    // Only releasable from a pending/ready/blocked/failed state. Already-paid /
    // releasing / held / canceled rows are left untouched.
    if (!["pending", "ready", "blocked", "failed"].includes(instr.status)) {
      return res.status(409).json({ error: `cannot release from status '${instr.status}'` });
    }

    const amountCents = Math.max(0, Math.round(num(instr.amount_cents)));
    const destination = instr.stripe_account_id as string | null;
    const payoutsEnabled = !!instr.payouts_enabled;

    // GATE: no live transfer unless Stripe is configured AND the recipient is
    // payable. Mark 'blocked' with a clear reason; this is NOT an error.
    if (!stripeConfigured() || !destination || !payoutsEnabled) {
      const reason = !stripeConfigured()
        ? "Stripe is not configured. Set STRIPE_SECRET_KEY to release payouts."
        : !destination
          ? "Recipient has not connected a Stripe payout account yet."
          : "Recipient payouts are not enabled yet. They must finish Stripe onboarding.";
      await q(
        `update payout_instructions set status = 'blocked', failure_reason = $2, updated_at = now()
          where id = $1`,
        [instr.id, reason],
      );
      await audit(instr.id, auth.email, "release_blocked", { reason });
      return res.json({ released: false, status: "blocked", reason });
    }

    // Move to 'releasing' so a double-click cannot double-pay.
    await q(
      `update payout_instructions set status = 'releasing', updated_at = now() where id = $1`,
      [instr.id],
    );

    try {
      const transfer = await createTransfer({
        amountCents,
        currency: instr.currency || "usd",
        destinationAccountId: destination,
        metadata: {
          instruction_id: String(instr.id),
          source_revenue_id: String(instr.source_revenue_id ?? ""),
          recipient_kind: String(instr.recipient_kind ?? ""),
        },
      });
      const row = await q1<any>(
        `update payout_instructions set
           status = 'paid', stripe_transfer_id = $2, failure_reason = null,
           released_by = $3, released_at = now(), updated_at = now()
         where id = $1 returning *`,
        [instr.id, transfer.transferId, auth.email ?? null],
      );
      await audit(instr.id, auth.email, "released", {
        stripe_transfer_id: transfer.transferId,
        amount_cents: amountCents,
      });

      // Best-effort recipient notification (never blocks the response).
      try {
        let email: string | null = null;
        if (instr.recipient_referral_partner_id) {
          const p = await q1<{ partner_email: string | null }>(
            `select partner_email from referral_partners where id = $1`,
            [instr.recipient_referral_partner_id],
          );
          email = p?.partner_email ?? null;
        } else if (instr.recipient_company_id) {
          const c = await q1<{ email: string | null }>(
            `select email from companies where id = $1`,
            [instr.recipient_company_id],
          );
          email = c?.email ?? null;
        }
        if (email) {
          await sendEmail({
            to: email,
            subject: "Your Divini Procure payout is on its way",
            text:
              `Good news. A payout of $${(amountCents / 100).toFixed(2)} has been released to your ` +
              `connected bank account via Stripe. Funds typically arrive in 1 to 2 business days.\n\n` +
              `This was sent by Stripe, the licensed money transmitter. Divini Procure never stores your bank account numbers.`,
          });
        }
      } catch {
        // Email is best effort.
      }

      return res.json({ released: true, status: "paid", instruction: row });
    } catch (e) {
      const reason = (e as Error).message || "Stripe transfer failed";
      const row = await q1<any>(
        `update payout_instructions set status = 'failed', failure_reason = $2, updated_at = now()
          where id = $1 returning *`,
        [instr.id, reason],
      );
      await audit(instr.id, auth.email, "release_failed", { reason });
      return res.status(502).json({ released: false, status: "failed", reason, instruction: row });
    }
  }),
);

export default router;
