-- ============================================================================
-- Divini Procure - DIVINI BLUEPRINT: revisions and addenda
-- ----------------------------------------------------------------------------
-- documents already carries parent_document_id / revision_number /
-- revision_label (added in schema-blueprint.sql) but nothing populated or
-- read them yet - server/src/lib/revision-matcher.ts and the
-- /blueprint/documents/:id/suggest-revision-of + /link-revision + /revisions
-- endpoints (server/src/routes/blueprint.ts) close that gap.
--
-- document_addenda is a reviewable bundle of new/revised documents affecting
-- one or more EXISTING packages, taken through draft -> review -> published
-- (published is terminal, same "draft is the only editable state" invariant
-- used by change-orders and Divini Bid Studio elsewhere in this codebase).
-- Publishing notifies every member of every vendor company with a
-- bid_invites or bids row on an affected package: an in-app notifications
-- row always, plus a best-effort email via the existing gracefully-
-- degrading lib/email.ts. document_addendum_acknowledgments tracks each
-- notified vendor company's acknowledgment.
--
-- HONESTY NOTE: there is no content-level diffing here (no "changed
-- dimensions", no "changed specifications" claims, no automatic revision
-- linking) - this codebase cannot read document content. Revision matching
-- is a filename-pattern SUGGESTION only, always requiring explicit user
-- confirmation before two documents are linked. Addendum authorship (what
-- changed, why) is entirely user-written.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

create table if not exists document_addenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  building_id uuid not null references buildings(id) on delete cascade,
  title text not null,
  description text,
  affected_document_ids uuid[] not null default '{}',
  affected_package_ids uuid[] not null default '{}',
  bid_deadline_extended_to date,
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  created_by text references users(id),
  published_by text references users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_document_addenda_building on document_addenda (building_id);
create index if not exists idx_document_addenda_org on document_addenda (organization_id);

create table if not exists document_addendum_acknowledgments (
  addendum_id uuid not null references document_addenda(id) on delete cascade,
  vendor_company_id uuid not null references companies(id) on delete cascade,
  notified_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text references users(id),
  primary key (addendum_id, vendor_company_id)
);
