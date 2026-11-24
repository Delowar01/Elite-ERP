#!/usr/bin/env bash
# PO-07 regression tests of the six kit corrections K1–K6 (25 Nov 2026), on fictional fixtures in a temporary
# directory only: nothing is installed, no VPS, no network, no root needed.
#   kit-k-tests.sh <kit dir>
# <kit dir>: the rendered CI kit (ci/po07-runtime/kit, on a GitHub-hosted Linux runner) or the owner's private kit
# (validate-kit.sh on the PC). Every test runs the kit's OWN code. A test a platform cannot run (a signal to a process
# group, chmod/symlink semantics) is reported as SKIP, never as PASS.
set -uo pipefail
export LC_ALL=C
KIT="$(cd "${1:?kit dir}" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
LINUX=0; [ "$(uname -s)" = Linux ] && LINUX=1
pass=0 fail=0 skip=0
ok() { local n="$1"; shift; if "$@" > "$T/.out" 2>&1; then echo "PASS $n"; pass=$((pass + 1)); else echo "FAIL $n"; tail -8 "$T/.out" | sed 's/^/    /'; fail=$((fail + 1)); fi; }
no() { local n="$1"; shift; if "$@" > "$T/.out" 2>&1; then echo "FAIL $n (expected a refusal)"; tail -5 "$T/.out" | sed 's/^/    /'; fail=$((fail + 1)); else echo "PASS $n"; pass=$((pass + 1)); fi; }
sk() { echo "SKIP $1 ($2)"; skip=$((skip + 1)); }
# lx: a test that needs Linux file semantics (install -m, chmod, hard links in a POSIX temp dir): CI runs it; Git Bash cannot
lx() { local n="$1"; shift; if [ "$LINUX" = 1 ]; then ok "$n" "$@"; else sk "$n" "needs Linux file permissions; runs in CI"; fi; }
sum_tree() { (cd "$1" && find . \( -type f -o -type l \) -print | LC_ALL=C sort | while read -r f; do if [ -L "$f" ]; then echo "L $f $(readlink "$f")"; else sha256sum "$f"; fi; done) | sha256sum | cut -c1-16; }
kit_list() { (cd "$KIT" && find . \( -path ./state -o -path ./incoming -o -path ./validate/out \) -prune -o -type f ! -name '*.log' -print | LC_ALL=C sort); }
win_manifest() { (cd "$1" && kit_list | xargs sha256sum) | sed -E 's/^([0-9a-f]{64})  /\1 */'; }   # the Git Bash format of 24 Nov

echo "== K1: manifest formats and the kit update"
# shellcheck source=/dev/null
. "$KIT/tools/manifest.sh"
H="$(printf 'x' | sha256sum | cut -d' ' -f1)"
mf() { printf '%s\n' "$@" > "$T/m.txt"; manifest_paths "$T/m.txt"; }
ok "K1 parser: Linux lines (two spaces)" mf "$H  ./a.sh" "$H  ./units/b.conf"
ok "K1 parser: Windows/Git Bash lines (space, asterisk) — the 24 Nov format" mf "$H *./a.sh" "$H *./units/b.conf"
ok "K1 parser: both formats mixed" mf "$H  ./a.sh" "$H *./units/postgresql@16-x.conf"
for bad in "$H  /etc/passwd" "$H  a.sh" "$H  ./a/../b" "$H  ./../x" "$H  ./a//b" "$H  ./a/./b" "\\$H  ./a" "${H^^}  ./a" "${H:1}  ./a" "$H	./a" "$H  ./state/AUTHORIZED" "$H  ./incoming/x" "$H  ./a b" "$H **./a"; do
  no "K1 parser refuses: $(printf '%s' "$bad" | sed "s/$H/<sha>/; s/\t/<TAB>/" | cut -c1-40)" mf "$bad"
