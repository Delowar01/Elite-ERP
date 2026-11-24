#!/usr/bin/env bash
# PO-07 S11: render the kit-owned part of a staging vhost (units/nginx/*.tmpl) with this kit's values.
#   render-vhost.sh <A|B> <admin|customer>         the text the owner pastes into the CloudPanel vhost editor
#   render-vhost.sh <A|B> <admin|customer> --ci <cert> <key> <htpasswd>
#                                                  a complete server block emulating CloudPanel's generated lines
#                                                  (CI rehearsal only); it includes exactly the pasted text
# Phase A: closed (Basic Auth, nothing proxied). Phase B: the exact allow-list and HSTS max-age=300 (D8).
set -euo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/config.sh"
PH="${1:?A|B}"; WHO="${2:?admin|customer}"; shift 2
# CI only: the kit-owned server-level block alone, for another host (the rehearsal's header-echo vhost uses the SAME text)
if [ "$PH" = common-ci ]; then sed -e "s#@HOST@#$WHO#g" -e "s#@MAXBODY@#2m#g" "$HERE/units/nginx/common.conf.tmpl"; exit 0; fi
case "$WHO" in admin) H="$ADMIN_HOST"; S="$RUN_DIR/admin.sock"; MB=2m ;; customer) H="$CUST_HOST"; S="$RUN_DIR/customer.sock"; MB=12m ;; *) echo "admin|customer" >&2; exit 64 ;; esac
case "$PH" in A) L="$HERE/units/nginx/phaseA.locations.tmpl" ;; B) L="$HERE/units/nginx/phaseB-$WHO.locations.tmpl" ;; *) echo "A|B" >&2; exit 64 ;; esac
part() { cat "$HERE/units/nginx/common.conf.tmpl" "$L" | sed -e "s#@HOST@#$H#g" -e "s#@SOCK@#$S#g" -e "s#@MAXBODY@#$MB#g"; }
if [ "${1:-}" != --ci ]; then part; exit 0; fi
CERT="${2:?cert}"; KEY="${3:?key}"; HT="${4:?htpasswd}"
printf '# CI REHEARSAL ONLY: emulates the CloudPanel-generated lines around the kit-owned part (included verbatim).\n'
printf 'server {\n  listen 80;\n  listen 443 ssl http2;\n  server_name %s;\n  ssl_certificate %s;\n  ssl_certificate_key %s;\n' "$H" "$CERT" "$KEY"
printf '  root /var/www/po07-empty;\n  auth_basic "PO staging %s";\n  auth_basic_user_file %s;\n' "$WHO" "$HT"
printf '  if ($scheme != "https") { rewrite ^ https://$host$request_uri permanent; }\n'
printf '  location ^~ /.well-known/acme-challenge/ { auth_basic off; allow all; try_files $uri =404; }\n'
part | sed 's/^/  /'
printf '}\n'
