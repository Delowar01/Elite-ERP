#!/usr/bin/env bash
# PO-07 K4 (24 Nov 2026): the approved application source, verified without assuming it is the branch tip.
#   verify-source.sh --github                 GitHub API (gh, the owner's login; read-only)
#   verify-source.sh --git <repo> [<ref>]     a local clone (offline; <ref> default origin/$REPO_BRANCH)
#   [--receipt <ARTIFACT.expected>]           also check the artifact receipt (default: ../artifacts/run$APPROVED_RUN_ID/)
# The 24 Nov 2026 S0 prerequisite counted the refs whose TIP is the approved commit; it failed as soon as tooling or
# documentation commits moved the branch on (the owner ruled it not applicable). Checked instead, each OK or FAIL:
#   1. the approved commit exists;                      2. its tree is the pinned tree;
#   3. it is reachable from the intended branch (an ancestor of, or equal to, its tip; 0 commits behind);
#   4. the receipt (when present) names this commit and tree, and the pinned run, archive SHA-256 and build.
# NOTE (never a failure): later commits on the branch, and any of their files outside ci/, .github/ and docs/. They are
# NOT part of the approved release, which stays pinned to APPROVED_SHA: the VPS installs only the pinned archive, and
# S6-R checks that the installed tree is APPROVED_TREE. The installed source and build on the VPS are checked by S0
# (section "9b") through s0_compare.sh, and by S6-R itself.
set -uo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../config.sh
. "$HERE/config.sh"
MODE="${1:-}"; shift || true
REPO="" REF="origin/$REPO_BRANCH" RECEIPT="$HERE/../artifacts/run$APPROVED_RUN_ID/ARTIFACT.expected"
case "$MODE" in
  --github) ;;
  --git) REPO="${1:?repo dir}"; shift; if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then REF="$1"; shift; fi ;;
  *) echo "usage: $0 --github | --git <repo> [<ref>] [--receipt <file>]" >&2; exit 64 ;;
esac
[ "${1:-}" = --receipt ] && { RECEIPT="${2:?receipt}"; shift 2; }
fails=0
ok() { printf 'OK    %s\n' "$1"; }
no() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }
note() { printf 'NOTE  %s\n' "$1"; }
app_paths() { grep -vE '^(ci|\.github|docs)/' || true; }

if [ "$MODE" = --github ]; then
  got="$(gh api "repos/$ARTIFACT_REPO/git/commits/$APPROVED_SHA" --jq '.sha + " " + .tree.sha' 2> /dev/null)"
  [ "${got%% *}" = "$APPROVED_SHA" ] && ok "the approved commit $APPROVED_SHA exists on GitHub" || no "the approved commit $APPROVED_SHA is not on GitHub"
  [ "${got#* }" = "$APPROVED_TREE" ] && ok "its tree is the pinned tree $APPROVED_TREE" || no "its tree is ${got#* } (pinned: $APPROVED_TREE)"
  cmp="$(gh api "repos/$ARTIFACT_REPO/compare/$APPROVED_SHA...$REPO_BRANCH" --jq '[.status, .behind_by, .ahead_by, .merge_base_commit.sha] | @tsv' 2> /dev/null)"
  IFS=$'\t' read -r st behind ahead base <<< "$cmp"
  if { [ "$st" = ahead ] || [ "$st" = identical ]; } && [ "$behind" = 0 ] && [ "$base" = "$APPROVED_SHA" ]; then
    ok "it is reachable from $REPO_BRANCH (an ancestor of its tip; $ahead later commit(s), 0 behind)"
  else no "it is NOT reachable from $REPO_BRANCH (status ${st:-?}, behind ${behind:-?}, merge base ${base:-?})"; fi
  later="$(gh api "repos/$ARTIFACT_REPO/compare/$APPROVED_SHA...$REPO_BRANCH" --paginate --jq '.files[].filename' 2> /dev/null | sort -u)"
else
  git -C "$REPO" cat-file -e "$APPROVED_SHA^{commit}" 2> /dev/null && ok "the approved commit $APPROVED_SHA exists in $REPO" || no "the approved commit $APPROVED_SHA is not in $REPO"
  tree="$(git -C "$REPO" rev-parse "$APPROVED_SHA^{tree}" 2> /dev/null)"
  [ "$tree" = "$APPROVED_TREE" ] && ok "its tree is the pinned tree $APPROVED_TREE" || no "its tree is ${tree:-unknown} (pinned: $APPROVED_TREE)"
  if git -C "$REPO" rev-parse -q --verify "$REF^{commit}" > /dev/null && git -C "$REPO" merge-base --is-ancestor "$APPROVED_SHA" "$REF" 2> /dev/null; then
    ok "it is reachable from $REF (an ancestor of its tip; $(git -C "$REPO" rev-list --count "$APPROVED_SHA..$REF") later commit(s))"
  else no "it is NOT reachable from $REF"; fi
  later="$(git -C "$REPO" diff --name-only "$APPROVED_SHA" "$REF" 2> /dev/null | sort -u)"
fi
if [ -f "$RECEIPT" ]; then
  rx() { sed -n "s/^$1=//p" "$RECEIPT" | head -1; }
  if [ "$(rx source_sha)" = "$APPROVED_SHA" ] && [ "$(rx source_tree)" = "$APPROVED_TREE" ] && [ "$(rx run_id)" = "$APPROVED_RUN_ID" ] &&
    [ "$(rx archive_sha256)" = "$APPROVED_ARCHIVE_SHA256" ] && [ "$(rx build_id)" = "$APPROVED_BUILD_ID" ]; then
    ok "the artifact receipt names this commit and tree, run $APPROVED_RUN_ID, the pinned archive and build $APPROVED_BUILD_ID"
  else no "the artifact receipt $RECEIPT does not match the pinned release (a substituted or mismatched build)"; fi
else note "no artifact receipt at $RECEIPT (not checked)"; fi
napp="$(printf '%s\n' "$later" | sed '/^$/d' | app_paths | wc -l)"; nall="$(printf '%s\n' "$later" | sed '/^$/d' | wc -l)"
note "$nall file(s) changed on the branch after the approved commit; outside ci/, .github/, docs/: $napp — none of them is part of the approved release (pinned to $APPROVED_SHA)"
[ "$napp" -eq 0 ] || printf '%s\n' "$later" | app_paths | sed 's/^/        /' | head -20
echo "VERIFY-SOURCE fail=$fails"
exit $([ "$fails" -eq 0 ] && echo 0 || echo 3)
