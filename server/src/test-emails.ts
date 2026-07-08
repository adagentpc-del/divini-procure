/**
 * Email test harness CLI for Divini Procure.
 *
 * Sends ONE sample of each Procure email type to a target address using the real
 * email transport (lib/email.ts), so the owner can run it on the deployed server
 * and confirm receipt of each. Run with:
 *
 *   node server/dist/test-emails.js someone@example.com
 *
 * Real delivery requires EMAIL_PROVIDER=resend + EMAIL_API_KEY in the
 * environment (source .env.local first). Without them, emailEnabled() is false:
 * every type reports SKIPPED (logged) and nothing is actually transmitted. This
 * still proves the wiring end to end.
 *
 * The pool is closed at the end so the process exits cleanly (send is
 * independent of Postgres; the close just keeps teardown tidy).
 *
 * Login / password reset are handled by Authentik (OIDC), not Divini email, so
 * they are intentionally not in this suite.
 *
 * ZERO em dashes in this file (hard rule). ESM .js imports.
 */
import { pathToFileURL } from "node:url";
import { sendEmail, emailEnabled } from "./lib/email.js";
import { PUBLIC_APP_URL } from "./config.js";
import { pool } from "./pool.js";

type Outcome = "ok" | "skipped" | "error";

export interface SuiteRow {
  label: string;
  subject: string;
  outcome: Outcome;
  detail?: string;
}

/** Map a sendEmail result into a normalized suite outcome. */
function classify(res: { ok: boolean; skipped?: boolean; error?: string; id?: string }): {
  outcome: Outcome;
  detail?: string;
} {
  if (res.skipped) return { outcome: "skipped", detail: "logged, not sent" };
  if (res.ok) return { outcome: "ok", detail: res.id ? `id=${res.id}` : undefined };
  return { outcome: "error", detail: res.error ?? "unknown error" };
}

function base(): string {
  return PUBLIC_APP_URL || "https://diviniprocure.com";
}

/** Run every Procure email type once to `target`, collecting one row per type. */
export async function runEmailSuite(target: string): Promise<SuiteRow[]> {
  const rows: SuiteRow[] = [];

  async function viaSend(
    label: string,
    subject: string,
    msg: Parameters<typeof sendEmail>[0],
  ): Promise<void> {
    try {
      const res = await sendEmail(msg);
      const c = classify(res);
      rows.push({ label, subject, outcome: c.outcome, detail: c.detail });
    } catch (e) {
      rows.push({ label, subject, outcome: "error", detail: (e as Error).message });
    }
  }

  // 1. Invite (claim link -> /join/:code)
  const inviteLink = `${base()}/join/SAMPLE-INVITE`;
  await viaSend("Invite", "You are invited to Divini Procure", {
    to: target,
    subject: "You are invited to Divini Procure",
    text: [
      "You have been invited to join Divini Procure by Divini Group.",
      "Accept your invitation and set up your account using the link below.",
      `Accept invitation: ${inviteLink}`,
    ].join("\n\n"),
  });

  // 2. Referral partner (referral link -> /r/:code)
  const referralLink = `${base()}/r/SAMPLE-REF`;
  await viaSend("Referral partner", "Your Divini Procure referral link", {
    to: target,
    subject: "Your Divini Procure referral link",
    text: [
      "Hi Sample Partner,",
      "You are set up as a referral partner for Divini Procure. Share the link below; anyone who signs up through it is attributed to you.",
      `Your referral link: ${referralLink}`,
    ].join("\n\n"),
  });

  return rows;
}

/** Render a clean fixed-width table of the suite results. */
function renderTable(rows: SuiteRow[]): string {
  const head = { label: "EMAIL TYPE", subject: "SUBJECT", outcome: "RESULT", detail: "DETAIL" };
  const all = [head, ...rows.map((r) => ({ ...r, outcome: r.outcome.toUpperCase() }))];
  const w = (key: keyof typeof head) =>
    Math.max(...all.map((r) => String((r as Record<string, string>)[key] ?? "").length));
  const wl = w("label");
  const ws = w("subject");
  const wo = w("outcome");
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  const line = (r: { label: string; subject: string; outcome: string; detail?: string }) =>
    `  ${pad(r.label, wl)}  ${pad(r.subject, ws)}  ${pad(r.outcome, wo)}  ${r.detail ?? ""}`.trimEnd();
  const sep = `  ${"-".repeat(wl)}  ${"-".repeat(ws)}  ${"-".repeat(wo)}  ${"-".repeat(6)}`;
  const out: string[] = [];
  out.push(line(head));
  out.push(sep);
  for (const r of rows) {
    out.push(line({ label: r.label, subject: r.subject, outcome: r.outcome.toUpperCase(), detail: r.detail }));
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const target = process.argv[2] || process.env.TEST_EMAIL || "adagentpc@gmail.com";

  // eslint-disable-next-line no-console
  console.log(`\nDivini Procure email test harness`);
  // eslint-disable-next-line no-console
  console.log(`Target recipient: ${target}\n`);

  if (!emailEnabled()) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "================================================================",
        " EMAIL IS DISABLED",
        " EMAIL_PROVIDER and/or EMAIL_API_KEY are not set in this",
        " environment. Every type below will report SKIPPED (logged) and",
        " NOTHING is actually sent. This still proves the wiring. Set the",
        " env vars (source .env.local) to send for real.",
        "================================================================",
      ].join("\n") + "\n",
    );
  } else {
    // eslint-disable-next-line no-console
    console.log("Email is ENABLED. Sending one sample of each type for real.\n");
  }

  const rows = await runEmailSuite(target);

  // eslint-disable-next-line no-console
  console.log(renderTable(rows) + "\n");

  const ok = rows.filter((r) => r.outcome === "ok").length;
  const skipped = rows.filter((r) => r.outcome === "skipped").length;
  const errored = rows.filter((r) => r.outcome === "error").length;
  // eslint-disable-next-line no-console
  console.log(`Totals: ${ok} sent, ${skipped} skipped, ${errored} error(s), ${rows.length} types.\n`);

  // eslint-disable-next-line no-console
  console.log(
    "Note: login and password reset are handled by Authentik (OIDC), not by\nDivini Procure email, so they are intentionally not in this suite.\n",
  );

  await pool.end().catch(() => null);
  // Skipped is expected when email is disabled and is NOT a failure.
  process.exit(errored > 0 ? 1 : 0);
}

// Only run when executed DIRECTLY (the CLI), never when imported as a module.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(`[test-emails] run failed: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await pool.end();
    } catch {
      // ignore pool teardown errors on a failing exit
    }
    process.exit(1);
  });
}
