# PO-07 S12 (encrypted backups, off-host copy, restore drill) and S13 (F1–F7), rehearsed — sourced by rehearsal.sh as
# root after S9, S11 and the PostgreSQL cap. LOCAL REHEARSAL ONLY: a disposable MinIO (S3 with Object Lock) stands in
# for Backblaze B2, with fictional credentials; the owner's GPG key is a fictional CI key whose private half stays in
# a separate "PC" directory and never enters the kit. Real B2 behaviour (key capabilities, lock, lifecycle, caps) is
# verified only by the owner's own setup steps (PO07_S10_S13_EXECUTION_PLAN.md §9); this proves the kit's mechanics.
expect_stop() { # LABEL PATTERN CMD... — must refuse for that reason; the expected STOP record is set aside (harness)
  local l="$1" p="$2"; shift 2; local o rc=0; o="$("$@" 2>&1)" || rc=$?
  [ "$rc" -ne 0 ] && grep -q -- "$p" <<< "$o" || { printf '%s\n' "$o" | tail -20; fail "$l: no refusal for '$p'"; }
  [ ! -f "$STATE_DIR/STOPPED" ] || mv "$STATE_DIR/STOPPED" "$STATE_DIR/STOPPED.ci-expected-s12s13-$(date +%s%N)"
  echo "ok: $l"
}
sock_get() { node -e 'const [s,h,p]=process.argv.slice(1);require("http").get({socketPath:s,path:p,headers:{host:h,"x-forwarded-host":h,"x-forwarded-proto":"https"}},r=>{console.log(r.statusCode);r.resume()}).on("error",()=>console.log(0))' "$1" "$2" "$3"; }

