# Divini Procure — Incident Response & Disaster Recovery Runbook

## Why This Matters

There was no dedicated incident-response document before this pass (ALFY2
Section 14) — deployment, backup, and refund procedures each had their own
runbook, but nothing tied them together into "something is broken, what do
I do." This runbook is that document. It does not introduce new
infrastructure; it's a map of what already exists (`backup.sh`, the
`/api/healthz` check, the correlation-ID logging added this pass, `pm2`,
the deploy/rollback steps in `23_DEPLOYMENT.md`) plus the decision tree for
using them under pressure.

**Known gap, not fixed by this document:** there is still no automated
error-monitoring/alerting service (Sentry or equivalent) wired in — see
`docs/platform-standard/risk-register.md` R-03. Today, detection is manual
(a user reports a problem, or an operator notices). This runbook assumes
that starting point; closing R-03 would shorten the detection step below
from "someone notices" to "an alert fires," but does not change anything
else in this document.

---

## 1. Severity Levels

| Level | Definition | Examples | Target response |
|---|---|---|---|
| **SEV1** | Site down, or data loss/corruption in progress | `/api/healthz` failing, database unreachable, an account-deletion or payout bug destroying data | Immediate — stop the bleeding first, root-cause after |
| **SEV2** | A core flow is broken for many users, but the site is otherwise up | Login broken, bid submission failing, Stripe webhooks erroring | Same-day |
| **SEV3** | A non-core feature is broken, or affects a small subset of users | One report page 500s, a single company's data looks wrong | Next business day |
| **SEV4** | Cosmetic, or a workaround exists | Copy typo, minor layout issue | Backlog |

---

## 2. Detection

Today, detection is manual (see the gap noted above). The signals available:

- **`GET /api/healthz`** — returns `{ok:true, db:"ok"}` when the process is
  up and can reach Postgres. Check this first, always. A `db` field other
  than `"ok"` means the app is up but the database connection is the
  problem — go straight to §5 (Database Incidents), not §4 (App Incidents).
- **Server logs** (`pm2 logs divini-procure` on the production host) —
  every unhandled error logs a structured JSON line:
  `[api error] {"correlationId":"...","method":"...","path":"...","message":"...","stack":"..."}`.
  As of this pass, that same `correlationId` is also returned to the client
  as the `X-Request-Id` response header on every request, and inside the
  JSON body (`requestId`) specifically for a generic 500 response. If a
  user reports "the app broke," ask for the request ID from their
  screenshot/network tab, or the approximate time — either lets you find
  the exact log line instead of guessing.
- **A user or support report** — still the most common way an issue is
  found today. Log it, get the request ID or timestamp, move to §4/§5.

---

## 3. First Response (any SEV1/SEV2)

1. **Confirm scope.** Hit `/api/healthz`. Check `pm2 status` on the server
   (is the process actually running, or did it crash and pm2 is mid-restart
   loop?). Check recent deploys — did this start right after a push?
2. **If it started right after a deploy: roll back first, investigate
   second.** Per `AI_PROJECT_OS/23_DEPLOYMENT.md`'s Rollback section:
   `pm2 stop divini-procure` (or `rsync` the previous code and restart).
   The first deploy runs no destructive migration, so rollback is safe by
   default; if the deploy included a schema change, check whether it was
   additive (safe to leave) before rolling the schema back too.
3. **If it's a suspected data-integrity issue (SEV1), stop writes before
   you stop reading logs.** `pm2 stop divini-procure` takes the app fully
   offline — better than letting a bug keep corrupting data while you
   investigate. Users see downtime instead of data loss; downtime is
   recoverable, corrupted data may not be.
4. **Communicate.** Even a one-line "we're aware, investigating" beats
   silence — see §7.

---

## 4. Application Incidents (process up, a specific flow broken)

1. Find the error in `pm2 logs divini-procure` using the correlation ID or
   timestamp from §2.
2. The stack trace + `path` + `method` in that log line tells you which
   route and which line. Reproduce locally against a copy of the schema if
   possible before pushing a fix to production.
