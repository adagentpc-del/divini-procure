/**
 * Job handler registrations. Imported once for its side effect (calling
 * registerJobHandler) - see server/src/index.ts.
 *
 * Zero em dashes by convention.
 */
import { registerJobHandler } from "../lib/jobs.js";
import { sendEmail } from "../lib/email.js";

interface SendEmailPayload {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

registerJobHandler("send_email", async (payload) => {
  const { to, subject, text, html } = payload as unknown as SendEmailPayload;
  const result = await sendEmail({ to, subject, text, html });
  // sendEmail() itself never throws - it reports failure via { ok: false }.
  // A skipped send (EMAIL_PROVIDER not configured) is a deliberate no-op,
  // not a failure, and must not be retried. An actual provider failure
  // (ok: false, skipped: false/undefined) IS retryable, so it must throw
  // here for processDueJobs()'s retry/backoff logic to apply.
  if (!result.ok && !result.skipped) {
    throw new Error(result.error || "email send failed");
  }
});
