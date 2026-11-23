#!/usr/bin/env bash
# S6-R — install the verified external build. Replaces the on-VPS build (owner decision S6-R1, 23 Nov 2026).
# Nothing is built, installed from the network or started here. GitHub Actions (workflow po07-staging-artifact) built
# and verified the approved commit; on the PC, `pc-kit.sh artifact-fetch` checked the run, its commit, the artifact
# digest, the Sigstore attestation and the validator; `pc-kit.sh artifact-upload` put the archive in $INCOMING_DIR
# (root 0700) and its expected values in $STATE_DIR/ARTIFACT.expected. This stage:
#   1. §I guard and start thresholds (against the fresh S0 of this window);
#   2. the approved SHA and tree in the S5 clone; tracked files unchanged;
#   3. S1–S5 intact: users, directories, slice, the namespace with lo only, the staging cluster (in the namespace,
#      127.0.0.1:<PG_PORT> only), unprivileged roles, the database's owner, no host listener on the staging ports;
#   4. the archive: root-only file; SHA-256 = the PC-verified digest; the VPS runtime = the artifact's Node.js; the VPS
#      glibc ≥ every native binary's need; the validator (as the app user) with the expected provenance;
#   5. records, then removes, ONLY the incomplete output of the retired on-VPS build (.next, node_modules, the npm cache
#      in the build home), after checking that it all belongs to the app user;
#   6. extracts as the app user in a sandboxed transient unit that can write ONLY an empty directory (no network, no
#      home, the clone and every other application hidden), refusing to overwrite anything;
#   7. re-verifies every file and link on disk, then moves .next and node_modules into the clone (a rename);
#   8. checks the installed build without starting it: every file's SHA-256 in place, links, build id, ownership,
#      tracked files, no .env; in a read-only, network-less sandbox: next --version, every dependency and Turbopack
#      external resolves inside the tree, native libraries load, npm ls agrees with the lockfile;
#   9. §I guard. The application is first started at S9, inside its namespace.
STAGE=S6; . "$(dirname "$0")/lib.sh"
stage_begin S5 "$S6_MIN_MINUTES_LEFT"
guard_shared
start_thresholds
EXP="$STATE_DIR/ARTIFACT.expected"
TOOLS="$APP_DIR/.kit-tools"   # root-owned, readable by the app user: the validator and the runtime check
as_app() { (cd "$APP_DIR" && runuser -u "$APP_USER" -- env -i HOME="$BUILD_HOME" PATH=/usr/bin:/bin LANG=C.UTF-8 GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 "$@"); }
x() { if [ "$MODE" = plan ]; then printf '<%s>' "$1"; else sed -n "s/^$1=//p" "$EXP" | head -1; fi; }
HIDE="InaccessiblePaths=-/srv/po07-absent-erp -/etc/elite-po-staging -/var/lib/elite-po-staging -/var/lib/postgresql -/var/run/postgresql -/var/run/po07-absent-c -/var/www -/var/backups"
SANDBOX=(--uid="$APP_USER" --gid="$APP_USER" --expand-environment=no --wait --pipe --quiet --collect
  -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes -p PrivateDevices=yes -p PrivateNetwork=yes
  -p ProtectKernelTunables=yes -p ProtectKernelModules=yes -p ProtectControlGroups=yes -p RestrictSUIDSGID=yes -p LockPersonality=yes
  -p UMask=0077 -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p Nice=19 -p IOSchedulingClass=idle -p RuntimeMaxSec=900)

say "-- 2. the approved release in the S5 clone"
head_ok() { [ "$(as_app git -C "$APP_SRC" rev-parse HEAD)" = "$APPROVED_SHA" ]; }
tree_ok() { [ "$(as_app git -C "$APP_SRC" rev-parse 'HEAD^{tree}')" = "$APPROVED_TREE" ]; }
fsck_ok() { as_app git -C "$APP_SRC" fsck --no-progress --connectivity-only >/dev/null 2>&1; }
tracked_clean() { [ -z "$(as_app git -C "$APP_SRC" status --porcelain --untracked-files=no | grep -v ' next-env.d.ts$' || true)" ]; }
check "the clone is at the approved commit $APPROVED_SHA" head_ok
check "the clone's tree is the approved tree $APPROVED_TREE" tree_ok
check "git fsck (connectivity) passes" fsck_ok
check "no tracked file differs from the commit (next-env.d.ts excepted)" tracked_clean

