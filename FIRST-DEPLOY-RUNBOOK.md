# Divini Procure - First Production Deploy Runbook

First time live (target: diviniprocure.com). Self-hosted: one Node process
(Express API + built Vite SPA) + Docker Postgres `divini_procure_db` + Caddy +
pm2 on the droplet. Native email/password auth. Zero em dashes.

> Golden rule: `rsync` on the MAC; `deploy.sh` / `psql` on the SERVER console.
> Never sync `.env.local`.

## 0. Pre-flight
- [ ] Server `tsc` + SPA `tsc` green (run `npx tsc -p server/tsconfig.json --noEmit` and `npx tsc -p tsconfig.json --noEmit`).
- [ ] DNS for diviniprocure.com ready to point at the droplet (A record).
- [ ] Docker Postgres container `divini_procure_db` exists (user `aibos`, db `divini_procure`).
- [ ] Caddy site block for diviniprocure.com -> localhost:PORT prepared.
- [ ] pm2 installed on the box.

## 1. Required env (set in `/root/sites/divini-procure/.env.local` on the SERVER)
```
NODE_ENV=production
PORT=XXXX                         # the port Caddy proxies to
DATABASE_URL=postgres://aibos:PASS@127.0.0.1:5432/divini_procure
SESSION_SECRET=<strong unique value>      # REQUIRED - app refuses to start in prod without it
DOWNLOAD_URL_SECRET=<strong unique value> # REQUIRED in prod (or it inherits SESSION_SECRET)
ADMIN_ALLOWED_EMAILS=adagentpc@gmail.com
PUBLIC_APP_URL=https://diviniprocure.com
ALLOWED_ORIGINS=https://diviniprocure.com
EMAIL_PROVIDER=resend             # REQUIRED for register -> verify -> login to work
EMAIL_API_KEY=<resend key>
EMAIL_FROM=Divini Procure <noreply@diviniprocure.com>
# STRIPE_SECRET_KEY stays UNSET until you are ready to move real money
```
> Production fail-closed (new): the app THROWS on startup if `SESSION_SECRET` or
> `DOWNLOAD_URL_SECRET` is unset/dev-default, and CORS denies cross-origin when
> the allowlist is empty. So these must be set before the first boot.

## 2. MAC terminal - push code
```bash
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.git' --exclude 'dist*' --exclude '.env.local' \
  ~/Claude/Projects/OpenAD/sites/divini-procure/ \
  root@SERVER:/root/sites/divini-procure/
```

## 3. SERVER console - apply the full schema (run TWICE on a fresh DB)
The bundle is idempotent; a second pass resolves any cross-file foreign key
declared before its parent existed on the first pass.
```bash
docker exec -i divini_procure_db psql -U aibos -d divini_procure < /root/sites/divini-procure/db/apply-all.sql
docker exec -i divini_procure_db psql -U aibos -d divini_procure < /root/sites/divini-procure/db/apply-all.sql
```
Sanity-check a few tables exist:
```bash
docker exec -i divini_procure_db psql -U aibos -d divini_procure -c "\dt" | head -40
```

## 4. SERVER console - build + start
```bash
cd /root/sites/divini-procure && bash deploy.sh
pm2 start "node --enable-source-maps server/dist/index.js" --name divini-procure --update-env || pm2 restart divini-procure --update-env
pm2 save
```

## 5. SERVER - smoke (CRITICAL: healthz must be 200, not 401)
```bash
curl -s localhost:PORT/api/healthz                                       # expect 200 {ok:true}
curl -s -o /dev/null -w "%{http_code}\n" localhost:PORT/api/admin/revenue/summary  # expect 401 (gated)
curl -s -o /dev/null -w "%{http_code}\n" https://diviniprocure.com/      # expect 200
```
Then in a browser: register -> receive verify email -> verify -> login. If the
verify email never arrives, EMAIL_PROVIDER/EMAIL_API_KEY are not set.

## 6. Post-deploy checks
- [ ] Auth rate limit works (rapid repeated logins return 429 with Retry-After).
- [ ] A protected admin route returns 401 when unauthenticated.
- [ ] File upload/download (vendor docs) works and download URLs expire.
- [ ] No console error about empty CORS allowlist (means ALLOWED_ORIGINS is set).

## 7. Rollback
```bash
pm2 stop divini-procure        # or pm2 restart after reverting code via rsync
```
The schema is additive/idempotent; no destructive migration is run on first deploy.

## Notes
- Real money does not move until `STRIPE_SECRET_KEY` is set; payouts stay
  queue-only and records remain correct.
- If SSH throttles after rapid repeats, space out commands / restart fail2ban.
