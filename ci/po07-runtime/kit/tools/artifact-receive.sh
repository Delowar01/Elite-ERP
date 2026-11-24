#!/usr/bin/env bash
# PO-07 K2 (24 Nov 2026): receive the S6-R archive ON THE VPS without ever giving an unverified file its final name.
#   artifact-receive.sh --status <incoming dir> <run id> <archive> <sha256>
#       prints absent | verified | DIFFERS (an existing final file with other bytes) — reads nothing from stdin
#   artifact-receive.sh <incoming dir> <run id> <archive> <sha256> <size> <source sha> <source tree> <build id> < archive
# The 24 Nov 2026 defect: the transfer wrote .part and renamed it BEFORE the SHA-256 check, so an interrupted transfer
# (the sender killed; the remote cat saw end-of-file) got the final name with 77 of 249 MB.
# Here:
#   1. stdin goes to a NEW temporary file <dir>/run<id>/.receiving.<archive>.<UTC>.<random> (0600), under a lock;
#   2. its size and SHA-256 must equal the expected values (an interrupted, truncated or padded transfer fails here);
#   3. its po07-artifact/ARTIFACT.json must name the expected run, source commit, tree and build;
#   4. only then is it hard-linked to the final name: atomic, and never over an existing file;
#   5. <archive>.verified (0600) records what was verified, and when.
# A transfer that fails any step, or is interrupted (SIGHUP/INT/TERM), is moved to run<id>/quarantine/ (0700; the
# file 0400) with the reason in its name. S6-R and recovery-authorize open only the final name and require the
# .verified record, so a quarantined or leftover .receiving file can never be used. An existing final file is never
# replaced. Earlier evidence in the directory (e.g. the 24 Nov partial copy) is left exactly as it is.
set -Eeuo pipefail
umask 077
export LC_ALL=C
die() { echo "artifact-receive: refused: $*" >&2; exit 3; }
valid_base() { [[ "$1" = /* ]] && [[ "$2" =~ ^[0-9]{1,20}$ ]] && [[ "$3" =~ ^po07-staging-build-[0-9a-f]{12}\.tar\.gz$ ]] && [[ "$4" =~ ^[0-9a-f]{64}$ ]]; }
status_of() { # FINAL SHA → absent | verified | DIFFERS
  if [ ! -e "$1" ] && [ ! -L "$1" ]; then echo absent
  elif [ -f "$1" ] && [ ! -L "$1" ] && [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ] && [ -f "$1.verified" ] && grep -qx "sha256=$2" "$1.verified"; then echo verified
  else echo DIFFERS; fi
}
if [ "${1:-}" = --status ]; then
  valid_base "${2:-}" "${3:-}" "${4:-}" "${5:-}" || die "malformed arguments"
  status_of "$2/run$3/$4" "$5"; exit 0
fi
D="${1:?incoming dir}"; RUN="${2:?run id}"; A="${3:?archive}"; SHA="${4:?sha256}"; SIZE="${5:?size}"; SRC="${6:?source sha}"; TREE="${7:?tree}"; BUILD="${8:?build id}"
valid_base "$D" "$RUN" "$A" "$SHA" && [[ "$SIZE" =~ ^[1-9][0-9]{0,12}$ ]] && [[ "$SRC" =~ ^[0-9a-f]{40}$ ]] && [[ "$TREE" =~ ^[0-9a-f]{40}$ ]] &&
  [[ "$BUILD" =~ ^[A-Za-z0-9_-]{8,64}$ ]] || die "malformed expected values"
R="$D/run$RUN"; Q="$R/quarantine"; F="$R/$A"
for p in "$D" "$R"; do [ ! -L "$p" ] || die "$p is a link"; [ -d "$p" ] || install -d -m 0700 "$p"; done
[ ! -L "$F" ] || die "the final name is a link"
case "$(status_of "$F" "$SHA")" in
  verified) echo "artifact-receive: already verified: $F (nothing transferred, nothing changed)"; exit 0 ;;
  DIFFERS) die "$F exists and is not the verified archive: left untouched (review it)" ;;
esac
LOCK="$R/.receive.lock"
mkdir -m 0700 "$LOCK" 2> /dev/null || die "another transfer holds $LOCK (remove it only after checking no transfer runs)"
tmp="$(mktemp "$R/.receiving.$A.$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
quarantine() { # REASON-TAG MESSAGE
  install -d -m 0700 "$Q"
  local q; q="$Q/$(basename "$tmp").$1"
  if [ -e "$tmp" ]; then mv -- "$tmp" "$q" && chmod 0400 "$q"; fi
  echo "artifact-receive: quarantined $q: $2 (never usable by S6-R)" >&2
}
cleanup() { rmdir "$LOCK" 2> /dev/null || true; }
trap cleanup EXIT
trap 'quarantine interrupted "the transfer was interrupted"; exit 3' HUP INT TERM
cat > "$tmp" || { quarantine read-error "reading the transfer failed"; exit 3; }
size="$(stat -c %s "$tmp")"
[ "$size" = "$SIZE" ] || { quarantine bad-size "$size bytes, expected $SIZE (an incomplete or padded transfer)"; exit 3; }
got="$(sha256sum "$tmp" | cut -d' ' -f1)"
[ "$got" = "$SHA" ] || { quarantine bad-sha256 "SHA-256 $got, expected $SHA (a damaged or different file)"; exit 3; }
ident="$(tar -xzOf "$tmp" po07-artifact/ARTIFACT.json 2> /dev/null | node -e '
  let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
    try { const a = JSON.parse(s); console.log([a.source.sha, a.source.tree, a.build_id, a.workflow.run_id].join(" ")); } catch { console.log("unreadable"); } });' || echo unreadable)"
[ "$ident" = "$SRC $TREE $BUILD $RUN" ] || { quarantine bad-identity "ARTIFACT.json names [$ident], expected [$SRC $TREE $BUILD $RUN]"; exit 3; }
ln -- "$tmp" "$F" 2> /dev/null || { quarantine name-taken "the final name appeared during the transfer"; exit 3; }
rm -f -- "$tmp"
chmod 0600 "$F"
printf 'archive=%s\nsha256=%s\nsize=%s\nrun_id=%s\nsource_sha=%s\nsource_tree=%s\nbuild_id=%s\nverified_at=%s\n' \
  "$A" "$SHA" "$SIZE" "$RUN" "$SRC" "$TREE" "$BUILD" "$(date -u +%FT%TZ)" > "$F.verified.tmp"
mv -- "$F.verified.tmp" "$F.verified"
echo "artifact-receive: verified and published: $F ($SIZE bytes, SHA-256 $SHA, build $BUILD)"
