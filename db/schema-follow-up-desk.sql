-- ============================================================================
-- Divini Procure - DIVINI FOLLOW-UP DESK (rules-based reminders, no LLM)
-- ----------------------------------------------------------------------------
-- A workflow is a named sequence of steps (delay, condition, action,
-- template) that runs against a specific record - a stale Divini Pipeline
-- opportunity, an unsubmitted Divini Bid Studio draft, a bid expiring soon, a
-- scope left in draft, or a vendor credential nearing expiry. Every step's
-- WORDING comes from a fixed template with {{merge_field}} substitution
-- (server/src/lib/follow-up-scheduling.ts renderTemplate) and every
-- CONDITION is a named, deterministic check against the linked record's
-- current state (server/src/routes/follow-up.ts) - nothing here is
-- generated text.
--
--   follow_up_templates  - reusable message bodies (global defaults +
--     org-specific), one per (workflow_key, step_order) pairing by convention.
--   follow_up_workflows / follow_up_steps - the rule definitions. Global
--     defaults (organization_id null) ship seeded; an org can add its own.
--   follow_up_enrollments - one row per (workflow, record) actively running.
--     Unique per workflow+record so a record is never double-enrolled.
--   follow_up_actions - the execution log: what fired, when, and whether it
--     succeeded - the audit trail for "which follow-up closed the deal."
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-follow-up-desk.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists follow_up_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade, -- null = global default
  template_key text not null,
  channel text not null default 'email' check (channel in ('email', 'in_app_notification', 'task')),
  subject text,
  body text not null,
  created_by text references users(id),
  created_at timestamptz default now()
);
create index if not exists idx_follow_up_templates_org_key on follow_up_templates (organization_id, template_key);

create table if not exists follow_up_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade, -- null = global default
  workflow_key text not null,
  name text not null,
  context_type text not null
    check (context_type in ('pipeline_opportunity', 'bid_draft', 'bid_submitted', 'scope_instance', 'vendor_credential')),
  active boolean not null default true,
  -- statuses on the linked record that mean "stop, this is resolved"
  stop_on_statuses text[] not null default '{}',
  created_by text references users(id),
  created_at timestamptz default now()
);
create index if not exists idx_follow_up_workflows_org_context on follow_up_workflows (organization_id, context_type);

create table if not exists follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references follow_up_workflows(id) on delete cascade,
  step_order int not null default 0,
  delay_value int not null default 0,
  delay_unit text not null default 'days' check (delay_unit in ('minutes', 'hours', 'days', 'business_days')),
  -- a named, deterministic condition checked in code before firing; null = always fire
  condition_code text,
  action_type text not null check (action_type in ('send_email', 'notify', 'create_task')),
  template_id uuid references follow_up_templates(id) on delete set null,
  assigned_role text default 'owner' check (assigned_role in ('owner', 'admin')),
  requires_approval boolean not null default false,
  created_at timestamptz default now(),
  unique (workflow_id, step_order)
);
create index if not exists idx_follow_up_steps_workflow on follow_up_steps (workflow_id, step_order);

create table if not exists follow_up_enrollments (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references follow_up_workflows(id) on delete cascade,
  organization_id uuid not null references companies(id) on delete cascade,
  context_type text not null,
  context_id uuid not null,
  current_step int not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'completed')),
  enrolled_at timestamptz not null default now(),
  next_action_at timestamptz,
  completed_at timestamptz,
  stop_reason text,
  created_by text references users(id),
  unique (workflow_id, context_type, context_id)
);
create index if not exists idx_follow_up_enrollments_due on follow_up_enrollments (status, next_action_at) where status = 'active';
create index if not exists idx_follow_up_enrollments_org on follow_up_enrollments (organization_id);
create index if not exists idx_follow_up_enrollments_context on follow_up_enrollments (context_type, context_id);

create table if not exists follow_up_actions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references follow_up_enrollments(id) on delete cascade,
  step_id uuid references follow_up_steps(id) on delete set null,
  action_type text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed', 'awaiting_approval')),
  scheduled_at timestamptz not null default now(),
  executed_at timestamptz,
  approved_by text references users(id),
  failure_reason text,
  created_at timestamptz default now()
);
create index if not exists idx_follow_up_actions_enrollment on follow_up_actions (enrollment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Seed 4 global default workflows covering the highest-value cases across
-- the three tools built so far. Idempotent: only inserts when no global
-- workflow of that workflow_key exists yet. Organizations can add their own.
-- ---------------------------------------------------------------------------

-- 1) A Divini Pipeline opportunity with no logged activity in 14 days.
insert into follow_up_templates (organization_id, template_key, channel, subject, body)
select null, 'pipeline_stale_opportunity_step1', 'notify', null,
       'No activity logged on "{{opportunityName}}" in 14 days. Log a call, note, or next action to keep it moving.'
where not exists (select 1 from follow_up_templates where organization_id is null and template_key = 'pipeline_stale_opportunity_step1');

