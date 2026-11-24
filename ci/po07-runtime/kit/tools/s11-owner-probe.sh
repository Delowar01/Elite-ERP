#!/usr/bin/env bash
# PO-07 S11a-B (D4): the AUTHENTICATED checks through nginx (R1–R12), run by the OWNER in their own terminal on the VPS
# (ssh -t …, as root), only after trusted HTTPS was verified (tools/s11-verify.sh --tls) and Phase B is saved.
#   bash /root/elite-po-kit/tools/s11-owner-probe.sh
# It asks for each staging host's Basic Auth user and password (the password is not echoed) and hands them to the probe
# on file descriptor 3 only — never as an argument, in the environment, in a file or in the output. The probe sends them
# only over TLS verified against the system trust store, and prints PASS/FAIL lines only. Tell Claude Code only the
# final S11-PROBE line.
set -euo pipefail
K="$(cd "$(dirname "$0")/.." && pwd)"
. "$K/config.sh"
[ -t 0 ] && [ -t 1 ] || { echo "run this in your own interactive terminal (ssh -t)" >&2; exit 4; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (the read-only database checks use the staging cluster's peer access)" >&2; exit 4; }
read -rp "Basic Auth user for $ADMIN_HOST: " au; read -rsp "password (not shown): " ap; echo
read -rp "Basic Auth user for $CUST_HOST: " cu; read -rsp "password (not shown): " cpw; echo
cfg="$(mktemp)"; trap 'rm -f "$cfg"; unset au ap cu cpw' EXIT
printf '{"phase":"B","adminHost":"%s","custHost":"%s","connect":"%s","httpsPort":443,"httpPort":80,"caFile":null,"tlsInsecure":false,"appDir":"%s","psql":["runuser","-u","%s","--","psql","-X","-q","-At","-h","%s","-p","%s","-d","%s"],"expectClientIp":null,"credFd":3,"expectHsts":true,"f1":false,"echoHost":null,"recordFile":"%s","requireFile":"%s"}\n' \
  "$ADMIN_HOST" "$CUST_HOST" "$VPS_IPV4" "$APP_SRC" "$PG_USER" "$PG_RUN" "$PG_PORT" "$DB" "$STATE_DIR/S11.phaseB-ok" "$STATE_DIR/S11.tls-ok" > "$cfg"
# a full pass records S11.phaseB-ok (S13's website gate) only if tools/s11-verify.sh --tls recorded S11.tls-ok first
[ -f "$STATE_DIR/S11.tls-ok" ] || echo "note: S11.tls-ok is not recorded yet (tools/s11-verify.sh --tls): this run cannot open the S13 gate"
node "$K/probes/s11-nginx-probe.mjs" "$cfg" 3< <(printf '%s\n%s\n%s\n%s\n' "$au" "$ap" "$cu" "$cpw")
