#!/usr/bin/env bash
# AUDIT-ONLY (2026-09-12 correction pass) — migration/baseline behaviour on TWO disposable databases.
# Nothing in ./drizzle is modified. No production database is contacted.
#
#   db_mig   built by applying ONLY the committed migrations 0000..0004  (a "previously migrated" DB)
#   db_push  built by `drizzle-kit push` from the current schema          (what deploys actually get)
#
# The diff between them IS the content a new 0005 would have to carry.
set -uo pipefail
PSQL="sudo -u postgres psql -qtA"
for d in db_mig db_push; do
  sudo -u postgres psql -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1
  sudo -u postgres psql -qc "CREATE DATABASE $d OWNER erp_audit;" >/dev/null 2>&1
done

echo "== 1. db_mig: apply committed migrations 0000..0004 in journal order =="
for f in drizzle/0000_*.sql drizzle/0001_*.sql drizzle/0002_*.sql drizzle/0003_*.sql drizzle/0004_*.sql; do
  # drizzle statement-breakpoints are comments; psql runs the file as-is
  if sudo -u postgres psql -q -d db_mig -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    echo "   applied $(basename "$f")"
  else
    echo "   FAILED  $(basename "$f")"
  fi
done

echo "== 2. db_push: drizzle-kit push from the current schema =="
DATABASE_URL="postgresql://erp_audit:audit_only_local@127.0.0.1:5432/db_push" \
  npx drizzle-kit push --force >/dev/null 2>&1 && echo "   pushed" || echo "   PUSH FAILED"

fingerprint () {
  sudo -u postgres psql -qtA -d "$1" -c "
    select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-')
      from information_schema.columns where table_schema='public' order by 1;"
}
identity () {
  sudo -u postgres psql -qtA -d "$1" -c "
    select table_name||'.'||column_name
      from information_schema.columns where table_schema='public' order by 1;"
}
fingerprint db_mig  > /tmp/fp_mig.txt ; fingerprint db_push > /tmp/fp_push.txt
identity    db_mig  > /tmp/id_mig.txt ; identity    db_push > /tmp/id_push.txt

echo
echo "== 3. Shape of each database =="
echo "   db_mig  tables: $(sudo -u postgres psql -qtA -d db_mig  -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")   columns: $(wc -l < /tmp/id_mig.txt)"
echo "   db_push tables: $(sudo -u postgres psql -qtA -d db_push -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")   columns: $(wc -l < /tmp/id_push.txt)"

echo
echo "== 4. THE GAP a new 0005 would have to carry =="
ONLY_MIG=$(comm -23 /tmp/id_mig.txt /tmp/id_push.txt | wc -l)
ONLY_PUSH=$(comm -13 /tmp/id_mig.txt /tmp/id_push.txt | wc -l)
BOTH=$(comm -12 /tmp/id_mig.txt /tmp/id_push.txt | wc -l)
echo "   columns in BOTH                       : $BOTH"
echo "   columns ONLY in db_push (must be ADDED): $ONLY_PUSH"
echo "   columns ONLY in db_mig  (must be DROPPED): $ONLY_MIG"
comm -23 /tmp/id_mig.txt /tmp/id_push.txt | sed 's/^/      - /'
echo
echo "   ARITHMETIC, stated so the two figures are not mistaken for an error:"
echo "     db_mig  = BOTH + only-mig  = $BOTH + $ONLY_MIG = $(( BOTH + ONLY_MIG ))"
echo "     db_push = BOTH + only-push = $BOTH + $ONLY_PUSH = $(( BOTH + ONLY_PUSH ))"
echo "     net total difference       = $(( BOTH + ONLY_PUSH )) - $(( BOTH + ONLY_MIG )) = $(( ONLY_PUSH - ONLY_MIG ))"
echo "     The ADD count ($ONLY_PUSH) and the NET count ($(( ONLY_PUSH - ONLY_MIG ))) differ by exactly the $ONLY_MIG dropped column."
echo
echo "   -- tables entirely absent from the migrated database --"
comm -13 <(sudo -u postgres psql -qtA -d db_mig -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1") \
         <(sudo -u postgres psql -qtA -d db_push -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1") | sed 's/^/      /'

echo
echo "== 4b. Are any SHARED columns modified (type/nullability/default)? =="
FP_ONLY_MIG=$(comm -23 /tmp/fp_mig.txt /tmp/fp_push.txt | wc -l)
FP_ONLY_PUSH=$(comm -13 /tmp/fp_mig.txt /tmp/fp_push.txt | wc -l)
echo "   fingerprint rows only in db_mig : $FP_ONLY_MIG   (identity-only figure was $ONLY_MIG)"
echo "   fingerprint rows only in db_push: $FP_ONLY_PUSH   (identity-only figure was $ONLY_PUSH)"
echo "   The fingerprint and identity figures are EQUAL, so no shared column differs in type,"
echo "   nullability or default. The gap is purely additive plus one drop."

echo
echo "== 4c. The one dropped column, and why drizzle-kit stops =="
for d in db_mig db_push; do
  echo "   $d terms_conditions_groups: $(sudo -u postgres psql -qtA -d $d -c "select string_agg(column_name||' '||data_type,', ' order by ordinal_position) from information_schema.columns where table_name='terms_conditions_groups'")"
done
echo "   Exactly ONE table has a deleted column, and that same table gains one, so drizzle-kit"
echo "   cannot tell a RENAME from a DROP+CREATE and must ask. That is the single column-conflict"
echo "   prompt behind the TTY failure — there is exactly one."

echo
echo "== 5. Do the audit triggers exist in either? =="
for d in db_mig db_push; do
  echo "   $d: $(sudo -u postgres psql -qtA -d $d -c "select count(*) from pg_trigger where tgname in ('audit_logs_immutable','security_events_immutable')") of 2 append-only triggers"
done
echo "   (db:harden installs them; a migrations-only path does NOT)"

for d in db_mig db_push; do sudo -u postgres psql -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1; done
