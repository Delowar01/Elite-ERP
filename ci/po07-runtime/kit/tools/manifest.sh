# PO-07 kit manifest parsing (K1, 25 Nov 2026). Sourced (bash) by tools/kit-install.sh on the VPS and by the PC tools.
# shellcheck shell=bash
#
# A kit manifest is the output of `sha256sum` over the kit's files, run from the kit directory. Two line formats are
# accepted, and nothing else:
#   <64 lowercase hex>  ./<path>     GNU coreutils on Linux (text-mode marker: two spaces)
#   <64 lowercase hex> *./<path>     Git Bash / MSYS coreutils on Windows (binary-mode marker: space, asterisk)
# The 24 Nov 2026 failure: the retire step stripped only the first form, so every Windows line kept its hash and
# marker, no installed file matched, and all 45 kit files were classified as retired.
# Rejected, with the line number: any other layout (a leading backslash, i.e. sha256sum's escaped names; upper-case or
# short hashes; a tab; a carriage return), an absolute path, a path without the "./" prefix, an empty, "." or ".."
# component, a character outside [A-Za-z0-9._@+-], a duplicate path, and any path under state/ or incoming/ (those
# hold the kit's records and the transferred archive, never kit files).

# manifest_path_ok PATH — true for "./a/b" with safe components only.
manifest_path_ok() {
  local p="$1"
  [[ "$p" =~ ^\./[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$ ]] || return 1
  case "/${p#./}/" in */../*|*/./*) return 1 ;; esac
  case "${p#./}" in state|state/*|incoming|incoming/*) return 1 ;; esac
  return 0
}

# manifest_paths FILE — prints the manifest's paths ("./rel/path"), sorted (C locale), one per line. Returns 1 with
# the reason on stderr if any line is not acceptable; prints nothing in that case.
manifest_paths() {
  local f="$1" line p n=0
  local -A seen=()
  local out=()
  [ -f "$f" ] && [ ! -L "$f" ] || { echo "manifest: not a regular file: $f" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in *$'\r'*) echo "manifest: line $n: carriage return (CRLF)" >&2; return 1 ;; esac
    [[ "$line" =~ ^[0-9a-f]{64}\ [\ *](.+)$ ]] || { echo "manifest: line $n: not '<sha256>  ./path' or '<sha256> *./path'" >&2; return 1; }
    p="${BASH_REMATCH[1]}"
    manifest_path_ok "$p" || { echo "manifest: line $n: unsafe or unexpected path: $p" >&2; return 1; }
    [ -z "${seen[$p]:-}" ] || { echo "manifest: line $n: duplicate entry: $p" >&2; return 1; }
    seen[$p]=1; out+=("$p")
  done < "$f"
  [ "${#out[@]}" -gt 0 ] || { echo "manifest: no entries" >&2; return 1; }
  printf '%s\n' "${out[@]}" | LC_ALL=C sort
}

# kit_tree_files DIR — the files of an installed (or transferred) kit as "./rel/path", sorted; state/ and incoming/
# excluded. Symbolic links are listed too, so a caller can refuse them.
kit_tree_files() {
  (cd "$1" && find . \( -path ./state -o -path ./incoming \) -prune -o \( -type f -o -type l \) -print | LC_ALL=C sort)
}