done
no "K1 parser refuses a duplicate path" mf "$H  ./a.sh" "$H *./a.sh"
no "K1 parser refuses a CRLF line" mf "$H  ./a.sh"$'\r'
no "K1 parser refuses an empty manifest" mf
mkdir -p "$T/k1src"; (cd "$KIT" && kit_list | tar -cf - -T -) | tar -xf - -C "$T/k1src"
win_manifest "$T/k1src" > "$T/k1src.win"
k1_exact() { [ "$(manifest_paths "$T/k1src.win")" = "$(kit_list)" ] && grep -q ' \*\./' "$T/k1src.win"; }
ok "K1 parser: the kit's own manifest in the 24 Nov Windows format lists exactly the kit's files" k1_exact
# --- kit-install.sh: an installed kit, a transferred new kit, and everything around them ---
. "$KIT/config.sh"; WIN="$WINDOW_START_UTC/$WINDOW_END_UTC"
setup_k1() { # → $T/kd (installed: kit + 2 stale files + records + logs + incoming) and $T/kd.incoming.abc123 (the transfer)
  rm -rf "$T/kd" "$T"/kd.incoming.* "$T/unrelated"; mkdir -p "$T/kd/state/logs" "$T/kd/incoming/run1" "$T/unrelated" "$T/kd.incoming.abc123/kit" "$T/kd.incoming.abc123/state"
  cp -a "$T/k1src/." "$T/kd/"; echo old > "$T/kd/s6_build.sh"; mkdir -p "$T/kd/tools"; echo old > "$T/kd/tools/retired-tool.sh"
  for f in AUTHORIZED baseline.env baseline-units.txt baseline-tcp.txt baseline-unix.txt KIT.sha256; do echo "old $f" > "$T/kd/state/$f"; done
  echo "evidence" > "$T/kd/state/logs/S6-old.log"; echo "partial" > "$T/kd/incoming/run1/.partial-evidence"; echo "other app" > "$T/unrelated/keep.txt"
  cp -a "$T/k1src/." "$T/kd.incoming.abc123/kit/"
  win_manifest "$T/kd.incoming.abc123/kit" > "$T/kd.incoming.abc123/state/KIT.sha256"
  printf 'window=%s\nstages=S9 RECONCILE\n' "$WIN" > "$T/kd.incoming.abc123/state/AUTHORIZED"
  for f in baseline.env baseline-units.txt baseline-tcp.txt baseline-unix.txt; do echo "new $f" > "$T/kd.incoming.abc123/state/$f"; done
}
install_k1() { bash "$T/kd.incoming.abc123/kit/tools/kit-install.sh" "$T/kd.incoming.abc123" "$T/kd"; }
setup_k1
k1_install() {
  install_k1 || return 1
  [ "$(find "$T/kd/state/retired" -type f | wc -l)" -eq 2 ] && [ -f "$T"/kd/state/retired/*/s6_build.sh ] && [ -f "$T"/kd/state/retired/*/tools/retired-tool.sh ] &&
    (cd "$T/kd" && sha256sum --quiet -c state/KIT.sha256) && [ "$(. "$KIT/tools/manifest.sh"; kit_tree_files "$T/kd")" = "$(kit_list)" ] &&
    [ "$(cat "$T/kd/state/logs/S6-old.log")" = evidence ] && [ "$(cat "$T/kd/incoming/run1/.partial-evidence")" = partial ] &&
    [ "$(cat "$T/unrelated/keep.txt")" = "other app" ] && ls "$T"/kd/state/AUTHORIZED.until-* > /dev/null && grep -qx "window=$WIN" "$T/kd/state/AUTHORIZED" &&
    [ ! -e "$T/kd.incoming.abc123" ]
}
lx "K1 kit-install, the 24 Nov condition (Windows manifest): only the 2 stale files retired (moved, structure kept); every kit file verifies; records kept as .until; logs, incoming, other files untouched" k1_install
refused_unchanged() { # SETUP-COMMAND → kit-install must refuse (exit 3) and leave the installed kit byte-identical
  setup_k1; eval "$1"; local before; before="$(sum_tree "$T/kd")"
  local rc=0; install_k1 > "$T/.k1" 2>&1 || rc=$?
  [ "$rc" -eq 3 ] && [ "$(sum_tree "$T/kd")" = "$before" ] && grep -q "unchanged" "$T/.k1"
}
ok "K1 kit-install refuses an incomplete transfer (a file missing), kit unchanged" refused_unchanged 'rm "$T/kd.incoming.abc123/kit/lib.sh"'
ok "K1 kit-install refuses a damaged transfer (a byte added), kit unchanged" refused_unchanged 'echo x >> "$T/kd.incoming.abc123/kit/lib.sh"'
ok "K1 kit-install refuses an extra transferred file, kit unchanged" refused_unchanged 'echo x > "$T/kd.incoming.abc123/kit/extra.sh"'
ok "K1 kit-install refuses a manifest with a traversal path, kit unchanged" refused_unchanged 'echo "$H *./../../etc/passwd" >> "$T/kd.incoming.abc123/state/KIT.sha256"'
ok "K1 kit-install refuses a manifest in another format (the pre-fix misparse), kit unchanged" refused_unchanged 'sed -i "1s/^/X/" "$T/kd.incoming.abc123/state/KIT.sha256"'
ok "K1 kit-install refuses more than 10 retire candidates, kit unchanged" refused_unchanged 'for i in $(seq 1 11); do echo s > "$T/kd/stale$i.sh"; done'
ok "K1 kit-install refuses an authorization for another window, kit unchanged" refused_unchanged 'printf "window=2000-01-01T00:00:00Z/2000-01-02T00:00:00Z\n" > "$T/kd.incoming.abc123/state/AUTHORIZED"'
ok "K1 kit-install refuses a missing record (no baseline), kit unchanged" refused_unchanged 'rm "$T/kd.incoming.abc123/state/baseline.env"'
if [ "$LINUX" = 1 ]; then
  ok "K1 kit-install refuses a link as a retire candidate (never followed), kit unchanged" refused_unchanged 'ln -s "$T/unrelated/keep.txt" "$T/kd/stale-link.sh"'
  ok "K1 kit-install refuses a link in the transferred kit, kit unchanged" refused_unchanged 'ln -s /etc/passwd "$T/kd.incoming.abc123/kit/link.sh"'
