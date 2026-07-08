-- Divini Procure - Existing-Vendor CSV Import batch log (optional, additive).
--
-- One row per committed import batch, summarising what the developer brought in:
-- how many rows, how many new starter vendor profiles were created, how many
-- rows linked to an existing vendor company, how many grandfathered relationship
-- attestations were queued for admin review, and how many rows errored.
--
-- This is a log only. No fee logic lives here; grandfathered relationships are
-- written through developer_vendor_relationships via lib/relationships.ts, which
-- keeps the pair-scoped 2% rule and admin-review gating intact.
-- Idempotent. Zero em dashes by convention.

create table if not exists vendor_import_batches (
  id                    uuid primary key default gen_random_uuid(),
  developer_company_id  uuid not null references companies(id) on delete cascade,
  row_count             int not null default 0,
  created_count         int not null default 0,
  linked_count          int not null default 0,
  grandfathered_count   int not null default 0,
  error_count           int not null default 0,
  created_by            text references users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists vendor_import_batches_developer_idx
  on vendor_import_batches(developer_company_id);
