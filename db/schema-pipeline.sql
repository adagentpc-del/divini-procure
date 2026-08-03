-- ============================================================================
-- Divini Procure - DIVINI PIPELINE (user-facing sales / procurement CRM)
-- ----------------------------------------------------------------------------
-- NOT to be confused with db/schema-crm.sql (crm_records), which is Divini's
-- own INTERNAL sales pipeline for signing up developers/vendors/investors as
-- customers. Divini Pipeline is the opposite: a tool END USERS use to run
-- their OWN sales/procurement funnel on the platform.
--
--   VENDOR profile_type: tracks bid opportunities they are pursuing (an
--   inquiry, an invited package, a direct RFQ) from first contact through
--   award or loss. An opportunity MAY link to a real packages/bids row once
--   one exists, or stand alone as an early-stage lead before it does.
--
--   DEVELOPER profile_type: tracks their own vendor-sourcing/procurement
--   funnel per package - which vendors they are courting, at what stage,
--   with what next action - independent of (but linkable to) the formal
--   bids already submitted against a packages row.
--
-- Design principle (see AI_PROJECT_OS Capital Partner module notes): this is
-- a SHARED ENGINE. One set of tables serves both profile types via
-- profile_type + org-customizable stage definitions, rather than duplicating
-- a parallel schema per profile.
--
-- An opportunity belongs to exactly one organization_id (the company running
-- ITS OWN funnel); it is not a shared record between two companies the way a
-- purchase order is. Access = member of organization_id, or admin.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-pipeline.sql
-- Zero em dashes by convention. Integer cents (estimated_value_cents bigint).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Stage definitions. Global defaults (organization_id is null) ship seeded
-- per profile_type; an organization may add its own custom stage set later
-- (a role-specific pipeline template, per the spec) by inserting rows with
-- its own organization_id - those take precedence over the global default in
-- the app layer, not via a DB constraint.
-- ---------------------------------------------------------------------------
create table if not exists pipeline_stage_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade,  -- null = global default
  profile_type text not null check (profile_type in ('vendor', 'developer')),
  stage_key text not null,
  label text not null,
  sort_order int not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_pipeline_stage_defs_org_profile
  on pipeline_stage_definitions (organization_id, profile_type);