else sk "K1 kit-install link cases" "symlinks need Linux"; sk "K1 kit-install transferred-link case" "symlinks need Linux"; fi

echo "== K2: the archive is published only after it is verified"
R="$KIT/tools/artifact-receive.sh"; INC="$T/inc"
SRC="$(printf 'src' | sha1sum | cut -c1-40)"; TREE="$(printf 'tree' | sha1sum | cut -c1-40)"; BUILD="ciBuildId_test01"; RUN=12345
mkdir -p "$T/a/po07-artifact/.next"; echo "$BUILD" > "$T/a/po07-artifact/.next/BUILD_ID"; head -c 300000 /dev/urandom > "$T/a/po07-artifact/.next/blob"
printf '{"source":{"sha":"%s","tree":"%s"},"build_id":"%s","workflow":{"run_id":"%s"}}\n' "$SRC" "$TREE" "$BUILD" "$RUN" > "$T/a/po07-artifact/ARTIFACT.json"
A="po07-staging-build-$(printf '%s' "$SRC" | cut -c1-12).tar.gz"; tar -czf "$T/$A" -C "$T/a" po07-artifact
SHA="$(sha256sum "$T/$A" | cut -d' ' -f1)"; SIZE="$(stat -c %s "$T/$A")"
recv() { local run="$1"; shift; bash "$R" "$INC" "$run" "$A" "$SHA" "$SIZE" "$SRC" "$TREE" "$BUILD" "$@"; }
k2_good() { recv "$RUN" < "$T/$A" && [ -f "$INC/run$RUN/$A" ] && cmp -s "$T/$A" "$INC/run$RUN/$A" && grep -qx "sha256=$SHA" "$INC/run$RUN/$A.verified" &&
  [ -z "$(find "$INC/run$RUN" -name '.receiving.*')" ] && [ ! -d "$INC/run$RUN/quarantine" ] && [ "$(bash "$R" --status "$INC" "$RUN" "$A" "$SHA")" = verified ]; }
