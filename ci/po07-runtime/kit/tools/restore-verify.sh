#!/usr/bin/env bash
# PO-07 S12 restore drill, ON THE VPS (as root). It receives the DECRYPTED backup on stdin — decrypted by the owner on
# the PC with the private key that never leaves it (tools/pc-restore-drill.sh) — and proves it restores, without ever
# touching the active staging database or printing a secret:
#   restore-verify.sh --execute <SHA-256 of the encrypted object the owner checked against its sidecar>  < decrypted tar
#   1. the object is one the off-host copy verified (elite-po-offsite's list); the archive holds exactly the expected members;
#   2. every member's SHA-256 equals the manifest;
#   3. pg_restore into a NEW disposable database <restore>_test_only_ (never the active one), owner role, no owner change;
#   4. the schema (tables, columns, types, nullability) and every table's row count equal the backup's;
#   5. the platform administrators equal the manifest; every field-encryption envelope (the administrator's TOTP secret,
#      customer MFA data) decrypts with the owner-held field key (read from the root-only env file; counts only printed);
#   6. the files restore into an isolated directory with every SHA-256 as recorded;
#   7. the active database's per-table counts are unchanged.
# PASS → the disposable database and directory are removed, and S12 is marked done (accepted). FAIL → STOP; both are
# kept for review.
STAGE=S12; . "$(dirname "$0")/../lib.sh" "${1:---plan}"
EXP="${2:-}"
stage_begin S9
if [ "$MODE" = plan ]; then
  plan "restore the decrypted backup from stdin into a disposable *_restore_*_test_only_ database and directory; verify; remove them; mark S12 done"
  exit 0
fi
[ -f "$STATE_DIR/S12.backup-ok" ] || stop_now "the first backup and off-host copy are not in place (s12_backup.sh)"
[[ "$EXP" =~ ^[0-9a-f]{64}$ ]] || stop_now "the SHA-256 of the encrypted object (from its .sha256 sidecar) is required"
grep -q " $EXP$" /var/lib/private/elite-po-offsite/verified-objects.txt || stop_now "that object is not among the off-host copies elite-po-offsite verified"
guard_shared
assert_staging_cluster
ts="$(date -u +%Y%m%dt%H%M%S)"; R="$VAR_DIR/restore-$ts"; RDB="elite_po_restore_${ts}_test_only_"
counts() { # DB → "table<TAB>rows" for every base table, sorted
  printf "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1;\n" | spsql "$1" |
    while read -r t; do printf '%s\t%s\n' "$t" "$(printf 'select count(*) from public."%s";\n' "$t" | spsql "$1")"; done; }
active0="$(counts "$DB" | sha256sum | cut -c1-16)"
mkdir_staging "$R" 0700 root:root
tar -xf - -C "$R" --no-same-owner --no-same-permissions || stop_now "the decrypted stream is not a complete backup archive (kept: $R)"
[ "$(cd "$R" && find . -mindepth 1 | LC_ALL=C sort | tr '\n' ' ')" = "./db.dump ./manifest.json ./rowcounts.tsv ./schema.tsv ./storage.sha256 ./storage.tar " ] ||
  stop_now "unexpected archive members: $(cd "$R" && find . -mindepth 1 | tr '\n' ' ')"
mf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],m); console.log(v ?? "")' "$R/manifest.json" "$1"; }
[ "$(mf format)" = po07-staging-backup-1 ] || stop_now "not a PO-07 staging backup"
for m in db.dump schema.tsv rowcounts.tsv storage.tar storage.sha256; do
  [ "$(sha256sum "$R/$m" | cut -d' ' -f1)" = "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha256[process.argv[2]])' "$R/manifest.json" "$m")" ] ||
    stop_now "$m does not match the manifest's SHA-256 (kept: $R)"
done
say "integrity: every member matches the manifest (backup of $(mf created_at), kit $(mf kit), build $(mf release.build))"
printf 'create database "%s" owner "%s" template template0;\n' "$RDB" "$OWNER_ROLE" | spsql postgres > /dev/null
runuser -u "$PG_USER" -- /usr/lib/postgresql/16/bin/pg_restore -h "$PG_RUN" -p "$PG_PORT" -d "$RDB" --no-owner --role="$OWNER_ROLE" --exit-on-error "$R/db.dump" ||
  stop_now "pg_restore failed (kept: database $RDB, directory $R)"
