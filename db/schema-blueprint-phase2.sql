-- ============================================================================
-- Divini Procure - DIVINI BLUEPRINT PHASE 2 (CSI divisions, budget import,
-- quantity observations) - the pieces of the CAD/Drawing/Plan/Specification/
-- Bid Intelligence master spec buildable with NO additional external
-- service or API key: pure deterministic logic and manual data entry only.
-- ----------------------------------------------------------------------------
--
-- CSI DIVISION: documents gain a low-confidence, filename/discipline-
-- derived CSI division guess (server/src/lib/csi-divisions.ts), same
-- override-locking pattern as document_category/discipline.
--
-- BUDGET IMPORT: budget_imports / budget_import_lines. CSV only - this
-- codebase has no spreadsheet-parsing library (no xlsx/exceljs in
-- package.json), so server/src/lib/csv-parser.ts is a small dependency-free
-- CSV parser, and XLS/XLSX import is explicitly unsupported rather than
-- silently mishandled. Each row is matched against the project's existing
-- packages by deterministic keyword overlap
-- (server/src/lib/budget-mapper.ts), never auto-applied - status stays
-- 'unmapped' until a human confirms or reassigns it.
--
-- QUANTITY OBSERVATIONS: quantity_observations. NEVER AI-populated - this
-- codebase cannot read drawing content, so unlike everything else in
-- Divini Blueprint there is no "suggested" value here at all, only a
-- manual-entry table. The `source` column is deliberately constrained to
-- always equal 'user_entered' as a guardrail: a future change that wanted
-- to add an AI-derived source would have to consciously alter this schema,
-- not quietly repurpose the column.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table if exists documents add column if not exists csi_division_code text;
alter table if exists documents add column if not exists csi_division_name text;
alter table if exists documents add column if not exists csi_division_confidence text
  check (csi_division_confidence in ('medium', 'low'));
alter table if exists documents add column if not exists csi_division_overridden_by_user boolean not null default false;

create index if not exists idx_documents_csi_division on documents (csi_division_code);

create table if not exists budget_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  source_document_id uuid references documents(id) on delete set null,
  filename text,
  row_count int not null default 0,
  skipped_row_count int not null default 0,
  created_by text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_budget_imports_building on budget_imports (building_id);

create table if not exists budget_import_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references budget_imports(id) on delete cascade,
  raw_category text,
  raw_description text,
  raw_amount text,
  amount_cents bigint not null,
  matched_package_id uuid references packages(id) on delete set null,
  match_confidence text check (match_confidence in ('medium', 'low')),
  match_overridden_by_user boolean not null default false,
  status text not null default 'unmapped' check (status in ('unmapped', 'mapped', 'ignored')),
  created_at timestamptz not null default now()
);
create index if not exists idx_budget_import_lines_import on budget_import_lines (import_id);
create index if not exists idx_budget_import_lines_package on budget_import_lines (matched_package_id);

create table if not exists quantity_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  description text not null,
  quantity numeric not null,
  unit text,
  source text not null default 'user_entered' check (source = 'user_entered'),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified')),
  notes text,
  created_by text references users(id),
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_quantity_observations_building on quantity_observations (building_id);
create index if not exists idx_quantity_observations_package on quantity_observations (package_id);
