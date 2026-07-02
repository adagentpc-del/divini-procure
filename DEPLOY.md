# Deploy Divini Procure (self-hosted)

Divini Procure is a single Node process (Express API + built Vite SPA) backed by a
Docker Postgres container, fronted by Caddy + pm2 on the droplet. It uses native
email/password auth. It is NOT a Vercel/Supabase app. For the full first-time
checklist see FIRST-DEPLOY-RUNBOOK.md; this file is the short repeat-deploy loop.

> Golden rule: `rsync` runs in the MAC terminal; `deploy.sh` and `psql` run in the
> SERVER web console. Never sync `.env.local`.

## 1. MAC terminal - push code
```bash
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.git' --exclude 'dist*' --exclude '.env.local' \
  ~/Claude/Projects/OpenAD/sites/divini-procure/ \
  root@SERVER:/root/sites/divini-procure/
```

## 2. SERVER web console - apply schema (idempotent; run twice on a fresh DB)
```bash
docker exec -i divini_procure_db psql -U aibos -d divini_procure \
  < /root/sites/divini-procure/db/apply-all.sql
```

## 3. SERVER web console - build + restart
```bash
cd /root/sites/divini-procure && bash deploy.sh
pm2 restart divini-procure --update-env
```

## 4. SERVER - smoke
```bash
curl -s localhost:PORT/api/healthz                                    # expect 200 {ok:true} NOT 401
curl -s -o /dev/null -w "%{http_code}\n" https://diviniprocure.com/   # expect 200
```

## Notes
- Required env in `.env.local` (server-side): `SESSION_SECRET`, `DATABASE_URL`,
  `DOWNLOAD_URL_SECRET`, `ADMIN_ALLOWED_EMAILS`, `PUBLIC_APP_URL`/`ALLOWED_ORIGINS`,
  `EMAIL_PROVIDER`+`EMAIL_API_KEY` (required for register -> verify -> login).
- In production the app now FAILS CLOSED: it refuses to start if `SESSION_SECRET`
  or `DOWNLOAD_URL_SECRET` is unset/dev-default, and CORS denies cross-origin when
  the allowlist is empty. Set those env vars before deploying.
- `STRIPE_SECRET_KEY` stays UNSET until you are ready to move real money (payouts
  stay queue-only; records are correct).
- If `/api/healthz` returns 401 after deploy, a self-pathed router is gating
  everything; verify healthz is 200 before declaring success.
