#!/usr/bin/env bash
# PO-07 D24: record the owner's authorization to RECOVER the recorded S6 STOP through S6-R (runs on the VPS, as root,
# through `pc-kit.sh recovery-authorize "<the owner's reason>"`).
#   recovery-authorize.sh --execute <the owner's reason, base64>      (--plan: show what would be checked)
# It changes nothing but writes $STATE_DIR/RECOVERY.authorized (root 0600). The STOP record stays as it is. That file
# lets S6-R — and only S6-R — run while the STOP is recorded, and only if, when S6-R starts and again when it ends,
# it still matches: this exact STOP record (SHA-256), this window, the approved release and tree, the staging app
# path, the transferred artifact (run, archive SHA-256, build id) and the installed kit (manifest digest). S6-R
# resolves the STOP only after every check passed; a failure invalidates this authorization.
# Refused unless: inside the window; this window's owner authorization is recorded with S6 in it; a fresh S0; the
# recorded STOP is the S6 failure (every entry); no later STOP after changes; S5 is done and S6 is not; the verified archive and its expected values are in place
# and agree; the kit's manifest verifies; no recovery authorization exists already; the reason is the owner's words.
STAGE=S6; . "$(dirname "$0")/../lib.sh"
REASON_B64="${2:-}"
say "==== recovery authorization for the recorded S6 STOP ($MODE) ===="
if [ "$MODE" = plan ]; then
  plan "verify: in the window; AUTHORIZED for this window lists S6; fresh S0; STOPPED is the S6 failure; S5 done, S6 not done"
  plan "verify: ARTIFACT.expected and the archive in $INCOMING_DIR agree (SHA-256); the kit manifest verifies"
  plan "write $STATE_DIR/RECOVERY.authorized (root 0600): STOP SHA-256, window, release, app path, artifact, kit digest, the owner's reason"
  exit 0
fi
[ -d "$STATE_DIR" ] || stop_now "no state directory"
load_baseline
require_vps
require_window "$S6_MIN_MINUTES_LEFT"
[ -f "$STATE_DIR/AUTHORIZED" ] && grep -q "^window=$WINDOW_START_UTC/$WINDOW_END_UTC$" "$STATE_DIR/AUTHORIZED" && grep -q '^stages=.*\bS6\b' "$STATE_DIR/AUTHORIZED" ||
  { say "refused: this window's owner authorization (with S6) is not recorded (pc-kit.sh update first)"; exit 3; }
[ -f "$STATE_DIR/STOPPED" ] || { say "refused: no STOP is recorded (S6-R runs normally)"; exit 3; }
stop_is_s6 || { say "refused: the recorded STOP is not (only) the S6 failure: $(awk 'NR % 2 == 0' "$STATE_DIR/STOPPED" | tr '\n' ';')"; exit 3; }
later_clean || { say "refused: a later STOP happened after changes ($STATE_DIR/STOPPED.later): the owner reviews it first"; exit 3; }
[ -f "$STATE_DIR/S5.done" ] && [ ! -f "$STATE_DIR/S6.done" ] || { say "refused: S5 must be done and S6 not done"; exit 3; }
[ ! -e "$STATE_DIR/RECOVERY.authorized" ] || { say "refused: a recovery authorization already exists ($STATE_DIR/RECOVERY.authorized)"; exit 3; }
[ -f "$STATE_DIR/ARTIFACT.expected" ] || { say "refused: no ARTIFACT.expected (pc-kit.sh artifact-upload first)"; exit 3; }
a="$INCOMING_DIR/run$(xv run_id)/$(xv archive)"
[ -f "$a" ] && [ "$(sha256sum "$a" | cut -d' ' -f1)" = "$(xv archive_sha256)" ] || { say "refused: the archive in $INCOMING_DIR does not match ARTIFACT.expected"; exit 3; }
[ "$(xv source_sha)" = "$APPROVED_SHA" ] && [ "$(xv source_tree)" = "$APPROVED_TREE" ] || { say "refused: the artifact is not for the approved release"; exit 3; }
artifact_pinned || { say "refused: ARTIFACT.expected is not the owner-approved artifact pinned in config.sh (K4)"; exit 3; }
archive_verified "$a" || { say "refused: the archive was not published by artifact-receive (no matching .verified record, K2)"; exit 3; }
(cd "$KIT_DIR" && sha256sum --quiet -c "$STATE_DIR/KIT.sha256") || { say "refused: the installed kit does not match its manifest"; exit 3; }
reason="$(printf '%s' "$REASON_B64" | base64 -d 2>/dev/null | tr '\n\r\t' '   ')"
[ "${#reason}" -ge 20 ] || { say "refused: the owner's recovery reason is required, verbatim (at least 20 characters)"; exit 3; }
umask 077
{
  echo "stage=S6"; echo "mode=S6-R (install the verified external build; the on-VPS build is retired)"
  echo "stop_sha256=$(sha256sum < "$STATE_DIR/STOPPED" | cut -d' ' -f1)"; echo "stop_record=$(sed -n 2p "$STATE_DIR/STOPPED")"
  echo "window=$WINDOW_START_UTC/$WINDOW_END_UTC"; echo "approved_sha=$APPROVED_SHA"; echo "approved_tree=$APPROVED_TREE"; echo "app_src=$APP_SRC"; echo "host=$(host_id)"
  echo "run_id=$(xv run_id)"; echo "archive=$(xv archive)"; echo "archive_sha256=$(xv archive_sha256)"; echo "build_id=$(xv build_id)"
  echo "kit_version=$KIT_VERSION"; echo "kit_manifest=$(kit_digest)"
  echo "owner_instruction=$(sed -n 's/^owner_instruction=//p' "$STATE_DIR/AUTHORIZED")"
  echo "reason=$reason"; echo "authorized_at=$(date -u +%FT%TZ)"
} > "$STATE_DIR/RECOVERY.authorized.tmp" && mv -- "$STATE_DIR/RECOVERY.authorized.tmp" "$STATE_DIR/RECOVERY.authorized"
say "recovery authorized: S6-R may run while the S6 STOP stays recorded (STOP SHA-256 $(rv stop_sha256 | cut -c1-16)…; artifact run $(rv run_id), build $(rv build_id))"
