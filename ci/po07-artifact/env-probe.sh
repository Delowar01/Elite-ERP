#!/usr/bin/env bash
# PO-07 S6-R: which runtime values would a build embed?
#   env-probe.sh <app dir> <canary file out> <report.json>
# Builds ONCE with a unique random canary in every string value the staging env files (and the code) read at runtime,
# limited to 2 CPUs (the staging VPS's count, so the measured memory is comparable), then searches the whole build
# output for every canary. Any hit means that value would be fixed at build time: FAIL. The probe build is then
# deleted; the artifact is built afterwards, clean, with none of these variables set.
# Switches compared with a literal ("true", a number) cannot be detected by a search, because a compiler folds the
# comparison; they are proven to be read at run time by the H-1 suite, which runs the ONE artifact build as the console
# (switch on, one trusted proxy), as the customer (switch unset) and unbound.
set -Eeuo pipefail
export LC_ALL=C
APP="$(cd "${1:?app dir}" && pwd -P)"; CAN="${2:?canary file}"; REP="${3:?report}"
HERE="$(cd "$(dirname "$0")" && pwd -P)"
tok() { printf 'po07canary%s' "$(openssl rand -hex 12)"; }
FEK="$(openssl rand -base64 32)"
declare -A T
for k in DB AUTH PAUTH CONSOLE CUSTOMER ORIGIN PDF INVITE CHROME PACK STORE RATES LEGACY; do T[$k]="$(tok)"; done
probe_env=(
  "DATABASE_URL=postgres://po07canarydb:${T[DB]}@127.0.0.1:9/po07canary_build_test_only_"
  "AUTH_SECRET=${T[AUTH]}"
  "PLATFORM_AUTH_SECRET=${T[PAUTH]}"
  "FIELD_ENCRYPTION_KEYS=1:${FEK}"
  "PLATFORM_CONSOLE_HOST=${T[CONSOLE]}.invalid"
  "CUSTOMER_APP_HOST=${T[CUSTOMER]}.invalid"
  "CUSTOMER_PUBLIC_ORIGIN=https://${T[ORIGIN]}.invalid"
  "PDF_RENDER_ORIGIN=http://${T[PDF]}.invalid:3300"
  "PLATFORM_INVITATIONS_LOOPBACK_ORIGIN=http://${T[INVITE]}.invalid:3310"
  "CHROMIUM_EXECUTABLE_PATH=/opt/${T[CHROME]}/chrome"
  "CHROMIUM_PACK_URL=https://${T[PACK]}.invalid/chromium.tar"
  "STORAGE_DRIVER=fake"
  "STORAGE_FAKE_DIR=/var/${T[STORE]}/storage"
  "RATE_API_BASE=https://${T[RATES]}.invalid"
  "CUSTOMER_LEGACY_TOKENS=${T[LEGACY]}"
  "PLATFORM_TRUSTED_PROXY_HOPS=1"
  "PDF_DEBUG_ERRORS=0"
)
{
  printf 'DATABASE_URL password\t%s\n' "${T[DB]}"
  printf 'AUTH_SECRET\t%s\n' "${T[AUTH]}"
  printf 'PLATFORM_AUTH_SECRET\t%s\n' "${T[PAUTH]}"
  printf 'FIELD_ENCRYPTION_KEYS\t%s\n' "$FEK"
  printf 'PLATFORM_CONSOLE_HOST\t%s\n' "${T[CONSOLE]}"
  printf 'CUSTOMER_APP_HOST\t%s\n' "${T[CUSTOMER]}"
  printf 'CUSTOMER_PUBLIC_ORIGIN\t%s\n' "${T[ORIGIN]}"
  printf 'PDF_RENDER_ORIGIN\t%s\n' "${T[PDF]}"
  printf 'PLATFORM_INVITATIONS_LOOPBACK_ORIGIN\t%s\n' "${T[INVITE]}"
  printf 'CHROMIUM_EXECUTABLE_PATH\t%s\n' "${T[CHROME]}"
  printf 'CHROMIUM_PACK_URL\t%s\n' "${T[PACK]}"
  printf 'STORAGE_FAKE_DIR\t%s\n' "${T[STORE]}"
  printf 'RATE_API_BASE\t%s\n' "${T[RATES]}"
  printf 'CUSTOMER_LEGACY_TOKENS\t%s\n' "${T[LEGACY]}"
} > "$CAN"
cd "$APP"
rm -rf .next
MEASURE_CPUS=2 bash "$HERE/measure.sh" "probe_build_2cpu" "$REP" "$RUNNER_TEMP/env-probe-build.log" -- \
  taskset -c 0,1 env "${probe_env[@]}" node node_modules/next/dist/bin/next build || { tail -40 "$RUNNER_TEMP/env-probe-build.log"; echo "::error::the env-probe build failed"; exit 1; }
grep -q "Compiled successfully" "$RUNNER_TEMP/env-probe-build.log" || { echo "::error::probe build: no 'Compiled successfully'"; exit 1; }
hits=0
while IFS=$'\t' read -r name value; do
  files="$(grep -rlaF -- "$value" .next | wc -l)"
  if [ "$files" -gt 0 ]; then echo "::error::$name is embedded at build time ($files file(s) under .next)"; hits=$((hits + 1))
  else echo "runtime-only: $name (canary absent from all of .next)"; fi
done < "$CAN"
rm -rf .next
git checkout --quiet -- next-env.d.ts 2>/dev/null || true
[ "$hits" -eq 0 ] || exit 1
echo "ENV-PROBE PASS: $(wc -l < "$CAN") runtime values, none embedded in the build output"
