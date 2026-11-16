-- =============================================================================================
-- PO-02D0 — READ-ONLY legacy onboarding audit (extends PO-00 02_readonly_baseline_queries.sql).
--
-- Purpose: measure what PO-02D1…D3 depend on — owner anomalies (primary-owner mapping), disabled
-- owners, org/user inconsistencies, organizations without platform access rows, registration
-- provenance, e-mail collisions and invitation conflicts — WITHOUT changing anything.
--
-- Safety:
--   * one READ ONLY transaction, ROLLBACK at the end; statement_timeout 15 s, lock_timeout 2 s;
--   * output is aggregates and numeric ids only: no e-mail address, name, hash, token or reason
--     text is selected (invitations are shown by their INV-XXXXXXXX display reference at most);
--   * objects that may not exist (production has no Platform Owner tables before D-6) are probed
--     with to_regclass and skipped with a note — the file never fails on their absence.
-- Validated ONLY on disposable *_test_only_* databases with 01_legacy_audit_fixtures_fictional.sql.
-- Running it against production Neon requires SEPARATE owner authorization (decision D-7).
--   psql -v ON_ERROR_STOP=1 -X -f 02_legacy_onboarding_audit_readonly.sql
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT current_setting('transaction_read_only') = 'on' AS read_only,
       to_regclass('public.platform_admins') IS NOT NULL AS has_platform,
       to_regclass('public.tenant_access_controls') IS NOT NULL AS has_tac,
       to_regclass('public.organization_invitations') IS NOT NULL AS has_inv,
       to_regclass('public.tenant_primary_owners') IS NOT NULL AS has_tpo \gset
\if :read_only
\else
  \echo 'REFUSED: the transaction is not read-only'
  \quit
\endif

\echo '--- L00 environment (server version, which Platform Owner objects exist)'
SELECT current_setting('server_version_num') AS server_version_num,
       :'has_platform'::boolean AS platform_identity_installed,
       :'has_tac'::boolean AS tenant_access_controls_installed,
       :'has_inv'::boolean AS organization_invitations_installed,
       :'has_tpo'::boolean AS tenant_primary_owners_installed;

\echo '--- L01 population (counts only)'
SELECT (SELECT count(*) FROM orgs) AS orgs,
       (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM users WHERE is_active) AS active_users,
       (SELECT count(*) FROM users WHERE NOT is_active) AS inactive_users;

\echo '--- L02 role values (users.role is free text; non-canonical values are not treated as owner)'
SELECT role, count(*) AS users, (role NOT IN ('owner', 'admin', 'staff')) AS non_canonical
FROM users GROUP BY role ORDER BY role;

\echo '--- L03 owner classification per organization (PO-00 classes; only A is a backfill candidate)'
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM orgs g LEFT JOIN users u ON u.org_id = g.id
  GROUP BY g.id
), c AS (
  SELECT org_id,
         CASE
           WHEN users = 0                                 THEN 'E_no_users'
           WHEN active_owners = 1 AND inactive_owners = 0 THEN 'A_single_active_owner'
           WHEN active_owners = 1 AND inactive_owners > 0 THEN 'B_single_active_plus_inactive_owner'
           WHEN active_owners > 1                         THEN 'C_multiple_active_owners'
           WHEN active_owners = 0 AND inactive_owners > 0 THEN 'D_only_inactive_owner'
           ELSE                                                'F_no_owner_role'
         END AS class
  FROM o
)
SELECT class, count(*) AS orgs, array_agg(org_id ORDER BY org_id) AS org_ids
FROM c GROUP BY class ORDER BY class;

\echo '--- L04 disabled owner-role accounts'
SELECT count(*) FILTER (WHERE u.role = 'owner' AND NOT u.is_active)                     AS disabled_owner_accounts,
       coalesce(array_agg(DISTINCT u.org_id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active), '{}') AS orgs_with_a_disabled_owner
FROM users u;
SELECT coalesce(array_agg(g.id ORDER BY g.id), '{}') AS orgs_whose_only_owners_are_disabled
FROM orgs g
WHERE EXISTS (SELECT 1 FROM users u WHERE u.org_id = g.id AND u.role = 'owner' AND NOT u.is_active)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = g.id AND u.role = 'owner' AND u.is_active);

\echo '--- L05 organization/user relationship inconsistencies (a row''s org differs from its user''s org)'
SELECT (SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.org_id <> u.org_id)                  AS session_org_mismatch,
       (SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.org_id <> u.org_id
                                                                            AND s.revoked_at IS NULL AND s.expires_at > now()) AS live_session_org_mismatch,
       (SELECT count(*) FROM security_events e JOIN users u ON u.id = e.user_id WHERE e.org_id <> u.org_id)          AS security_event_org_mismatch,
       (SELECT count(*) FROM audit_logs a JOIN users u ON u.id = a.user_id WHERE a.org_id <> u.org_id)               AS audit_log_org_mismatch;

