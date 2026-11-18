-- =============================================================================================
-- Platform Owner — PO-02D1B — guarded rollback of the default Trial / platform settings seed
-- (DATA ONLY; reviewed, hand-written, retry-safe).
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION. Loopback disposable `*_test_only_*` databases only,
-- through `npm run platform:db:seed-rollback` (scripts/platform/trial-seed.ts --rollback: the
-- local-db-guard, then the release preflight). This file also refuses, by itself, any database
-- whose name is not a disposable `*_test_only_*` name or whose server is not loopback-only.
--
-- Removes EXACTLY the three seed records, and nothing else — never a schema object, never a
-- customer row, never audit evidence (the seed's own record stays; this file adds one more):
--   subscription_package_versions  Trial version 1 — only if it is exactly the seeded row
--   subscription_packages          the default Trial — only if it is exactly the seeded package
--                                  and has no other version
--   platform_settings              the singleton — only if it still holds exactly the seeded values
--                                  and no operator has ever saved it (updated_by NULL)
-- REFUSED (nothing changed, every reason named) when any of them differs, when anything references
-- the Trial (a subscription, invitation terms, another version), or when the platform has acquired
-- data that depends on the catalog (any subscription, subscription event or invitation terms row).
-- A record that is absent is skipped, so a repeated rollback changes nothing and records nothing.
--
-- PUBLISHED-VERSION IMMUTABILITY. subscription_package_versions_guard refuses to delete a published
-- version — by design. This file suspends THAT ONE trigger, on THAT ONE table, for ONE statement: the
-- DELETE of the single verified seed row (by id), inside this transaction, while it holds SHARE ROW
-- EXCLUSIVE on the table (no other session can write any version meanwhile; ALTER TABLE ... DISABLE
-- TRIGGER needs that same lock), re-enables it immediately, and asserts before COMMIT that it is
-- enabled and unchanged. DDL is transactional: on any failure the suspension is undone with everything
-- else. It never sets session_replication_role, never touches another trigger, and never touches the
-- audit trail's protection. It needs the table owner: a privileged, development-only mechanism. A
-- production rollback would need its own separately reviewed procedure (not authorized).
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $target$
DECLARE
  listen text[] := string_to_array(replace(current_setting('listen_addresses'), ' ', ''), ',');
BEGIN
  IF current_database() !~ '^[a-z0-9_]{1,63}$' OR position('_test_only_' IN current_database()) = 0 THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused: database "%" is not a disposable *_test_only_* database (development only); nothing was changed', current_database();
  END IF;
  IF host(inet_server_addr()) IS NULL OR host(inet_server_addr()) NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused: the connection does not terminate on a loopback address (development only); nothing was changed';
  END IF;
  IF cardinality(listen) = 0 OR NOT (listen <@ ARRAY['127.0.0.1', '::1', 'localhost']) THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused: the server listens beyond loopback (development only); nothing was changed';
  END IF;
END
$target$;

-- Preconditions: the catalog tables, the audit trail's protection (enabled) and the immutability guard
-- exactly as reviewed — the rollback must find the protections intact, and leaves them intact.
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  t text;
  audit_body constant text := 'BEGIN RAISE EXCEPTION ''Table % is append-only; % is not permitted'', TG_TABLE_NAME, TG_OP; END;';
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_audit_events', 'platform_settings', 'subscription_packages', 'subscription_package_versions',
                           'tenant_subscriptions', 'subscription_events', 'organization_invitation_terms'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      missing := missing || format('table %s', t);
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused — precondition failed: %; nothing was changed', array_to_string(missing, '; ');
  END IF;
  IF (SELECT count(*) FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE tg.tgrelid = 'public.platform_audit_events'::regclass AND NOT tg.tgisinternal AND tg.tgenabled IN ('O', 'A')
        AND p.proname = 'platform_reject_mutation' AND btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = audit_body
        AND (tg.tgtype & 2) = 2 AND (((tg.tgtype & 1) = 1 AND (tg.tgtype & 64) = 0 AND (tg.tgtype & 24) = 24) OR ((tg.tgtype & 1) = 0 AND (tg.tgtype & 32) = 32))) < 2 THEN
    missing := missing || 'the audit trail''s enabled append-only triggers (platform_reject_mutation)'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    WHERE tg.tgrelid = 'public.subscription_package_versions'::regclass AND tg.tgname = 'subscription_package_versions_guard'
      AND NOT tg.tgisinternal AND tg.tgenabled = 'O'
      AND replace(pg_get_triggerdef(tg.oid), 'public.', '') = 'CREATE TRIGGER subscription_package_versions_guard BEFORE DELETE OR UPDATE ON subscription_package_versions FOR EACH ROW EXECUTE FUNCTION subscription_package_version_guard()'
  ) THEN
    missing := missing || 'the enabled immutability guard subscription_package_versions_guard, as reviewed'::text;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused — precondition failed: %; nothing was changed', array_to_string(missing, '; ');
  END IF;
