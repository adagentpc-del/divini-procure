-- ============================================================================
-- Divini Procure - Email Campaigns schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A campaign is a named, segment-scoped email (subject + html body) that an
-- admin drafts, sends a TEST of to themselves (or any address), and then
-- EXPLICITLY approves to broadcast to the resolved, deduped audience. The
-- approve-and-send step is the ONLY place mail goes out to the segment; nothing
-- here auto-sends, and a test send is required before approval.
--
-- Recipients are snapshotted per send into campaign_recipients, each row marked
-- sent or failed so the send result is auditable.
--
-- This file is ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply
-- it the SAME WAY as db/schema.sql, once, against the local Postgres AFTER
-- db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-campaigns.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-campaigns.sql)
--
-- Re-running it is safe. Zero em dashes by convention of the ported routers.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- email campaigns ----------
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_html text not null default '',
  segment text not null default 'all_companies',
  status text not null default 'draft'
    check (status in ('draft', 'test_sent', 'approved', 'sending', 'sent', 'cancelled')),
  test_sent_to text,
  test_sent_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- per-send recipient snapshot ----------
create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  email text not null,
  name text,
  company_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  error text
);

create index if not exists idx_campaign_recipients_campaign on campaign_recipients (campaign_id);
