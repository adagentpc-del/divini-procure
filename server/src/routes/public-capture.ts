/**
 * Public capture + signup attribution for Divini Procure. Mounted under /api in
 * routes.ts. Completes the invite/referral loop whose admin side already lives
 * in admin-extra.ts (invite codes -> /join/:code, referral partners -> /r/:code).
 *
 * Two PUBLIC (no-auth) lookups power the landing pages, and two AUTHED
 * (requireUser) endpoints attribute the freshly signed-in user back to the
 * invite / referral partner that brought them in. All endpoints are idempotent
 * and leak no sensitive data. Zero em dashes by convention.
 *
 * Endpoints:
 *   GET  /public/invite/:code     (public) -> { found, email, companyKind, status }
 *   GET  /public/referral/:code   (public) -> { found, partnerName }
 *   POST /invites/:code/accept    (user)   -> claim the invite for the signed-in user
 *   POST /referrals/attribute     (user)   -> record partner attribution for the user
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q1 } from "../pool.js";
import { inviteLookupRateLimit } from "../lib/rateLimit.js";
import { sendEmail, emailEnabled } from "../lib/email.js";
import { PUBLIC_APP_URL } from "../config.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ===========================================================================
// PUBLIC lookups (no auth) - drive the /join and /r landing pages.
// ===========================================================================

// GET /public/invite/:code  (#27: rate-limited to prevent code enumeration)
//   -> { found, email, companyKind, status, companyName, companyWebsite, prefill }
// Returns only enough to render the landing / claim page; never leaks
// created_by or other internal fields.
router.get(
  "/public/invite/:code",
  inviteLookupRateLimit,
  h(async (req, res) => {
    const row = await q1<{
      email: string | null;
      company_kind: string | null;
      status: string | null;
      company_name: string | null;
      company_website: string | null;
      prefill: unknown;
    }>(
      `select email, company_kind, status, company_name, company_website, prefill
         from invite_codes where code = $1`,
      [req.params.code],
    );
    if (!row) return res.json({ found: false });
    res.json({
      found: true,
      // email is intentionally omitted: returning it lets anyone with a valid
      // code (or who brute-forces one) discover the address an admin sent it to.
      companyKind: row.company_kind ?? null,
      status: row.status ?? "pending",
      companyName: row.company_name ?? null,
      companyWebsite: row.company_website ?? null,
      prefill: (row.prefill && typeof row.prefill === "object" ? row.prefill : {}) as Record<string, unknown>,
    });
  }),
);

// GET /public/referral/:code -> { found, partnerName }
// Only active partners are honored; disabled partners read as not-found.
router.get(
  "/public/referral/:code",
  inviteLookupRateLimit,
  h(async (req, res) => {
    const row = await q1<{ name: string; status: string | null }>(
      `select name, status from referral_partners where referral_code = $1`,
      [req.params.code],
    );
    if (!row || row.status === "disabled") return res.json({ found: false });
    res.json({ found: true, partnerName: row.name });
  }),
);

// ===========================================================================
// AUTHED attribution (requireUser) - fired once after the user signs in.
// ===========================================================================

// POST /invites/:code/accept -> mark the invite claimed by the signed-in user.
// Idempotent: an already-claimed invite returns { accepted: true } again.
router.post(
  "/invites/:code/accept",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const existing = await q1<{ code: string; status: string | null }>(
      `select code, status from invite_codes where code = $1`,
      [req.params.code],
    );
    if (!existing) return res.status(404).json({ error: "invite not found" });
    if (existing.status === "revoked") {
      return res.status(409).json({ error: "invite revoked" });
    }
    // Only flip a pending invite; a claimed one stays claimed (idempotent).
    const row = await q1<{ code: string; status: string | null; claimed_at: string | null }>(
      `update invite_codes
          set status = 'claimed', claimed_at = coalesce(claimed_at, now())
        where code = $1
        returning code, status, claimed_at`,
      [req.params.code],
    );
    res.json({ accepted: true, invite: row, userId: auth.userId });
  }),
);

// POST /referrals/attribute { code } -> record that the signed-in user came in
// through a referral partner. Inserts ONE pending user_referrals row keyed off
// the partner code with the new user as the referred party. Idempotent (will
// not duplicate) and cannot self-refer (a partner whose own user is signing in).
router.post(
  "/referrals/attribute",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "code required" });
    }

    const partner = await q1<{ id: string; name: string; status: string | null; company_id: string | null }>(
      `select id, name, status, company_id from referral_partners where referral_code = $1`,
      [code],
    );
    if (!partner || partner.status === "disabled") {
      return res.status(404).json({ error: "referral partner not found" });
    }

    // Cannot self-refer: if this user already belongs to the partner's company,
    // skip the attribution rather than crediting a partner for their own signup.
    if (partner.company_id) {
      const ownMembership = await q1(
        `select 1 from company_members where company_id = $1 and user_id = $2`,
        [partner.company_id, auth.userId],
      );
      if (ownMembership) {
        return res.json({ attributed: false, reason: "self-referral", partnerName: partner.name });
      }
    }

    const email = (auth.email || "").toLowerCase() || null;

    // Idempotent: one attribution per (partner code, referred user). We key the
    // dedupe on referred_email + code since user_referrals has no referred_user
    // column; fall back to code-only when the user has no email claim.
    const existing = await q1<{ id: string }>(
      `select id from user_referrals
        where code = $1
          and ( ($2::text is not null and lower(referred_email) = $2)
             or ($2::text is null) )
        limit 1`,
      [code, email],
    );
    if (existing) {
      return res.json({ attributed: true, alreadyAttributed: true, partnerName: partner.name });
    }

    const row = await q1<{ id: string }>(
      `insert into user_referrals (referrer_user_id, referred_email, code, status)
       values (null, $1, $2, 'pending')
       returning id`,
      [email, code],
    );

    // Send onboarding email to the partner (the person who clicked the link
    // and just registered) so they know to complete the agreement + banking.
    if (emailEnabled() && email) {
      const onboardingUrl = `${PUBLIC_APP_URL || ""}/partner/onboarding`;
      void sendEmail({
        to: email,
        subject: "Complete your Referral Partner Setup - Divini Procure",
        html: `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">Welcome, Referral Partner!</h1>
  <p style="margin:0 0 10px">Your account has been created and linked to the Divini Procure referral program.</p>
  <p style="margin:0 0 18px">To activate your partner account and start earning referral fees, you need to complete two quick steps:</p>
  <ol style="margin:0 0 18px;padding-left:20px;line-height:2">
    <li><strong>Sign the Referral Partner Agreement</strong></li>
    <li><strong>Submit your banking information</strong> so we can pay you</li>
  </ol>
  <p style="margin:0 0 18px"><a href="${onboardingUrl}" style="display:inline-block;background:#123c2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Complete Partner Setup</a></p>
  <p style="margin:0 0 10px;font-size:13px;color:#7d776c">Or paste this link: ${onboardingUrl}</p>
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">Divini Procure by Divini Group</div>
</div>`,
        text: `Welcome to the Divini Procure referral program!\n\nTo activate your partner account and receive referral fees, please complete these two steps:\n1. Sign the Referral Partner Agreement\n2. Submit your banking information\n\nComplete your setup here: ${onboardingUrl}`,
      }).catch(() => undefined);
    }

    res.status(201).json({ attributed: true, referralId: row?.id ?? null, partnerName: partner.name });
  }),
);

export default router;
