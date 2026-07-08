-- Divini Procure - ADMIN TASK MANAGEMENT
-- ======================================
-- Lightweight admin-facing task tracker. Tasks can optionally point at any
-- platform entity (account, project, vendor, investor, document, claim, bid,
-- opportunity, program) via a soft (linked_type, linked_id) reference, with no
-- foreign key, so the tracker stays additive and never blocks deletes.
--
-- Admin-only surface. Idempotent: safe to re-run. Apply standalone via psql:
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-admin-tasks.sql
-- Zero em dashes by convention.

create table if not exists admin_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  detail      text,
  linked_type text check (linked_type in (
                'account', 'project', 'vendor', 'investor', 'document',
                'claim', 'bid', 'opportunity', 'program', 'other')),
  linked_id   uuid,
  assigned_to text,
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status      text not null default 'open'   check (status in ('open', 'in_progress', 'done', 'dismissed')),
  due_date    date,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists admin_tasks_status_idx      on admin_tasks (status);
create index if not exists admin_tasks_assigned_to_idx on admin_tasks (assigned_to);
