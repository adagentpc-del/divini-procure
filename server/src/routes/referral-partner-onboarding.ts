/**
 * Referral Partner Onboarding Routes
 *
 * After a referral partner registers via their /r/:code link and their
 * attribution is recorded, they are directed to complete two steps:
 *   1. Review and e-sign the Referral Partner Agreement
 *   2. Submit their banking / wire transfer info for payouts
 *
 * Endpoints:
 *   GET  /partner/onboarding/status          -> { step, partner, hasSigned, hasBanking }
 *   GET  /partner/onboarding/agreement        -> { agreementBody, partnerName, commissionSummary }
 *   POST /partner/onboarding/agreement/sign   -> record e-signature
 *   POST /partner/onboarding/banking          -> submit banking info
 *   GET  /partner/onboarding/banking          -> get existing banking info (masked)
 *   PATCH /partner/onboarding/banking         -> update banking info
 *
 * Admin endpoints:
 *   GET  /admin/referral-partners/:id/onboarding  -> full onboarding status
 *   GET  /admin/referral-partner-banking           -> list all banking submissions (masked)
 *   PATCH /admin/referral-partner-banking/:id/verify -> mark banking verified
 *
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { sendEmail, emailEnabled } from "../lib/email.js";
import { PUBLIC_APP_URL } from "../config.js";
import { encryptField, decryptField } from "../lib/fieldCrypto.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAgreementBody(partner: {
  name: string;
  commission_type: string;
  revenue_share_pct: number | null;
  flat_fee_cents: number | null;
  applies_to: string | null;
  terms: string | null;
}): string {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const commissionLine =
    partner.commission_type === "flat"
      ? `a flat referral fee of $${((partner.flat_fee_cents ?? 0) / 100).toFixed(2)} per qualifying event`
      : `a revenue share of ${partner.revenue_share_pct ?? 0}% of qualifying platform fees`;

  const appliesTo = partner.applies_to
    ? `\nThe referral fee applies to: ${partner.applies_to}.`
    : "";

  const customTerms = partner.terms
    ? `\n\nAdditional Terms:\n${partner.terms}`
    : "";

  return [
    "REFERRAL PARTNER AGREEMENT",
    "",
    `This Referral Partner Agreement (the "Agreement") is entered into on ${date} between Divini Group, LLC, operator of Divini Procure ("Divini Procure"), and the referral partner identified below ("Partner").`,
    "",
    "1. Referral Program.",
    `   Partner agrees to refer prospective buyers, vendors, and other participants to the Divini Procure platform using Partner's unique referral link. Divini Procure will track attributions made through this link.`,
    "",
    "2. Compensation.",
    `   In consideration of qualifying referrals, Divini Procure will pay Partner ${commissionLine} upon successful conversion and reconciliation.${appliesTo}`,
    "",
    "3. Payment.",
    `   Referral fees will be paid to the banking details provided by Partner in the Divini Procure partner portal. Payments are issued on a monthly basis for all fees that have cleared and been reconciled. Divini Procure reserves the right to withhold payment if the referring account is subject to a dispute, reversal, or fraud investigation.`,
    "",
    "4. Non-Circumvention.",
    `   Partner agrees not to circumvent, bypass, or otherwise avoid Divini Procure to deal directly with any party introduced through the platform in a manner intended to avoid the referral program terms.`,
    "",
    "5. Confidentiality.",
    `   Partner agrees to treat the terms of this Agreement and any non-public information about Divini Procure's clients, pricing, or operations as confidential and not to disclose them to third parties.`,
    "",
    "6. Term and Termination.",
    `   This Agreement is effective upon execution and continues until terminated by either party with 30 days written notice. Earned fees prior to termination remain payable.`,
    "",
    "7. Representation.",
    `   Partner represents that they have the authority to enter into this Agreement and will promote Divini Procure honestly and in compliance with all applicable laws.`,
    "",
    customTerms,
    "By electronically signing below, Partner agrees to be bound by this Agreement.",
    "",
    `Date: ${date}`,
    `Platform: Divini Procure (${PUBLIC_APP_URL || "diviniprocure.com"})`,
  ].join("\n");
}

function maskAccount(s: string | null): string | null {
  if (!s || s.length < 4) return s;
  return "****" + s.slice(-4);
}

function agreementSignedEmailHtml(partnerName: string, signedName: string, date: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">Referral Partner Agreement Signed</h1>
  <p style="margin:0 0 10px">Hi ${partnerName},</p>
  <p style="margin:0 0 10px">Your Referral Partner Agreement has been signed by <strong>${signedName}</strong> on ${date}. A copy is on file with Divini Procure.</p>
  <p style="margin:0 0 18px">Your next step is to submit your banking information so we can pay you your referral fees. Log in to your partner portal to complete this step.</p>
  <p style="margin:0 0 18px"><a href="${PUBLIC_APP_URL || ""}/partner/onboarding" style="display:inline-block;background:#123c2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Complete Banking Setup</a></p>
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">Divini Procure by Divini Group</div>
</div>`;
}

function bankingSubmittedAdminEmailHtml(partnerName: string, email: string, method: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure Admin</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">Referral Partner Banking Submitted</h1>
  <p style="margin:0 0 10px">A referral partner has submitted their banking information and requires verification.</p>
  <table style="width:100%;border-collapse:collapse;margin:0 0 18px">
    <tr><td style="padding:6px 0;color:#7d776c;width:140px">Partner Name:</td><td style="padding:6px 0"><strong>${partnerName}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#7d776c">Email:</td><td style="padding:6px 0">${email}</td></tr>
    <tr><td style="padding:6px 0;color:#7d776c">Payout Method:</td><td style="padding:6px 0">${method.toUpperCase()}</td></tr>
  </table>
  <p style="margin:0 0 18px"><a href="${PUBLIC_APP_URL || ""}/admin/referral-partners" style="display:inline-block;background:#123c2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Review in Admin</a></p>
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">Divini Procure by Divini Group</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Partner-facing endpoints (requireUser)
// ---------------------------------------------------------------------------

// GET /partner/onboarding/status
// Returns the partner's onboarding step so the UI knows what to show.
router.get(
  "/partner/onboarding/status",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    // Find the referral partner linked to this user via a matching
    // user_referrals.code -> referral_partners.referral_code, OR directly
    // via partner_email matching the user email. (Was previously joined on
    // a user_referrals.referred_by_partner_id column that does not exist in
    // any schema file - every call to this endpoint 500'd unconditionally,
    // since Postgres validates the whole WHERE clause including both OR
    // branches. Found and fixed during the ALFY2 Section 01/02 field-
    // encryption verification pass.)
    const partner = await q1<{
      id: string;
      name: string;
      partner_email: string | null;
      commission_type: string;
      revenue_share_pct: number | null;
      flat_fee_cents: number | null;
      applies_to: string | null;
      terms: string | null;
      onboarding_status: string;
    }>(
      `SELECT rp.*
       FROM referral_partners rp
       WHERE rp.partner_email = $1
          OR rp.referral_code IN (
            SELECT code FROM user_referrals
            WHERE referred_email = $1 AND code IS NOT NULL
          )
       ORDER BY rp.created_at DESC
       LIMIT 1`,
      [auth.email ?? ""],
    );

    if (!partner) {
      return res.json({ isPartner: false });
    }

    const hasSigned = !!(await q1(
      `SELECT 1 FROM referral_partner_agreements WHERE partner_id = $1`,
      [partner.id],
    ));

    const banking = await q1<{ id: string; payout_method: string; verified: boolean }>(
      `SELECT id, payout_method, verified FROM referral_partner_banking WHERE partner_id = $1`,
      [partner.id],
    );

    let step: "sign_agreement" | "submit_banking" | "complete" = "sign_agreement";
    if (hasSigned && !banking) step = "submit_banking";
    if (hasSigned && banking) step = "complete";

    res.json({
      isPartner: true,
      partner: {
        id: partner.id,
        name: partner.name,
        onboardingStatus: partner.onboarding_status,
      },
      hasSigned,
      hasBanking: !!banking,
      bankingVerified: banking?.verified ?? false,
      step,
    });
  }),
);

// GET /partner/onboarding/agreement
// Returns the agreement body for the partner to review before signing.
router.get(
  "/partner/onboarding/agreement",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const partner = await q1<{
      id: string;
      name: string;
      commission_type: string;
      revenue_share_pct: number | null;
      flat_fee_cents: number | null;
      applies_to: string | null;
      terms: string | null;
    }>(
      `SELECT rp.id, rp.name, rp.commission_type, rp.revenue_share_pct,
              rp.flat_fee_cents, rp.applies_to, rp.terms
       FROM referral_partners rp
       WHERE rp.partner_email = $1
          OR rp.referral_code IN (
            SELECT code FROM user_referrals
            WHERE referred_email = $1 AND code IS NOT NULL
          )
       ORDER BY rp.created_at DESC LIMIT 1`,
      [auth.email ?? ""],
    );

    if (!partner) return res.status(404).json({ error: "Not a referral partner" });

    const existing = await q1<{ signed_at: string; signed_name: string }>(
      `SELECT signed_at, signed_name FROM referral_partner_agreements WHERE partner_id = $1`,
      [partner.id],
    );

    const body = buildAgreementBody(partner);
    const commissionSummary =
      partner.commission_type === "flat"
        ? `$${((partner.flat_fee_cents ?? 0) / 100).toFixed(2)} flat fee per referral`
        : `${partner.revenue_share_pct ?? 0}% revenue share`;

    res.json({
      agreementBody: body,
      partnerName: partner.name,
      commissionSummary,
      alreadySigned: !!existing,
      signedAt: existing?.signed_at ?? null,
      signedName: existing?.signed_name ?? null,
    });
  }),
);

// POST /partner/onboarding/agreement/sign
// Records the partner's e-signature.
router.post(
  "/partner/onboarding/agreement/sign",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { signedName } = (req.body ?? {}) as { signedName?: string };

    if (!signedName || signedName.trim().length < 2) {
      return res.status(400).json({ error: "Full legal name is required to sign." });
    }

    const partner = await q1<{
      id: string;
      name: string;
      partner_email: string | null;
      commission_type: string;
      revenue_share_pct: number | null;
      flat_fee_cents: number | null;
      applies_to: string | null;
      terms: string | null;
    }>(
      `SELECT rp.* FROM referral_partners rp
       WHERE rp.partner_email = $1
          OR rp.referral_code IN (
            SELECT code FROM user_referrals
            WHERE referred_email = $1 AND code IS NOT NULL
          )
       ORDER BY rp.created_at DESC LIMIT 1`,
      [auth.email ?? ""],
    );

    if (!partner) return res.status(404).json({ error: "Not a referral partner" });

    const existing = await q1(
      `SELECT 1 FROM referral_partner_agreements WHERE partner_id = $1`,
      [partner.id],
    );
    if (existing) {
      return res.status(409).json({ error: "Agreement already signed." });
    }

    const body = buildAgreementBody(partner);
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const ua = (req.headers["user-agent"] as string) ?? null;

    await q(
      `INSERT INTO referral_partner_agreements
         (partner_id, user_id, agreement_body, signed_name, signed_ip, signed_ua)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [partner.id, auth.userId, body, signedName.trim(), ip, ua],
    );

    await q(
      `UPDATE referral_partners SET onboarding_status = 'agreement_signed' WHERE id = $1`,
      [partner.id],
    );

    // Send confirmation email to partner
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    if (emailEnabled() && partner.partner_email) {
      void sendEmail({
        to: partner.partner_email,
        subject: "Your Referral Partner Agreement is signed - Divini Procure",
        html: agreementSignedEmailHtml(partner.name, signedName.trim(), date),
        text: `Hi ${partner.name},\n\nYour Referral Partner Agreement has been signed by ${signedName.trim()} on ${date}. Your next step is to submit your banking information so we can pay you. Log in to complete this step: ${PUBLIC_APP_URL || ""}/partner/onboarding`,
      }).catch(() => undefined);
    }

    res.json({ signed: true, signedAt: new Date().toISOString() });
  }),
);

// POST /partner/onboarding/banking
// Submit banking / wire transfer info.
router.post(
  "/partner/onboarding/banking",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const {
      payoutMethod,
      beneficiaryName,
      bankName,
      accountNumber,
      routingNumber,
      accountType,
      swiftCode,
      iban,
      bankAddress,
      zelleEmail,
      paypalEmail,
      checkPayableTo,
      checkAddress,
      notes,
    } = (req.body ?? {}) as Record<string, string | undefined>;

    if (!payoutMethod || !beneficiaryName?.trim()) {
      return res.status(400).json({ error: "Payout method and beneficiary name are required." });
    }

    const validMethods = ["wire", "ach", "check", "zelle", "paypal"];
    if (!validMethods.includes(payoutMethod)) {
      return res.status(400).json({ error: "Invalid payout method." });
    }

    // Method-specific validation
    if (payoutMethod === "wire" || payoutMethod === "ach") {
      if (!accountNumber?.trim() || !routingNumber?.trim()) {
        return res.status(400).json({ error: "Account number and routing number are required for wire/ACH." });
      }
    }
    if (payoutMethod === "zelle" && !zelleEmail?.trim()) {
      return res.status(400).json({ error: "Zelle email is required." });
    }
    if (payoutMethod === "paypal" && !paypalEmail?.trim()) {
      return res.status(400).json({ error: "PayPal email is required." });
    }

    const partner = await q1<{ id: string; name: string; partner_email: string | null }>(
      `SELECT rp.id, rp.name, rp.partner_email FROM referral_partners rp
       WHERE rp.partner_email = $1
          OR rp.referral_code IN (
            SELECT code FROM user_referrals
            WHERE referred_email = $1 AND code IS NOT NULL
          )
       ORDER BY rp.created_at DESC LIMIT 1`,
      [auth.email ?? ""],
    );

    if (!partner) return res.status(404).json({ error: "Not a referral partner" });

    // Check agreement is signed first
    const hasSigned = await q1(
      `SELECT 1 FROM referral_partner_agreements WHERE partner_id = $1`,
      [partner.id],
    );
    if (!hasSigned) {
      return res.status(400).json({ error: "Please sign the Referral Partner Agreement before submitting banking info." });
    }

    // Upsert banking info. account_number/routing_number/iban are encrypted
    // at rest (see server/src/lib/fieldCrypto.ts) - they are enough on their
    // own to originate an ACH debit or wire, so a Postgres dump/backup leak
    // should not hand those out in cleartext.
    const encAccountNumber = encryptField(accountNumber?.trim() || null);
    const encRoutingNumber = encryptField(routingNumber?.trim() || null);
    const encIban = encryptField(iban?.trim() || null);

    const existing = await q1<{ id: string }>(
      `SELECT id FROM referral_partner_banking WHERE partner_id = $1`,
      [partner.id],
    );

    if (existing) {
      await q(
        `UPDATE referral_partner_banking SET
           payout_method = $1, beneficiary_name = $2, bank_name = $3,
           account_number = $4, routing_number = $5, account_type = $6,
           swift_code = $7, iban = $8, bank_address = $9,
           zelle_email = $10, paypal_email = $11,
           check_payable_to = $12, check_address = $13, notes = $14,
           verified = false, verified_by = null, verified_at = null,
           updated_at = now()
         WHERE partner_id = $15`,
        [
          payoutMethod, beneficiaryName?.trim(), bankName?.trim() || null,
          encAccountNumber, encRoutingNumber,
          accountType || null, swiftCode?.trim() || null,
          encIban, bankAddress?.trim() || null,
          zelleEmail?.trim() || null, paypalEmail?.trim() || null,
          checkPayableTo?.trim() || null, checkAddress?.trim() || null,
          notes?.trim() || null, partner.id,
        ],
      );
    } else {
      await q(
        `INSERT INTO referral_partner_banking
           (partner_id, user_id, payout_method, beneficiary_name, bank_name,
            account_number, routing_number, account_type, swift_code, iban,
            bank_address, zelle_email, paypal_email, check_payable_to,
            check_address, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          partner.id, auth.userId, payoutMethod, beneficiaryName?.trim(),
          bankName?.trim() || null, encAccountNumber,
          encRoutingNumber, accountType || null,
          swiftCode?.trim() || null, encIban,
          bankAddress?.trim() || null, zelleEmail?.trim() || null,
          paypalEmail?.trim() || null, checkPayableTo?.trim() || null,
          checkAddress?.trim() || null, notes?.trim() || null,
        ],
      );
    }

    await q(
      `UPDATE referral_partners SET onboarding_status = 'complete' WHERE id = $1`,
      [partner.id],
    );

    // Notify admin
    const adminEmails = (process.env.ADMIN_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    if (emailEnabled() && adminEmails.length) {
      void sendEmail({
        to: adminEmails[0],
        subject: `Referral partner banking submitted: ${partner.name}`,
        html: bankingSubmittedAdminEmailHtml(partner.name, partner.partner_email ?? auth.email ?? "", payoutMethod),
        text: `Referral partner ${partner.name} has submitted banking information (${payoutMethod.toUpperCase()}). Please verify in admin: ${PUBLIC_APP_URL || ""}/admin/referral-partners`,
      }).catch(() => undefined);
    }

    res.json({ submitted: true });
  }),
);

// GET /partner/onboarding/banking
// Returns masked banking info for the current partner.
router.get(
  "/partner/onboarding/banking",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const partner = await q1<{ id: string }>(
      `SELECT rp.id FROM referral_partners rp
       WHERE rp.partner_email = $1
          OR rp.referral_code IN (
            SELECT code FROM user_referrals
            WHERE referred_email = $1 AND code IS NOT NULL
          )
       ORDER BY rp.created_at DESC LIMIT 1`,
      [auth.email ?? ""],
    );
    if (!partner) return res.json({ banking: null });

    const banking = await q1<Record<string, string | boolean | null>>(
      `SELECT id, payout_method, beneficiary_name, bank_name,
              account_number, routing_number, account_type,
              swift_code, iban, bank_address,
              zelle_email, paypal_email, check_payable_to, check_address,
              notes, verified, created_at, updated_at
       FROM referral_partner_banking WHERE partner_id = $1`,
      [partner.id],
    );

    if (!banking) return res.json({ banking: null });

    // Decrypt then mask - the client never receives the full value or the
    // raw ciphertext, only the last 4 characters (see fieldCrypto.ts).
    res.json({
      banking: {
        ...banking,
        account_number: maskAccount(decryptField(banking.account_number as string | null)),
        routing_number: maskAccount(decryptField(banking.routing_number as string | null)),
        iban: maskAccount(decryptField(banking.iban as string | null)),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

// GET /admin/referral-partner-banking -> all banking submissions (masked)
router.get(
  "/admin/referral-partner-banking",
  requireAdmin,
  h(async (_req, res) => {
    const rows = await q(
      `SELECT rpb.*, rp.name as partner_name, rp.partner_email, rp.onboarding_status
       FROM referral_partner_banking rpb
       JOIN referral_partners rp ON rp.id = rpb.partner_id
       ORDER BY rpb.created_at DESC`,
    );
    // Decrypt then mask for the admin list view (no endpoint returns the
    // full unmasked value - see fieldCrypto.ts).
    const masked = rows.map((r: Record<string, unknown>) => ({
      ...r,
      account_number: maskAccount(decryptField(r.account_number as string | null)),
      routing_number: maskAccount(decryptField(r.routing_number as string | null)),
      iban: maskAccount(decryptField(r.iban as string | null)),
    }));
    res.json({ banking: masked });
  }),
);

// PATCH /admin/referral-partner-banking/:id/verify
router.patch(
  "/admin/referral-partner-banking/:id/verify",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { verified } = (req.body ?? {}) as { verified?: boolean };
    const row = await q1(
      `UPDATE referral_partner_banking
       SET verified = $1, verified_by = $2, verified_at = CASE WHEN $1 THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $3 RETURNING id`,
      [!!verified, auth.email ?? "admin", req.params.id],
    );
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ updated: true });
  }),
);

// GET /admin/referral-partners/:id/onboarding -> full onboarding status for one partner
router.get(
  "/admin/referral-partners/:id/onboarding",
  requireAdmin,
  h(async (req, res) => {
    const partner = await q1(
      `SELECT * FROM referral_partners WHERE id = $1`,
      [req.params.id],
    );
    if (!partner) return res.status(404).json({ error: "Not found" });

    const agreement = await q1(
      `SELECT id, signed_name, signed_at, signed_ip FROM referral_partner_agreements WHERE partner_id = $1`,
      [req.params.id],
    );

    const banking = await q1(
      `SELECT id, payout_method, beneficiary_name, bank_name,
              account_number, routing_number, account_type, swift_code,
              iban, bank_address, zelle_email, paypal_email,
              check_payable_to, check_address, verified, verified_by, verified_at
       FROM referral_partner_banking WHERE partner_id = $1`,
      [req.params.id],
    );

    res.json({
      partner,
      agreement: agreement
        ? {
            ...agreement,
            account_number: maskAccount(decryptField((banking as Record<string, string | null> | null)?.account_number ?? null)),
          }
        : null,
      banking: banking
        ? {
            ...(banking as Record<string, unknown>),
            account_number: maskAccount(decryptField((banking as Record<string, string | null>).account_number)),
            routing_number: maskAccount(decryptField((banking as Record<string, string | null>).routing_number)),
            iban: maskAccount(decryptField((banking as Record<string, string | null>).iban)),
          }
        : null,
    });
  }),
);

export default router;
