# PO-07 staging kit — shared safety library. Sourced by every stage script.
# shellcheck shell=bash
#
# Modes (first argument of every stage script):
#   --plan     (default) prints every change the stage would make, on the fresh-install path. Touches nothing,
#              needs no root and runs anywhere (it is how the kit is reviewed on the PC).
#   --execute  makes the changes. Refuses unless: root on Linux; the target is the approved VPS (ERP unit and
#              release present, unit checksum = S0); inside the execution window with enough time left; the owner's
#              in-window go-ahead is recorded ($STATE_DIR/AUTHORIZED); the fresh S0 baseline is loaded; the previous
#              stage completed. Every mutation goes through act()/sctl()/put_file(), which refuse any target that is
#              not a staging object.
set -Eeuo pipefail
umask 077
export LC_ALL=C
KIT_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$KIT_HERE/config.sh"

MODE="plan"
case "${1:-}" in
  --execute) MODE="execute" ;;
  --plan|"") MODE="plan" ;;
  *) echo "usage: $0 [--plan|--execute]" >&2; exit 64 ;;
esac
STAGE="${STAGE:?STAGE must be set by the stage script}"

say()  { printf '%s [%s] %s\n' "$(date -u +%H:%M:%SZ)" "$STAGE" "$*"; }
plan() { printf '  [plan] %s\n' "$*"; }
# STOP: a §I stop condition or a failed check. Never rolls back by itself: the operator runs rollback.sh for the
# stage after reading the reason (each rollback step re-checks ownership before removing anything).
stop_now() {
  say "STOP: $*"
  if [ "$MODE" = execute ] && [ -d "$STATE_DIR" ]; then
    { date -u +%FT%TZ; echo "$STAGE: $*"; } >> "$STATE_DIR/STOPPED"
  fi
  say "Nothing further runs. Review, then: $KIT_DIR/rollback.sh $STAGE --execute (only with the owner's agreement)."
  exit 3
}
trap 'rc=$?; [ $rc -ne 0 ] && [ $rc -ne 3 ] && say "FAILED (exit $rc) at line $LINENO: treat as STOP"; exit $rc' ERR

# ---- staging allow-lists ---------------------------------------------------------------------------------------------
STAGING_PATH_RE='^(/srv/elite-po-staging|/etc/elite-po-staging|/var/lib/elite-po-staging|/run/elite-po-staging|/run/elite-po-pg|/etc/postgresql/16/po07ns|/var/lib/postgresql/16/po07ns|/etc/systemd/system/elite-po-[a-z-]+\.(service|socket|slice|timer)|/etc/systemd/system/postgresql@16-po07ns\.service\.d|/usr/local/sbin/elite-po-run|/etc/tmpfiles\.d/elite-po-staging\.conf)(/.*)?$'
STAGING_UNIT_RE='^(elite-po-(staging\.slice|staging-netns\.service|admin\.service|customer\.service|admin-proxy\.(socket|service)|customer-proxy\.(socket|service)|build\.service|install\.service)|postgresql@16-po07ns\.service)$'
assert_staging_path() { [[ "$1" =~ $STAGING_PATH_RE ]] || stop_now "refusing a non-staging path: $1"; }
assert_staging_unit() { [[ "$1" =~ $STAGING_UNIT_RE ]] || stop_now "refusing a non-staging unit: $1"; }

