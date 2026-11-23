#!/usr/bin/env bash
# S2 — slice, private network namespace, tmpfiles entry, elite-po-run (plan §A-2/§A-7, §N S2).
# Stop: the host's links, routes or ufw rules differ from S0; the namespace holds anything but lo.
STAGE=S2; . "$(dirname "$0")/lib.sh"
stage_begin S1
guard_shared
start_thresholds
U="$KIT_HERE/units"
host_net_unchanged() {
  [ "$(ip -o link | sed -E 's/ (link\/ether|brd) [0-9a-f:]+//g' | sha256sum | cut -c1-16)" = "$B_LINKS" ] &&
    [ "$(ip route | sha256sum | cut -c1-16)" = "$B_ROUTES4" ] &&
    [ "$(ip -6 route | sha256sum | cut -c1-16)" = "$B_ROUTES6" ] &&
    [ "$(ufw status verbose 2>/dev/null | sha256sum | cut -c1-16)" = "$B_UFW" ]
}
ns_only_lo() {
  [ "$(ip netns exec "$NS" ip -o link | awk -F': ' '{print $2}' | tr '\n' ' ')" = "lo " ] &&
    ip netns exec "$NS" ip -o link show lo | grep -q 'UP'
}
ns_no_route() { [ -z "$(ip netns exec "$NS" ip route)" ] && [ -z "$(ip netns exec "$NS" ip -6 route | grep -v '^::1 ' || true)" ]; }
ns_no_listener() { [ -z "$(ip netns exec "$NS" ss -lntuH)" ]; }
pgrun_ok() { [ "$(stat -c '%a %U:%G' "$PG_RUN")" = "700 $PG_USER:$PG_USER" ]; }
netns_active() { [ "$(systemctl is-active elite-po-staging-netns.service)" = active ]; }
slice_ok() { [ "$(systemctl show -p MemoryMax --value elite-po-staging.slice)" = 1879048192 ]; }

check "host links, routes and ufw rules equal S0 (before)" host_net_unchanged
if [ "$MODE" = execute ] && [ -e "/run/netns/$NS" ] && ! netns_active; then
  stop_now "/run/netns/$NS exists but the kit's netns unit is not active (unknown origin)"
fi
put_file /etc/systemd/system/elite-po-staging.slice 0644 root:root "$U/elite-po-staging.slice"
put_file /etc/systemd/system/elite-po-staging-netns.service 0644 root:root "$U/elite-po-staging-netns.service"
put_file /etc/tmpfiles.d/elite-po-staging.conf 0644 root:root "$U/elite-po-staging.tmpfiles.conf"
put_file /usr/local/sbin/elite-po-run 0700 root:root "$U/elite-po-run"
act systemd-analyze verify /etc/systemd/system/elite-po-staging.slice /etc/systemd/system/elite-po-staging-netns.service
sctl daemon-reload
act systemd-tmpfiles --create /etc/tmpfiles.d/elite-po-staging.conf
check "$PG_RUN is 0700 $PG_USER:$PG_USER" pgrun_ok
sctl enable --now elite-po-staging-netns.service
check "the netns unit is active" netns_active
check "inside $NS: exactly one link, lo, up" ns_only_lo
check "inside $NS: no IPv4 or IPv6 route" ns_no_route
check "inside $NS: no listener" ns_no_listener
check "host links, routes and ufw rules equal S0 (after)" host_net_unchanged
check "the slice is loaded with MemoryMax 1792M" slice_ok
guard_shared
mark_done
