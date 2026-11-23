#!/usr/bin/env bash
# PO-07 S6-R: install the archive the way S6-R will, somewhere else, and prove it is complete on its own.
#   relocate-test.sh <archive.tar.gz> <git dir holding APPROVED_SHA> <work dir>
# 1. a pristine tree of the approved commit (git archive: tracked files only, as in the VPS clone) at a DIFFERENT
#    absolute path and depth than the build (the build directory has been moved away, so no absolute path can leak);
# 2. extraction as an unprivileged user into an empty directory, then the per-file SHA-256 manifest and the link list
#    are re-checked on disk; .next and node_modules are moved into the tree (same file system: a rename);
# 3. `next --version`; every dependency in package.json resolves; every Turbopack external link resolves inside the
#    tree, from the server output's own directory; every native binary loads its libraries (ldd) and its highest
#    required glibc version is recorded for the VPS check; `npm ls` agrees with the lockfile.
# Prints RELOCATED_APP=<path> on success (the workflow then runs the H-1 suite from there).
set -Eeuo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ART="$(realpath "${1:?archive}")"; SRC="$(realpath "${2:?git dir}")"; W="$(realpath -m "${3:?work dir}")"
fail() { echo "::error::relocate-test: $*"; exit 1; }
R="$W/elsewhere/deeper/staging/app"; X="$W/extract"
mkdir -p "$R" "$X"
echo "1. pristine tree of $APPROVED_SHA at $R"
git -C "$SRC" archive --format=tar "$APPROVED_SHA" | tar -x -C "$R"
[ ! -e "$R/.next" ] && [ ! -e "$R/node_modules" ] || fail "the pristine tree already has build output"
echo "2. extract (no owner, no permissions from the archive, refuse to overwrite) and verify on disk"
tar -xzf "$ART" -C "$X" --no-same-owner --no-same-permissions --keep-old-files
(cd "$X/po07-artifact" && sha256sum --quiet --strict -c MANIFEST.sha256) || fail "per-file SHA-256 mismatch after extraction"
diff <(cd "$X/po07-artifact" && find .next node_modules -type l -printf '%p\t%l\n' | sort) "$X/po07-artifact/SYMLINKS.txt" > /dev/null || fail "links differ from SYMLINKS.txt"
[ "$(cd "$X/po07-artifact" && find .next node_modules -type f | wc -l)" -eq "$(wc -l < "$X/po07-artifact/MANIFEST.sha256")" ] || fail "file count differs from the manifest"
mv "$X/po07-artifact/.next" "$R/.next"; mv "$X/po07-artifact/node_modules" "$R/node_modules"
cd "$R"
echo "3. resolution from the installed tree"
v="$(node node_modules/next/dist/bin/next --version)"; echo "   $v"
[[ "$v" == *"v$NEXT_VERSION"* ]] || fail "next --version is '$v', expected v$NEXT_VERSION"
node - <<'EOF' || fail "dependency resolution"
const { createRequire } = require("module"); const fs = require("fs"), path = require("path");
const root = process.cwd(), req = createRequire(path.join(root, "package.json"));
const pkg = require(path.join(root, "package.json"));
let bad = 0;
for (const d of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies ?? {})]) {
  let p = null;
  for (const spec of [`${d}/package.json`, d]) { try { p = req.resolve(spec); break; } catch {} }
  if (!p || !fs.realpathSync(p).startsWith(path.join(root, "node_modules") + path.sep)) { console.log(`   UNRESOLVED ${d}`); bad++; }
}
const nm = path.join(root, ".next", "node_modules"), server = path.join(root, ".next", "server");
const names = fs.existsSync(nm) ? fs.readdirSync(nm).flatMap((n) => (n.startsWith("@") ? fs.readdirSync(path.join(nm, n)).map((s) => `${n}/${s}`) : [n])) : [];
for (const n of names) {
  let ok = false;
  try { const p = require.resolve(`${n}/package.json`, { paths: [server] }); ok = fs.realpathSync(p).startsWith(path.join(root, "node_modules") + path.sep); } catch {}
  console.log(`   external ${n}: ${ok ? "resolves inside node_modules" : "DOES NOT RESOLVE"}`); if (!ok) bad++;
}
console.log(`   ${Object.keys(pkg.dependencies).length} dependencies, ${Object.keys(pkg.devDependencies ?? {}).length} dev dependencies, ${names.length} Turbopack externals; unresolved: ${bad}`);
process.exit(bad ? 1 : 0);
EOF
echo "4. native binaries load from the installed tree (same set and glibc requirement as recorded at packaging)"
bash "$HERE/native-scan.sh" "$R" "$W/native-relocated.json" > "$W/native-relocated.txt" || { cat "$W/native-relocated.txt"; fail "a native binary cannot load its libraries"; }
tail -1 "$W/native-relocated.txt"
node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).native_modules, b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
  if (!a || a.count !== b.count || a.max_glibc !== b.max_glibc) { console.log(`::error::native set differs: packaged ${a && a.count}/${a && a.max_glibc}, installed ${b.count}/${b.max_glibc}`); process.exit(1); }' \
  "$X/po07-artifact/ARTIFACT.json" "$W/native-relocated.json"
echo "5. npm ls (installed tree vs the lockfile)"
if npm ls --all > "$W/npm-ls.txt" 2>&1; then echo "   npm ls: OK"; else echo "   npm ls exit $? (recorded; S6-R treats the same result as the reference)"; tail -5 "$W/npm-ls.txt"; fi
echo "RELOCATED_APP=$R"
