#!/usr/bin/env bash
# PO-07 D2: the controlled restart of the staging PostgreSQL cluster unit ONLY, so that a reconciled (or restored)
# 20-tasks.conf takes effect. The two staging app units restart with it (they Require= the cluster); nothing else is
# touched: never the cluster main, never postgresql.service, never another application's unit.
#   tools/pg-restart.sh --plan | --execute      (--execute: PGRESTART must be in this window's owner authorization)
# Checks: the capacity check passes; afterwards both apps answer, the configured TasksMax is the one the cgroup enforces
# (pids.max), the staging cluster answers, and the cluster main's postmaster PID is unchanged. Repeatable; no marker.
STAGE=PGRESTART; . "$(dirname "$0")/../lib.sh" "${1:---plan}"
PGU="postgresql@$PG_VER-$CLUSTER.service"
stage_begin S9
if [ "$MODE" = plan ]; then
  plan "pg-capacity.sh; record the cluster main's postmaster PID; reset-failed + restart $PGU only (elite-po-admin/customer follow by Requires=); wait for both apps; TasksMax configured = pids.max in effect; main unchanged; §I guard"
  exit 0
fi
guard_shared
bash "$KIT_HERE/tools/pg-capacity.sh" || stop_now "the capacity check refuses: the configured capacity exceeds the cap"
mainpid() { head -1 /var/lib/postgresql/16/main/postmaster.pid 2> /dev/null || echo none; }
main0="$(mainpid)"
http() { # SOCK HOST PATH → status (as nginx would send it)
  node -e 'const [s,h,p]=process.argv.slice(1);require("http").get({socketPath:s,path:p,headers:{host:h,"x-forwarded-host":h,"x-forwarded-proto":"https"}},r=>{console.log(r.statusCode);r.resume()}).on("error",()=>console.log(0)).setTimeout(20000,function(){this.destroy()})' "$1" "$2" "$3"; }
cfg="$(systemctl show -p TasksMax --value "$PGU")"
# a deliberate, owner-authorized restart: clear the units' start-rate counters first (StartLimitBurst protects against
# crash loops of automatic restarts, not against an operator's single restart)
sctl reset-failed "$PGU" elite-po-admin.service elite-po-customer.service
t0="$(date +%s)"
sctl restart "$PGU"
up=0; for i in $(seq 1 60); do
  if [ "$(http "$RUN_DIR/customer.sock" "$CUST_HOST" /login)" = 200 ] && [[ "$(http "$RUN_DIR/admin.sock" "$ADMIN_HOST" /platform/login)" =~ ^(200|404)$ ]]; then up=1; break; fi
  sleep 2
done
[ "$up" = 1 ] || stop_now "the staging apps did not answer within 120 s after the cluster restart (systemctl status elite-po-admin elite-po-customer $PGU)"
secs=$(( $(date +%s) - t0 ))
[ "$(printf 'select 1;\n' | spsql postgres)" = 1 ] || stop_now "the staging cluster does not answer"
eff="$(cat "/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$PGU")/pids.max")"
[ "$eff" = "$cfg" ] || { [ "$cfg" = infinity ] && [ "$eff" = max ]; } || stop_now "TasksMax $cfg is configured but pids.max $eff is in effect"
[ "$(mainpid)" = "$main0" ] || stop_now "the cluster main's postmaster PID changed ($main0 → $(mainpid)): investigate at once"
printf '%s %s restarted; apps answered after %ss; TasksMax %s in effect; main pid %s unchanged (kit %s)\n' \
  "$(date -u +%FT%TZ)" "$PGU" "$secs" "$cfg" "$main0" "$KIT_VERSION" >> "$STATE_DIR/PGRESTART.log"
guard_shared
say "PGRESTART ok: $PGU restarted; both staging apps answered after ${secs}s; TasksMax $cfg in effect (pids.max $eff); the cluster main is unchanged (postmaster $main0). Next: the S8/S9 checks and the R-tests"
