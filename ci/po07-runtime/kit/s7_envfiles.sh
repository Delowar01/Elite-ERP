#!/usr/bin/env bash
# S7 — the two env files and the owner-role credential (plan §0.2 table, §C, §N S7). Generated on the host, root 0600,
# NEVER printed: values are produced by openssl inside the shell and written with the printf builtin (no argv).
# Kept if they already exist and validate (re-generating after the owner's escrow would orphan the escrowed keys).
# Checks print names, equality results and the non-secret binding values only.
# Stop: any secret printed; a binding variable missing or different; customer.env carries a PLATFORM_*_ENABLED switch.
STAGE=S7; . "$(dirname "$0")/lib.sh"
stage_begin S6
guard_shared
start_thresholds
SEC="$ETC_DIR/secrets"
A="$ETC_DIR/admin.env"; C="$ETC_DIR/customer.env"; O="$ETC_DIR/owner-db.env"
for f in "$A" "$C" "$O"; do assert_staging_path "$f"; done
write_envs() {
  local auth pauth fek app_pw owner_pw common
  auth="$(openssl rand -base64 48 | tr -d '\n')"
  pauth="$(openssl rand -base64 48 | tr -d '\n')"
  fek="1:$(openssl rand -base64 32 | tr -d '\n')"
  [ "$auth" != "$pauth" ] || stop_now "generated secrets collide"
  app_pw="$(cat "$SEC/app.pw")"; owner_pw="$(cat "$SEC/owner.pw")"
  common="$(printf '%s\n' \
    "# PO-07 staging — generated $(date -u +%FT%TZ) by the kit. Root 0600. Fictional data only. Never copy elsewhere." \
    "NODE_ENV=production" \
    "NEXT_TELEMETRY_DISABLED=1" \
    "DATABASE_URL=postgres://$APP_ROLE:$app_pw@127.0.0.1:$PG_PORT/$DB" \
    "AUTH_SECRET=$auth" \
    "PLATFORM_AUTH_SECRET=$pauth" \
    "FIELD_ENCRYPTION_KEYS=$fek" \
    "PLATFORM_CONSOLE_HOST=$ADMIN_HOST" \
    "CUSTOMER_APP_HOST=$CUST_HOST" \
    "PLATFORM_TRUSTED_PROXY_HOPS=1" \
    "CUSTOMER_PUBLIC_ORIGIN=https://$CUST_HOST" \
    "STORAGE_DRIVER=fake" \
    "STORAGE_FAKE_DIR=$STORAGE_DIR" \
    "CHROMIUM_EXECUTABLE_PATH=$CHROMIUM" \
    "PDF_DEBUG_ERRORS=0")"
  ( umask 077
    { printf '%s\n' "$common"
      printf '%s\n' "# Console switches (admin.env ONLY), all OFF until S13: PLATFORM_CONSOLE_ENABLED (F1), PLATFORM_INVITATIONS_ENABLED (F3), PLATFORM_USER_INVITATIONS_ENABLED (F5)."
    } > "$A.tmp"
    { printf '%s\n' "$common"
      printf '%s\n' "PDF_RENDER_ORIGIN=http://127.0.0.1:$CUST_IN"
    } > "$C.tmp"
    printf 'DATABASE_URL=postgres://%s:%s@127.0.0.1:%s/%s\n' "$OWNER_ROLE" "$owner_pw" "$PG_PORT" "$DB" > "$O.tmp" )
  chmod 0600 "$A.tmp" "$C.tmp" "$O.tmp"
  mv "$A.tmp" "$A"; mv "$C.tmp" "$C"; mv "$O.tmp" "$O"
  unset auth pauth fek app_pw owner_pw common
}
if [ "$MODE" = plan ]; then
  plan "generate $A and $C (root 0600, never printed): NODE_ENV, DATABASE_URL (app role), AUTH_SECRET, PLATFORM_AUTH_SECRET, FIELD_ENCRYPTION_KEYS (identical in both), the H-1 binding pair, HOPS=1, CUSTOMER_PUBLIC_ORIGIN, fake storage, Chromium path; customer.env adds PDF_RENDER_ORIGIN; NO console switch in either"
  plan "generate $O (root 0600): the owner role's DATABASE_URL, read only by elite-po-run through LoadCredential="
elif [ -e "$A" ] || [ -e "$C" ] || [ -e "$O" ]; then
  { [ -s "$A" ] && [ -s "$C" ] && [ -s "$O" ]; } || stop_now "only some env files exist; resolve by hand with the owner"
  say "env files exist: validating, not regenerating"