END
$pre$;

-- The catalog tables, and the tables that could start referencing the Trial, are locked first: the checks
-- below cannot be overtaken by a concurrent writer.
LOCK TABLE public.platform_settings, public.subscription_packages, public.subscription_package_versions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tenant_subscriptions, public.subscription_events, public.organization_invitation_terms IN SHARE MODE;

-- The approved seed values — byte-identical to the block in PO02D1B_seed_trial_and_settings.sql
-- (verify:platform-onboarding-seed proves the two files agree).
CREATE FUNCTION pg_temp.po02d1b_approved() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_build_object(
    'settings', jsonb_build_object(
      'default_trial_days', 14,
      'grace_days', 0,
      'expiry_alerts_enabled', true,
      'manual_billing', true,
      'platform_mfa_required', true,
      'platform_currency', 'SAR',
      'platform_timezone', 'Asia/Riyadh'),
    'package', jsonb_build_object(
      'code', 'trial',
      'name', 'Trial',
      'description', NULL,
      'status', 'active',
      'is_trial', true,
      'is_default_trial', true,
      'created_by_platform_admin_id', NULL),
    'version', jsonb_build_object(
      'version_number', 1,
      'publish_state', 'published',
      'is_trial', true,
      'currency_code', 'SAR',
      'monthly_price', '0.00',
      'annual_price', '0.00',
      'included_seats', 3,
      'storage_allowance_gb', 5,
      'trial_days', 14,
      'module_groups', '["Dashboard", "Projects", "Sales", "Purchasing", "Inventory", "Clients", "Finance", "People", "Administration"]'::jsonb,
      'created_by_platform_admin_id', NULL)
  )
$fn$;

