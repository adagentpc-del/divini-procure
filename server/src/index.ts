import app from "./app.js";
import { PORT } from "./config.js";
import { processDueFollowUps } from "./routes/follow-up.js";
import { publishDueScheduledPackages } from "./routes/marketplace-publication.js";

app.listen(PORT, () => {
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
