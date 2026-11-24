#!/usr/bin/env bash
# PO-07 kit update ON THE VPS (K1 + K6, 25 Nov 2026), run by `pc-kit.sh update` from the freshly transferred copy:
#   kit-install.sh <incoming dir> <kit dir>
# pc-kit.sh sends the new kit and its records as ONE tar stream over ONE SSH connection into a new, empty
# <kit dir>.incoming.XXXXXX (root 0700), then runs this script from there. <incoming dir> holds:
#   kit/    the new kit files            state/  AUTHORIZED, baseline.env, baseline-{units,tcp,unix}.txt, KIT.sha256
# Nothing in <kit dir> changes until the transferred copy is complete and verified (an interrupted transfer stops
# the tar, and this script never runs; a damaged one fails a check below):
#   1. the manifest parses (tools/manifest.sh: Linux and Windows line formats; no traversal, absolute or duplicate path);
#   2. every transferred file verifies against it, nothing extra, no link or special file;
#   3. the new authorization is for the new config's window;
#   4. retire candidates (installed kit files the new manifest does not list) are regular files inside the kit, at most
#      10, and fewer than all installed files (on 24 Nov 2026 the defect classified all 45 as retired).
# Then: the previous records are kept as <name>.until-<ts>; the new files are copied in; each retired file is MOVED,
# never deleted, to state/retired/<ts>/<its relative path>; the new records are placed; the installed kit must verify
# against the manifest with no file the manifest does not list. state/ and incoming/ are never touched otherwise.
set -Eeuo pipefail
umask 077
export LC_ALL=C
IN="${1:?incoming dir}"; KD="${2:?kit dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=manifest.sh
. "$HERE/manifest.sh"
RECORDS=(AUTHORIZED baseline.env baseline-units.txt baseline-tcp.txt baseline-unix.txt KIT.sha256)
die() { echo "kit-install: refused: $* — the installed kit is unchanged" >&2; exit 3; }

[[ "$IN" = /* ]] && [[ "$KD" = /* ]] || die "both paths must be absolute"
[ -d "$KD" ] && [ ! -L "$KD" ] && [ -d "$KD/state" ] && [ ! -L "$KD/state" ] || die "$KD is not an installed kit"
[ -d "$IN" ] && [ ! -L "$IN" ] && [ -d "$IN/kit" ] && [ ! -L "$IN/kit" ] && [ -d "$IN/state" ] && [ ! -L "$IN/state" ] || die "incomplete transfer (no kit/ or state/)"
for f in "${RECORDS[@]}"; do [ -f "$IN/state/$f" ] && [ ! -L "$IN/state/$f" ] || die "incomplete transfer: state/$f is missing"; done
M="$IN/state/KIT.sha256"
paths="$(manifest_paths "$M")" || die "the manifest is malformed"
[ -z "$(find "$IN/kit" ! -type f ! -type d -print -quit)" ] || die "the transferred kit holds a link or a special file"
(cd "$IN/kit" && sha256sum --quiet --strict -c "$M") > /dev/null 2>&1 || die "the transferred kit does not verify against its manifest (an incomplete or damaged transfer)"
got="$(kit_tree_files "$IN/kit")"
[ "$got" = "$paths" ] || die "the transferred kit is not exactly the manifest: $(diff <(printf '%s\n' "$paths") <(printf '%s\n' "$got") | grep '^[<>]' | head -5 | tr '\n' ' ')"
win="$(bash -c '. "$1"; printf "%s/%s" "$WINDOW_START_UTC" "$WINDOW_END_UTC"' _ "$IN/kit/config.sh")"
grep -qx "window=$win" "$IN/state/AUTHORIZED" || die "the new authorization is not for the new config's window ($win)"

inst="$(kit_tree_files "$KD")"
retire="$(comm -23 <(printf '%s\n' "$inst") <(printf '%s\n' "$paths") | sed '/^$/d')"
n_inst="$(printf '%s\n' "$inst" | sed '/^$/d' | wc -l)"; n_ret="$(printf '%s' "$retire" | sed '/^$/d' | wc -l)"
[ "$n_ret" -le 10 ] || die "$n_ret installed files would be retired (more than 10): the manifest or the transfer is wrong"
[ "$n_inst" -eq 0 ] || [ "$n_ret" -lt "$n_inst" ] || die "every installed kit file would be retired"
while IFS= read -r p; do
  [ -n "$p" ] || continue
  manifest_path_ok "$p" || die "retire candidate $p has an unsafe path"
  [ -f "$KD/$p" ] && [ ! -L "$KD/$p" ] || die "retire candidate $p is not a regular file (links are never followed)"
done <<< "$retire"

# ---- from here the installed kit changes ----
ts="$(date -u +%Y%m%dT%H%M%SZ)"
for f in "${RECORDS[@]}"; do if [ -f "$KD/state/$f" ]; then mv -- "$KD/state/$f" "$KD/state/$f.until-$ts"; fi; done
(cd "$IN/kit" && tar -cf - .) | tar -xf - -C "$KD" --no-same-owner
while IFS= read -r p; do
  [ -n "$p" ] || continue
  r="${p#./}"; install -d -m 0700 "$KD/state/retired/$ts/$(dirname "$r")"
  mv -- "$KD/$p" "$KD/state/retired/$ts/$r"
  echo "retired: $p → state/retired/$ts/$r"
done <<< "$retire"
for f in "${RECORDS[@]}"; do cp -- "$IN/state/$f" "$KD/state/$f"; done
chmod -R go-rwx "$KD"
(cd "$KD" && sha256sum --quiet --strict -c state/KIT.sha256) || { echo "kit-install: FAILED after the update: the installed kit does not verify (records of the previous kit: state/*.until-$ts)" >&2; exit 4; }
[ "$(kit_tree_files "$KD")" = "$paths" ] || { echo "kit-install: FAILED after the update: the installed kit holds files the manifest does not list" >&2; exit 4; }
echo "kit installed: $(printf '%s\n' "$paths" | wc -l) files, manifest $(sha256sum < "$KD/state/KIT.sha256" | cut -c1-16) verified on the VPS; retired: $n_ret; previous records kept as state/*.until-$ts"
case "$IN" in "$KD".incoming.??????) rm -rf --one-file-system -- "$IN" ;; esac
