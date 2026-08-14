#!/usr/bin/env bash
# Nightly Postgres backup for Divini Procure (ALFY2 Section 06 / R-19).
#
# Production runs a single self-hosted Docker Postgres container on one
# droplet (23_DEPLOYMENT.md) - there is no managed-database provider taking
# automatic snapshots underneath it. Before this script, a droplet failure,
# a bad migration, or an operator mistake (`DROP TABLE`, a botched
# `apply-all.sql` re-run against the wrong database) had NO recovery path
# at all. This script takes a compressed `pg_dump` (custom format, so it
# restores with `pg_restore` and supports selective table/schema restore),
# timestamps it, and prunes anything older than RETENTION_DAYS.
#
# Usage on the server (matches deploy.sh's existing conventions):
#   bash /root/sites/divini-procure/backup.sh
#
# Wiring this into cron is an operator action (this repo has no way to
# install a crontab on the production host) - see 23_DEPLOYMENT.md for the
# one-line crontab entry. This script is idempotent and safe to run
# manually at any time in addition to its schedule.
#
# IMPORTANT - Row-Level Security interaction (ALFY2 Section 05): pg_dump
# always runs its own session with `row_security = off` to guarantee a
# complete, non-filtered dump rather than risk silently writing a partial
# one. On a table with FORCE ROW LEVEL SECURITY (every app table as of the
# Section 05 RLS retrofit - db/schema-rls.sql), Postgres then requires the
# dumping role to be exempt from RLS altogether (a real superuser, or a
# role with the BYPASSRLS attribute) - our app-level app.is_admin session
# GUC does NOT help here, because row_security=off skips evaluating
# policies entirely rather than evaluating them permissively. If DB_USER
# is not exempt, pg_dump fails fast with an explicit RLS error (verified
# locally: a non-superuser owner with FORCE RLS set cannot pg_dump those
# tables at all, error "query would be affected by row-level security
# policy"; the same role WITH superuser succeeds cleanly). Before relying
# on this script, confirm the production DB_USER is exempt:
#   docker exec divini_procure_db psql -U aibos -d divini_procure -c \
#     "select rolsuper or rolbypassrls as backup_role_ok from pg_roles where rolname = current_user;"
# If that returns false, this script will fail loudly below rather than
# produce a silent partial backup - see the check right after pg_dump runs.
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER="${DIVINI_DB_CONTAINER:-divini_procure_db}"
DB_USER="${DIVINI_DB_USER:-aibos}"
DB_NAME="${DIVINI_DB_NAME:-divini_procure}"
BACKUP_DIR="${DIVINI_BACKUP_DIR:-/root/backups/divini-procure}"
RETENTION_DAYS="${DIVINI_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/divini_procure_${STAMP}.dump"

echo "==> dumping ${DB_NAME} from container ${CONTAINER} -> ${OUT}"
if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=9 \
  > "$OUT.partial" 2> "$OUT.err"; then
  rm -f "$OUT.partial"
  if grep -q "row-level security" "$OUT.err"; then
    echo "==> BACKUP FAILED: ${DB_USER} is not exempt from Row-Level Security." >&2
    echo "    pg_dump requires the dumping role to be a real Postgres superuser" >&2
    echo "    or have BYPASSRLS - see the note at the top of this script. Check:" >&2
    echo "      docker exec ${CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c \\" >&2
    echo "        \"select rolsuper or rolbypassrls from pg_roles where rolname = current_user;\"" >&2
  fi
  cat "$OUT.err" >&2
  rm -f "$OUT.err"
  exit 1
fi
rm -f "$OUT.err"
mv "$OUT.partial" "$OUT"
echo "==> wrote $(du -h "$OUT" | cut -f1) to $OUT"

echo "==> pruning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"
find "$BACKUP_DIR" -name 'divini_procure_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete

echo "==> backup complete: $OUT"