step "S12 (CI): the object-storage stand-in (MinIO, Object Lock, default retention GOVERNANCE 14 days) and its two keys"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone > /dev/null || fail "apt-get install rclone"
UPW="$(openssl rand -hex 16)"; RPW="$(openssl rand -hex 16)"; B=po07-ci   # MR: the stand-in's fictional root key (rehearsal.sh)
W="$RUNNER_TEMP/mc"; install -d -m 0700 "$W"
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject","s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::%s","arn:aws:s3:::%s/*"]}]}' "$B" "$B" > "$W/upload.json"
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::%s","arn:aws:s3:::%s/*"]}]}' "$B" "$B" > "$W/read.json"
mc() { MC_CONFIG_DIR="$W/.mc" MC_HOST_ci="http://ci-root:$MR@127.0.0.2:9000" "$PO07_S3BIN/mc" --quiet --no-color "$@"; }
mc mb --with-lock "ci/$B" > /dev/null && mc retention set --default GOVERNANCE 14d "ci/$B" > /dev/null || fail "bucket with Object Lock"
mc admin user add ci uploader "$UPW" > /dev/null && mc admin policy create ci po07-upload "$W/upload.json" > /dev/null && mc admin policy attach ci po07-upload --user uploader > /dev/null || fail "the upload key"
mc admin user add ci reader "$RPW" > /dev/null && mc admin policy create ci po07-read "$W/read.json" > /dev/null && mc admin policy attach ci po07-read --user reader > /dev/null || fail "the owner's read key"
echo "bucket $B: Object Lock on, default retention $(mc retention info --default "ci/$B" 2> /dev/null | tr -s ' ' | head -1); keys: uploader (put/list only), reader (get/list)"
rconf() { printf '[%s]\ntype = s3\nprovider = Minio\nendpoint = http://127.0.0.2:9000\naccess_key_id = %s\nsecret_access_key = %s\nregion = us-east-1\n' "$OFFSITE_REMOTE" "$1" "$2"; }
install -d -m 0700 "$(dirname "$OFFSITE_CONF")"; rconf uploader "$UPW" > "$OFFSITE_CONF"; chmod 0600 "$OFFSITE_CONF"
rconf reader "$RPW" > "$RUNNER_TEMP/reader.conf"
end

step "S12 (CI): the owner's key pair on the 'PC' side; only its PUBLIC half and fingerprint reach the VPS side (pc-kit.sh backup-key)"
OG="$RUNNER_TEMP/owner-pc-gnupg"; install -d -m 0700 "$OG"
# The owner's PC is another machine: in CI its GnuPG (and the gpg-agent it starts) runs in its own network namespace,
# so the agent's sockets are not listeners on the "VPS" (the kit's §I guard would rightly refuse them); stopped after use.
pcgpg() { unshare --net -- gpg --homedir "$OG" "$@"; }
pc_agent_off() { gpgconf --homedir "$OG" --kill all 2> /dev/null || true; }
pcgpg --batch --passphrase '' --quick-generate-key "PO07 CI owner (fictional) <owner@example.invalid>" ed25519 cert,sign 1d 2> /dev/null
FPR="$(pcgpg --list-keys --with-colons 2> /dev/null | awk -F: '$1 == "fpr" {print $10; exit}')"
pcgpg --batch --passphrase '' --quick-add-key "$FPR" cv25519 encr 1d 2> /dev/null
install -d -m 0755 "$BACKUP_KEY_DIR"
pcgpg --armor --export "$FPR" > "$BACKUP_KEY_DIR/owner.pub.asc"; pc_agent_off; printf '%s\n' "$FPR" > "$BACKUP_KEY_DIR/owner.fpr"; chmod 0644 "$BACKUP_KEY_DIR"/owner.*
! grep -q 'PRIVATE KEY' "$BACKUP_KEY_DIR/owner.pub.asc" || fail "a private key reached the VPS side"
# a representative encrypted field: a fictional customer user's MFA secret, encrypted with the staging field key
env_val="$(sed -n 's/^FIELD_ENCRYPTION_KEYS=//p' "$ETC_DIR/customer.env" | PO07_PT="$(openssl rand -hex 10)" node -e '
  const c = require("crypto"); const ring = require("fs").readFileSync(0, "utf8").trim(); const e = ring.split(",")[0]; const v = e.slice(0, e.indexOf(":")), k = Buffer.from(e.slice(e.indexOf(":") + 1), "base64");
  const iv = c.randomBytes(12), x = c.createCipheriv("aes-256-gcm", k, iv), ct = Buffer.concat([x.update(process.env.PO07_PT), x.final()]);
  console.log(`v${v}:${iv.toString("base64")}:${x.getAuthTag().toString("base64")}:${ct.toString("base64")}`);')"
printf "update users set mfa_secret = '%s' where id = (select min(id) from users);\n" "$env_val" | runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d "$DB" > /dev/null
unset env_val
sed -i 's/^stages=\(.*\)$/stages=\1 S12 S13 F1 F2 F3 F4 F5 F6 F7/' "$STATE_DIR/AUTHORIZED"   # the CI window's authorization
# fictional uploads, so the backup and the restore drill carry real files (one nested; one binary), as the app's fake
# storage would hold them (owned by the app user, readable by the backup unit)
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STORAGE_DIR/ci-fictional" "$STORAGE_DIR/ci-fictional/org-0001"
printf 'PO-07 CI fictional upload (not real data)\n' > "$STORAGE_DIR/ci-fictional/readme.txt"
head -c 65536 /dev/urandom > "$STORAGE_DIR/ci-fictional/org-0001/logo-fictional.bin"
chown "$APP_USER:$APP_USER" "$STORAGE_DIR/ci-fictional/readme.txt" "$STORAGE_DIR/ci-fictional/org-0001/logo-fictional.bin"
chmod 0640 "$STORAGE_DIR/ci-fictional/readme.txt" "$STORAGE_DIR/ci-fictional/org-0001/logo-fictional.bin"
NFILES="$(find "$STORAGE_DIR" -type f | wc -l)"; [ "$NFILES" -ge 2 ] || fail "the fictional uploads are not in place"
echo "owner fingerprint $FPR; one fictional encrypted MFA field and $NFILES fictional upload file(s) in place"
end

step "S12 (CI): s12_backup.sh --execute — backup inside the namespace, encrypted, off-host copy, timers"
bash "$KIT_DIR/s12_backup.sh" --execute 2>&1 | tail -22; [ -f "$STATE_DIR/S12.backup-ok" ] || fail "S12 backup"
journalctl -u elite-po-backup.service -u elite-po-offsite.service -o cat --no-pager | grep -E '^(BACKUP|OFFSITE) ok' || fail "no BACKUP/OFFSITE ok in the journal"
OBJ="$(ls -1t "$BACKUP_DIR"/outbox/po07-staging-*.tar.gpg | head -1)"; ON="$(basename "$OBJ")"
install -d -m 0700 "$RUNNER_TEMP/listp"; ESUB="$(pcgpg --list-keys --with-colons | awk -F: '$1 == "sub" {print $5; exit}')"
gpg --batch --no-autostart --homedir "$RUNNER_TEMP/listp" --list-packets "$OBJ" > "$RUNNER_TEMP/listp/packets.txt" 2>&1 || true   # no key here: never an agent
grep -q ":pubkey enc packet: version 3, algo 18, keyid $ESUB" "$RUNNER_TEMP/listp/packets.txt" ||
  fail "the backup is not encrypted to the owner's encryption subkey"
[ "$(head -c 5 "$OBJ")" != PGDMP ] && ! grep -aq 'CREATE TABLE' "$OBJ" || fail "plaintext in the encrypted backup"
[ -z "$(find "$BACKUP_DIR" -type f ! -name 'po07-staging-*.tar.gpg' ! -name 'po07-staging-*.tar.gpg.sha256')" ] || fail "an unencrypted file is on disk"
[ "$(systemctl show -p NetworkNamespacePath --value elite-po-backup.service)" = "/run/netns/$NS" ] || fail "the backup unit is not in the namespace"
[ -z "$(systemctl show -p NetworkNamespacePath --value elite-po-offsite.service)" ] && [ "$(systemctl show -p DynamicUser --value elite-po-offsite.service)" = yes ] || fail "the uploader unit's identity"
r="$(mc retention info "ci/$B/$OFFSITE_PREFIX/$ON" 2>&1)"; grep -qi governance <<< "$r" || fail "the off-host object is not retained (Object Lock): $r"
echo "ok: $ON encrypted to the owner's subkey only; no plaintext on disk; the backup ran in the namespace; the uploader is a dynamic identity outside it; the off-host object is under GOVERNANCE retention"
cp "$OBJ" "$RUNNER_TEMP/forged.tar.gpg"; printf 'x' | dd of="$RUNNER_TEMP/forged.tar.gpg" bs=1 seek=200 conv=notrunc 2> /dev/null
cmp -s "$OBJ" "$RUNNER_TEMP/forged.tar.gpg" && fail "the forged copy does not differ (harness)"
T="ci/$B/$OFFSITE_PREFIX/$ON"
# mc ls treats the name as a prefix (it would list the .sha256 sidecar too): keep the exact key only
vers() { mc ls --versions --json "$T" | jq -r --arg k "$ON" 'select(.type == "file" and (.key | split("/") | last) == $k) | "\(.versionId) \(.size) \(.isLatest // false) \(.isDeleteMarker // false)"'; }
v0="$(vers)"; [ "$(grep -c . <<< "$v0")" = 1 ] || { echo "$v0"; fail "expected exactly one off-host version before the attack"; }
vid="${v0%% *}"; [ -n "$vid" ] && [ "$vid" != null ] || { echo "$v0"; fail "the original version id could not be read"; }
mc cat --version-id "$vid" "$T" | cmp -s - "$OBJ" || fail "the original off-host version does not equal the local backup (before any attack)"
if rclone --config "$OFFSITE_CONF" deletefile "$OFFSITE_REMOTE:$B/$OFFSITE_PREFIX/$ON" > /dev/null 2>&1; then fail "the upload key could delete an off-host backup"; fi
rclone --config "$OFFSITE_CONF" copyto --s3-no-head --no-check-dest "$RUNNER_TEMP/forged.tar.gpg" "$OFFSITE_REMOTE:$B/$OFFSITE_PREFIX/$ON" > "$RUNNER_TEMP/overwrite.txt" 2>&1 \
  && ow="the PUT was accepted as a new version" || ow="the PUT was refused ($(grep -oE 'status code: [0-9]+|AccessDenied|Forbidden' "$RUNNER_TEMP/overwrite.txt" | head -1))"
v1="$(vers)"; echo "versions after the attack (id size latest deletemarker):"; sed 's/^/  /' <<< "$v1"
mc cat --version-id "$vid" "$T" | cmp -s - "$OBJ" || fail "the original off-host version $vid is not intact after an overwrite attempt"
grep -qi governance <<< "$(mc retention info --version-id "$vid" "$T" 2>&1)" || fail "the original version $vid lost its GOVERNANCE retention"
if mc rm --version-id "$vid" "$T" > /dev/null 2>&1; then fail "a locked version could be deleted without bypassing governance (even by the root key)"; fi
mc cat --version-id "$vid" "$T" | cmp -s - "$OBJ" || fail "the original version $vid is gone after a delete attempt"
echo "ok: the upload key cannot delete; a hostile overwrite ($ow) leaves the original version $vid byte-identical and under GOVERNANCE retention; even the root key cannot delete it without bypass; the uploader itself uses copy --immutable"
end

step "S12 (CI): the restore drill — the 'owner' downloads with the read key, checks the sidecar, decrypts on the 'PC', streams to restore-verify.sh"
DL="$RUNNER_TEMP/owner-download"; install -d -m 0700 "$DL"
rclone --config "$RUNNER_TEMP/reader.conf" copy "$OFFSITE_REMOTE:$B/$OFFSITE_PREFIX" "$DL" --include "$ON" --include "$ON.sha256" > /dev/null || fail "the owner's download"
SHA="$(cut -d' ' -f1 "$DL/$ON.sha256")"; [ "$(sha256sum "$DL/$ON" | cut -d' ' -f1)" = "$SHA" ] || fail "the downloaded object does not match its sidecar"
dec() { pcgpg --batch --quiet --pinentry-mode loopback --passphrase '' --decrypt "$1"; }
before_active="$(runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d "$DB" -c 'select count(*) from users')"
expect_stop "restore-verify refuses an object the off-host copy never verified" "not among the off-host copies" bash "$KIT_DIR/tools/restore-verify.sh" --execute "$(openssl rand -hex 32)"
expect_stop "a corrupted backup fails the drill (nothing restored, nothing accepted)" "STOP" bash -c "{ unshare --net -- gpg --batch --quiet --homedir '$OG' --pinentry-mode loopback --passphrase '' --decrypt '$RUNNER_TEMP/forged.tar.gpg' 2> /dev/null || true; } | bash '$KIT_DIR/tools/restore-verify.sh' --execute '$SHA'"
[ ! -f "$STATE_DIR/S12.done" ] || fail "a failed drill marked S12 done"
for d in $(ls -d "$VAR_DIR"/restore-* 2> /dev/null); do rm -rf -- "$d"; done   # harness: the kept evidence of the expected failure
for d in $(runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d postgres -c "select datname from pg_database where datname like 'elite_po_restore_%'"); do runuser -u "$PG_USER" -- psql -X -q -h "$PG_RUN" -p "$PG_PORT" -d postgres -c "drop database \"$d\""; done
dec "$DL/$ON" | bash "$KIT_DIR/tools/restore-verify.sh" --execute "$SHA" 2>&1 | tail -10
pc_agent_off
[ -f "$STATE_DIR/S12.done" ] || fail "the restore drill did not pass"
grep -q 'restore drill PASS' "$STATE_DIR/S12.restore-drills.log" && grep -qE ' [1-9][0-9]* envelope\(s\) decrypted' "$STATE_DIR/S12.restore-drills.log" || fail "the drill record"
grep -qE " $NFILES file\(s\)\$" "$STATE_DIR/S12.restore-drills.log" || { tail -1 "$STATE_DIR/S12.restore-drills.log"; fail "the drill did not restore all $NFILES fictional upload file(s)"; }
[ -z "$(ls -d "$VAR_DIR"/restore-* 2> /dev/null)" ] && [ -z "$(runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d postgres -c "select datname from pg_database where datname like 'elite_po_restore_%'")" ] || fail "the disposable restore resources were not removed"
[ "$(runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d "$DB" -c 'select count(*) from users')" = "$before_active" ] || fail "the active database changed"
echo "ok: the drill restored into a disposable database and directory, verified schema, counts, files and the encrypted field, removed them, left the active database unchanged; S12 accepted"
S12_OK=1
end

step "S13 (CI): F1–F7 one at a time, strict order, automated checks, an injected failure reverts, then F7 → F1 off"
install -m 0600 /dev/null "$STATE_DIR/S11.phaseB-ok"; install -m 0600 /dev/null "$STATE_DIR/S11.tls-ok"   # the S11 rehearsal above passed
SWITCH_RE="$(grep '^SWITCH_RE=' "$KIT_DIR/lib.sh" | cut -d"'" -f2)"   # the kit's own pattern (the harness does not source lib.sh)
[[ "$SWITCH_RE" == '^(PLATFORM_'* ]] || fail "could not read the kit's SWITCH_RE"
S13="$KIT_DIR/s13_switch.sh"
expect_stop "F2 before F1 is refused" "F1 must be on before F2" bash "$S13" --execute F2 on
expect_stop "an unknown switch is refused" "usage" bash "$S13" --execute F9 on
for f in F1 F2 F3 F4 F5 F6; do bash "$S13" --execute "$f" on 2>&1 | grep -E 'automated checks|STOP' | tail -1; grep -qx "$f" "$STATE_DIR/S13.switches" || fail "$f did not go on"; done
[ "$(sock_get "$RUN_DIR/admin.sock" "$ADMIN_HOST" /platform/login)" = 200 ] && [ "$(sock_get "$RUN_DIR/customer.sock" "$CUST_HOST" /platform/login)" = 404 ] || fail "F1: the console state"
expect_stop "an injected failure of F7 turns it back off and STOPs" "F7 on failed its checks; F7 is back off" env PO07_S13_FORCE_FAIL=F7 bash "$S13" --execute F7 on
! grep -q '^CUSTOMER_SEAT_ENFORCEMENT_ENABLED=' "$ETC_DIR/admin.env" "$ETC_DIR/customer.env" && ! grep -qx F7 "$STATE_DIR/S13.switches" || fail "F7 not reverted"
bash "$S13" --execute F7 on 2>&1 | grep -E 'automated checks' | tail -1; grep -qx F7 "$STATE_DIR/S13.switches" || fail "F7 did not go on"
[ "$(grep -cE "$SWITCH_RE" "$ETC_DIR/admin.env")" = 7 ] && [ "$(grep -cE "$SWITCH_RE" "$ETC_DIR/customer.env")" = 4 ] && ! grep -qE '^PLATFORM_[A-Z_]*_ENABLED=' "$ETC_DIR/customer.env" || fail "the switch lines per file"
[ -f "$STATE_DIR/S13.done" ] || fail "S13 not marked after F1–F7"
bash "$KIT_DIR/s7_envfiles.sh" --execute > /dev/null 2>&1 || fail "S7's re-check refuses the recorded switches"
expect_stop "F3 off while F4 is on is refused (reverse order)" "turn F4 off first" bash "$S13" --execute F3 off
for f in F7 F6 F5 F4 F3 F2 F1; do bash "$S13" --execute "$f" off > /dev/null 2>&1 || fail "$f off"; done
[ -z "$(grep -E "$SWITCH_RE" "$ETC_DIR/admin.env" "$ETC_DIR/customer.env")" ] && [ "$(sock_get "$RUN_DIR/admin.sock" "$ADMIN_HOST" /platform/login)" = 404 ] || fail "not back to all switches off"
grep -c ' on: automated checks passed\| off: automated checks passed' "$STATE_DIR/S13.log"
echo "ok: F1–F7 on in order and off in reverse, each with its automated checks; the injected failure reverted F7; every file and process back to no switch"
S13_OK=1
end
