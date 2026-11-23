# PO-07 D24 rehearsal — sourced by rehearsal.sh after S5 (uses its step/end/fail and the kit's config).
# Reproduces the VPS state after the failed on-VPS build — an S6 STOP record and the incomplete build output — and
# proves the restricted recovery state of the kit (lib.sh require_authorized / recovery_valid / recovery_complete):
#   * the STOP record stays byte-identical through every refusal and every failed recovery;
#   * only S6-R may run while it is recorded, and only under an owner recovery authorization bound to this STOP,
#     window, host, release, deployment target, artifact and kit; S7–S9 never run;
#   * a failed recovery stops, keeps its evidence and the incomplete output it had not yet replaced, and invalidates
#     the authorization (a new attempt needs a new one);
#   * a successful S6-R replaces the incomplete output with the verified build, keeps the original STOP read-only,
#     records the owner's reason, and only then opens the gate for S7.
# shellcheck shell=bash
D24_PASS=0
STOP="$STATE_DIR/STOPPED"
LATER="$STATE_DIR/STOPPED.later"
ARCH="$INCOMING_DIR/run$RUN_ID/$A"
REASON="Owner decision S6-R1 and D24, 24 Nov 2026: recover the S6 memory failure by installing the verified external build (CI rehearsal)"
b64() { printf '%s' "$1" | base64 -w0; }
s6r() { bash "$KIT_DIR/s6r_install_artifact.sh" --execute; }
authorize() { bash "$KIT_DIR/tools/recovery-authorize.sh" --execute "$(b64 "$1")"; }
stop_sha() { sha256sum < "$STOP" | cut -d' ' -f1; }
partial_sum() { find "$APP_SRC/.next" "$APP_SRC/node_modules" "$BUILD_HOME/.npm" -printf '%P %s %y %u\n' 2> /dev/null | LC_ALL=C sort | sha256sum | cut -c1-16; }
count() { find "$STATE_DIR" -maxdepth 1 -name "$1" | wc -l; }
corrupt_archive() { printf 'X' | dd of="$ARCH" bs=1 seek=4096 conv=notrunc status=none; }
ok() { D24_PASS=$((D24_PASS + 1)); echo "PASS D24 $*"; }
# expect_refusal LABEL PATTERN CMD... — must fail, for that reason, with the STOP record and S6/S7 untouched
expect_refusal() {
  local label="$1" pat="$2" out rc=0; shift 2
  out="$("$@" 2>&1 < /dev/null)" || rc=$?
  [ "$rc" -ne 0 ] || { echo "$out" | tail -25; fail "D24 $label: it ran (exit 0)"; }
  echo "$out" | grep -qF -- "$pat" || { echo "$out" | tail -25; fail "D24 $label: refused (exit $rc), but not for: $pat"; }
  [ "$(stop_sha)" = "$STOP_SHA" ] || fail "D24 $label: the original STOP record changed"
  [ ! -f "$STATE_DIR/S6.done" ] && [ ! -f "$STATE_DIR/S7.done" ] || fail "D24 $label: a later stage is marked done"
  ok "$label — exit $rc: $(echo "$out" | grep -F -- "$pat" | head -1 | sed -E 's/^[0-9:]+Z //' | cut -c1-150)"
}

