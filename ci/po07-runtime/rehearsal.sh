#!/usr/bin/env bash
# PO-07 CI rehearsal of S1 → S9 (S6 = S6-R) and the full rollback, on a GitHub-hosted runner, as root.
#   sudo -E bash rehearsal.sh <dir holding the verified archive and ARTIFACT.json> <run id>
# Uses ci/po07-runtime/kit/: the private staging kit rendered with fictional values (tools/render-ci.sh): the SAME
# stage scripts, units, wrapper and probes as on the VPS; only the VPS identity check and the shared-service guard are
# replaced (see the end of kit/lib.sh). The window, authorization, S0-age and STOP gates and the D24 recovery state are
# the kit's own: this script records a CI-window authorization, a fresh baseline and the kit manifest, as pc-kit.sh does.
# Fictional data only; nothing leaves the runner.
set -Eeuo pipefail
export LC_ALL=C
[ "${GITHUB_ACTIONS:-}" = true ] && [ "$(id -u)" -eq 0 ] || { echo "rehearsal.sh: GitHub Actions runner, as root, only" >&2; exit 64; }
ART="$(realpath "${1:?artifact dir}")"; RUN_ID="${2:?run id}"
: "${PINNED_ARCHIVE_SHA256:?the owner-approved archive SHA-256 (workflow env)}"
HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck disable=SC1091
. "$HERE/kit/config.sh"
A="po07-staging-build-${APPROVED_SHA:0:12}.tar.gz"
step() { echo "::group::$1"; }
end() { echo "::endgroup::"; }
fail() { echo "::endgroup::"; echo "::error::$*"; for f in "$STATE_DIR"/logs/*.log; do [ -f "$f" ] && { echo "--- $f (tail)"; tail -25 "$f"; }; done; grep -h "^DIAG" "$STATE_DIR"/logs/*probe*.txt 2>/dev/null || true; exit 1; }

step "the stand-in web-server group; the directories the sandbox hides, as on the VPS"
getent group "$NGINX_GROUP" >/dev/null || groupadd --system "$NGINX_GROUP"
# The units' TemporaryFileSystem= covers /var/www, /var/backups, /var/spool and /opt (they exist on the VPS); /opt/google
# is bound read-only for Chromium. Create whichever a runner lacks (empty), so the reviewed units start unchanged.
for d in /var/www /var/backups /var/spool /opt; do [ -d "$d" ] || install -d -m 0755 "$d"; done
[ -x /opt/google/chrome/chrome ] || fail "no Google Chrome under /opt/google (the customer unit binds it read-only)"
end

step "a shared web server (CI only, before the CI S0): nginx, most permissive worker identity, and a default server"
DEBIAN_FRONTEND=noninteractive apt-get update -qq > /dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx > /dev/null || fail "apt-get install nginx"
sed -i -E 's/^user [^;]+;/user root;/' /etc/nginx/nginx.conf   # CI design: the most permissive worker identity (any root process can reach a root-owned socket)
rm -f /etc/nginx/sites-enabled/default
printf 'server {\n  listen 80 default_server;\n  listen 443 ssl default_server;\n  ssl_reject_handshake on;\n  return 444;\n}\n' > /etc/nginx/sites-enabled/00-po07-ci-default.conf
nginx -t && systemctl restart nginx.service || fail "nginx did not start"
echo "nginx $(nginx -v 2>&1 | cut -d/ -f2), workers: $(ps -o user= --ppid "$(systemctl show -p MainPID --value nginx.service)" | sort -u | tr '\n' ' ')"
end

step "a shared PostgreSQL cluster 'main' (CI only, before the CI S0): it must stay untouched by every staging step"
pg_lsclusters -h | awk '$1 == 16 && $2 == "main"' | grep -q . || pg_createcluster 16 main > /dev/null || fail "pg_createcluster 16 main"
systemctl start postgresql@16-main.service && systemctl is-active --quiet postgresql@16-main.service || fail "cluster main did not start"
main_state() { printf '%s %s %s %s\n' "$(head -1 /var/lib/postgresql/16/main/postmaster.pid)" "$(sha256sum /etc/postgresql/16/main/postgresql.conf | cut -c1-16)" \
  "$(sha256sum /etc/postgresql/16/main/pg_hba.conf | cut -c1-16)" "$(systemctl show -p TasksMax --value postgresql@16-main.service)"; }
MAIN0="$(main_state)"; echo "main: pid conf hba TasksMax = $MAIN0"
main_unchanged() { [ "$(main_state)" = "$MAIN0" ] || fail "cluster main changed during '$1': $(main_state) (was $MAIN0)"; echo "ok: cluster main unchanged after $1 (same postmaster PID, config, pg_hba, no task cap)"; }
end

step "S12's object-storage stand-in (CI only, before the CI S0, like the external provider): MinIO at 127.0.0.2, fictional root key"
# NOT Backblaze B2: a local substitute with fictional credentials. It listens on 127.0.0.2 only, so the uploader's
# CI allowance (127.0.0.2/32) never opens 127.0.0.1, where cluster main listens (the uploader must not reach it).
[ -x "${PO07_S3BIN:-}/minio" ] && [ -x "$PO07_S3BIN/mc" ] || fail "the stand-in binaries were not built (PO07_S3BIN)"
MR="$(openssl rand -hex 16)"; install -d -m 0700 "$RUNNER_TEMP/minio-data"
systemd-run --quiet --unit=po07-ci-objstore --setenv=MINIO_ROOT_USER=ci-root --setenv=MINIO_ROOT_PASSWORD="$MR" \
  "$PO07_S3BIN/minio" server --quiet --address 127.0.0.2:9000 --console-address 127.0.0.2:9001 "$RUNNER_TEMP/minio-data" || fail "the stand-in did not start"
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.2:9000/minio/health/live)" = 200 ] && break; sleep 1; done
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.2:9000/minio/health/live)" = 200 ] || fail "the stand-in is not healthy"
echo "stand-in: $("$PO07_S3BIN/minio" --version | head -1) at 127.0.0.2:9000 (not B2; fictional credentials)"
end

step "install the rendered kit at $KIT_DIR (root 0700) and take the CI S0"
install -d -m 0700 "$KIT_DIR" "$STATE_DIR" "$STATE_DIR/logs"
cp -a "$HERE/kit/." "$KIT_DIR/"; chmod -R go-rwx "$KIT_DIR"
ss -ltnH | awk '{print $4}' | sort -u > "$STATE_DIR/baseline-tcp.txt"
ss -lxH | awk '{print $5}' | grep '^/' | sort -u > "$STATE_DIR/baseline-unix.txt"
systemctl list-units --type=service --state=running --no-legend --plain --no-pager | awk '{print $1}' | sort > "$STATE_DIR/baseline-units.txt"
sum16() { sha256sum | cut -c1-16; }
{ echo "B_TIME=$(date -u +%FT%TZ)"; echo "B_EPOCH=$(date -u +%s)"
  echo "B_LINKS=$(ip -o link | sed -E 's/ (link\/ether|brd) [0-9a-f:]+//g' | sum16)"; echo "B_ROUTES4=$(ip route | sum16)"
  echo "B_ROUTES6=$(ip -6 route | sum16)"; echo "B_UFW=$(ufw status verbose 2>/dev/null | sum16)"; echo "B_SWAP_MB=0"; } > "$STATE_DIR/baseline.env"
echo "host TCP listeners before S1: $(tr '\n' ' ' < "$STATE_DIR/baseline-tcp.txt")"
# what pc-kit.sh upload records: the kit manifest and the owner go-ahead for this window (here: the CI window)
(cd "$KIT_DIR" && find . \( -path ./state -o -path ./incoming \) -prune -o -type f -print | LC_ALL=C sort | xargs sha256sum) > "$STATE_DIR/KIT.sha256"
printf 'window=%s/%s\nstages=%s\nrecorded=%s\nsha=%s\nowner_instruction=%s\n' "$WINDOW_START_UTC" "$WINDOW_END_UTC" "S1 S2 S3 S4 S5 S6 S7 S8 S9 S9b" \
  "$(date -u +%FT%TZ)" "$APPROVED_SHA" "CI rehearsal go-ahead (fictional; GitHub-hosted runner only)" > "$STATE_DIR/AUTHORIZED"
echo "kit manifest: $(wc -l < "$STATE_DIR/KIT.sha256") files, digest $(sha256sum < "$STATE_DIR/KIT.sha256" | cut -c1-16)"
end

step "receive the verified archive as pc-kit.sh artifact-upload does (K2: tools/artifact-receive.sh), and its expected values"
ASHA="$(sha256sum "$ART/$A" | cut -d' ' -f1)"
[ "$ASHA" = "$PINNED_ARCHIVE_SHA256" ] || fail "archive SHA-256 $ASHA is not the owner-approved $PINNED_ARCHIVE_SHA256"
RUN_ID="$RUN_ID" A="$A" ASHA="$ASHA" node -e '
  const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), e = process.env;
  const kv = { run_id: e.RUN_ID, artifact_id: "ci", archive: e.A, archive_sha256: e.ASHA, zip_sha256: "ci", source_sha: a.source.sha, source_tree: a.source.tree,
    build_id: a.build_id, workflow_commit: a.workflow.commit, node: a.runtime.node, next: a.runtime.next, npm: a.runtime.npm, max_glibc: a.native_modules.max_glibc,
    files: a.contents.files, symlinks: a.contents.symlinks, lockfile_sha256: a.inputs.lockfile_sha256, attested: "ci-pinned-sha256", fetched_at: new Date().toISOString() };
  process.stdout.write(Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");' "$ART/ARTIFACT.json" > "$STATE_DIR/ARTIFACT.expected.tmp"
chmod 0600 "$STATE_DIR/ARTIFACT.expected.tmp"
xp() { sed -n "s/^$1=//p" "$STATE_DIR/ARTIFACT.expected.tmp"; }
install -d -m 0700 "$INCOMING_DIR"
bash "$KIT_DIR/tools/artifact-receive.sh" "$INCOMING_DIR" "$RUN_ID" "$A" "$ASHA" "$(stat -c %s "$ART/$A")" "$(xp source_sha)" "$(xp source_tree)" "$(xp build_id)" < "$ART/$A" ||
  fail "artifact-receive refused the approved archive"
[ "$(stat -c '%U %a' "$INCOMING_DIR/run$RUN_ID/$A")" = "root 600" ] && [ -f "$INCOMING_DIR/run$RUN_ID/$A.verified" ] || fail "the received archive is not root 0600 with its .verified record"
mv "$STATE_DIR/ARTIFACT.expected.tmp" "$STATE_DIR/ARTIFACT.expected"   # written only after the VPS-side verification, as pc-kit does
end

run_stage() { step "$1 --execute"; bash "$KIT_DIR/$1.sh" --execute || fail "$1 failed"; end; }
for s in s1_users s2_slice_netns s3_pgcluster s4_roles_db s5_clone; do run_stage "$s"; done
# D24: the VPS state after the failed on-VPS S6, every refusal, two failed recoveries, then the successful S6-R
# shellcheck source=d24-recovery.sh
. "$HERE/d24-recovery.sh"
step "S6-R again, at once (re-entrant: must re-check the installed build, not reinstall)"
out="$(bash "$KIT_DIR/s6r_install_artifact.sh" --execute 2>&1)" || { echo "$out" | tail -30; fail "S6-R re-run failed"; }
echo "$out" | grep -q "already installed" || fail "S6-R re-run did not recognise the installed build"
echo "$out" | grep -E "already installed|installed: every|S6 COMPLETE" | head -5
end
for s in s7_envfiles s8_vnet_migrate s9_units_start; do run_stage "$s"; done
step "S9: the customer service rendered one and two concurrent PDFs within its limits (D31)"
grep -E "^(PASS|FAIL|TASKS|MEMORY|CPU|PDF-LOAD)" "$STATE_DIR/logs/S9-pdf-load.txt" || fail "no PDF load record"
grep -q "^PDF-LOAD pass=[0-9]* fail=0$" "$STATE_DIR/logs/S9-pdf-load.txt" || fail "the PDF load test did not pass"
end

# S11a → S10 → S11b, the fail-closed nginx sequence with Basic Auth and trusted TLS, R1–R12 through nginx
# shellcheck source=nginx-rehearsal.sh
. "$HERE/nginx-rehearsal.sh"

step "K3: installed-file reconciliation on the real installed files (the 24 Nov 2026 stale-wrapper S9 STOP)"
W=/usr/local/sbin/elite-po-run
rep() { bash "$KIT_DIR/tools/reconcile.sh" --report; }
expect_stop() { # LABEL PATTERN CMD... — must STOP for that reason; the expected STOP record is then set aside (harness)
  local l="$1" p="$2"; shift 2; local o rc=0; o="$("$@" 2>&1)" || rc=$?
  [ "$rc" -ne 0 ] && grep -q -- "$p" <<< "$o" || { printf '%s\n' "$o" | tail -15; fail "K3: $l: no STOP for '$p'"; }
  [ ! -f "$STATE_DIR/STOPPED" ] || mv "$STATE_DIR/STOPPED" "$STATE_DIR/STOPPED.ci-expected-k3-$(date +%s%N)"
  echo "ok: $l"
}
gate() { bash -c 'STAGE=S9; . "$1/lib.sh" --execute; load_baseline; installed_files_gate' _ "$KIT_DIR"; }
rep | tee "$STATE_DIR/logs/ci-reconcile-1.txt"
grep -qE '^RECONCILE-REPORT listed=[0-9]+ attention=0' "$STATE_DIR/logs/ci-reconcile-1.txt" || fail "K3: after S9 every installed file must be UNCHANGED"
install -m 0700 -o root -g root "$KIT_DIR/units/history/wrapper@kit-1" "$W"   # the VPS state of 24 Nov 2026
grep -q "^OUTDATED(kit-1) .* $W$" <<< "$(rep)" || fail "K3: the kit-1 wrapper is not reported OUTDATED(kit-1)"
echo "ok: the kit-1 wrapper is reported OUTDATED(kit-1)"
expect_stop "a real stage (S7 re-check) refuses to run on the stale wrapper" "OUTDATED(kit-1) $W" bash "$KIT_DIR/s7_envfiles.sh" --execute
expect_stop "reconcile without RECONCILE in the owner's authorization is refused" "RECONCILE is not in" bash "$KIT_DIR/tools/reconcile.sh" --execute "$W"
[ "$(sha256sum < "$W")" = "$(sha256sum < "$KIT_DIR/units/history/wrapper@kit-1")" ] || fail "K3: a refused reconcile changed the wrapper"
sed -i 's/^stages=\(.*\)$/stages=\1 RECONCILE/' "$STATE_DIR/AUTHORIZED"   # the CI window's authorization (on the VPS: the owner's)
expect_stop "reconcile with no file named is refused (there is no 'all')" "name each file" bash "$KIT_DIR/tools/reconcile.sh" --execute
expect_stop "reconcile of a file the list does not name is refused" "not in units/installed-files.tsv" bash "$KIT_DIR/tools/reconcile.sh" --execute /etc/passwd
bash "$KIT_DIR/tools/reconcile.sh" --execute "$W" || fail "K3: the authorized reconcile of the OUTDATED wrapper failed"
cmp -s "$W" "$KIT_DIR/units/elite-po-run" && [ "$(stat -c '%a %U:%G' "$W")" = "700 root:root" ] || fail "K3: the wrapper is not the kit's after reconcile"
prev="$(ls -d "$STATE_DIR"/installed-previous/*/ | tail -1)usr/local/sbin/elite-po-run"
cmp -s "$prev" "$KIT_DIR/units/history/wrapper@kit-1" && [ "$(stat -c %a "$prev")" = 400 ] || fail "K3: the previous (kit-1) version was not kept read-only"
grep -q "$W OUTDATED(kit-1) -> kit" "$STATE_DIR/RECONCILED.log" || fail "K3: no RECONCILED.log record"
gate > /dev/null || fail "K3: the gate still refuses after the reconcile"
echo "ok: the authorized reconcile replaced the OUTDATED wrapper, kept kit-1 read-only, logged it; the gate passes"
bash "$KIT_DIR/tools/reconcile.sh" --execute --restore "$W" || fail "K3: restore failed"
cmp -s "$W" "$KIT_DIR/units/history/wrapper@kit-1" || fail "K3: restore did not put the previous version back"
bash "$KIT_DIR/tools/reconcile.sh" --execute "$W" > /dev/null || fail "K3: reconcile after restore failed"
echo "ok: restore puts the kept previous version back; reconcile again returns to the kit's"
{ cat "$KIT_DIR/units/elite-po-run"; echo "# a local edit"; } > "$RUNNER_TEMP/edited"; install -m 0700 -o root -g root "$RUNNER_TEMP/edited" "$W"
expect_stop "reconcile never replaces a MODIFIED file (owner review)" "is MODIFIED" bash "$KIT_DIR/tools/reconcile.sh" --execute "$W"
cmp -s "$W" "$RUNNER_TEMP/edited" || fail "K3: the refused reconcile changed the MODIFIED file"
install -m 0700 -o root -g root "$KIT_DIR/units/elite-po-run" "$W"   # harness: back to the kit's copy
install -d -m 0755 /etc/systemd/system/elite-po-admin.service.d
printf '[Service]\nReadWritePaths=/srv\n' > /etc/systemd/system/elite-po-admin.service.d/override.conf
expect_stop "an unexpected drop-in for a staging unit blocks every stage" "UNEXPECTED /etc/systemd/system/elite-po-admin.service.d" gate
rm -r /etc/systemd/system/elite-po-admin.service.d; systemctl daemon-reload
PT="/etc/systemd/system/postgresql@16-$CLUSTER.service.d/20-tasks.conf"; mv "$PT" "$RUNNER_TEMP/20-tasks.conf.aside"
grep -q "^PROPOSED .* $PT$" <<< "$(rep)" || fail "K3: an absent proposed file is not reported PROPOSED"
gate > /dev/null || fail "K3: an absent PROPOSED file must not block a stage"
expect_stop "a completed stage never installs a proposed file by itself (S3 re-check)" "S3 is complete and $PT is not installed" bash "$KIT_DIR/s3_pgcluster.sh" --execute
mv "$RUNNER_TEMP/20-tasks.conf.aside" "$PT"
rep | tee "$STATE_DIR/logs/ci-reconcile-2.txt" | tail -1; grep -q 'attention=0' "$STATE_DIR/logs/ci-reconcile-2.txt" || fail "K3: not back to all UNCHANGED"
sed -i 's/ RECONCILE$//' "$STATE_DIR/AUTHORIZED"
K3_PASS=13
end

