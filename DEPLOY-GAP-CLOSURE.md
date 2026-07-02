# Divini Procure — Gap-Closure Deploy Runbook (Jun 18)

New since last deploy: revenue ledger + monetization wiring, bid-invites, Stripe Connect
payout rail, verification queue, agreement split-terms, profile collateral (decks/programs).
All additive. NOT an auth cutover. Procure has NO apply-all.sql -> apply each file.

New/undeployed schema (idempotent, apply in this order):
schema-revenue.sql, schema-payouts.sql, schema-bid-invites.sql,
schema-verification.sql, schema-split-terms.sql, schema-profile-collateral.sql

## 1. MAC terminal — push code (NEVER sync .env.local)
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.git' --exclude 'dist*' --exclude '.env.local' \
  ~/Claude/Projects/OpenAD/sites/divini-procure/ \
  root@SERVER:/root/sites/divini-procure/

## 2. SERVER web console — apply schema (each file; idempotent)
cd /root/sites/divini-procure
for f in schema-revenue schema-payouts schema-bid-invites schema-verification schema-split-terms schema-profile-collateral; do
  echo "== $f =="; docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/$f.sql
done

## 3. SERVER web console — build + restart
cd /root/sites/divini-procure && bash deploy.sh
pm2 restart divini-procure --update-env

## 4. SERVER — smoke (CRITICAL: confirm /api/healthz is 200, NOT 401)
curl -s localhost:PORT/api/healthz                                                  # expect 200 {ok:true}
curl -s -o /dev/null -w "%{http_code}\n" localhost:PORT/api/admin/revenue/summary   # expect 401 (gated)
curl -s -o /dev/null -w "%{http_code}\n" https://diviniprocure.com/                 # expect 200

## Notes
- WATCH FOR the path-less-guard outage: if /api/healthz returns 401 after deploy, a self-pathed
  router is gating everything (the campaigns.ts bug). All new routers this round are correctly
  path-scoped, but verify healthz=200 before declaring success.
- STRIPE_SECRET_KEY stays UNSET -> payout release queue-only. Set server-side when ready.
- Hard-refresh to see new SuperAdmin tabs (Split Terms, Verification) + Collateral in role nav.
