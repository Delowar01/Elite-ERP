#!/usr/bin/env bash
# S3 — the separate PostgreSQL 16 test cluster (plan §B.3, §N S3). Never the umbrella postgresql.service, never
# pg_ctlcluster directly, never cluster main. Stop: main's PID or checksums change; a new host listener; start failure.
STAGE=S3; . "$(dirname "$0")/lib.sh"
stage_begin S2
guard_shared
start_thresholds
U="$KIT_HERE/units"
CONF="/etc/postgresql/$PG_VER/$CLUSTER"; DATA="/var/lib/postgresql/$PG_VER/$CLUSTER"
DROPIN_DIR="/etc/systemd/system/postgresql@16-po07ns.service.d"
cluster_row() { pg_lsclusters -h | awk -v v="$PG_VER" -v c="$CLUSTER" '$1==v && $2==c {print $3, $4, $5}'; }

if [ "$MODE" = execute ]; then
  if [ -n "$(cluster_row)" ]; then
    [ -f "$STATE_DIR/S3.created" ] || stop_now "cluster $PG_VER/$CLUSTER exists and was not created by this kit"
    [ "$(stat -c %U "$DATA")" = "$PG_USER" ] || stop_now "$DATA is not owned by $PG_USER"
    say "cluster exists (kit)"
  else
    { [ ! -e "$CONF" ] && [ ! -e "$DATA" ]; } || stop_now "$CONF or $DATA exists without a cluster"
    if grep -qx -- "$PG_PORT" <<< "$(pg_lsclusters -h | awk '{print $3}')"; then stop_now "port $PG_PORT is configured for another cluster"; fi
  fi
fi
if [ "$MODE" = plan ] || [ ! -f "$STATE_DIR/S3.created" ]; then
  # NO --start: the cluster is only ever started by systemctl, through the drop-in (inside the namespace).
  act pg_createcluster "$PG_VER" "$CLUSTER" -u "$PG_USER" -g "$PG_USER" -p "$PG_PORT" -s "$PG_RUN" --locale C.UTF-8 \
    -- --auth-local=peer --auth-host=scram-sha-256
  if [ "$MODE" = execute ]; then date -u +%FT%TZ > "$STATE_DIR/S3.created"; fi
fi
cluster_down_ours() { [ "$(cluster_row)" = "$PG_PORT down $PG_USER" ] || [ "$(cluster_row)" = "$PG_PORT online $PG_USER" ]; }
check "the new cluster exists, owned by $PG_USER, port $PG_PORT" cluster_down_ours
put_file "$CONF/conf.d/10-staging.conf" 0644 "$PG_USER:$PG_USER" "$U/pg-10-staging.conf"
# pg_hba.conf of THIS cluster: replaced by the kit's two rules. pg_createcluster's default is kept as .kit-orig.
if [ "$MODE" = plan ]; then
  plan "mv $CONF/pg_hba.conf $CONF/pg_hba.conf.kit-orig; install -m 0640 -o $PG_USER kit pg_hba.conf -> $CONF/pg_hba.conf"
elif ! cmp -s "$U/pg_hba.conf" "$CONF/pg_hba.conf"; then
  [ ! -e "$CONF/pg_hba.conf.kit-orig" ] || stop_now "$CONF/pg_hba.conf differs from the kit's and a .kit-orig already exists"
  act mv "$CONF/pg_hba.conf" "$CONF/pg_hba.conf.kit-orig"
  act install -m 0640 -o "$PG_USER" -g "$PG_USER" "$U/pg_hba.conf" "$CONF/pg_hba.conf"
fi
mkdir_staging "$DROPIN_DIR" 0755 root:root
put_file "$DROPIN_DIR/10-staging.conf" 0644 root:root "$U/postgresql@16-po07ns.10-staging.conf"
# PROPOSED 24 Nov 2026 (owner review): the cluster's own task cap (units/pg-tasks.conf). A fresh install (the CI
# rehearsal) gets it here; where S3 is already complete (the VPS) put_file refuses, and only an owner-authorized
# tools/reconcile.sh installs it.
put_file "$DROPIN_DIR/20-tasks.conf" 0644 root:root "$U/pg-tasks.conf"
sctl daemon-reload
dropin_ok() {
  local s; s="$(systemctl show -p NetworkNamespacePath,Slice,PIDFile,MemoryMax,TasksMax postgresql@16-po07ns.service | sort | tr '\n' ' ')"
  [ "$s" = "MemoryMax=402653184 NetworkNamespacePath=/run/netns/$NS PIDFile=$PG_RUN/16-$CLUSTER.pid Slice=elite-po-staging.slice TasksMax=64 " ] || { say "drop-in view: $s"; return 1; }
}
check "the drop-ins are in effect (namespace, slice, PID file, 384M, 64 tasks)" dropin_ok
sctl start postgresql@16-po07ns.service
pg_active() { sleep 3; [ "$(systemctl is-active postgresql@16-po07ns.service)" = active ] && [ "$(cluster_row)" = "$PG_PORT online $PG_USER" ]; }
check "postgresql@16-po07ns is active and pg_lsclusters shows it online" pg_active
pg_in_ns() { local pid; pid="$(head -1 "$PG_RUN/16-$CLUSTER.pid")"; [ "$(readlink "/proc/$pid/ns/net")" = "net:[$(stat -L -c %i "/run/netns/$NS")]" ]; }
check "the postmaster runs inside $NS" pg_in_ns
ns_pg_only() { [ "$(ip netns exec "$NS" ss -ltnH | awk '{print $4}' | sort -u | tr '\n' ' ')" = "127.0.0.1:$PG_PORT " ]; }
check "inside $NS: PostgreSQL listens on 127.0.0.1:$PG_PORT and nothing else" ns_pg_only
assert_staging_cluster
expect_settings() {
  local got want="127.0.0.1|off|$PG_PORT|$PG_RUN|$PG_RUN/16-$CLUSTER.pid|64MB|30|scram-sha-256"
  got="$(printf "select concat_ws('|', current_setting('listen_addresses'), current_setting('ssl'), current_setting('port'), current_setting('unix_socket_directories'), current_setting('external_pid_file'), current_setting('shared_buffers'), current_setting('max_connections'), current_setting('password_encryption'));\n" | spsql postgres)"
  [ "$got" = "$want" ] || { say "settings: $got"; return 1; }
}
check "cluster settings: loopback, ssl off, port, own socket and pid dir, 64MB, 30 connections, scram" expect_settings
hba_ok() { [ "$(printf 'select count(*) from pg_hba_file_rules where error is null;\n' | spsql postgres)" = 2 ]; }
check "pg_hba in effect: exactly the kit's 2 rules" hba_ok
no_host_5433() { ! grep -qE ":$PG_PORT\$" <<< "$(ss -ltnH | awk '{print $4}')"; }
check "the host has no new TCP listener ($PG_PORT exists only inside $NS)" no_host_5433
guard_shared
mark_done
