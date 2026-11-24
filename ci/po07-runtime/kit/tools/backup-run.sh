#!/usr/bin/env bash
# PO-07 S12: one encrypted staging backup — run ONLY by elite-po-backup.service (installed by S12 into the app
# directory's .kit-tools). Inside the staging namespace, as the app user, read-only database role, no internet.
# Output: <backups>/outbox/po07-staging-<UTC>.tar.gpg (+ .sha256 of the ciphertext). The encrypted tar holds:
#   manifest.json   kit, release, build, database, PostgreSQL version, sizes and SHA-256 of every member, the counts
#   db.dump         pg_dump -Fc of the staging database (every table, incl. the administrator and the MFA envelopes —
#                   still encrypted with the field key, which is NOT in the backup: the owner holds it, S9b step 2)
#   schema.tsv      table, column, type, nullability (the schema fingerprint the restore drill compares)
#   rowcounts.tsv   rows per table
#   storage.tar     the fictional uploaded files (+ storage.sha256: one SHA-256 per file)
# Never in a backup: the env files, AUTH_SECRET, PLATFORM_AUTH_SECRET, FIELD_ENCRYPTION_KEYS, database passwords, the
# owner's private key (never on the VPS) or any administrator password or TOTP secret in plaintext.
set -Eeuo pipefail
umask 077
export LC_ALL=C
K=/srv/elite-po-staging/.kit-tools
# shellcheck source=/dev/null
. "$CREDENTIALS_DIRECTORY/backup.conf"   # DB, BACKUP_ROLE, PG_PORT, KIT_VERSION, APPROVED_*: written by S12 from config.sh (no secret)
B=/var/lib/elite-po-staging/backups; O="$B/outbox"; W=/tmp/po07-backup
die() { echo "backup: FAILED: $*" >&2; exit 1; }
# ---- self-checks: the unit's own sandbox is what the plan says ----
if timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2> /dev/null; then die "the backup process can reach the internet (it must run inside the namespace)"; fi
[ "$(findmnt -n -o FSTYPE /tmp)" = tmpfs ] || die "/tmp is not a private RAM file system: plaintext would reach a disk"
[ ! -e /etc/elite-po-staging/admin.env ] || ! head -c1 /etc/elite-po-staging/admin.env > /dev/null 2>&1 || die "the env files are readable from the backup process"
[ -d "$O" ] && [ -w "$O" ] || die "no writable outbox $O"
FPR="$(tr -dc 'A-F0-9' < "$CREDENTIALS_DIRECTORY/owner.fpr")"
[ "${#FPR}" -eq 40 ] || die "the owner's fingerprint is not a 40-hex v4 fingerprint"
install -d -m 0700 "$W" "$W/gnupg"
keyfprs="$(gpg --batch --homedir "$W/gnupg" --show-keys --with-colons "$CREDENTIALS_DIRECTORY/owner.pub" 2> /dev/null | awk -F: '$1 == "fpr" {print $10}')"
grep -qx "$FPR" <<< "$keyfprs" || die "the public key file does not carry the owner's fingerprint $FPR"
[ "$(gpg --batch --homedir "$W/gnupg" --show-keys --with-colons "$CREDENTIALS_DIRECTORY/owner.pub" 2> /dev/null | grep -c '^sec')" -eq 0 ] || die "the key file contains a SECRET key: refused"
# ---- the components (plaintext only in the private RAM /tmp) ----
ts="$(date -u +%Y%m%dT%H%M%SZ)"; name="po07-staging-$ts"
[ ! -e "$O/$name.tar.gpg" ] || die "$name exists"
P="$W/pgpass"; printf '127.0.0.1:%s:%s:%s:%s\n' "$PG_PORT" "$DB" "$BACKUP_ROLE" "$(cat "$CREDENTIALS_DIRECTORY/backup.pw")" > "$P"; chmod 0600 "$P"
export PGPASSFILE="$P" PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER="$BACKUP_ROLE" PGDATABASE="$DB" PGCONNECT_TIMEOUT=10
PGB=/usr/lib/postgresql/16/bin
q() { "$PGB/psql" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
D="$W/inner"; install -d -m 0700 "$D"
"$PGB/pg_dump" -Fc --no-password -f "$D/db.dump"
"$PGB/pg_restore" -l "$D/db.dump" > /dev/null || die "the dump is not readable by pg_restore"
q "select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, 2" > "$D/schema.tsv"
q "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" | while read -r t; do
  printf '%s\t%s\n' "$t" "$(q "select count(*) from public.\"$t\"")"; done > "$D/rowcounts.tsv"
