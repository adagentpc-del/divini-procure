-- Divini Procure - FEE MATRIX + payer_type
-- =========================================================
-- The SINGLE SOURCE OF TRUTH for platform fee percentages, caps, and fee types.
-- Nothing in the app hard-codes a fee percentage or cap: server/src/lib/
-- fee-matrix.ts resolves every fee (standard platform, existing-relationship,
-- platform infrastructure, preferred vendor placement, white glove, referral
-- partner, capital introduction) from this table, with a payer_type dimension
-- (who pays / how it is collected) and a scope dimension (global default, or
-- scoped to a specific developer, vendor, developer-vendor pair, or program).
-- An enterprise org's custom fee schedule is just a developer- or
-- vendor-scoped row that outranks the global default.
--
-- This does NOT touch developer_vendor_relationships: a pair already
-- grandfathered (relationship_status = 'grandfathered_2_percent') ALWAYS wins
-- for the standard_platform rule type and is resolved first in
-- server/src/lib/fee-matrix.ts. The matrix only decides what applies when no
-- grandfathered pair governs the context, and governs every other rule type
-- (including platform_infrastructure_fee) unconditionally.
--
-- The legacy uncapped 10% default and the legacy hard-coded 2%/1% capped
-- success-fee model are both retired; this table is authoritative for both.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-fee-matrix.sql
-- Zero em dashes by convention. Integer cents (flat_cents bigint, cap_cents bigint).

create table if not exists fee_rules (
  id uuid primary key default gen_random_uuid(),

  -- grandfathered_2pct (informational mirror only; the live grandfathered rate
  -- is resolved from developer_vendor_relationships, never from this table) |
  -- standard_platform | preferred_vendor_placement | white_glove |
  -- referral_partner | capital_introduction
  rule_type text not null check (rule_type in (
    'grandfathered_2pct',
    'standard_platform',
    'platform_infrastructure_fee',
    'preferred_vendor_placement',
    'white_glove',
    'referral_partner',
    'capital_introduction'
  )),

  -- global | developer | vendor | pair | program
  scope text not null default 'global' check (scope in (
    'global', 'developer', 'vendor', 'pair', 'program'
  )),

  developer_company_id uuid references companies(id) on delete cascade,
  vendor_company_id    uuid references companies(id) on delete cascade,
  program_id           uuid,

  percentage numeric,
  flat_cents bigint,
  -- cap on the percentage fee, in cents. Null/0 = uncapped. Used by
  -- standard_platform, grandfathered_2pct, and platform_infrastructure_fee so
  -- a large award never carries a punitive fee. Enterprise orgs get a custom
  -- schedule via a developer/vendor-scoped row with its own percentage + cap.
  cap_cents bigint,

  -- developer_pays | vendor_pays | split_fee | deducted_from_vendor_payment |
  -- added_to_developer_invoice | admin_configured
  payer_type text not null default 'admin_configured' check (payer_type in (
    'developer_pays',
    'vendor_pays',
    'split_fee',
    'deducted_from_vendor_payment',
    'added_to_developer_invoice',
    'admin_configured'
  )),

  billing_cycle text,
  active boolean not null default true,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fee_rules_rule_type on fee_rules (rule_type);
create index if not exists idx_fee_rules_developer on fee_rules (developer_company_id);
create index if not exists idx_fee_rules_vendor on fee_rules (vendor_company_id);

-- Defensive re-run: if fee_rules already existed from an earlier apply (before
-- cap_cents / platform_infrastructure_fee existed), bring it up to date.
alter table if exists fee_rules add column if not exists cap_cents bigint;
alter table if exists fee_rules drop constraint if exists fee_rules_rule_type_check;
alter table if exists fee_rules add constraint fee_rules_rule_type_check check (rule_type in (
  'grandfathered_2pct',
  'standard_platform',
  'platform_infrastructure_fee',
  'preferred_vendor_placement',
  'white_glove',
  'referral_partner',
  'capital_introduction'
));

create table if not exists fee_rule_audit (
  id uuid primary key default gen_random_uuid(),
  fee_rule_id uuid,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fee_rule_audit_rule on fee_rule_audit (fee_rule_id);

-- ---------------------------------------------------------------------------
-- Seed default GLOBAL rules. There is no unique constraint to lean on (a scope
-- may legitimately have many rows), so each seed inserts only when no global
-- row of that rule_type exists yet. Re-running is a no-op.
-- ---------------------------------------------------------------------------

-- Standard platform fee: 5%, capped at $25,000, developer pays. This is the
-- SINGLE source of truth for the standard marketplace transaction fee; the old
-- uncapped 10% legacy default is retired.
insert into fee_rules (rule_type, scope, percentage, cap_cents, payer_type, notes, created_by)
select 'standard_platform', 'global', 5.0, 2500000, 'developer_pays',
       'Standard Divini Procure platform fee: 5% of the transaction, capped at $25,000.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'standard_platform' and scope = 'global'
);

-- Migrate a pre-existing global standard_platform row that still carries the
-- retired 10%/uncapped default forward to the current 5%/$25,000 model. Only
-- touches rows that still match the old seed exactly, never an admin edit.
update fee_rules
   set percentage = 5.0, cap_cents = 2500000,
       notes = 'Standard Divini Procure platform fee: 5% of the transaction, capped at $25,000.',
       updated_at = now()
 where rule_type = 'standard_platform' and scope = 'global'
   and percentage = 10.0 and cap_cents is null;

-- Existing vendor relationship (grandfathered) fee: 2%, capped at $10,000.
-- Informational mirror only: the LIVE grandfathered rate for a specific pair is
-- always resolved from developer_vendor_relationships (see fee-rules.ts), which
-- always wins over this row. This row exists so the rate/cap is visible and
-- editable in the admin fee matrix, and is the fallback for the cap when a pair
-- is grandfathered without a relationship-level percentage override.
insert into fee_rules (rule_type, scope, percentage, cap_cents, payer_type, notes, created_by)
select 'grandfathered_2pct', 'global', 2.0, 1000000, 'vendor_pays',
       'Existing vendor relationship fee: 2% of the transaction, capped at $10,000.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'grandfathered_2pct' and scope = 'global'
);

