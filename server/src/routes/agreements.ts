/**
 * Divini Procure - AGREEMENTS + native e-signature routes.
 *
 * Mounted under /api in routes.ts, so full paths are /api/agreements/... and
 * /api/admin/agreements / /api/admin/agreement-templates.
 *
 * Member endpoints (requireUser, scoped by company membership):
 *   GET   /agreements/templates                    built-in + db templates
 *   POST  /agreements                              create from template or file_url (draft)
 *   GET   /agreements?companyId=                    party view (member of company)
 *   GET   /agreements/:id                           party member or admin; marks viewed
 *   POST  /agreements/:id/send                      -> sent; email counterparty a link
 *   POST  /agreements/:id/sign                      -> record signature; -> signed
 *   PATCH /agreements/:id                           party/admin: status / file_url
 *
 * Admin endpoints (requireAdmin):
 *   POST  /admin/agreement-templates               upsert a custom template
 *   GET   /admin/agreements                         all agreements
 *
 * This records the agreement lifecycle; it never moves money and never exposes
 * one company's agreements to another. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError, userCompanyIds } from "../db.js";
import { q, q1 } from "../pool.js";
import { sendEmail } from "../lib/email.js";
import { PUBLIC_APP_URL } from "../config.js";
import {
  BUILTIN_TEMPLATES,
  getBuiltinTemplate,
  fillPlaceholders,
} from "../lib/agreement-templates.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const ALLOWED_STATUS = [
  "draft",
  "sent",
  "viewed",
  "signed",
  "needs_revision",
  "expired",
  "cancelled",
] as const;

function clientIp(req: Request): string | null {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null
  );
}

/** Verify the signed-in user is a member of the given company, else throw. */
async function assertMember(userId: string, companyId: string): Promise<void> {
  const ok = await q1<{ ok: number }>(
    "select 1 as ok from company_members where user_id=$1 and company_id=$2",
    [userId, companyId],
  );
  if (!ok) throw new ForbiddenError("not a member of this company");
}

/** Look up a company name (best effort). */
async function companyName(companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  const row = await q1<{ name: string }>("select name from companies where id=$1", [companyId]);
  return row?.name ?? null;
}

async function projectName(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const row = await q1<{ name: string }>("select name from buildings where id=$1", [projectId]);
  return row?.name ?? null;
}

// ---------------------------------------------------------------------------
// Templates: built-in (code) merged with custom (db). DB keys win on collision.
// ---------------------------------------------------------------------------
router.get(
  "/agreements/templates",
  requireUser,
  h(async (_req, res) => {
    const custom = await q<{
      key: string;
      name: string;
      kind: string | null;
      body: string | null;
    }>("select key, name, kind, body from agreement_templates order by name asc");
    const customKeys = new Set(custom.map((c) => c.key));
    const builtin = BUILTIN_TEMPLATES.filter((t) => !customKeys.has(t.key)).map((t) => ({
      key: t.key,
      name: t.name,
      kind: t.kind,
      body: t.body,
      source: "builtin" as const,
    }));
    const customOut = custom.map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      body: c.body,
      source: "custom" as const,
    }));
    res.json({ templates: [...customOut, ...builtin] });
  }),
);

// Admin: upsert a custom template (overrides a built-in key when matched).
router.post(
  "/admin/agreement-templates",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof b.key === "string" ? b.key.trim() : "";
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const kind = typeof b.kind === "string" ? b.kind.trim() : null;
    const body = typeof b.body === "string" ? b.body : null;
    if (!key) return res.status(400).json({ error: "key required" });
    if (!name) return res.status(400).json({ error: "name required" });

    const rows = await q(
      `insert into agreement_templates (key, name, kind, body, created_by)
         values ($1,$2,$3,$4,$5)
       on conflict (key) do update
         set name = excluded.name, kind = excluded.kind, body = excluded.body
       returning *`,
      [key, name, kind, body, auth.email ?? null],
    );
    res.json({ template: rows[0] });
  }),
);

