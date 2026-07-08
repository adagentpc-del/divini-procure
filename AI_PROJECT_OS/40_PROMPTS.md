# 40 Prompts

Reusable prompts and prompt-shaped guidance for AIs working on this repo. These
are scaffolds; always adapt to the specific task and confirm against the code.

## Project bootstrap (paste into a fresh AI)

> You are picking up the Divini Procure project (construction-procurement
> marketplace, repo `sites/divini-procure`). Before doing anything, read
> `AI_PROJECT_OS/01_PROJECT_OVERVIEW.md`, `04_SYSTEM_ARCHITECTURE.md`,
> `10_CURRENT_STATE.md`, `11_ACTIVE_SPRINT.md`, `12_TASK_QUEUE.md`, and
> `14_DECISIONS.md`. Confirm any load-bearing fact against the actual code (do not
> assume). Do only the requested work, keep the `PROCURE_MONETIZATION_V2` flag and
> the locked decisions intact, verify green (server tsc, SPA tsc, `npm test`), then
> update `10_CURRENT_STATE.md`, `11_ACTIVE_SPRINT.md`, `13_CHANGELOG.md`,
> `12_TASK_QUEUE.md`, and `14_DECISIONS.md`.

## Add a backend endpoint

> Add `<METHOD> <path>` to Divini Procure. Create a new modular router under
> `server/src/routes/` and mount it in `server/src/routes.ts` (do not grow
> `routes.ts` inline). Use raw SQL via `q`/`q1` from `pool.ts`. Gate vendor
> actions with `assertVendorVerified` and free-tier limits with `consumeBidCredit`
> where relevant. Keep money in integer cents. Respect `PROCURE_MONETIZATION_V2`.
> Add/adjust a node:test if there is testable pure logic. Run server tsc + tests.

## Touch fee / money logic

> You are editing fee logic. The pure arithmetic lives in `lib/feeMath.ts`
> (`successFeeCents`, `feeCentsFromPercentage`, `resolveFeeRule`) and is unit
> tested in `tests/feeMath.test.ts`. `lib/fee-rules.ts` wraps it with config. Do
> NOT change the locked model (2% cap $2,500 / grandfathered 1% cap $1,000) or
> break the grandfathered-pair protection (`14_DECISIONS.md` D2, D7). Keep all
> tests green and add cases for any new branch.

## Verification / gate work

> The verified state is `verify_status='approved'` (the gate also accepts literal
> `verified`); see `14_DECISIONS.md` D5. Use the helpers in
> `lib/verificationGate.ts` rather than querying verify_status directly. Required
> credential types: license, gl_insurance, trade_cert (REQUIRED_CREDENTIAL_TYPES).
> Expiry + auto-revoke logic lives in `routes/verification.ts`
> (`recomputeExpiringVerifications`).

## Optional AI layer (LLM)

> The LLM layer (`lib/llm.ts`, `lib/extract.ts`) is **local-first and optional**:
> `llmEnabled()` is false unless `LLM_PROVIDER` is configured (Ollama by default).
> Every AI call is best-effort with a timeout and MUST fall back to deterministic
> logic on any failure. Never make a feature hard-depend on the LLM, and never let
> it invent pricing, insurance, capacity, or certifications.

> TODO(owner): add any house style prompts the team standardizes on (PR
> descriptions, commit messages, changelog entries).
