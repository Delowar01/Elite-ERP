#!/usr/bin/env bash
# PO-07 Phase A — READ-ONLY inspection of the existing VPS (Elite ERP host). It prints facts, never secrets.
#
# Run it from the operator's PC (Git Bash on Windows) after checking its SHA-256 and reading it. Pass the two
# hostnames as arguments; they are deliberately not written in this public repository:
#   ssh -o BatchMode=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o StrictHostKeyChecking=yes <alias> \
#     'bash -s -- <ERP_HOST> <ADMIN_HOST>' < vps_readonly_inspection.sh > ~/elite-erp-po07/vps-inspection.txt 2>&1
# Keep the output OUTSIDE the repository: the repository is public. Never commit the output.
#
# Guarantees (by construction; review before running):
# - no file is created, changed or deleted, and nothing is started, stopped, reloaded or restarted
#   (the system logs the SSH login and any sudo use, as it does for every login);
# - no SQL is run and no database is contacted; no process environment (/proc/*/environ) is read;
# - environment files are read for variable NAMES, plus the values of a short list of non-secret settings;
#   the database is classified by provider only (never its URL, user, password, host or name);
# - URLs with credentials, values of PASSWORD/SECRET/TOKEN/KEY/AUTH-like settings and cron URL paths are redacted;
#   IP addresses other than loopback and wildcard are masked in the process, socket, nginx, unit, firewall and cron output;
# - git runs with --no-optional-locks (no index write) and fsmonitor off; pm2, npm, gpg and clpctl are never run;
#   only node binaries are executed (`node -v`, unprivileged);
# - nginx is read from its files (not `nginx -T`); only public certificates are read, never private keys;
# - every command runs with stdin from /dev/null: the whole script is parsed before anything runs.
set -u
export LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0

h() { printf '\n== %s\n' "$1"; }

red() {  # redact credentials and secret-like values
  sed -E \
    -e 's#([a-zA-Z][a-zA-Z0-9+.-]*://)[^/@[:space:]]+@#\1<redacted>@#g' \
    -e 's#(postgres(ql)?|mysql|redis|mongodb(\+srv)?)://[^[:space:]"'"'"']*#\1://<redacted>#g' \
    -e 's#([A-Za-z0-9_]*(PASS(WORD)?|SECRET|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|AUTH)[A-Za-z0-9_]*[[:space:]]*[=:][[:space:]]*)[^[:space:]]+#\1<redacted>#gI' \
    -e 's#(Authorization[[:space:]"'"'"':]+)[^;]*#\1<redacted>#gI' \
    -e 's#(Basic|Bearer)[[:space:]]+[A-Za-z0-9+/=._~-]+#\1 <redacted>#g' \
    -e 's#((mysql|mysqldump|mariadb|mariadb-dump)[^|;]*[[:space:]]-p)[^[:space:]]+#\1<redacted>#g' \
    -e 's#(sshpass[[:space:]]+-p[[:space:]]*)[^[:space:]]+#\1<redacted>#g'
}

redurl() {  # keep the scheme and host of a URL, drop its path and query (ping and webhook URLs embed secrets)
  sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://[^/[:space:]"'"'"']+)/[^[:space:]"'"'"']*#\1/<path-redacted>#g'
}

maskip4() {  # mask IPv4 addresses except loopback (127.x) and wildcard (0.0.0.0)
  sed -E \
    -e 's/(^|[^0-9.])127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/\1LOOPV4x\2x\3x\4x/g' \
    -e 's/(^|[^0-9.])0\.0\.0\.0/\1ANYV4x/g' \
    -e 's/(^|[^0-9.])[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/\1<ipv4>/g' \
    -e 's/LOOPV4x([0-9]+)x([0-9]+)x([0-9]+)x/127.\1.\2.\3/g' \
    -e 's/ANYV4x/0.0.0.0/g'
}

maskip() {  # IPv4 as above, and IPv6 except ::1 and :: (not used where times such as 12:34:56 appear)
  maskip4 | sed -E 's/(^|[^0-9A-Fa-f:])[0-9A-Fa-f]{1,4}(:[0-9A-Fa-f]{0,4}){2,7}/\1<ipv6>/g'
}