3. Check `docs/platform-standard/risk-register.md` and `control-register.md`
   first — if this looks like a regression of something already
   found/fixed this engagement, the register entry will have the original
   failure mode, the fix, and how it was verified, which is usually faster
   than re-deriving it from the stack trace alone.
4. Ship the fix through the normal deploy path (`23_DEPLOYMENT.md`), then
   re-verify the specific broken flow live, not just that the process
   restarted cleanly.

---

## 5. Database Incidents (data loss, corruption, or the DB itself is down)

1. **The DB process itself is down / unreachable:** this is infrastructure,
   not application code — check the Docker container
   (`docker ps`, `docker logs divini_procure_db`) on the server per
   `23_DEPLOYMENT.md`'s topology (`Docker Postgres divini_procure_db`).
2. **Data was corrupted or wrongly deleted by a bug, not infrastructure
   failure:** this is what `backup.sh` (repo root) exists for — see
   `AI_PROJECT_OS/23_DEPLOYMENT.md`'s "Backups & recovery" section for the
   restore command:
   ```bash
   docker exec -i divini_procure_db pg_restore -U aibos -d divini_procure --clean --if-exists \
     < /root/backups/divini-procure/divini_procure_<timestamp>.dump
   ```
   `--clean --if-exists` makes this safe to run against a database that
   already has (corrupted) data in it. **Restoring loses everything written
   since that backup** — for anything less than "the data is actively
   wrong and getting worse," prefer a targeted fix (delete/correct the
   specific bad rows) over a full restore, since the nightly backup cadence
   (`OA-14`) means a full restore can lose up to 24 hours of real activity.
3. **No backup exists yet, or the backup role isn't RLS-exempt** (see
   `backup.sh`'s own header comment and `OA-14`) - if you hit this during a
   real incident, you have no restore path. Treat closing `OA-14` as a
   standing SEV2 until it's done, independent of whether an actual incident
   ever happens.

---

## 6. Payment Incidents (Stripe)

- **Suspected double-charge or a payout that may have gone out twice:**
  check `payout_instructions.status` and `stripe_transfer_id` for the
  instruction in question, and cross-reference against the actual Stripe
  Dashboard transfer list for that Connect account. The release-claim race
  condition and missing idempotency key that could have caused this class
  of bug were fixed this pass (`docs/platform-standard/risk-register.md`
  R-26) - if you're reading this after that fix shipped and still see a
  duplicate, it's a new bug, not the old one recurring.
- **Refunds:** use `docs/runbook-stripe-refunds.md` - refunds are
  deliberately manual (Stripe Dashboard), not an in-app action.
- **Webhook processing looks stuck or duplicated:** check
  `stripe_webhook_events` for the event id in question (added this pass,
  R-27) - if the id is already present, the event was already processed
  and correctly skipped; if webhooks aren't arriving at all, check the
  endpoint URL and signing secret configured in the Stripe Dashboard
  against `STRIPE_WEBHOOK_SECRET`.

---

## 7. Communication

- **Internal:** log what happened, when, and the fix, even briefly - future
  incidents (or this same one recurring) go faster with a paper trail.
  Consider adding a genuinely novel failure mode to
  `docs/platform-standard/risk-register.md` if it reveals a gap this
  engagement didn't already catch.
- **External (users):** for a SEV1/SEV2 affecting multiple users, a short
  status update costs little and prevents a flood of duplicate support
  tickets. There is no status-page infrastructure today - for now this
  means a direct email via the existing `sendEmail` capability
  (`server/src/lib/email.ts`) or a support-inbox reply, not an automated
  system.

---

## 8. Post-Incident

1. Confirm the fix is actually deployed and verified live (not just that
   the code was pushed) - `/api/healthz`, then the specific flow that broke.
2. Write down the root cause and the fix, even briefly.
3. Ask: would this have been caught earlier with automated error monitoring
   (R-03) or automated test coverage? If yes, that's a concrete argument for
   prioritizing whichever gap would have caught it, not just a general
   reminder that gaps exist.