step "D2 on the VPS path: capacity check; the cap absent (as on the VPS today); authorized reconcile; controlled cluster restart; staging recovers"
bash "$KIT_DIR/tools/pg-capacity.sh" || fail "the capacity check"
PGU="postgresql@16-$CLUSTER.service"; PT="/etc/systemd/system/$PGU.d/20-tasks.conf"
wait_apps() { local i; for i in $(seq 1 60); do
  [ "$(node -e 'require("http").get({socketPath:process.argv[1],path:"/login",headers:{host:process.argv[2],"x-forwarded-host":process.argv[2],"x-forwarded-proto":"https"}},r=>{console.log(r.statusCode);r.resume()}).on("error",()=>console.log(0))' "$RUN_DIR/customer.sock" "$CUST_HOST")" = 200 ] && return 0; sleep 2; done; return 1; }
mv "$PT" "$RUNNER_TEMP/20-tasks.conf.vps-today"; systemctl daemon-reload; systemctl restart "$PGU"; wait_apps || fail "staging did not recover without the cap"
echo "the VPS today: cluster pids.max $(cat "/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$PGU")/pids.max") (no own cap; the slice bounds it)"
sed -i 's/^stages=\(.*\)$/stages=\1 RECONCILE/' "$STATE_DIR/AUTHORIZED"
bash "$KIT_DIR/tools/reconcile.sh" --execute "$PT" | grep -E 'reconciled|nothing was restarted' || fail "reconcile of the PROPOSED drop-in"
[ "$(systemctl show -p TasksMax --value "$PGU")" = 64 ] || fail "TasksMax not 64 after daemon-reload"
# the separately authorized, controlled restart — through the kit's own tool, exactly as on the VPS
if bash "$KIT_DIR/tools/pg-restart.sh" --execute > "$STATE_DIR/logs/ci-pgrestart-refused.txt" 2>&1; then fail "pg-restart.sh ran without PGRESTART in the owner's authorization"; fi
grep -q 'PGRESTART is not in the recorded authorization' "$STATE_DIR/logs/ci-pgrestart-refused.txt" || { tail -5 "$STATE_DIR/logs/ci-pgrestart-refused.txt"; fail "pg-restart.sh refused for another reason"; }
[ ! -f "$STATE_DIR/STOPPED" ] || mv "$STATE_DIR/STOPPED" "$STATE_DIR/STOPPED.ci-expected-pgrestart"
echo "ok: the controlled cluster restart is refused without PGRESTART in the owner's authorization"
sed -i 's/^stages=\(.*\)$/stages=\1 PGRESTART/' "$STATE_DIR/AUTHORIZED"
bash "$KIT_DIR/tools/pg-restart.sh" --execute | grep -E 'PGRESTART ok|STOP' || fail "the controlled cluster restart (tools/pg-restart.sh)"
wait_apps || fail "staging did not recover after the controlled cluster restart"
echo "controlled restart (tools/pg-restart.sh): cluster pids.max $(cat "/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$PGU")/pids.max")"
[ "$(cat "/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$PGU")/pids.max")" = 64 ] || fail "the cap is not in effect after the restart"
node "$KIT_DIR/probes/s9-rtests.mjs" "$STATE_DIR/s9-rtests.json" > "$STATE_DIR/logs/ci-rtests-after-pg-restart.txt" 2>&1 || true
grep -q '^RTESTS-SUMMARY pass=[0-9]* fail=0$' "$STATE_DIR/logs/ci-rtests-after-pg-restart.txt" || { tail -20 "$STATE_DIR/logs/ci-rtests-after-pg-restart.txt"; fail "R-tests after the controlled restart"; }
echo "ok: after reconcile + controlled restart the cap is in effect and the database-backed flows pass ($(tail -1 "$STATE_DIR/logs/ci-rtests-after-pg-restart.txt"))"
bash "$KIT_DIR/tools/pg-capacity.sh" | tail -2
sed -i 's/ RECONCILE PGRESTART$//' "$STATE_DIR/AUTHORIZED"
main_unchanged "D2 (reconcile + two staging-cluster restarts)"
end

