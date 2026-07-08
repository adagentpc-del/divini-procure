-- ============================================================================
-- Divini Procure -- Roles onboarding enhancement (idempotent).
-- ----------------------------------------------------------------------------
-- Extends onboarding beyond developer/buyer to rich VENDOR and INVESTOR flows.
--   * Allows the new `investor` company kind (alongside buyer + vendor).
--   * Adds vendor/investor profile array fields to `companies`.
-- Reuses the website/description/state columns added by
-- schema-developer-onboarding.sql (apply that file first, or both, order-free).
--
-- Safe to re-run: every statement is guarded.
--
-- APPLY (manual, on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-roles-onboarding.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- companies.kind: allow investor ----------
alter table companies drop constraint if exists companies_kind_check;
alter table companies add constraint companies_kind_check
  check (kind in ('buyer','vendor','investor'));

-- ---------- companies: vendor + investor profile fields ----------
alter table companies add column if not exists coverage_areas text[] default '{}';     -- vendor service territories
alter table companies add column if not exists service_categories text[] default '{}'; -- vendor industry / service categories
alter table companies add column if not exists capabilities text[] default '{}';       -- vendor capabilities (Manufacturing/Distribution/...)
alter table companies add column if not exists focus_areas text[] default '{}';         -- investor focus / asset classes
alter table companies add column if not exists geographies text[] default '{}';         -- investor target geographies
