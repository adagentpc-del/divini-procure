-- ============================================================================
-- Divini Procure - Phase 1 P1-13/P1-18: package financial closeout markers.
-- ----------------------------------------------------------------------------
-- "A project/package is not final just because all currently known invoices
-- are paid" (Phase 1 instruction section 48). Until a package is explicitly
-- closed out, FORECAST FINAL (lib/financial-model.ts
-- forecastAtCompletionCents()) is the authoritative "expected final cost"
-- metric; only after financially_closed_at is set does final_cost_cents
-- become authoritative. Columns added here now (needed by P1-13's summary
-- service, which must read them either way); the actual closeout WORKFLOW
-- (prerequisite checks, the endpoint that sets these) is P1-18, built on top
-- of this same pair of columns - no second migration needed later.
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table packages add column if not exists financially_closed_at timestamptz;
alter table packages add column if not exists financially_closed_by text;
alter table packages add column if not exists final_cost_cents bigint;
