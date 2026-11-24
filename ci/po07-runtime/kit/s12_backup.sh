#!/usr/bin/env bash
# S12 — encrypted daily backups and the off-host copy (plan §G; owner decisions D5 Backblaze B2, D6 the owner's GPG key).
# Prerequisites placed by the OWNER, never through an AI session: the off-host rclone configuration
# ($OFFSITE_CONF, root 0600: the bucket-restricted upload key without deleteFiles or bypassGovernance). The owner's
# PUBLIC key and its fingerprint ($BACKUP_KEY_DIR/owner.pub.asc, owner.fpr) arrive by `pc-kit.sh backup-key` (public
# material only; the private key never reaches the VPS). This stage:
#   1. checks them (no secret key in the key file; the fingerprint matches; the bucket name is set) — never prints a secret;
#   2. creates the outbox group (no user is added to it) and the backup directories (outbox setgid 2750);
#   3. installs backup-run.sh, offsite-run.sh, the two services and two timers, and backup.conf (no secret);
#   4. runs one backup (inside the namespace) and one off-host copy, and verifies them;
#   5. enables the two daily timers.
# S12 is ACCEPTED only after the restore drill (tools/restore-verify.sh) passes: this stage records S12.backup-ok, not S12.done.
STAGE=S12; . "$(dirname "$0")/lib.sh"
stage_begin S9
guard_shared
start_thresholds
U="$KIT_HERE/units"; T="$APP_DIR/.kit-tools"
if [ "$MODE" = execute ]; then
  [ -n "$OFFSITE_BUCKET" ] || stop_now "OFFSITE_BUCKET is not set (the owner's bucket name, from the owner's written instruction)"
  for f in "$BACKUP_KEY_DIR/owner.pub.asc" "$BACKUP_KEY_DIR/owner.fpr"; do
    [ -f "$f" ] && [ ! -L "$f" ] && [ "$(stat -c %U "$f")" = root ] || stop_now "$f missing (pc-kit.sh backup-key)"
  done
  [ -f "$OFFSITE_CONF" ] && [ ! -L "$OFFSITE_CONF" ] && [ "$(stat -c '%a %U:%G' "$OFFSITE_CONF")" = "600 root:root" ] || stop_now "$OFFSITE_CONF missing or not 0600 root:root (the owner enters it in their own terminal)"
  grep -qx "\[$OFFSITE_REMOTE\]" "$OFFSITE_CONF" || stop_now "$OFFSITE_CONF has no [$OFFSITE_REMOTE] section"
  for c in rclone gpg /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore; do command -v "$c" > /dev/null || stop_now "$c is missing (no software is installed by the kit)"; done
  g="$(mktemp -d)"
  [ "$(gpg --batch --homedir "$g" --show-keys --with-colons "$BACKUP_KEY_DIR/owner.pub.asc" 2> /dev/null | grep -c '^sec')" -eq 0 ] || { rm -rf -- "$g"; stop_now "the key file contains a SECRET key: refused (only the owner's public key belongs on the VPS)"; }
  fprs="$(gpg --batch --homedir "$g" --show-keys --with-colons "$BACKUP_KEY_DIR/owner.pub.asc" 2> /dev/null | awk -F: '$1 == "fpr" {print $10}')"; rm -rf -- "$g"
  grep -qx "$(tr -dc 'A-F0-9' < "$BACKUP_KEY_DIR/owner.fpr")" <<< "$fprs" || stop_now "owner.fpr does not match the public key"
  say "the owner's public key: fingerprint $(tr -dc 'A-F0-9' < "$BACKUP_KEY_DIR/owner.fpr") (the owner compares it with Kleopatra)"
