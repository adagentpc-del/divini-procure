/**
 * Admin Email Campaigns routes for Divini Procure. Mounted under /api in
 * routes.ts (so paths are /api/admin/campaigns...). ALL routes are requireAdmin.
 *
 * Lifecycle gate: draft -> test (one email to the admin or a chosen address) ->
 * approve-and-send (the explicit broadcast that resolves the segment, snapshots
 * recipients, and mails each one). The approve-and-send step is the ONLY place
 * mail goes out to the segment audience; it is rejected unless a test has been
 * sent first, and guards against a double send.
 *
 * Self-pathing: this router owns the /admin/campaigns subtree. It uses Procure's
 * own q/q1 helpers, getAuth/requireAdmin guards, and lib/email.sendEmail. No
 * dependency on db.ts beyond the shared error classes is needed here.
 *
 * Zero em dashes by convention of the ported routers.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireAdmin } from "../auth.js";
import { q, q1 } from "../pool.js";
import { sendEmail } from "../lib/email.js";

// Async handler wrapper that funnels errors to the error middleware.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// Segments the admin can broadcast to. Each maps to a query that yields
// { email, name, company_id } rows. Unknown / empty segments resolve to [].
const SEGMENTS = [
  "developers",
  "vendors",
  "investors",
  "claim_prospects",
  "referral_partners",
  "all_companies",
] as const;
type Segment = (typeof SEGMENTS)[number];

interface Recipient {
  email: string;
  name: string | null;
  company_id: string | null;
}

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  segment: string;
  status: string;
  test_sent_to: string | null;
  test_sent_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Resolve a segment to a deduped recipient list. Each branch queries its source
 * table, skips null/empty emails, and the whole set is deduped by lower(email).
 * "developers" = buyer companies; "vendors" = vendor companies; "investors" =
 * companies with kind 'investor' (none exist today, so this is empty unless that
 * kind is later added); "claim_prospects" = invite_codes prospects;
 * "referral_partners" = the referral_partners table; "all_companies" = every
 * company with an email.
 */
async function resolveSegment(segment: string): Promise<Recipient[]> {
  let rows: Recipient[] = [];
  switch (segment as Segment) {
    case "developers":
      rows = await q<Recipient>(
        `select email, coalesce(contact_name, name) as name, id as company_id
           from companies
          where kind = 'buyer' and email is not null and btrim(email) <> ''`,
      );
      break;
    case "vendors":
      rows = await q<Recipient>(
        `select email, coalesce(contact_name, name) as name, id as company_id
           from companies
          where kind = 'vendor' and email is not null and btrim(email) <> ''`,
      );
      break;
    case "investors":
      rows = await q<Recipient>(
        `select email, coalesce(contact_name, name) as name, id as company_id
           from companies
          where kind = 'investor' and email is not null and btrim(email) <> ''`,
      );
      break;
    case "claim_prospects":
      rows = await q<Recipient>(
        `select email, company_name as name, null::uuid as company_id
           from invite_codes
          where email is not null and btrim(email) <> ''`,
      );
      break;
    case "referral_partners":
      rows = await q<Recipient>(
        `select partner_email as email, name, company_id
           from referral_partners
          where partner_email is not null and btrim(partner_email) <> ''`,
      );
      break;
    case "all_companies":
      rows = await q<Recipient>(
        `select email, coalesce(contact_name, name) as name, id as company_id
           from companies
          where email is not null and btrim(email) <> ''`,
      );
      break;
    default:
      rows = [];
  }
  // Dedupe by lower(email), keeping the first occurrence.
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rows) {
    const email = (r.email || "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name: r.name ?? null, company_id: r.company_id ?? null });
  }
  return out;
}

function isValidSegment(s: unknown): s is Segment {
  return typeof s === "string" && (SEGMENTS as readonly string[]).includes(s);
}

const router = Router();
// Scope the admin guard to this router's own paths. A path-less router.use here
// would gate EVERY /api request (the router is mounted at "/"), which would 401
// healthz, login, and all other routes.
router.use("/admin/campaigns", requireAdmin);

