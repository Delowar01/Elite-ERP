#!/usr/bin/env bash
# S8 — V-NET for the tool path, then the migrations of plan §M step 1, all through elite-po-run (plan §B.2, §N S8).
# L-3 is approved for staging (PO07_EXISTING_VPS_PREFLIGHT.md), so the staged user_invitations step runs too.
# Stop: any V-NET failure; the guard not refusing a non-loopback target; any non-zero tool exit.
STAGE=S8; . "$(dirname "$0")/lib.sh"
stage_begin S7
guard_shared
start_thresholds
RUN=/usr/local/sbin/elite-po-run
step() { # NAME EXPECTED_EXIT ARGS... — one elite-po-run call, logged; output never contains a URL or secret
  local name="$1" want="$2"; shift 2
  if [ "$MODE" = plan ]; then plan "elite-po-run $* (expect exit $want)"; return 0; fi
  local log="$STATE_DIR/logs/S8-$name.txt" rc=0
  "$RUN" "$@" > "$log" 2>&1 < /dev/null || rc=$?
  tail -n 15 "$log" | sed -E 's#postgres(ql)?://[^ ]+#<redacted-url>#g'
  if grep -qE 'postgres(ql)?://[^<]' "$log"; then stop_now "$name: a connection string appeared in the output"; fi
  [ "$rc" -eq "$want" ] || stop_now "$name: exit $rc (expected $want); log $log"
  say "ok: $name (exit $rc)"
}
pty_ok() {
  [ "$MODE" = plan ] && { plan "elite-po-run --env admin pty-check (the owner's bootstrap path gets a terminal)"; return 0; }
  "$RUN" --env admin pty-check < /dev/null 2>&1 | tr -d '\r' | grep -q 'stdin-tty=true stdout-tty=true'
}
cred_hidden() { # the owner credential is not visible to the probe path (no LoadCredential there)
  [ "$MODE" = plan ] && { plan "verify: no owner credential in the probe environment"; return 0; }
  printf 'console.log(process.env.CREDENTIALS_DIRECTORY ? "HAS-CREDS" : "NO-CREDS")\n' | "$RUN" --env admin probe 2>&1 | grep -qx NO-CREDS
}
# ---- 1. V-NET, tool path (before any migration) ----
run_probe admin tool "$PG_PORT"
step guard-probe 2 --env admin guard-probe
check "the probe path carries no database credential" cred_hidden
# Informational only: this session has no terminal of its own, so a negative here is not conclusive; S9b re-checks
# it in the owner's interactive terminal before the bootstrap.
if pty_ok; then say "ok: elite-po-run --pty gives the command a terminal"; else say "NOTE: pty-check inconclusive from a non-interactive session; the owner re-checks it at S9b step 1"; fi
guard_shared
# ---- 2. migrations (§M step 1), owner role, inside the namespace ----
step manifest-check 0 --env admin manifest --check
step manifest-status-before 0 --env admin manifest --status
step apply-base 0 --env admin manifest --apply --base --concurrent-indexes --verify-data
guard_shared
step apply-l3 0 --env admin manifest --apply --concurrent-indexes --include-staged-user-invitations --verify-data
step manifest-status-after 0 --env admin manifest --status
step platform-db-check 0 --env admin npm run platform:db:check
step verify-db-hardening 0 --env admin npm run verify:db-hardening
# ---- 3. the runtime role: DML on what the owner created (default privileges set at S4; re-applied explicitly) ----
assert_staging_cluster
grants() {
  printf 'grant select, insert, update, delete on all tables in schema public to %s;\n' "$APP_ROLE"
  printf 'grant usage, select on all sequences in schema public to %s;\n' "$APP_ROLE"
}
if [ "$MODE" = plan ]; then plan "psql (peer, db $DB): grant DML on all tables and usage/select on all sequences in public to $APP_ROLE"
else grants | spsql "$DB" >/dev/null; fi
owner_owns_all() { [ "$(printf "select count(*) from pg_tables where schemaname = 'public' and tableowner <> '%s';\n" "$OWNER_ROLE" | spsql "$DB")" = 0 ]; }
app_no_ddl() { [ "$(printf "select count(*) from pg_tables t where schemaname = 'public' and (has_table_privilege('%s', t.schemaname||'.'||t.tablename, 'TRUNCATE') or has_table_privilege('%s', t.schemaname||'.'||t.tablename, 'TRIGGER'));\nselect has_schema_privilege('%s', 'public', 'CREATE');\n" "$APP_ROLE" "$APP_ROLE" "$APP_ROLE" | spsql "$DB" | tr '\n' ' ')" = "0 f " ]; }
app_dml() { [ "$(printf "select count(*) from pg_tables t where schemaname = 'public' and not has_table_privilege('%s', t.schemaname||'.'||t.tablename, 'SELECT,INSERT,UPDATE,DELETE');\n" "$APP_ROLE" | spsql "$DB")" = 0 ]; }
triggers_on() { [ "$(printf "select count(*) from pg_trigger where tgname in ('audit_logs_immutable','security_events_immutable') and tgenabled = 'O';\n" | spsql "$DB")" = 2 ]; }
no_admin_yet() { [ "$(printf "select count(*) from platform_admins;\n" | spsql "$DB")" = 0 ]; }
check "every table is owned by $OWNER_ROLE" owner_owns_all
check "$APP_ROLE has DML on every table" app_dml
check "$APP_ROLE has no TRUNCATE, TRIGGER or CREATE" app_no_ddl
check "both immutable-audit triggers are enabled" triggers_on
check "no platform administrator exists yet (S9b is the owner's)" no_admin_yet
guard_shared
mark_done
