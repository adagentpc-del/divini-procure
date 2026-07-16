/**
 * Super-admin essentials for Divini Procure. Mounted under /api in routes.ts.
 *
 * Ports the SHAPE of Divini Partners' admin-manage.ts + referrals.ts + credits.ts,
 * but self-contained: it uses Procure's own q/q1 helpers and getAuth/requireAdmin/
 * requireUser guards, maps org -> company, and has NO audit/notify dependency
 * (Procure has no logAction). The four super-admin essentials are:
 *
 *   1. Invite codes        (admin) - generate + list + resend onboarding invites
 *   2. Discount codes      (admin) - create + list + patch promo codes
 *   3. Referral partners   (admin) - create + list + patch revenue-share partners
 *   4. User referrals/credits (user) - per-user referral code/link + convert + balance
 *
 * Tables live in db/schema-superadmin.sql. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { PUBLIC_APP_URL } from "../config.js";
import { sendEmail, emailEnabled } from "../lib/email.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Short, URL-safe, human-typable cryptographically-secure random code. */
function randomCode(prefix = ""): string {
  // Use 6 random bytes -> 12-char hex, keep alphanumeric chars, uppercase.
  // crypto.randomBytes is CSPRNG - safe for invite/discount/referral codes.
  const body = randomBytes(6).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return prefix ? `${prefix}-${body}` : body;
}

/** Build a public link from a relative path (env URL or relative). */
function publicLink(rel: string): string {
  const base = PUBLIC_APP_URL || "";
  return base ? `${base}${rel}` : rel;
}

/** HTML body for an invite email containing the claim link. */
function inviteEmailHtml(link: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">You are invited to Divini Procure</h1>
  <p style="margin:0 0 10px">You have been invited to join Divini Procure by Divini Group.</p>
  <p style="margin:0 0 18px">Click the button below to accept your invitation and set up your account.</p>
  <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#123c2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Accept your invitation</a></p>
  <p style="margin:0 0 10px;font-size:13px;color:#7d776c">Or paste this link into your browser:<br/>${link}</p>
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">Divini Procure by Divini Group</div>
</div>`;
}

/** Plain-text fallback for an invite email. */
function inviteEmailText(link: string): string {
  return [
    "You have been invited to join Divini Procure by Divini Group.",
    "Accept your invitation and set up your account using the link below.",
    `Accept invitation: ${link}`,
  ].join("\n\n");
}

/** Best-effort invite email. Never throws; safe to call without awaiting. */
async function emailInvite(to: string, link: string): Promise<void> {
  await sendEmail({
    to,
    subject: "You are invited to Divini Procure",
    html: inviteEmailHtml(link),
    text: inviteEmailText(link),
  }).catch(() => undefined);
}

/** HTML body for a referral-partner email containing the referral link. */
function referralEmailHtml(name: string, link: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">Your Divini Procure referral link</h1>
  <p style="margin:0 0 10px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 18px">You are set up as a referral partner for Divini Procure. Share the link below; anyone who signs up through it is attributed to you.</p>
  <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#123c2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Your referral link</a></p>
  <p style="margin:0 0 10px;font-size:13px;color:#7d776c">Or copy this link:<br/>${link}</p>
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">Divini Procure by Divini Group</div>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

const router = Router();

// ===========================================================================
// 1) INVITE CODES (admin)
// ===========================================================================

/**
 * The pre-fill payload an admin can attach to an invite to build a public
 * CLAIM PAGE for a prospect company. Every field is optional; arrays are
 * normalized to string[]. Stored as jsonb on invite_codes.prefill.
 */
type InvitePrefill = {
  description?: string;
  city?: string;
  state?: string;
  assetTypes?: string[];
  contact?: string;
  focusAreas?: string[];
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}

/** Normalize an arbitrary body.prefill into a clean InvitePrefill object. */
function normalizePrefill(raw: unknown): InvitePrefill {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: InvitePrefill = {};
  const description = asString(p.description);
  const city = asString(p.city);
  const state = asString(p.state);
  const contact = asString(p.contact);
  const assetTypes = asStringArray(p.assetTypes);
  const focusAreas = asStringArray(p.focusAreas);
  if (description) out.description = description;
  if (city) out.city = city;
  if (state) out.state = state;
  if (contact) out.contact = contact;
  if (assetTypes) out.assetTypes = assetTypes;
  if (focusAreas) out.focusAreas = focusAreas;
  return out;
}

// POST /admin/invites { email?, companyKind?, companyName?, companyWebsite?, prefill? }
//   -> { invite, link }
// email stays optional: a prospect invite may have no contact address yet.
router.post(
  "/admin/invites",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    // companyKind is free-text (vendor | developer | investor | buyer | ...).
    // Stored verbatim on invite_codes.company_kind so per-role invite links can
    // route to the right onboarding. Only trim/cap length; never constrain set.
    const {
      email,
      companyKind: companyKindRaw,
      companyName: companyNameRaw,
      companyWebsite: companyWebsiteRaw,
      prefill: prefillRaw,
    } = (req.body ?? {}) as {
      email?: string;
      companyKind?: string;
      companyName?: string;
      companyWebsite?: string;
      prefill?: unknown;
    };
    const companyKind =
      typeof companyKindRaw === "string" && companyKindRaw.trim()
        ? companyKindRaw.trim().slice(0, 40)
        : undefined;
    const companyName = asString(companyNameRaw)?.slice(0, 200);
    const companyWebsite = asString(companyWebsiteRaw)?.slice(0, 400);
    const prefill = normalizePrefill(prefillRaw);
    let code = randomCode("INV");
    // Guarantee uniqueness against the unique(code) constraint.
    for (let i = 0; i < 5; i++) {
      const exists = await q1(`select 1 from invite_codes where code = $1`, [code]);
      if (!exists) break;
      code = randomCode("INV");
    }
    const invite = await q1(
      `insert into invite_codes (code, email, company_kind, company_name, company_website, prefill, created_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
      [
        code,
        email ?? null,
        companyKind ?? null,
        companyName ?? null,
        companyWebsite ?? null,
        JSON.stringify(prefill),
        auth.email ?? null,
      ],
    );
    const link = publicLink(`/join/${code}`);
    // Best-effort send: never blocks the response and never throws.
    if (emailEnabled() && email) void emailInvite(email, link);
    res.status(201).json({ invite, link });
  }),
);

