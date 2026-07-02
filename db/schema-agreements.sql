-- ============================================================================
-- Divini Procure - AGREEMENTS + native e-signature.
--
-- A lightweight agreements engine ported from Divini Partners and mapped onto
-- the Procure data model (companies, buildings=projects, developer_vendor_
-- relationships). An admin (or a company member acting for their own company)
-- creates an agreement from a built-in template (body rendered server-side) or
-- by attaching an uploaded file_url, sends it to a counterparty by email, and
-- the counterparty signs natively (typed signature + affirmation). Every
-- signature captures signer identity, IP, user-agent and a timestamp.
--
-- This RECORDS and tracks the agreement lifecycle; it does not move money.
-- Additive only. No ALTER of existing tables. Idempotent: safe to run repeatedly.
-- ============================================================================

create extension if not exists pgcrypto;

-- Custom (admin-authored) templates. Built-in templates live in code
-- (server/src/lib/agreement-templates.ts); this table holds overrides + extras.
create table if not exists agreement_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  kind text,
  body text,
  created_by text,
  created_at timestamptz not null default now()
);

-- An issued agreement. Exactly one party_company_id is the issuing/owning side;
-- counterparty_email is who must sign. project_id (a building) and
-- relationship_id (a developer-vendor pair) are optional context links.
create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  template_key text,
  title text not null,
  kind text,
  party_company_id uuid references companies(id) on delete set null,
  counterparty_email text,
  project_id uuid references buildings(id) on delete set null,
  relationship_id uuid references developer_vendor_relationships(id) on delete set null,
  body text,
  file_url text,
  status text not null default 'draft'
    check (status in ('draft','sent','viewed','signed','needs_revision','expired','cancelled')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Native signature record. Tamper-evident enough for an internal marketplace:
-- signer identity + typed signature + IP + user-agent + timestamp + audit blob.
create table if not exists agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid references agreements(id) on delete cascade,
  signer_name text,
  signer_email text,
  signer_company_id uuid,
  signature_text text,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  audit jsonb
);

create index if not exists idx_agreements_party on agreements(party_company_id);
create index if not exists idx_agreements_status on agreements(status);
create index if not exists idx_agreement_signatures_agreement on agreement_signatures(agreement_id);
