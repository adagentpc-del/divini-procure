-- ============================================================================
-- Divini Procure - Project Roles: Designer + GC dashboards (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Additive enhancement to the existing schema (db/schema.sql). Lets a developer
-- (the building's owning company) invite per-project stakeholders by role
-- (designer, gc, owner, asset_manager, procurement_manager, read_only) and gives
-- Designers and General Contractors their own project workspaces of items.
--
--   * project_stakeholders: who has access to a project, and in what role.
--   * designer_items:       design-side records (finish schedules, samples,
--                           substitutions, aesthetic approvals, FF&E comments).
--   * gc_items:             field/construction records (install requirements,
--                           logistics, dimensions, delivery coordination,
--                           licenses, insurance, field conflicts).
--
-- A developer owns a project when a member of the building's company_id. Access
-- to a project is also granted to anyone with a project_stakeholders row whose
-- email matches the project for that role.
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-project-roles.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. UUID keys via
-- gen_random_uuid(). Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- per-project stakeholders (who can see the project) ----------
create table if not exists project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  company_id uuid,
  email text,
  role text
    check (role in ('designer','gc','owner','asset_manager','procurement_manager','read_only')),
  permissions jsonb,
  invited_by text,
  created_at timestamptz default now(),
  unique (project_id, email, role)
);

create index if not exists project_stakeholders_project_idx
  on project_stakeholders (project_id);

-- ---------- designer items (design-side records on a project) ----------
create table if not exists designer_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  kind text
    check (kind in ('finish_schedule','sample','substitution','aesthetic_approval','ffe_comment')),
  title text,
  detail text,
  status text default 'open'
    check (status in ('open','in_review','approved','rejected','closed')),
  link text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists designer_items_project_idx
  on designer_items (project_id);

-- ---------- gc items (field/construction records on a project) ----------
create table if not exists gc_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  kind text
    check (kind in ('install_requirement','logistics','dimension','delivery_coordination','license','insurance','field_conflict')),
  title text,
  detail text,
  status text default 'open'
    check (status in ('open','in_progress','resolved','blocked','closed')),
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists gc_items_project_idx
  on gc_items (project_id);
