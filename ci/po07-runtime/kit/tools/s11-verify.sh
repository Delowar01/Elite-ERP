#!/usr/bin/env bash
# PO-07 S11: read-only verification ON THE VPS (as root), with no credentials. Changes nothing outside the kit state
# (--tls writes its own result record, S11.tls-ok, on a full pass).
#   s11-verify.sh --pre                the S11a pre-step: nginx -t, master PID, worker identity, every nginx file checksum
#   s11-verify.sh --phase A|B          the unauthenticated probe through nginx (Phase A: CloudPanel's self-signed
#                                      certificate, so TLS is not verified AND no credential is ever sent)
#   s11-verify.sh --tls                the trusted certificates (S11b): chain verified by the system store, the host name,
#                                      days left, the renewal job; inherited HSTS of the parent names
#   s11-verify.sh --realip             R10 at the nginx layer only (also part of --phase): no inherited real-IP trust
# --pre and --phase also check: the sockets 0660 root:<NGINX_GROUP> in their 0750 directory, other users refused, no
# permission error in the nginx logs.
set -uo pipefail
export LC_ALL=C
K="$(cd "$(dirname "$0")/.." && pwd)"
. "$K/config.sh"
OUT="$STATE_DIR/logs"; mkdir -p "$OUT"; ts="$(date -u +%Y%m%dT%H%M%SZ)"
f=0; fps=(); ok() { echo "OK    $1"; }; no() { echo "FAIL  $1"; f=$((f + 1)); }
master() { systemctl show -p MainPID --value nginx.service; }
can_open() { runuser -u "$1" -- node -e 'require("net").connect(process.argv[1]).on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' "$2" 2> /dev/null; }
sockets() {
  local s u w
  for s in "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock"; do
    if [ "$(stat -c '%a %U:%G' "$s")" = "660 root:$NGINX_GROUP" ]; then ok "$s is 0660 root:$NGINX_GROUP"; else no "$s is $(stat -c '%a %U:%G' "$s")"; fi
    for u in nobody "$APP_USER"; do if can_open "$u" "$s"; then no "$u can open $s"; else ok "$u cannot open $s"; fi; done
  done
  if [ "$(stat -c '%a %U:%G' "$RUN_DIR")" = "750 root:$NGINX_GROUP" ]; then ok "$RUN_DIR is 0750 root:$NGINX_GROUP"; else no "$RUN_DIR is $(stat -c '%a %U:%G' "$RUN_DIR")"; fi
  # root can open any socket whatever its mode: the mode protects against every NON-root identity only
  w="$(ps -o user=,group= --ppid "$(master)" | sort -u | tr -s ' ' | tr '\n' ';')"
  echo "INFO  site nginx worker identity: $w (recorded at S0; never changed by the kit)"
  # captured first: the error logs can be large, and a pipe into grep -q under pipefail can hide a match
  local el; el="$(grep -hs "unix:$RUN_DIR" /var/log/nginx/error.log /home/*/logs/nginx/error.log 2> /dev/null || true)"
  if grep -q "Permission denied" <<< "$el"; then no "nginx logged a permission error on a staging socket"
  else ok "no permission error on a staging socket in the nginx logs"; fi
}
# R10 at the nginx layer, without any credential: whatever real-IP trust the shared http-level configuration inherits,
# each staging server block carries exactly one "set_real_ip_from unix:;" (it replaces the inherited list), and an
# unauthenticated GET /robots.txt sent with a forged X-Real-IP and X-Forwarded-For (TEST-NET-1 addresses) is logged at
# the real connecting address. Only robots.txt (Basic Auth off) and only this request's own log line are used; TLS is not
# verified for this one request because nothing secret is sent (Phase A still has CloudPanel's self-signed certificate).
# S11_CONNECT: the address to connect to (default: the VPS address; the CI rehearsal uses its loopback).
realip() {
  local h v al m got conn="${S11_CONNECT:-$VPS_IPV4}"
  for h in "$ADMIN_HOST" "$CUST_HOST"; do
    v="$(grep -lsF -- "server_name $h;" /etc/nginx/sites-enabled/* | head -1)"
    [ -n "$v" ] || { no "$h: no vhost found for the real-IP check"; continue; }
    if [ "$(grep -cE '^[[:space:]]*set_real_ip_from[[:space:]]+unix:[[:space:]]*;' "$v")" -eq 1 ] && [ "$(grep -cE '^[[:space:]]*set_real_ip_from[[:space:]]' "$v")" -eq 1 ]; then
      ok "$h: the server block trusts no real-IP proxy (exactly one set_real_ip_from unix:;)"
    else no "$h: the server block must carry exactly one 'set_real_ip_from unix:;' and no other set_real_ip_from"; fi
    al="$(sed -nE 's/^[[:space:]]*access_log[[:space:]]+([^;[:space:]]+).*$/\1/p' "$v" | head -1)"
    [ -n "$al" ] && [ "$al" != off ] || al=/var/log/nginx/access.log
    m="po07-realip-$ts-$RANDOM"
    curl -sk -o /dev/null -m 10 --resolve "$h:443:$conn" -H 'X-Real-IP: 192.0.2.71' -H 'X-Forwarded-For: 192.0.2.72' "https://$h/robots.txt?$m" || true
    sleep 1
    got="$(grep -sF -- "$m" "$al" | awk '{print $1}' | tail -1)"
    if [ "$got" = "$conn" ]; then ok "$h: a forged X-Real-IP / X-Forwarded-For is ignored; nginx logged the real address"
    elif [ -z "$got" ]; then no "$h: the real-IP test request was not found in $al"
    else no "$h: nginx took the client address from a client header (logged $got, connected as $conn)"; fi
  done
}
case "${1:-}" in
  --pre)
    if nginx -t > /dev/null 2>&1; then ok "nginx -t"; else no "nginx -t fails BEFORE any change: stop"; fi
    { echo "master=$(master)"; echo "workers=$(ps -o user=,group= --ppid "$(master)" | sort -u | tr -s ' ' | tr '\n' ';')"
      find /etc/nginx -type f -print0 | sort -z | xargs -0 sha256sum; } > "$OUT/S11-pre-$ts.txt"
    ok "pre-change evidence: $OUT/S11-pre-$ts.txt ($(grep -c '^[0-9a-f]\{64\} ' "$OUT/S11-pre-$ts.txt") nginx files, master $(master))"
    for h in "$ADMIN_HOST" "$CUST_HOST"; do
      if grep -lqs "server_name[^;]*$h" /etc/nginx/sites-enabled/*; then no "a vhost for $h already exists"; else ok "no vhost for $h yet"; fi
    done
    sockets ;;
  --phase)
    ph="${2:?A|B}"; cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
    ins=false; hsts=false; [ "$ph" = A ] && ins=true; [ "$ph" = B ] && hsts=true
    printf '{"phase":"%s","adminHost":"%s","custHost":"%s","connect":"%s","httpsPort":443,"httpPort":80,"caFile":null,"tlsInsecure":%s,"appDir":"%s","psql":["runuser","-u","%s","--","psql","-X","-q","-At","-h","%s","-p","%s","-d","%s"],"expectClientIp":null,"credFd":null,"expectHsts":%s,"f1":false,"echoHost":null}\n' \
      "$ph" "$ADMIN_HOST" "$CUST_HOST" "$VPS_IPV4" "$ins" "$APP_SRC" "$PG_USER" "$PG_RUN" "$PG_PORT" "$DB" "$hsts" > "$cfg"
    node "$K/probes/s11-nginx-probe.mjs" "$cfg" > "$OUT/S11-phase$ph-$ts.txt" 2>&1
    grep -E '^(FAIL|S11-PROBE)' "$OUT/S11-phase$ph-$ts.txt"
    if grep -q 'fail=0' "$OUT/S11-phase$ph-$ts.txt"; then ok "the Phase $ph unauthenticated checks"; else no "the Phase $ph unauthenticated checks"; fi
    if nginx -t > /dev/null 2>&1; then ok "nginx -t"; else no "nginx -t"; fi
    realip
    sockets ;;
  --realip) realip ;;
  --tls)
    for h in "$ADMIN_HOST" "$CUST_HOST"; do
      o="$(openssl s_client -connect "$VPS_IPV4:443" -servername "$h" -verify_return_error -verify_hostname "$h" < /dev/null 2>&1)"
      if grep -q 'Verify return code: 0 (ok)' <<< "$o"; then ok "$h: the chain verifies with the system trust store and the name matches"; else no "$h: not a trusted certificate for this name"; fi
      c="$(openssl s_client -connect "$VPS_IPV4:443" -servername "$h" < /dev/null 2> /dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2> /dev/null)"
      if grep -qiE "Let.s Encrypt" <<< "$c"; then ok "$h: issued by Let's Encrypt"; else no "$h: issuer $(grep -m1 issuer <<< "$c")"; fi
      fps+=("$h $(openssl s_client -connect "$VPS_IPV4:443" -servername "$h" < /dev/null 2> /dev/null | openssl x509 -noout -fingerprint -sha256 2> /dev/null | cut -d= -f2)")
      end="$(sed -n 's/^notAfter=//p' <<< "$c")"; d=$(( ( $(date -d "$end" +%s 2> /dev/null || echo 0) - $(date +%s) ) / 86400 ))
      if [ "$d" -ge 30 ]; then ok "$h: $d days left"; else no "$h: only $d days left"; fi
      if grep -qE "DNS:$h(,|$)" <<< "$c" && [ "$(grep -o 'DNS:' <<< "$c" | wc -l)" -eq 1 ]; then ok "$h: the subject alternative name is exactly this host"; else no "$h: subject alternative names: $(grep -A1 'Alternative' <<< "$c" | tail -1)"; fi
    done
    for p in "${ERP_HOST#*.}" "$ERP_HOST"; do echo "INFO  inherited HSTS, $p: $(curl -sI --max-time 15 "https://$p/" | tr -d '\r' | sed -n 's/^strict-transport-security: //Ip' | head -1)"; done
    if grep -rqsiE "lets-encrypt|letsencrypt" /etc/cron.d /var/spool/cron/crontabs; then ok "a certificate renewal job exists (CloudPanel)"; else no "no renewal job found: check CloudPanel's renewal before relying on 90-day certificates"; fi ;;
  *) echo "usage: $0 --pre | --phase A|B | --realip | --tls" >&2; exit 64 ;;
esac
# S13's website gate, part 1: only a fully passing --tls run records the trusted certificates (their fingerprints; no
# secret). Part 2, S11.phaseB-ok, is written by the authenticated R1–R12 probe (tools/s11-owner-probe.sh), after this.
if [ "${1:-}" = --tls ]; then
  if [ "$f" -eq 0 ]; then
    { printf '%s S11b trusted certificates verified (chain, name, issuer, >= 30 days, renewal job)\n' "$(date -u +%FT%TZ)"; printf 'cert %s\n' "${fps[@]}"; } > "$STATE_DIR/S11.tls-ok.tmp"
    chmod 0600 "$STATE_DIR/S11.tls-ok.tmp"; mv -- "$STATE_DIR/S11.tls-ok.tmp" "$STATE_DIR/S11.tls-ok"; echo "RECORDED $STATE_DIR/S11.tls-ok"
  else echo "NOT RECORDED: the trusted-certificate checks did not all pass (S13 stays blocked)"; fi
fi
echo "S11-VERIFY fail=$f"; exit $([ "$f" -eq 0 ] && echo 0 || echo 3)
