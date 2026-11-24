#!/usr/bin/env bash
# PO-07 K3 (24 Nov 2026): reconcile the system files the kit installed (units/installed-files.tsv) with this kit.
#   reconcile.sh --report                      read-only (default): one row per listed file, then any UNEXPECTED file in
#                                              the kit's install locations. Changes nothing; needs no authorization.
#   reconcile.sh --execute <dest>...           owner-authorized: AUTHORIZED for this window must list RECONCILE. Each
#                                              NAMED file must be OUTDATED (equal to a known earlier kit version in
#                                              units/history/) or PROPOSED (listed "proposed", not installed yet); it is
#                                              then installed from this kit. The previous version is kept read-only under
#                                              state/installed-previous/<ts>/<dest>. Unit files: daemon-reload. Nothing
#                                              is restarted: the change takes effect at the next (separately authorized)
#                                              restart, or for the wrapper at its next run.
#   reconcile.sh --execute --restore <dest>... owner-authorized: puts back the most recent kept previous version of each
#                                              NAMED file, only while the file is still what reconcile installed.
# Never changed, in any mode: MODIFIED, WRONG-OWNER-OR-MODE, NOT-A-FILE, MISSING and UNEXPECTED files (they need the
# owner's review), any file the list does not name, and anything outside the staging allow-list (assert_staging_path).
# There is no "all": the kit changing never reinstalls files by itself.
set -Eeuo pipefail
M="${1:---report}"; shift || true
RESTORE=0; if [ "${1:-}" = --restore ]; then RESTORE=1; shift; fi
case "$M" in --report) LIBMODE=--plan ;; --execute) LIBMODE=--execute ;; *) echo "usage: $0 --report | --execute [--restore] <dest>..." >&2; exit 64 ;; esac
STAGE=RECONCILE; . "$(dirname "$0")/../lib.sh" "$LIBMODE"

entry_of() { installed_entries | awk -F'\t' -v d="$1" '$1 == d' | head -1; }
state_of() { local e; e="$(entry_of "$1")"; [ -n "$e" ] || { echo UNLISTED; return 0; }
  IFS=$'\t' read -r dest mode og src stage key flags <<< "$e"; installed_state "$dest" "$mode" "$og" "$src" "$stage" "$key" "$flags"; }

if [ "$M" = --report ]; then
  [ -d "$STATE_DIR" ] || { echo "reconcile: no state directory $STATE_DIR (kit not installed here)" >&2; exit 3; }
  n=0 attention=0
  while IFS=$'\t' read -r dest mode og src stage key flags; do
    st="$(installed_state "$dest" "$mode" "$og" "$src" "$stage" "$key" "$flags")"; n=$((n + 1))
    case "$st" in UNCHANGED|NOT-INSTALLED) ;; *) attention=$((attention + 1)) ;; esac
    printf '%-22s %-4s %-5s %s\n' "$st" "$stage" "${mode}" "$dest"
  done < <(installed_entries)
  while IFS= read -r x; do [ -z "$x" ] || { printf '%-22s %-4s %-5s %s\n' UNEXPECTED - - "$x"; attention=$((attention + 1)); }; done < <(installed_extras)
  echo "RECONCILE-REPORT listed=$n attention=$attention (UNCHANGED and NOT-INSTALLED need nothing; PROPOSED waits for the owner; anything else blocks every stage)"
  exit 0
fi

[ "$#" -gt 0 ] || stop_now "name each file to reconcile (there is no 'all')"
stage_begin
grep -q '^stages=.*\bRECONCILE\b' "$STATE_DIR/AUTHORIZED" || stop_now "RECONCILE is not in this window's recorded owner authorization"
ts="$(date -u +%Y%m%dT%H%M%SZ)"; reload=0
for d in "$@"; do
  e="$(entry_of "$d")"; [ -n "$e" ] || stop_now "$d is not in units/installed-files.tsv: never changed by the kit"
  IFS=$'\t' read -r dest mode og src stage key flags <<< "$e"
  assert_staging_path "$dest"
  st="$(installed_state "$dest" "$mode" "$og" "$src" "$stage" "$key" "$flags")"
  if [ "$RESTORE" = 1 ]; then
    [ "$st" = UNCHANGED ] || stop_now "restore $dest: it is $st, not the version reconcile installed"
    prev="$(ls -d "$STATE_DIR"/installed-previous/*/ 2> /dev/null | sort | while read -r p; do [ -f "$p${dest#/}" ] && echo "$p${dest#/}"; done | tail -1)"
    [ -n "$prev" ] || stop_now "restore $dest: no kept previous version"
    act install -m "$mode" -o "${og%%:*}" -g "${og##*:}" "$prev" "$dest"
    printf '%s restore %s <- %s (owner-authorized; kit %s)\n' "$ts" "$dest" "$prev" "$KIT_VERSION" >> "$STATE_DIR/RECONCILED.log"
    say "restored: $dest from $prev"
  else
    case "$st" in
      OUTDATED*|PROPOSED) ;;
      UNCHANGED) say "unchanged: $dest (nothing to do)"; continue ;;
      *) stop_now "$dest is $st: reconcile replaces only OUTDATED (a known earlier kit version) or installs PROPOSED files; this one needs the owner's review" ;;
    esac
    if [ -e "$dest" ]; then
      keep="$STATE_DIR/installed-previous/$ts${dest}"
      install -d -m 0700 "$(dirname "$keep")"
      cp -p -- "$dest" "$keep" && chmod 0400 "$keep"
      cmp -s "$dest" "$keep" || stop_now "the kept copy of $dest differs"
    fi
    act install -m "$mode" -o "${og%%:*}" -g "${og##*:}" "$KIT_HERE/$src" "$dest"
    [ "$(installed_state "$dest" "$mode" "$og" "$src" "$stage" "$key" "$flags")" = UNCHANGED ] || stop_now "$dest does not equal the kit after reconcile"
    printf '%s %s %s -> kit %s (owner-authorized)%s\n' "$ts" "$dest" "$st" "$KIT_VERSION" "${keep:+; previous kept as $keep}" >> "$STATE_DIR/RECONCILED.log"
    say "reconciled: $dest ($st → this kit)${keep:+; previous kept read-only as $keep}"
    unset keep
  fi
  case "$dest" in /etc/systemd/system/*) reload=1 ;; esac
done
[ "$reload" = 0 ] || sctl daemon-reload
say "nothing was restarted: a unit change takes effect at that unit's next (separately authorized) restart; the wrapper at its next run"
guard_shared
