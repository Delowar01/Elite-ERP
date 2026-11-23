#!/usr/bin/env bash
# PO-07 §F footprint sample (READ-ONLY): slice and unit memory/CPU, host memory/swap/load, ERP PID. One line per call;
# run it repeatedly (e.g. every 60 s for ≥ 30 min after S9, including a PDF burst at S13) to build the §F evidence.
# A unit that is not loaded yet (before S9) or exposes no counter prints "-" (kit-1 failed on "[not set]" CPU values).
set -u; export LC_ALL=C
num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; }   # systemd prints "[not set]", "infinity" or nothing
mb() { if num "$1"; then echo "$(( $1 / 1048576 ))MB"; else echo "-"; fi; }
secs() { if num "$1"; then echo "$(( $1 / 1000000000 ))s"; else echo "-"; fi; }
line="$(date -u +%FT%TZ)"
for u in elite-po-staging.slice elite-po-admin.service elite-po-customer.service postgresql@16-po07ns.service elite-po-admin-proxy.service elite-po-customer-proxy.service; do
  if [ "$(systemctl show -p LoadState --value "$u" 2>/dev/null)" != loaded ]; then line="$line | ${u%%.*} not-loaded"; continue; fi
  cur="$(systemctl show -p MemoryCurrent --value "$u" 2>/dev/null)"; peak="$(systemctl show -p MemoryPeak --value "$u" 2>/dev/null)"
  cpu="$(systemctl show -p CPUUsageNSec --value "$u" 2>/dev/null)"
  line="$line | ${u%%.*} cur=$(mb "$cur") peak=$(mb "$peak") cpu=$(secs "$cpu")"
done
line="$line | host MemAvailable=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)MB swap=$(awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print int((t-f)/1024)}' /proc/meminfo)MB load=$(cut -d' ' -f1 /proc/loadavg) | ERP MainPID=$(systemctl show -p MainPID --value po07-absent-erp.service) $(systemctl is-active po07-absent-erp.service)"
echo "$line"
