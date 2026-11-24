#!/usr/bin/env bash
# PO-07 S12: the off-host copy — run ONLY by elite-po-offsite.service (a dynamic, unprivileged identity outside the
# namespace). It sees the encrypted outbox (read-only) and its rclone configuration (a credential), nothing else.
# rclone copy (never sync) with --immutable: an object that exists is never overwritten, nothing is ever deleted; the
# upload key has no delete or bypass-governance capability anyway, and the bucket's default Object Lock (14 days)
# retains every object. Afterwards every local backup must be listed remotely with the same size and SHA-256 sidecar.
set -Eeuo pipefail
umask 077
export LC_ALL=C
K=/run/po07-offsite
# shellcheck source=/dev/null
. "$CREDENTIALS_DIRECTORY/backup.conf"   # OFFSITE_REMOTE, OFFSITE_BUCKET, OFFSITE_PREFIX, PG_PORT (no secret)
O=/var/lib/elite-po-staging/backups/outbox; RC="$CREDENTIALS_DIRECTORY/rclone.conf"; ST="${STATE_DIRECTORY:-$HOME}"
die() { echo "offsite: FAILED: $*" >&2; exit 1; }
# ---- self-checks: this identity can reach nothing but the outbox and the internet ----
for p in /etc/elite-po-staging/admin.env /etc/elite-po-staging/customer.env /etc/elite-po-staging/owner-db.env /etc/elite-po-staging/secrets/app.pw \
  /etc/elite-po-staging/secrets/owner.pw /etc/elite-po-staging/secrets/backup.pw; do
  if head -c1 "$p" > /dev/null 2>&1; then die "$p is readable from the uploader"; fi
done
for p in /var/lib/postgresql /srv/elite-po-staging/app /var/lib/elite-po-staging/storage /run/elite-po-pg /run/elite-po-staging; do
  if [ -e "$p" ]; then die "$p exists in the uploader's view (it must be hidden)"; fi
done
if ls /root > /dev/null 2>&1 && [ -n "$(ls -A /root 2> /dev/null)" ]; then die "/root is visible to the uploader"; fi
for port in 5432 "$PG_PORT"; do if timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2> /dev/null; then die "a local database port ($port) is reachable"; fi; done
[ -d "$O" ] || die "no outbox"
if touch "$O/.po07-write-test" 2> /dev/null; then rm -f -- "$O/.po07-write-test"; die "the outbox is writable by the uploader"; fi
bad="$(find "$O" -mindepth 1 -maxdepth 1 ! -name 'po07-staging-*.tar.gpg' ! -name 'po07-staging-*.tar.gpg.sha256' ! -name '.*.part' -printf '%f ')"
[ -z "$bad" ] || die "unexpected files in the outbox: $bad"
[ -n "$OFFSITE_BUCKET" ] && [ -r "$RC" ] || die "no off-host bucket or rclone configuration"
DEST="$OFFSITE_REMOTE:$OFFSITE_BUCKET/$OFFSITE_PREFIX"
R=(rclone --config "$RC" --cache-dir "$ST/cache" --s3-no-check-bucket --retries 3 --low-level-retries 5 --stats 0)
"${R[@]}" copy "$O" "$DEST" --immutable --no-traverse --include 'po07-staging-*.tar.gpg' --include 'po07-staging-*.tar.gpg.sha256' \
  || die "rclone copy failed (nothing is deleted or overwritten; the next run retries)"
# ---- verify: every local backup and sidecar is there with the same size ----
remote="$("${R[@]}" lsf "$DEST" --format "ps" --separator " " --files-only)" || die "cannot list the off-host copies"
n=0; for f in "$O"/po07-staging-*.tar.gpg "$O"/po07-staging-*.tar.gpg.sha256; do
  [ -e "$f" ] || continue; b="$(basename "$f")"; s="$(stat -c %s "$f")"
  grep -qx "$b $s" <<< "$remote" || die "$b is missing or has another size off-host"
  n=$((n + 1))
done
printf '%s %s objects verified off-host (%s)\n' "$(date -u +%FT%TZ)" "$n" "$DEST" >> "$ST/uploaded.log"
for f in "$O"/po07-staging-*.tar.gpg; do [ -e "$f" ] && printf '%s %s\n' "$(basename "$f")" "$(cut -d' ' -f1 "$f.sha256")"; done > "$ST/verified-objects.txt"
echo "OFFSITE ok: $n objects present off-host with matching sizes ($DEST)"
