# 41 AI Workflows

How an AI should run common tasks in this repo. The meta-workflow is in
`README.md` (READ -> ANALYZE -> DO -> UPDATE). This file is the task-level detail.

## Verify green (run after any code change)

```bash
npx tsc -p server/tsconfig.json --noEmit   # server typecheck (expect 0 errors)
npx tsc -p tsconfig.json --noEmit          # SPA typecheck (expect 0 errors)
npm test                                   # node:test (expect 39+ passing)
```
All three must pass before you call a change done. CI (`.github/workflows/ci.yml`)
runs the same on push/PR.

## Build a new feature (backend)

1. Read `20_CODEBASE_MAP.md` to find where it belongs.
2. Add a **new modular router** under `server/src/routes/` and mount it in
   `routes.ts` (do not bloat `routes.ts`).
3. Use `q`/`q1` (raw SQL). Money in integer cents. Gate with `assertVendorVerified`
   / `consumeBidCredit` where the V2 model requires it.
4. Add schema as an idempotent `db/schema-*.sql` and append it (parents-first) to
   `db/apply-all.sql`.
5. Verify green. Update `13_CHANGELOG.md` + `10_CURRENT_STATE.md` + `12_TASK_QUEUE.md`.

## Build a new feature (frontend)

1. Reuse the design tokens/classes in `src/theme.css` and the components in
   `src/components/` (`31_DESIGN_SYSTEM.md`). No new UI dependency without a
   decision.
2. Call the API through `src/lib/api.ts`; read feature flags via
   `src/lib/features.tsx`; read session via `src/lib/auth.tsx`.
3. Respect the free-first, fee-transparent UX rules (`30_UI_UX_GUIDELINES.md`).
4. Verify green; update the OS.

## Fix a bug

1. Reproduce against the real code; check `15_KNOWN_ISSUES.md` first (it may be a
   known sharp edge, e.g. verified state is `approved`, or email not configured).
2. Make the minimal fix. Add a regression test if there is pure logic.
3. Verify green; remove the item from `15_KNOWN_ISSUES.md` if resolved; log it in
   `13_CHANGELOG.md`.

## Optional LLM-assisted features

The AI layer (`lib/llm.ts`, `lib/extract.ts`, `lib/procure-coo.ts`,
`lib/procure-moat.ts`, `lib/investor-match.ts`, `lib/score-refresh.ts`) is
**deterministic-first**: the LLM is a best-effort enhancement gated by
`llmEnabled()` (off unless `LLM_PROVIDER` is set; Ollama by default). Always
provide a deterministic fallback; never block a feature on the model; never let
it invent regulated facts (pricing, insurance, certs, capacity).

## Deploy

Follow `23_DEPLOYMENT.md` / `FIRST-DEPLOY-RUNBOOK.md`. Remember: `rsync` on the
Mac, `psql`/`deploy.sh`/`pm2` on the server, never sync `.env.local`, `apply-all.sql`
twice on a fresh DB, healthz must be 200.

## Update the OS (every state-changing task)

Touch `10_CURRENT_STATE.md` (status/date), `11_ACTIVE_SPRINT.md` (in-flight),
`13_CHANGELOG.md` (append), `12_TASK_QUEUE.md` (done/new), `14_DECISIONS.md` (any
new decision).