-- Platform infrastructure fee: 0.1%, capped at $1,500. Always shown as its own
-- line item, never merged into the platform fee and never labeled as a
-- payment-processor fee. Applies at the same rate regardless of grandfathered
-- status (see fee-matrix.ts: this rule type is excluded from the grandfathered
-- pair short-circuit).
insert into fee_rules (rule_type, scope, percentage, cap_cents, payer_type, notes, created_by)
select 'platform_infrastructure_fee', 'global', 0.1, 150000, 'deducted_from_vendor_payment',
       'Platform infrastructure fee: 0.1% of the transaction, capped at $1,500.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'platform_infrastructure_fee' and scope = 'global'
);

-- Preferred vendor placement: flat monthly placement fee, vendor pays.
insert into fee_rules (rule_type, scope, flat_cents, payer_type, billing_cycle, notes, created_by)
select 'preferred_vendor_placement', 'global', 50000, 'vendor_pays', 'monthly',
       'Flat monthly preferred placement fee charged to the vendor.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'preferred_vendor_placement' and scope = 'global'
);

-- White glove concierge service: percentage, developer pays.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'white_glove', 'global', 15.0, 'developer_pays',
       'White glove concierge procurement service fee.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'white_glove' and scope = 'global'
);

-- Referral partner share: percentage, admin configured per arrangement.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'referral_partner', 'global', 5.0, 'admin_configured',
       'Referral partner revenue share. Configure per arrangement.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'referral_partner' and scope = 'global'
);

-- Capital introduction fee: percentage, admin configured.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'capital_introduction', 'global', 2.0, 'admin_configured',
       'Capital introduction fee for investor matching. Configure per arrangement.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'capital_introduction' and scope = 'global'
);
