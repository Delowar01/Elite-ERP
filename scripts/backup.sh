#!/usr/bin/env bash
#
# Elite ERP — database + uploads backup (Stage 11 Part 8).
#
# Produces a timestamped, compressed pg_dump and a tar of uploads/, optionally
# encrypted, and prunes old backups. Store the output OFF-HOST.
#
# Required env:
#   DATABASE_URL      postgres connection string
# Optional env:
#   BACKUP_DIR        output dir (default: ./backups)
#   UPLOADS_DIR       uploads path (default: ./uploads)
#   RETENTION_DAYS    prune backups older than this (default: 14)
#   GPG_RECIPIENT     if set, encrypt outputs to this gpg recipient
#
# Usage: DATABASE_URL=... ./scripts/backup.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOADS_DIR="${UPLOADS_DIR:-./uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/elite-erp-db-$ts.dump"
uploads_file="$BACKUP_DIR/elite-erp-uploads-$ts.tar.gz"

echo "[backup] dumping database -> $db_file"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$db_file"

if [ -d "$UPLOADS_DIR" ]; then
  echo "[backup] archiving uploads -> $uploads_file"
  tar -czf "$uploads_file" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
else
  echo "[backup] no uploads dir at $UPLOADS_DIR (skipping)"
fi

# Optional encryption at rest for the artifacts themselves.
if [ -n "${GPG_RECIPIENT:-}" ]; then
  for f in "$db_file" "$uploads_file"; do
    [ -f "$f" ] || continue
    echo "[backup] encrypting $f"
    gpg --yes --batch --encrypt --recipient "$GPG_RECIPIENT" "$f"
    rm -f "$f"
  done
fi

echo "[backup] pruning backups older than ${RETENTION_DAYS}d"
find "$BACKUP_DIR" -type f -name 'elite-erp-*' -mtime +"$RETENTION_DAYS" -print -delete || true

echo "[backup] done. REMINDER: copy $BACKUP_DIR off-host, and preserve"
echo "         AUTH_SECRET + every FIELD_ENCRYPTION_KEYS version separately —"
echo "         field-encrypted columns cannot be restored without the key."