# act CMD...  — the only way a stage runs a mutating command.
act() {
  if [ "$MODE" = plan ]; then plan "$*"; return 0; fi
  say "run: $*"
  "$@"
}
# sctl VERB UNIT... — systemctl limited to staging units (daemon-reload is the one global verb; it starts nothing).
sctl() {
  local verb="$1"; shift
  case "$verb" in
    daemon-reload) act systemctl daemon-reload; return ;;
    start|stop|enable|disable|reset-failed|kill) ;;
    *) stop_now "sctl: verb not allowed: $verb" ;;
  esac
  local u args=()
  for u in "$@"; do
    case "$u" in --now|--no-block) args+=("$u"); continue ;; esac
    assert_staging_unit "$u"; args+=("$u")
  done
  act systemctl "$verb" "${args[@]}"
}
# put_file DEST MODE OWNER:GROUP SRC — install a kit file. Same content already there: no-op. Different content
# there: STOP (never overwrite something the kit did not write, never silently change a reviewed file).
put_file() {
  local dest="$1" mode="$2" og="$3" src="$4"
  assert_staging_path "$dest"
  [ -f "$src" ] || stop_now "kit file missing: $src"
  if [ "$MODE" = plan ]; then plan "install -m $mode -o ${og%%:*} -g ${og##*:} $(basename "$src") -> $dest"; return 0; fi
  if [ -e "$dest" ]; then
    if cmp -s "$src" "$dest"; then say "unchanged: $dest"; return 0; fi
    stop_now "$dest exists with different content (not written by this kit version)"
  fi
  act install -m "$mode" -o "${og%%:*}" -g "${og##*:}" "$src" "$dest"
}
# safe_rm PATH... — recursive removal of a staging path only: allow-listed, absent is fine, never through a symlink.
safe_rm() {
  local p
  for p in "$@"; do
    assert_staging_path "$p"
    [ "$MODE" = execute ] && [ ! -e "$p" ] && [ ! -L "$p" ] && { say "absent: $p"; continue; }
    [ "$MODE" = execute ] && [ "$(realpath -m -- "$p")" != "$p" ] && stop_now "refusing $p: it resolves elsewhere"
    act rm -rf --one-file-system -- "$p"
  done
}
mkdir_staging() { # PATH MODE OWNER:GROUP
  assert_staging_path "$1"
  if [ "$MODE" = execute ] && [ -d "$1" ]; then
    local cur; cur="$(stat -c '%a %U:%G' "$1")"
    [ "$cur" = "${2#0} $3" ] || stop_now "$1 exists as $cur, expected ${2#0} $3"
    say "exists: $1 ($cur)"; return 0
  fi
  act install -d -m "$2" -o "${3%%:*}" -g "${3##*:}" "$1"
}
# check DESCRIPTION CMD... — a verification. In plan mode it is listed, not run.
check() {
  local d="$1"; shift
  if [ "$MODE" = plan ]; then plan "verify: $d"; return 0; fi
  if "$@"; then say "ok: $d"; else stop_now "check failed: $d"; fi
}

# ---- execute-mode gates ----------------------------------------------------------------------------------------------
now_epoch() { date -u +%s; }
require_window() {
  local start end now left need="${1:-$MIN_MINUTES_LEFT}"
  start="$(date -u -d "$WINDOW_START_UTC" +%s)"; end="$(date -u -d "$WINDOW_END_UTC" +%s)"; now="$(now_epoch)"
  [ "$now" -ge "$start" ] || stop_now "before the execution window (Saudi now $(TZ=Asia/Riyadh date '+%F %H:%M'))"
  [ "$now" -lt "$end" ] || stop_now "the execution window has ended (Saudi now $(TZ=Asia/Riyadh date '+%F %H:%M'))"
  left=$(( (end - now) / 60 ))
  [ "$left" -ge "$need" ] || stop_now "only $left minutes left in the window; this stage needs $need"
  say "window ok: Saudi $(TZ=Asia/Riyadh date '+%F %H:%M'), $left minutes left"
}
require_vps() {
  [ "$(uname -s)" = Linux ] || stop_now "not Linux"
  [ "$(id -u)" -eq 0 ] || stop_now "must run as root"
  systemctl cat "$ERP_UNIT" >/dev/null 2>&1 || stop_now "this is not the approved VPS ($ERP_UNIT absent)"
  [ -L "$ERP_ROOT/current" ] || stop_now "this is not the approved VPS ($ERP_ROOT/current absent)"
  local sum; sum="$(cat /etc/systemd/system/"$ERP_UNIT" /etc/systemd/system/"$ERP_UNIT".d/*.conf | sha256sum | cut -c1-16)"
  [ "$sum" = "$B_ERP_UNIT_SUM" ] || stop_now "ERP unit checksum $sum differs from the S0 baseline"
}
load_baseline() {
  [ -f "$STATE_DIR/baseline.env" ] || stop_now "no fresh S0 baseline ($STATE_DIR/baseline.env)"
  # shellcheck disable=SC1091
  . "$STATE_DIR/baseline.env"
  local age=$(( $(now_epoch) - B_EPOCH ))
  [ "$age" -lt 14400 ] || stop_now "the S0 baseline is older than 4 hours; re-run S0"
}
require_authorized() {
  [ -f "$STATE_DIR/AUTHORIZED" ] || stop_now "no in-window owner go-ahead recorded ($STATE_DIR/AUTHORIZED)"
  grep -q "^window=$WINDOW_START_UTC/$WINDOW_END_UTC$" "$STATE_DIR/AUTHORIZED" || stop_now "AUTHORIZED is not for this window"
  grep -q "^stages=.*\b$STAGE\b" "$STATE_DIR/AUTHORIZED" || stop_now "$STAGE is not in the recorded authorization"
  [ ! -f "$STATE_DIR/STOPPED" ] || stop_now "a previous STOP is recorded ($STATE_DIR/STOPPED); resolve it with the owner first"
}
require_done() { [ "$MODE" = plan ] && return 0; [ -f "$STATE_DIR/$1.done" ] || stop_now "prerequisite $1 not completed"; }
mark_done() {
  if [ "$MODE" = plan ]; then plan "mark $STAGE done"; return 0; fi
  date -u +%FT%TZ > "$STATE_DIR/$STAGE.done"; say "$STAGE COMPLETE"
}