fi
if [ "$MODE" = plan ] || ! getent group "$UPLOAD_GROUP" > /dev/null; then act groupadd --system "$UPLOAD_GROUP"; [ "$MODE" = execute ] && date -u +%FT%TZ > "$STATE_DIR/S12.created.group"; fi
upload_group_empty() { [ -z "$(getent group "$UPLOAD_GROUP" | cut -d: -f4)" ]; }
check "the outbox group $UPLOAD_GROUP has no member (the uploader gets it only as its unit's supplementary group)" upload_group_empty
mkdir_staging "$BACKUP_DIR" 0750 "$APP_USER:$APP_USER"
mkdir_staging "$BACKUP_DIR/outbox" 2750 "$APP_USER:$UPLOAD_GROUP"
put_file "$T/backup-run.sh" 0640 "root:$APP_USER" "$KIT_HERE/tools/backup-run.sh"
put_file "$T/offsite-run.sh" 0644 root:root "$KIT_HERE/tools/offsite-run.sh"
for u in elite-po-backup.service elite-po-backup.timer elite-po-offsite.service elite-po-offsite.timer; do put_file "/etc/systemd/system/$u" 0644 root:root "$U/$u"; done
conf() { printf 'DB=%q\nBACKUP_ROLE=%q\nPG_PORT=%q\nKIT_VERSION=%q\nAPPROVED_SHA=%q\nAPPROVED_TREE=%q\nAPPROVED_BUILD_ID=%q\nAPPROVED_RUN_ID=%q\nOFFSITE_REMOTE=%q\nOFFSITE_BUCKET=%q\nOFFSITE_PREFIX=%q\n' \
  "$DB" "$BACKUP_ROLE" "$PG_PORT" "$KIT_VERSION" "$APPROVED_SHA" "$APPROVED_TREE" "$APPROVED_BUILD_ID" "$APPROVED_RUN_ID" "$OFFSITE_REMOTE" "$OFFSITE_BUCKET" "$OFFSITE_PREFIX"; }
if [ "$MODE" = plan ]; then plan "write $BACKUP_KEY_DIR/backup.conf (0644 root, no secret): database, backup role, port, kit, release, bucket"
else conf > "$BACKUP_KEY_DIR/backup.conf.tmp" && chmod 0644 "$BACKUP_KEY_DIR/backup.conf.tmp" && mv -- "$BACKUP_KEY_DIR/backup.conf.tmp" "$BACKUP_KEY_DIR/backup.conf"; fi
sctl daemon-reload
sctl start elite-po-backup.service || stop_now "the backup service failed (journalctl -u elite-po-backup.service); nothing was uploaded"
newest() { ls -1t "$BACKUP_DIR"/outbox/po07-staging-*.tar.gpg 2> /dev/null | head -1; }
backup_ok() {
  local f; f="$(newest)"; [ -n "$f" ] && [ -f "$f.sha256" ] || return 1
  (cd "$BACKUP_DIR/outbox" && sha256sum --quiet -c "$(basename "$f").sha256") || return 1
  # no key in the empty home and --no-autostart: never a gpg-agent (a listener the §I guard would refuse); output
  # captured first (a pipe into grep -q under pipefail can turn a match into a failure)
  local g p; g="$(mktemp -d)"; p="$(gpg --batch --no-autostart --homedir "$g" --list-packets "$f" 2>&1 || true)"; rm -rf -- "$g"
  grep -q ':pubkey enc packet:' <<< "$p" || return 1
  [ "$(stat -c '%a %G' "$f")" = "640 $UPLOAD_GROUP" ] || return 1
  [ -z "$(find "$BACKUP_DIR" -type f ! -name 'po07-staging-*.tar.gpg' ! -name 'po07-staging-*.tar.gpg.sha256')" ]
}
check "one backup exists, encrypted to the owner's public key, its SHA-256 sidecar verifies, nothing unencrypted is on disk" backup_ok
sctl start elite-po-offsite.service || stop_now "the off-host copy failed (journalctl -u elite-po-offsite.service); the encrypted backup stays in the outbox"
offsite_ok() { local f; f="$(newest)"; grep -q "^$(basename "$f") $(cut -d' ' -f1 "$f.sha256")$" /var/lib/private/elite-po-offsite/verified-objects.txt; }
check "the off-host copy lists that backup with the same size (elite-po-offsite verified it)" offsite_ok
sctl enable --now elite-po-backup.timer elite-po-offsite.timer
timers_ok() { [ "$(systemctl is-active elite-po-backup.timer)" = active ] && [ "$(systemctl is-active elite-po-offsite.timer)" = active ]; }
check "the two daily timers are active" timers_ok
guard_shared
if [ "$MODE" = execute ]; then
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$(basename "$(newest)")" "$(cut -d' ' -f1 "$(newest).sha256")" > "$STATE_DIR/S12.backup-ok"
  say "S12 backup and off-host copy in place. S12 is ACCEPTED only after the restore drill: tools/pc-restore-drill.sh (owner) → tools/restore-verify.sh"
fi
