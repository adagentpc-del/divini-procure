import app from "./app.js";
import { PORT, DATABASE_URL, IS_PROD } from "./config.js";
import { processDueFollowUps } from "./routes/follow-up.js";
import { publishDueScheduledPackages } from "./routes/marketplace-publication.js";
import { purgeExpiredSessions } from "./db.js";

// Environment identity guard (ALFY2 Section 03): log which environment and
// which database HOST/NAME this process bound to at startup - never the
// credentials. This is the cheapest possible check against "staging silently
// pointed at production" - an operator tailing deploy logs sees it
// immediately instead of discovering it later from live data changing.
function logEnvironmentIdentity(): void {
  let dbHost = "(unset)";
  let dbName = "(unset)";
  try {
    if (DATABASE_URL) {
      const u = new URL(DATABASE_URL);
      dbHost = u.hostname || "(unparseable)";
      dbName = u.pathname.replace(/^\//, "") || "(unparseable)";
    }
  } catch {
    dbHost = "(unparseable)";
    dbName = "(unparseable)";
  }
  // eslint-disable-next-line no-console
  console.log(
    `[divini-procure] environment=${IS_PROD ? "production" : "development"} db_host=${dbHost} db_name=${dbName}`,
  );
}

app.listen(PORT, () => {
  logEnvironmentIdentity();
  // eslint-disable-next-line no-console
  console.log(`[divini-procure] server listening on :${PORT}`);
});

// Divini Follow-Up Desk: this is a persistent Node process (not serverless),
// so an in-process interval is a real, working scheduler with no external
// cron dependency. Runs every 15 minutes; also triggerable on demand via
// POST /api/follow-up/process-due (admin) for testing or an external cron.
const FOLLOW_UP_INTERVAL_MS = 15 * 60_000;
setInterval(() => {
  processDueFollowUps().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[follow-up] processDueFollowUps failed", e);
  });
}, FOLLOW_UP_INTERVAL_MS);

// Marketplace publication scheduling: same in-process interval pattern, no
// external cron dependency. Runs every 5 minutes so a scheduled publish_at
// goes live reasonably promptly.
const MARKETPLACE_PUBLISH_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  publishDueScheduledPackages().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[marketplace-publication] publishDueScheduledPackages failed", e);
  });
}, MARKETPLACE_PUBLISH_INTERVAL_MS);

// Session retention (ALFY2 Section 06 / R-08): purge user_sessions rows past
// their expires_at. Previously this function existed (db.ts's
// purgeExpiredSessions) but nothing ever called it - expired-but-undeleted
// rows accumulated forever, and a stale row sitting past its TTL is a
// larger blast radius if the sessions table were ever exposed by a future
// bug (data-retention-matrix.md's own gap #1). Same in-process interval
// pattern as the two jobs above, no external cron dependency. Hourly is
// far more than sufficient given the 30-day session TTL - this is
// housekeeping, not a real-time requirement.
const SESSION_PURGE_INTERVAL_MS = 60 * 60_000;
setInterval(() => {
  purgeExpiredSessions().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[sessions] purgeExpiredSessions failed", e);
  });
}, SESSION_PURGE_INTERVAL_MS);
