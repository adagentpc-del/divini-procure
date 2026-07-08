/**
 * Standalone email delivery check for Divini Procure.
 *
 * Sends ONE test email through the real transport (lib/email.ts) so the owner
 * can confirm that EMAIL_PROVIDER / EMAIL_API_KEY / EMAIL_FROM are configured
 * correctly and that mail actually arrives. Run after building:
 *
 *   node server/dist/scripts/send-test-email.js you@example.com
 *
 * or with ts-node / tsx in dev. The recipient may also be supplied via the
 * TEST_EMAIL env var; it defaults to the project owner address.
 *
 * Real delivery requires EMAIL_PROVIDER=resend + EMAIL_API_KEY in the
 * environment (source .env.local first). Without them emailEnabled() is false:
 * the send reports SKIPPED (logged) and nothing is transmitted, which still
 * proves the wiring is intact end to end.
 *
 * This script does NOT touch the database or routes; it only exercises the
 * email transport. ZERO em dashes (hard rule). ESM .js imports.
 */
import { pathToFileURL } from "node:url";
import { sendEmail, emailEnabled } from "../lib/email.js";
import { EMAIL_FROM, EMAIL_PROVIDER, PUBLIC_APP_URL } from "../config.js";

function base(): string {
  return PUBLIC_APP_URL || "https://diviniprocure.com";
}

export async function sendTestEmail(target: string): Promise<number> {
  // eslint-disable-next-line no-console
  console.log(`\nDivini Procure email delivery test`);
  // eslint-disable-next-line no-console
  console.log(`Provider: ${EMAIL_PROVIDER || "(unset)"}`);
  // eslint-disable-next-line no-console
  console.log(`From:     ${EMAIL_FROM}`);
  // eslint-disable-next-line no-console
  console.log(`To:       ${target}\n`);

  if (!emailEnabled()) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "================================================================",
        " EMAIL IS DISABLED",
        " EMAIL_PROVIDER and/or EMAIL_API_KEY are not set in this",
        " environment. The send below reports SKIPPED (logged) and",
        " NOTHING is actually sent. Set EMAIL_PROVIDER=resend and",
        " EMAIL_API_KEY (source .env.local) to send for real.",
        "================================================================",
      ].join("\n") + "\n",
    );
  }

  const subject = "Divini Procure email delivery test";
  const res = await sendEmail({
    to: target,
    subject,
    text: [
      "This is a test message from Divini Procure.",
      "If you received it, outbound email is configured correctly and the",
      "register -> verify -> login flow can deliver verification mail.",
      `App: ${base()}`,
    ].join("\n\n"),
  });

  if (res.skipped) {
    // eslint-disable-next-line no-console
    console.log("Result: SKIPPED (logged, not sent). Email is disabled.\n");
    return 0; // expected when disabled; not a failure
  }
  if (res.ok) {
    // eslint-disable-next-line no-console
    console.log(`Result: SENT${res.id ? ` (id=${res.id})` : ""}. Check the inbox.\n`);
    return 0;
  }
  // eslint-disable-next-line no-console
  console.error(`Result: ERROR. ${res.error ?? "unknown error"}\n`);
  return 1;
}

async function main(): Promise<void> {
  const target = process.argv[2] || process.env.TEST_EMAIL || "adagentpc@gmail.com";
  const code = await sendTestEmail(target);
  process.exit(code);
}

// Only run when executed DIRECTLY (the CLI), never when imported as a module.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[send-test-email] run failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
