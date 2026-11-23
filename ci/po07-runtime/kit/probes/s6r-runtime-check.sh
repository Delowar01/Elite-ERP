# S6-R runtime check. Piped to /bin/sh inside a read-only, network-less sandbox (transient unit, the app user),
# working directory = the installed app tree. Starts no server, writes only to its private /tmp.
set -eu
fail() { echo "FAIL $*"; exit 1; }
v="$(/usr/bin/node node_modules/next/dist/bin/next --version)"
echo "next --version: $v"
case "$v" in *"v$EXPECT_NEXT"*) ;; *) fail "next is not v$EXPECT_NEXT" ;; esac
/usr/bin/node - <<'EOF'
const { createRequire } = require("module"); const fs = require("fs"), path = require("path");
const root = process.cwd(), nmRoot = path.join(root, "node_modules") + path.sep, req = createRequire(path.join(root, "package.json"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
let bad = 0;
const deps = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies || {})];
for (const d of deps) {
  let p = null;
  for (const spec of [`${d}/package.json`, d]) { try { p = req.resolve(spec); break; } catch {} }
  if (!p || !fs.realpathSync(p).startsWith(nmRoot)) { console.log(`FAIL unresolved dependency ${d}`); bad++; }
}
console.log(`deps: ${deps.length} resolve inside node_modules (unresolved ${bad})`);
const nm = path.join(root, ".next", "node_modules"), server = path.join(root, ".next", "server");
const names = fs.existsSync(nm) ? fs.readdirSync(nm).flatMap((n) => (n.startsWith("@") ? fs.readdirSync(path.join(nm, n)).map((s) => `${n}/${s}`) : [n])) : [];
for (const n of names) {
  let ok = false;
  try { ok = fs.realpathSync(require.resolve(`${n}/package.json`, { paths: [server] })).startsWith(nmRoot); } catch {}
  console.log(`external ${n}: ${ok ? "resolves inside node_modules" : "DOES NOT RESOLVE"}`); if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
EOF
missing=0
checked=0
# the musl variants npm also installs can never load on glibc and are never selected there (as in CI)
for f in $(find node_modules -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' \) ! -path '*musl*'); do
  checked=$((checked + 1))
  if ldd "$f" 2>/dev/null | grep -q 'not found'; then echo "FAIL missing shared library for $f"; missing=$((missing + 1)); fi
done
echo "native: $checked glibc binaries checked, $missing with a missing library"
[ "$missing" -eq 0 ] || fail "native libraries"
npm ls --all > /tmp/npm-ls.txt 2>&1 || true
if grep -qE 'missing:|invalid:|UNMET|ERR!' /tmp/npm-ls.txt; then tail -15 /tmp/npm-ls.txt; fail "npm ls reports a missing or invalid package"; fi
echo "npm ls: no missing or invalid package"
echo "RUNTIME-CHECK PASS"