lx "K2 a complete transfer is verified (size, SHA-256, ARTIFACT.json identity), then published with a .verified record" k2_good
k2_again() { local m0; m0="$(stat -c %Y:%i "$INC/run$RUN/$A")"; recv "$RUN" < /dev/null && [ "$(stat -c %Y:%i "$INC/run$RUN/$A")" = "$m0" ]; }
lx "K2 a second transfer of a verified archive changes nothing (already verified)" k2_again
quarantined() { # RUN TAG → no final file, no .verified, exactly one quarantined file with TAG, mode 0400
  [ ! -e "$INC/run$1/$A" ] && [ ! -e "$INC/run$1/$A.verified" ] && [ "$(find "$INC/run$1/quarantine" -name "*.$2" | wc -l)" -eq 1 ] &&
    { [ "$LINUX" = 0 ] || [ "$(stat -c %a "$(find "$INC/run$1/quarantine" -name "*.$2")")" = 400 ]; }; }
k2_trunc() { ! head -c $((SIZE / 2)) "$T/$A" | recv 2001 && quarantined 2001 bad-size; }
lx "K2 a truncated transfer (the 24 Nov failure: half the bytes, then end-of-file) is quarantined; no final name" k2_trunc
k2_pad() { ! { cat "$T/$A"; echo extra; } | recv 2002 && quarantined 2002 bad-size; }
lx "K2 a padded transfer is quarantined" k2_pad
k2_corrupt() { cp "$T/$A" "$T/bad.tgz"; printf '\x00' | dd of="$T/bad.tgz" bs=1 seek=$((SIZE / 3)) conv=notrunc 2> /dev/null; ! recv 2003 < "$T/bad.tgz" && quarantined 2003 bad-sha256; }
lx "K2 a corrupted transfer (same size) is quarantined" k2_corrupt
k2_ident() { ! bash "$R" "$INC" 2004 "$A" "$SHA" "$SIZE" "$SRC" "$TREE" otherBuildId99 < "$T/$A" && quarantined 2004 bad-identity; }
lx "K2 the right bytes for the wrong expected build are quarantined (identity mismatch)" k2_ident
k2_exists() { mkdir -p "$INC/run2005"; echo junk > "$INC/run2005/$A"; ! recv 2005 < "$T/$A" && [ "$(cat "$INC/run2005/$A")" = junk ] &&
  [ "$(bash "$R" --status "$INC" 2005 "$A" "$SHA")" = DIFFERS ] && [ ! -e "$INC/run2005/$A.verified" ]; }
ok "K2 an existing final file with other bytes is refused and left untouched" k2_exists
k2_noverified() { mkdir -p "$INC/run2006"; cp "$T/$A" "$INC/run2006/$A"; [ "$(bash "$R" --status "$INC" 2006 "$A" "$SHA")" = DIFFERS ]; }
ok "K2 a final file without its .verified record (the 24 Nov kind of copy) is not 'verified'" k2_noverified
no "K2 malformed expected values are refused" bash "$R" "$INC" 2007 "$A" "$SHA" "$SIZE" "$SRC" "$TREE" "bad build!"
no "K2 a relative incoming directory is refused" bash "$R" "inc" 2008 "$A" "$SHA" "$SIZE" "$SRC" "$TREE" "$BUILD"
if [ "$LINUX" = 1 ] && command -v setsid > /dev/null; then
  k2_interrupt() { INC="$T/inc-int"   # its own directory, the fixture's run id (the archive names run $RUN)
    { head -c $((SIZE / 2)) "$T/$A"; sleep 8; } | setsid bash "$R" "$INC" "$RUN" "$A" "$SHA" "$SIZE" "$SRC" "$TREE" "$BUILD" > "$T/.int" 2>&1 &
    local i pg=""; for i in $(seq 1 50); do pg="$(pgrep -f "artifact-receive.sh $INC $RUN" | head -1)"; [ -n "$pg" ] && [ -n "$(find "$INC/run$RUN" -name '.receiving.*' -size +1k 2> /dev/null)" ] && break; sleep 0.2; done
    [ -n "$pg" ] || return 1
    kill -HUP -- "-$(ps -o pgid= -p "$pg" | tr -d ' ')" 2> /dev/null; wait 2> /dev/null
    for i in $(seq 1 50); do [ -d "$INC/run$RUN/quarantine" ] && break; sleep 0.1; done
    quarantined "$RUN" interrupted && [ -z "$(find "$INC/run$RUN" -maxdepth 1 -name '.receiving.*')" ] && [ ! -d "$INC/run$RUN/.receive.lock" ]
  }
  ok "K2 an interrupted transfer (SIGHUP to the session, as when SSH drops) is quarantined; no final name; the lock is released" k2_interrupt
  k2_retry() { recv "$RUN" < "$T/$A" && [ "$(bash "$R" --status "$INC" "$RUN" "$A" "$SHA")" = verified ]; }
  ok "K2 the retry after the interrupted transfer succeeds" k2_retry