say "-- 3. S1–S5 intact"
user_ok() { [ "$(getent passwd "$1" | cut -d: -f6,7)" = "$2:/usr/sbin/nologin" ]; }
check "user $APP_USER (home $APP_DIR, nologin)" user_ok "$APP_USER" "$APP_DIR"
check "user $PG_USER (home /nonexistent, nologin)" user_ok "$PG_USER" /nonexistent
dir_ok() { [ "$(stat -c '%a %U:%G' "$1")" = "$2" ]; }
check "$APP_DIR is 750 root:$APP_USER" dir_ok "$APP_DIR" "750 root:$APP_USER"
check "$BUILD_HOME is 700 $APP_USER:$APP_USER" dir_ok "$BUILD_HOME" "700 $APP_USER:$APP_USER"
unit_active() { [ "$(systemctl is-active "$1")" = active ]; }
check "the namespace unit is active" unit_active elite-po-staging-netns.service
ns_lo_only() { [ "$(ip netns exec "$NS" ip -o link | awk -F': ' '{print $2}' | tr '\n' ' ')" = "lo " ]; }
check "namespace $NS has only lo" ns_lo_only
check "the staging cluster is active" unit_active postgresql@16-po07ns.service
assert_staging_cluster
ns_pg_only() { [ "$(ip netns exec "$NS" ss -ltnH | awk '{print $4}' | sort -u | tr '\n' ' ')" = "127.0.0.1:$PG_PORT " ]; }
check "inside the namespace only the staging cluster listens (127.0.0.1:$PG_PORT)" ns_pg_only
no_host_port() { [ -z "$(ss -Hltn "( sport = :$PG_PORT or sport = :$ADMIN_IN or sport = :$CUST_IN )")" ]; }
check "no host listener on $PG_PORT, $ADMIN_IN or $CUST_IN" no_host_port
roles_ok() { [ "$(printf "select count(*) from pg_roles where rolname in ('%s','%s','%s') and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls;\n" "$OWNER_ROLE" "$APP_ROLE" "$BACKUP_ROLE" | spsql postgres)" = 3 ]; }
check "the three staging roles exist, none privileged" roles_ok
db_ok() { [ "$(printf "select pg_get_userbyid(datdba) from pg_database where datname = '%s';\n" "$DB" | spsql postgres)" = "$OWNER_ROLE" ]; }
check "$DB exists, owned by $OWNER_ROLE" db_ok

say "-- 4. the archive and its provenance"
if [ "$MODE" = execute ]; then
  [ -f "$EXP" ] || stop_now "no $EXP: run pc-kit.sh artifact-fetch and artifact-upload first"
  [ "$(x source_sha)" = "$APPROVED_SHA" ] && [ "$(x source_tree)" = "$APPROVED_TREE" ] || stop_now "ARTIFACT.expected is not for the approved commit and tree"
  case " $ARTIFACT_WORKFLOW_COMMITS " in *" $(x workflow_commit) "*) ;; *) stop_now "the artifact's workflow commit $(x workflow_commit) is not a reviewed one";; esac
  [[ "$(x run_id)" =~ ^[0-9]+$ ]] && [[ "$(x archive)" =~ ^po07-staging-build-[0-9a-f]{12}\.tar\.gz$ ]] || stop_now "malformed ARTIFACT.expected"