// ---------------------------------------------------------------------------
// Create an agreement (draft). Either from a template (rendered) or a file_url.
// The caller must be a member of party_company_id, OR an admin.
// ---------------------------------------------------------------------------
router.post(
  "/agreements",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const partyCompanyId =
      typeof b.partyCompanyId === "string" && b.partyCompanyId.trim() ? b.partyCompanyId.trim() : null;
    if (!partyCompanyId) return res.status(400).json({ error: "partyCompanyId required" });
    if (!auth.isAdmin) await assertMember(auth.userId!, partyCompanyId);

    const counterpartyEmail =
      typeof b.counterpartyEmail === "string" && b.counterpartyEmail.trim()
        ? b.counterpartyEmail.trim()
        : null;
    const projectId =
      typeof b.projectId === "string" && b.projectId.trim() ? b.projectId.trim() : null;
    const relationshipId =
      typeof b.relationshipId === "string" && b.relationshipId.trim() ? b.relationshipId.trim() : null;
    const fileUrl = typeof b.fileUrl === "string" && b.fileUrl.trim() ? b.fileUrl.trim() : null;
    const templateKey =
      typeof b.templateKey === "string" && b.templateKey.trim() ? b.templateKey.trim() : null;

    // Resolve party + counterparty + project names for placeholder rendering.
    const partyName = await companyName(partyCompanyId);
    const projName = await projectName(projectId);

    // Build vars. We do not assume which side is developer vs vendor; if a
    // counterparty company id is supplied as developerCompanyId/vendorCompanyId
    // we use them, else we fall back to the party name and counterparty email.
    const developerName =
      (typeof b.developerName === "string" && b.developerName.trim()) || partyName || "";
    const vendorName =
      (typeof b.vendorName === "string" && b.vendorName.trim()) || counterpartyEmail || "";

    const vars: Record<string, string> = {
      party_name: partyName ?? "",
      developer_name: developerName,
      vendor_name: vendorName,
      project_name: projName ?? "",
      counterparty: counterpartyEmail ?? "",
      date: new Date().toISOString().slice(0, 10),
    };

    // Resolve body + title + kind from template (db override wins) or explicit body.
    let body = typeof b.body === "string" && b.body.trim() ? b.body : null;
    let title = typeof b.title === "string" && b.title.trim() ? b.title.trim() : "";
    let kind = typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : null;

    if (templateKey && !body) {
      const dbTpl = await q1<{ name: string; kind: string | null; body: string | null }>(
        "select name, kind, body from agreement_templates where key=$1",
        [templateKey],
      );
      const builtin = getBuiltinTemplate(templateKey);
      const srcBody = dbTpl?.body ?? builtin?.body ?? null;
      const srcName = dbTpl?.name ?? builtin?.name ?? null;
      const srcKind = dbTpl?.kind ?? builtin?.kind ?? null;
      if (srcBody) body = fillPlaceholders(srcBody, vars);
      if (!title && srcName) title = srcName;
      if (!kind) kind = srcKind;
    }

    if (!title) return res.status(400).json({ error: "title required" });
    if (!body && !fileUrl)
      return res.status(400).json({ error: "templateKey, body, or fileUrl required" });

    const rows = await q(
      `insert into agreements
         (template_key, title, kind, party_company_id, counterparty_email,
          project_id, relationship_id, body, file_url, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10)
       returning *`,
      [
        templateKey,
        title,
        kind,
        partyCompanyId,
        counterpartyEmail,
        projectId,
        relationshipId,
        body,
        fileUrl,
        auth.email ?? null,
      ],
    );
    res.json({ agreement: rows[0] });
  }),
);

// ---------------------------------------------------------------------------
// Party view: agreements for one of the caller's companies.
// ---------------------------------------------------------------------------
router.get(
  "/agreements",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId =
      typeof req.query.companyId === "string" && req.query.companyId.trim()
        ? req.query.companyId.trim()
        : null;
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    if (!auth.isAdmin) await assertMember(auth.userId!, companyId);

    const rows = await q(
      `select * from agreements where party_company_id=$1 order by created_at desc`,
      [companyId],
    );
    res.json({ agreements: rows });
  }),
);

// Admin: all agreements.
router.get(
  "/admin/agreements",
  requireAdmin,
  h(async (_req, res) => {
    const rows = await q(
      `select a.*,
              c.name as party_company_name,
              b.name as project_name,
              (select count(*) from agreement_signatures s where s.agreement_id = a.id) as signature_count
         from agreements a
         left join companies c on c.id = a.party_company_id
         left join buildings b on b.id = a.project_id
        order by a.created_at desc`,
    );
    res.json({ agreements: rows });
  }),
);

// ---------------------------------------------------------------------------
// Single agreement. A party member or an admin may view. If a party member
// (not admin) views and it is in 'sent' status, mark it viewed.
// ---------------------------------------------------------------------------
router.get(
  "/agreements/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ag = await q1<Record<string, any>>("select * from agreements where id=$1", [
      req.params.id,
    ]);
    if (!ag) throw new NotFoundError("agreement not found");

    let isParty = false;
    if (auth.isAdmin) {
      isParty = false; // admin allowed regardless; do not auto-mark viewed
    } else {
      const ids = await userCompanyIds(auth.userId!);
      isParty = !!ag.party_company_id && ids.includes(ag.party_company_id);
      if (!isParty) throw new ForbiddenError("not a party to this agreement");
    }

    if (isParty && ag.status === "sent") {
      const upd = await q1<Record<string, any>>(
        `update agreements set status='viewed', viewed_at=now(), updated_at=now()
           where id=$1 returning *`,
        [req.params.id],
      );
      if (upd) Object.assign(ag, upd);
    }

    const signatures = await q(
      "select * from agreement_signatures where agreement_id=$1 order by signed_at asc",
      [req.params.id],
    );
    res.json({ agreement: ag, signatures });
  }),
);

