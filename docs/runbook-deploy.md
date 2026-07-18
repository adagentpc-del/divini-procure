# Divini Procure — Deploy Runbook

## 1. Required Environment Variables

All production deploys **must** set the following environment variables. Never commit real values to the repository. Use your hosting platform's secrets manager (Railway, Render, Fly.io, etc.) or a `.env` file that is `.gitignore`-listed.

### Critical — App Will Not Start Without These

| Variable | Description | How to Generate |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string with SSL | From your DB provider |
| `SESSION_SECRET` | Signs the `divini_session` httpOnly cookie | `openssl rand -hex 64` |
| `DOWNLOAD_URL_SECRET` | Signs time-limited download URLs | `openssl rand -hex 64` |
| `STRIPE_SECRET_KEY` | Stripe server-side key (`sk_live_...`) | Stripe Dashboard → API keys |
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key (`pk_live_...`) | Stripe Dashboard → API keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) | Stripe Dashboard → Webhooks → endpoint secret |
| `STRIPE_CONNECT_CLIENT_ID` | OAuth client ID for Stripe Connect payouts | Stripe Dashboard → Connect settings |
| `RESEND_API_KEY` | Transactional email delivery | resend.com → API Keys |

### Important — Features Degrade Without These

| Variable | Description |
|---|---|
| `ADMIN_ALLOWED_EMAILS` | Comma-separated list of admin email addresses. Default: none. Set to your ops team. |
| `STORAGE_ENCRYPTION_KEY` | If set, all uploaded files are AES-encrypted at rest. Must be exactly 32 bytes (256-bit). Generate: `openssl rand -hex 32`. If not set, files are stored plaintext — acceptable in dev, strongly recommended in prod. |
| `LLM_PROVIDER` | Set to `openai-compat` or `ollama` to enable AI features. Omit to leave LLM disabled (deterministic mode, default). |
| `LLM_BASE_URL` | Base URL of your LLM API endpoint (required if `LLM_PROVIDER` is set). |
| `LLM_API_KEY` | API key for the LLM provider (never logged, never exposed via API). |
| `LLM_MODEL` | Model name (e.g. `gpt-4o-mini`). |
| `PORT` | HTTP port. Default: `3000`. |
| `NODE_ENV` | Set to `production`. Enables secure cookies, stricter error masking. |

### Placeholder Reference (for code and docs — never use in prod)

When referencing secrets in documentation, PRs, or config templates, use these placeholder names:
```
YOUR_SUPABASE_URL
YOUR_STRIPE_SECRET_KEY
YOUR_STRIPE_PUBLISHABLE_KEY
YOUR_STRIPE_WEBHOOK_SECRET
YOUR_STRIPE_CONNECT_CLIENT_ID
YOUR_RESEND_API_KEY
YOUR_LLM_API_KEY
YOUR_STORAGE_ENCRYPTION_KEY
```

---

## 2. Secret Rotation

- **SESSION_SECRET** — rotating this immediately invalidates all active user sessions. All users are logged out. Do it during a maintenance window or low-traffic period.
- **DOWNLOAD_URL_SECRET** — rotating this invalidates all outstanding signed download URLs (documents opened within the last ~15 minutes). Minimal user impact.
- **STRIPE_WEBHOOK_SECRET** — after rotating in the Stripe Dashboard, update the env var before the old secret expires. There is a brief overlap window in the Stripe dashboard — use it to do a zero-downtime rotation.
- **STORAGE_ENCRYPTION_KEY** — **never rotate this without re-encrypting all stored files first.** Contact the engineering team before changing this value.

---

## 3. Database

### Apply Migrations

All schema files live in `db/`. Apply them in order or use `db/apply-all.sql` if present:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/schema-rls.sql          # Row-Level Security — required
psql "$DATABASE_URL" -f db/schema-investment.sql
psql "$DATABASE_URL" -f db/schema-watchlist-userid-fix.sql  # #70 user_id type fix
# ... other schema files as needed
```

### SSL

`DATABASE_URL` must include SSL parameters in production. The server enforces `ssl: { rejectUnauthorized: true }`. Example:

```
postgres://user:pass@host:5432/dbname?sslmode=require
```

### Backups

Ensure automated daily backups are enabled on your DB provider. Test a restore before the first production launch.

---

## 4. Stripe Webhook Setup

1. In Stripe Dashboard → Developers → Webhooks, add an endpoint:
   - URL: `https://your-domain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `account.updated` (Connect)
2. Copy the **Signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET`.
3. The webhook handler uses `express.raw()` — **do not add body-parsing middleware ahead of `/api/webhooks/stripe`**.

---

## 5. First-Deploy Checklist

- [ ] All required env vars set in production secrets manager
- [ ] `SESSION_SECRET` and `DOWNLOAD_URL_SECRET` are unique, strong values (`openssl rand -hex 64`)
- [ ] `NODE_ENV=production` set
- [ ] Database SSL enabled and `rejectUnauthorized: true`
- [ ] RLS schema applied (`db/schema-rls.sql`)
- [ ] Stripe webhook configured and `STRIPE_WEBHOOK_SECRET` set
- [ ] `ADMIN_ALLOWED_EMAILS` set to your ops team email(s)
- [ ] Resend domain verified (check SPF/DKIM in resend.com)
- [ ] HTTPS enforced at load balancer or reverse proxy level
- [ ] Cloudflare or WAF in front of the server (see `docs/runbook-cloudflare-waf.md`)
- [ ] TypeScript build passing: `cd server && npx tsc --noEmit`
- [ ] Health check responding: `curl https://your-domain.com/api/healthz`

---

*Last updated: 2026-07-18*
