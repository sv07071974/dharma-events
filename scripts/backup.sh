#!/usr/bin/env bash
#
# Dharma Events - production PostgreSQL backup script.
# REQUIREMENTS.md Section 59 (Backups) / Section 88 (Backup Script
# Requirement).
#
# Runs `pg_dump` against the `postgres` service in compose.yml, compresses
# the output, timestamps it, and writes it into a Grandfather-Father-Son
# rotation (7 daily / 4 weekly / 6 monthly) under $BACKUP_DIR/database.
# Also snapshots .env and the Compose/Nginx configuration (Section 59's
# "additionally back up" list) alongside the daily database dump.
#
# Intended to be invoked by cron (or Synology Task Scheduler) once per day
# from the repository root, e.g.:
#   0 2 * * * cd /volume1/docker/dharma-events && ./scripts/backup.sh >> /volume1/docker/dharma-events/backups/backup.log 2>&1
#
# Exits non-zero on any failure so cron/Task Scheduler can alert on it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
DAILY_DIR="$BACKUP_DIR/database/daily"
WEEKLY_DIR="$BACKUP_DIR/database/weekly"
MONTHLY_DIR="$BACKUP_DIR/database/monthly"
CONFIG_DIR="$BACKUP_DIR/config"

DAILY_RETENTION=7
WEEKLY_RETENTION=4
MONTHLY_RETENTION=6

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DAY_OF_WEEK="$(date +%u)"   # 1 = Monday ... 7 = Sunday
DAY_OF_MONTH="$(date +%d)"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

[ -f .env ] || fail ".env not found in $REPO_ROOT - cannot read POSTGRES_USER/POSTGRES_DB"
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${POSTGRES_USER:?POSTGRES_USER is required (set in .env)}"
: "${POSTGRES_DB:?POSTGRES_DB is required (set in .env)}"

command -v docker >/dev/null 2>&1 || fail "docker is required but was not found on PATH"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR" "$CONFIG_DIR"

DUMP_FILE="$DAILY_DIR/dharma_events_${TIMESTAMP}.sql.gz"

log "Starting database backup -> $DUMP_FILE"

if ! docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    | gzip > "$DUMP_FILE.tmp"; then
  rm -f "$DUMP_FILE.tmp"
  fail "pg_dump failed"
fi

if [ ! -s "$DUMP_FILE.tmp" ]; then
  rm -f "$DUMP_FILE.tmp"
  fail "pg_dump produced an empty file"
fi

mv "$DUMP_FILE.tmp" "$DUMP_FILE"
log "Database backup complete ($(du -h "$DUMP_FILE" | cut -f1))"

# Promote into the weekly bucket on Sundays, and the monthly bucket on the
# 1st of the month, per the 7/4/6 Grandfather-Father-Son retention policy.
if [ "$DAY_OF_WEEK" = "7" ]; then
  cp "$DUMP_FILE" "$WEEKLY_DIR/"
  log "Promoted to weekly: $WEEKLY_DIR/$(basename "$DUMP_FILE")"
fi

if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$DUMP_FILE" "$MONTHLY_DIR/"
  log "Promoted to monthly: $MONTHLY_DIR/$(basename "$DUMP_FILE")"
fi

prune() {
  local dir="$1"
  local keep="$2"
  # List newest-first, skip the newest $keep, delete the rest.
  local files
  files=$(find "$dir" -maxdepth 1 -name '*.sql.gz' -type f | sort -r | tail -n "+$((keep + 1))")
  if [ -n "$files" ]; then
    echo "$files" | while IFS= read -r f; do
      rm -f "$f"
      log "Pruned expired backup: $f"
    done
  fi
}

prune "$DAILY_DIR" "$DAILY_RETENTION"
prune "$WEEKLY_DIR" "$WEEKLY_RETENTION"
prune "$MONTHLY_DIR" "$MONTHLY_RETENTION"

# Section 59: also back up .env, the compose configuration, and Nginx
# config. Generated invitation assets and upload/import archives are not
# currently retained on disk after processing (see docs/ASSUMPTIONS.md), so
# there is nothing to include for those two items.
CONFIG_BUNDLE="$CONFIG_DIR/config_${TIMESTAMP}.tar.gz"
tar -czf "$CONFIG_BUNDLE" .env compose.yml compose.dev.yml docker/
chmod 600 "$CONFIG_BUNDLE"
log "Configuration backup complete -> $CONFIG_BUNDLE"
prune "$CONFIG_DIR" "$DAILY_RETENTION"

log "Backup finished successfully."