schema_now="$(printf "select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, 2;\n" | spsql "$RDB")"   # psql -At, as backup-run.sh wrote it
[ "$schema_now" = "$(cat "$R/schema.tsv")" ] || stop_now "the restored schema differs from the backup's (kept: $RDB, $R)"
[ "$(counts "$RDB")" = "$(cat "$R/rowcounts.tsv")" ] || stop_now "the restored row counts differ from the backup's (kept: $RDB, $R)"
say "schema: $(grep -c . "$R/schema.tsv") columns identical; rows: $(grep -c . "$R/rowcounts.tsv") tables, every count identical"
admins="$(printf 'select count(*) from platform_admins;\n' | spsql "$RDB")"; act_mfa="$(printf 'select count(*) from platform_admins where is_active and mfa_secret_encrypted is not null and mfa_enrolled_at is not null;\n' | spsql "$RDB")"
[ "$admins" = "$(mf platform_admins)" ] || stop_now "platform administrators: $admins restored, $(mf platform_admins) in the backup"
# every field-encryption envelope in every text column decrypts with the owner-held key (values never printed)
envq="$(printf "select format('select %%L, %%I from public.%%I where %%I ~ %%L', table_name || '.' || column_name, column_name, table_name, column_name, '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+\$') from information_schema.columns where table_schema = 'public' and data_type in ('text', 'character varying');\n" | spsql "$RDB")"
key="$(sed -n 's/^FIELD_ENCRYPTION_KEYS=//p' "$ETC_DIR/customer.env")"
res="$(while IFS= read -r s; do [ -n "$s" ] && printf '%s;\n' "$s" | spsql "$RDB"; done <<< "$envq" | PO07_FEK="$key" node -e '
  const crypto = require("crypto"); const ring = new Map(process.env.PO07_FEK.split(",").map((e) => [Number(e.slice(0, e.indexOf(":"))), Buffer.from(e.slice(e.indexOf(":") + 1), "base64")]));
  let ok = 0, bad = 0; const cols = new Set();
  for (const line of require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean)) {
    const i = line.indexOf("|"); cols.add(line.slice(0, i)); const [v, iv, tag, ct] = line.slice(i + 1).split(":");
    try { const d = crypto.createDecipheriv("aes-256-gcm", ring.get(Number(v.slice(1))), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64")); Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]); ok++; } catch { bad++; }
  }
  console.log(`${ok} ${bad} ${[...cols].sort().join(",") || "-"}`);')"
unset key
read -r env_ok env_bad env_cols <<< "$res"
[ "${env_bad:-1}" = 0 ] || stop_now "$env_bad field-encryption envelope(s) do not decrypt with the owner-held key (kept: $RDB, $R)"
say "administrators: $admins restored ($act_mfa active with MFA enrolled); encrypted fields: $env_ok envelope(s) decrypt with the owner-held key ($env_cols); no value printed"
install -d -m 0700 "$R/files"
tar -xf "$R/storage.tar" -C "$R/files" --no-same-owner
[ "$(cd "$R/files" && find storage -type f -print0 | sort -z | xargs -0 -r sha256sum)" = "$(cat "$R/storage.sha256")" ] || stop_now "the restored files differ from the recorded SHA-256 (kept: $R)"
say "files: $(grep -c . "$R/storage.sha256" || true) restored into the isolated $R/files, every SHA-256 as recorded"
[ "$(counts "$DB" | sha256sum | cut -c1-16)" = "$active0" ] || stop_now "the ACTIVE database changed during the drill"
say "the active database $DB is unchanged (per-table counts)"
summary="$(printf '%s restore drill PASS: object %s, backup %s, %s tables, %s admin(s), %s envelope(s) decrypted, %s file(s)' "$(date -u +%FT%TZ)" "${EXP:0:16}" \
  "$(mf created_at)" "$(grep -c . "$R/rowcounts.tsv")" "$admins" "$env_ok" "$(mf storage_files)")"
printf 'drop database "%s";\n' "$RDB" | spsql postgres > /dev/null
safe_rm "$R"
printf '%s\n' "$summary" >> "$STATE_DIR/S12.restore-drills.log"; say "$summary; the disposable database and directory are removed"
guard_shared
mark_done