envnames() {  # variable NAMES of an env file, never values
  $SUDO sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$1" 2>/dev/null | sort -u | tr '\n' ' '
  echo
}

dbclass() {  # stdin: DATABASE_URL=… lines; prints the provider class only
  local line host
  line=$(head -1)
  if [ -z "$line" ]; then echo "  database: DATABASE_URL not set here"; return; fi
  host=$(printf '%s\n' "$line" | sed -nE 's/^[^=]*=[[:space:]]*["'"'"']?[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^@]*@)?(\[[^]]*\]|[^\/:?"'"'"'[:space:]]*).*/\2/p')
  case "$host" in
    "") echo "  database: a local socket, or a URL this check cannot parse" ;;
    *-pooler.*.neon.tech) echo "  database: Neon, pooled endpoint" ;;
    *.neon.tech) echo "  database: Neon, direct endpoint" ;;
    localhost|127.*|"[::1]") echo "  database: a server on this VPS (loopback)" ;;
    "["*) echo "  database: a server addressed by an IPv6 address (not loopback)" ;;
    *[!0-9.]*) echo "  database: another remote provider (domain suffix: $(printf '%s' "$host" | awk -F. '{ if (NF>=2) print $(NF-1)"."$NF; else print "?" }'))" ;;
    *) echo "  database: a server addressed by an IPv4 address (not loopback)" ;;
  esac
}

okhost() { printf '%s' "$1" | grep -qE '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'; }
re() { printf '%s' "$1" | sed 's/\./\\./g'; }