// GET /admin/campaigns : list campaigns newest first.
router.get(
  "/admin/campaigns",
  h(async (_req, res) => {
    const campaigns = await q<CampaignRow>(
      `select * from email_campaigns order by created_at desc`,
    );
    res.json({ campaigns });
  }),
);

// POST /admin/campaigns : create a draft campaign.
router.post(
  "/admin/campaigns",
  h(async (req, res) => {
    const auth = getAuth(req);
    const { name, subject, bodyHtml, segment } = req.body ?? {};
    if (!name || typeof name !== "string")
      return res.status(400).json({ error: "name required" });
    if (!subject || typeof subject !== "string")
      return res.status(400).json({ error: "subject required" });
    const seg: Segment = isValidSegment(segment) ? segment : "all_companies";
    const campaign = await q1<CampaignRow>(
      `insert into email_campaigns (name, subject, body_html, segment, created_by)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [name, subject, typeof bodyHtml === "string" ? bodyHtml : "", seg, auth.email],
    );
    res.status(201).json({ campaign });
  }),
);

// GET /admin/campaigns/:id : a campaign + recipient counts by status.
router.get(
  "/admin/campaigns/:id",
  h(async (req, res) => {
    const campaign = await q1<CampaignRow>(`select * from email_campaigns where id = $1`, [
      req.params.id,
    ]);
    if (!campaign) return res.status(404).json({ error: "not found" });
    const counts = await q<{ status: string; count: string }>(
      `select status, count(*)::text as count
         from campaign_recipients
        where campaign_id = $1
        group by status`,
      [req.params.id],
    );
    const recipients = { pending: 0, sent: 0, failed: 0 } as Record<string, number>;
    for (const c of counts) recipients[c.status] = Number(c.count);
    res.json({ campaign, recipients });
  }),
);

// PATCH /admin/campaigns/:id : edit a draft (name/subject/bodyHtml/segment) or
// cancel it. Only drafts are editable; cancel is allowed from any pre-send state.
router.patch(
  "/admin/campaigns/:id",
  h(async (req, res) => {
    const campaign = await q1<CampaignRow>(`select * from email_campaigns where id = $1`, [
      req.params.id,
    ]);
    if (!campaign) return res.status(404).json({ error: "not found" });

    if (req.body?.status === "cancelled") {
      if (campaign.status === "sending" || campaign.status === "sent")
        return res.status(400).json({ error: "cannot cancel a campaign that is sending or sent" });
      const updated = await q1<CampaignRow>(
        `update email_campaigns set status = 'cancelled', updated_at = now() where id = $1 returning *`,
        [req.params.id],
      );
      return res.json({ campaign: updated });
    }

    if (campaign.status !== "draft" && campaign.status !== "test_sent")
      return res.status(400).json({ error: "only draft campaigns can be edited" });

    const { name, subject, bodyHtml, segment } = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (typeof name === "string") {
      sets.push(`name = $${i++}`);
      params.push(name);
    }
    if (typeof subject === "string") {
      sets.push(`subject = $${i++}`);
      params.push(subject);
    }
    if (typeof bodyHtml === "string") {
      sets.push(`body_html = $${i++}`);
      params.push(bodyHtml);
    }
    if (isValidSegment(segment)) {
      sets.push(`segment = $${i++}`);
      params.push(segment);
    }
    if (sets.length === 0) return res.json({ campaign });
    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    const updated = await q1<CampaignRow>(
      `update email_campaigns set ${sets.join(", ")} where id = $${i} returning *`,
      params,
    );
    res.json({ campaign: updated });
  }),
);

// POST /admin/campaigns/:id/test : send ONE test email to {to} or the admin's
// own email. Marks the campaign test_sent. Does NOT touch recipients.
router.post(
  "/admin/campaigns/:id/test",
  h(async (req, res) => {
    const auth = getAuth(req);
    const campaign = await q1<CampaignRow>(`select * from email_campaigns where id = $1`, [
      req.params.id,
    ]);
    if (!campaign) return res.status(404).json({ error: "not found" });
    if (campaign.status === "sending" || campaign.status === "sent")
      return res.status(400).json({ error: "campaign already sent" });
    if (campaign.status === "cancelled")
      return res.status(400).json({ error: "campaign is cancelled" });

    const to = (typeof req.body?.to === "string" && req.body.to.trim()) || auth.email;
    if (!to) return res.status(400).json({ error: "no test recipient (set { to } or an admin email)" });

    const footer = `<hr/><p style="font-size:12px;color:#7d776c">This is a TEST send of the "${escapeHtml(
      campaign.name,
    )}" campaign. No segment recipients were emailed. Approve and push from the admin console to broadcast.</p>`;
    const result = await sendEmail({
      to,
      subject: `[TEST] ${campaign.subject}`,
      html: (campaign.body_html || "") + footer,
    });

    const updated = await q1<CampaignRow>(
      `update email_campaigns
          set status = 'test_sent', test_sent_to = $2, test_sent_at = now(), updated_at = now()
        where id = $1
        returning *`,
      [req.params.id, to],
    );
    res.json({ sent: result.ok, skipped: result.skipped === true, to, campaign: updated });
  }),
);

