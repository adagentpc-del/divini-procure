-- Divini Procure - GENERIC CONTACTS + CSV IMPORT BATCHES
-- ======================================================
-- Net-new, additive layer that backs the generic admin CSV Import tool. Two
-- tables:
--
--   contacts        a lightweight, generic contact/lead record (people or
--                   organizations) that an admin can bulk-import. Optionally
--                   scoped to an owning company (owner_company_id). The
--                   exists_in_partner flag supports MANUAL cross-platform
--                   de-dup against Divini Partner.
--
--   import_batches  one summary row per committed import run (any entity type),
--                   recording how many rows were created / skipped as duplicates
--                   / errored, plus who ran it and when.
--
-- These are the ONLY new tables the generic import tool requires. Developers
-- (companies.kind='buyer'), investors (investor_profiles) and products
-- (products) all already exist; the import tool writes into those existing
-- tables directly and never alters them.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-contacts.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-contacts.sql)
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Generic contact / lead record. owner_company_id is optional (a contact may
-- belong to a developer organization, or be unscoped at the platform level).
-- exists_in_partner is a MANUAL flag for cross-platform de-dup against Divini
-- Partner; nothing sets it automatically.
-- ---------------------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid,
  name text,
  email text,
  phone text,
  company_name text,
  role text,
  source text,
  exists_in_partner boolean default false,
  notes text,
  created_by text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- One summary row per committed import run (developers / investors / contacts /
-- products). Lets an admin audit what each import did.
-- ---------------------------------------------------------------------------
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  entity_type text,
  row_count int,
  created_count int,
  duplicate_count int,
  error_count int,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_contacts_owner_company on contacts (owner_company_id);
