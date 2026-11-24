#!/usr/bin/env bash
# PO-07 S11: read-only verification ON THE VPS (as root), with no credentials. Changes nothing.
#   s11-verify.sh --pre                the S11a pre-step: nginx -t, master PID, worker identity, every nginx file checksum
#   s11-verify.sh --phase A|B          the unauthenticated probe through nginx (Phase A: CloudPanel's self-signed
#                                      certificate, so TLS is not verified AND no credential is ever sent)
#   s11-verify.sh --tls                the trusted certificates (S11b): chain verified by the system store, the host name,
#                                      days left, the renewal job; inherited HSTS of the parent names
# --pre and --phase also check: the sockets 0660 root:<NGINX_GROUP> in their 0750 directory, other users refused, no
# permission error in the nginx logs.
set -uo pipefail
export LC_ALL=C
K="$(cd "$(dirname "$0")/.." && pwd)"
. "$K/config.sh"
OUT="$STATE_DIR/logs"; mkdir -p "$OUT"; ts="$(date -u +%Y%m%dT%H%M%SZ)"
f=0; ok() { echo "OK    $1"; }; no() { echo "FAIL  $1"; f=$((f + 1)); }
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
  if grep -hs "unix:$RUN_DIR" /var/log/nginx/error.log /home/*/logs/nginx/error.log 2> /dev/null | grep -q "Permission denied"; then no "nginx logged a permission error on a staging socket"
  else ok "no permission error on a staging socket in the nginx logs"; fi
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
    sockets ;;
  --tls)
    for h in "$ADMIN_HOST" "$CUST_HOST"; do
      o="$(openssl s_client -connect "$VPS_IPV4:443" -servername "$h" -verify_return_error -verify_hostname "$h" < /dev/null 2>&1)"
      if grep -q 'Verify return code: 0 (ok)' <<< "$o"; then ok "$h: the chain verifies with the system trust store and the name matches"; else no "$h: not a trusted certificate for this name"; fi
      c="$(openssl s_client -connect "$VPS_IPV4:443" -servername "$h" < /dev/null 2> /dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2> /dev/null)"
      if grep -qiE "Let.s Encrypt" <<< "$c"; then ok "$h: issued by Let's Encrypt"; else no "$h: issuer $(grep -m1 issuer <<< "$c")"; fi
      end="$(sed -n 's/^notAfter=//p' <<< "$c")"; d=$(( ( $(date -d "$end" +%s 2> /dev/null || echo 0) - $(date +%s) ) / 86400 ))
      if [ "$d" -ge 30 ]; then ok "$h: $d days left"; else no "$h: only $d days left"; fi
      if grep -qE "DNS:$h(,|$)" <<< "$c" && [ "$(grep -o 'DNS:' <<< "$c" | wc -l)" -eq 1 ]; then ok "$h: the subject alternative name is exactly this host"; else no "$h: subject alternative names: $(grep -A1 'Alternative' <<< "$c" | tail -1)"; fi
    done
    for p in "${ERP_HOST#*.}" "$ERP_HOST"; do echo "INFO  inherited HSTS, $p: $(curl -sI --max-time 15 "https://$p/" | tr -d '\r' | sed -n 's/^strict-transport-security: //Ip' | head -1)"; done
    if grep -rqsiE "lets-encrypt|letsencrypt" /etc/cron.d /var/spool/cron/crontabs; then ok "a certificate renewal job exists (CloudPanel)"; else no "no renewal job found: check CloudPanel's renewal before relying on 90-day certificates"; fi ;;
  *) echo "usage: $0 --pre | --phase A|B | --tls" >&2; exit 64 ;;
esac
echo "S11-VERIFY fail=$f"; exit $([ "$f" -eq 0 ] && echo 0 || echo 3)
