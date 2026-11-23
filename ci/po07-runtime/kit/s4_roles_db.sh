#!/usr/bin/env bash
# S4 — roles and the staging database (plan §B.3 "Roles", §N S4). Peer psql as the cluster user over the cluster's own
# 0700 socket directory; every session first proves it is the staging cluster (never main: /var/run/postgresql:5432).
# Passwords are generated on the host into root-only files and reach psql through a pipe (never argv, never printed).
# Stop: the connection is not the staging cluster; any psql error.
STAGE=S4; . "$(dirname "$0")/lib.sh"
stage_begin S3
guard_shared
start_thresholds
SEC="$ETC_DIR/secrets"
mkdir_staging "$ETC_DIR" 0700 root:root
mkdir_staging "$SEC" 0700 root:root
gen_pw() { # FILE — 32 random bytes as hex (URL-safe in a postgres:// URL); kept if present (re-entry)
  assert_staging_path "$1"
  if [ "$MODE" = plan ]; then plan "generate $1 (openssl rand -hex 32, 0600 root; never printed)"; return 0; fi
  if [ -s "$1" ]; then say "kept: $1"; return 0; fi
  ( umask 077; openssl rand -hex 32 > "$1" )
  [ "$(wc -c < "$1")" -eq 65 ] || stop_now "password file $1 has an unexpected length"
  say "generated: $1 (value not shown)"
}
gen_pw "$SEC/owner.pw"; gen_pw "$SEC/app.pw"; gen_pw "$SEC/backup.pw"
assert_staging_cluster
sql_roles() {
  # Logging of statement text is switched off for this session first, so a password can never reach the server log.
  printf "set log_min_error_statement = panic;\nset log_statement = 'none';\nset log_min_duration_statement = -1;\n"
  printf "\\\\set pw_owner '%s'\n\\\\set pw_app '%s'\n\\\\set pw_backup '%s'\n" "$(cat "$SEC/owner.pw")" "$(cat "$SEC/app.pw")" "$(cat "$SEC/backup.pw")"
  cat <<SQL
select 'create role $OWNER_ROLE login' where not exists (select 1 from pg_roles where rolname = '$OWNER_ROLE') \gexec
select 'create role $APP_ROLE login' where not exists (select 1 from pg_roles where rolname = '$APP_ROLE') \gexec
select 'create role $BACKUP_ROLE login' where not exists (select 1 from pg_roles where rolname = '$BACKUP_ROLE') \gexec
alter role $OWNER_ROLE nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 4 password :'pw_owner';
alter role $APP_ROLE nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 20 password :'pw_app';
alter role $BACKUP_ROLE nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2 password :'pw_backup';
alter role $BACKUP_ROLE set default_transaction_read_only = on;
grant pg_read_all_data to $BACKUP_ROLE;
select 'create database $DB owner $OWNER_ROLE template template0 encoding ''UTF8'' locale ''C.UTF-8''' where not exists (select 1 from pg_database where datname = '$DB') \gexec
revoke all on database $DB from public;
grant connect on database $DB to $APP_ROLE;
grant connect on database $DB to $BACKUP_ROLE;
SQL
}
if [ "$MODE" = plan ]; then plan "psql (peer, -h $PG_RUN -p $PG_PORT, db postgres): roles $OWNER_ROLE/$APP_ROLE/$BACKUP_ROLE (no superuser, no createdb/createrole/replication/bypassrls), passwords via psql variables from the root-only files, database $DB owned by $OWNER_ROLE, connect grants"
else sql_roles | spsql postgres >/dev/null; say "roles and database ensured"; fi
sql_db() {
  cat <<SQL
set log_min_error_statement = panic;
revoke create on schema public from public;
grant usage on schema public to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema public grant select, insert, update, delete on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema public grant usage, select on sequences to $APP_ROLE;
SQL
}
if [ "$MODE" = plan ]; then plan "psql (peer, db $DB): schema public usage for $APP_ROLE; default privileges of $OWNER_ROLE: DML on tables, usage/select on sequences, for $APP_ROLE"
else sql_db | spsql "$DB" >/dev/null; say "schema grants and default privileges ensured"; fi
roles_ok() {
  local got
  # (an exact prefix, not LIKE: "_" is a LIKE wildcard, so 'po_cit_%' would also match other names of that shape)
  got="$(printf "select string_agg(rolname||':'||rolsuper::int||rolcreatedb::int||rolcreaterole::int||rolreplication::int||rolbypassrls::int, ' ' order by rolname) from pg_roles where left(rolname, 7) = 'po_cit_';\n" | spsql postgres)"
  [ "$got" = "$APP_ROLE:00000 $BACKUP_ROLE:00000 $OWNER_ROLE:00000" ] || { say "roles: $got"; return 1; }
}
db_ok() { [ "$(printf "select pg_get_userbyid(datdba) from pg_database where datname = '%s';\n" "$DB" | spsql postgres)" = "$OWNER_ROLE" ]; }
scram_ok() { [ "$(printf "select count(*) from pg_authid where left(rolname, 7) = 'po_cit_' and left(rolpassword, 14) = 'SCRAM-SHA-256\$';\n" | spsql postgres)" = 3 ]; }
check "three roles exist, none privileged" roles_ok
check "database $DB exists, owned by $OWNER_ROLE" db_ok
check "all three passwords are stored as SCRAM verifiers" scram_ok
guard_shared
mark_done
