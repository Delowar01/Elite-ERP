#!/usr/bin/env bash
#
# Elite ERP — restore from a backup produced by scripts/backup.sh (Stage 11 Part 8).
#
# Restores a pg_dump into a TARGET database and (optionally) untars uploads.
# Re-applies the immutable-audit triggers afterwards.
#
# Required env:
#   DATABASE_URL      target postgres connection string (empty DB + app role ready)
# Args:
#   $1   path to the .dump (or .dump.gpg) file
#   $2   optional path to the uploads .tar.gz (or .tar.gz.gpg)
#
# Usage: DATABASE_URL=... ./scripts/restore.sh backups/elite-erp-db-<ts>.dump [backups/elite-erp-uploads-<ts>.tar.gz]
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
db_arg="${1:?path to the database dump is required}"
uploads_arg="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_files=()
cleanup() { for f in "${tmp_files[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done; }
trap cleanup EXIT

decrypt_if_needed() {
  local src="$1"
  if [[ "$src" == *.gpg ]]; then
    local out="${src%.gpg}"
    echo "[restore] decrypting $src" >&2
    gpg --yes --batch --decrypt "$src" > "$out"
    tmp_files+=("$out")
    echo "$out"
  else
    echo "$src"
  fi
}

db_file="$(decrypt_if_needed "$db_arg")"

echo "[restore] restoring database from $db_file"
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DATABASE_URL" "$db_file"

if [ -n "$uploads_arg" ]; then
  uploads_file="$(decrypt_if_needed "$uploads_arg")"
  echo "[restore] restoring uploads from $uploads_file"
  tar -xzf "$uploads_file" -C "$(dirname "$script_dir")"
fi

echo "[restore] re-applying immutable-audit triggers"
psql "$DATABASE_URL" -f "$script_dir/../drizzle/immutable_audit.sql"

echo "[restore] done. Verify: AUTH_SECRET + FIELD_ENCRYPTION_KEYS match the source,"
echo "         then start the app and confirm login + a field-decryption check."