// GET /admin/invites -> { invites: [...] }
// Rows include company_name, company_website and prefill so the admin UI can
// render each invite's claim-page details and link.
router.get(
  "/admin/invites",
  requireAdmin,
  h(async (_req, res) => {
    const invites = await q(`select * from invite_codes order by created_at desc limit 500`);
    res.json({ invites });
  }),
);

// POST /admin/invites/:code/resend -> refresh the link (and re-arm if claimed/revoked).
router.post(
  "/admin/invites/:code/resend",
  requireAdmin,
  h(async (req, res) => {
    const row = await q1<{ code: string; email: string | null }>(
      `update invite_codes set status = 'pending', claimed_at = null
        where code = $1 returning *`,
      [req.params.code],
    );
    if (!row) return res.status(404).json({ error: "invite not found" });
    const link = publicLink(`/join/${row.code}`);
    // Email the invite when configured and an address is on file; best-effort.
    const emailed = emailEnabled() && !!row.email;
    if (emailed) void emailInvite(row.email as string, link);
    res.json({ invite: row, link, resent: true, emailed });
  }),
);

// ===========================================================================
// 2) DISCOUNT CODES (admin)
// ===========================================================================

const KIND_OK = (v: unknown): v is "percent" | "flat" => v === "percent" || v === "flat";

// POST /admin/discount-codes { code?, kind, value, maxUses?, appliesTo?, expiresAt? }
router.post(
  "/admin/discount-codes",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { code, kind, value, maxUses, appliesTo, expiresAt } = (req.body ?? {}) as {
      code?: string;
      kind?: string;
      value?: number | string;
      maxUses?: number | string;
      appliesTo?: string;
      expiresAt?: string;
    };
    const k = KIND_OK(kind) ? kind : "percent";
    const val = value === undefined || value === null || value === "" ? 0 : Number(value);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: "value must be a non-negative number" });
    }
    let useCode = (code && String(code).trim()) || randomCode();
    if (code) {
      const dup = await q1(`select 1 from discount_codes where code = $1`, [useCode]);
      if (dup) return res.status(409).json({ error: "code already exists" });
    } else {
      for (let i = 0; i < 5; i++) {
        const dup = await q1(`select 1 from discount_codes where code = $1`, [useCode]);
        if (!dup) break;
        useCode = randomCode();
      }
    }
    const row = await q1(
      `insert into discount_codes (code, kind, value, max_uses, applies_to, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        useCode,
        k,
        val,
        maxUses === undefined || maxUses === null || maxUses === "" ? null : Math.round(Number(maxUses)),
        appliesTo ?? null,
        expiresAt ? new Date(expiresAt) : null,
        auth.email ?? null,
      ],
    );
    res.status(201).json({ discount: row });
  }),
);

// GET /admin/discount-codes -> { discounts: [...] }
router.get(
  "/admin/discount-codes",
  requireAdmin,
  h(async (_req, res) => {
    const discounts = await q(`select * from discount_codes order by created_at desc limit 500`);
    res.json({ discounts });
  }),
);

// PATCH /admin/discount-codes/:id { status?, value?, maxUses?, appliesTo?, expiresAt? }
router.patch(
  "/admin/discount-codes/:id",
  requireAdmin,
  h(async (req, res) => {
    const { status, value, maxUses, appliesTo, expiresAt } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (status !== undefined) {
      if (status !== "active" && status !== "disabled") {
        return res.status(400).json({ error: "status must be active or disabled" });
      }
      add("status", status);
    }
    if (value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "value must be >= 0" });
      add("value", n);
    }
    if (maxUses !== undefined) add("max_uses", maxUses === null || maxUses === "" ? null : Math.round(Number(maxUses)));
    if (appliesTo !== undefined) add("applies_to", appliesTo);
    if (expiresAt !== undefined) add("expires_at", expiresAt ? new Date(String(expiresAt)) : null);
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    params.push(req.params.id);
    const row = await q1(
      `update discount_codes set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ discount: row });
  }),
);

