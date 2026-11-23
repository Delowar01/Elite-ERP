#!/usr/bin/env bash
# PO-07 CI rehearsal of S1 → S9 (S6 = S6-R) and the full rollback, on a GitHub-hosted runner, as root.
#   sudo -E bash rehearsal.sh <dir holding the verified archive and ARTIFACT.json> <run id>
# Uses ci/po07-runtime/kit/: the private staging kit rendered with fictional values (tools/render-ci.sh): the SAME
# stage scripts, units, wrapper and probes as on the VPS; only the VPS-identity, window and authorization gates and the
# shared-service guard are replaced (see the end of kit/lib.sh). Fictional data only; nothing leaves the runner.
set -Eeuo pipefail
export LC_ALL=C
[ "${GITHUB_ACTIONS:-}" = true ] && [ "$(id -u)" -eq 0 ] || { echo "rehearsal.sh: GitHub Actions runner, as root, only" >&2; exit 64; }
ART="$(realpath "${1:?artifact dir}")"; RUN_ID="${2:?run id}"
: "${PINNED_ARCHIVE_SHA256:?the owner-approved archive SHA-256 (workflow env)}"
HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck disable=SC1091
. "$HERE/kit/config.sh"
A="po07-staging-build-${APPROVED_SHA:0:12}.tar.gz"
step() { echo "::group::$1"; }
end() { echo "::endgroup::"; }
fail() { echo "::endgroup::"; echo "::error::$*"; for f in "$STATE_DIR"/logs/*.log; do [ -f "$f" ] && { echo "--- $f (tail)"; tail -25 "$f"; }; done; exit 1; }

step "the stand-in web-server group (only root and this group may open the proxy sockets)"
getent group "$NGINX_GROUP" >/dev/null || groupadd --system "$NGINX_GROUP"
end

step "install the rendered kit at $KIT_DIR (root 0700) and take the CI S0"
install -d -m 0700 "$KIT_DIR" "$STATE_DIR" "$STATE_DIR/logs"
cp -a "$HERE/kit/." "$KIT_DIR/"; chmod -R go-rwx "$KIT_DIR"
ss -ltnH | awk '{print $4}' | sort -u > "$STATE_DIR/baseline-tcp.txt"
ss -lxH | awk '{print $5}' | grep '^/' | sort -u > "$STATE_DIR/baseline-unix.txt"
systemctl list-units --type=service --state=running --no-legend --plain --no-pager | awk '{print $1}' | sort > "$STATE_DIR/baseline-units.txt"
sum16() { sha256sum | cut -c1-16; }
{ echo "B_TIME=$(date -u +%FT%TZ)"; echo "B_EPOCH=$(date -u +%s)"
  echo "B_LINKS=$(ip -o link | sed -E 's/ (link\/ether|brd) [0-9a-f:]+//g' | sum16)"; echo "B_ROUTES4=$(ip route | sum16)"
  echo "B_ROUTES6=$(ip -6 route | sum16)"; echo "B_UFW=$(ufw status verbose 2>/dev/null | sum16)"; echo "B_SWAP_MB=0"; } > "$STATE_DIR/baseline.env"
echo "host TCP listeners before S1: $(tr '\n' ' ' < "$STATE_DIR/baseline-tcp.txt")"
end

step "place the verified archive as pc-kit.sh artifact-upload would (root 0600) and its expected values"
install -d -m 0700 "$INCOMING_DIR" "$INCOMING_DIR/run$RUN_ID"
install -m 0600 "$ART/$A" "$INCOMING_DIR/run$RUN_ID/$A"
ASHA="$(sha256sum "$ART/$A" | cut -d' ' -f1)"
[ "$ASHA" = "$PINNED_ARCHIVE_SHA256" ] || fail "archive SHA-256 $ASHA is not the owner-approved $PINNED_ARCHIVE_SHA256"
RUN_ID="$RUN_ID" A="$A" ASHA="$ASHA" node -e '
  const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), e = process.env;
  const kv = { run_id: e.RUN_ID, artifact_id: "ci", archive: e.A, archive_sha256: e.ASHA, zip_sha256: "ci", source_sha: a.source.sha, source_tree: a.source.tree,
    build_id: a.build_id, workflow_commit: a.workflow.commit, node: a.runtime.node, next: a.runtime.next, npm: a.runtime.npm, max_glibc: a.native_modules.max_glibc,
    files: a.contents.files, symlinks: a.contents.symlinks, lockfile_sha256: a.inputs.lockfile_sha256, attested: "ci-pinned-sha256", fetched_at: new Date().toISOString() };
  process.stdout.write(Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");' "$ART/ARTIFACT.json" > "$STATE_DIR/ARTIFACT.expected"
chmod 0600 "$STATE_DIR/ARTIFACT.expected"
end

for s in s1_users s2_slice_netns s3_pgcluster s4_roles_db s5_clone s6r_install_artifact s7_envfiles s8_vnet_migrate s9_units_start; do
  step "$s --execute"
  bash "$KIT_DIR/$s.sh" --execute || fail "$s failed"
  end
done

step "S6-R again (re-entrant: must re-check the installed build, not reinstall)"
out="$(bash "$KIT_DIR/s6r_install_artifact.sh" --execute 2>&1)" || { echo "$out" | tail -30; fail "S6-R re-run failed"; }
echo "$out" | grep -q "already installed" || fail "S6-R re-run did not recognise the installed build"
echo "$out" | grep -E "already installed|SHA-256|S6 COMPLETE" | head -5
end

step "after S9: content through the sockets, restart, concurrency, integrity, journal, footprint"
printf '{"adminHost":"%s","custHost":"%s","adminSock":"%s","custSock":"%s","appDir":"%s","manifest":"%s"}\n' \
  "$ADMIN_HOST" "$CUST_HOST" "$RUN_DIR/admin.sock" "$RUN_DIR/customer.sock" "$APP_SRC" "$STATE_DIR/artifact/MANIFEST.sha256" > "$STATE_DIR/after-s9.json"
node "$HERE/after-s9.mjs" "$STATE_DIR/after-s9.json" || fail "after-S9 checks failed"
bash "$KIT_DIR/tools/footprint.sh"
end

step "rollback all --execute (S9 → S1), then nothing of the staging may remain"
bash "$KIT_DIR/rollback.sh" all --execute || fail "rollback failed"
left=""
for u in elite-po-admin.service elite-po-customer.service elite-po-admin-proxy.socket elite-po-customer-proxy.socket elite-po-staging-netns.service elite-po-staging.slice "postgresql@16-$CLUSTER.service" elite-po-install.service; do
  [ "$(systemctl show -p LoadState --value "$u")" = not-found ] || left="$left unit:$u($(systemctl show -p LoadState,ActiveState --value "$u" | tr '\n' '/'))"
done
for p in "$APP_DIR" "$ETC_DIR" "$RUN_DIR" "$PG_RUN" "/etc/postgresql/16/$CLUSTER" "/var/lib/postgresql/16/$CLUSTER" /usr/local/sbin/elite-po-run /etc/tmpfiles.d/elite-po-staging.conf "/run/netns/$NS"; do
  [ ! -e "$p" ] || left="$left path:$p"
done
for u in "$APP_USER" "$PG_USER"; do getent passwd "$u" >/dev/null && left="$left user:$u"; done
[ -z "$left" ] || fail "left after rollback:$left"
[ ! -e "$VAR_DIR" ] || echo "note: $VAR_DIR kept by rollback S9 because the fictional storage is not empty: $(find "$VAR_DIR" -type f | wc -l) file(s) (the owner decides, plan §J step 7)"
newtcp="$(comm -13 "$STATE_DIR/baseline-tcp.txt" <(ss -ltnH | awk '{print $4}' | sort -u) | tr '\n' ' ')"
[ -z "$newtcp" ] || fail "host TCP listener(s) left after rollback: $newtcp"
echo "rollback removed every staging unit, path, user and listener; the archive stays in $INCOMING_DIR for audit"
end
echo "REHEARSAL PASS: S1–S9 (S6 = S6-R) and the full rollback"
