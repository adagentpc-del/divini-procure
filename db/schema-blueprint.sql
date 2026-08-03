-- ============================================================================
-- Divini Procure - DIVINI BLUEPRINT (document intelligence, no fabrication)
-- ----------------------------------------------------------------------------
-- Extends the EXISTING documents table and /api/documents upload endpoint
-- (server/src/routes.ts) rather than duplicating them - that endpoint
-- already does secure multipart upload, extension/MIME validation, path-
-- traversal-safe storage keys, and pluggable local/S3 storage with envelope
-- encryption. This module adds classification and AI-assisted (optional,
-- gracefully degrading) project-summary drafting on top.
--
-- HONESTY NOTE (as originally written here): at the time this file was
-- written, this codebase had no CAD-parsing or OCR library, so Divini
-- Blueprint classified documents from FILENAME AND EXTENSION ONLY
-- (server/src/lib/document-classifier.ts's classifyDocument()).
-- UPDATE: db/schema-blueprint-content-extraction.sql later added real PDF
-- text extraction and OCR (server/src/lib/text-extraction.ts, ocr.ts) and
-- real DXF parsing (dxf-extraction.ts) - see that file for the current
-- state. classifyDocument() itself is unchanged and still filename-only;
-- the newer classifyFromContent() is the one that reads real content.
-- Binary CAD (DWG/RVT/IFC) still has no reader - see cad-conversion.ts.
-- Its "AI summary" step (server/src/routes/blueprint.ts, using the
-- existing optional server/src/lib/llm.ts client) drafts narrative from
-- classification plus any text the user explicitly supplies - never from
-- file content it cannot see. Every field is a labeled suggestion requiring
-- user review; nothing here is ever auto-published.
--
--   ai_extraction_runs - one row per "run analysis" action against a set of
--     documents. Preserves the exact model/config used (source traceability).
--   blueprint_summary_fields - one row per extracted/suggested project
--     attribute (name, area, unit count, ...), each with its own confidence,
--     source, and user-edit/confirm state - never a single opaque blob.
--   blueprint_trade_suggestions - suggested bid-package trades. Creating an
--     actual package/scope/opportunity from a suggestion is a separate,
--     explicit user action (server/src/routes/blueprint.ts) that links back
--     to the EXISTING packages / scope_instances / pipeline_opportunities
--     tables - Blueprint does not duplicate those.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-blueprint.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- extend the existing documents table ----------
alter table if exists documents add column if not exists discipline text;
alter table if exists documents add column if not exists document_category text;
alter table if exists documents add column if not exists classification_confidence text
  check (classification_confidence in ('high', 'medium', 'low'));
alter table if exists documents add column if not exists classification_rule text;
alter table if exists documents add column if not exists classified_at timestamptz;
alter table if exists documents add column if not exists processing_status text not null default 'uploaded'
  check (processing_status in ('uploaded', 'classifying', 'classified', 'failed'));
alter table if exists documents add column if not exists checksum text;
alter table if exists documents add column if not exists revision_number int not null default 1;
alter table if exists documents add column if not exists revision_label text;
alter table if exists documents add column if not exists parent_document_id uuid references documents(id) on delete set null;
alter table if exists documents add column if not exists confidentiality_level text not null default 'internal'
  check (confidentiality_level in ('internal', 'organization', 'restricted', 'public'));
alter table if exists documents add column if not exists ai_consent boolean not null default true;
alter table if exists documents add column if not exists category_overridden_by_user boolean not null default false;

create index if not exists idx_documents_building on documents (building_id);
create index if not exists idx_documents_category on documents (document_category);

create table if not exists ai_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  building_id uuid references buildings(id) on delete cascade,
  input_document_ids uuid[] not null default '{}',
  -- deterministic-only unless the optional LLM client was configured AND used
  used_ai boolean not null default false,
  ai_model text,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  failure_reason text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_ai_extraction_runs_building on ai_extraction_runs (building_id);

create table if not exists blueprint_summary_fields (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references ai_extraction_runs(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  suggested_value text,
  source_document_id uuid references documents(id) on delete set null,
  source_note text,
  -- high | medium | low | manual_confirmation_required
  confidence text not null default 'low'
    check (confidence in ('high', 'medium', 'low', 'manual_confirmation_required')),
  user_confirmed boolean not null default false,
  user_edited_value text,
  edited_by text references users(id),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (extraction_run_id, field_key)
);
create index if not exists idx_blueprint_summary_fields_building on blueprint_summary_fields (building_id);

create table if not exists blueprint_trade_suggestions (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references ai_extraction_runs(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  trade_category text not null,
  package_title text not null,
  rationale text,
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  supporting_document_count int not null default 0,
  status text not null default 'suggested'
    check (status in ('suggested', 'accepted', 'rejected', 'merged')),
  created_package_id uuid references packages(id) on delete set null,
  created_scope_instance_id uuid references scope_instances(id) on delete set null,
  reviewed_by text references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_blueprint_trade_suggestions_building on blueprint_trade_suggestions (building_id);

-- Links a trade suggestion (or a manually tagged document) to the packages
-- it should inform, beyond the documents.package_id single-package link -
-- a source drawing set often applies to more than one bid package.
create table if not exists blueprint_document_package_links (
  document_id uuid not null references documents(id) on delete cascade,
  package_id uuid not null references packages(id) on delete cascade,
  linked_by text references users(id),
  created_at timestamptz default now(),
  primary key (document_id, package_id)
);
