#!/usr/bin/env bash
# One-command redeploy for Divini Procure.
# Usage on the server:  bash /root/sites/divini-procure/deploy.sh
set -e
cd /root/sites/divini-procure
set -a; . ./.env.local; set +a
echo "==> building server (api)…"
( cd server && npx tsc -p tsconfig.json --noEmitOnError false )
echo "==> building SPA (frontend)…"
BASE_PATH=/ npx vite build
echo "==> staging frontend into server…"
rm -rf server/dist/public && cp -r dist server/dist/public
echo "==> restarting…"
pm2 restart divini-procure
sleep 6
code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3020/api/healthz)
echo "==> divini-procure live: HTTP $code"