step "PostgreSQL task cap (proposed TasksMax=64): the measured need, and PostgreSQL's own connection limit binds first"
PGU="postgresql@16-$CLUSTER.service"; CG="/sys/fs/cgroup$(systemctl show -p ControlGroup --value "$PGU")"
[ "$(systemctl show -p TasksMax --value "$PGU")" = 64 ] && [ "$(cat "$CG/pids.max")" = 64 ] || fail "the cluster's task cap is not 64"
echo "cluster tasks: now $(cat "$CG/pids.current"), peak since S3 (S4 roles, S8 migrations, S9 probes, R-tests, PDF load) $(cat "$CG/pids.peak"), events: $(cat "$CG/pids.events")"
psql_pg() { runuser -u "$PG_USER" -- psql -X -q -At -h "$PG_RUN" -p "$PG_PORT" "$@"; }
runuser -u "$PG_USER" -- vacuumdb -q -h "$PG_RUN" -p "$PG_PORT" --analyze --jobs=4 "$DB" || fail "vacuumdb failed"
runuser -u "$PG_USER" -- pg_dump -h "$PG_RUN" -p "$PG_PORT" -Fc "$DB" > /dev/null || fail "pg_dump failed"
echo "after a 4-job VACUUM ANALYZE and a pg_dump: peak $(cat "$CG/pids.peak"), events: $(cat "$CG/pids.events")"
held="$(psql_pg -d postgres -c 'select count(*) from pg_stat_activity where backend_type = '"'"'client backend'"'"'')"
mkdir -p "$RUNNER_TEMP/pgsat"; peak=0
for i in $(seq 1 36); do psql_pg -d postgres -c 'select pg_sleep(10)' > "$RUNNER_TEMP/pgsat/$i.txt" 2>&1 & done
for i in $(seq 1 40); do c="$(cat "$CG/pids.current")"; [ "$c" -gt "$peak" ] && peak="$c"; sleep 0.2; done
wait
okc="$(grep -L . "$RUNNER_TEMP"/pgsat/*.txt | wc -l)"; refused="$(grep -lE 'too many clients already|remaining connection slots are reserved' "$RUNNER_TEMP"/pgsat/*.txt | wc -l)"
other="$(grep -LE 'too many clients already|remaining connection slots are reserved|^$' "$RUNNER_TEMP"/pgsat/*.txt | xargs -r grep -l . | wc -l)"
echo "saturation: 36 sessions on top of $held held by the apps → $okc ran, $refused refused by PostgreSQL itself, $other other errors; sampled tasks peak $peak, lifetime peak $(cat "$CG/pids.peak") of 64; events: $(cat "$CG/pids.events")"
[ "$(cat "$CG/pids.events")" = "max 0" ] || fail "a fork was refused by the task cap (pids.events $(cat "$CG/pids.events"))"
[ "$refused" -ge 1 ] && [ "$other" -eq 0 ] || fail "PostgreSQL's own limit did not refuse the excess sessions cleanly ($refused refused, $other other)"
[ "$(cat "$CG/pids.peak")" -le 64 ] || fail "the cluster exceeded 64 tasks"
systemctl is-active --quiet "$PGU" && [ "$(psql_pg -d postgres -c 'select 1')" = 1 ] || fail "the cluster is not healthy after the saturation test"
echo "PG-TASKS peak=$(cat "$CG/pids.peak") cap=64 events=$(cat "$CG/pids.events" | tr ' ' '=') refused_by_postgres=$refused"
end

