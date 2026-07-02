-- ============================================================================
-- Divini Procure — INVITE PRE-FILL columns (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Extends invite_codes so an admin can create a pre-filled CLAIM PROFILE for a
-- prospect company (e.g. a real-estate developer). The /join/:code page renders
-- the company's info as a public "claim page" that launches onboarding
-- pre-filled.
--
-- This file is ADDITIVE and IDEMPOTENT. Apply it the SAME WAY as
-- db/schema-superadmin.sql, AFTER that file has been applied:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-invite-prefill.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-invite-prefill.sql)
--
-- Re-running it is safe. One alter per statement by convention.
-- Zero em dashes below this line.
-- ============================================================================

alter table invite_codes add column if not exists company_name text;
alter table invite_codes add column if not exists company_website text;
alter table invite_codes add column if not exists prefill jsonb default '{}'::jsonb;
