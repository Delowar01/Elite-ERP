#!/usr/bin/env bash
# PO-07: staging acceptance versus final production readiness — READ-ONLY (as root on the VPS; changes nothing).
#   tools/acceptance-status.sh                       both reports
#   tools/acceptance-status.sh --require staging     exit 0 only if staging acceptance is complete
#   tools/acceptance-status.sh --require production  exit 0 only if production readiness is complete — never from this kit
# Staging acceptance (this isolated fictional-data staging): S1–S9 done; the website security verified (S11.tls-ok and
# S11.phaseB-ok); S12 accepted OR validly deferred by the owner (staging only); S13 F1–F7 on (S13.done).
# Production readiness (Prompt 15): S12 must be ACCEPTED (a deferral never counts), and every item of
# units/production-gates.tsv must be closed outside this kit; so this kit always reports production BLOCKED.
STAGE=STATUS; . "$(dirname "$0")/../lib.sh" --plan
REQ=""; [ "${1:-}" = --require ] && REQ="${2:-}"
case "$REQ" in ""|staging|production) ;; *) echo "usage: $0 [--require staging|production]" >&2; exit 64 ;; esac
sb=(); s() { [ -f "$STATE_DIR/$1" ]; }
echo "== STAGING ACCEPTANCE (the isolated fictional-data staging only)"
for st in S1 S2 S3 S4 S5 S6 S7 S8 S9; do s "$st.done" || sb+=("$st not done"); done
echo "   S1–S9: $([ ${#sb[@]} -eq 0 ] && echo done || echo "${sb[*]}")"
for m in S11.tls-ok S11.phaseB-ok; do
  if s "$m"; then l="$(sed -n '1p' "$STATE_DIR/$m")"; echo "   $m: recorded (${l:0:120})"; else echo "   $m: MISSING"; sb+=("$m missing"); fi
done
if s S12.done; then echo "   S12: ACCEPTED"
elif s12_deferral_valid; then echo "   S12: $S12_DEFER_DECISION (staging-only deferral; valid here)"
else echo "   S12: neither accepted nor validly deferred"; sb+=("S12 neither accepted nor deferred"); fi
on="$(switches_on | tr -d '\n')"
if s S13.done && [ "$on" = F1F2F3F4F5F6F7 ]; then echo "   S13: F1–F7 on"; else echo "   S13: switches on: ${on:-none}"; sb+=("S13 F1–F7 not all on"); fi
echo "   (the owner's functional acceptance checklist is recorded outside the kit)"
if [ ${#sb[@]} -eq 0 ]; then echo "STAGING: COMPLETE"; else echo "STAGING: INCOMPLETE — $(printf '%s; ' "${sb[@]}")"; fi
echo
echo "== FINAL PRODUCTION READINESS (Prompt 15) — never granted by the staging kit"
pb=()
if s S12.done; then echo "   S12 backup and restore verification: PASSED"
else echo "   S12 backup and restore verification: NOT PASSED$(s12_deferral_valid && echo " ($S12_DEFER_DECISION)")"; pb+=("S12"); fi
while IFS=$'\t' read -r id item; do
  case "$id" in ""|\#*|S12) continue ;; esac
  echo "   OPEN  $id — $item"; pb+=("$id")
done < "$KIT_HERE/units/production-gates.tsv"
echo "PRODUCTION: BLOCKED — $(printf '%s ' "${pb[@]}")(closed only in Prompt 15, outside this staging kit)"
case "$REQ" in
  staging) [ ${#sb[@]} -eq 0 ] && exit 0 || exit 3 ;;
  production) exit 3 ;;
esac
exit 0
