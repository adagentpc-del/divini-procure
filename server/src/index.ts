import app from "./app.js";
import { PORT } from "./config.js";
import { processDueFollowUps } from "./routes/follow-up.js";

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
