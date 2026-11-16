-- =============================================================================================
-- PROPOSAL (PO-02D0) — NOT APPROVED · NOT EXECUTED.
-- PO-02D1 — READ-ONLY verification / drift detection after the foundation (and the approved seed).
-- Changes nothing (READ ONLY transaction, ROLLBACK). Every check prints ok = t on a healthy database;
-- data invariants are in ../sql/03_post_acceptance_drift_readonly.sql. PO-02D1 would fold these checks
-- into `npm run platform:db:check` (read-only, the PO-01A/PO-02A convention).
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo '--- V01 the eight objects exist (tables F2–F8, index F1)'
SELECT o.name, to_regclass('public.' || o.name) IS NOT NULL AS ok
FROM (VALUES ('platform_settings'), ('subscription_packages'), ('subscription_package_versions'), ('tenant_primary_owners'),
             ('tenant_subscriptions'), ('subscription_events'), ('organization_invitation_terms'), ('users_org_id_id_uq')) AS o(name)
ORDER BY 1;

SELECT to_regclass('public.users_org_id_id_uq') IS NOT NULL AND to_regclass('public.platform_settings') IS NOT NULL
   AND to_regclass('public.subscription_packages') IS NOT NULL AND to_regclass('public.subscription_package_versions') IS NOT NULL
   AND to_regclass('public.tenant_primary_owners') IS NOT NULL AND to_regclass('public.tenant_subscriptions') IS NOT NULL
   AND to_regclass('public.subscription_events') IS NOT NULL AND to_regclass('public.organization_invitation_terms') IS NOT NULL AS has_d1 \gset
\if :has_d1
\echo '--- V02 F1 is valid, ready, unique and exactly the reviewed definition'
SELECT coalesce(bool_and(ix.indisvalid AND ix.indisready AND ix.indisunique
         AND pg_get_indexdef(ix.indexrelid) = 'CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (org_id, id)'), false) AS ok
FROM pg_index ix WHERE ix.indexrelid = to_regclass('public.users_org_id_id_uq');

\echo '--- V03 every guard and append-only trigger is present and ENABLED (tgenabled = O)'
SELECT t.name, coalesce(bool_and(tg.tgenabled = 'O'), false) AS ok
FROM (VALUES ('subscription_package_versions_guard'), ('subscription_package_versions_no_truncate'),
             ('tenant_primary_owners_guard'), ('tenant_primary_owners_no_truncate'),
             ('tenant_subscriptions_guard'), ('tenant_subscriptions_no_truncate'),
             ('subscription_events_immutable'), ('subscription_events_no_truncate'),
             ('organization_invitation_terms_immutable'), ('organization_invitation_terms_no_truncate')) AS t(name)
LEFT JOIN pg_trigger tg ON tg.tgname = t.name AND NOT tg.tgisinternal
GROUP BY t.name ORDER BY 1;

\echo '--- V04 the three guard functions exist (their source is compared by the migration itself)'
SELECT f.name, to_regprocedure('public.' || f.name || '()') IS NOT NULL AS ok
FROM (VALUES ('subscription_package_version_guard'), ('tenant_primary_owner_guard'), ('tenant_subscription_guard')) AS f(name)
ORDER BY 1;

\echo '--- V05 the approved seed: one settings row, one default Trial, its version 1 published and free'
SELECT (SELECT count(*) FROM public.platform_settings) = 1 AS settings_row_ok,
       (SELECT count(*) FROM public.subscription_packages WHERE is_default_trial) = 1 AS one_default_trial,
       (SELECT count(*) FROM public.subscription_package_versions v JOIN public.subscription_packages p ON p.id = v.package_id
         WHERE p.is_default_trial AND v.version_number = 1 AND v.publish_state = 'published'
           AND v.monthly_price = 0 AND v.annual_price = 0 AND v.currency_code = 'SAR') = 1 AS trial_v1_published_free,
       (SELECT count(*) FROM public.platform_audit_events WHERE action = 'package.trial_seeded') >= 1 AS seeding_audited;

\else
\echo '(PO-02D1 objects are not (all) installed: V02-V05 skipped; V01 shows which are missing)'
\endif

\echo '--- V06 PO-02A objects untouched by PO-02D1 (no column added to organization_invitations)'
SELECT count(*) = 17 AS ok, count(*) AS columns
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organization_invitations';

ROLLBACK;