// ---------------------------------------------------------------------------
// Send: party member or admin. Marks sent and emails the counterparty a link.
// ---------------------------------------------------------------------------
router.post(
  "/agreements/:id/send",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ag = await q1<Record<string, any>>("select * from agreements where id=$1", [
      req.params.id,
    ]);
    if (!ag) throw new NotFoundError("agreement not found");
    if (!auth.isAdmin) await assertMember(auth.userId!, ag.party_company_id);

    const b = (req.body ?? {}) as Record<string, unknown>;
    const toEmail =
      (typeof b.counterpartyEmail === "string" && b.counterpartyEmail.trim()) ||
      (ag.counterparty_email as string | null);
    if (!toEmail) return res.status(400).json({ error: "counterparty email required to send" });

    const rows = await q(
      `update agreements
          set status='sent', sent_at=now(), updated_at=now(),
              counterparty_email = coalesce($2, counterparty_email)
        where id=$1
        returning *`,
      [req.params.id, typeof b.counterpartyEmail === "string" ? b.counterpartyEmail.trim() : null],
    );

    const link = `${PUBLIC_APP_URL || ""}/agreements`;
    await sendEmail({
      to: toEmail,
      subject: `Agreement to review and sign: ${ag.title}`,
      html: `<p>You have an agreement to review and sign on Divini Procure: <strong>${
        String(ag.title).replace(/[<>&]/g, "")
      }</strong>.</p>
<p>Sign in to Divini Procure to review and sign it${
        link ? `: <a href="${link}">${link}</a>` : "."
      }</p>
<p>If you do not have an account yet, register with this email address to access the agreement.</p>`,
    });

    res.json({ agreement: rows[0] });
  }),
);

// ---------------------------------------------------------------------------
// Sign: any signed-in user (the counterparty). Captures the typed signature,
// signer identity, IP and user-agent, then marks the agreement signed.
// ---------------------------------------------------------------------------
router.post(
  "/agreements/:id/sign",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ag = await q1<Record<string, any>>("select * from agreements where id=$1", [
      req.params.id,
    ]);
    if (!ag) throw new NotFoundError("agreement not found");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const signerName = typeof b.signerName === "string" ? b.signerName.trim() : "";
    const signatureText = typeof b.signatureText === "string" ? b.signatureText.trim() : "";
    const signerEmail =
      (typeof b.signerEmail === "string" && b.signerEmail.trim()) || auth.email || null;
    const affirm = b.affirm === true || b.affirm === "true";
    if (!signerName) return res.status(400).json({ error: "signerName required" });
    if (!signatureText) return res.status(400).json({ error: "signatureText required" });
    if (!affirm) return res.status(400).json({ error: "affirmation required" });

    const signerCompanyId =
      typeof b.signerCompanyId === "string" && b.signerCompanyId.trim()
        ? b.signerCompanyId.trim()
        : null;
    const ip = clientIp(req);
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    const audit = {
      user_id: auth.userId,
      affirmed: true,
      agreement_title: ag.title,
      signed_via: "native",
      at: new Date().toISOString(),
    };

    const sig = await q(
      `insert into agreement_signatures
         (agreement_id, signer_name, signer_email, signer_company_id,
          signature_text, ip, user_agent, audit)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        req.params.id,
        signerName,
        signerEmail,
        signerCompanyId,
        signatureText,
        ip,
        userAgent,
        JSON.stringify(audit),
      ],
    );

    const rows = await q(
      `update agreements set status='signed', signed_at=now(), updated_at=now()
         where id=$1 returning *`,
      [req.params.id],
    );

    res.json({ agreement: rows[0], signature: sig[0] });
  }),
);

// ---------------------------------------------------------------------------
// Patch: party member or admin. Update status (to a safe lifecycle value) and
// or file_url. Never exposes or mutates another company's agreement.
// ---------------------------------------------------------------------------
router.patch(
  "/agreements/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const ag = await q1<Record<string, any>>("select * from agreements where id=$1", [
      req.params.id,
    ]);
    if (!ag) throw new NotFoundError("agreement not found");
    if (!auth.isAdmin) await assertMember(auth.userId!, ag.party_company_id);

    const b = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const add = (col: string, val: any) => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (typeof b.status === "string") {
      const s = b.status.trim();
      // Party/admin may only move to these lifecycle states here.
      const settable = ["needs_revision", "cancelled", "expired", "draft", "sent"];
      if (!settable.includes(s) || !ALLOWED_STATUS.includes(s as any)) {
        return res.status(400).json({ error: "invalid status" });
      }
      add("status", s);
    }
    if (typeof b.fileUrl === "string") add("file_url", b.fileUrl.trim() || null);

    if (sets.length === 0) return res.status(400).json({ error: "nothing to update" });

    params.push(req.params.id);
    const rows = await q(
      `update agreements set ${sets.join(", ")}, updated_at=now()
         where id=$${i} returning *`,
      params,
    );
    res.json({ agreement: rows[0] });
  }),
);

export default router;