insert into follow_up_workflows (organization_id, workflow_key, name, context_type, stop_on_statuses)
select null, 'pipeline_stale_opportunity', 'Stale opportunity follow-up', 'pipeline_opportunity', array['won','lost']
where not exists (select 1 from follow_up_workflows where organization_id is null and workflow_key = 'pipeline_stale_opportunity');

insert into follow_up_steps (workflow_id, step_order, delay_value, delay_unit, condition_code, action_type, template_id, assigned_role)
select w.id, 0, 14, 'days', 'no_recent_activity_14d', 'notify', t.id, 'owner'
  from follow_up_workflows w, follow_up_templates t
 where w.organization_id is null and w.workflow_key = 'pipeline_stale_opportunity'
   and t.organization_id is null and t.template_key = 'pipeline_stale_opportunity_step1'
   and not exists (select 1 from follow_up_steps s where s.workflow_id = w.id and s.step_order = 0);

-- 2) A Divini Bid Studio draft left unsubmitted for 5 days.
insert into follow_up_templates (organization_id, template_key, channel, subject, body)
select null, 'bid_draft_stale_step1', 'notify', null,
       'Your bid draft has been sitting for 5 days. Finish it in Divini Bid Studio before the package closes.'
where not exists (select 1 from follow_up_templates where organization_id is null and template_key = 'bid_draft_stale_step1');

insert into follow_up_workflows (organization_id, workflow_key, name, context_type, stop_on_statuses)
select null, 'bid_draft_stale', 'Unfinished bid draft reminder', 'bid_draft', array['submitted','shortlisted','awarded','revision']
where not exists (select 1 from follow_up_workflows where organization_id is null and workflow_key = 'bid_draft_stale');

insert into follow_up_steps (workflow_id, step_order, delay_value, delay_unit, condition_code, action_type, template_id, assigned_role)
select w.id, 0, 5, 'days', 'draft_still_open', 'notify', t.id, 'owner'
  from follow_up_workflows w, follow_up_templates t
 where w.organization_id is null and w.workflow_key = 'bid_draft_stale'
   and t.organization_id is null and t.template_key = 'bid_draft_stale_step1'
   and not exists (select 1 from follow_up_steps s where s.workflow_id = w.id and s.step_order = 0);

-- 3) A submitted bid whose expiration date is within 3 days.
insert into follow_up_templates (organization_id, template_key, channel, subject, body)
select null, 'bid_expiring_soon_step1', 'email', 'Your bid expires soon',
       'Your bid on package {{packageId}} expires on {{expiresAt}}. Contact the developer if you need an extension.'
where not exists (select 1 from follow_up_templates where organization_id is null and template_key = 'bid_expiring_soon_step1');

insert into follow_up_workflows (organization_id, workflow_key, name, context_type, stop_on_statuses)
select null, 'bid_expiring_soon', 'Bid expiring reminder', 'bid_submitted', array['awarded','revision']
where not exists (select 1 from follow_up_workflows where organization_id is null and workflow_key = 'bid_expiring_soon');

insert into follow_up_steps (workflow_id, step_order, delay_value, delay_unit, condition_code, action_type, template_id, assigned_role)
select w.id, 0, 0, 'days', 'expiring_within_3d', 'send_email', t.id, 'owner'
  from follow_up_workflows w, follow_up_templates t
 where w.organization_id is null and w.workflow_key = 'bid_expiring_soon'
   and t.organization_id is null and t.template_key = 'bid_expiring_soon_step1'
   and not exists (select 1 from follow_up_steps s where s.workflow_id = w.id and s.step_order = 0);

-- 4) A vendor credential (license/insurance/etc) expiring within 30 days.
insert into follow_up_templates (organization_id, template_key, channel, subject, body)
select null, 'credential_expiring_step1', 'email', 'Credential expiring soon',
       'Your {{credentialType}} expires on {{expiresAt}}. Renew and re-upload it to stay eligible to bid.'
where not exists (select 1 from follow_up_templates where organization_id is null and template_key = 'credential_expiring_step1');

insert into follow_up_workflows (organization_id, workflow_key, name, context_type, stop_on_statuses)
select null, 'credential_expiring', 'Credential expiry reminder', 'vendor_credential', array['expired']
where not exists (select 1 from follow_up_workflows where organization_id is null and workflow_key = 'credential_expiring');

insert into follow_up_steps (workflow_id, step_order, delay_value, delay_unit, condition_code, action_type, template_id, assigned_role)
select w.id, 0, 0, 'days', 'credential_expiring_30d', 'send_email', t.id, 'owner'
  from follow_up_workflows w, follow_up_templates t
 where w.organization_id is null and w.workflow_key = 'credential_expiring'
   and t.organization_id is null and t.template_key = 'credential_expiring_step1'
   and not exists (select 1 from follow_up_steps s where s.workflow_id = w.id and s.step_order = 0);
