-- Divini Procure - CRM / SALES PIPELINE + DEMO/ONBOARDING MEETINGS
-- ================================================================
-- Admin-facing sales pipeline. A crm_records row is a tracked subject (a
-- developer, vendor, investor, or other prospect) moving through pipeline
-- stages from first contact to active (or paused / lost). onboarding_meetings
-- log demo and onboarding sessions held against a record: requested documents,
-- follow-up tasks, the assigned admin, a profile-completeness score, and an
-- outcome status.
--
-- The subject MAY reference an existing companies(id) and/or users(id), but
-- both are nullable so a brand-new prospect can be tracked before they have an
-- account. This is additive and stands alone; it does not touch any existing
-- table.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-crm.sql
-- Zero em dashes by convention.

create table if not exists crm_records (
  id uuid primary key default gen_random_uuid(),

  -- developer | vendor | investor | other
  subject_type text not null default 'other'
    check (subject_type in ('developer', 'vendor', 'investor', 'other')),
  subject_company_id uuid,
  subject_user_id    text,

  name  text,
  email text,
  phone text,

  -- prospect | contacted | demo_scheduled | onboarding_started | active | paused | lost
  stage text not null default 'prospect'
    check (stage in ('prospect', 'contacted', 'demo_scheduled',
                     'onboarding_started', 'active', 'paused', 'lost')),

  source           text,
  owner_admin      text,
  notes            text,
  next_action      text,
  next_action_date date,

  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists onboarding_meetings (
  id uuid primary key default gen_random_uuid(),
  crm_record_id uuid references crm_records(id) on delete cascade,
  subject_company_id uuid,

  title        text,
  scheduled_at timestamptz,
  notes        text,
  requested_docs   text[],
  follow_up_tasks  text[],
  assigned_admin   text,
  profile_completeness int,

  -- scheduled | completed | no_show | cancelled
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),

  created_by text,
  created_at timestamptz default now()
);

create index if not exists crm_records_stage_idx on crm_records(stage);
create index if not exists onboarding_meetings_record_idx on onboarding_meetings(crm_record_id);
