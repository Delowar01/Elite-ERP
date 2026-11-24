# PO-07 S11a → S10 → S11b, the fail-closed sequence (D3, D4, D8), rehearsed against a real nginx — sourced by
# rehearsal.sh as root after S9 (the two staging apps run behind their Unix sockets). Fictional host names, a CI test
# CA standing in for Let's Encrypt, fictional Basic Auth credentials. On the VPS CloudPanel generates the scaffolding
# (listen, server_name, certificate, Basic Auth, the scheme redirect, /.well-known) and the owner pastes the kit-owned
# part; here tools/render-vhost.sh --ci emulates the scaffolding and includes the SAME kit-owned text.
# nginx was installed at the start of the rehearsal, before the CI S0 (as on the VPS, its listeners are in the baseline),
# with root workers — the VPS's recorded worker identity.
N=/etc/nginx/po07-ci; install -d -m 0750 "$N" /var/www/po07-empty /run/po07-echo
ECHO=echo.po07.test
pre_tree() { find /etc/nginx -type f ! -path "$N/*" -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16; }
nmaster() { systemctl show -p MainPID --value nginx.service; }
reload_ok() { nginx -t > /dev/null 2>&1 || { nginx -t; fail "nginx -t failed"; }; systemctl reload nginx.service; sleep 1; [ "$(nmaster)" = "$M0" ] || fail "the nginx master PID changed on reload"; }
probe() { # PHASE CA|insecure EXPECT_HSTS [credentials on fd 3]
  local cfg="$RUNNER_TEMP/s11-$1-$2.json" ca=null ins=false cred=null
  [ "$2" = insecure ] && ins=true || ca="\"$N/ca.crt\""; [ "${4:-}" = creds ] && cred=3
  printf '{"phase":"%s","adminHost":"%s","custHost":"%s","connect":"127.0.0.1","httpsPort":443,"httpPort":80,"caFile":%s,"tlsInsecure":%s,"appDir":"%s","psql":["runuser","-u","%s","--","psql","-X","-q","-At","-h","%s","-p","%s","-d","%s"],"expectClientIp":"127.0.0.1","credFd":%s,"expectHsts":%s,"f1":false,"echoHost":%s}\n' \
    "$1" "$ADMIN_HOST" "$CUST_HOST" "$ca" "$ins" "$APP_SRC" "$PG_USER" "$PG_RUN" "$PG_PORT" "$DB" "$cred" "$3" "$([ "${4:-}" = creds ] && echo "\"$ECHO\"" || echo null)" > "$cfg"
  if [ "${4:-}" = creds ]; then node "$KIT_DIR/probes/s11-nginx-probe.mjs" "$cfg" 3< <(printf '%s\n%s\n%s\n%s\n' "$AU" "$AP" "$CU" "$CP")
  else node "$KIT_DIR/probes/s11-nginx-probe.mjs" "$cfg"; fi
}

