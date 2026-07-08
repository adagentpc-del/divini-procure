-- ============================================================================
-- Divini Procure - NATIVE email/password auth (replaces Authentik OIDC)
-- ----------------------------------------------------------------------------
-- Idempotent ALTERs that extend the existing `users` table (db/schema.sql) with
-- the columns the native auth flow needs: a scrypt password hash, an
-- email-verification gate + token, and a password-reset token.
--
-- Procure applies schema files manually via psql (no migration runner). Apply
-- ONCE, after db/schema.sql, on the local Postgres at localhost:5433:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-native-auth.sql
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.
-- Zero em dashes by convention.
-- ============================================================================

alter table users add column if not exists password_hash  text;
alter table users add column if not exists email_verified  boolean default false;
alter table users add column if not exists verify_token    text;
alter table users add column if not exists verify_expires  timestamptz;
alter table users add column if not exists reset_token     text;
alter table users add column if not exists reset_expires   timestamptz;

-- Native auth matches users by email (UPSERT BY EMAIL preserves id + memberships).
-- A unique, case-insensitive index makes that lookup correct and fast.
create unique index if not exists idx_users_email_lower on users (lower(email));

-- Token lookups during verify / reset.
create index if not exists idx_users_verify_token on users (verify_token);
create index if not exists idx_users_reset_token  on users (reset_token);