tar -C /var/lib/elite-po-staging -cf "$D/storage.tar" storage
(cd /var/lib/elite-po-staging && find storage -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$D/storage.sha256"
sha() { sha256sum "$D/$1" | cut -d' ' -f1; }
node -e '
  const [ts, kit, sha, tree, build, run, db, pgv, admins, dump, schema, counts, stor, storsums, files] = process.argv.slice(1);
  console.log(JSON.stringify({ format: "po07-staging-backup-1", created_at: ts, kit, release: { sha, tree, build, run }, database: db, postgres: pgv,
    platform_admins: Number(admins), sha256: { "db.dump": dump, "schema.tsv": schema, "rowcounts.tsv": counts, "storage.tar": stor, "storage.sha256": storsums },
    storage_files: Number(files), not_included: ["env files", "AUTH_SECRET", "PLATFORM_AUTH_SECRET", "FIELD_ENCRYPTION_KEYS (owner-held)", "database passwords", "private keys"] }, null, 1));' \
  "$ts" "$KIT_VERSION" "$APPROVED_SHA" "$APPROVED_TREE" "$APPROVED_BUILD_ID" "$APPROVED_RUN_ID" "$DB" "$(q 'show server_version')" "$(q 'select count(*) from platform_admins')" \
  "$(sha db.dump)" "$(sha schema.tsv)" "$(sha rowcounts.tsv)" "$(sha storage.tar)" "$(sha storage.sha256)" "$(grep -c . "$D/storage.sha256" || true)" > "$D/manifest.json"
# ---- encrypt to the owner's public key only; publish atomically ----
tar -C "$D" -cf - manifest.json db.dump schema.tsv rowcounts.tsv storage.tar storage.sha256 |
  gpg --batch --quiet --homedir "$W/gnupg" --no-auto-key-locate --trust-model always --recipient-file "$CREDENTIALS_DIRECTORY/owner.pub" \
    --cipher-algo AES256 --compress-algo none --encrypt --output "$O/.$name.tar.gpg.part"
gpg --batch --homedir "$W/gnupg" --list-packets "$O/.$name.tar.gpg.part" 2>&1 | grep -q ':pubkey enc packet:' || die "the output is not public-key encrypted"
if head -c 5 "$O/.$name.tar.gpg.part" | grep -q 'PGDMP'; then die "plaintext dump in the output"; fi
(cd "$O" && sha256sum ".$name.tar.gpg.part" | sed "s/\.$name\.tar\.gpg\.part/$name.tar.gpg/") > "$O/.$name.tar.gpg.sha256.part"
chmod 0640 "$O/.$name.tar.gpg.part" "$O/.$name.tar.gpg.sha256.part"
mv -- "$O/.$name.tar.gpg.part" "$O/$name.tar.gpg"; mv -- "$O/.$name.tar.gpg.sha256.part" "$O/$name.tar.gpg.sha256"
ntab="$(grep -c . "$D/rowcounts.tsv")"; rm -rf -- "$W"
# ---- local retention: the 14 newest, nothing older than 14 days ----
find "$O" -maxdepth 1 -name 'po07-staging-*.tar.gpg*' -mtime +14 -print -delete | sed 's/^/backup: expired locally: /'
ls -1t "$O"/po07-staging-*.tar.gpg 2> /dev/null | tail -n +15 | while read -r x; do rm -f -- "$x" "$x.sha256"; echo "backup: beyond 14 copies: $x"; done
echo "BACKUP ok: $name.tar.gpg ($(stat -c %s "$O/$name.tar.gpg") bytes, encrypted to $FPR; $ntab tables)"
