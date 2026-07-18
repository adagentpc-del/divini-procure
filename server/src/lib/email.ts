/**
 * Email transport for Divini Procure. Provider-guarded HTTP send (no SMTP
 * dependency), ported from Divini Partners' lib/email.ts and trimmed to the
 * Resend provider that Procure uses.
 *
 * Feature-flagged: when EMAIL_PROVIDER !== "resend" or EMAIL_API_KEY is unset,
 * emailEnabled() is false and sendEmail() logs and returns { ok:false,
 * skipped:true } (it never throws), so every call site works in every
 * environment. The return shape mirrors Partners: { ok, skipped?, id?, error? }.
 *
 * Zero em dashes by convention.
 */
import {
  EMAIL_PROVIDER,
  EMAIL_API_KEY,
  EMAIL_FROM,
  emailEnabled,
} from "../config.js";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  /** Optional extra RFC headers (e.g. List-Unsubscribe for bulk/campaign mail). */
  headers?: Record<string, string>;
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

function recipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map((s) => s.trim()).filter(Boolean);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** Minimal, brand-consistent HTML wrapper when only text is supplied. */
function wrapHtml(subject: string, text: string): string {
  const body = text
    .split("\n")
    .map((line) =>
      line.trim() === ""
        ? "<br/>"
        : `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`,
    )
    .join("");
  // CAN-SPAM Act compliance: every commercial email must include the sender's
  // physical postal address. 15 U.S.C. 7704(a)(5)(A)(iii).
  return `<div style="font-family:Inter,Arial,sans-serif;color:#2c2a26;max-width:560px;margin:0 auto;padding:24px">
  <div style="font-family:Georgia,serif;font-size:22px;color:#123c2e;font-weight:700;margin-bottom:16px">Divini Procure</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:#123c2e;font-weight:600;margin:0 0 14px">${escapeHtml(subject)}</h1>
  ${body}
  <div style="margin-top:22px;border-top:1px solid #e7e1d6;padding-top:14px;font-size:12px;color:#7d776c">
    Divini Procure by Divini Group &bull; Miami, FL &bull; support@diviniprocure.com<br/>
    You are receiving this email because you have an account on Divini Procure.
    To unsubscribe from non-transactional emails, reply with "Unsubscribe" in the subject line.
  </div>
</div>`;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const to = recipients(msg.to);
  if (to.length === 0) return { ok: false, error: "no recipients" };
  if (!emailEnabled()) {
    // eslint-disable-next-line no-console
    console.log(`[email:disabled] to=${to.join(", ")} subject="${msg.subject}"`);
    return { ok: false, skipped: true };
  }
  const html = msg.html || wrapHtml(msg.subject, msg.text || msg.subject);
  const text = msg.text || msg.subject;
  try {
    if (EMAIL_PROVIDER === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EMAIL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to,
          subject: msg.subject,
          html,
          text,
          reply_to: msg.replyTo,
          // Resend accepts arbitrary headers via the `headers` key.
          ...(msg.headers && Object.keys(msg.headers).length > 0
            ? { headers: msg.headers }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: String((json.message as string) ?? res.status) };
      return { ok: true, id: String((json.id as string) ?? "") };
    }
    return { ok: false, error: `unknown EMAIL_PROVIDER: ${EMAIL_PROVIDER}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { emailEnabled };
