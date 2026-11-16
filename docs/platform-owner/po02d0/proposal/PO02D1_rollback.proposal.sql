-- =============================================================================================
-- PROPOSAL (PO-02D0) — NOT APPROVED · NOT EXECUTED.
-- Platform Owner — PO-02D1 — rollback: removes ONLY what PO02D1_onboarding_foundation.sql and the
-- approved seed create. Never touches a tenant row, a PO-01A/PO-02A object, or the append-only platform
-- audit trail (the seeding record and this rollback's record stay as evidence).
--
-- DATA GUARD: refuses, changing nothing, while any of tenant_primary_owners, tenant_subscriptions,
-- subscription_events or organization_invitation_terms holds a row, or while the catalog holds anything
-- other than the seeded default Trial (version 1). Removing onboarding history destroys evidence and
-- needs its own owner-approved, backed-up plan; it is never part of a routine rollback.
--
-- ORDER: roll the APPLICATION back first (no release may still read these objects), then this file.
-- LOCKING: DROP INDEX takes ACCESS EXCLUSIVE on `users` for an instant. In production drop F1 first
-- without blocking: DROP INDEX CONCURRENTLY IF EXISTS public.users_org_id_id_uq; (autocommit), then run
-- this file (its DROP INDEX IF EXISTS is then a no-op). The composite FK from tenant_primary_owners must
-- already be gone, i.e. this file's DROP TABLE must run before any CONCURRENTLY drop in practice — so the
-- production order is: this file WITHOUT its last statement, then the concurrent index drop.
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN;
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D0 PROPOSAL — not approved for execution (docs/platform-owner/PO02D0_DECISIONS.md §G)';
END $proposal_guard$;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_primary_owners', 'tenant_subscriptions', 'subscription_events', 'organization_invitation_terms'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'PO-02D1 rollback refused: % holds % row(s); nothing was changed', t, n
          USING HINT = 'A data-bearing rollback needs its own owner-approved, backed-up plan.';
      END IF;
    END IF;
  END LOOP;
  IF to_regclass('public.subscription_packages') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.subscription_packages WHERE code <> 'trial';
    IF n > 0 THEN
      RAISE EXCEPTION 'PO-02D1 rollback refused: % operator-created package(s) exist; nothing was changed', n;
    END IF;
  END IF;
  IF to_regclass('public.subscription_package_versions') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.subscription_package_versions v
    JOIN public.subscription_packages p ON p.id = v.package_id
    WHERE NOT (p.code = 'trial' AND v.version_number = 1);
    IF n > 0 THEN
      RAISE EXCEPTION 'PO-02D1 rollback refused: % package version(s) beyond the seeded Trial v1 exist; nothing was changed', n;
    END IF;
  END IF;
END
$guard$;

-- Evidence of the rollback itself (append-only; actor-less like the seeding record).
INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
SELECT NULL, 'rollback PO-02D1', 'package.trial_seed_rolled_back', 'subscription_package', 'trial', '{"objects":"PO-02D1"}'::jsonb, 'success'
WHERE to_regclass('public.subscription_packages') IS NOT NULL;

-- Dependency order: referencing tables first. DROP TABLE removes their triggers; DELETE triggers do not fire.
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
DROP INDEX IF EXISTS public.users_org_id_id_uq;

COMMIT;
