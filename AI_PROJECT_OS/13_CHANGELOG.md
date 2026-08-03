# 13 Changelog

Append new entries at the top. Each entry: what, why, files, risks, next.
(The repo also has a separate `CHANGES.md`, but it is stale: it still describes
the Authentik/Supabase era and does not reflect Monetization V2.)

---

## 2026-08-03 (3) - Divini Pipeline (Slice 1 of the Divini deterministic business tools spec)

**What.** First build from the "Divini deterministic business tools" spec
(construction-domain adaptation: no LLM dependency, branded tools, deterministic
scoring, structured data capture). Divini Pipeline is a user-facing sales/
procurement CRM, distinct from the existing `crm_records` (`db/schema-crm.sql`),
which is Divini's own INTERNAL pipeline for signing up customers - Divini
Pipeline is what a vendor or developer uses to run their OWN funnel:
- **Vendor profile_type**: bid opportunities pursued, stage new -> reviewing ->
  qualified -> info_needed -> bid_in_progress -> bid_submitted -> negotiation ->
  awarded/lost.
- **Developer profile_type**: vendor-sourcing funnel per package, stage new ->
  reviewing -> info_needed -> sourcing_vendors -> bids_in -> comparing ->
  negotiation -> awarded/lost.
- One shared schema/engine serves both profile types (stage definitions are
  org-customizable with a seeded global default per profile type), per the
  spec's "reusable shared engine, not a duplicate per profile" principle.