else sk "K2 interrupted transfer" "needs Linux setsid/pgrep"; sk "K2 retry after interruption" "depends on the interrupted case"; fi

echo "== K3: installed-file states (the kit's own classification)"
mkdir -p "$T/k3/st"
st() { ( STAGE=S9; . "$KIT/lib.sh" --plan > /dev/null; STATE_DIR="$T/k3/st"; installed_state "$@" ) 2> /dev/null; }
cp "$KIT/units/elite-po-run" "$T/k3/same"; cp "$KIT/units/history/wrapper@kit-1" "$T/k3/kit1"
{ cat "$KIT/units/elite-po-run"; echo "# a local edit"; } > "$T/k3/edited"
chmod 0700 "$T/k3/same" "$T/k3/kit1" "$T/k3/edited"
OG2="$(stat -c '%U:%G' "$T/k3/same")"
# the expected mode: 0700 on Linux; on Git Bash the emulated mode is read at the moment of the check (it is not stable)
md() { if [ "$LINUX" = 1 ]; then echo 0700; else echo "0$(stat -c %a "$1")"; fi; }
lx "K3 the kit's wrapper is UNCHANGED" test "$(st "$T/k3/same" "$(md "$T/k3/same")" "$OG2" units/elite-po-run S2 wrapper -)" = UNCHANGED
lx "K3 the stale kit-1 wrapper of the 24 Nov S9 STOP is OUTDATED(kit-1)" test "$(st "$T/k3/kit1" "$(md "$T/k3/kit1")" "$OG2" units/elite-po-run S2 wrapper -)" = "OUTDATED(kit-1)"
lx "K3 an unknown edit is MODIFIED (never replaced by reconcile)" test "$(st "$T/k3/edited" "$(md "$T/k3/edited")" "$OG2" units/elite-po-run S2 wrapper -)" = MODIFIED
touch "$T/k3/st/S2.done"
ok "K3 a file of a completed stage that is absent is MISSING" test "$(st "$T/k3/absent" 0700 "$OG2" units/elite-po-run S2 wrapper -)" = MISSING
ok "K3 an absent file flagged proposed is PROPOSED (never blocking, never auto-installed)" test "$(st "$T/k3/absent" 0644 "$OG2" units/pg-tasks.conf S2 pg-tasks proposed)" = PROPOSED
ok "K3 an absent file of a stage not yet run is NOT-INSTALLED" test "$(st "$T/k3/absent" 0644 "$OG2" units/elite-po-run S7 wrapper -)" = NOT-INSTALLED
mkdir "$T/k3/dir"
ok "K3 a directory in a file's place is NOT-A-FILE" test "$(st "$T/k3/dir" 0700 "$OG2" units/elite-po-run S2 wrapper -)" = NOT-A-FILE
if [ "$LINUX" = 1 ]; then
  chmod 0755 "$T/k3/same"
  ok "K3 the kit's content with another mode is WRONG-OWNER-OR-MODE" test "$(st "$T/k3/same" 0700 "$OG2" units/elite-po-run S2 wrapper -)" = WRONG-OWNER-OR-MODE
  ln -s "$T/k3/kit1" "$T/k3/link"
  ok "K3 a link in a file's place is NOT-A-FILE (never followed)" test "$(st "$T/k3/link" 0700 "$OG2" units/elite-po-run S2 wrapper -)" = NOT-A-FILE