// ===========================================================================
// 3) REFERRAL PARTNERS (admin)
// ===========================================================================

// POST /admin/referral-partners
//   { name, partnerEmail?, commissionType, revenueSharePct?|flatFeeCents?, appliesTo?, companyId?, terms? }
router.post(
  "/admin/referral-partners",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const {
      name,
      partnerEmail,
      commissionType,
      revenueSharePct,
      flatFeeCents,
      appliesTo,
      companyId,
      terms,
    } = (req.body ?? {}) as Record<string, unknown>;
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
    const ct = commissionType === "flat" ? "flat" : "percent";
    let sharePct: number | null = null;
    let flatFee: number | null = null;
    if (ct === "percent") {
      const n = revenueSharePct === undefined || revenueSharePct === null || revenueSharePct === ""
        ? null
        : Number(revenueSharePct);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
        return res.status(400).json({ error: "revenueSharePct must be 0 to 100" });
      }
      sharePct = n;
    } else {
      flatFee = flatFeeCents === undefined || flatFeeCents === null || flatFeeCents === ""
        ? null
        : Math.round(Number(flatFeeCents));
    }
    let code = randomCode("REF");
    for (let i = 0; i < 5; i++) {
      const dup = await q1(`select 1 from referral_partners where referral_code = $1`, [code]);
      if (!dup) break;
      code = randomCode("REF");
    }
    const link = publicLink(`/r/${code}`);
    const partner = await q1(
      `insert into referral_partners
         (company_id, name, partner_email, referral_code, referral_link, commission_type,
          revenue_share_pct, flat_fee_cents, applies_to, terms, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        companyId ?? null,
        name,
        partnerEmail ?? null,
        code,
        link,
        ct,
        sharePct,
        flatFee,
        appliesTo ?? null,
        terms ?? null,
        auth.email ?? null,
      ],
    );
    // Optional best-effort email of the referral link to the partner.
    let emailed = false;
    if (emailEnabled() && typeof partnerEmail === "string" && partnerEmail.trim()) {
      emailed = true;
      void sendEmail({
        to: partnerEmail.trim(),
        subject: "Your Divini Procure referral link",
        html: referralEmailHtml(name, link),
        text: [
          `Hi ${name},`,
          "You are set up as a referral partner for Divini Procure. Share the link below; anyone who signs up through it is attributed to you.",
          `Your referral link: ${link}`,
        ].join("\n\n"),
      }).catch(() => undefined);
    }
    res.status(201).json({ partner, emailed });
  }),
);

// GET /admin/referral-partners -> { partners: [...] }
router.get(
  "/admin/referral-partners",
  requireAdmin,
  h(async (_req, res) => {
    const partners = await q(`select * from referral_partners order by created_at desc limit 500`);
    res.json({ partners });
  }),
);

// PATCH /admin/referral-partners/:id (revenue share fully editable)
router.patch(
  "/admin/referral-partners/:id",
  requireAdmin,
  h(async (req, res) => {
    const {
      name,
      partnerEmail,
      commissionType,
      revenueSharePct,
      flatFeeCents,
      appliesTo,
      status,
      terms,
    } = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (name !== undefined) add("name", name);
    if (partnerEmail !== undefined) add("partner_email", partnerEmail);
    if (commissionType !== undefined) add("commission_type", commissionType === "flat" ? "flat" : "percent");
    if (revenueSharePct !== undefined) {
      const n = revenueSharePct === null || revenueSharePct === "" ? null : Number(revenueSharePct);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
        return res.status(400).json({ error: "revenueSharePct must be 0 to 100" });
      }
      add("revenue_share_pct", n);
    }
    if (flatFeeCents !== undefined)
      add("flat_fee_cents", flatFeeCents === null || flatFeeCents === "" ? null : Math.round(Number(flatFeeCents)));
    if (appliesTo !== undefined) add("applies_to", appliesTo);
    if (status !== undefined) {
      if (status !== "active" && status !== "disabled") {
        return res.status(400).json({ error: "status must be active or disabled" });
      }
      add("status", status);
    }
    if (terms !== undefined) add("terms", terms);
    if (!sets.length) return res.status(400).json({ error: "no fields to update" });
    params.push(req.params.id);
    const partner = await q1(
      `update referral_partners set ${sets.join(", ")} where id = $${params.length} returning *`,
      params,
    );
    if (!partner) return res.status(404).json({ error: "not found" });
    res.json({ partner });
  }),
);

// ===========================================================================
// 4) USER REFERRALS + CREDITS (signed-in user; lighter port of Partners)
// ===========================================================================

const REFERRER_CREDIT_CENTS = 1000; // $10.00 on a converted referral

/** Ensure (and return) the signed-in user's referral code. */
async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await q1<{ code: string }>(`select code from referral_codes where user_id = $1`, [userId]);
  if (existing) return existing.code;
  let code = randomCode("U");
  for (let i = 0; i < 5; i++) {
    const dup = await q1(`select 1 from referral_codes where code = $1`, [code]);
    if (!dup) break;
    code = randomCode("U");
  }
  const row = await q1<{ code: string }>(
    `insert into referral_codes (user_id, code) values ($1,$2)
     on conflict (user_id) do update set code = referral_codes.code
     returning code`,
    [userId, code],
  );
  return row!.code;
}

// GET /referrals/me -> { code, link, sent, converted, pending }
router.get(
  "/referrals/me",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const code = await ensureReferralCode(auth.userId!);
    const counts = await q1<{ sent: number; converted: number; pending: number }>(
      `select count(*)::int as sent,
              count(*) filter (where status = 'converted')::int as converted,
              count(*) filter (where status = 'pending')::int as pending
         from user_referrals where referrer_user_id = $1`,
      [auth.userId!],
    );
    res.json({
      code,
      link: publicLink(`/r/${code}`),
      sent: counts?.sent ?? 0,
      converted: counts?.converted ?? 0,
      pending: counts?.pending ?? 0,
    });
  }),
);

// POST /referrals/convert { code?, referredEmail? } -> grants the referrer a credit.
// The acting (signed-in) user is the referred party. IDOR-safe: you can never
// convert a referral whose referrer is yourself, and you can only match a code
// or your own email.
router.post(
  "/referrals/convert",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { code, referredEmail } = (req.body ?? {}) as { code?: string; referredEmail?: string };
    const email = (referredEmail || auth.email || "").toLowerCase() || null;

    // Find a pending referral pointing at THIS user (by code, or by their email).
    const target = await q1<{ id: string; referrer_user_id: string }>(
      `select id, referrer_user_id from user_referrals
        where status = 'pending'
          and ( ($1::text is not null and code = $1)
             or ($2::text is not null and lower(referred_email) = $2) )
        order by created_at asc limit 1`,
      [code ?? null, email],
    );
    if (!target) return res.status(404).json({ error: "no pending referral to convert" });
    if (target.referrer_user_id === auth.userId) {
      return res.status(400).json({ error: "cannot convert your own referral" });
    }

    const converted = await q1<{ id: string; referrer_user_id: string }>(
      `update user_referrals set status = 'converted', converted_at = now()
        where id = $1 and status = 'pending'
        returning id, referrer_user_id`,
      [target.id],
    );
    if (!converted) return res.json({ referral: target, alreadyConverted: true });

    const credit = await q1<{ id: string }>(
      `insert into platform_credits (user_id, amount_cents, kind, reason)
       values ($1,$2,'earned',$3) returning id`,
      [converted.referrer_user_id, REFERRER_CREDIT_CENTS, `Referral ${converted.id} converted`],
    );
    res.json({
      referral: converted,
      referrerCredit: { id: credit!.id, amountCents: REFERRER_CREDIT_CENTS },
    });
  }),
);

// GET /credits/balance -> { balanceCents, earnedCents, redeemedCents }
router.get(
  "/credits/balance",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const row = await q1<{ earned: string; redeemed: string }>(
      `select coalesce(sum(amount_cents) filter (where kind = 'earned'),0) as earned,
              coalesce(sum(amount_cents) filter (where kind = 'redeemed'),0) as redeemed
         from platform_credits where user_id = $1`,
      [auth.userId!],
    );
    const earned = Number(row?.earned ?? 0);
    const redeemed = Number(row?.redeemed ?? 0);
    res.json({ balanceCents: earned - redeemed, earnedCents: earned, redeemedCents: redeemed });
  }),
);

export default router;
