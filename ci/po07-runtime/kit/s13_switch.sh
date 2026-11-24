#!/usr/bin/env bash
# S13 — the feature switches F1–F7, ONE per run (plan §M; po06/SECURITY_AND_FLAG_MATRIX.md §2; owner policy S-7).
#   s13_switch.sh --plan | --status
#   s13_switch.sh --execute <F1..F7> on|off
# Gates (besides the kit's own): S12 accepted (S12.done: backup, off-host copy and restore drill passed); S11 verified
# (S11.phaseB-ok and S11.tls-ok, written by tools/s11-verify.sh); the owner's recorded authorization lists S13 AND this
# switch (F7 additionally means the owner's P-8 seat consent); strict order — on: F1..F(n-1) on, Fn..F7 off; off: F(n+1)..F7
# off; F5/F6 only after L-3 (the user_invitations table exists).
# Each run: the variable's line is rewritten in the env file(s) — never printed — with every other line unchanged; only
# the two staging app units restart; then the automated checks for this switch (below) and a footprint sample. Any
# failure turns the switch back to its previous state, restarts, re-checks, and STOPs with the evidence.
# Automated (no credentials): the variable is in exactly the right processes' environment (names only); the console
# route state (F1: admin /platform/login 200 on, 404 off; customer /platform/login always 404); the customer surface
# answers; no unhandled error in either app's journal since the restart. The functional acceptance of each switch
# (sign-in with MFA, company management, invitations, seats, …) is the owner's checklist (PO07_S10_S13_EXECUTION_PLAN.md
# §10), performed in the browser with fictional records only.
STAGE=S13; . "$(dirname "$0")/lib.sh" "${1:---plan}"
SW="${2:-}"; ACT="${3:-}"
if [ "${1:-}" = --status ]; then echo "switches on: $(switches_on | tr '\n' ' ')"; exit 0; fi
stage_begin S12
if [ "$MODE" = plan ]; then
  plan "one switch per run: rewrite its line in admin.env / both env files (never printed), restart the two app units, verify, record; revert on any failure"
  exit 0
fi
[[ "$SW" =~ ^F[1-7]$ ]] && [[ "$ACT" =~ ^(on|off)$ ]] || stop_now "usage: s13_switch.sh --execute <F1..F7> on|off"
grep -q "^stages=.*\b$SW\b" "$STATE_DIR/AUTHORIZED" || stop_now "$SW is not in this window's recorded owner authorization"
for m in S11.phaseB-ok S11.tls-ok; do [ -f "$STATE_DIR/$m" ] || stop_now "$m is not recorded (tools/s11-verify.sh): S13 follows S11b"; done
read -r _ VAR VAL FILES <<< "$(grep "^$SW " <<< "$SWITCHES")"
n="${SW#F}"; on="$(switches_on)"
if [ "$ACT" = on ]; then
  for i in $(seq 1 7); do
    if [ "$i" -lt "$n" ]; then grep -qx "F$i" <<< "$on" || stop_now "F$i must be on before $SW"
    else ! grep -qx "F$i" <<< "$on" || stop_now "F$i is on: $SW goes on only after F1..F$((n - 1)) and before F$((n + 1))"; fi
  done
  if [ "$n" -ge 5 ] && [ "$n" -le 6 ]; then
    [ "$(printf "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'user_invitations';\n" | spsql "$DB")" = 1 ] || stop_now "$SW needs L-3 (the user_invitations table)"
  fi
else
  grep -qx "$SW" <<< "$on" || stop_now "$SW is not on"
  for i in $(seq $((n + 1)) 7); do ! grep -qx "F$i" <<< "$on" || stop_now "turn F$i off first (reverse order)"; done
fi
guard_shared
targets() { case "$FILES" in admin) echo admin ;; both) echo "admin customer" ;; esac; }
set_line() { # STATE(on|off) — rewrite VAR's line in each target file; every other line must stay byte-identical
  local w f t restA restN
  for w in $(targets); do
    f="$ETC_DIR/$w.env"; t="$f.s13.tmp"
    restA="$(grep -v "^$VAR=" "$f" | sha256sum)"
    { grep -v "^$VAR=" "$f"; [ "$1" = off ] || printf '%s=%s\n' "$VAR" "$VAL"; } > "$t"
    chmod 0600 "$t"; chown root:root "$t"
    restN="$(grep -v "^$VAR=" "$t" | sha256sum)"
    [ "$restA" = "$restN" ] || { rm -f -- "$t"; stop_now "rewriting $w.env would change other lines"; }
    [ "$(grep -c "^$VAR=" "$t")" = "$([ "$1" = on ] && echo 1 || echo 0)" ] || { rm -f -- "$t"; stop_now "$w.env: $VAR not exactly as intended"; }
    mv -- "$t" "$f"
  done
  say "$VAR $([ "$1" = on ] && echo "set" || echo "removed") in: $(targets) (value not printed)"
}
record() { # the switch list after this run
  { switches_on | grep -vx "$SW"; [ "$1" = on ] && echo "$SW"; } | sort -u > "$STATE_DIR/S13.switches.tmp"; mv -- "$STATE_DIR/S13.switches.tmp" "$STATE_DIR/S13.switches"
}
get() { # SOCK HOST PATH → HTTP status (root opens the socket; X-Forwarded-* as nginx sets them)
  node -e 'const [s,h,p]=process.argv.slice(1);require("http").get({socketPath:s,path:p,headers:{host:h,"x-forwarded-host":h,"x-forwarded-proto":"https"}},r=>{console.log(r.statusCode);r.resume()}).on("error",()=>console.log(0)).setTimeout(20000,function(){this.destroy()})' "$1" "$2" "$3"; }
