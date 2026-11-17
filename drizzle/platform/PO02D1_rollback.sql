-- =============================================================================================
-- Platform Owner — PO-02D1 (validated in PO-02D1A) — rollback, step 1 of 2: removes the seven PO-02D1
-- tables, their ten triggers and the three guard functions — and nothing else.
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION (decisions D-6 and D-7 are open). PO-02D1A runs it ONLY on
-- loopback disposable `*_test_only_*` databases.
--
-- EXACT PROCEDURE (one way only):
--   0. Roll the APPLICATION back first: no running release may read these objects.
--   1. This file — ONE transaction. Dependency order: the referencing tables first
--      (F8 organization_invitation_terms, F7 subscription_events, F6 tenant_subscriptions,
--      F5 tenant_primary_owners — the only dependant of F1 —, F4 subscription_package_versions,
--      F3 subscription_packages, F2 platform_settings), then the three functions (refused by PostgreSQL
--      while any trigger still uses one: no CASCADE anywhere). F1 is NOT touched here.
--   2. PO02D1_users_org_id_id_drop.sql — removes F1 (users_org_id_id_uq) from the customer table users in
--      its own short statements, AFTER step 1 (PostgreSQL refuses to drop it while the primary-owner
--      foreign key exists; that file also refuses with a clear message).
--
-- LOCKING (measured): dropping the seven tables removes their foreign keys' triggers on the referenced
-- tables, so step 1 holds ACCESS EXCLUSIVE on orgs, users, platform_admins and organization_invitations
-- until COMMIT (measured ~20 ms on a disposable database; every read of them waits meanwhile).
-- lock_timeout 5 s bounds each wait; a timeout rolls the whole step back (measured: nothing dropped, no
-- audit record added).
--
-- DATA GUARD: refuses, changing nothing, while ANY of the seven tables holds a row. PO-02D1A creates no row;
-- a data-bearing rollback would destroy onboarding evidence and needs its own owner-approved, backed-up plan.
-- It never touches a tenant row, a PO-01A/PO-02A object, or the append-only platform audit trail: one
-- audit record of the rollback itself is ADDED (only when there is something to remove); none is deleted.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_invitation_terms', 'subscription_events', 'tenant_subscriptions', 'tenant_primary_owners',
                           'subscription_package_versions', 'subscription_packages', 'platform_settings'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'PO-02D1 rollback refused: % holds % row(s); nothing was changed', t, n
          USING HINT = 'A data-bearing rollback needs its own owner-approved, backed-up plan.';
      END IF;
    END IF;
  END LOOP;
END
$guard$;

-- Evidence of the rollback itself (append-only; actor-less, like every migration-time record). Written only
-- when at least one PO-02D1 object is present, so a repeated rollback adds nothing.
INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
SELECT NULL, 'migration PO-02D1 rollback', 'schema.onboarding_foundation_removed', 'schema', 'PO02D1',
       jsonb_build_object('step', 1, 'removes', 'seven tables, ten triggers, three functions', 'users_key', 'kept (step 2 removes it)'),
       'success'
WHERE EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('organization_invitation_terms', 'subscription_events', 'tenant_subscriptions', 'tenant_primary_owners',
                                               'subscription_package_versions', 'subscription_packages', 'platform_settings')
) OR EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('subscription_package_version_guard', 'tenant_primary_owner_guard', 'tenant_subscription_guard')
);

-- Dependency order: referencing tables first. DROP TABLE removes their triggers; no DELETE trigger fires.
DROP TABLE IF EXISTS public.organization_invitation_terms;
DROP TABLE IF EXISTS public.subscription_events;
DROP TABLE IF EXISTS public.tenant_subscriptions;
DROP TABLE IF EXISTS public.tenant_primary_owners;
DROP TABLE IF EXISTS public.subscription_package_versions;
DROP TABLE IF EXISTS public.subscription_packages;
DROP TABLE IF EXISTS public.platform_settings;
DROP FUNCTION IF EXISTS public.tenant_subscription_guard();
DROP FUNCTION IF EXISTS public.tenant_primary_owner_guard();
DROP FUNCTION IF EXISTS public.subscription_package_version_guard();

COMMIT;
