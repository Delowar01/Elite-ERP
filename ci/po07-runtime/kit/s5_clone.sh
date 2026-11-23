#!/usr/bin/env bash
# S5 — the approved code (plan §N S5): the public repository at APPROVED_SHA, cloned as the app user, detached and
# verified by commit AND tree hash. No credential is used. Stop: SHA or tree mismatch; a dirty tree; H-1 absent.
STAGE=S5; . "$(dirname "$0")/lib.sh"
stage_begin S4
guard_shared
start_thresholds
as_app() { runuser -u "$APP_USER" -- env HOME="$BUILD_HOME" GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 "$@"; }
mkdir_staging "$BUILD_HOME" 0700 "$APP_USER:$APP_USER"
if [ "$MODE" = execute ] && [ -e "$APP_SRC/.git" ]; then
  [ "$(as_app git -C "$APP_SRC" rev-parse HEAD)" = "$APPROVED_SHA" ] || stop_now "$APP_SRC exists at another commit (not removed automatically)"
  say "clone exists at the approved commit: re-verifying"
else
  if [ "$MODE" = execute ] && [ -e "$APP_SRC" ] && [ -n "$(ls -A "$APP_SRC")" ]; then stop_now "$APP_SRC exists and is not empty"; fi
  mkdir_staging "$APP_SRC" 0750 "$APP_USER:$APP_USER"
  act as_app git clone --quiet --no-checkout --single-branch --branch "$REPO_BRANCH" "$REPO_URL" "$APP_SRC"
  act as_app git -C "$APP_SRC" -c advice.detachedHead=false checkout --quiet --detach "$APPROVED_SHA"
fi
head_ok() { [ "$(as_app git -C "$APP_SRC" rev-parse HEAD)" = "$APPROVED_SHA" ]; }
tree_ok() { [ "$(as_app git -C "$APP_SRC" rev-parse 'HEAD^{tree}')" = "$APPROVED_TREE" ]; }
clean_ok() { [ -z "$(as_app git -C "$APP_SRC" status --porcelain --untracked-files=all)" ]; }
fsck_ok() { as_app git -C "$APP_SRC" fsck --no-progress --connectivity-only >/dev/null 2>&1; }
h1_ok() {
  [ -f "$APP_SRC/src/lib/security/host-binding.ts" ] && [ -f "$APP_SRC/verify/verify-platform-host-binding.mts" ] &&
    grep -q 'key: "next-action"' "$APP_SRC/src/proxy.ts" && grep -q 'PLATFORM_CONSOLE_HOST' "$APP_SRC/src/lib/security/host-binding.ts"
}
check "HEAD is exactly $APPROVED_SHA" head_ok
check "the tree hash equals the one computed on the PC ($APPROVED_TREE)" tree_ok
check "the working tree is clean (no untracked or modified file)" clean_ok
check "git fsck (connectivity) passes" fsck_ok
check "H-1 is present (host-binding helper, its suite, the Next-Action matcher entry)" h1_ok
guard_shared
mark_done
