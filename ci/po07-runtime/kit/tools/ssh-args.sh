# PO-07 SSH connection arguments (K6, 25 Nov 2026). Sourced (bash) by tools/pc-kit.sh after config.sh.
# shellcheck shell=bash
#
# The owner's existing alias ($SSH_ALIAS in ~/.ssh/config, IPv4 HostName) is reached over one of two routes:
#   ipv4   the alias exactly as configured;
#   nat64  the same IPv4 address, synthesized into the well-known NAT64 prefix 64:ff9b::/96 (RFC 6052), for a client
#          network with no IPv4 route (24 Nov 2026, owner decision in the window).
# Both routes use ONE trusted host identity: HostKeyAlias=$VPS_IPV4, the name under which the owner's known_hosts holds
# the VPS key. Host-key checking is strict in both (a changed key is refused, never accepted); known_hosts is never
# written (UpdateHostKeys=no); no agent, X11 or port forwarding; BatchMode=yes, so the key comes from the owner's
# ssh-agent and a passphrase is never asked for, typed or captured. Route: $PO07_SSH_ROUTE, else $SSH_ROUTE (config.sh).
SSH_BIN="${PO07_SSH_BIN:-/c/Windows/System32/OpenSSH/ssh.exe}"

# nat64_of IPV4 — the RFC 6052 well-known-prefix address, e.g. 192.0.2.33 → 64:ff9b::c000:221. Refuses anything that
# is not a dotted quad of decimal octets 0–255 without leading zeros.
nat64_of() {
  local o='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])'
  [[ "$1" =~ ^$o\.$o\.$o\.$o$ ]] || return 1
  printf '64:ff9b::%x:%x\n' $(( (BASH_REMATCH[1] << 8) | BASH_REMATCH[2] )) $(( (BASH_REMATCH[3] << 8) | BASH_REMATCH[4] ))
}

# ssh_args [ROUTE] — the complete ssh command, one argument per line. Fails (and prints nothing on stdout) for an
# unknown route, a missing alias or a malformed VPS_IPV4.
ssh_args() {
  local route="${1:-${PO07_SSH_ROUTE:-${SSH_ROUTE:-ipv4}}}" h
  [[ "${SSH_ALIAS:-}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ssh-args: SSH_ALIAS is missing or malformed" >&2; return 1; }
  nat64_of "${VPS_IPV4:-}" > /dev/null || { echo "ssh-args: VPS_IPV4 is not an IPv4 address" >&2; return 1; }
  case "$route" in
    ipv4) h="" ;;
    nat64) h="$(nat64_of "$VPS_IPV4")" ;;
    *) echo "ssh-args: unknown route '$route' (ipv4 | nat64)" >&2; return 1 ;;
  esac
  printf '%s\n' "$SSH_BIN" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o "HostKeyAlias=$VPS_IPV4" \
    -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=4
  [ -z "$h" ] || printf '%s\n' -o "HostName=$h"
  printf '%s\n' "$SSH_ALIAS"
}

# ssh_route — the route in effect (for messages).
ssh_route() { printf '%s' "${PO07_SSH_ROUTE:-${SSH_ROUTE:-ipv4}}"; }
