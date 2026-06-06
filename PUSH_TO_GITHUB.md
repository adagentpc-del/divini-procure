# Push Divini Procure to GitHub

The repo is already initialized and committed locally (branch: `master`).
Pick one option below, run it in your Mac's Terminal.

## Option A — GitHub CLI (fastest, creates the repo for you)
Requires the GitHub CLI (`brew install gh`, then `gh auth login` once).

```bash
cd "/Users/alyssadeltorre/Claude/Projects/Divini Procure by Divini Group/divini-procure"
gh repo create divini-procure --private --source=. --remote=origin --push
```

That creates a private repo named `divini-procure` and pushes everything.

## Option B — Manual (create the repo on the web first)
1. Go to https://github.com/new
2. Name it `divini-procure`, set Private, **do not** add a README/.gitignore (we already have them), click Create.
3. Then:

```bash
cd "/Users/alyssadeltorre/Claude/Projects/Divini Procure by Divini Group/divini-procure"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/divini-procure.git
git push -u origin main
```

## To let Claude push for you next time
Connect the GitHub connector (Settings → Connectors → Engineering / GitHub, authorize it).
Once it's connected, ask Claude to "create the GitHub repo and push" and it will handle it directly.

---

### What's in this repo
- `src/` — React + Vite + Supabase starter (connects to the live project on load)
- `supabase/migrations/` — `0001_init.sql` (schema, RLS, storage) + `0002_harden_rls_and_storage.sql`
- `capacitor.config.ts` — iOS/Android shell config (appId `com.divinigroup.procure`)
- `.env` / `.env.example` — Supabase URL + publishable key (already filled)
- `README.md` — setup + roadmap

### Live Supabase backend (already created)
- Project: **Divini Procure** (`qrqydaaeswtihmsoztjx`, us-east-1)
- URL: https://qrqydaaeswtihmsoztjx.supabase.co
- Dashboard: https://supabase.com/dashboard/project/qrqydaaeswtihmsoztjx