else sk "K3 WRONG-OWNER-OR-MODE" "chmod semantics need Linux"; sk "K3 link in a file's place" "symlinks need Linux"; fi
k3_list() { local bad; bad="$(grep -v -e '^#' -e '^$' "$KIT/units/installed-files.tsv" | awk -F'\t' 'NF != 7 || $2 !~ /^0[0-7]{3}$/ || $5 !~ /^S[0-9]b?$/ || $1 !~ /^\//')"; [ -z "$bad" ]; }
ok "K3 units/installed-files.tsv: 7 fields, absolute destinations, octal modes, stage names" k3_list
k3_src() { grep -v -e '^#' -e '^$' "$KIT/units/installed-files.tsv" | cut -f4 | while read -r s; do [ -f "$KIT/$s" ] || { echo "missing $s"; exit 1; }; done; }
ok "K3 every listed kit source exists in the kit" k3_src

echo "== K4: the approved source without the branch-tip assumption (a fictional repository)"
command -v git > /dev/null || { echo "git missing"; exit 1; }
G="$T/repo"; git init -q -b main "$G"; git -C "$G" config user.email ci@example.invalid; git -C "$G" config user.name ci
mkdir -p "$G/src" "$G/docs" "$G/ci"; echo app > "$G/src/app.ts"; git -C "$G" add -A; git -C "$G" commit -qm approved
APP="$(git -C "$G" rev-parse HEAD)"; APPTREE="$(git -C "$G" rev-parse 'HEAD^{tree}')"
echo doc > "$G/docs/a.md"; echo ci > "$G/ci/x.sh"; git -C "$G" add -A; git -C "$G" commit -qm "tooling and docs only"
git -C "$G" checkout -qb side "$APP"; echo other > "$G/src/other.ts"; git -C "$G" add -A; git -C "$G" commit -qm side; SIDE="$(git -C "$G" rev-parse HEAD)"; git -C "$G" checkout -q main
mkdir -p "$T/vs/tools"; cp "$KIT/tools/verify-source.sh" "$T/vs/tools/"
vs_cfg() { printf 'APPROVED_SHA="%s"\nAPPROVED_TREE="%s"\nREPO_BRANCH="main"\nARTIFACT_REPO="ci/none"\nAPPROVED_RUN_ID="%s"\nAPPROVED_ARCHIVE_SHA256="%s"\nAPPROVED_BUILD_ID="%s"\n' "$1" "$2" "$RUN" "$SHA" "$BUILD" > "$T/vs/config.sh"; }
vs() { bash "$T/vs/tools/verify-source.sh" --git "$G" main --receipt "$T/vs/receipt"; }
printf 'source_sha=%s\nsource_tree=%s\nrun_id=%s\narchive_sha256=%s\nbuild_id=%s\n' "$APP" "$APPTREE" "$RUN" "$SHA" "$BUILD" > "$T/vs/receipt"
vs_cfg "$APP" "$APPTREE"
k4_ok() { vs > "$T/.vs" 2>&1 && grep -q 'reachable from main' "$T/.vs" && grep -q 'outside ci/, .github/, docs/: 0' "$T/.vs"; }
ok "K4 the approved commit is NOT the branch tip, yet verified: exists, pinned tree, reachable; later commits are tooling/docs only" k4_ok
vs_cfg "$APP" "$(printf 'x' | sha1sum | cut -c1-40)"; no "K4 a tree other than the pinned one is refused" vs
vs_cfg "$SIDE" "$(git -C "$G" rev-parse "$SIDE^{tree}")"; sed -i "s/^source_sha=.*/source_sha=$SIDE/; s/^source_tree=.*/source_tree=$(git -C "$G" rev-parse "$SIDE^{tree}")/" "$T/vs/receipt"
no "K4 a commit not reachable from the intended branch is refused" vs
vs_cfg "$(printf 'none' | sha1sum | cut -c1-40)" "$APPTREE"; no "K4 a commit that does not exist is refused" vs
vs_cfg "$APP" "$APPTREE"; sed -i "s/^source_sha=.*/source_sha=$APP/; s/^source_tree=.*/source_tree=$APPTREE/; s/^build_id=.*/build_id=substitutedBuild1/" "$T/vs/receipt"
no "K4 a receipt for a substituted build is refused" vs
sed -i "s/^build_id=.*/build_id=$BUILD/" "$T/vs/receipt"; echo change > "$G/src/later.ts"; git -C "$G" add -A; git -C "$G" commit -qm "later app change"
k4_note() { vs > "$T/.vs" 2>&1 && grep -q 'outside ci/, .github/, docs/: 1' "$T/.vs" && grep -q 'src/later.ts' "$T/.vs"; }
ok "K4 a later application change on the branch is named (NOTE) and is not part of the pinned release" k4_note

