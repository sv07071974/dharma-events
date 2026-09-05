#!/usr/bin/env bash
#
# Dharma Events - production PostgreSQL restore script.
# REQUIREMENTS.md Section 88 (Backup Script Requirement).
#
# Restores a `.sql.gz` dump produced by scripts/backup.sh into the running
# `postgres` service. DESTRUCTIVE: drops and recreates every table in the
# target database first, so this requires explicit confirmation when run
# interactively (skip only with --yes, intended for scripted/tested restore
# drills where the caller has already confirmed out-of-band).
#
# Usage:
#   ./scripts/restore.sh /path/to/dharma_events_20260101_020000.sql.gz [--yes]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

DUMP_FILE="${1:-}"
ASSUME_YES="false"
for arg in "$@"; do
  if [ "$arg" = "--yes" ]; then
    ASSUME_YES="true"
  fi
done

[ -n "$DUMP_FILE" ] || fail "usage: $0 <path-to-dump.sql.gz> [--yes]"
[ -f "$DUMP_FILE" ] || fail "dump file not found: $DUMP_FILE"

[ -f .env ] || fail ".env not found in $REPO_ROOT - cannot read POSTGRES_USER/POSTGRES_DB"
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${POSTGRES_USER:?POSTGRES_USER is required (set in .env)}"
: "${POSTGRES_DB:?POSTGRES_DB is required (set in .env)}"

command -v docker >/dev/null 2>&1 || fail "docker is required but was not found on PATH"

if [ "$ASSUME_YES" != "true" ]; then
  echo "This will PERMANENTLY OVERWRITE database '$POSTGRES_DB' with the contents of:"
  echo "  $DUMP_FILE"
  echo "All current data in '$POSTGRES_DB' will be lost."
  read -r -p "Type the database name ($POSTGRES_DB) to confirm: " CONFIRMATION
  if [ "$CONFIRMATION" != "$POSTGRES_DB" ]; then
    fail "confirmation did not match database name - aborting, nothing was changed"
  fi
fi

log "Restoring $DUMP_FILE into $POSTGRES_DB ..."

# Terminate other connections and drop/recreate the schema so the restore
# starts from a clean slate, then replay the dump.
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  >/dev/null

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

if ! gunzip -c "$DUMP_FILE" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"; then
  fail "restore failed - database may be in an inconsistent state, restore again from a known-good dump"
fi

log "Restore finished successfully."
