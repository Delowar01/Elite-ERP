#!/usr/bin/env bash
# PO-07 S6-R packager: the output of ONE verified build and its dependencies → one archive.
#   package.sh <app dir> <out dir> <archive base name>
# Environment (set by the workflow): APPROVED_SHA APPROVED_TREE SOURCE_BRANCH GITHUB_* RUNNER_* ImageOS ImageVersion
#   NATIVE_FILE (native-module report)  BUILD_REPORT (build measurements, JSON)  CANARY_FILE (env-probe canaries)
#
# Layout of the archive (one top-level directory, installed by S6-R into the verified clone of the same commit):
#   po07-artifact/.next/           the build output, minus the build cache and build traces; an empty .next/cache
#                                  (the staging units mount it read-write)
#   po07-artifact/node_modules/    exactly what `npm ci` installed from the committed lockfile
#   po07-artifact/MANIFEST.sha256  SHA-256 of every file;  SYMLINKS.txt  every link and its target
#   po07-artifact/ARTIFACT.json    provenance (source commit and tree, lockfile hash, build id, versions, counts)
# The tracked files (src, public, package.json, package-lock.json, next.config.ts, scripts, …) are NOT in the archive:
# on the VPS they come from the clone that S5 verified at the same commit and tree, byte-identical to what was built.
set -Eeuo pipefail
export LC_ALL=C
APP="$(cd "${1:?app dir}" && pwd -P)"; OUTARG="${2:?out dir}"; NAME="${3:?archive base name}"
HERE="$(cd "$(dirname "$0")" && pwd -P)"
mkdir -p "$OUTARG"; OUT="$(cd "$OUTARG" && pwd -P)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
R="$WORK/po07-artifact"; mkdir "$R"
fail() { echo "::error::package: $*"; echo "PACKAGE FAIL: $*" >&2; exit 1; }
[ -s "$APP/.next/BUILD_ID" ] || fail "no build output (.next/BUILD_ID)"
[ -d "$APP/node_modules" ] || fail "no node_modules"

echo "1. copy the build output and the installed dependencies (links stay links)"
cp -a "$APP/.next" "$R/.next"
rm -rf "$R/.next/cache" "$R/.next/trace" "$R/.next/trace-build"
mkdir "$R/.next/cache"
cp -a "$APP/node_modules" "$R/node_modules"

echo "2. names and file types the archive validator accepts"
odd="$(cd "$R" && find .next node_modules -name $'*[\t\n\r\\\\]*' -print -quit)"; [ -z "$odd" ] || fail "file name with a tab, newline or backslash: $odd"
sp="$(cd "$R" && find .next node_modules ! -type f ! -type d ! -type l -print -quit)"; [ -z "$sp" ] || fail "special file: $sp"
# Hard links (esbuild's install script links its binary to the platform package's copy) become independent copies:
# the archive never carries a hard link. Listed first, then each replaced by a copy of itself.
(cd "$R" && find .next node_modules -type f -links +1 -print0) > "$WORK/hardlinks.lst"
hardlinks=0
while IFS= read -r -d '' f; do
  cp -p -- "$R/$f" "$R/$f.po07-copy" && mv -f -- "$R/$f.po07-copy" "$R/$f"; hardlinks=$((hardlinks + 1))
  echo "   hard link replaced by a copy: $f"
done < "$WORK/hardlinks.lst"
hl="$(cd "$R" && find .next node_modules -type f -links +1 -print -quit)"; [ -z "$hl" ] || fail "hard-linked file: $hl"
su="$(cd "$R" && find .next node_modules ! -type l -perm /7000 -print -quit)"; [ -z "$su" ] || fail "setuid/setgid/sticky: $su"
gw="$(cd "$R" && find .next node_modules ! -type l -perm /022 | wc -l)"
[ "$gw" -eq 0 ] || { echo "   removing group/world write permission from $gw entries"; find "$R" ! -type l -perm /022 -exec chmod go-w {} +; }

