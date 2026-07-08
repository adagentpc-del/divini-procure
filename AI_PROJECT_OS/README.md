# AI Project Operating System (AI_PROJECT_OS)

This folder is the standardized operating manual for the Divini Procure project.
Its purpose is simple: **any AI (or human) can pick up this project from the repo
alone, with no chat history**, by reading these files first. Treat this folder as
the single source of truth for what the project is, what state it is in, and what
to do next.

Zero em dashes by convention (matches the rest of the repo).

---

## How every AI uses this folder

1. **Read first, always.** Before doing anything, read the "always-read-first"
   files below. They tell you what the project is, how it is built, where it
   stands today, and what the active priorities are.
2. **Analyze the repo, never assume.** These docs point you at the real code.
   When a fact matters, open the actual file (paths are given throughout) and
   confirm it. The codebase is the ground truth; this folder is the index.
3. **Do only the requested work.** Stay scoped to the task you were given. Do not
   gold-plate, refactor unrelated code, or flip feature flags unless asked.
4. **Update the OS after.** When your change alters project state, update the
   "always-update-after" files so the next AI inherits an accurate picture.

### Always read first (in this order)
- `01_PROJECT_OVERVIEW.md` - what Divini Procure is.
- `04_SYSTEM_ARCHITECTURE.md` - how it is built and runs.
- `10_CURRENT_STATE.md` - exact build status, blockers, completion.
- `11_ACTIVE_SPRINT.md` - what is being worked on right now.
- `12_TASK_QUEUE.md` - the prioritized, actionable backlog.
- `14_DECISIONS.md` - the locked decisions you must not silently reverse.

### Always update after you make a change
- `10_CURRENT_STATE.md` - new build status / blockers / completion.
- `11_ACTIVE_SPRINT.md` - move items in/out of the active sprint.
- `13_CHANGELOG.md` - append what you did, why, files touched, risks, next.
- `12_TASK_QUEUE.md` - mark tasks done / add follow-ups discovered.
- `14_DECISIONS.md` - record any new decision you made or were told.

---

## The Standard AI Workflow

```
READ            ->  ANALYZE              ->  DO                   ->  UPDATE
read-first      open the real files,     only the requested      10, 11, 13, 12, 14
files (01,04,   confirm facts, never     work; stay in scope;    so the next AI
10,11,12,14)    assume from these docs   verify green (tsc+test) inherits the truth
```

1. **READ** the always-read-first files.
2. **ANALYZE** the repository. Open `server/src`, `db/`, `src/`, and the planning
   docs. Confirm anything load-bearing against the code, not against memory.
3. **DO** exactly what was asked. Keep the `PROCURE_MONETIZATION_V2` flag and the
   locked decisions in `14_DECISIONS.md` intact unless explicitly told otherwise.
   Verify green: `npx tsc -p server/tsconfig.json --noEmit`,
   `npx tsc -p tsconfig.json --noEmit`, and `npm test`.
4. **UPDATE** the OS (the always-update-after files).

---

## File index

| File | Purpose |
|---|---|
| `01_PROJECT_OVERVIEW.md` | What the product is, stack, status. |
| `02_MISSION_AND_VISION.md` | Why it exists, the wedge, the long game. |
| `03_PRODUCT_REQUIREMENTS.md` | The Monetization V2 requirements. |
| `04_SYSTEM_ARCHITECTURE.md` | Runtime, processes, hosting topology. |
| `05_BUSINESS_CONTEXT.md` | Monetization model, pricing, revenue engines. |
| `10_CURRENT_STATE.md` | Build status, blockers, completion, next task. |
| `11_ACTIVE_SPRINT.md` | What is in flight now. |
| `12_TASK_QUEUE.md` | Prioritized actionable backlog. |
| `13_CHANGELOG.md` | History of meaningful changes. |
| `14_DECISIONS.md` | Locked decisions and rationale. |
| `15_KNOWN_ISSUES.md` | Bugs, gaps, sharp edges. |
| `16_TECH_DEBT.md` | Debt and cleanup owed. |
| `20_CODEBASE_MAP.md` | Where everything lives. |
| `21_DATABASE.md` | Schema, tables, the V2 migration. |
| `22_APIS_AND_INTEGRATIONS.md` | Internal API + external services. |
| `23_DEPLOYMENT.md` | How to deploy. |
| `24_ENVIRONMENTS.md` | Env vars and environments. |
| `30_UI_UX_GUIDELINES.md` | UX conventions. |
| `31_DESIGN_SYSTEM.md` | Components, theming. |
| `32_BRAND_GUIDELINES.md` | Voice, naming, copy rules. |
| `40_PROMPTS.md` | Reusable prompts for AIs. |
| `41_AI_WORKFLOWS.md` | How AIs run common tasks here. |
| `42_AUTOMATIONS.md` | Scheduled / automated jobs. |
| `50_TESTING.md` | Tests, CI, manual QA. |
| `51_SECURITY.md` | Security posture. |
| `52_COMPLIANCE.md` | Legal/compliance posture. |
| `90_FUTURE_IDEAS.md` | Parked ideas and roadmap beyond now. |

---

## Self-maintenance

This OS is only useful if it stays true. Maintenance rules:

- **Update on every state-changing task.** If you build, fix, deploy, or decide,
  reflect it in the always-update-after files in the same session.
- **Date your edits.** `10_CURRENT_STATE.md` and `13_CHANGELOG.md` carry dates.
- **Prefer linking the code over copying it.** When code is the source of truth,
  cite the path rather than pasting a snapshot that will rot.
- **Mark uncertainty honestly.** Where a fact is genuinely unknown, leave a
  `> TODO(owner): ...` placeholder rather than inventing an answer.
- **Keep it focused.** These are working documents, not marketing. Trim anything
  that has gone stale.

> TODO(owner): nominate a default owner name to use in `TODO(owner)` placeholders
> throughout this folder (currently left generic).
