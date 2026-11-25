#!/usr/bin/env bash
# PO-07 S11a-B (D4): the AUTHENTICATED checks through nginx (R1–R12), run by the OWNER in their own terminal on the VPS
# (ssh -t …, as root), only after trusted HTTPS was verified (tools/s11-verify.sh --tls) and Phase B is saved.
#   bash /root/elite-po-kit/tools/s11-owner-probe.sh
# 25 Nov 2026 (owner-approved revision): each host's Basic Auth USER NAME is read from that host's own root-only
# password file — the one file its live vhost names — after checking that the file holds exactly one well-formed entry;
# the owner types only the two PASSWORDS (not echoed). User names, passwords and hashes are never displayed, logged,
# passed as an argument, put in the environment or written to a file: they reach the probe on file descriptor 3 only.
# The probe (unchanged) sends them only over TLS verified against the system trust store and prints PASS/FAIL lines only.
# Tell Claude Code only the final S11-PROBE and RECORDED lines.
set -euo pipefail
K="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$K/config.sh"
NGINX_SITES="/etc/nginx/sites-enabled"   # CloudPanel's vhost of each staging site, named after the host plus .conf (read only)
BA_DIR="/etc/nginx/basic-auth"           # CloudPanel's Basic Auth file of each site, named after the host (read only)
refuse() { echo "refused: $* (nothing was sent)" >&2; exit 3; }
# ba_user <vhost file> <the password file it must name> <host>: prints that file's single user name on stdout, for the
# caller to capture (never shown). Refuses — naming only the failed property, never a value — unless the vhost names
# exactly that one file and the file is a root-owned regular file, not writable by group or others, holding exactly one
# well-formed "user:hash" line (no CR, no whitespace, no control character, no comment).
ba_user() {
  local v="$1" want="$2" what="$3" l ents=()
  [ -f "$v" ] && [ ! -L "$v" ] || refuse "$what: its vhost is missing or is a link"
  [ "$(grep -cE '^[[:space:]]*auth_basic_user_file[[:space:]]' "$v")" -eq 1 ] || refuse "$what: its vhost must name exactly one Basic Auth file"
  [ "$(sed -nE 's/^[[:space:]]*auth_basic_user_file[[:space:]]+([^;[:space:]]+)[[:space:]]*;.*$/\1/p' "$v" | tr -d '\r')" = "$want" ] ||
    refuse "$what: its vhost names a different Basic Auth file than this host's own"
  [ -f "$want" ] && [ ! -L "$want" ] || refuse "$what: its Basic Auth file is missing or is a link"
  [ "$(stat -c %u "$want")" = 0 ] || refuse "$what: its Basic Auth file is not owned by root"
  [ $(( 0$(stat -c %a "$want") & 022 )) -eq 0 ] || refuse "$what: its Basic Auth file is writable by group or others"
  # bash only (no grep here): some grep builds drop a CR before the newline, which would hide it
  [[ "$(< "$want")" != *$'\r'* ]] || refuse "$what: its Basic Auth file contains CR characters"
  while IFS= read -r l || [ -n "$l" ]; do [ -z "$l" ] || ents+=("$l"); done < "$want"
  [ "${#ents[@]}" -eq 1 ] || refuse "$what: its Basic Auth file must hold exactly one entry"
  [[ "${ents[0]}" =~ ^([^:#[:space:][:cntrl:]]+):([^:[:space:][:cntrl:]]+)$ ]] || refuse "$what: its Basic Auth entry is not one well-formed user:hash line"
  printf '%s' "${BASH_REMATCH[1]}"
}
[ "${1:-}" = --functions-only ] && return 0 2> /dev/null   # validate-kit.sh sources the functions; never used on the VPS
[ -t 0 ] && [ -t 1 ] || { echo "run this in your own interactive terminal (ssh -t)" >&2; exit 4; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (the password files are root-only; the read-only database checks use the staging cluster's peer access)" >&2; exit 4; }
trap 'unset au ap cu cpw' EXIT
au="$(ba_user "$NGINX_SITES/$ADMIN_HOST.conf" "$BA_DIR/$ADMIN_HOST" "$ADMIN_HOST")"
cu="$(ba_user "$NGINX_SITES/$CUST_HOST.conf" "$BA_DIR/$CUST_HOST" "$CUST_HOST")"
[ "$au" != "$cu" ] || refuse "the two hosts share one Basic Auth user name (D4: a separate login per host)"
echo "Basic Auth user names: read from each host's own root-only file (exactly one entry each; not shown)."
read -rsp "Basic Auth password for $ADMIN_HOST (not shown): " ap; echo
read -rsp "Basic Auth password for $CUST_HOST (not shown): " cpw; echo
[ -n "$ap" ] && [ -n "$cpw" ] || refuse "both passwords are required"
cfg="$(mktemp)"; trap 'rm -f "$cfg"; unset au ap cu cpw' EXIT
printf '{"phase":"B","adminHost":"%s","custHost":"%s","connect":"%s","httpsPort":443,"httpPort":80,"caFile":null,"tlsInsecure":false,"appDir":"%s","psql":["runuser","-u","%s","--","psql","-X","-q","-At","-h","%s","-p","%s","-d","%s"],"expectClientIp":null,"credFd":3,"expectHsts":true,"f1":false,"echoHost":null,"recordFile":"%s","requireFile":"%s"}\n' \
  "$ADMIN_HOST" "$CUST_HOST" "$VPS_IPV4" "$APP_SRC" "$PG_USER" "$PG_RUN" "$PG_PORT" "$DB" "$STATE_DIR/S11.phaseB-ok" "$STATE_DIR/S11.tls-ok" > "$cfg"
# a full pass records S11.phaseB-ok (S13's website gate) only if tools/s11-verify.sh --tls recorded S11.tls-ok first
[ -f "$STATE_DIR/S11.tls-ok" ] || echo "note: S11.tls-ok is not recorded yet (tools/s11-verify.sh --tls): this run cannot open the S13 gate"
node "$K/probes/s11-nginx-probe.mjs" "$cfg" 3< <(printf '%s\n%s\n%s\n%s\n' "$au" "$ap" "$cu" "$cpw")
