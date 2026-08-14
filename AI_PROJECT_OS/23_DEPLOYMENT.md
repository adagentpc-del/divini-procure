# 23 Deployment

Authoritative runbooks in the repo: `FIRST-DEPLOY-RUNBOOK.md` (first time) and
`DEPLOY.md` (repeat loop). The consolidated cross-app path is
`Divini-Go-Live-Runbook.md` in the workspace. This file summarizes; follow the
runbooks for exact commands.

> **Golden rule:** `rsync` runs in the **MAC terminal**; `deploy.sh` and `psql`
> run in the **SERVER web console**. Mixing them is the recurring "didn't update"
> bug. **Never sync `.env.local`.** Space out SSH to avoid fail2ban throttling.

## Topology

Caddy (TLS) -> pm2 Node process `divini-procure` (Express API + SPA, one process)
-> Docker Postgres `divini_procure_db`. Target host diviniprocure.com on the
droplet. The local Docker Postgres listens on `:5432` inside the container.

## First deploy (summary of FIRST-DEPLOY-RUNBOOK.md)

1. **Pre-flight:** server + SPA `tsc` green; DNS A record ready; Docker Postgres
   `divini_procure_db` exists; Caddy block prepared; pm2 installed.
2. **Set `.env.local`** on the SERVER (see `24_ENVIRONMENTS.md`). Prod fails
   closed without `SESSION_SECRET` / `DOWNLOAD_URL_SECRET`; email key required for
   the account lifecycle.
3. **MAC - push code:**
   ```bash
   rsync -avz --delete \
     --exclude 'node_modules' --exclude '.git' --exclude 'dist*' --exclude '.env.local' \
     ~/Claude/Projects/OpenAD/sites/divini-procure/ \
     root@SERVER:/root/sites/divini-procure/
   ```
4. **SERVER - apply schema TWICE** (fresh DB; resolves cross-file FK order):
   ```bash
   docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/apply-all.sql
   docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/apply-all.sql
   ```
5. **SERVER - build + start:**
   ```bash
   cd /root/sites/divini-procure && bash deploy.sh
   pm2 start "node --enable-source-maps server/dist/index.js" --name divini-procure --update-env \
     || pm2 restart divini-procure --update-env
   pm2 save
   ```
   `deploy.sh` builds the server (tsc), builds the SPA (vite), copies the SPA into
   `server/dist/public`, restarts pm2, and curls healthz (expects HTTP 200 on
   `localhost:3020/api/healthz`).
6. **SERVER - smoke (CRITICAL):**
   ```bash
   curl -s localhost:PORT/api/healthz                    # expect 200 {ok:true}, NOT 401
   curl -s -o /dev/null -w "%{http_code}\n" localhost:PORT/api/admin/revenue/summary  # 401 gated
   curl -s -o /dev/null -w "%{http_code}\n" https://diviniprocure.com/                # 200
   ```
   Then in a browser: register -> verify email -> login (proves email is wired).

## Repeat deploy (DEPLOY.md)

`rsync` (Mac) -> `bash deploy.sh` + `pm2 restart divini-procure --update-env`
(server). Re-apply `apply-all.sql` only if the schema changed (idempotent).

## Flipping Monetization V2

After a clean deploy + smoke, set `PROCURE_MONETIZATION_V2=true` in `.env.local`
and `pm2 restart divini-procure --update-env`. Verify the bid limit, the
verification gate, and the success-fee recording behave as expected. Rollback =
set it back to false and restart (the schema is additive, so no data migration is
undone).

## Rollback

`pm2 stop divini-procure` (or `rsync` the previous code and restart). The first
deploy runs no destructive migration. For env-only changes, edit `.env.local` and
restart.

## Backups & recovery (ALFY2 Section 06)

Production is a single self-hosted Docker Postgres container on one droplet
(no managed-database provider, so no automatic provider-side snapshots
exist underneath it). `backup.sh` (repo root) takes a compressed
`pg_dump --format=custom` snapshot, timestamped, into `/root/backups/divini-procure`
by default, pruning anything older than 14 days.

**One-time setup on the server:**
1. Confirm the DB user is exempt from Row-Level Security before relying on
   this (pg_dump requires it - see the comment at the top of `backup.sh`):
   ```bash
   docker exec divini_procure_db psql -U aibos -d divini_procure -c \
     "select rolsuper or rolbypassrls from pg_roles where rolname = current_user;"
   ```
   Must return `t`. If it returns `f`, backups will fail loudly (not
   silently) until this is corrected - see the script's own error output
   for the exact remediation.
2. Add to crontab (`crontab -e` on the server), e.g. nightly at 03:00 UTC:
   ```
   0 3 * * * /root/sites/divini-procure/backup.sh >> /var/log/divini-backup.log 2>&1
   ```

**Restore** (disaster recovery - verified locally this pass via a full
dump/restore round trip against a real copy of the schema, including RLS
policies surviving intact):
```bash
docker exec -i divini_procure_db pg_restore -U aibos -d divini_procure --clean --if-exists \
  < /root/backups/divini-procure/divini_procure_<timestamp>.dump
```
`--clean --if-exists` drops existing objects before recreating them, so
this is safe to run against a database that already has (possibly
corrupted) data in it, not just an empty one.

## iOS (Mac-only, separate track)

Per `IOS-APP-STORE-RUNBOOK.md`: `npm install` -> provision app.diviniprocure.com
(HTTPS) -> `npm run build` -> `npx cap add ios` -> `npx cap sync` -> generate
icons/splash -> add `mobile/PrivacyInfo.xcprivacy` -> signing -> TestFlight ->
submit. Decide IAP vs external purchase for paid placements/subscriptions.