CREATE FUNCTION pg_temp.po02d1b_diff(existing jsonb, approved jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT string_agg(a.key || ': existing ' || coalesce(e.value::text, 'absent') || ', approved ' || a.value::text, '; ' ORDER BY a.key)
  FROM jsonb_each(approved) a LEFT JOIN jsonb_each(existing) e ON e.key = a.key
  WHERE e.value IS DISTINCT FROM a.value
$fn$;

-- Verify everything before removing anything. Sets po02d1b.rb_settings / rb_package / rb_version to
-- 'remove' or 'absent' (transaction-local), or refuses naming every reason.
DO $verify$
DECLARE
  a jsonb := pg_temp.po02d1b_approved();
  reasons text[] := ARRAY[]::text[];
  s record;
  pkg record;
  ver record;
  existing jsonb;
  diff text;
  n bigint;
BEGIN
  -- Data that depends on the catalog: a seed rollback is never a data-bearing rollback.
  SELECT count(*) INTO n FROM public.tenant_subscriptions;
  IF n > 0 THEN reasons := reasons || format('%s subscription(s) exist', n); END IF;
  SELECT count(*) INTO n FROM public.subscription_events;
  IF n > 0 THEN reasons := reasons || format('%s subscription event(s) exist', n); END IF;
  SELECT count(*) INTO n FROM public.organization_invitation_terms;
  IF n > 0 THEN reasons := reasons || format('%s invitation terms row(s) exist', n); END IF;

  -- Settings: exactly the seeded values, never saved by an operator.
  SELECT * INTO s FROM public.platform_settings WHERE id = 1;
  IF FOUND THEN
    existing := jsonb_build_object('default_trial_days', s.default_trial_days, 'grace_days', s.grace_days,
                                   'expiry_alerts_enabled', s.expiry_alerts_enabled, 'manual_billing', s.manual_billing,
                                   'platform_mfa_required', s.platform_mfa_required, 'platform_currency', s.platform_currency,
                                   'platform_timezone', s.platform_timezone);
    diff := pg_temp.po02d1b_diff(existing, a -> 'settings');
    IF diff IS NOT NULL THEN reasons := reasons || format('platform_settings differs from the seed (%s)', diff); END IF;
    IF s.updated_by_platform_admin_id IS NOT NULL THEN reasons := reasons || 'platform_settings was saved by an operator (kept)'::text; END IF;
    PERFORM set_config('po02d1b.rb_settings', 'remove', true);
  ELSE
    PERFORM set_config('po02d1b.rb_settings', 'absent', true);
  END IF;

  -- The Trial package and its versions.
  SELECT * INTO pkg FROM public.subscription_packages WHERE code = a #>> '{package,code}';
  IF FOUND THEN
    existing := jsonb_build_object('code', pkg.code, 'name', pkg.name, 'description', pkg.description, 'status', pkg.status,
                                   'is_trial', pkg.is_trial, 'is_default_trial', pkg.is_default_trial,
                                   'created_by_platform_admin_id', pkg.created_by_platform_admin_id);
    diff := pg_temp.po02d1b_diff(existing, a -> 'package');
    IF diff IS NOT NULL THEN reasons := reasons || format('the Trial package differs from the seed (%s)', diff); END IF;
    SELECT count(*) INTO n FROM public.subscription_package_versions WHERE package_id = pkg.id AND version_number <> 1;
    IF n > 0 THEN reasons := reasons || format('the Trial package has %s other version(s)', n); END IF;
    SELECT * INTO ver FROM public.subscription_package_versions WHERE package_id = pkg.id AND version_number = 1;
    IF FOUND THEN
      existing := jsonb_build_object('version_number', ver.version_number, 'publish_state', ver.publish_state, 'is_trial', ver.is_trial,
                                     'currency_code', ver.currency_code, 'monthly_price', ver.monthly_price::text,
                                     'annual_price', ver.annual_price::text, 'included_seats', ver.included_seats,
                                     'storage_allowance_gb', ver.storage_allowance_gb, 'trial_days', ver.trial_days,
                                     'module_groups', ver.module_groups, 'created_by_platform_admin_id', ver.created_by_platform_admin_id);
      diff := pg_temp.po02d1b_diff(existing, a -> 'version');
      IF diff IS NOT NULL THEN reasons := reasons || format('Trial version 1 differs from the seed (%s)', diff); END IF;
      SELECT count(*) INTO n FROM public.tenant_subscriptions WHERE package_version_id = ver.id;
      IF n > 0 THEN reasons := reasons || format('Trial version 1 is referenced by %s subscription(s)', n); END IF;
      SELECT count(*) INTO n FROM public.organization_invitation_terms WHERE initial_package_version_id = ver.id;
      IF n > 0 THEN reasons := reasons || format('Trial version 1 is referenced by %s invitation terms row(s)', n); END IF;
      PERFORM set_config('po02d1b.rb_version', ver.id::text, true);
    ELSE
      PERFORM set_config('po02d1b.rb_version', 'absent', true);
    END IF;
    PERFORM set_config('po02d1b.rb_package', pkg.id::text, true);
  ELSE
    PERFORM set_config('po02d1b.rb_package', 'absent', true);
    PERFORM set_config('po02d1b.rb_version', 'absent', true);
    IF EXISTS (SELECT 1 FROM public.subscription_packages WHERE is_default_trial) THEN
      reasons := reasons || 'another package is the default Trial (not the seed''s)'::text;
    END IF;
  END IF;

  IF array_length(reasons, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B rollback refused: %; nothing was changed', array_to_string(reasons, '; ')
      USING HINT = 'Only the untouched seed is removed; anything an operator or a later phase built on it is retained.';
  END IF;
END
$verify$;

-- R1 — Trial version 1: the ONE scoped suspension of the immutability guard (see header).
CREATE FUNCTION pg_temp.po02d1b_remove_version() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  target text := current_setting('po02d1b.rb_version', true);
  n integer;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'PO-02D1B rollback: verification did not run (internal error); nothing was changed';
  END IF;
  IF target = 'absent' THEN
    RETURN 'absent';
  END IF;
  ALTER TABLE public.subscription_package_versions DISABLE TRIGGER subscription_package_versions_guard;
  DELETE FROM public.subscription_package_versions WHERE id = target::uuid AND version_number = 1 AND publish_state = 'published';
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE public.subscription_package_versions ENABLE TRIGGER subscription_package_versions_guard;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PO-02D1B rollback: expected to remove exactly the seeded Trial version 1, removed %; nothing was changed', n;
  END IF;
  RETURN 'removed';
END
$fn$;

-- R2 — the Trial package (no trigger; its versions are gone, so no foreign key holds it).
CREATE FUNCTION pg_temp.po02d1b_remove_package() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  target text := current_setting('po02d1b.rb_package', true);
  n integer;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'PO-02D1B rollback: verification did not run (internal error); nothing was changed';
  END IF;
  IF target = 'absent' THEN
    RETURN 'absent';
  END IF;
  DELETE FROM public.subscription_packages WHERE id = target::uuid AND code = 'trial' AND is_default_trial AND created_by_platform_admin_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PO-02D1B rollback: expected to remove exactly the seeded Trial package, removed %; nothing was changed', n;
  END IF;
  RETURN 'removed';
END
$fn$;

-- R3 — the settings singleton.
CREATE FUNCTION pg_temp.po02d1b_remove_settings() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  target text := current_setting('po02d1b.rb_settings', true);
  n integer;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'PO-02D1B rollback: verification did not run (internal error); nothing was changed';
  END IF;
  IF target = 'absent' THEN
    RETURN 'absent';
  END IF;
  DELETE FROM public.platform_settings WHERE id = 1 AND updated_by_platform_admin_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PO-02D1B rollback: expected to remove exactly the seeded settings row, removed %; nothing was changed', n;
  END IF;
  RETURN 'removed';
END
$fn$;

-- R4 — evidence of the rollback itself (append-only), only when something was removed.
CREATE FUNCTION pg_temp.po02d1b_record_rollback(r1 text, r2 text, r3 text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  IF 'removed' NOT IN (r1, r2, r3) THEN
    RETURN 'none (nothing to remove)';
  END IF;
  INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
  VALUES (NULL, 'migration PO-02D1B seed rollback', 'seed.trial_and_settings_removed', 'seed', 'PO02D1B',
          jsonb_build_object('trial_version_1', r1, 'trial_package', r2, 'platform_settings', r3,
                             'immutability_guard', 'suspended for the single DELETE of the verified seeded version, re-enabled before commit'),
          'success');
  RETURN 'recorded';
END
$fn$;

SELECT 'R1 subscription_package_versions trial v1: ' || (SELECT set_config('po02d1b.r1', pg_temp.po02d1b_remove_version(), true)) AS po02d1b_step;
SELECT 'R2 subscription_packages trial: ' || (SELECT set_config('po02d1b.r2', pg_temp.po02d1b_remove_package(), true)) AS po02d1b_step;
SELECT 'R3 platform_settings: ' || (SELECT set_config('po02d1b.r3', pg_temp.po02d1b_remove_settings(), true)) AS po02d1b_step;
SELECT 'R4 platform_audit_events: ' || pg_temp.po02d1b_record_rollback(current_setting('po02d1b.r1'), current_setting('po02d1b.r2'), current_setting('po02d1b.r3')) AS po02d1b_step;

-- Postconditions before COMMIT: the immutability guard enabled and unchanged; every other onboarding
-- trigger and the audit trail's triggers untouched (still enabled).
DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    WHERE tg.tgrelid = 'public.subscription_package_versions'::regclass AND tg.tgname = 'subscription_package_versions_guard' AND tg.tgenabled = 'O'
      AND replace(pg_get_triggerdef(tg.oid), 'public.', '') = 'CREATE TRIGGER subscription_package_versions_guard BEFORE DELETE OR UPDATE ON subscription_package_versions FOR EACH ROW EXECUTE FUNCTION subscription_package_version_guard()'
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT tg.tgisinternal AND tg.tgenabled <> 'O'
      AND c.relname IN ('platform_audit_events', 'subscription_package_versions', 'tenant_primary_owners', 'tenant_subscriptions',
                        'subscription_events', 'organization_invitation_terms')
  ) THEN
    RAISE EXCEPTION 'PO-02D1B rollback: postcondition failed — a protection trigger is not enabled as reviewed; nothing was changed';
  END IF;
END
$post$;

DROP FUNCTION pg_temp.po02d1b_record_rollback(text, text, text);
DROP FUNCTION pg_temp.po02d1b_remove_settings();
DROP FUNCTION pg_temp.po02d1b_remove_package();
DROP FUNCTION pg_temp.po02d1b_remove_version();
DROP FUNCTION pg_temp.po02d1b_diff(jsonb, jsonb);
DROP FUNCTION pg_temp.po02d1b_approved();

COMMIT;
