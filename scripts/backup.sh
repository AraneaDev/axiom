#!/usr/bin/env bash
# =============================================================================
# Axiom Backup Script
# =============================================================================
# Dumps PostgreSQL, tars the uploads volumes.
# Rotation: 7 daily, 4 weekly.
#
# Usage: ./scripts/backup.sh
# Cron:  0 3 * * * /root/axiom/scripts/backup.sh >> /backups/axiom/backup.log 2>&1

set -euo pipefail

BACKUP_ROOT="/backups/axiom"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
COMPOSE_DIR="/root/axiom"
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)
TIMESTAMP=$(date +%Y-%m-%d\ %H:%M:%S)

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

echo "[$TIMESTAMP] Backup started"

# -- 1. PostgreSQL dump -------------------------------------------------------
DB_FILE="$DAILY_DIR/axiom-db-$DATE.sql.gz"
echo "  Dumping PostgreSQL..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T db \
  pg_dump -U axiom --compress=9 axiom > "$DB_FILE"
DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo "  Database: $DB_SIZE -> $DB_FILE"

# -- 2. Uploads volume -------------------------------------------------------
UPLOADS_FILE="$DAILY_DIR/axiom-uploads-$DATE.tar.gz"
UPLOADS_VOLUME=$(docker volume inspect axiom_uploads --format '{{ .Mountpoint }}' 2>/dev/null || echo "")
if [ -n "$UPLOADS_VOLUME" ] && [ -d "$UPLOADS_VOLUME" ]; then
  LAST_UPLOADS=$(ls -t "$DAILY_DIR"/axiom-uploads-*.tar.gz 2>/dev/null | head -1)
  if [ -z "$LAST_UPLOADS" ] || [ -n "$(find "$UPLOADS_VOLUME" -newer "$LAST_UPLOADS" -type f 2>/dev/null | head -1)" ]; then
    echo "  Archiving uploads..."
    tar -czf "$UPLOADS_FILE" -C "$UPLOADS_VOLUME" .
    UPLOADS_SIZE=$(du -h "$UPLOADS_FILE" | cut -f1)
    echo "  Uploads: $UPLOADS_SIZE -> $UPLOADS_FILE"
  else
    echo "  Uploads: no changes since last backup, skipping"
  fi
fi

# -- 3. Weekly copy (Sundays) ------------------------------------------------
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  echo "  Creating weekly backup copy..."
  for f in "$DAILY_DIR"/axiom-*-"$DATE".*; do
    [ -f "$f" ] && cp "$f" "$WEEKLY_DIR/"
  done
  echo "  Weekly copy done"
fi

# -- 4. Rotate old backups ---------------------------------------------------
echo "  Rotating old backups..."

# Keep 7 daily
DAILY_COUNT=$(ls -t "$DAILY_DIR"/axiom-db-*.sql.gz 2>/dev/null | wc -l)
if [ "$DAILY_COUNT" -gt 7 ]; then
  ls -t "$DAILY_DIR"/axiom-db-*.sql.gz | tail -n +8 | while read -r f; do
    DATE_PART=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}')
    rm -f "$DAILY_DIR"/axiom-*-"$DATE_PART".*
    echo "    Removed daily: $DATE_PART"
  done
fi

# Keep 4 weekly
WEEKLY_COUNT=$(ls -t "$WEEKLY_DIR"/axiom-db-*.sql.gz 2>/dev/null | wc -l)
if [ "$WEEKLY_COUNT" -gt 4 ]; then
  ls -t "$WEEKLY_DIR"/axiom-db-*.sql.gz | tail -n +5 | while read -r f; do
    DATE_PART=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}')
    rm -f "$WEEKLY_DIR"/axiom-*-"$DATE_PART".*
    echo "    Removed weekly: $DATE_PART"
  done
fi

TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" | cut -f1)
echo "  Total backup size: $TOTAL_SIZE"

TIMESTAMP_END=$(date +%Y-%m-%d\ %H:%M:%S)
echo "[$TIMESTAMP_END] Backup complete"
echo "---"
