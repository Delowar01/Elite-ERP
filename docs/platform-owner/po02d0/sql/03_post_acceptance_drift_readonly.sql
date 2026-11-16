-- =============================================================================================
-- PO-02D0 — READ-ONLY drift checks for AFTER PO-02D1 (foundation) and PO-02D3 (acceptance) exist.
-- Every query must return zero rows / zero counts on a healthy database. Until the PO-02D1 objects
-- are installed the file only reports that they are absent (tested that way in PO-02D0).
-- Same safety envelope as 02_…: READ ONLY transaction, timeouts, ids and counts only.
-- Production use is part of the D-7 read-only measurement authorization.
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT to_regclass('public.tenant_primary_owners') IS NOT NULL
   AND to_regclass('public.tenant_subscriptions') IS NOT NULL
   AND to_regclass('public.subscription_events') IS NOT NULL
   AND to_regclass('public.subscription_package_versions') IS NOT NULL
   AND to_regclass('public.organization_invitation_terms') IS NOT NULL
   AND to_regclass('public.organization_invitations') IS NOT NULL
   AND to_regclass('public.tenant_access_controls') IS NOT NULL AS has_d1 \gset

\if :has_d1
\echo '--- R01 accepted invitations whose company lacks a foundation record (expect 0 each)'
SELECT count(*) FILTER (WHERE t.org_id IS NULL OR t.access_status <> 'active') AS without_active_access_row,
       count(*) FILTER (WHERE p.org_id IS NULL)                                AS without_primary_owner,
       count(*) FILTER (WHERE s.id IS NULL)                                    AS without_current_subscription,
       count(*) FILTER (WHERE s.id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM subscription_events e WHERE e.tenant_subscription_id = s.id AND e.event_type = 'assigned')) AS without_assigned_event
FROM organization_invitations i
LEFT JOIN tenant_access_controls t ON t.org_id = i.accepted_org_id
LEFT JOIN tenant_primary_owners p ON p.org_id = i.accepted_org_id
LEFT JOIN tenant_subscriptions s ON s.org_id = i.accepted_org_id AND s.superseded_at IS NULL
WHERE i.accepted_at IS NOT NULL;

\echo '--- R02 primary owners that are not an active canonical owner of their company (expect 0)'
SELECT count(*) AS invalid_primary_owners, coalesce(array_agg(p.org_id ORDER BY p.org_id), '{}') AS org_ids
FROM tenant_primary_owners p
LEFT JOIN users u ON u.id = p.user_id AND u.org_id = p.org_id
WHERE u.id IS NULL OR u.role <> 'owner' OR NOT u.is_active;

\echo '--- R03 current subscriptions whose snapshot differs from the assigned published version (expect 0)'
SELECT count(*) AS snapshot_drift
FROM tenant_subscriptions s
JOIN subscription_package_versions v ON v.id = s.package_version_id
WHERE s.superseded_at IS NULL
  AND (s.seats_snapshot <> v.included_seats OR s.storage_snapshot_gb <> v.storage_allowance_gb
       OR s.module_groups_snapshot <> v.module_groups
       OR s.price_snapshot_sar <> CASE s.cycle WHEN 'monthly' THEN v.monthly_price WHEN 'annual' THEN v.annual_price ELSE 0 END);

\echo '--- R04 invitations without their initial terms (expect 0; acceptance refuses them)'
SELECT count(*) AS invitations_without_terms
FROM organization_invitations i
WHERE NOT EXISTS (SELECT 1 FROM organization_invitation_terms x WHERE x.invitation_id = i.id);

\echo '--- R05 companies with an active access row and no tenant data defaults (seed check: chart of accounts present)'
SELECT count(*) AS accepted_orgs_without_chart_of_accounts
FROM organization_invitations i
WHERE i.accepted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.org_id = i.accepted_org_id);

\echo '--- R06 trial subscriptions whose end date is not start + trial_days - 1 (the proposed inclusive convention)'
SELECT count(*) AS trial_term_drift
FROM tenant_subscriptions s
JOIN subscription_package_versions v ON v.id = s.package_version_id
WHERE s.cycle = 'trial' AND s.assignment_source = 'invitation_acceptance'
  AND s.end_date <> s.start_date + (v.trial_days - 1);
\else
\echo '(PO-02D1 objects are not installed: nothing to check yet)'
\endif

ROLLBACK;