// POST /admin/campaigns/:id/approve-and-send : THE GATE. Only allowed from
// status 'test_sent'. Resolves the segment, snapshots recipients, sets status
// 'sending', mails each recipient marking sent/failed, then finishes 'sent'.
router.post(
  "/admin/campaigns/:id/approve-and-send",
  h(async (req, res) => {
    const auth = getAuth(req);
    const campaign = await q1<CampaignRow>(`select * from email_campaigns where id = $1`, [
      req.params.id,
    ]);
    if (!campaign) return res.status(404).json({ error: "not found" });

    if (campaign.status === "sending" || campaign.status === "sent")
      return res.status(400).json({ error: "campaign already sending or sent" });
    if (campaign.status !== "test_sent")
      return res.status(400).json({ error: "send a test first" });

    const audience = await resolveSegment(campaign.segment);

    // Snapshot recipients and flip to 'sending' up front. This also guards
    // against a concurrent double send: only flip if still test_sent.
    const claimed = await q1<CampaignRow>(
      `update email_campaigns
          set status = 'sending', approved_by = $2, approved_at = now(),
              recipient_count = $3, sent_count = 0, failed_count = 0, updated_at = now()
        where id = $1 and status = 'test_sent'
        returning *`,
      [req.params.id, auth.email, audience.length],
    );
    if (!claimed) return res.status(400).json({ error: "campaign already sending or sent" });

    let sentCount = 0;
    let failedCount = 0;
    for (const r of audience) {
      let ok = false;
      let error: string | null = null;
      try {
        const result = await sendEmail({
          to: r.email,
          subject: campaign.subject,
          html: campaign.body_html || "",
        });
        ok = result.ok || result.skipped === true;
        if (!ok) error = result.error ?? "send failed";
      } catch (e) {
        ok = false;
        error = (e as Error).message;
      }
      if (ok) sentCount += 1;
      else failedCount += 1;
      await q(
        `insert into campaign_recipients (campaign_id, email, name, company_id, status, sent_at, error)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.params.id,
          r.email,
          r.name,
          r.company_id,
          ok ? "sent" : "failed",
          ok ? new Date().toISOString() : null,
          error,
        ],
      );
    }

    const finished = await q1<CampaignRow>(
      `update email_campaigns
          set status = 'sent', sent_count = $2, failed_count = $3, updated_at = now()
        where id = $1
        returning *`,
      [req.params.id, sentCount, failedCount],
    );
    res.json({
      campaign: finished,
      recipient_count: audience.length,
      sent_count: sentCount,
      failed_count: failedCount,
    });
  }),
);

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

export default router;