# S12 (encrypted backups, off-host copy, restore drill) and S13 (F1–F7)
# shellcheck source=s12-s13-rehearsal.sh
. "$HERE/s12-s13-rehearsal.sh"

step "S6-R after S9 must refuse (it never touches an installed build under running apps)"
if bash "$KIT_DIR/s6r_install_artifact.sh" --execute > "$STATE_DIR/logs/ci-s6r-after-s9.txt" 2>&1; then fail "S6-R ran with the apps up"; fi
grep -m1 "STOP" "$STATE_DIR/logs/ci-s6r-after-s9.txt"
mv "$STATE_DIR/STOPPED" "$STATE_DIR/STOPPED.ci-expected"   # the expected refusal; the rehearsal continues
end

step "after S9: content through the sockets, restart, concurrency, integrity, journal, footprint"
printf '{"adminHost":"%s","custHost":"%s","adminSock":"%s","custSock":"%s","appDir":"%s","manifest":"%s"}\n' \
  "$ADMIN_HOST" "$CUST_HOST" "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock" "$APP_SRC" "$STATE_DIR/artifact/MANIFEST.sha256" > "$STATE_DIR/after-s9.json"
node "$HERE/after-s9.mjs" "$STATE_DIR/after-s9.json" || fail "after-S9 checks failed"
bash "$KIT_DIR/tools/footprint.sh"
main_unchanged "S1–S13, the saturation test, the backups and the restore drill"
end

