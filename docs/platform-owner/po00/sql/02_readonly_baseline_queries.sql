-- PO-00 — READ-ONLY baseline/anomaly queries.
-- Validated ONLY against the disposable TEST database po00_test_only_pushshape with fictional fixtures.
-- NOT executed against production. Running them on production Neon requires SEPARATE owner authorization.
-- Output is aggregate or numeric ids only: no e-mail addresses, names, hashes or tokens are selected.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo '--- Q01 server version / bookkeeping presence'
SELECT current_setting('server_version_num') AS server_version_num,
       to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_drizzle_bookkeeping;

\echo '--- Q02 population (counts only)'
SELECT (SELECT count(*) FROM orgs) AS orgs,
       (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM users WHERE is_active) AS active_users,
       (SELECT count(*) FROM users WHERE NOT is_active) AS inactive_users;

\echo '--- Q03 role values (non-canonical values are an anomaly; users.role has no CHECK)'
SELECT role, count(*) AS users, (role NOT IN ('owner','admin','staff')) AS non_canonical
FROM users GROUP BY role ORDER BY role;

\echo '--- Q04 owner classification per org (aggregate)'
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                              AS users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM orgs g LEFT JOIN users u ON u.org_id = g.id
  GROUP BY g.id
), c AS (
  SELECT org_id,
         CASE
           WHEN users = 0                                  THEN 'E_no_users'
           WHEN active_owners = 1 AND inactive_owners = 0  THEN 'A_single_active_owner'
           WHEN active_owners = 1 AND inactive_owners > 0  THEN 'B_single_active_plus_inactive_owner'
           WHEN active_owners > 1                          THEN 'C_multiple_active_owners'
           WHEN active_owners = 0 AND inactive_owners > 0  THEN 'D_only_inactive_owner'
           ELSE                                                 'F_no_owner_role'
         END AS class
  FROM o
)
SELECT class, count(*) AS orgs, array_agg(org_id ORDER BY org_id) AS org_ids
FROM c GROUP BY class ORDER BY class;

\echo '--- Q05 case-insensitive e-mail collisions (ids only)'
SELECT count(*) AS collision_groups,
       coalesce(array_agg(user_ids), '{}') AS user_id_groups
FROM (SELECT array_agg(id ORDER BY id) AS user_ids
      FROM users GROUP BY lower(email) HAVING count(*) > 1) t;

\echo '--- Q06 users per org (seat baseline distribution, active + inactive)'
SELECT count(*) AS orgs,
       max(n) AS max_users,
       percentile_disc(0.5)  WITHIN GROUP (ORDER BY n) AS p50_users,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY n) AS p95_users
FROM (SELECT g.id, count(u.id) AS n FROM orgs g LEFT JOIN users u ON u.org_id = g.id GROUP BY g.id) s;

\echo '--- Q07 session state + org/user integrity'
SELECT count(*) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > now())  AS live_sessions,
       count(*) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at <= now()) AS expired_unrevoked,
       count(*) FILTER (WHERE s.revoked_at IS NOT NULL)                       AS revoked,
       count(*) FILTER (WHERE s.org_id <> u.org_id)                           AS org_user_mismatch
FROM sessions s JOIN users u ON u.id = s.user_id;

\echo '--- Q08 append-only triggers bound to the RIGHT tables (stronger than tgname-only --check)'
SELECT tgname, tgrelid::regclass AS on_table, tgenabled
FROM pg_trigger
WHERE tgname IN ('audit_logs_immutable','security_events_immutable') AND NOT tgisinternal
ORDER BY tgname;

\echo '--- Q09 sessions indexes (org-wide revoke needs an org_id index)'
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sessions' ORDER BY indexname;

\echo '--- Q10 name collisions with proposed platform objects (expect zero rows)'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'platform\_%' OR table_name LIKE 'tenant\_%'
       OR table_name LIKE 'subscription%' OR table_name LIKE '%invitation%')
ORDER BY 1;

\echo '--- Q11 email uniqueness constraint definition'
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
WHERE conrelid = 'users'::regclass AND contype IN ('u','c') ORDER BY conname;

ROLLBACK;
