#!/usr/bin/env bash
# S9 — both app units and both proxy sockets; V-NET and V-SBX inside each unit; R2–R9 against the sockets; no host TCP
# path to the apps; a non-nginx user gets EACCES; footprint sampling starts (plan §B.1, §C, §F, §N S9).
# Stop: a unit fails; any new host TCP listener; a socket mode other than 0660 root:<NGINX_GROUP>; any R-test fails;
# the budget is exceeded.
STAGE=S9; . "$(dirname "$0")/lib.sh"
stage_begin S8
guard_shared
start_thresholds
U="$KIT_HERE/units"
APPS=(elite-po-admin.service elite-po-customer.service)
SOCKS=(elite-po-admin-proxy.socket elite-po-customer-proxy.socket)

# ---- 0. the S7 binding check again, before any unit starts ----
bind_again() {
  local f
  for f in "$ETC_DIR/admin.env" "$ETC_DIR/customer.env"; do
    grep -qx "PLATFORM_CONSOLE_HOST=$ADMIN_HOST" "$f" && grep -qx "CUSTOMER_APP_HOST=$CUST_HOST" "$f" && grep -qx 'PLATFORM_TRUSTED_PROXY_HOPS=1' "$f" || return 1
  done
  ! grep -qE '^PLATFORM_[A-Z_]*_ENABLED=' "$ETC_DIR/customer.env" "$ETC_DIR/admin.env"
}
check "both env files carry the H-1 binding; no console switch is on (F1 is S13)" bind_again

# ---- 1. storage and unit files ----
mkdir_staging "$VAR_DIR" 0750 "root:$APP_USER"
mkdir_staging "$STORAGE_DIR" 0700 "$APP_USER:$APP_USER"
for f in elite-po-admin.service elite-po-customer.service elite-po-admin-proxy.socket elite-po-admin-proxy.service elite-po-customer-proxy.socket elite-po-customer-proxy.service; do
  put_file "/etc/systemd/system/$f" 0644 root:root "$U/$f"
done
act systemd-analyze verify /etc/systemd/system/elite-po-admin.service /etc/systemd/system/elite-po-customer.service /etc/systemd/system/elite-po-admin-proxy.socket /etc/systemd/system/elite-po-customer-proxy.socket
sctl daemon-reload

# ---- 2. the apps (inside the namespace) ----
sctl enable --now "${APPS[@]}"
apps_listening() {
  local i
  for i in $(seq 1 30); do
    [ "$(ip netns exec "$NS" ss -ltnH | awk '{print $4}' | sort -u | tr '\n' ' ')" = "127.0.0.1:$CUST_IN 127.0.0.1:$ADMIN_IN 127.0.0.1:$PG_PORT " ] && return 0
    sleep 2
  done
  ip netns exec "$NS" ss -ltnH; return 1
}
check "inside $NS: exactly PostgreSQL, admin and customer listen, on 127.0.0.1" apps_listening
in_ns_as_app() {
  local u pid
  for u in "${APPS[@]}"; do
    pid="$(systemctl show -p MainPID --value "$u")"
    [ "$pid" -gt 0 ] && [ "$(readlink "/proc/$pid/ns/net")" = "net:[$(stat -L -c %i "/run/netns/$NS")]" ] && [ "$(stat -c %U "/proc/$pid")" = "$APP_USER" ] || { say "$u: pid $pid not in $NS as $APP_USER"; return 1; }
  done
}
check "both app processes run inside $NS as $APP_USER" in_ns_as_app
props_ok() { # the running units' effective sandbox equals the reviewed unit files
  local u want got bad=0
  for u in "${APPS[@]}"; do
    for want in User=po07app NetworkNamespacePath=/run/netns/po07ns Slice=elite-po-staging.slice ProtectSystem=strict ProtectHome=yes PrivateTmp=yes PrivateDevices=yes NoNewPrivileges=yes ProtectProc=invisible ProcSubset=pid CapabilityBoundingSet= AmbientCapabilities= RestrictSUIDSGID=yes LockPersonality=yes; do
      got="$(systemctl show -p "${want%%=*}" "$u")"
      [ "$got" = "$want" ] || { say "$u: $got (want $want)"; bad=1; }
    done
  done
  [ "$(systemctl show -p MemoryMax --value elite-po-admin.service)" = 536870912 ] && [ "$(systemctl show -p MemoryMax --value elite-po-customer.service)" = 939524096 ] || bad=1
  # decision J1: no writable path in the code tree for either process; the customer binds ONLY the storage directory
  # (systemctl prints a bind as "source:destination:options"; only the sources are compared, as a sorted set)
  srcs() { systemctl show -p "$1" --value "$2" | tr ' ' '\n' | sed '/^$/d' | cut -d: -f1 | LC_ALL=C sort -u | tr '\n' ' '; }
  for u in "${APPS[@]}"; do [ -z "$(srcs ReadWritePaths "$u")" ] || { say "$u: ReadWritePaths=$(srcs ReadWritePaths "$u")"; bad=1; }; done
  local want_ro; want_ro="$(printf '%s\n' "$APP_SRC" /opt/google | LC_ALL=C sort -u | tr '\n' ' ')"
  for u in "${APPS[@]}"; do [ "$(srcs BindReadOnlyPaths "$u")" = "$want_ro" ] || { say "$u: BindReadOnlyPaths=$(srcs BindReadOnlyPaths "$u")"; bad=1; }; done
  [ -z "$(srcs BindPaths elite-po-admin.service)" ] || { say "admin: BindPaths=$(srcs BindPaths elite-po-admin.service)"; bad=1; }
  [ "$(srcs BindPaths elite-po-customer.service)" = "$STORAGE_DIR " ] || { say "customer: BindPaths=$(srcs BindPaths elite-po-customer.service)"; bad=1; }
  [ "$bad" -eq 0 ]
}
check "the running units' properties equal the reviewed unit files (systemctl show; no writable code path, J1)" props_ok

