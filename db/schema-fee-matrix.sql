-- Divini Procure - FEE MATRIX + payer_type
-- =========================================================
-- Additive layer on top of the grandfathered existing-relationship fee.
-- A configurable matrix of platform fee rules (standard platform fee, preferred
-- vendor placement, white glove, referral partner, capital introduction) with a
-- payer_type dimension (who pays / how it is collected) and a scope dimension
-- (global default, or scoped to a specific developer, vendor, developer-vendor
-- pair, or program). This does NOT touch developer_vendor_relationships: a pair
-- already grandfathered (relationship_status = 'grandfathered_2_percent') ALWAYS
-- wins and is resolved first in server/src/lib/fee-matrix.ts. The matrix only
-- decides what applies when no grandfathered pair governs the context.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-fee-matrix.sql
-- Zero em dashes by convention. Integer cents (flat_cents bigint).

create table if not exists fee_rules (
  id uuid primary key default gen_random_uuid(),

  -- grandfathered_2pct (informational mirror only; the live grandfathered rate
  -- is resolved from developer_vendor_relationships, never from this table) |
  -- standard_platform | preferred_vendor_placement | white_glove |
  -- referral_partner | capital_introduction
  rule_type text not null check (rule_type in (
    'grandfathered_2pct',
    'standard_platform',
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

-- Standard platform fee: 10% default, developer pays.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'standard_platform', 'global', 10.0, 'developer_pays',
       'Default Divini Procure platform/referral fee.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'standard_platform' and scope = 'global'
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
