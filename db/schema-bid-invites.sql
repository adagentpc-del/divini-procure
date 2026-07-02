-- ============================================================================
-- Divini Procure - BID INVITES (one-click invite-matched-vendor handoff)
-- ----------------------------------------------------------------------------
-- A developer (buyer) who runs vendor matching in the Procurement Intelligence
-- view can invite a matched vendor to bid on a specific package, capturing the
-- match score at invite time. The invited vendor sees the opportunity in their
-- "invited opportunities" list and can act on it.
--
-- One canonical invite row per (package, vendor) pair. status tracks the
-- handoff lifecycle. match_score is the Divini-Score + relationship blended
-- score from intel ranking at the moment of the invite (for context only).
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once on the
-- local Postgres at localhost:5433, AFTER db/schema.sql and the moat / fee
-- add-ons:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-bid-invites.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists bid_invites (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  developer_company_id uuid,
  status text default 'invited' check (status in ('invited','viewed','bid_submitted','declined','expired')),
  match_score int,
  message text,
  invited_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (package_id, vendor_company_id)
);

create index if not exists idx_bid_invites_vendor on bid_invites(vendor_company_id);