else
  write_envs; say "env files generated (values not shown)"
fi
# ---- validation: names, hashes and the public binding values only ----
val() { sed -n "s/^$2=//p" "$1"; }
h() { val "$1" "$2" | sha256sum | cut -c1-12; }
perms_ok() { for f in "$A" "$C" "$O"; do [ "$(stat -c '%a %U:%G' "$f")" = "600 root:root" ] || return 1; done; }
binding_ok() {
  for f in "$A" "$C"; do
    [ "$(val "$f" PLATFORM_CONSOLE_HOST)" = "$ADMIN_HOST" ] && [ "$(val "$f" CUSTOMER_APP_HOST)" = "$CUST_HOST" ] &&
      [ "$(val "$f" PLATFORM_TRUSTED_PROXY_HOPS)" = 1 ] && [ "$(val "$f" CUSTOMER_PUBLIC_ORIGIN)" = "https://$CUST_HOST" ] &&
      [ "$(val "$f" NODE_ENV)" = production ] || return 1
  done
  say "binding: PLATFORM_CONSOLE_HOST=$ADMIN_HOST CUSTOMER_APP_HOST=$CUST_HOST HOPS=1 in both files"
}
no_switches() { ! grep -qE '^(PLATFORM_[A-Z_]*_ENABLED|CUSTOMER_[A-Z_]*_ENABLED|TENANT_ACCESS_ENFORCEMENT|PLATFORM_INVITATIONS_LOOPBACK_ORIGIN|ELITE_DESIGN_SPECIMEN|CHROMIUM_PACK_URL|BLOB_[A-Z_]*TOKEN|RATE_API_BASE)=' "$A" "$C"; }
secrets_ok() {
  local k
  for k in AUTH_SECRET PLATFORM_AUTH_SECRET FIELD_ENCRYPTION_KEYS DATABASE_URL; do
    [ -n "$(val "$A" $k)" ] && [ "$(h "$A" $k)" = "$(h "$C" $k)" ] || { say "$k missing or not identical in both files"; return 1; }
  done
  [ "$(h "$A" AUTH_SECRET)" != "$(h "$A" PLATFORM_AUTH_SECRET)" ] || { say "AUTH_SECRET equals PLATFORM_AUTH_SECRET"; return 1; }
  [ "$(val "$A" AUTH_SECRET | wc -c)" -ge 44 ] && [ "$(val "$A" PLATFORM_AUTH_SECRET | wc -c)" -ge 44 ] || return 1
  val "$A" FIELD_ENCRYPTION_KEYS | grep -qE '^1:[A-Za-z0-9+/]{43}=$' || { say "FIELD_ENCRYPTION_KEYS has an unexpected shape"; return 1; }
  say "secrets present, identical across the two files, AUTH_SECRET != PLATFORM_AUTH_SECRET (values not shown)"
}
pdf_ok() { [ "$(val "$C" PDF_RENDER_ORIGIN)" = "http://127.0.0.1:$CUST_IN" ] && [ -z "$(val "$A" PDF_RENDER_ORIGIN)" ]; }
db_urls_ok() {
  val "$A" DATABASE_URL | grep -qE "^postgres://$APP_ROLE:[0-9a-f]{64}@127\.0\.0\.1:$PG_PORT/$DB\$" &&
    sed -n 's/^DATABASE_URL=//p' "$O" | grep -qE "^postgres://$OWNER_ROLE:[0-9a-f]{64}@127\.0\.0\.1:$PG_PORT/$DB\$"
}
not_readable_by_app() { ! runuser -u "$APP_USER" -- test -r "$A" && ! runuser -u "$APP_USER" -- test -r "$O"; }
check "the three files are 0600 root:root" perms_ok
check "both files bind PLATFORM_CONSOLE_HOST and CUSTOMER_APP_HOST identically (H-1), HOPS=1, production" binding_ok
check "neither file sets a console/customer/tenant switch or a forbidden variable" no_switches
check "secrets identical across the files, distinct from each other, of full length" secrets_ok
check "PDF_RENDER_ORIGIN only in customer.env, loopback to its own port" pdf_ok
check "the database URLs are the staging cluster, the right roles, hex passwords" db_urls_ok
check "the app user cannot read the env files" not_readable_by_app
guard_shared
mark_done