restart_apps() {
  local since; since="$(date -u '+%F %T')"
  sctl restart elite-po-admin.service elite-po-customer.service
  local i; for i in $(seq 1 45); do
    [ "$(get "$RUN_DIR/customer.sock" "$CUST_HOST" /login)" = 200 ] && [[ "$(get "$RUN_DIR/admin.sock" "$ADMIN_HOST" /platform/login)" =~ ^(200|404)$ ]] && { echo "$since"; return 0; }
    sleep 2; done
  echo "$since"; return 1
}
in_env() { # UNIT VAR=VAL → yes|no (the running process's environment; only the one variable is compared, nothing printed)
  local pid; pid="$(systemctl show -p MainPID --value "$1")"
  grep -qx -- "$2" <<< "$(tr '\0' '\n' < "/proc/$pid/environ")" && echo yes || echo no; }
verify() { # STATE SINCE → 0 when every automated check of this switch passes
  local want_a want_c a c f1 j
  want_a=$([ "$1" = on ] && echo yes || echo no); want_c=$([ "$1" = on ] && [ "$FILES" = both ] && echo yes || echo no)
  a="$(in_env elite-po-admin.service "$VAR=$VAL")"; c="$(in_env elite-po-customer.service "$VAR=$VAL")"
  [ "$a" = "$want_a" ] && [ "$c" = "$want_c" ] || { say "process environment: admin $a (want $want_a), customer $c (want $want_c)"; return 1; }
  f1=404; grep -qx F1 <<< "$( { switches_on | grep -vx "$SW"; [ "$1" = on ] && echo "$SW"; } )" && f1=200
  [ "$(get "$RUN_DIR/admin.sock" "$ADMIN_HOST" /platform/login)" = "$f1" ] || { say "admin /platform/login is not $f1"; return 1; }
  [ "$(get "$RUN_DIR/customer.sock" "$CUST_HOST" /platform/login)" = 404 ] || { say "the console answers on the customer host"; return 1; }
  [ "$(get "$RUN_DIR/customer.sock" "$CUST_HOST" /login)" = 200 ] || { say "the customer sign-in page does not answer"; return 1; }
  # captured first: a pipe into grep -q under pipefail can report "no match" when the writer dies of SIGPIPE
  j="$(journalctl -u elite-po-admin.service -u elite-po-customer.service --since "$2" -o cat --no-pager 2> /dev/null || true)"
  if grep -qiE 'unhandled|uncaught|EACCES|EROFS|Error: ' <<< "$j"; then say "an app logged an error since the restart"; return 1; fi
  if s13_ci_fault "$SW"; then say "CI fault injection for $SW"; return 1; fi
  return 0
}
prev="$(grep -qx "$SW" <<< "$on" && echo on || echo off)"
set_line "$ACT"
since="$(restart_apps)" || { set_line "$prev"; restart_apps > /dev/null || true; stop_now "$SW $ACT: the apps did not come back; $SW is back $prev"; }
if verify "$ACT" "$since"; then
  record "$ACT"
  printf '%s %s %s: automated checks passed; switches on: %s\n' "$(date -u +%FT%TZ)" "$SW" "$ACT" "$(switches_on | tr '\n' ' ')" >> "$STATE_DIR/S13.log"
  say "$SW $ACT: the automated checks passed. Now the owner's acceptance checklist for $SW (fictional records only); on any failure: s13_switch.sh --execute $SW off"
else
  journalctl -u elite-po-admin.service -u elite-po-customer.service --since "$since" -o cat --no-pager 2> /dev/null | tail -40 > "$STATE_DIR/logs/S13-$SW-$ACT-failure-$(date -u +%Y%m%dT%H%M%SZ).txt" || true
  set_line "$prev"
  since2="$(restart_apps)" || true
  verify "$prev" "$since2" > /dev/null 2>&1 && back=verified || back="NOT verified"
  printf '%s %s %s FAILED; reverted to %s (%s)\n' "$(date -u +%FT%TZ)" "$SW" "$ACT" "$prev" "$back" >> "$STATE_DIR/S13.log"
  stop_now "$SW $ACT failed its checks; $SW is back $prev ($back); evidence in $STATE_DIR/logs/S13-$SW-$ACT-failure-*"
fi
guard_shared
[ "$(switches_on | tr -d '\n')" = "F1F2F3F4F5F6F7" ] && mark_done || true
