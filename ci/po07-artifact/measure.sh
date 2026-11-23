#!/usr/bin/env bash
# PO-07 S6-R: run a command and record its resource use (for the corrected build-resource figures).
#   measure.sh <label> <report.json> <log file> -- command...
# Records: wall time, the largest single process's peak RSS (/usr/bin/time -v, when installed), and the peak of the summed
# RSS of every node / next-* process sampled once a second (the whole build tree, type-check workers included), the CPU
# count the command was allowed (sched affinity), and the exit code. The command's output goes to the log file.
set -Euo pipefail
export LC_ALL=C
label="${1:?label}"; rep="${2:?report}"; log="${3:?log}"; shift 3
[ "${1:-}" = -- ] && shift
peakf="$(mktemp)"; echo 0 > "$peakf"
(
  while sleep 1; do
    s="$(ps -e -o rss=,args= | awk '$2 ~ /(^|\/)node$/ || $2 ~ /^next-/ {t += $1} END {print t + 0}')"
    [ "$s" -gt "$(cat "$peakf")" ] && echo "$s" > "$peakf"
  done
) &
sampler=$!
start=$(date +%s)
if [ -x /usr/bin/time ]; then /usr/bin/time -v -o "$log.time" "$@" > "$log" 2>&1; rc=$?; else "$@" > "$log" 2>&1; rc=$?; : > "$log.time"; fi
end=$(date +%s)
kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
cpus="$(taskset -p $$ 2>/dev/null | awk '{print $NF}')"
LABEL="$label" REP="$rep" RC="$rc" WALL=$((end - start)) PEAK_KB="$(cat "$peakf")" CPUS_MASK="$cpus" TIMEF="$log.time" CMDCPUS="${MEASURE_CPUS:-$(nproc)}" node -e '
  const fs = require("fs"), e = process.env;
  const t = fs.existsSync(e.TIMEF) ? fs.readFileSync(e.TIMEF, "utf8") : "";
  const maxKb = Number((/Maximum resident set size \(kbytes\): (\d+)/.exec(t) || [])[1] || 0);
  const r = fs.existsSync(e.REP) ? JSON.parse(fs.readFileSync(e.REP, "utf8")) : {};
  r[e.LABEL] = { exit_code: Number(e.RC), wall_seconds: Number(e.WALL), cpus: Number(e.CMDCPUS),
    max_single_process_rss_mb: maxKb ? Math.round(maxKb / 1024) : null, peak_summed_rss_mb: Math.round(Number(e.PEAK_KB) / 1024) };
  fs.writeFileSync(e.REP, JSON.stringify(r, null, 2) + "\n");
  console.log(`measure ${e.LABEL}: ${JSON.stringify(r[e.LABEL])}`);
'
rm -f "$peakf"
exit "$rc"
