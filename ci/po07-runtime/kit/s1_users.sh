#!/usr/bin/env bash
# S1 — the two system users (plan §A-1, §N S1). Stop: either name taken by something this kit did not create.
STAGE=S1; . "$(dirname "$0")/lib.sh"
stage_begin ""
guard_shared
start_thresholds
user_ok() { # NAME HOME — exists exactly as this kit creates it
  local e uid gid home shell
  e="$(getent passwd "$1")" || return 1
  IFS=: read -r _ _ uid gid _ home shell <<<"$e"
  [ "$uid" -lt 1000 ] && [ "$home" = "$2" ] && [ "$shell" = /usr/sbin/nologin ] &&
    [ "$(getent group "$1" | cut -d: -f3)" = "$gid" ] && [ "$(id -Gn "$1")" = "$1" ]
}
mk_user() { # NAME HOME
  if [ "$MODE" = execute ] && getent passwd "$1" >/dev/null; then
    [ -f "$STATE_DIR/S1.created.$1" ] || stop_now "user $1 exists and was not created by this kit"
    user_ok "$1" "$2" || stop_now "user $1 exists but differs from the kit's definition"
    say "exists (kit): $1"; return 0
  fi
  if [ "$MODE" = execute ] && getent group "$1" >/dev/null; then stop_now "group $1 is taken"; fi
  act useradd --system --user-group --home-dir "$2" --no-create-home --shell /usr/sbin/nologin \
    --comment "PO-07 staging (fictional data only)" "$1"
  if [ "$MODE" = execute ]; then date -u +%FT%TZ > "$STATE_DIR/S1.created.$1"; fi
  check "user $1 is a system account, nologin, home $2, member of its own group only" user_ok "$1" "$2"
}
mk_user "$APP_USER" "$APP_DIR"
mk_user "$PG_USER" /nonexistent
# The app user's home (root:po07app 0750). The app tree and the build home are created under it at S5.
mkdir_staging "$APP_DIR" 0750 "root:$APP_USER"
guard_shared
mark_done