-- ---------------------------------------------------------------------------
-- The opportunity record itself.
-- ---------------------------------------------------------------------------
create table if not exists pipeline_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  profile_type text not null check (profile_type in ('vendor', 'developer')),

  name text not null,

  -- counterparty: an existing company account, or free-text before one exists
  client_company_id uuid references companies(id) on delete set null,
  client_name text,
  client_email text,
  client_phone text,

  -- links into the real procurement records once they exist
  package_id uuid references packages(id) on delete set null,
  bid_id uuid references bids(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,

  category text,
  source text,
  estimated_value_cents bigint,
  probability_basis_points int not null default 5000
    check (probability_basis_points between 0 and 10000),

  stage_key text not null default 'new',
  status text not null default 'open' check (status in ('open', 'won', 'lost')),

  owner_user_id text references users(id),
  next_action text,
  next_action_date date,
  expected_close_date date,
  last_activity_at timestamptz,

  loss_reason_id uuid,
  loss_notes text,
  won_at timestamptz,
  lost_at timestamptz,

  notes text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pipeline_opps_org on pipeline_opportunities (organization_id);
create index if not exists idx_pipeline_opps_stage on pipeline_opportunities (organization_id, stage_key);
create index if not exists idx_pipeline_opps_status on pipeline_opportunities (organization_id, status);
create index if not exists idx_pipeline_opps_owner on pipeline_opportunities (owner_user_id);
create index if not exists idx_pipeline_opps_package on pipeline_opportunities (package_id);

-- Append-only. Never update or delete a row: the full stage history is the
-- audit trail for how long an opportunity sat in each stage.
create table if not exists pipeline_stage_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references pipeline_opportunities(id) on delete cascade,
  from_stage_key text,
  to_stage_key text not null,
  changed_by text references users(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_pipeline_stage_history_opp on pipeline_stage_history (opportunity_id);

-- Logged interactions (calls, emails, notes, meetings, site visits). This is
-- what "last_activity_at" and the readiness score's recency signal read from.
create table if not exists pipeline_activities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references pipeline_opportunities(id) on delete cascade,
  activity_type text not null default 'note'
    check (activity_type in ('note', 'call', 'email', 'meeting', 'site_visit', 'system')),
  body text,
  created_by text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_activities_opp on pipeline_activities (opportunity_id, created_at desc);

-- Next-action tasks. An opportunity's single "next_action" field is a quick
-- summary; this table is the real, trackable task list behind it.
create table if not exists pipeline_tasks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references pipeline_opportunities(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  assigned_to text references users(id),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by text references users(id),
  created_by text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_tasks_opp on pipeline_tasks (opportunity_id);
create index if not exists idx_pipeline_tasks_due on pipeline_tasks (assigned_to, due_at) where status = 'open';

create table if not exists pipeline_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  label text not null,
  created_at timestamptz default now(),
  unique (organization_id, label)
);
create table if not exists pipeline_opportunity_tags (
  opportunity_id uuid not null references pipeline_opportunities(id) on delete cascade,
  tag_id uuid not null references pipeline_tags(id) on delete cascade,
  primary key (opportunity_id, tag_id)
);

-- Configurable catalogs. Global defaults (organization_id null) ship seeded;
-- an organization may add its own.
create table if not exists pipeline_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);
create table if not exists pipeline_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Seed default stage definitions. Idempotent: only inserts when no global
-- (organization_id is null) row of that profile_type + stage_key exists yet.
-- ---------------------------------------------------------------------------
insert into pipeline_stage_definitions (organization_id, profile_type, stage_key, label, sort_order, is_won, is_lost)
select null, v.profile_type, v.stage_key, v.label, v.sort_order, v.is_won, v.is_lost
from (values
  -- VENDOR: pursuing bid opportunities
  ('vendor', 'new',              'New',               10, false, false),
  ('vendor', 'reviewing',        'Reviewing',         20, false, false),
  ('vendor', 'qualified',        'Qualified',         30, false, false),
  ('vendor', 'info_needed',      'Information Needed',40, false, false),
  ('vendor', 'bid_in_progress',  'Bid In Progress',   50, false, false),
  ('vendor', 'bid_submitted',    'Bid Submitted',     60, false, false),
  ('vendor', 'negotiation',      'Negotiation',       70, false, false),
  ('vendor', 'awarded',          'Awarded',           80, true,  false),
  ('vendor', 'lost',             'Lost',              90, false, true),
  -- DEVELOPER: sourcing vendors for a package
  ('developer', 'new',               'New',                10, false, false),
  ('developer', 'reviewing',         'Reviewing',          20, false, false),
  ('developer', 'info_needed',       'Information Needed',30, false, false),
  ('developer', 'sourcing_vendors',  'Sourcing Vendors',  40, false, false),
  ('developer', 'bids_in',           'Bids In',            50, false, false),
  ('developer', 'comparing',         'Comparing',          60, false, false),
  ('developer', 'negotiation',       'Negotiation',        70, false, false),
  ('developer', 'awarded',           'Awarded',            80, true,  false),
  ('developer', 'lost',              'Lost',               90, false, true)
) as v(profile_type, stage_key, label, sort_order, is_won, is_lost)
where not exists (
  select 1 from pipeline_stage_definitions d
   where d.organization_id is null and d.profile_type = v.profile_type and d.stage_key = v.stage_key
);

-- Seed default loss reasons (global).
insert into pipeline_loss_reasons (organization_id, label)
select null, r.label
from (values ('Price'), ('Timeline'), ('Lost to competitor'), ('Scope mismatch'),
             ('Client went quiet'), ('Budget cancelled'), ('Other')) as r(label)
where not exists (
  select 1 from pipeline_loss_reasons l where l.organization_id is null and l.label = r.label
);

-- Seed default sources (global).
insert into pipeline_sources (organization_id, label)
select null, s.label
from (values ('Marketplace match'), ('Direct inquiry'), ('Referral'), ('Repeat client'),
             ('Cold outreach'), ('Invited to bid'), ('Other')) as s(label)
where not exists (
  select 1 from pipeline_sources p where p.organization_id is null and p.label = s.label
);