echo "== K5: the baseline chain (fictional S0 reports)"
s0f() { # FILE PID UNITS... — a minimal S0 v2 report
  local f="$1" pid="$2"; shift 2
  { echo "== 1b sites"; echo "  a.example.invalid                        200"; echo "== 2 running"; echo "count: $# | checksum: $(printf '%s\n' "$@" | sha256sum | cut -c1-16)"
    echo "== 3 PostgreSQL"; echo "main pid: $pid"; echo "== 6 listeners"; echo "TCP listen count: 1 | checksum: aaaa"; echo "unix listen count: ${UNIXN:-1} | checksum: ${UNIXS:-bbbb}"
    echo "== 8 approved staging names"; echo "unit elite-po-admin.service             ${ADM:-free}"; echo "== 9 tools"; echo "##BEGIN baseline-units.txt"; printf '%s\n' "$@"; echo "##END baseline-units.txt"
    echo "##BEGIN baseline-tcp.txt"; echo "${TCPL:-0.0.0.0:22}"; echo "##END baseline-tcp.txt"; echo "##BEGIN baseline-unix.txt"; printf '%s\n' ${UNIXL:-/run/dbus.sock}; echo "##END baseline-unix.txt"; } > "$T/k5/$f"
}
mkdir -p "$T/k5"
s0f F0 100 a.service b.service
s0f F1 200 a.service b.service
UNIXN=2 UNIXS=cccc UNIXL="/run/dbus.sock /run/elite-po-staging/admin.sock" ADM=TAKEN s0f F2 200 a.service b.service elite-po-admin.service
chainf() { for x in "$@"; do printf '%s\t%s\t%s\tT\trole %s\n' "$x" "$x" "$(sha256sum "$T/k5/$x" | cut -d' ' -f1)" "$x"; done > "$T/k5/chain.tsv"; }
printf 'F0>F1\tmain pid\t100\t200\tfictional acceptance (test)\n' > "$T/k5/reg.tsv"
tr5() { node "$KIT/tools/s0-trace.mjs" "$T/k5" --chain "$T/k5/chain.tsv" --register "$T/k5/reg.tsv" "$@"; }
chainf F0 F1 F2
k5_ok() { tr5 --last "$T/k5/F2" > "$T/.k5" 2>&1 && grep -q '^KNOWN   main pid' "$T/.k5" && grep -q '^STAGING running services.*+elite-po-admin.service' "$T/.k5" &&
  grep -q '^STAGING unix listeners.*+/run/elite-po-staging/admin.sock' "$T/.k5" && grep -q '^STAGING approved staging names' "$T/.k5" && grep -q 'fail=0' "$T/.k5"; }
ok "K5 a registered shared-service difference is KNOWN; kit staging units, sockets and names are STAGING; the chain traces" k5_ok
no "K5 --last: a reference that is not the latest baseline is refused" tr5 --last "$T/k5/F1"
cp "$T/k5/F1" "$T/k5/F1.bak"; echo "tampered" >> "$T/k5/F1"; no "K5 a baseline that differs from its recorded SHA-256 is refused" tr5; cp "$T/k5/F1.bak" "$T/k5/F1"
printf 'F1>F2\tmain pid\t100\t200\tregistered for the WRONG step\n' > "$T/k5/reg.tsv"; no "K5 a registration for another step does not explain a difference" tr5
printf 'F0>F1\tmain pid\t100\t200\tfictional acceptance (test)\n' > "$T/k5/reg.tsv"
UNIXN=2 UNIXS=cccc UNIXL="/run/dbus.sock /run/elite-po-staging/admin.sock" ADM=TAKEN s0f F2 200 a.service b.service elite-po-admin.service other-app.service; chainf F0 F1 F2
no "K5 a new non-staging service (a shared-service change) is never classified as staging" tr5
UNIXN=2 UNIXS=cccc UNIXL="/run/dbus.sock /run/elite-po-staging/admin.sock" ADM=TAKEN TCPL="127.0.0.1:3300" s0f F2 200 a.service b.service elite-po-admin.service
sed -i 's/^TCP listen count: 1 | checksum: aaaa/TCP listen count: 1 | checksum: dddd/' "$T/k5/F2"; chainf F0 F1 F2
no "K5 a new host TCP listener is never staging (the kit adds none)" tr5
s0f F2 300 a.service b.service; chainf F0 F1 F2; no "K5 an unregistered change (another PID) fails the trace" tr5