- **Deterministic readiness score** (`server/src/lib/pipeline-score.ts`, pure,
  zero IO): 8 fixed-point factors (estimated value, next action + date,
  expected close date, category, linked to a real bid/package, client contact
  on file, recent activity within 14 days, an open non-overdue task) summing to
  exactly 100. Never a prediction - always shown with the exact positives/
  missing list that produced it, per spec requirement 8 ("clearly show how
  every output was calculated").
- Full CRUD: opportunities, append-only stage history (never overwritten,
  audit trail for time-in-stage), activities (call/email/note/meeting/
  site_visit), tasks, tags, org-configurable loss reasons and lead sources.
- Stage transitions into a stage flagged `is_won`/`is_lost` automatically set
  `status`/`won_at`/`lost_at` - `status` has no direct free-form write path,
  it only ever derives from a real stage transition.

**Files.** `db/schema-pipeline.sql` (new, synced into `db/apply-all.sql`),
`server/src/lib/pipeline-score.ts`, `server/src/routes/pipeline.ts` (mounted
at `/api/pipeline` in `routes.ts`), `src/pages/Pipeline.tsx`, nav entries in
`src/components/Shell.tsx` (buyer + vendor Quick Actions/Workspace), route in
`src/App.tsx`, `tests/pipeline-score.test.ts` (8 new tests, all pure - no DB).

**Permissions.** An opportunity belongs to exactly one `organization_id`
(unlike a purchase order, this is not a shared record between two companies).
Access = member of that company, or admin.

**Tests completed.** Unit tests only (8, all passing) for the pure scoring
function - exact-100 factor sum, empty-input zero score, recency threshold
boundary, overdue-vs-no-task distinction, both-required next-action check.
Server and SPA typecheck clean. **Not tested**: no live Postgres is available
in this sandbox (checked - no Docker, no `DATABASE_URL`, nothing listening on
5432/5433), so the schema and routes were not exercised against a real
database or verified in a browser. Reviewed the SQL and route logic carefully
by hand as the only available substitute; this still needs a real
apply-all.sql run + manual UI smoke test before considering it verified.

**Deferred (per the spec's own build order).** Slice 2 (Divini Scope Builder),
Slice 3 (Divini Bid Studio), Slice 4 (Divini Follow-Up Desk), Slice 5 (Divini
Profit Map), and the rest of the 12-slice roadmap. Entitlement gating
(Free/Plus/Pro limits on opportunity count, custom stages, automation) is not
implemented yet - every org currently gets the full feature set.

---

## 2026-08-03 (2) - Capital Partner module: rename + compliance boundary + tier ladder

**What.** Product-facing rename of "Investor"/"Investment" to "Capital
Partner"/"Capital" across ~35 files (nav, page headings, form labels, toasts,
admin UIs, the compliance disclaimer, the English i18n source string).
Deliberately did NOT rename: route paths (`/investor`, `/investment-profile`,
...), the `companies.kind`/`subscription_tiers.audience`/permission-level
enum values (all stay `'investor'` at the database level - "historical
database fields," per instruction), or file names.

- **Compliance boundary audit**: confirmed no waterfall/IRR, capital-call, or
  distribution engine exists (correct, per spec); removed the one thing that
  did cross the line - a dormant `capital_introduction` fee-rule type (2%,
  "for investor matching") in the `fee_rules` matrix. It was never actually
  invoked by any route, but its existence was itself a "success fee for
  capital introduction" capability the spec forbids. Removed from
  `FEE_RULE_TYPES`, the DB check constraints, the seed data (with a `delete`
  for any already-seeded row), and the two admin UIs that listed it
  (`AdminFeeMatrix.tsx`, `AdminRevenue.tsx`, which also picked up the
  `platform_infrastructure_fee` type that was missing from their pickers).
- **Capital Partner subscription tiers**: replaced `investor_basic` ($0) /
  `investor_qualified` ($499/mo) / `family_office_concierge` ($999/mo) with
  the spec's four-tier ladder in `subscription_tiers`: `capital_partner_free`
  ($0), `capital_partner_professional` ($49/mo), `capital_partner_institutional`
  ($149/mo), `capital_partner_enterprise` (custom, null price). Also updated
  the separate, actually-live `investor_profiles.plan` admin-assignment
  mechanism (`free`/`premium`/`concierge` -> `free`/`professional`/
  `institutional`/`enterprise`) with a defensive migration for any
  already-set legacy value.
- Added a `VISIBILITY_LABEL` display-only map in `InvestmentPrograms.tsx` so
  wire values like `approved_investor_preview` (a real DB enum, left
  unrenamed) render as "approved capital partner preview" without touching
  the underlying value.

**Files.** ~35 files across `src/pages/`, `src/components/`, plus
`server/src/lib/{entitlements,fee-matrix,monetization}.ts`,
`server/src/routes/subscriptions.ts`, `db/schema-{fee-matrix,revenue,
subscriptions,tiers-monetization}.sql`, `db/apply-all.sql`.

**Risks / not done.**
- **Pipeline stage vocabulary NOT remapped.** The spec's new stages
  (Potential Match, Invited, Access Requested, Access Granted, Reviewing,
  Questions Submitted, Due Diligence, Meeting Scheduled, Following, Closed,
  Archived) do not exist yet; the app still uses the old
  `investor_introduction_requests.pipeline_status` values (`matched`,
  `intro_approved`, `nda_required`, ...), which don't map 1:1. This needs a
  deliberate follow-up (label map at minimum, or a real stage migration),
  not a same-turn text rename.
- **Dormant capital-commitment tracking still exists**, separate from the
  fee I removed: `investor_introduction_requests` has a `soft_commitment`
  pipeline status and a `committed_amount_cents` column, and
  `AdminAnalytics.tsx` has a "Capital committed / Capital closed" KPI section
  reading from them (`server/src/routes/analytics.ts`). Nothing currently
  writes to these (always renders $0 in practice), but their existence is
  schema-level "capital commitment" capability the spec says not to build.
  Flagged, not removed - removing needs a deliberate decision, not a
  drive-by deletion during a rename pass.
- **12 non-English i18n locale files** (`src/i18n/locales/{es,fr,de,...}.ts`)
  still have the old translated string for `roleInvestor`; only the English
  source was updated. Translation is a separate task.

**Next.** Decide on the pipeline-stage remap and the dormant
commitment-tracking removal; translate `roleInvestor` into the other 12
locales.

---

## 2026-08-03 - Unified platform fee model (single source of truth), always-on

**What.** Replaced the three competing fee models (legacy uncapped 10%/2%,
flag-gated Monetization V2's 2%-capped-$2,500/1%-capped-$1,000) with ONE
database-driven model, always active (not flag-gated):
- Standard platform fee: 5%, capped at $25,000.
- Existing-relationship (grandfathered) fee: 2%, capped at $10,000.
- Platform infrastructure fee: 0.1%, capped at $1,500, always its own line
  item, never merged into the platform fee or labeled as a processor fee.
- All three are resolved from the `fee_rules` database table
  (`db/schema-fee-matrix.sql`, extended with a `cap_cents` column and a new
  `platform_infrastructure_fee` rule type), with `config.ts` env constants as
  the fallback default when no row exists yet. A developer- or vendor-scoped
  `fee_rules` row is an enterprise custom fee schedule.
- `payment_authorizations` gained `service_buffer_pct/cap_cents/cents`
  columns alongside the existing `success_fee_*` ones (now holding the
  unified platform fee, not a separate V2-only number).
- `platform_revenue` now allows one ledger row per authorization PER fee type
  (`source_type` in `procurement_fee`/`infrastructure_fee`/...), fixing a
  latent bug where the old auto-resolve path wrote an orphaned ledger row
  with a null `payment_authorization_id` on every award.
- `AwardWorkflow.tsx` payment-authorization rows now have a "View breakdown"
  toggle showing the full invoice (project amount, platform fee, platform
  infrastructure fee, processing fee, taxes, total) and vendor payout (gross,
  platform fee, processing allocation, infrastructure fee allocation, net)
  line items.
- Removed the now-dead legacy fee functions (`computeFeeCents`,
  `computeSuccessFeeCents`, `computeServiceBufferCents`); `fee-matrix.ts`'s
  `resolveContextFee` is the only remaining place a fee amount is computed.

**Why.** Three parallel fee models with no single source of truth was
flagged in the launch-readiness audit as a real risk; asked directly to
consolidate on one model with the new percentages/caps above.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,
fee-matrix,monetization}.ts`, `server/src/routes/award-workflow.ts`,
`db/{schema-fee-matrix,schema-revenue,schema-procure-monetization-v2,
apply-all}.sql`, `src/lib/monetization.ts`, `src/pages/{Pricing,Landing,
Onboarding,AdminConsole,AwardWorkflow}.tsx`, `tests/feeMath.test.ts`.

**Risks.** A pre-existing local/dev DB that already ran the old `fee_rules`
seed (10%, uncapped) is migrated forward by an `update` statement scoped to
rows that still exactly match the old seed values, never an admin edit.
Payment processing fee display is a placeholder ("passed through at charge
time") since no live processor charge is wired yet (Stripe is accrual-only
per `16_TECH_DEBT.md`).

**Next.** QA the new caps end-to-end once a production DB exists; consider
extending the admin fee matrix UI (`AdminFeeMatrix.tsx`) to surface
`cap_cents` for editing (currently DB/API-only).

---

## 2026-06-24 - Monetization V2 build (W1-W5), behind PROCURE_MONETIZATION_V2

**What.** Built the transaction-marketplace money + verification model, flag-gated.
- W1 success-fee math: `successFeeCents` (`lib/feeMath.ts`), `computeSuccessFeeCents`
  (`lib/fee-rules.ts`); env constants in `config.ts`
  (`PROCURE_SUCCESS_FEE_PCT=2`, cap 250000; grandfathered 1%, cap 100000).
- W2 bid credits + verification gate: `lib/bidCredits.ts` (5/quarter, no rollover),
  `lib/verificationGate.ts`; wired into bid submit in `routes.ts`; credential
  expiry tracking + auto-revoke in `routes/verification.ts`.
- W3 subscriptions + Featured + Verified+: `lib/entitlements.ts`,
  `routes/subscriptions.ts`, `routes/featured.ts`, `db/featured.ts`.
- W4 onboarding + bid UI + dashboards (`src/pages/`).
- W5 pricing page (`src/pages/Pricing.tsx`), landing, badges
  (`src/components/VendorBadges.tsx`, `FeeBadge.tsx`).
- Award wiring: `routes/award-workflow.ts` records success fee on
  `payment_authorizations` at Award.

**Why.** Monetize access + outcomes (capped success fee + vendor upgrades), never
the buyer, with verification as the trust moat. See `05_BUSINESS_CONTEXT.md`.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,bidCredits,
verificationGate,entitlements,monetization,relationships}.ts`,
`server/src/db/featured.ts`, `server/src/routes/{award-workflow,verification,
subscriptions,featured,fee-matrix,vendor-pricing,grandfathered-fees}.ts`,
`db/schema-procure-monetization-v2.sql`, many `src/pages/` + `src/components/`.

**Risks.** Flag not yet flipped; vendor credential-upload endpoint and some
dashboard summary endpoints are follow-ups (see `12_TASK_QUEUE.md`). `verify_status`
verified value is `approved`.

**Next.** Wire credential upload, first deploy, set email key, flip the flag.

---

## 2026-06-24 - Security hardening + first-deploy readiness

**What.** Prod fail-closed `SESSION_SECRET` / `DOWNLOAD_URL_SECRET`; deny-by-default
CORS when the allowlist is empty in prod; per-IP auth rate limiting (20/min on
`/api/auth`); created `db/apply-all.sql` (~110 tables, parents-first, idempotent);
rewrote `DEPLOY.md` to the real self-hosted loop; created `FIRST-DEPLOY-RUNBOOK.md`;
scrubbed stale Supabase keys/URLs.

**Why.** Make a misconfigured prod box refuse to start rather than run insecure;
make a first deploy reproducible.

**Files.** `server/src/config.ts`, `server/src/app.ts`, `server/src/lib/rateLimit.ts`,
`db/apply-all.sql`, `DEPLOY.md`, `FIRST-DEPLOY-RUNBOOK.md`, `README.md`.

**Risks.** Prod now requires the secrets to be set before first boot.

**Next.** Set prod env, deploy.

---

## 2026-06-24 - Legal pages, object storage + encryption, tests + CI

**What.** Terms + Payment + Non-Circumvention + Messaging policy pages (Privacy
already existed). Pluggable object storage (`local`|`s3`) with optional AES-256-GCM
encryption at rest. node:test suite (feeMath incl success fee, bidCredits,
passwordHash) -> 39 tests; `.github/workflows/ci.yml` (tsc + test).

**Files.** `src/pages/{Terms,PaymentPolicy,NonCircumvention,MessagingPolicy}.tsx`,
`server/src/lib/{objectStorage,storageCrypto,s3sigv4}.ts`, `tests/*.test.ts`,
`.github/workflows/ci.yml`, `OBJECT-STORAGE.md`.

**Risks.** Storage encryption key, if set, must be preserved (losing it loses files).

**Next.** Manual QA of upload/download + decryption in a deployed env.

---

> Older history (Authentik/Supabase, gap-closure waves, the six-system batch,
> grandfathered 2% fee, super-admin port) predates this OS and lives in the repo
> `CHANGES.md` and the workspace planning docs.