echo "3. links must stay inside the artifact; absolute links into the build tree become the equivalent relative link"
: > "$WORK/rewrites.tsv"
while IFS= read -r -d '' l; do
  t="$(readlink -- "$l")"; rel="${l#"$R"/}"
  if [[ "$t" == /* ]]; then
    rt="$(realpath -m -- "$t")"   # canonical (the build path may be spelled through a symlink)
    case "$rt" in "$APP"/*) ;; *) fail "link $rel -> $t points outside the build tree";; esac
    inside="${rt#"$APP"/}"
    [ -e "$R/$inside" ] || fail "link $rel -> $t: its target is not packaged"
    new="$(realpath -s -m --relative-to="$(dirname -- "$l")" -- "$R/$inside")"
    ln -sfn -- "$new" "$l"
    printf '%s\t%s\n' "$rel" "$new" >> "$WORK/rewrites.tsv"
    echo "   rewrote $rel -> $new (was the absolute build path of $inside)"
  fi
done < <(find "$R" -type l -print0)
while IFS= read -r -d '' l; do
  rp="$(realpath -m -- "$l")"
  case "$rp" in "$R"/*) ;; *) fail "link ${l#"$R"/} resolves outside the artifact";; esac
  [ -e "$l" ] || fail "dangling link ${l#"$R"/} -> $(readlink -- "$l")"
done < <(find "$R" -type l -print0)

echo "4. secret scan of the staged tree (values never printed)"
scan_args=()
[ -n "${CANARY_FILE:-}" ] && scan_args+=(--canaries "$CANARY_FILE")
for v in ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_RESULTS_URL GITHUB_TOKEN; do scan_args+=(--forbid-env "$v"); done
node "$HERE/scan-artifact.mjs" "$R" "${scan_args[@]}"

echo "5. manifest and link list"
(cd "$R" && find .next node_modules -type f -print0 | sort -z | xargs -0 sha256sum) > "$R/MANIFEST.sha256"
! grep -q '^\\' "$R/MANIFEST.sha256" || fail "sha256sum escaped a file name"
(cd "$R" && find .next node_modules -type l -printf '%p\t%l\n' | sort) > "$R/SYMLINKS.txt"

echo "6. provenance (ARTIFACT.json)"
APP="$APP" R="$R" REWRITES="$WORK/rewrites.tsv" HARDLINKS="$WORK/hardlinks.lst" node - <<'EOF'
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const e = process.env, R = e.R, APP = e.APP;
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const shaText = (p) => crypto.createHash("sha256").update(fs.readFileSync(p, "utf8")).digest("hex");
const lines = (p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
const manifest = lines(path.join(R, "MANIFEST.sha256"));
let bytes = 0;
for (const l of manifest) bytes += fs.statSync(path.join(R, l.slice(66))).size;
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const art = {
  schema: "po07-staging-artifact/1",
  purpose: "Platform Owner staging (fictional data only); installed by the private staging kit's S6-R",
  build_id: fs.readFileSync(path.join(R, ".next/BUILD_ID"), "utf8").trim(),
  source: { repository: `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}`, branch: e.SOURCE_BRANCH, sha: e.APPROVED_SHA, tree: e.APPROVED_TREE },
  workflow: { file: ".github/workflows/po07-staging-artifact.yml", commit: e.GITHUB_SHA, ref: e.GITHUB_REF, event: e.GITHUB_EVENT_NAME,
    run_id: e.GITHUB_RUN_ID, run_attempt: e.GITHUB_RUN_ATTEMPT, run_url: `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}` },
  runner: { os: e.ImageOS ?? null, image_version: e.ImageVersion ?? null, environment: e.RUNNER_ENVIRONMENT ?? null, arch: process.arch, platform: process.platform },
  runtime: { node: process.version, npm: e.NPM_VERSION ?? null, next: readJson(path.join(R, "node_modules/next/package.json"), {}).version ?? null },
  inputs: {
    lockfile_sha256: sha(path.join(APP, "package-lock.json")), package_json_sha256: sha(path.join(APP, "package.json")),
    next_config_sha256: sha(path.join(APP, "next.config.ts")),
    build_environment: { DATABASE_URL: "postgres://build@127.0.0.1:9/build_test_only_ (fictional, unreachable, no password)", NEXT_TELEMETRY_DISABLED: "1", CI: "1", NODE_ENV: "production (set by next build)" },
  },
  contents: {
    files: manifest.length, symlinks: lines(path.join(R, "SYMLINKS.txt")).length, bytes,
    manifest_sha256: shaText(path.join(R, "MANIFEST.sha256")), symlinks_sha256: shaText(path.join(R, "SYMLINKS.txt")),
    excluded: [".next/cache/* (build cache; the directory is shipped empty)", ".next/trace", ".next/trace-build"],
    symlink_rewrites: lines(e.REWRITES).map((l) => { const [link, target] = l.split("\t"); return { link, target }; }),
    hard_links_copied: fs.readFileSync(e.HARDLINKS, "utf8").split("\0").filter(Boolean),
  },
  native_modules: e.NATIVE_FILE && fs.existsSync(e.NATIVE_FILE) ? readJson(e.NATIVE_FILE, null) : null,
  build_measurements: e.BUILD_REPORT && fs.existsSync(e.BUILD_REPORT) ? readJson(e.BUILD_REPORT, null) : null,
  created_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(R, "ARTIFACT.json"), JSON.stringify(art, null, 2) + "\n");
console.log(`   build_id=${art.build_id} files=${art.contents.files} symlinks=${art.contents.symlinks} bytes=${bytes} rewrites=${art.contents.symlink_rewrites.length}`);
EOF

echo "7. archive (POSIX pax, sorted, numeric owner 0, one fixed mtime: the source commit's)"
MTIME="$(git -C "$APP" log -1 --format=%cI "$APPROVED_SHA")"
tar --format=pax --pax-option='exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime' --sort=name \
  --owner=0 --group=0 --numeric-owner --mtime="$MTIME" -C "$WORK" -cf - po07-artifact | gzip -n -6 > "$OUT/$NAME.tar.gz"
cp "$R/ARTIFACT.json" "$OUT/ARTIFACT.json"
(cd "$OUT" && sha256sum "$NAME.tar.gz" ARTIFACT.json > SHA256SUMS)
echo "   $(cd "$OUT" && head -1 SHA256SUMS) ($(stat -c %s "$OUT/$NAME.tar.gz") bytes)"
echo "PACKAGE PASS"