# ---- §I shared-service guard -----------------------------------------------------------------------------------------
memavail_mb() { awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo; }
swapused_mb() { awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print int((t-f)/1024)}' /proc/meminfo; }
load1() { cut -d' ' -f1 /proc/loadavg; }
diskfree_gb() { df -BG --output=avail / | tail -1 | tr -dc 0-9; }
tcp_set() { ss -ltnH | awk '{print $4}' | sort -u; }
unix_set() { ss -lxH | awk '{print $5}' | grep '^/' | sort -u; }
running_units() { systemctl list-units --type=service --state=running --no-legend --plain --no-pager | awk '{print $1}' | sort; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN {exit !(a > b)}'; }

STAGE_SWAP0=""
# guard_shared [EXTRA_UNIX_SOCKET...] — §I items 1–5 and 8. Extra sockets: the ones this kit is allowed to have added.
guard_shared() {
  [ "$MODE" = plan ] && { plan "verify §I: ERP PID/active, S0 units, nginx + main checksums, listener sets, resources, ERP public check"; return 0; }
  local f=()
  [ "$(systemctl is-active "$ERP_UNIT")" = active ] || f+=("ERP unit not active")
  [ "$(systemctl show -p MainPID --value "$ERP_UNIT")" = "$B_ERP_MAINPID" ] || f+=("ERP MainPID changed")
  [ "$(pgrep -u "$ERP_USER" -f next-server | sort | tr '\n' ' ')" = "$B_ERP_NEXT_PIDS" ] || f+=("ERP next-server PID changed")
  # On-demand system units (they exit when idle or when root's SSH sessions close) are reported, not a STOP.
  # Every other S0 unit — every application, database, web server, PHP pool, container runtime — must still run.
  local missing ondemand u
  missing="" ondemand=""
  for u in $(comm -23 "$STATE_DIR/baseline-units.txt" <(running_units)); do
    case " $ONDEMAND_UNITS " in *" $u "*) ondemand="$ondemand$u " ;; *) missing="$missing$u " ;; esac
  done
  [ -z "$ondemand" ] || say "note: on-demand unit(s) not running now (not a stop condition): $ondemand"
  [ -z "$missing" ] || f+=("S0 units no longer running: $missing")
  [ "$(find /etc/nginx -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)" = "$B_NGINX_TREE" ] || f+=("nginx tree checksum changed")
  [ "$(sha256sum /etc/postgresql/16/main/postgresql.conf | cut -c1-16)" = "$B_MAIN_PGCONF" ] || f+=("main postgresql.conf changed")
  [ "$(sha256sum /etc/postgresql/16/main/pg_hba.conf | cut -c1-16)" = "$B_MAIN_HBA" ] || f+=("main pg_hba.conf changed")
  [ "$(head -1 /var/lib/postgresql/16/main/postmaster.pid)" = "$B_MAIN_PID" ] || f+=("main PostgreSQL PID changed")
  local newtcp; newtcp="$(comm -13 "$STATE_DIR/baseline-tcp.txt" <(tcp_set) | tr '\n' ' ')"
  if [ -n "$newtcp" ]; then
    local who="" a
    for a in $newtcp; do who="$who $a=$(ss -ltnpH "sport = :${a##*:}" | grep -o 'users:(("[^"]*",pid=[0-9]*' | head -1 | sed 's/users:(("//; s/",pid=/#/')"; done
    f+=("new host TCP listener(s):$who")
  fi
  local allowed s newunix
  # The kit's own filesystem sockets are the only additions allowed (S9 also checks the proxy sockets' modes).
  allowed="$(printf '%s\n' "$PG_RUN/.s.PGSQL.$PG_PORT" "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock" "$@" | sort -u)"
  newunix="$(comm -13 "$STATE_DIR/baseline-unix.txt" <(unix_set) | while read -r s; do printf '%s\n' "$allowed" | grep -qxF "$s" || printf '%s ' "$s"; done)"
  [ -z "$newunix" ] || f+=("unexpected new unix listener(s): $newunix")
  local m; m="$(memavail_mb)"; [ "$m" -ge "$STOP_MEMAVAIL_MB" ] || f+=("MemAvailable ${m}MB < ${STOP_MEMAVAIL_MB}MB")
  local sw; sw="$(swapused_mb)"; [ -n "$STAGE_SWAP0" ] && [ $((sw - STAGE_SWAP0)) -gt "$STOP_SWAP_GROWTH_MB" ] && f+=("swap grew $((sw - STAGE_SWAP0))MB this stage")
  local d; d="$(diskfree_gb)"; [ "$d" -ge "$STOP_DISK_FREE_GB" ] || f+=("disk free ${d}G < ${STOP_DISK_FREE_GB}G")
  if gt "$(load1)" "$STOP_LOAD1"; then
    local i high=1
    for i in $(seq 1 10); do sleep 30; gt "$(load1)" "$STOP_LOAD1" || { high=0; break; }; done
    [ "$high" -eq 1 ] && f+=("1-minute load above $STOP_LOAD1 for 5 minutes")
  fi
  local code; code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Host: $ERP_HOST" -H 'X-Forwarded-Proto: https' -H "X-Forwarded-Host: $ERP_HOST" "http://127.0.0.1:$ERP_PORT/login")"
  [ "$code" = 200 ] || f+=("ERP loopback /login answered $code")
  [ "$(erp_public_status)" = "$B_ERP_PUBLIC_STATUS" ] || f+=("ERP public status differs from S0")
  [ "$(erp_cert_fp)" = "$B_ERP_CERT_FP" ] || f+=("ERP certificate fingerprint differs from S0")
  if [ ${#f[@]} -gt 0 ]; then stop_now "§I: $(printf '%s; ' "${f[@]}")"; fi
  say "§I guard ok (MemAvailable ${m}MB, swap ${sw}MB, load $(load1), disk ${d}G)"
}
erp_public_status() { curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$ERP_HOST/login"; }
erp_cert_fp() { openssl s_client -connect "$ERP_HOST:443" -servername "$ERP_HOST" </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2; }
start_thresholds() { # [MEMAVAIL_MB]
  [ "$MODE" = plan ] && { plan "verify start thresholds (MemAvailable ≥ ${1:-$START_MEMAVAIL_MB}MB, load1 ≤ $START_LOAD1, disk ≥ ${START_DISK_FREE_GB}G)"; return 0; }
  local need="${1:-$START_MEMAVAIL_MB}" m d
  m="$(memavail_mb)"; d="$(diskfree_gb)"
  [ "$m" -ge "$need" ] || stop_now "start threshold: MemAvailable ${m}MB < ${need}MB"
  gt "$(load1)" "$START_LOAD1" && stop_now "start threshold: load1 $(load1) > $START_LOAD1"
  [ "$d" -ge "$START_DISK_FREE_GB" ] || stop_now "start threshold: disk free ${d}G < ${START_DISK_FREE_GB}G"
  say "start thresholds ok (MemAvailable ${m}MB, load $(load1), disk ${d}G)"
}

# stage_begin [PREREQ_STAGE] [MIN_MINUTES] — common preamble.
stage_begin() {
  say "==== $STAGE ($MODE) kit $KIT_VERSION ===="
  if [ "$MODE" = execute ]; then
    [ -d "$STATE_DIR" ] || stop_now "no state directory $STATE_DIR (kit not installed)"
    load_baseline
    require_vps
    require_authorized
    require_window "${2:-$MIN_MINUTES_LEFT}"
    [ -z "${1:-}" ] || require_done "$1"
    if [ -f "$STATE_DIR/$STAGE.done" ]; then say "$STAGE already completed at $(cat "$STATE_DIR/$STAGE.done"): re-checking only"; fi
    mkdir -p "$STATE_DIR/logs"
    exec > >(tee -a "$STATE_DIR/logs/$STAGE-$(date -u +%Y%m%dT%H%M%SZ).log") 2>&1
    STAGE_SWAP0="$(swapused_mb)"
  fi
}
# Peer psql on the STAGING cluster only: its own 0700 socket directory and port. Never main (main's socket is
# /var/run/postgresql:5432). Every call first proves the server is the staging cluster.
spsql() { # DBNAME, SQL on stdin
  [ "$MODE" = plan ] && { plan "psql (peer, $PG_USER, -h $PG_RUN -p $PG_PORT, db $1): $(head -c 160 | tr '\n' ' ')"; return 0; }
  runuser -u "$PG_USER" -- psql -X -q -At -v ON_ERROR_STOP=1 -h "$PG_RUN" -p "$PG_PORT" -d "$1"
}
# run_probe ENV PROFILE "ANSWER_PORTS" — V-NET/V-SBX inside the sandbox. PROFILE: tool (elite-po-run as used for
# migrations and the bootstrap) | admin | customer (that unit's own extra paths and limits added).
run_probe() {
  local env="$1" profile="$2" answer="$3" cfg prof=()
  [ "$MODE" = plan ] && { plan "V-NET/V-SBX probe: elite-po-run --env $env ${profile/tool/} probe (profile $profile; must answer: $answer)"; return 0; }
  cfg="$(node -e '
    const fs = require("fs"); const [tcpF, unixF, profile, answer, chromium] = process.argv.slice(1);
    const tcp = fs.readFileSync(tcpF, "utf8").split("\n").filter(Boolean);
    const ports = [...new Set(tcp.map((l) => Number(l.slice(l.lastIndexOf(":") + 1))))].sort((a, b) => a - b);
    const ans = answer.split(" ").filter(Boolean).map(Number);
    for (const p of ans) if (!ports.includes(p)) ports.push(p);
    const hostAddrs = tcp.map((l) => ({ host: l.slice(0, l.lastIndexOf(":")).replace(/^\[|\]$/g, "").replace(/%.*$/, ""), port: Number(l.slice(l.lastIndexOf(":") + 1)) }))
      .filter((a) => !/^(\*|0\.0\.0\.0|::|127\.|::1$)/.test(a.host));
    const unixPaths = fs.readFileSync(unixF, "utf8").split("\n").filter((l) => l.startsWith("/"));
    console.log(JSON.stringify({ profile, tcpPorts: ports, answer: ans, hostAddrs, unixPaths, chromium }));
  ' "$STATE_DIR/baseline-tcp.txt" "$STATE_DIR/baseline-unix.txt" "$profile" "$answer" "$CHROMIUM")"
  [ "$profile" = tool ] || prof=(--profile "$profile")
  local rc=0
  { printf 'const CFG = %s;\n' "$cfg"; cat "$KIT_HERE/probes/vnet-probe.mjs"; } |
    /usr/local/sbin/elite-po-run --env "$env" "${prof[@]}" probe > "$STATE_DIR/logs/$STAGE-probe-$profile.txt" 2>&1 || rc=$?
  grep -E '^(FAIL|VNET-SUMMARY)' "$STATE_DIR/logs/$STAGE-probe-$profile.txt" || true
  [ "$rc" -eq 0 ] || stop_now "V-NET/V-SBX ($profile) failed: see $STATE_DIR/logs/$STAGE-probe-$profile.txt"
  say "V-NET/V-SBX ($profile): all checks passed"
}
assert_staging_cluster() {
  [ "$MODE" = plan ] && { plan "verify: the peer connection is cluster_name=$PG_VER/$CLUSTER, port $PG_PORT, data /var/lib/postgresql/$PG_VER/$CLUSTER"; return 0; }
  local got
  got="$(printf "select current_setting('cluster_name')||'|'||current_setting('port')||'|'||current_setting('data_directory');\n" | spsql postgres)"
  [ "$got" = "$PG_VER/$CLUSTER|$PG_PORT|/var/lib/postgresql/$PG_VER/$CLUSTER" ] || stop_now "the peer connection is not the staging cluster ($got)"
}

# ===== CI REHEARSAL OVERRIDES — appended by tools/render-ci.sh; this file is NEVER installed on the VPS. =====
# A GitHub runner has no live ERP, nginx, cluster main or execution window, so these four gates are replaced. Every
# allow-list (act, sctl, put_file, safe_rm, mkdir_staging) and every stage check above is the kit's own, unchanged.
require_vps() {
  [ "$(uname -s)" = Linux ] && [ "$(id -u)" -eq 0 ] || stop_now "CI: root on Linux required"
  [ "${GITHUB_ACTIONS:-}" = true ] && [ -n "${RUNNER_TEMP:-}" ] || stop_now "the CI rehearsal overrides run only on a GitHub Actions runner"
}
require_window() { say "CI rehearsal: no execution window"; }
require_authorized() { [ ! -f "$STATE_DIR/STOPPED" ] || stop_now "a previous STOP is recorded ($STATE_DIR/STOPPED)"; }
load_baseline() { [ -f "$STATE_DIR/baseline.env" ] || stop_now "no CI baseline"; . "$STATE_DIR/baseline.env"; }
guard_shared() { # the §I items a runner has: no new host TCP listener, only the kit's own unix sockets, memory and disk
  [ "$MODE" = plan ] && { plan "verify §I (CI subset: listeners, memory, disk)"; return 0; }
  local f=() newtcp newunix allowed m d
  newtcp="$(comm -13 "$STATE_DIR/baseline-tcp.txt" <(tcp_set) | tr '\n' ' ')"
  [ -z "$newtcp" ] || f+=("new host TCP listener(s): $newtcp")
  allowed="$(printf '%s\n' "$PG_RUN/.s.PGSQL.$PG_PORT" "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock" "$@" | sort -u)"
  newunix="$(comm -13 "$STATE_DIR/baseline-unix.txt" <(unix_set) | while read -r s; do printf '%s\n' "$allowed" | grep -qxF "$s" || printf '%s ' "$s"; done)"
  [ -z "$newunix" ] || f+=("unexpected new unix listener(s): $newunix")
  m="$(memavail_mb)"; [ "$m" -ge "$STOP_MEMAVAIL_MB" ] || f+=("MemAvailable ${m}MB")
  d="$(diskfree_gb)"; [ "$d" -ge "$STOP_DISK_FREE_GB" ] || f+=("disk free ${d}G")
  if [ ${#f[@]} -gt 0 ]; then stop_now "§I (CI subset): $(printf '%s; ' "${f[@]}")"; fi
  say "§I guard (CI subset) ok (MemAvailable ${m}MB, disk ${d}G, no new host listener)"
}
