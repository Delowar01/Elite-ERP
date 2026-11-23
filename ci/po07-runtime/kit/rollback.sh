#!/usr/bin/env bash
# PO-07 bounded rollback (plan §J), one stage at a time, in reverse order. Each step removes ONLY what the kit created:
# every path passes the staging allow-list and a no-symlink check, every unit the staging-unit allow-list, every
# file is removed only if it still equals the kit's copy, users only if the kit's S1 marker exists. Nothing here
# touches the ERP, cluster main, nginx, CloudPanel, DNS, ufw or any other application.
#   rollback.sh <S9|S8|S7|S6|S5|S4|S3|S2|S1|all> [--plan|--execute]
# A stage is rolled back only after every later stage has been (S9 first). Outside the execution window it refuses
# unless the owner approved it: PO_ROLLBACK_OUTSIDE_WINDOW=owner-approved.
TARGET="${1:-}"; shift || true
case "$TARGET" in S1|S2|S3|S4|S5|S6|S7|S8|S9|all) ;; *) echo "usage: $0 <S1..S9|all> [--plan|--execute]" >&2; exit 64 ;; esac
STAGE="RB-$TARGET"; . "$(dirname "$0")/lib.sh" "${1:---plan}"
U="$KIT_HERE/units"
if [ "$MODE" = execute ]; then
  load_baseline
  require_vps
  if [ "${PO_ROLLBACK_OUTSIDE_WINDOW:-}" != owner-approved ]; then require_window 1; fi
  GATE_PASSED=1   # from here a rollback changes things: a STOP below is recorded as "AFTER changes"
  mkdir -p "$STATE_DIR/logs"; exec > >(tee -a "$STATE_DIR/logs/$STAGE-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
fi
say "==== rollback $TARGET ($MODE) ===="
# safe_rm (lib.sh): recursive removal of a staging path only.
rm_kit_file() { # DEST SRC — remove only if it is still the kit's file
  assert_staging_path "$1"
  if [ "$MODE" = execute ]; then
    [ -e "$1" ] || { say "absent: $1"; return 0; }
    cmp -s "$1" "$2" || stop_now "$1 differs from the kit's copy; not removing it"
  fi
  act rm -f -- "$1"
}
later_done() { [ "$MODE" = plan ] && return 1; local s; for s in "$@"; do [ -f "$STATE_DIR/$s.done" ] && return 0; done; return 1; }
unmark() { [ "$MODE" = execute ] && rm -f "$STATE_DIR/$1.done"; say "$1 rolled back"; }
spsql_ok() { [ "$MODE" = plan ] || [ "$(systemctl is-active postgresql@16-po07ns.service)" = active ]; }

rb_S9() {
  sctl disable --now elite-po-admin-proxy.socket elite-po-customer-proxy.socket
  sctl stop elite-po-admin-proxy.service elite-po-customer-proxy.service
  sctl disable --now elite-po-admin.service elite-po-customer.service
  local f; for f in elite-po-admin-proxy.socket elite-po-admin-proxy.service elite-po-customer-proxy.socket elite-po-customer-proxy.service elite-po-admin.service elite-po-customer.service; do
    rm_kit_file "/etc/systemd/system/$f" "$U/$f"
  done
  sctl daemon-reload
  safe_rm "$RUN_DIR"
  # Fictional uploads: the storage directory is removed only when empty; otherwise the owner decides (§J step 7).
  if [ "$MODE" = plan ]; then plan "rmdir $STORAGE_DIR $VAR_DIR (only if empty)"
  else rmdir "$STORAGE_DIR" 2>/dev/null || say "kept (not empty): $STORAGE_DIR"; rmdir "$VAR_DIR" 2>/dev/null || say "kept: $VAR_DIR"; fi
  unmark S9
}
rb_S8() { # the database back to its S4 state: dropped here, recreated empty by re-running S4
  later_done S9 && stop_now "roll back S9 first"
  spsql_ok || stop_now "the staging cluster is not running"
  assert_staging_cluster
  if [ "$MODE" = plan ]; then plan "psql (peer, staging cluster): drop database $DB with (force)"
  else printf 'drop database if exists %s with (force);\n' "$DB" | spsql postgres; fi
  unmark S8; unmark S4; say "re-run S4 to recreate the empty database (roles and passwords are kept)"
}
rb_S7() {
  later_done S8 S9 && stop_now "roll back S8 first"
  safe_rm "$ETC_DIR/admin.env" "$ETC_DIR/customer.env" "$ETC_DIR/owner-db.env"
  say "NOTE: any keys the owner escrowed from these files are now orphaned (fictional staging only)"
  unmark S7
}
rb_S6() { # S6-R's installed artifact (and any output of the retired on-VPS build) → back to the verified S5 clone
  later_done S7 S8 S9 && stop_now "roll back S7 first"
  sctl stop elite-po-install.service || true
  sctl stop elite-po-build.service || true
  safe_rm "$APP_SRC/.next" "$APP_SRC/node_modules" "$BUILD_HOME/.npm" "$EXTRACT_DIR" "$APP_DIR/.kit-tools"
  say "kept for audit: the verified archive in $INCOMING_DIR and $STATE_DIR/artifact/ (removed with the kit after acceptance)"
  [ "$MODE" = execute ] && rm -f "$STATE_DIR/S6R.installed"
  unmark S6
}
rb_S5() {
  later_done S6 S7 S8 S9 && stop_now "roll back S6 first"
  safe_rm "$APP_SRC" "$BUILD_HOME"
  unmark S5
}
rb_S4() {
  later_done S5 S6 S7 S8 S9 && stop_now "roll back S5 first"
  spsql_ok || stop_now "the staging cluster is not running"
  assert_staging_cluster
  if [ "$MODE" = plan ]; then plan "psql (peer, staging cluster): drop database $DB; drop roles $OWNER_ROLE $APP_ROLE $BACKUP_ROLE"
  else printf 'drop database if exists %s with (force);\ndrop role if exists %s;\ndrop role if exists %s;\ndrop role if exists %s;\n' "$DB" "$APP_ROLE" "$BACKUP_ROLE" "$OWNER_ROLE" | spsql postgres; fi
  safe_rm "$ETC_DIR"
  unmark S4
}
rb_S3() {
  later_done S4 S5 S6 S7 S8 S9 && stop_now "roll back S4 first"
  sctl stop postgresql@16-po07ns.service
  if [ "$MODE" = plan ]; then plan "pg_dropcluster $PG_VER $CLUSTER (only if owned by $PG_USER and created by the kit)"
  elif pg_lsclusters -h | awk -v v="$PG_VER" -v c="$CLUSTER" '$1==v && $2==c' | grep -q .; then
    [ -f "$STATE_DIR/S3.created" ] || stop_now "the cluster was not created by this kit"
    [ "$(stat -c %U "/var/lib/postgresql/$PG_VER/$CLUSTER")" = "$PG_USER" ] || stop_now "the cluster's data is not owned by $PG_USER"
    act pg_dropcluster "$PG_VER" "$CLUSTER"
  fi
  # pg_dropcluster leaves the files the kit added to the cluster's config directory (its conf.d file and the kept
  # original pg_hba), so the directory survives it: removed here, only when the kit created the cluster (S3 marker).
  if [ "$MODE" = execute ] && [ -d "/etc/postgresql/$PG_VER/$CLUSTER" ]; then
    [ -f "$STATE_DIR/S3.created" ] || stop_now "/etc/postgresql/$PG_VER/$CLUSTER exists but the cluster was not created by this kit"
    pg_lsclusters -h | awk -v v="$PG_VER" -v c="$CLUSTER" '$1==v && $2==c' | grep -q . && stop_now "the cluster still exists after pg_dropcluster"
  fi
  safe_rm "/etc/postgresql/$PG_VER/$CLUSTER"
  rm_kit_file "/etc/systemd/system/postgresql@16-po07ns.service.d/10-staging.conf" "$U/postgresql@16-po07ns.10-staging.conf"
  safe_rm "/etc/systemd/system/postgresql@16-po07ns.service.d"
  sctl daemon-reload
  [ "$MODE" = execute ] && rm -f "$STATE_DIR/S3.created"
  unmark S3
}
rb_S2() {
  later_done S3 S4 S5 S6 S7 S8 S9 && stop_now "roll back S3 first"
  sctl disable --now elite-po-staging-netns.service
  sctl stop elite-po-staging.slice   # a slice stays active after its file is removed unless it is stopped
  rm_kit_file /etc/systemd/system/elite-po-staging-netns.service "$U/elite-po-staging-netns.service"
  rm_kit_file /etc/systemd/system/elite-po-staging.slice "$U/elite-po-staging.slice"
  rm_kit_file /etc/tmpfiles.d/elite-po-staging.conf "$U/elite-po-staging.tmpfiles.conf"
  rm_kit_file /usr/local/sbin/elite-po-run "$U/elite-po-run"
  safe_rm "$PG_RUN"
  sctl daemon-reload
  unmark S2
}
rb_S1() {
  later_done S2 S3 S4 S5 S6 S7 S8 S9 && stop_now "roll back S2 first"
  safe_rm "$APP_DIR"
  local u
  for u in "$APP_USER" "$PG_USER"; do
    if [ "$MODE" = plan ]; then plan "userdel $u (only if the kit's S1 marker exists; no process may run as $u)"; continue; fi
    getent passwd "$u" >/dev/null || { say "absent: user $u"; continue; }
    [ -f "$STATE_DIR/S1.created.$u" ] || stop_now "user $u was not created by this kit"
    pgrep -u "$u" >/dev/null && stop_now "processes still run as $u"
    act userdel "$u"
    getent group "$u" >/dev/null && act groupdel "$u"
    rm -f "$STATE_DIR/S1.created.$u"
  done
  unmark S1
}
if [ "$TARGET" = all ]; then for s in S9 S8 S7 S6 S5 S4 S3 S2 S1; do
  # S8's rollback re-opens S4; "all" goes on to drop everything anyway.
  "rb_$s"; done
else "rb_$TARGET"; fi
# Final check (§J step 8): the shared services still equal the S0 baseline.
guard_shared
say "rollback $TARGET finished"