step "rollback all --execute (S9 → S1), then nothing of the staging may remain"
bash "$KIT_DIR/rollback.sh" all --execute || fail "rollback failed"
left=""
for u in elite-po-admin.service elite-po-customer.service elite-po-admin-proxy.socket elite-po-customer-proxy.socket elite-po-staging-netns.service elite-po-install.service elite-po-backup.service elite-po-backup.timer elite-po-offsite.service elite-po-offsite.timer; do
  [ "$(systemctl show -p LoadState --value "$u")" = not-found ] || left="$left unit:$u($(systemctl show -p LoadState,ActiveState --value "$u" | tr '\n' '/'))"
done
# systemd synthesizes any slice on demand (it always loads): the slice must be inactive and its unit file gone
[ "$(systemctl show -p ActiveState --value elite-po-staging.slice)" = inactive ] && [ ! -e /etc/systemd/system/elite-po-staging.slice ] ||
  left="$left unit:elite-po-staging.slice($(systemctl show -p ActiveState --value elite-po-staging.slice))"
# postgresql@16-<cluster> is an instance of the distribution's template, so it always loads: it must be inactive,
# not failed, without the kit's drop-in, and its cluster gone from pg_lsclusters
pgu="postgresql@16-$CLUSTER.service"
[ "$(systemctl show -p ActiveState --value "$pgu")" = inactive ] && [ ! -e "/etc/systemd/system/$pgu.d" ] && ! pg_lsclusters -h | awk -v c="$CLUSTER" '$2 == c' | grep -q . ||
  left="$left unit:$pgu($(systemctl show -p ActiveState --value "$pgu"))"