fi
ARCHIVE="$INCOMING_DIR/run$(x run_id)/$(x archive)"
file_ok() { [ -f "$ARCHIVE" ] && [ ! -L "$ARCHIVE" ] && [ "$(stat -c '%U %a' "$ARCHIVE")" = "root 600" ]; }
check "the archive $ARCHIVE is a root-only regular file" file_ok
sha_ok() { [ "$(sha256sum "$ARCHIVE" | cut -d' ' -f1)" = "$(x archive_sha256)" ]; }
check "its SHA-256 equals the digest verified on the PC (GitHub artifact digest, Sigstore attestation)" sha_ok
node_ok() { [ "$("$NODE_BIN" -v)" = "$ARTIFACT_NODE" ] && [ "$(x node)" = "$ARTIFACT_NODE" ]; }
check "the VPS runtime is the artifact's Node.js ($ARTIFACT_NODE)" node_ok
glibc_ok() { local have need; have="$(ldd --version | head -1 | grep -o '[0-9][0-9]*\.[0-9][0-9]*$')"; need="$(x max_glibc)"
  [ -n "$have" ] && [ -n "$need" ] && [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -1)" = "$need" ]; }
check "the VPS glibc satisfies every native binary in the archive (needs $(x max_glibc))" glibc_ok
mkdir_staging "$TOOLS" 0750 "root:$APP_USER"
put_file "$TOOLS/check-archive.mjs" 0640 "root:$APP_USER" "$KIT_HERE/tools/check-archive.mjs"
put_file "$TOOLS/s6r-runtime-check.sh" 0640 "root:$APP_USER" "$KIT_HERE/probes/s6r-runtime-check.sh"
validate_archive() { # as the app user; the archive (root 0600) arrives on stdin, opened by root
  (cd "$APP_DIR" && runuser -u "$APP_USER" -- "$NODE_BIN" "$TOOLS/check-archive.mjs" - \
    --expect source.sha="$APPROVED_SHA" --expect source.tree="$APPROVED_TREE" --expect build_id="$(x build_id)" \
    --expect workflow.commit="$(x workflow_commit)" --expect workflow.run_id="$(x run_id)" \
    --expect runtime.node="$ARTIFACT_NODE" --expect runtime.next="$ARTIFACT_NEXT" --expect contents.files="$(x files)" \
    --expect contents.symlinks="$(x symlinks)" < "$ARCHIVE" > "$STATE_DIR/logs/S6R-archive-check.txt" 2>&1) || { tail -20 "$STATE_DIR/logs/S6R-archive-check.txt"; return 1; }
  tail -1 "$STATE_DIR/logs/S6R-archive-check.txt"
}
check "the archive validator passes (format, names, links, permissions, every file's SHA-256, provenance)" validate_archive

if [ "$MODE" = execute ] && [ -f "$STATE_DIR/S6R.installed" ]; then
  say "S6-R already installed ($(cat "$STATE_DIR/S6R.installed")): re-checking the installed build only"
else
  say "-- 5. record, then remove, the incomplete output of the retired on-VPS build"
  build_unit_idle() { [ "$(systemctl is-active elite-po-build.service)" != active ] && [ "$(systemctl is-active elite-po-install.service)" != active ]; }
  check "no build or install unit is running" build_unit_idle
  owned_by_app() { local p; for p in "$APP_SRC/.next" "$APP_SRC/node_modules" "$BUILD_HOME/.npm" "$EXTRACT_DIR"; do
    [ ! -e "$p" ] || [ -z "$(find "$p" ! -user "$APP_USER" -print -quit)" ] || return 1; done; }
  check "everything to be removed belongs to $APP_USER (kit-owned build output only)" owned_by_app
  if [ "$MODE" = plan ]; then plan "record size, file and link counts, owners, BUILD_ID and a listing hash of $APP_SRC/.next, $APP_SRC/node_modules, $BUILD_HOME/.npm"
  else
    rec="$STATE_DIR/logs/S6R-removed-$(date -u +%Y%m%dT%H%M%SZ).txt"
    { echo "incomplete output of the retired on-VPS build (S6 attempts, 23 Nov 2026), recorded before removal"
      for p in "$APP_SRC/.next" "$APP_SRC/node_modules" "$BUILD_HOME/.npm" "$EXTRACT_DIR"; do
        if [ -e "$p" ]; then echo "$p: $(du -sb "$p" | cut -f1) bytes, $(find "$p" -type f | wc -l) files, $(find "$p" -type l | wc -l) links, owners $(find "$p" -printf '%u\n' | sort -u | tr '\n' ' ')listing-sha256 $(find "$p" -printf '%P %s %y\n' | LC_ALL=C sort | sha256sum | cut -c1-16)"
        else echo "$p: absent"; fi
      done
      if [ -f "$APP_SRC/.next/BUILD_ID" ]; then echo "BUILD_ID present: $(cat "$APP_SRC/.next/BUILD_ID")"; else echo "no .next/BUILD_ID (the build never completed)"; fi
      echo "build home entries: $(ls -A "$BUILD_HOME" | tr '\n' ' ')"
    } > "$rec"
    sed 's/^/  /' "$rec"
  fi
  safe_rm "$APP_SRC/.next" "$APP_SRC/node_modules" "$BUILD_HOME/.npm" "$EXTRACT_DIR"

  say "-- 6. extract as $APP_USER into an empty directory, in a sandbox that can write only there"
  mkdir_staging "$EXTRACT_DIR" 0700 "$APP_USER:$APP_USER"
  if [ "$MODE" = execute ] && [ -n "$(ls -A "$EXTRACT_DIR")" ]; then stop_now "$EXTRACT_DIR is not empty"; fi
  EXTRACT_CMD=(systemd-run --unit=elite-po-install.service "${SANDBOX[@]}" -p "ReadWritePaths=$EXTRACT_DIR" -p "$HIDE -$APP_SRC"
    -p "WorkingDirectory=$EXTRACT_DIR" -- /usr/bin/tar -xzf - -C "$EXTRACT_DIR" --no-same-owner --no-same-permissions --keep-old-files)
  if [ "$MODE" = plan ]; then plan "${EXTRACT_CMD[*]} < $ARCHIVE"
  else act "${EXTRACT_CMD[@]}" < "$ARCHIVE" || stop_now "the sandboxed extraction failed"; fi

  say "-- 7. verify on disk, then move into the clone"
  only_root() { [ "$(ls -A "$EXTRACT_DIR")" = po07-artifact ]; }
  check "the extraction produced only po07-artifact/" only_root
  disk_ok() { runuser -u "$APP_USER" -- /bin/sh -ec 'cd "$1/po07-artifact"; sha256sum --quiet --strict -c MANIFEST.sha256
    [ "$(find .next node_modules -type f | wc -l)" -eq "$(wc -l < MANIFEST.sha256)" ]
    find .next node_modules -type l -printf "%p\t%l\n" | LC_ALL=C sort | cmp -s - SYMLINKS.txt' sh "$EXTRACT_DIR"; }
  check "on disk: every file's SHA-256, the file count and every link equal the archive's manifest" disk_ok
  perms_ok() { [ -z "$(find "$EXTRACT_DIR" ! -type l \( ! -user "$APP_USER" -o -perm /7022 \) -print -quit)" ]; }
  check "every extracted entry belongs to $APP_USER; nothing setuid/setgid/sticky or group/world-writable" perms_ok
  slots_free() { [ ! -e "$APP_SRC/.next" ] && [ ! -e "$APP_SRC/node_modules" ]; }
  check "the clone has no .next and no node_modules (nothing to mix with)" slots_free
  act runuser -u "$APP_USER" -- mv -T -- "$EXTRACT_DIR/po07-artifact/.next" "$APP_SRC/.next"
  act runuser -u "$APP_USER" -- mv -T -- "$EXTRACT_DIR/po07-artifact/node_modules" "$APP_SRC/node_modules"
  if [ "$MODE" = plan ]; then plan "keep ARTIFACT.json, MANIFEST.sha256, SYMLINKS.txt in $STATE_DIR/artifact/ (root)"
  else install -d -m 0700 "$STATE_DIR/artifact"; for f in ARTIFACT.json MANIFEST.sha256 SYMLINKS.txt; do install -m 0600 "$EXTRACT_DIR/po07-artifact/$f" "$STATE_DIR/artifact/$f"; done; fi
  safe_rm "$EXTRACT_DIR"
  [ "$MODE" = execute ] && printf 'run %s build %s installed %s\n' "$(x run_id)" "$(x build_id)" "$(date -u +%FT%TZ)" > "$STATE_DIR/S6R.installed"
fi

say "-- 8. the installed build (not started)"
inst_files_ok() { runuser -u "$APP_USER" -- /bin/sh -ec 'cd "$1"; sha256sum --quiet --strict -c -' sh "$APP_SRC" < "$STATE_DIR/artifact/MANIFEST.sha256"; }
check "installed: every file's SHA-256 equals the archive's manifest" inst_files_ok
inst_links_ok() { (cd "$APP_SRC" && find .next node_modules -type l -printf '%p\t%l\n' | LC_ALL=C sort) | cmp -s - "$STATE_DIR/artifact/SYMLINKS.txt"; }
check "installed: every link equals the archive's link list" inst_links_ok
build_id_ok() { [ "$(cat "$APP_SRC/.next/BUILD_ID")" = "$(x build_id)" ]; }
check "the build id is the artifact's ($(x build_id))" build_id_ok
build_ok() { [ -f "$APP_SRC/.next/server/server-reference-manifest.json" ] && [ -f "$APP_SRC/.next/server/app-paths-manifest.json" ] &&
  [ -d "$APP_SRC/.next/cache" ] && [ -z "$(ls -A "$APP_SRC/.next/cache")" ] && [ ! -e "$APP_SRC/.next/server/route-cache" ]; }
check "the action and page manifests exist; .next/cache is empty and no route cache exists (the build stays read-only, J1)" build_ok
owner_ok() { [ -z "$(find "$APP_SRC" -xdev ! -user "$APP_USER" -print -quit)" ]; }
check "every file in the app tree belongs to $APP_USER" owner_ok
check "no tracked file differs from the commit (next-env.d.ts excepted)" tracked_clean
# None of the env files `next start` would load may exist, and no .env* file may exist that is not the repository's
# own (the tracked .env.example template holds no value). Configuration comes only from the root-only env files (S7).
no_env_file() {
  local f; for f in .env .env.local .env.production .env.production.local; do [ ! -e "$APP_SRC/$f" ] || { say "$f exists"; return 1; }; done
  local stray; stray="$(cd "$APP_SRC" && find . -maxdepth 1 -name '.env*' -printf '%P\n' | LC_ALL=C sort | while read -r f; do as_app git -C "$APP_SRC" ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || echo "$f"; done)"
  [ -z "$stray" ] || { say "untracked env file(s): $stray"; return 1; }
}
check "no env file next start would load (.env, .env.local, .env.production[.local]) and no untracked .env* in the app tree" no_env_file
runtime_ok() {
  systemd-run --unit=elite-po-install.service "${SANDBOX[@]}" -p "$HIDE" -p "WorkingDirectory=$APP_SRC" \
    -E HOME=/tmp -E npm_config_cache=/tmp/npm-cache -E npm_config_offline=true -E npm_config_update_notifier=false \
    -E NEXT_TELEMETRY_DISABLED=1 -E EXPECT_NEXT="$ARTIFACT_NEXT" -- /bin/sh -s < "$TOOLS/s6r-runtime-check.sh" > "$STATE_DIR/logs/S6R-runtime-check.txt" 2>&1 ||
    { tail -25 "$STATE_DIR/logs/S6R-runtime-check.txt"; return 1; }
  grep -E '^(next|deps|external|native|npm ls|RUNTIME-CHECK)' "$STATE_DIR/logs/S6R-runtime-check.txt" | sed 's/^/  /'
}
check "read-only, network-less sandbox: next $ARTIFACT_NEXT runs; dependencies, Turbopack externals and native libraries resolve; npm ls agrees" runtime_ok
guard_shared
# D24: in the restricted recovery of the recorded S6 STOP, the STOP is resolved only here, after every check passed
recovery_complete
mark_done