# ---- 3. the proxy sockets (host namespace, nginx group only) ----
# The socket directory is created by the kit, so its group is <NGINX_GROUP> whatever that group is (systemd would create
# it root:root; on this VPS <NGINX_GROUP> is root, so the result is the same). DirectoryMode applies only if it is missing.
mkdir_staging "$RUN_DIR" 0750 "root:$NGINX_GROUP"
sctl enable --now "${SOCKS[@]}"
socks_ok() {
  local s
  [ "$(stat -c '%a %U:%G' "$RUN_DIR")" = "750 root:$NGINX_GROUP" ] || { say "$RUN_DIR: $(stat -c '%a %U:%G' "$RUN_DIR")"; return 1; }
  for s in admin customer; do
    [ -S "$RUN_DIR/$s.sock" ] && [ "$(stat -c '%a %U:%G' "$RUN_DIR/$s.sock")" = "660 root:$NGINX_GROUP" ] || { say "$s.sock: $(stat -c '%a %U:%G' "$RUN_DIR/$s.sock" 2>&1)"; return 1; }
  done
}
check "both sockets exist, 0660 root:$NGINX_GROUP, in a 0750 directory" socks_ok
eacces_ok() {
  local u s r
  for u in nobody "$APP_USER"; do
    for s in admin customer; do
      r="$(runuser -u "$u" -- node -e 'const s=require("net").connect(process.argv[1]);s.on("connect",()=>{console.log("CONNECTED");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)})' "$RUN_DIR/$s.sock")"
      [ "$r" = EACCES ] || { say "$u → $s.sock: $r"; return 1; }
    done
  done
}
check "a non-nginx user (nobody, $APP_USER) gets EACCES on both sockets" eacces_ok
no_host_tcp() {
  ! ss -ltnH | awk '{print $4}' | grep -qE ":($ADMIN_IN|$CUST_IN|$PG_PORT)\$" &&
    [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$ADMIN_IN/" || true)" = 000 ] &&
    [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$CUST_IN/" || true)" = 000 ]
}
check "no host TCP path to the apps (no listener; connections refused)" no_host_tcp

# ---- 4. V-NET and V-SBX inside each unit's exact profile ----
run_probe admin admin "$PG_PORT $ADMIN_IN $CUST_IN"
run_probe customer customer "$PG_PORT $ADMIN_IN $CUST_IN"

# ---- 5. R2–R9 through the sockets ----
if [ "$MODE" = plan ]; then plan "node probes/s9-rtests.mjs (R2–R9 + controls, via curl-equivalent requests on the two Unix sockets)"
else
  cfg="$STATE_DIR/s9-rtests.json"
  printf '{"adminHost":"%s","custHost":"%s","adminSock":"%s","custSock":"%s","appDir":"%s","r9Register":true,"psql":["runuser","-u","%s","--","psql","-X","-At","-h","%s","-p","%s","-d","%s"]}\n' \
    "$ADMIN_HOST" "$CUST_HOST" "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock" "$APP_SRC" "$PG_USER" "$PG_RUN" "$PG_PORT" "$DB" > "$cfg"
  rc=0; node "$KIT_HERE/probes/s9-rtests.mjs" "$cfg" > "$STATE_DIR/logs/S9-rtests.txt" 2>&1 || rc=$?
  cat "$STATE_DIR/logs/S9-rtests.txt"
  [ "$rc" -eq 0 ] || stop_now "R-tests failed"
fi

# ---- 5b. the build is unchanged after real requests, and nothing tried to write it (decision J1) ----
build_intact() {
  (cd "$APP_SRC" && sha256sum --quiet --strict -c "$STATE_DIR/artifact/MANIFEST.sha256") || return 1
  [ "$(cd "$APP_SRC" && find .next node_modules -type f | wc -l)" -eq "$(wc -l < "$STATE_DIR/artifact/MANIFEST.sha256")" ] || return 1
  [ -z "$(ls -A "$APP_SRC/.next/cache")" ] && [ ! -e "$APP_SRC/.next/server/route-cache" ]
}
check "after the R-tests every build file is unchanged, none was added, .next/cache is empty and no route cache exists" build_intact
no_write_errors() { ! journalctl -u elite-po-admin.service -u elite-po-customer.service --since "-30min" --no-pager -o cat 2>/dev/null |
  grep -qiE 'EROFS|EACCES|Failed to (update prerender cache|write image to cache)|uncaught|unhandled ?rejection'; }
check "neither app logged a write attempt, a permission error or an unhandled error" no_write_errors

# ---- 6. stability and footprint (sampling continues with tools/footprint.sh until S9b and after) ----
stable() { sleep 60; local u; for u in "${APPS[@]}"; do [ "$(systemctl is-active "$u")" = active ] && [ "$(systemctl show -p NRestarts --value "$u")" = 0 ] || return 1; done; }
check "both apps still active with no restart after 60 s" stable
if [ "$MODE" = execute ]; then bash "$KIT_HERE/tools/footprint.sh" | tee -a "$STATE_DIR/logs/S9-footprint.txt"; fi
budget_ok() { local m; m="$(systemctl show -p MemoryCurrent --value elite-po-staging.slice)"; [ "$m" -le $((600 * 1048576)) ] || { say "slice MemoryCurrent $((m / 1048576))MB > 600MB"; return 1; }; }
check "the slice is within the 600 MB steady budget" budget_ok
guard_shared
mark_done