for p in "$APP_DIR" "$ETC_DIR" "$RUN_DIR" "$PG_RUN" "/etc/postgresql/16/$CLUSTER" "/var/lib/postgresql/16/$CLUSTER" /usr/local/sbin/elite-po-run /etc/tmpfiles.d/elite-po-staging.conf "/run/netns/$NS"; do
  [ ! -e "$p" ] || left="$left path:$p"
done
for u in "$APP_USER" "$PG_USER"; do getent passwd "$u" >/dev/null && left="$left user:$u"; done
getent group "$UPLOAD_GROUP" >/dev/null && left="$left group:$UPLOAD_GROUP"
for p in /var/lib/private/elite-po-offsite /var/lib/elite-po-offsite "$APP_DIR/.kit-tools"; do [ ! -e "$p" ] || left="$left path:$p"; done
[ -z "$left" ] || fail "left after rollback:$left"
[ ! -e "$VAR_DIR" ] || echo "note: $VAR_DIR kept by rollback S9 because the fictional storage is not empty: $(find "$VAR_DIR" -type f | wc -l) file(s) (the owner decides, plan §J step 7)"
newtcp="$(comm -13 "$STATE_DIR/baseline-tcp.txt" <(ss -ltnH | awk '{print $4}' | sort -u) | tr '\n' ' ')"
[ -z "$newtcp" ] || fail "host TCP listener(s) left after rollback: $newtcp"
echo "rollback removed every staging unit, path, user and listener; the archive stays in $INCOMING_DIR for audit"
main_unchanged "rollback all"
end
echo "REHEARSAL PASS: S1–S9 (S6 = S6-R under the D24 recovery state: $D24_PASS checks; K2 receive), the D31 PDF load, S11 through nginx ($S11_PASS probe checks), K3 ($K3_PASS checks), the PostgreSQL cap (reconcile, controlled restart, saturation), S13 F1–F7 on the owner's staging-only S12 deferral (website, Neon, real-data and production gates), the retained S12 tooling (backup + off-host + restore drill), and the full rollback"