step "D24: reproduce the VPS after the failed on-VPS S6 — its STOP record and its incomplete build output"
(cd / && runuser -u "$APP_USER" -- sh -ec 'mkdir -p "$1/.next/cache/webpack" "$1/node_modules/left-over" "$2/.npm/_cacache"
  echo partial > "$1/.next/cache/webpack/client-production-0.pack"; echo "module.exports = 0;" > "$1/node_modules/left-over/index.js"
  echo x > "$2/.npm/_cacache/index-v5"' sh "$APP_SRC" "$BUILD_HOME")
printf '%s\n%s\n' "2026-11-23T16:31:07Z" "S6: check failed: next build completed within the memory cap (CI reproduction of the recorded VPS failure)" > "$STOP"
chmod 0600 "$STOP"
STOP_SHA="$(stop_sha)"; P0="$(partial_sum)"
cp -p "$ARCH" "$RUNNER_TEMP/archive.good"
echo "STOP record SHA-256 ${STOP_SHA:0:16}…; incomplete output listing ${P0}"
end

step "D24: refusals while the S6 STOP is recorded and no recovery is authorized"
expect_refusal "S6-R without a recovery authorization is refused" "only S6-R under a valid recovery authorization may run" s6r
for s in s7_envfiles s8_vnet_migrate s9_units_start; do
  expect_refusal "${s%%_*} while the S6 STOP is recorded is refused" "only S6-R under a valid recovery authorization may run" bash "$KIT_DIR/$s.sh" --execute
done
expect_refusal "a recovery authorization without the owner's reason is refused" "the owner's recovery reason is required" authorize "too short"
corrupt_archive
expect_refusal "a recovery authorization for an archive that is not the verified one is refused" "does not match ARTIFACT.expected" authorize "$REASON"
cp -p "$RUNNER_TEMP/archive.good" "$ARCH"
cp -p "$LATER" "$RUNNER_TEMP/later.good"
printf '%s\n%s\n' "$(date -u +%FT%TZ)" "RB-S6: CI simulation of a rollback that failed after changes [AFTER changes]" >> "$LATER"
expect_refusal "a recovery authorization after a later STOP AFTER changes is refused" "a later STOP happened after changes" authorize "$REASON"
cp -p "$RUNNER_TEMP/later.good" "$LATER"
! grep -qF "[AFTER changes]" "$LATER" || fail "D24: the simulated entry was not removed"
[ ! -e "$STATE_DIR/RECOVERY.authorized" ] || fail "D24: a refused authorization left RECOVERY.authorized"
[ "$(partial_sum)" = "$P0" ] || fail "D24: the incomplete output changed during the refusals"
grep -q '\[before any change\]$' "$LATER" || fail "D24: the refusals are not recorded in STOPPED.later"
ok "every refusal is recorded in STOPPED.later as \"before any change\"; STOPPED is byte-identical"
end

step "D24: an owner recovery authorization — bound to the STOP, window, host, release, target, artifact and kit"
authorize "$REASON" || fail "D24: the valid recovery authorization was refused"
[ "$(stat -c '%a %U' "$STATE_DIR/RECOVERY.authorized")" = "600 root" ] || fail "D24: RECOVERY.authorized is not root 0600"
grep -qxF "stop_sha256=$STOP_SHA" "$STATE_DIR/RECOVERY.authorized" && grep -qxF "reason=$REASON" "$STATE_DIR/RECOVERY.authorized" ||
  fail "D24: the authorization does not bind the STOP and the reason"
ok "recovery authorized: $(grep -E '^(stage|run_id|build_id|kit_manifest|window)=' "$STATE_DIR/RECOVERY.authorized" | tr '\n' ' ')"
R0="$(sha256sum < "$STATE_DIR/RECOVERY.authorized")"
expect_refusal "a second recovery authorization is refused" "a recovery authorization already exists" authorize "$REASON"
for s in s7_envfiles s9_units_start; do
  expect_refusal "${s%%_*} with a recovery authorized (before S6-R passed) is refused" "only S6-R under a valid recovery authorization may run" bash "$KIT_DIR/$s.sh" --execute
done
[ "$(sha256sum < "$STATE_DIR/RECOVERY.authorized")" = "$R0" ] || fail "D24: a refused stage changed the recovery authorization"
cp -p "$STATE_DIR/RECOVERY.authorized" "$RUNNER_TEMP/recovery.good"
while IFS='|' read -r field value why pat; do
  sed -i "s|^$field=.*|$field=$value|" "$STATE_DIR/RECOVERY.authorized"
  expect_refusal "S6-R under an authorization for $why is refused" "recovery authorization refused: $pat" s6r
  cp -p "$RUNNER_TEMP/recovery.good" "$STATE_DIR/RECOVERY.authorized"
done <<EOF
archive_sha256|$(printf '0%.0s' $(seq 64))|a different artifact|the authorization is for another artifact
approved_sha|$(printf 'a%.0s' $(seq 40))|a new release|the authorization is for another release
app_src|/srv/po07-other-target/app|a different deployment target|the authorization is for another deployment target
window|2099-01-01T00:00:00Z/2099-01-01T04:00:00Z|another window|the authorization is for another window
host|0000000000000000|another host|the authorization is for another host
stop_sha256|$(printf 'f%.0s' $(seq 64))|another STOP record|the recorded STOP differs from the one the owner authorized
kit_manifest|0123456789abcdef|another kit manifest|the kit manifest changed since the authorization
EOF
cp -p "$KIT_DIR/tools/footprint.sh" "$RUNNER_TEMP/footprint.good"; echo "# an unreviewed change" >> "$KIT_DIR/tools/footprint.sh"
expect_refusal "S6-R with a kit file changed after the authorization is refused" "the installed kit does not match its manifest" s6r
cp -p "$RUNNER_TEMP/footprint.good" "$KIT_DIR/tools/footprint.sh"
[ "$(partial_sum)" = "$P0" ] && [ ! -e "$STATE_DIR/S6R.installed" ] || fail "D24: a refused S6-R changed the incomplete output"
[ "$(count 'STOPPED.recovery-*')" -eq 0 ] || fail "D24: a refusal before the recovery began was recorded as a failed recovery"
ok "every mismatch is refused before the recovery begins; the authorization stays valid; nothing was changed"
end

step "D24: a recovery that fails on an unexpected path stops, keeps its evidence and invalidates the authorization"
touch "$APP_SRC/.next/cache/root-owned.unexpected"   # root-owned: not the retired build's output
P1="$(partial_sum)"
expect_refusal "S6-R recovery with an unexpected (root-owned) path in the output to remove fails safely" "check failed: everything to be removed belongs to" s6r
[ "$(count 'STOPPED.recovery-*')" -eq 1 ] && [ "$(count 'RECOVERY.*.failed')" -eq 1 ] && [ ! -e "$STATE_DIR/RECOVERY.authorized" ] ||
  fail "D24: no failure evidence, or the authorization survived"
[ "$(partial_sum)" = "$P1" ] || fail "D24: the failed recovery removed something"
ok "failed recovery 1: evidence $(cd "$STATE_DIR" && ls -d STOPPED.recovery-* | head -1), authorization invalidated, nothing removed"
expect_refusal "S6-R after a failed recovery, without a new authorization, is refused" "only S6-R under a valid recovery authorization may run" s6r
rm -f "$APP_SRC/.next/cache/root-owned.unexpected"
P0="$(partial_sum)"   # the incomplete output as the owner left it after removing the unexpected path
end

step "D24: a recovery that fails on a tampered archive stops, keeps its evidence and invalidates the authorization"
authorize "$REASON" || fail "D24: the second recovery authorization was refused"
corrupt_archive
expect_refusal "S6-R recovery with the archive changed after the authorization fails safely" "check failed: its SHA-256 equals the digest verified on the PC" s6r
cp -p "$RUNNER_TEMP/archive.good" "$ARCH"
[ "$(count 'STOPPED.recovery-*')" -eq 2 ] && [ "$(count 'RECOVERY.*.failed')" -eq 2 ] && [ ! -e "$STATE_DIR/RECOVERY.authorized" ] ||
  fail "D24: no evidence of the second failed recovery"
[ "$(partial_sum)" = "$P0" ] || fail "D24: the failed recovery changed the incomplete output"
ok "failed recovery 2: evidence kept, authorization invalidated, incomplete output untouched"
end

step "D24: the successful recovery — S6-R under a new owner authorization"
authorize "$REASON" || fail "D24: the third recovery authorization was refused"
out="$(s6r 2>&1 < /dev/null)" || { echo "$out" | tail -40; fail "D24: the authorized S6-R recovery failed"; }
echo "$out" | grep -E "RESTRICTED RECOVERY|RECOVERY COMPLETE|S6 COMPLETE|installed: every" | sed -E 's/^[0-9:]+Z //' | cut -c1-200
echo "$out" | grep -q "RECOVERY COMPLETE" || fail "D24: S6-R did not complete the recovery"
kept="$(ls "$STATE_DIR"/STOPPED.*.recovered 2> /dev/null | head -1)" || true
[ ! -e "$STOP" ] && [ "$(count 'STOPPED.*.recovered')" -eq 1 ] || fail "D24: the STOP was not resolved exactly once"
[ "$(sha256sum < "$kept" | cut -d' ' -f1)" = "$STOP_SHA" ] && [ "$(stat -c '%a %U' "$kept")" = "400 root" ] || fail "D24: the kept STOP record is not the original, read-only"
ok "the original STOP record is kept byte-identical and read-only: $(basename "$kept")"
grep -qF "$REASON" "$STATE_DIR/STOPPED.resolved" && grep -q "original STOP record kept unchanged and read-only" "$STATE_DIR/STOPPED.resolved" ||
  fail "D24: STOPPED.resolved lacks the reason"
[ "$(count 'RECOVERY.*.consumed')" -eq 1 ] && [ ! -e "$STATE_DIR/RECOVERY.authorized" ] && [ -f "$STATE_DIR/S6.done" ] ||
  fail "D24: the authorization was not consumed, or S6 is not done"
ok "the owner's reason and authorization are in STOPPED.resolved; the authorization is consumed; S6 is done"
rec="$(ls "$STATE_DIR"/logs/S6R-removed-*.txt 2> /dev/null | tail -1)" || true
grep -q "^$APP_SRC/.next: [0-9]* bytes, 1 files" "$rec" && grep -q "^$APP_SRC/node_modules: [0-9]* bytes, 1 files" "$rec" && grep -q "no .next/BUILD_ID" "$rec" ||
  { cat "$rec"; fail "D24: the removal record does not describe the incomplete output"; }
[ ! -e "$APP_SRC/node_modules/left-over" ] && [ ! -e "$APP_SRC/.next/cache/webpack/client-production-0.pack" ] && [ ! -e "$BUILD_HOME/.npm" ] ||
  fail "D24: incomplete output left behind"
[ "$(cat "$APP_SRC/.next/BUILD_ID")" = "$(sed -n 's/^build_id=//p' "$STATE_DIR/ARTIFACT.expected")" ] || fail "D24: the installed build id is not the authorized one"
ok "the incomplete output was recorded ($(basename "$rec")), removed and replaced by the verified build $(cat "$APP_SRC/.next/BUILD_ID")"
[ "$(count 'STOPPED.recovery-*')" -eq 2 ] && [ "$(count 'RECOVERY.*.failed')" -eq 2 ] && ! grep -qF "[AFTER changes]" "$LATER" || fail "D24: failure evidence lost"
ok "the evidence of both failed recoveries and of $(grep -c '\[before any change\]$' "$LATER") refusals is kept"
echo "state after the recovery: $(cd "$STATE_DIR" && ls -d STOPPED* RECOVERY* S*.done 2> /dev/null | tr '\n' ' ')"
echo "D24-SUMMARY pass=$D24_PASS"
end