main() {
  SUDO=""
  if [ "$(id -u)" -ne 0 ] && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi
  LOW="nice -n 19"; command -v ionice >/dev/null 2>&1 && LOW="$LOW ionice -c3"
  ERP_HOST=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z'); ADMIN_HOST=$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z'); HOSTS_OK=no
  if okhost "$ERP_HOST" && okhost "$ADMIN_HOST"; then HOSTS_OK=yes; ZONE="${ERP_HOST#*.}"; fi

  h "0 inspection context"
  echo "user: $(id -un) (root: $([ "$(id -u)" -eq 0 ] && echo yes || echo no); non-interactive sudo: $([ -n "$SUDO" ] && echo yes || echo no))"
  [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ] && echo "NOTE: neither root nor passwordless sudo — many sections below will be incomplete"
  echo "host: $(hostname) | date (UTC): $(date -u +%FT%TZ) | hostnames given: $HOSTS_OK"

  h "A1 operating system"
  if [ -r /etc/os-release ]; then . /etc/os-release; echo "os: ${PRETTY_NAME:-unknown}"; fi
  echo "kernel: $(uname -r) | uptime: $(uptime -p 2>/dev/null)"
  echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"

  h "A2 CPU, memory, swap, disk, cgroups"
  echo "cpus: $(nproc)"
  free -h
  df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null
  echo "cgroup filesystem: $(stat -fc %T /sys/fs/cgroup 2>/dev/null) (cgroup2fs = systemd MemoryMax is available)"

  h "A3 hosting control panel and key packages"
  for p in /usr/bin/clpctl /usr/local/bin/clpctl; do [ -x "$p" ] && echo "CloudPanel CLI present: $p"; done
  [ -d /home/clp ] && echo "CloudPanel home present"
  for d in /usr/local/cpanel /usr/local/hestia /opt/plesk /usr/local/CyberCP /usr/local/directadmin /usr/local/vesta; do [ -e "$d" ] && echo "other panel present: $d"; done
  dpkg-query -W -f='${Package} ${Version}\n' 2>/dev/null \
    | grep -E '^(cloudpanel|clp-[a-z-]+|nginx|nginx-common|postgresql|postgresql-[0-9]+|postgresql-common|mysql-server|mariadb-server|redis-server|certbot|ufw|nftables|fail2ban|nodejs|docker-ce|docker\.io|restic|borgbackup|rclone|age|gnupg) ' || true

  h "A4 listening TCP sockets (address and process name; public addresses masked)"
  if command -v ss >/dev/null 2>&1; then
    $SUDO ss -ltnpH 2>/dev/null | awk '{print $4, $6}' | sed -E 's/,pid=[0-9]+,fd=[0-9]+//g; s/users:\(\(/(/; s/\)\)$/)/' | maskip | sort -u
  else
    echo "ss not installed (listening sockets not listed)"
  fi

  h "A5 running services (selected)"
  systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null | awk '{print $1}' \
    | grep -iE 'nginx|node|next|pm2|elite|erp|postgres|mysql|mariadb|redis|clp|cloudpanel|php|fail2ban|ufw|cron|docker|monarx|hostinger|agent' || true

  h "A6 Node.js processes (command lines redacted; environments are not read)"
  ps -eo pid=,user=,etime=,rss=,args= 2>/dev/null | grep -E '[n]ode|[n]ext-server|[P]M2' | red | maskip4 \
    | awk '{ $4 = sprintf("%dMB", $4/1024); print }' | cut -c1-220
  PIDS=$( { pgrep -f 'next-server|next start|next/dist/bin/next|\.next/standalone/server\.js'; pgrep -x node; pgrep -x nodejs; } 2>/dev/null | sort -un)
  for pid in $PIDS; do
    exe=$($SUDO readlink -f "/proc/$pid/exe" 2>/dev/null); cwd=$($SUDO readlink -f "/proc/$pid/cwd" 2>/dev/null); ver=""
    case "${exe##*/}" in
      node|nodejs|node[0-9]*)
        ver=$("$exe" -v 2>/dev/null)
        [ -z "$ver" ] && ver=$($SUDO sed -nE 's/^#define NODE_(MAJOR|MINOR|PATCH)_VERSION ([0-9]+).*/\2/p' "${exe%/bin/*}/include/node/node_version.h" 2>/dev/null | paste -sd. -)
        ;;
      *) ver="(not a node binary)" ;;
    esac
    echo "pid $pid [$(ps -o comm= -p "$pid" 2>/dev/null)] user $(ps -o user= -p "$pid" 2>/dev/null): ${exe:-?} ${ver:-?} | cwd ${cwd:-?}"
  done
  NODE_DEFAULT=$(command -v node 2>/dev/null)
  echo "default node: ${NODE_DEFAULT:-none} $([ -n "$NODE_DEFAULT" ] && node -v 2>/dev/null) | npm $([ -n "$NODE_DEFAULT" ] && sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$(dirname "$(readlink -f "$NODE_DEFAULT")")/../lib/node_modules/npm/package.json" 2>/dev/null | head -1)"

  APPS=$(for pid in $PIDS; do d=$($SUDO readlink -f "/proc/$pid/cwd" 2>/dev/null); [ -n "$d" ] && [ "$d" != / ] && $SUDO test -f "$d/package.json" && echo "$d"; done | sort -u)
  h "B application directories of the running Node.js processes"
  echo "${APPS:-<none found>}"
  for APP in $APPS; do
    h "B1 app: $APP"
    echo "owner/mode: $($SUDO stat -c '%U:%G %a' "$APP" 2>/dev/null)"
    echo "package: $($SUDO grep -m1 -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' "$APP/package.json" 2>/dev/null) | declared $($SUDO grep -m1 -oE '"next"[[:space:]]*:[[:space:]]*"[^"]+"' "$APP/package.json" 2>/dev/null) | engines $($SUDO sed -n '/"engines"/,/}/p' "$APP/package.json" 2>/dev/null | tr -d ' \n')"
    echo "installed next: $($SUDO grep -m1 -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$APP/node_modules/next/package.json" 2>/dev/null)"
    if $SUDO test -f "$APP/.next/BUILD_ID"; then
      echo "build id: $($SUDO cat "$APP/.next/BUILD_ID") | built: $($SUDO stat -c %y "$APP/.next/BUILD_ID")"
    fi
    echo "sizes: $($SUDO $LOW du -sh "$APP/.next" "$APP/node_modules" 2>/dev/null | awk '{print $2"="$1}' | sed "s#$APP/##g" | tr '\n' ' ')"
    if $SUDO test -d "$APP/.git"; then
      g() { $SUDO git --no-optional-locks -c safe.directory='*' -c core.fsmonitor=false -c core.untrackedCache=false -C "$APP" "$@"; }
      g log -1 --format='git HEAD: %H | %cI | %s' 2>/dev/null | cut -c1-200
      echo "branch: $(g rev-parse --abbrev-ref HEAD 2>/dev/null)"
      g remote -v 2>/dev/null | red | sort -u
      echo "uncommitted changes: $(g status --porcelain 2>/dev/null | wc -l) path(s)"
    else
      echo "not a git checkout"
    fi
    for f in .env .env.local .env.production .env.production.local; do
      $SUDO test -f "$APP/$f" || continue
      echo "env file $f ($($SUDO stat -c '%U:%G %a' "$APP/$f")) — variable NAMES:"
      echo "  $(envnames "$APP/$f")"
      $SUDO grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=' "$APP/$f" 2>/dev/null | dbclass
      for v in PORT HOSTNAME NODE_ENV PDF_RENDER_ORIGIN CUSTOMER_PUBLIC_ORIGIN PLATFORM_TRUSTED_PROXY_HOPS STORAGE_DRIVER \
               PLATFORM_CONSOLE_ENABLED TENANT_ACCESS_ENFORCEMENT PLATFORM_INVITATIONS_ENABLED CUSTOMER_INVITE_ACCEPTANCE_ENABLED \
               PLATFORM_USER_INVITATIONS_ENABLED CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED CUSTOMER_SEAT_ENFORCEMENT_ENABLED; do
        $SUDO sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$v[[:space:]]*=[[:space:]]*[\"']?([^\"'[:space:]]*).*/  value: $v=\2/p" "$APP/$f" 2>/dev/null | head -1 | red | cut -c1-160
      done
    done
    echo "uploads/: $($SUDO $LOW find "$APP/uploads" -type f 2>/dev/null | wc -l) file(s), $($SUDO $LOW du -sh "$APP/uploads" 2>/dev/null | cut -f1)"
    for f in ecosystem.config.js ecosystem.config.cjs ecosystem.config.json; do
      if $SUDO test -f "$APP/$f"; then
        echo "pm2 file $f (selected keys only):"
        $SUDO grep -E '^[[:space:]]*"?(name|script|args|cwd|exec_mode|instances|autorestart|max_memory_restart|PORT|NODE_ENV)"?[[:space:]]*:' "$APP/$f" | red | redurl | maskip
      fi
    done
  done

  h "B2 how the application is started (systemd units and pm2)"
  for u in $(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -iE '(^|[-_@.])(elite|erp|next|node|nodejs|pm2)([-_@.]|$)'); do
    echo "-- unit $u (enabled: $(systemctl is-enabled "$u" 2>/dev/null), active: $(systemctl is-active "$u" 2>/dev/null))"
    systemctl cat "$u" 2>/dev/null | grep -E '^[[:space:]]*(ExecStart|ExecReload|WorkingDirectory|User|Group|EnvironmentFile|Restart|MemoryMax)=' | red | maskip
    systemctl cat "$u" 2>/dev/null | sed -nE 's/^[[:space:]]*Environment="?([A-Za-z_][A-Za-z0-9_]*)=.*/  Environment name: \1/p'
    dbl=$(systemctl cat "$u" 2>/dev/null | sed -nE 's/^[[:space:]]*Environment="?(DATABASE_URL=.*)/\1/p')
    [ -n "$dbl" ] && printf '%s\n' "$dbl" | dbclass
    for ef in $(systemctl cat "$u" 2>/dev/null | sed -nE 's/^[[:space:]]*EnvironmentFile=-?//p'); do
      $SUDO test -f "$ef" || continue
      echo "  EnvironmentFile $ef — variable NAMES: $(envnames "$ef")"
      $SUDO grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=' "$ef" 2>/dev/null | dbclass
    done
  done
  if pgrep -f 'PM2 v' >/dev/null 2>&1; then echo "a pm2 daemon is running as: $(ps -o user= -p "$(pgrep -f 'PM2 v' | head -1)")"; else echo "no pm2 daemon running"; fi

  CONF=$( { echo /etc/nginx/nginx.conf; ls -1 /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null; } | sort -u )
  h "C nginx (read from the files; directives of interest only; public addresses masked)"
  if command -v nginx >/dev/null 2>&1; then nginx -v 2>&1; else echo "nginx binary not found"; fi
  for f in $CONF; do
    $SUDO test -f "$f" || continue
    echo "-- $f"
    $SUDO grep -nE '^[[:space:]]*(server_name|listen|root|proxy_pass|proxy_set_header[[:space:]]+(Host|X-Forwarded-[A-Za-z-]+|X-Real-IP)|ssl_certificate[[:space:]]|location|return|add_header[[:space:]]+(Strict-Transport-Security|X-Robots-Tag|Content-Security-Policy|X-Frame-Options)|include[[:space:]]|client_max_body_size|auth_basic[[:space:]]|allow[[:space:]]|deny[[:space:]]|access_log|http2)\b' "$f" 2>/dev/null | red | maskip | cut -c1-200
  done
  h "C2 server names matching the two hostnames, wildcards, regex names and catch-alls; default servers"
  if [ "$HOSTS_OK" = yes ]; then
    P="server_name[^;]*[[:space:]](($(re "$ERP_HOST")|$(re "$ADMIN_HOST")|\*\.$(re "$ERP_HOST")|\*\.$(re "$ZONE")|\.$(re "$ERP_HOST")|\.$(re "$ZONE")|_)([[:space:]]|;|$)|~)"
    any=no
    for f in $CONF; do
      out=$($SUDO grep -nE "$P" "$f" 2>/dev/null)
      [ -n "$out" ] && { any=yes; echo "-- $f"; printf '%s\n' "$out" | maskip; }
    done
    [ "$any" = yes ] || echo "(no matching server_name)"
  else
    echo "(skipped: pass <ERP_HOST> <ADMIN_HOST> as arguments)"
  fi
  any=no
  for f in $CONF; do
    out=$($SUDO grep -nE 'listen[^;]*default_server' "$f" 2>/dev/null)
    [ -n "$out" ] && { any=yes; echo "-- default server in $f"; printf '%s\n' "$out" | maskip; }
  done
  [ "$any" = yes ] || echo "(no explicit default_server)"

  h "D TLS certificates referenced by nginx (public certificates only)"
  for c in $($SUDO grep -hoE '^[[:space:]]*ssl_certificate[[:space:]]+[^;]+' $CONF 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "-- $c"
    $SUDO openssl x509 -noout -subject -issuer -enddate -ext subjectAltName -in "$c" 2>/dev/null | tr '\n' ' ' | tr -s ' '
    echo
  done
  $SUDO ls -1 /etc/letsencrypt/live 2>/dev/null | sed 's/^/letsencrypt live: /'

  h "E DNS as seen from the VPS (no address is printed; only whether it is this VPS)"
  if [ "$HOSTS_OK" = yes ]; then
    MYIPS=$(ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
    [ -z "$MYIPS" ] && MYIPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$')
    [ -z "$MYIPS" ] && echo "WARNING: this VPS's own addresses could not be listed; 'points at this VPS' below is unreliable"
    echo "this VPS has global addresses: v4 $(printf '%s\n' $MYIPS | grep -c '\.') v6 $(printf '%s\n' $MYIPS | grep -c ':')"
    for n in "$ERP_HOST" "$ADMIN_HOST" "po07-wildcard-probe-$$.$ERP_HOST"; do
      A=$(getent ahosts "$n" 2>/dev/null | awk '{print $1}' | sort -u)
      if [ -z "$A" ]; then echo "$n: no record"; continue; fi
      m=no; for a in $A; do printf '%s\n' $MYIPS | grep -qxF "$a" && m=yes; done
      echo "$n: v4 $(printf '%s\n' $A | grep -c '\.') v6 $(printf '%s\n' $A | grep -c ':') address(es); points at this VPS: $m"
    done
    echo "(\"points at this VPS: no\" for a name that resolves means another server, or a CDN/proxy in front — which changes PLATFORM_TRUSTED_PROXY_HOPS)"
    if command -v dig >/dev/null 2>&1; then
      echo "NS of $ZONE: $(dig +short NS "$ZONE" | tr '\n' ' ')"
      echo "CNAME of $ERP_HOST: $(dig +short CNAME "$ERP_HOST")"
      echo "CNAME of $ADMIN_HOST: $(dig +short CNAME "$ADMIN_HOST")"
    else
      echo "dig not installed (NS/CNAME not checked from the VPS)"
    fi
  else
    echo "(skipped: pass <ERP_HOST> <ADMIN_HOST> as arguments)"
  fi

  h "F firewall and SSH (addresses other than loopback/wildcard masked)"
  $SUDO ufw status verbose 2>/dev/null | head -40 | maskip
  if command -v nft >/dev/null 2>&1; then
    $SUDO nft list ruleset 2>/dev/null | grep -E 'table|chain|policy|dport|accept|drop|reject' | head -60 | maskip
  else
    $SUDO iptables -S 2>/dev/null | head -40 | maskip
  fi
  $SUDO sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|allowusers|allowgroups|maxauthtries) ' | maskip
  echo "(a provider-level firewall configured in the hosting panel is not visible from inside the VPS)"

  h "G backups and scheduled jobs (commands redacted)"
  for u in root $(ls /home 2>/dev/null); do
    $SUDO crontab -l -u "$u" 2>/dev/null | grep -vE '^[[:space:]]*(#|$)' | red | redurl | maskip4 | sed "s/^/cron[$u]: /" | cut -c1-220
  done
  ls -1 /etc/cron.d 2>/dev/null | sed 's/^/cron.d: /'
  $SUDO grep -lE 'backup|pg_dump|restore' /etc/cron.d/* /etc/cron.daily/* 2>/dev/null | sed 's/^/backup-related cron file: /'
  echo "backup tools installed: $(for b in restic borg rclone age gpg pg_dump; do command -v "$b" >/dev/null 2>&1 && printf '%s ' "$b"; done)"
  for d in /var/backups /root/backups /home/*/backups /home/*/backup /home/*/*/backups; do
    $SUDO test -d "$d" || continue
    echo "dir $d: $($SUDO $LOW find "$d" -maxdepth 2 -type f 2>/dev/null | wc -l) file(s), $($SUDO $LOW du -sh "$d" 2>/dev/null | cut -f1), newest: $($SUDO ls -1t "$d" 2>/dev/null | head -1)"
  done
  for gh in /root/.gnupg /home/*/.gnupg; do
    $SUDO test -d "$gh" || continue
    echo "gpg home $gh: secret-key files $($SUDO find "$gh/private-keys-v1.d" -type f -name '*.key' 2>/dev/null | wc -l), public keyring files $($SUDO ls -1 "$gh" 2>/dev/null | grep -cE '^pubring\.(kbx|gpg)$')"
  done

  h "H usage evidence from nginx access logs (aggregate counts only; no address, no URL)"
  for L in $($SUDO grep -hoE '^[[:space:]]*access_log[[:space:]]+[^ ;]+' $CONF 2>/dev/null | awk '{print $2}' | grep -v '^off$' | sort -u); do
    $SUDO test -f "$L" || continue
    echo "-- $L ($($SUDO du -h "$L" | cut -f1))"
    $SUDO $LOW awk '{print substr($4, 2, 11)}' "$L" | uniq -c | tail -7 | sed 's/^/  requests on day: /'
    echo "  distinct client addresses in this file: $($SUDO $LOW awk '{print $1}' "$L" | sort -u | wc -l)"
    echo "  POST /login lines: $($SUDO grep -c '"POST /login' "$L")"
  done

  h "END of the read-only inspection"
}

main "$@" </dev/null
