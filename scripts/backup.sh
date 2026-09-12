#!/usr/bin/env bash
#
# Elite ERP — DATABASE backup (Stage 11 Part 8).
#
# Produces a timestamped, compressed pg_dump, optionally encrypted, and prunes
# old backups. Store the output OFF-HOST.
#
# THIS SCRIPT DOES NOT BACK UP UPLOADED FILES.
#
# Uploaded files — logos, seals, signatures, item and employee images, document
# attachments — are stored in Vercel Blob under organizations/{orgId}/..., not on
# this host. There is no local directory to tar. Earlier versions of this script
# defaulted UPLOADS_DIR to ./uploads, found nothing there, printed "skipping" and
# EXITED SUCCESSFULLY — so an operator reading a green run had every reason to
# believe their files were covered. They were not. See docs/security/backup-dr.md
# for what actually governs uploaded-file recovery.
#
# Required env:
#   DATABASE_URL      postgres connection string
# Optional env:
#   BACKUP_DIR        output dir (default: ./backups)
#   UPLOADS_DIR       LEGACY self-hosted local upload directory. Unset by default.
#                     Set it ONLY if this deployment still stores uploads on disk;
#                     if set and missing, this script FAILS rather than skipping.
#   RETENTION_DAYS    prune backups older than this (default: 14)
#   GPG_RECIPIENT     if set, encrypt outputs to this gpg recipient
#
# Usage: DATABASE_URL=... ./scripts/backup.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/elite-erp-db-$ts.dump"
uploads_file="$BACKUP_DIR/elite-erp-uploads-$ts.tar.gz"

echo "[backup] dumping database -> $db_file"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$db_file"

# Uploaded files. The default is NOT to look for a local directory, because this
# deployment has none — pretending otherwise is what made the old behaviour
# dishonest. A legacy self-hosted install opts in by setting UPLOADS_DIR, and if
# it does, a missing directory is an ERROR: the operator asked for those files to
# be in the backup, and silently omitting them is the failure being fixed here.
if [ -n "${UPLOADS_DIR:-}" ]; then
  if [ ! -d "$UPLOADS_DIR" ]; then
    echo "[backup] FATAL: UPLOADS_DIR=$UPLOADS_DIR was set but does not exist." >&2
    echo "[backup]        Refusing to report a successful backup that omits it." >&2
    exit 1
  fi
  echo "[backup] archiving LOCAL uploads -> $uploads_file"
  tar -czf "$uploads_file" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  uploads_covered="local directory $UPLOADS_DIR"
else
  uploads_covered="NOT BACKED UP BY THIS SCRIPT"
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

# Say plainly what this run did and did not cover. A backup report that lists only
# what succeeded is how the previous gap stayed invisible for as long as it did.
echo "[backup] done."
echo "[backup]   database       : $db_file"
echo "[backup]   uploaded files : $uploads_covered"
if [ -z "${UPLOADS_DIR:-}" ]; then
  echo "[backup]   -> Uploaded files live in Vercel Blob, not on this host. Their"
  echo "[backup]      recovery depends on the blob store, NOT on this backup."
  echo "[backup]      See docs/security/backup-dr.md, 'Uploaded files'."
fi
echo "[backup] REMINDER: copy $BACKUP_DIR off-host, and preserve"
echo "         AUTH_SECRET + every FIELD_ENCRYPTION_KEYS version separately —"
echo "         field-encrypted columns cannot be restored without the key."
