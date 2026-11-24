#!/usr/bin/env bash
# PO-07 D2: the staging cluster's actual process capacity against the task cap — READ-ONLY, on the VPS as root, before
# the cap is applied (reconcile) and after. Never touches cluster main.
#   pg-capacity.sh            prints the settings, the configured capacity, the live task count and the verdict
# Capacity = postmaster 1 + auxiliary 5 + max_connections + autovacuum_max_workers + max_worker_processes + 3 start/stop
# helpers. Walsenders need a replication rule in pg_hba (there is none), so they never get past authentication.
set -uo pipefail
export LC_ALL=C
K="$(cd "$(dirname "$0")/.." && pwd)"
. "$K/config.sh"
CAP="$(sed -n 's/^TasksMax=//p' "$K/units/pg-tasks.conf")"
q() { runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" -d postgres -c "$1"; }
[ "$(q "select current_setting('cluster_name')")" = "$PG_VER/$CLUSTER" ] || { echo "FAIL  not the staging cluster"; exit 3; }
for s in max_connections superuser_reserved_connections reserved_connections autovacuum_max_workers max_worker_processes max_parallel_workers max_parallel_workers_per_gather max_wal_senders; do
  printf '%-36s %s\n' "$s" "$(q "show $s" 2> /dev/null || echo n/a)"; done
mc="$(q 'show max_connections')"; av="$(q 'show autovacuum_max_workers')"; wp="$(q 'show max_worker_processes')"
need=$(( 1 + 5 + mc + av + wp + 3 ))
cg="/sys/fs/cgroup$(systemctl show -p ControlGroup --value "postgresql@16-$CLUSTER.service")"
echo "backends now: $(q "select count(*) from pg_stat_activity where backend_type = 'client backend'")  |  cluster tasks now: $(cat "$cg/pids.current" 2> /dev/null || echo ?), peak $(cat "$cg/pids.peak" 2> /dev/null || echo ?), max $(cat "$cg/pids.max" 2> /dev/null || echo ?)"
echo "configured capacity: 1 + 5 + $mc + $av + $wp + 3 = $need tasks; proposed cap $CAP (slice $(sed -n 's/^TasksMax=//p' "$K/units/elite-po-staging.slice"))"
if [ "$need" -le "$CAP" ]; then echo "OK    the cap covers the configured capacity ($need ≤ $CAP): PostgreSQL's own limits bind first"; exit 0
else echo "FAIL  the configuration needs $need tasks, more than the cap $CAP: do not apply it"; exit 3; fi
