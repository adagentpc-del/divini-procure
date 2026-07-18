-- Migration: fix investor_watchlist.user_id type mismatch (uuid -> text)
-- -----------------------------------------------------------------------
-- users.id is type TEXT (OIDC sub claim). investor_watchlist.user_id was
-- incorrectly declared as UUID, making the FK unresolvable. This migration
-- drops the FK + column, re-adds as TEXT, restores the FK and index.
--
-- Safe to re-run (idempotent where possible).
-- Apply:
--   psql "$DATABASE_URL" -f db/schema-watchlist-userid-fix.sql

BEGIN;

-- 1. Drop the existing FK constraint (name may vary; use DO block to be safe)
DO $$
DECLARE
  _con text;
BEGIN
  SELECT conname INTO _con
  FROM pg_constraint
  WHERE conrelid = 'investor_watchlist'::regclass
    AND contype = 'f'
    AND conname ILIKE '%user_id%';
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE investor_watchlist DROP CONSTRAINT %I', _con);
  END IF;
END
$$;

-- 2. Drop the old index (if it exists)
DROP INDEX IF EXISTS idx_investor_watchlist_user;

-- 3. Change column type from uuid to text using USING cast
ALTER TABLE investor_watchlist
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- 4. Re-apply NOT NULL (ALTER TYPE above preserves nullability, but be explicit)
ALTER TABLE investor_watchlist
  ALTER COLUMN user_id SET NOT NULL;

-- 5. Restore FK to users(id) — now text -> text, resolves correctly
ALTER TABLE investor_watchlist
  ADD CONSTRAINT investor_watchlist_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 6. Restore index
CREATE INDEX IF NOT EXISTS idx_investor_watchlist_user ON investor_watchlist (user_id);

COMMIT;
