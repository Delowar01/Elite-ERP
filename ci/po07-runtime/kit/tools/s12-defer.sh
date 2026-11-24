#!/usr/bin/env bash
# PO-07 S12 DEFERRAL — the owner's decision of 24 Nov 2026 (Prompt 7, "final staging deployment — backup requirement
# deferred"): the additional backup infrastructure (encrypted backups, off-host copy, restore drill) waits until the
# system is complete and verified for production. S12 is recorded as
#     DEFERRED BY OWNER — REQUIRED BEFORE FINAL PRODUCTION DEPLOYMENT
# and moves to Prompt 15 (Production Readiness).
#   tools/s12-defer.sh --plan | --status | --execute     (--execute: S12DEFER must be in this window's owner authorization)
# What the record does: it lets S13 proceed on THIS isolated, fictional-data staging only.
# What it never does:
#   - it is never S12 PASS: S12.done is not written; tools/acceptance-status.sh keeps production readiness BLOCKED;
#   - it is bound to this host (machine-id) and this staging database;
#   - it is refused here, and void at every S13 run, unless every env file points only at the isolated staging cluster
#     (no other database URL, no Neon) with the fictional fake storage, and the database is a _test_only_ one;
#   - it installs, starts, buys or provisions nothing (no backup unit, timer, bucket, key or subscription), and touches
#     no existing backup of the ERP or of any other application.
# The S12 tooling (s12_backup.sh, tools/backup-run.sh, offsite-run.sh, restore-verify.sh, pc-restore-drill.sh) stays in
# the kit, CI-verified, for Prompt 15.
STAGE=S12DEFER; . "$(dirname "$0")/../lib.sh" "$([ "${1:-}" = --status ] && echo --plan || echo "${1:---plan}")"
R="$STATE_DIR/S12.deferred"
if [ "${1:-}" = --status ]; then
  if [ -f "$STATE_DIR/S12.done" ]; then echo "S12: ACCEPTED (backup, off-host copy and restore drill passed)"
  elif s12_deferral_valid; then echo "S12: $S12_DEFER_DECISION — valid for this isolated fictional-data staging only (recorded $(sed -n 's/^recorded=//p' "$R"))"
  elif [ -f "$R" ]; then echo "S12: a deferral is recorded but VOID here: $(staging_only_reasons | tr '\n' ';')"
  else echo "S12: neither accepted nor deferred"; fi
  exit 0
fi
stage_begin S9
if [ "$MODE" = plan ]; then
  plan "check that this is the isolated fictional-data staging (every env file's database URLs = 127.0.0.1:$PG_PORT/$DB, no Neon, STORAGE_DRIVER=fake, a _test_only_ database); write $R (root 0600): the owner's decision, scope, host, database, window, kit; never S12.done; nothing installed or started"
  exit 0
fi
[ ! -f "$STATE_DIR/S12.done" ] || stop_now "S12 is already accepted: there is nothing to defer"
why="$(staging_only_reasons)"
[ -z "$why" ] || stop_now "this is not the isolated fictional-data staging, so S12 cannot be deferred here: $(tr '\n' ';' <<< "$why")"
assert_staging_cluster
guard_shared
t="$R.tmp"
{ printf 'decision=%s\n' "$S12_DEFER_DECISION"; printf 'scope=%s\n' "$S12_DEFER_SCOPE"
  printf 'recorded=%s\n' "$(date -u +%FT%TZ)"; printf 'owner_decision=24 Nov 2026, Prompt 7 (final staging deployment - backup requirement deferred)\n'
  printf 'moved_to=Prompt 15 - Production Readiness\n'; printf 'host=%s\n' "$(host_binding)"; printf 'db=%s\n' "$DB"
  printf 'window=%s/%s\n' "$WINDOW_START_UTC" "$WINDOW_END_UTC"; printf 'kit=%s\n' "$KIT_VERSION"
  printf 'not=S12 PASS; not valid for production, real customer data or Neon\n'; } > "$t"
chmod 0600 "$t"; mv -- "$t" "$R"
s12_deferral_valid || stop_now "the deferral record does not validate after writing it"
[ ! -f "$STATE_DIR/S12.done" ] || stop_now "S12.done appeared: the deferral must never mark S12 done"
guard_shared
say "S12: $S12_DEFER_DECISION — recorded for this isolated fictional-data staging only ($R). S12.done is NOT written; production readiness stays BLOCKED until S12 passes (Prompt 15)."
