-- ============================================================================
-- Divini Procure — RFQ ASSIST schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Adds CAD/spec file categorisation to the existing `documents` table and a new
-- `rfq_suggested_lines` table that holds the DETERMINISTIC auto-suggested bid /
-- RFQ line items the developer can review and accept into the real BOQ
-- (package_line_items).
--
-- This file is ADDITIVE and IDEMPOTENT (alter ... if not exists / create table
-- if not exists). It is applied the SAME WAY as db/schema.sql — run once against
-- the local Postgres AFTER db/schema.sql (+ db/schema-superadmin.sql):
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-rfq-assist.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-rfq-assist.sql)
--
-- Re-running it is safe. Zero em dashes by convention of the ported routers.
--
-- NOTE: `documents` already links to packages (package_id uuid references
-- packages(id) on delete set null) and buildings, so NO new link column is
-- needed. We only add `category` to tag what kind of drawing/spec a file is.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- documents: category tag ----------
-- Classifies an uploaded file so the suggester knows which uploads are text
-- specs vs binary CAD. Values used by the app: cad | spec | drawing |
-- finish_schedule | other. Left nullable; existing rows keep null.
alter table documents add column if not exists category text;

-- ---------- rfq_suggested_lines ----------
-- Deterministic auto-suggested line items for a package's RFQ/BOQ. These are
-- NOT the real bill of quantities; the developer reviews them and accepts the
-- ones they want, which then get inserted into package_line_items and the
-- suggestion is marked 'applied'.
create table if not exists rfq_suggested_lines (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  name text,
  category text,
  qty numeric,
  unit text,
  spec text,
  notes text,
  status text default 'suggested',   -- suggested | applied | dismissed
  created_at timestamptz default now()
);

create index if not exists idx_rfq_suggested_package on rfq_suggested_lines(package_id);
create index if not exists idx_documents_category on documents(category);
