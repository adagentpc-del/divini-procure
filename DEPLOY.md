# Deploy Divini Procure (Vercel + diviniprocure.com)

The app is on GitHub at `adagentpc-del/divini-procure` and builds cleanly (`npm run build`).
Three short steps to get it live and auto-deploying.

## 1. Import the repo into Vercel (~2 min)
1. Go to https://vercel.com/new
2. Under **Import Git Repository**, pick **adagentpc-del/divini-procure**
   (if you don't see it, click "Adjust GitHub App permissions" and grant access to the repo).
3. Vercel auto-detects **Vite** — leave Build Command (`npm run build`) and Output (`dist`) as is.
4. Expand **Environment Variables** and add these two (values are in `.env`):
   - `VITE_SUPABASE_URL` = `https://qrqydaaeswtihmsoztjx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_pfFrm2hRGEi7-s_5C6Gviw_7BcHx8ZN`
5. Click **Deploy**. You'll get a live `…vercel.app` URL in ~1 minute.

From now on, every `git push` (or my pushes via GitHub Desktop) auto-deploys.

## 2. Point diviniprocure.com at Vercel
1. In the Vercel project → **Settings → Domains** → add `diviniprocure.com` and `www.diviniprocure.com`.
2. Vercel shows the exact DNS records. In **GoDaddy → your domain → DNS**, set:
   - **A** record: Host `@` → Value `76.76.21.21`
   - **CNAME** record: Host `www` → Value `cname.vercel-dns.com`
   (Use whatever Vercel shows if it differs — follow its panel.)
3. Wait for DNS to verify (minutes to ~an hour). Vercel issues HTTPS automatically.

## 3. Turn on auth + point Supabase at your URLs
In the Supabase dashboard (https://supabase.com/dashboard/project/qrqydaaeswtihmsoztjx):
- **Authentication → Providers → Email**: it's on by default. For frictionless testing, you can turn **"Confirm email" OFF** (turn it back on for production).
- **Authentication → URL Configuration**: set **Site URL** to `https://diviniprocure.com` and add your `…vercel.app` URL and `http://localhost:5173` to **Redirect URLs**.

## Run locally meanwhile
```bash
cd divini-procure
npm install
npm run dev   # http://localhost:5173
```

---

### What's live in the app right now
- **Login / sign up** (Supabase email auth)
- **Company onboarding** — creates your buyer or vendor company (vendors pick services)
- **Dashboard** — role-aware, reads your live Supabase data
- **Buyer:** Projects (create buildings) · **Vendor:** Search Bids (matched to services), My Bids
- **Profile** — edit company info; vendor plan ($100/mo via PayPal), trust, team seats

### Next build steps (when you want them)
Full bid lifecycle (submit/edit/award/revisions), messaging threads, the admin verification console,
PayPal subscription checkout, file uploads to Supabase Storage, and the Capacitor iOS wrapper.
