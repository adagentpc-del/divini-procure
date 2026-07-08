# 21 Database

- **Engine:** PostgreSQL. **Database name:** `divini_procure`.
- **Container (prod):** Docker `divini_procure_db` (user `aibos`).
- **Access pattern:** raw SQL via `pg` (`server/src/pool.ts`), no ORM.
- **Authorization:** enforced in the Express layer (Supabase RLS was removed).

## How schema is applied

Schema lives as ~40 idempotent `db/schema-*.sql` files, concatenated
parents-first into **`db/apply-all.sql`** (the single source for a first deploy).
It contains **112 `create table` statements** (~110 logical tables). Every file
uses `create ... if not exists`, so the bundle is safe to re-run.

```bash
# On the server, run TWICE on a fresh DB (resolves cross-file FK ordering):
docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/apply-all.sql
docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/apply-all.sql
```

## Monetization V2 schema (`db/schema-procure-monetization-v2.sql`)

Net-new + additive + idempotent. Key changes:

- **`vendor_bid_credits`** (new) - one row per `(company_id, period_key)` e.g.
  `2026Q3`, with `used` count. No rollover (a new quarter is a new row at 0).
  `unique (company_id, period_key)`. Enforcement is in `lib/bidCredits.ts`.
- **`vendor_featured`** (new) - Featured placement upsell: `status`
  (active|cancelled|expired), `price_cents` (default 9900), period, processor_ref.
  Partial unique index on the active row per company.
- **`vendor_credentials`** (altered) - adds `credential_type`
  (license|gl_insurance|workers_comp|trade_cert|w9|bond), `expires_at`,
  `doc_status` (pending|approved|rejected|expired) for the verification gate +
  expiry tracking.
- **`vendor_profiles`** (altered) - adds `verified_at`, `verification_expires_at`
  (earliest credential expiry). The verified value of `verify_status` is
  **`approved`** (see `14_DECISIONS.md`).
- **`payment_authorizations`** (altered) - adds the success-fee columns:
  `award_cents`, `success_fee_pct`, `success_fee_cap_cents`, `success_fee_cents`,
  `success_fee_grandfathered`, `success_fee_status`
  (accrued|invoiced|billed|paid|waived|void). Written at Award by
  `routes/award-workflow.ts`.
- **`subscription_tiers`** (seeded, never overwrites admin edits): `developer_free`
  (0), `vendor_free` (0), `vendor_pro` (14900), `verified_plus` (4900),
  `vendor_featured` (9900).

## Verification + grandfathered tables

- `db/schema-verification.sql` -> `verification_audit` (audit trail of credential
  review actions). Vendor credential rows live in `vendor_credentials`.
- `db/schema-grandfathered-fee.sql` -> `developer_vendor_relationships` (the
  per-pair fee relationship, with `relationship_status` incl.
  `grandfathered_2_percent`) and `dvr_audit_log` (attest/confirm/override trail).
  These back the grandfathered 1% protected fee.

## Other notable schema files

`schema-native-auth.sql` (users, sessions, verify/reset tokens), `schema.sql`
(core: companies, company_members, vendor_profiles, buildings, packages, bids,
bid_line_items, bid_revisions, threads, messages, documents, reviews,
notifications, subscriptions, payouts), plus per-feature files: `schema-award-workflow`,
`schema-payouts`, `schema-revenue`, `schema-subscriptions`, `schema-vendor-pricing`,
`schema-fee-matrix`, `schema-products`, `schema-quote-compare`, `schema-submittals`
(approvals), `schema-delivery`, `schema-change-orders`, `schema-engagements`,
`schema-project-roles`, `schema-project-templates`, `schema-crm`, `schema-contacts`,
`schema-campaigns`, `schema-agreements`, `schema-split-terms`, `schema-moat`,
`schema-coo`, `schema-investment(-governance)`, `schema-superadmin`,
`schema-teasers-profiles`, `schema-profile-collateral`, `schema-vendor-import`,
`schema-invite-prefill`, `schema-roles-onboarding`, `schema-developer-onboarding`,
`schema-onboarding-samples`, `schema-rfq-assist`, `schema-bid-invites`,
`schema-approvals`, `schema-procure-rev`.

## Notes for editors

- New tables/columns must be **idempotent** (`if not exists`) and added to
  `apply-all.sql` in parents-first order.
- A NULL limit means **unlimited** in the entitlements model.
- Money is integer **cents** everywhere.
- `supabase/migrations/*` are legacy (pre self-host); do not apply them.

> TODO(owner): a column-level data dictionary per table is not maintained here.
> Read the relevant `schema-*.sql` when you need exact columns.