echo "== K6: SSH arguments (generated locally; nothing connects)"
. "$KIT/tools/ssh-args.sh"
ok "K6 NAT64 of 192.0.2.33 is 64:ff9b::c000:221 (RFC 6052 example)" test "$(nat64_of 192.0.2.33)" = 64:ff9b::c000:221
ok "K6 NAT64 of 0.0.0.0 and 255.255.255.255" test "$(nat64_of 0.0.0.0) $(nat64_of 255.255.255.255)" = "64:ff9b::0:0 64:ff9b::ffff:ffff"
for b in 256.1.1.1 01.2.3.4 1.2.3 a.b.c.d "1.2.3.4 " ""; do no "K6 nat64_of refuses '$b'" nat64_of "$b"; done
SSH_ALIAS=po07-test-vps VPS_IPV4=192.0.2.33
argv() { ssh_args "$@" | tr '\n' ' '; }
k6_v4() { local a; a="$(argv ipv4)" && [ "$(ssh_args ipv4 | tail -1)" = po07-test-vps ] && [[ "$a" == *" -o BatchMode=yes "* ]] && [[ "$a" == *" -o StrictHostKeyChecking=yes "* ]] &&
  [[ "$a" == *" -o UpdateHostKeys=no "* ]] && [[ "$a" == *" -o HostKeyAlias=192.0.2.33 "* ]] && [[ "$a" == *" -o ForwardAgent=no "* ]] && [[ "$a" != *HostName=* ]]; }
ok "K6 ipv4: the alias as configured; strict host key; one trusted identity; known_hosts never written; no forwarding" k6_v4
k6_v6() { local a; a="$(argv nat64)" && [[ "$a" == *" -o HostName=64:ff9b::c000:221 "* ]] && [[ "$a" == *" -o HostKeyAlias=192.0.2.33 "* ]] &&
  [[ "$a" == *" -o StrictHostKeyChecking=yes "* ]] && [ "$(ssh_args nat64 | tail -1)" = po07-test-vps ]; }
ok "K6 nat64: the NAT64 address with the SAME host-key entry (HostKeyAlias = the IPv4 name)" k6_v6
k6_env() { [[ "$(PO07_SSH_ROUTE=nat64 ssh_args | tr '\n' ' ')" == *HostName=64:ff9b::* ]] && [[ "$(PO07_SSH_ROUTE=ipv4 ssh_args | tr '\n' ' ')" != *HostName=* ]]; }
ok "K6 PO07_SSH_ROUTE selects the route" k6_env
k6_weak() { local r a; for r in ipv4 nat64; do a="$(argv "$r")"; [[ "$a" =~ StrictHostKeyChecking=(no|accept-new|off)|UserKnownHostsFile|IdentityFile|PasswordAuthentication|ForwardAgent=yes|UpdateHostKeys=yes ]] && return 1; done; return 0; }
ok "K6 no weakening option in either route (never StrictHostKeyChecking=no/accept-new, no key file, no password)" k6_weak
k6_bad_route() { local out; out="$(ssh_args tor 2> /dev/null)"; [ $? -ne 0 ] && [ -z "$out" ]; }
ok "K6 an unknown route fails and prints no command" k6_bad_route
k6_bad_alias() { local out; out="$(SSH_ALIAS='x; rm -rf /' ssh_args ipv4 2> /dev/null)"; [ $? -ne 0 ] && [ -z "$out" ]; }
ok "K6 a malformed alias fails and prints no command" k6_bad_alias

echo "K-TESTS pass=$pass fail=$fail skip=$skip"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
