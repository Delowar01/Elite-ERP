-- =============================================================================================
-- PO-03A — READ-ONLY legacy primary-owner and user-seat analysis (decisions O-2, T-2; a D-7 input).
--
-- Purpose: measure, per PO-00 owner class A–F, what a later, owner-approved primary-owner decision and the
-- future seat enforcement depend on — WITHOUT changing anything:
--   P00 environment (server version; which Platform Owner objects exist)
--   P01 owner classes A–F with their user and seat counts (PO-00 §F.5; the same CASE as PO-02D0 L03)
--   P02 primary-owner mappings per class, and mapped users who are no longer an active owner (R02 drift)
--   P03 current subscriptions per class and companies above their seats snapshot (informational only)
--   P04 class A/B companies WITHOUT a mapping — CANDIDATES for a future owner-approved step, never assigned here
--   P05 users per company (max, p50, p95; active + disabled) — the T-2 / seat sizing input
--   P06 role values that the role checks do not treat as owner/admin/staff (O-5)
--
-- Safety:
--   * one READ ONLY transaction (REPEATABLE READ: every query sees the same snapshot), ROLLBACK at the end;
--     statement_timeout 15 s, lock_timeout 2 s; refuses unless transaction_read_only = on;
--   * output is counts, class labels and numeric ids only (at most 100 per list): no e-mail, name, hash or token;
--   * objects that may not exist (production has no Platform Owner tables before D-6) are probed with to_regclass
--     and their sections are skipped with a note — the file never fails on their absence.
-- Validated ONLY on disposable *_test_only_* databases (verify:platform-seat-accounting, with the PO-02D0 fictional
-- fixtures). Running it against production requires SEPARATE owner authorization (decision D-7, PO02D0 §F.4).
--   psql -X -v ON_ERROR_STOP=1 -f legacy_owner_seat_analysis_readonly.sql
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT current_setting('transaction_read_only') = 'on' AS read_only,
       to_regclass('public.tenant_primary_owners') IS NOT NULL AS has_tpo,
       (to_regclass('public.tenant_subscriptions') IS NOT NULL AND to_regclass('public.subscription_package_versions') IS NOT NULL
        AND to_regclass('public.subscription_packages') IS NOT NULL) AS has_sub \gset
\if :read_only
\else
  \echo 'REFUSED: the transaction is not read-only'
  \quit
\endif

\echo '--- P00 environment'
SELECT 'P00' AS check_id, current_setting('server_version_num') AS server_version_num,
       :'has_tpo'::boolean AS tenant_primary_owners_installed, :'has_sub'::boolean AS subscriptions_installed;

\echo '--- P01 owner classes A–F (A: one active owner; B: one active + disabled owner(s); C: several active owners; D: only disabled owners; E: no users; F: no owner role)'
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P01' AS check_id, class, count(*) AS orgs, sum(users) AS occupied_seats, sum(active_users) AS active_users,
       sum(users - active_users) AS disabled_users, max(users) AS max_users_in_one_company,
       (array_agg(org_id ORDER BY org_id))[1:100] AS first_org_ids
FROM po03a_classes GROUP BY class ORDER BY class;

\echo '--- P02 primary-owner mappings per class (O-2: legacy companies stay not designated; R02: a mapped user no longer an active owner)'
\if :has_tpo
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P02' AS check_id, c.class, count(*) AS orgs,
       count(p.org_id) AS mapped,
       count(p.org_id) FILTER (WHERE u.role = 'owner' AND u.is_active) AS mapped_active_owner,
       count(p.org_id) FILTER (WHERE NOT (u.role = 'owner' AND u.is_active)) AS mapped_not_active_owner,
       coalesce((array_agg(p.org_id ORDER BY p.org_id) FILTER (WHERE NOT (u.role = 'owner' AND u.is_active)))[1:100], '{}') AS drift_org_ids
FROM po03a_classes c
LEFT JOIN public.tenant_primary_owners p ON p.org_id = c.org_id
LEFT JOIN public.users u ON u.id = p.user_id AND u.org_id = p.org_id
GROUP BY c.class ORDER BY c.class;
\else
\echo 'P02 not installed: tenant_primary_owners does not exist — every company is "not designated"'
\endif

\echo '--- P03 current subscriptions per class and companies above their seats snapshot (display only; nothing is enforced)'
\if :has_sub
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P03' AS check_id, c.class, count(*) AS orgs,
       count(s.org_id) AS with_current_subscription,
       count(*) - count(s.org_id) AS without_subscription,
       count(s.org_id) FILTER (WHERE c.users > s.seats_snapshot) AS above_seats_snapshot,
       coalesce((array_agg(c.org_id ORDER BY c.org_id) FILTER (WHERE c.users > s.seats_snapshot))[1:100], '{}') AS above_snapshot_org_ids
FROM po03a_classes c
LEFT JOIN public.tenant_subscriptions s ON s.org_id = c.org_id AND s.superseded_at IS NULL
GROUP BY c.class ORDER BY c.class;
\else
\echo 'P03 not installed: no subscription can exist — every company has no seat allowance'
\endif

\echo '--- P04 class A / B companies without a mapping: candidates only (a backfill is a separate, owner-approved step; B needs confirmation)'
\if :has_tpo
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P04' AS check_id, c.class, count(*) AS unmapped_candidates, (array_agg(c.org_id ORDER BY c.org_id))[1:100] AS first_org_ids
FROM po03a_classes c
WHERE c.class IN ('A_single_active_owner', 'B_single_active_plus_inactive_owner')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_primary_owners p WHERE p.org_id = c.org_id)
GROUP BY c.class ORDER BY c.class;
\else
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P04' AS check_id, c.class, count(*) AS unmapped_candidates, (array_agg(c.org_id ORDER BY c.org_id))[1:100] AS first_org_ids
FROM po03a_classes c
WHERE c.class IN ('A_single_active_owner', 'B_single_active_plus_inactive_owner')
GROUP BY c.class ORDER BY c.class;
\endif

\echo '--- P05 users per company (active + disabled) — seat sizing, not a value'
WITH o AS (
  SELECT g.id AS org_id,
         count(u.id)                                                     AS users,
         count(u.id) FILTER (WHERE u.is_active)                          AS active_users,
         count(u.id) FILTER (WHERE u.role = 'owner' AND u.is_active)     AS active_owners,
         count(u.id) FILTER (WHERE u.role = 'owner' AND NOT u.is_active) AS inactive_owners
  FROM public.orgs g LEFT JOIN public.users u ON u.org_id = g.id
  GROUP BY g.id
), po03a_classes AS (
SELECT org_id, users, active_users,
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
SELECT 'P05' AS check_id, count(*) AS orgs, coalesce(max(users), 0) AS max_users,
       coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY users), 0) AS p50_users,
       coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY users), 0) AS p95_users,
       count(*) FILTER (WHERE users > 3) AS orgs_above_three_users
FROM po03a_classes;

\echo '--- P06 role values outside owner / admin / staff (never treated as an owner)'
SELECT 'P06' AS check_id, role, count(*) AS users FROM public.users WHERE role NOT IN ('owner', 'admin', 'staff') GROUP BY role ORDER BY role;

ROLLBACK;