step "S11 (CI) 0: the pre-change evidence (s11-verify.sh --pre), certificates and per-host Basic Auth"
M0="$(nmaster)"; T0="$(pre_tree)"
bash "$KIT_DIR/tools/s11-verify.sh" --pre | tee "$STATE_DIR/logs/ci-s11-pre.txt" | tail -12; grep -q 'S11-VERIFY fail=0' "$STATE_DIR/logs/ci-s11-pre.txt" || fail "S11 pre-step"
for h in "$ADMIN_HOST" "$CUST_HOST" "$ECHO"; do   # CloudPanel creates a self-signed placeholder per site
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$h" -addext "subjectAltName=DNS:$h" -keyout "$N/$h.self.key" -out "$N/$h.self.crt" 2> /dev/null
done
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=PO07 CI test CA (fictional)" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout "$N/ca.key" -out "$N/ca.crt" 2> /dev/null
leaf() { openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout "$N/$1.key" -out "$N/$1.csr" 2> /dev/null
  openssl x509 -req -in "$N/$1.csr" -CA "$N/ca.crt" -CAkey "$N/ca.key" -CAcreateserial -days 90 -extfile <(printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$1") -out "$N/$1.crt" 2> /dev/null; }
AU=ci-admin-user; AP="$(openssl rand -hex 18)"; CU=ci-customer-user; CP="$(openssl rand -hex 18)"   # different per host (D4)
printf '%s:%s\n' "$AU" "$(printf '%s' "$AP" | openssl passwd -6 -stdin)" > "$N/admin.htpasswd"
printf '%s:%s\n' "$CU" "$(printf '%s' "$CP" | openssl passwd -6 -stdin)" > "$N/customer.htpasswd"
chmod 0640 "$N"/*.htpasswd "$N"/*.key
end

step "S11a-A (CI): protected vhosts, nothing proxied — verified without any credential (self-signed: TLS not verified, so none is sent)"
bash "$KIT_DIR/tools/render-vhost.sh" A admin --ci "$N/$ADMIN_HOST.self.crt" "$N/$ADMIN_HOST.self.key" "$N/admin.htpasswd" > /etc/nginx/sites-enabled/po07-admin.conf
bash "$KIT_DIR/tools/render-vhost.sh" A customer --ci "$N/$CUST_HOST.self.crt" "$N/$CUST_HOST.self.key" "$N/customer.htpasswd" > /etc/nginx/sites-enabled/po07-customer.conf
! grep -q proxy_pass /etc/nginx/sites-enabled/po07-*.conf || fail "Phase A must not proxy anything"
reload_ok
probe A insecure false | tee "$STATE_DIR/logs/ci-s11-phaseA.txt" | grep -E '^(FAIL|S11-PROBE)'
grep -q '^S11-PROBE phase=A pass=[0-9]* fail=0$' "$STATE_DIR/logs/ci-s11-phaseA.txt" || fail "Phase A checks"
ref="$(printf '{"phase":"B","adminHost":"a","custHost":"c","connect":"127.0.0.1","httpsPort":443,"httpPort":80,"caFile":null,"tlsInsecure":true,"appDir":"%s","psql":null,"credFd":3}' "$APP_SRC" > "$RUNNER_TEMP/refuse.json"; node "$KIT_DIR/probes/s11-nginx-probe.mjs" "$RUNNER_TEMP/refuse.json" 3< <(printf 'u\np\nu\np\n') 2>&1 || true)"
grep -q 'REFUSED: credentials are never sent over unverified TLS' <<< "$ref" || fail "the probe must refuse credentials over unverified TLS"
echo "ok: the probe refuses to send credentials over an unverified TLS endpoint (the -k case)"
end

step "S10 (CI): DNS is the owner's step on the VPS (tools/dns-check.sh --before/--after, DNS-over-HTTPS); the rehearsal connects by address"
echo "not applicable on a runner: the fictional names are reached with SNI and Host headers on 127.0.0.1"
end

step "S11b (CI): trusted certificates (a CI test CA stands in for Let's Encrypt), verified BEFORE any credential or proxy"
for h in "$ADMIN_HOST" "$CUST_HOST" "$ECHO"; do leaf "$h"; done
bash "$KIT_DIR/tools/render-vhost.sh" A admin --ci "$N/$ADMIN_HOST.crt" "$N/$ADMIN_HOST.key" "$N/admin.htpasswd" > /etc/nginx/sites-enabled/po07-admin.conf
bash "$KIT_DIR/tools/render-vhost.sh" A customer --ci "$N/$CUST_HOST.crt" "$N/$CUST_HOST.key" "$N/customer.htpasswd" > /etc/nginx/sites-enabled/po07-customer.conf
reload_ok
for h in "$ADMIN_HOST" "$CUST_HOST"; do
  o="$(openssl s_client -connect 127.0.0.1:443 -servername "$h" -CAfile "$N/ca.crt" -verify_return_error -verify_hostname "$h" < /dev/null 2>&1)"
  grep -q 'Verify return code: 0 (ok)' <<< "$o" || fail "$h: the certificate does not verify"
  c="$(openssl s_client -connect 127.0.0.1:443 -servername "$h" < /dev/null 2> /dev/null | openssl x509 -noout -enddate -ext subjectAltName)"
  grep -qE "DNS:$h$" <<< "$c" && [ "$(grep -o 'DNS:' <<< "$c" | wc -l)" -eq 1 ] || fail "$h: SAN is not exactly the host"
  d=$(( ( $(date -d "$(sed -n 's/^notAfter=//p' <<< "$c")" +%s) - $(date +%s) ) / 86400 )); [ "$d" -ge 60 ] || fail "$h: $d days left"
  o2="$(openssl s_client -connect 127.0.0.1:443 -servername "$h" -CAfile "$N/ca.crt" -verify_return_error -verify_hostname "wrong.$h" < /dev/null 2>&1)"
  ! grep -q 'Verify return code: 0 (ok)' <<< "$o2" || fail "$h: a wrong host name verified"
  echo "ok: $h chain verified, SAN exactly the host, $d days left; a wrong name is refused"
done
probe A ca false | tee "$STATE_DIR/logs/ci-s11-phaseA-trusted.txt" | grep -E '^(FAIL|S11-PROBE)'
grep -q 'fail=0$' "$STATE_DIR/logs/ci-s11-phaseA-trusted.txt" || fail "Phase A with the trusted certificate"
end

step "S11a-B (CI): the protected proxy routes and HSTS max-age=300 (D8), only after trusted TLS and Basic Auth passed"
bash "$KIT_DIR/tools/render-vhost.sh" B admin --ci "$N/$ADMIN_HOST.crt" "$N/$ADMIN_HOST.key" "$N/admin.htpasswd" > /etc/nginx/sites-enabled/po07-admin.conf
bash "$KIT_DIR/tools/render-vhost.sh" B customer --ci "$N/$CUST_HOST.crt" "$N/$CUST_HOST.key" "$N/customer.htpasswd" > /etc/nginx/sites-enabled/po07-customer.conf
{ printf 'server {\n  listen 443 ssl http2;\n  server_name %s;\n  ssl_certificate %s;\n  ssl_certificate_key %s;\n  auth_basic "PO staging echo";\n  auth_basic_user_file %s;\n' "$ECHO" "$N/$ECHO.crt" "$N/$ECHO.key" "$N/admin.htpasswd"
  bash "$KIT_DIR/tools/render-vhost.sh" common-ci "$ECHO" | sed 's/^/  /'; printf '  location / { proxy_pass http://unix:/run/po07-echo/echo.sock:; }\n}\n'; } > /etc/nginx/sites-enabled/po07-echo.conf
node "$HERE/echo-headers.mjs" /run/po07-echo/echo.sock & ECHO_PID=$!; sleep 1
reload_ok
probe B ca true | tee "$STATE_DIR/logs/ci-s11-phaseB-unauth.txt" | grep -E '^(FAIL|S11-PROBE)'
grep -q 'fail=0$' "$STATE_DIR/logs/ci-s11-phaseB-unauth.txt" || fail "Phase B unauthenticated checks"
probe B ca true creds | tee "$STATE_DIR/logs/ci-s11-phaseB-auth.txt" | grep -E '^(PASS R|FAIL|S11-PROBE)'
grep -q 'fail=0$' "$STATE_DIR/logs/ci-s11-phaseB-auth.txt" || fail "Phase B: R1–R12 through nginx"
end

step "S11 (CI): certificate renewal without interruption; sockets, permissions and listeners"
s0="$(openssl s_client -connect 127.0.0.1:443 -servername "$ADMIN_HOST" < /dev/null 2> /dev/null | openssl x509 -noout -serial)"
( for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' --cacert "$N/ca.crt" --resolve "$ADMIN_HOST:443:127.0.0.1" "https://$ADMIN_HOST/robots.txt"; sleep 0.05; done ) > "$RUNNER_TEMP/during-renewal.txt" &
leaf "$ADMIN_HOST"; reload_ok; wait $!
s1="$(openssl s_client -connect 127.0.0.1:443 -servername "$ADMIN_HOST" < /dev/null 2> /dev/null | openssl x509 -noout -serial)"
[ "$s0" != "$s1" ] && [ "$(sort -u "$RUNNER_TEMP/during-renewal.txt")" = 200 ] || fail "renewal: serial $s0 → $s1, responses $(sort "$RUNNER_TEMP/during-renewal.txt" | uniq -c | tr '\n' ' ')"
echo "ok: a renewed certificate is served after a graceful reload; all 40 requests during the reload answered 200"
bash "$KIT_DIR/tools/s11-verify.sh" --pre > "$STATE_DIR/logs/ci-s11-post.txt" 2>&1 || true
grep -E 'OK    .*(sock|cannot open|permission)|FAIL' "$STATE_DIR/logs/ci-s11-post.txt" | grep -v 'vhost for' || true
! grep -E '^FAIL' "$STATE_DIR/logs/ci-s11-post.txt" | grep -v 'a vhost for' | grep -q . || fail "sockets or permissions after S11"
newtcp="$(comm -13 "$STATE_DIR/baseline-tcp.txt" <(ss -ltnH | awk '{print $4}' | sort -u) | tr '\n' ' ')"
[ -z "$newtcp" ] || fail "new host TCP listener(s) after S11: $newtcp"
echo "ok: no new TCP listener (the apps stay behind their Unix sockets; nginx's 80/443 were already listening)"
end

step "S11 (CI) rollback: delete both sites (as CloudPanel does), nginx back to its exact pre-change files"
kill "$ECHO_PID" 2> /dev/null || true
rm -f /etc/nginx/sites-enabled/po07-admin.conf /etc/nginx/sites-enabled/po07-customer.conf /etc/nginx/sites-enabled/po07-echo.conf
reload_ok
rm -rf "$N" /run/po07-echo /var/www/po07-empty
[ "$(pre_tree)" = "$T0" ] || fail "the nginx tree differs from its pre-change state after the rollback"
echo "ok: the nginx file tree equals its pre-change checksum ($T0); master PID unchanged ($M0)"
S11_PASS="$(grep -h '^S11-PROBE' "$STATE_DIR"/logs/ci-s11-phase*.txt | sed -E 's/.*pass=([0-9]+).*/\1/' | awk '{s += $1} END {print s}')"
end