\echo '--- L06 platform access rows (organizations without a row are active by the compatibility rule)'
\if :has_tac
SELECT count(*) FILTER (WHERE t.org_id IS NULL)                  AS orgs_without_access_row,
       count(*) FILTER (WHERE t.access_status = 'active')        AS explicit_active,
       count(*) FILTER (WHERE t.access_status = 'suspended')     AS suspended,
       count(*) FILTER (WHERE t.org_id IS NOT NULL AND t.access_status NOT IN ('active', 'suspended')) AS invalid_state
FROM orgs g LEFT JOIN tenant_access_controls t ON t.org_id = g.id;
\else
\echo '(tenant_access_controls is not installed: every organization is a legacy row-less company, active by the compatibility rule)'
SELECT count(*) AS orgs_without_access_row FROM orgs;
\endif

\echo '--- L07 registration provenance (the live /register writes audit_logs action org.registered)'
SELECT count(DISTINCT g.id) FILTER (WHERE a.org_id IS NOT NULL) AS orgs_registered_via_register,
       count(DISTINCT g.id) FILTER (WHERE a.org_id IS NULL)     AS orgs_without_registration_record
FROM orgs g
LEFT JOIN audit_logs a ON a.org_id = g.id AND a.action = 'org.registered';
SELECT to_char(date_trunc('month', a.created_at), 'YYYY-MM') AS month, count(DISTINCT a.org_id) AS registrations
FROM audit_logs a WHERE a.action = 'org.registered'
GROUP BY 1 ORDER BY 1;

\echo '--- L08 case-insensitive e-mail collisions among users (block lower(email) uniqueness; confuse invitation checks)'
SELECT count(*) AS collision_groups, coalesce(array_agg(user_ids), '{}') AS user_id_groups
FROM (SELECT array_agg(id ORDER BY id) AS user_ids FROM users GROUP BY lower(email) HAVING count(*) > 1) t;

\echo '--- L09 invitation states and conflicts (slot = unaccepted and unrevoked, the pending-email index predicate)'
\if :has_inv
SELECT count(*) FILTER (WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())  AS pending,
       count(*) FILTER (WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()) AS expired_holding_slot,
       count(*) FILTER (WHERE revoked_at IS NOT NULL)                                             AS revoked,
       count(*) FILTER (WHERE accepted_at IS NOT NULL)                                            AS accepted
FROM organization_invitations;
SELECT count(*) AS slot_invitations_whose_owner_email_is_a_user,
       coalesce(array_agg('INV-' || upper(left(i.id::text, 8)) ORDER BY i.id), '{}') AS refs
FROM organization_invitations i
WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
  AND EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = i.owner_email_normalized);
SELECT count(*) AS slot_invitations_whose_company_name_is_an_org,
       coalesce(array_agg('INV-' || upper(left(i.id::text, 8)) ORDER BY i.id), '{}') AS refs
FROM organization_invitations i
WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
  AND EXISTS (SELECT 1 FROM orgs g WHERE lower(btrim(g.name)) = lower(btrim(i.company_name)));
SELECT count(*) AS accepted_invitations_without_an_active_owner
FROM organization_invitations i
WHERE i.accepted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = i.accepted_org_id AND u.role = 'owner' AND u.is_active);
\else
\echo '(organization_invitations is not installed: no invitation exists)'
\endif

\echo '--- L10 users per organization (seat baseline, active + disabled; input to the Trial seat decision — not a value)'
SELECT count(*) AS orgs, max(n) AS max_users,
       percentile_disc(0.5)  WITHIN GROUP (ORDER BY n) AS p50_users,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY n) AS p95_users
FROM (SELECT g.id, count(u.id) AS n FROM orgs g LEFT JOIN users u ON u.org_id = g.id GROUP BY g.id) s;

\echo '--- L11 MFA enrolment among active canonical owners (input to the invitee MFA decision)'
SELECT count(*) AS active_owners, count(*) FILTER (WHERE mfa_enabled) AS with_mfa
FROM users WHERE role = 'owner' AND is_active;

\echo '--- L12 name collisions with the proposed PO-02D1 objects (expect zero rows)'
SELECT c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('tenant_primary_owners', 'subscription_packages', 'subscription_package_versions', 'tenant_subscriptions',
                    'subscription_events', 'platform_settings', 'organization_invitation_terms', 'users_org_id_id_uq')
ORDER BY 1;

\echo '--- L13 users(org_id, id) unique index feasibility and build size (id is the primary key, so duplicates are impossible)'
SELECT count(*) AS users_rows,
       count(*) - count(DISTINCT (org_id, id)) AS duplicate_pairs,
       pg_size_pretty(pg_total_relation_size('public.users')) AS users_total_size
FROM users;

\echo '--- L14 PO-02A prerequisites present and valid (M4 index, invitation constraints)'
SELECT i.relname AS index_name, x.indisvalid AND x.indisready AS valid
FROM pg_class i JOIN pg_index x ON x.indexrelid = i.oid JOIN pg_namespace n ON n.oid = i.relnamespace
WHERE n.nspname = 'public'
  AND i.relname IN ('sessions_org_active_idx', 'organization_invitations_token_hash_uq', 'organization_invitations_pending_email_uq', 'organization_invitations_accepted_org_uq')
ORDER BY 1;

ROLLBACK;
