#!/usr/bin/env bash
# PO-07 S6-R: every native (ELF) binary in node_modules, its highest required glibc symbol version, and whether its
# shared libraries load here (ldd). Fails if any library is missing.
#   native-scan.sh <dir containing node_modules> <out.json>
set -Eeuo pipefail
export LC_ALL=C
cd "${1:?dir}"; OUT="$(realpath -m "${2:?out.json}")"
tsv="$(mktemp)"
while IFS= read -r -d '' f; do
  case "$(file -b "$f")" in ELF*) ;; *) continue ;; esac
  # npm installs every libc variant of an optional native package; the musl builds can never load on glibc (Ubuntu)
  # and their loaders pick the -gnu build there. Recorded, not checked.
  case "$f" in *musl*) printf '%s\tmusl\t0\n' "$f" >> "$tsv"; continue ;; esac
  # (pipefail: grep finding nothing — a static binary, a library with no missing dependency — is not an error)
  g="$( { objdump -T "$f" 2>/dev/null || true; } | { grep -o 'GLIBC_[0-9][0-9.]*' || true; } | sed 's/GLIBC_//' | sort -Vu | tail -1)"
  nf="$( { ldd "$f" 2>/dev/null || true; } | { grep -c 'not found' || true; })"
  printf '%s\t%s\t%s\n' "$f" "${g:-none}" "$nf" >> "$tsv"
done < <(find node_modules -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' -o -path '*/bin/*' \) -print0)
sort -o "$tsv" "$tsv"
awk -F'\t' '{printf "   %s glibc>=%s missing-libs=%s\n", $1, $2, $3}' "$tsv"
TSV="$tsv" node -e '
  const fs = require("fs"), rows = fs.readFileSync(process.env.TSV, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const max = rows.map((r) => r[1]).filter((v) => /^[0-9.]+$/.test(v)).sort(cmp).pop() ?? null;
  const missing = rows.filter((r) => Number(r[2]) > 0).map((r) => r[0]);
  const musl = rows.filter((r) => r[1] === "musl").length;
  const runner = require("child_process").execSync("ldd --version").toString().split("\n")[0];
  fs.writeFileSync(process.argv[1], JSON.stringify({ count: rows.length, glibc_checked: rows.length - musl, musl_unused: musl, max_glibc: max, build_host_glibc: runner, binaries: rows.map(([path, glibc]) => ({ path, glibc })) }, null, 2) + "\n");
  console.log(`   ${rows.length} native binaries (${musl} musl variants, unused on glibc); highest glibc symbol version required: ${max}; build host: ${runner}`);
  if (missing.length) { console.log(`::error::native binaries with missing libraries: ${missing.join(", ")}`); process.exit(1); }
' "$OUT"
rm -f "$tsv"
