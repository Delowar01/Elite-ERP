-- =============================================================================================
-- Platform Owner — PO-02D1B — default Trial package and platform settings seed (DATA ONLY;
-- reviewed, hand-written, retry-safe).
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION. PO-02D1B authorizes ONLY loopback disposable
-- `*_test_only_*` databases, through `npm run platform:db:seed` (scripts/platform/trial-seed.ts:
-- the local-db-guard first, then the release preflight must report PUSH_SAFE and
-- REVIEWED_SQL_COMPLETE). This file also refuses, by itself, any database whose name is not a
-- disposable `*_test_only_*` name or whose server is not loopback-only. A production seed is a
-- separate owner decision (D-6 / D-7 open).
--
-- OWNER-APPROVED BUSINESS VALUES (PO-02D1B, development only):
--   Trial duration 14 days · included seats 3 · storage allowance 5 GB · included modules: all
--   existing ERP modules · grace period 0 days · expiry alerts enabled · price SAR 0.00.
-- SPECIFICATION-DERIVED CONVENTIONS (Stage 2 Schema / PRD / TRD — not owner inputs):
--   package code `trial`, stored English name `Trial` (the Arabic label comes from the dictionary);
--   the PUBLISHED Trial version governs trial_days; business time zone Asia/Riyadh; inclusive Trial
--   term (end = start + trial_days − 1 — applied when a subscription is assigned; none is created
--   here); manual billing and Platform Owner MFA locked on; an expiry never suspends a company.
-- MODULE GROUPS: a display-only catalog snapshot — the nine navigation groups of
--   src/components/layout/nav-config.ts in declaration order (the unlabelled first group is named by
--   its only item, Dashboard), reconciled with src/lib/role-matrix.ts. No entitlement registry exists
--   and nothing here grants, hides or blocks anything (Stage 2: "configured — not enforced").
--
-- Writes, and nothing else:
--   platform_settings              the singleton row (id 1)
--   subscription_packages          the default Trial package (system-seeded: no operator)
--   subscription_package_versions  Trial version 1, PUBLISHED (immutable from then on: guard trigger)
--   platform_audit_events          ONE append-only record — only when something was created
-- No subscription, primary owner, invitation, invitation terms, subscription event or paid package is
-- created, and no customer table is read or written.
--
-- RETRY-SAFE: each record is created when absent, verified when present with exactly the approved
-- values, and REFUSED — the whole transaction aborts, naming every difference — when present with any
-- other value. A re-run that only verifies writes nothing, not even an audit record.
-- ONE transaction: any failure, the audit record included, leaves nothing behind.
-- CONCURRENCY: the three catalog tables are locked SHARE ROW EXCLUSIVE before anything is read, so
-- concurrent seeds serialize (the second one verifies). No customer table is locked.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------
-- Target guard: disposable and loopback-only, exactly like scripts/platform/local-db-guard.ts.
-- ---------------------------------------------------------------------------------------------
DO $target$
DECLARE
  listen text[] := string_to_array(replace(current_setting('listen_addresses'), ' ', ''), ',');
BEGIN
  IF current_database() !~ '^[a-z0-9_]{1,63}$' OR position('_test_only_' IN current_database()) = 0 THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: database "%" is not a disposable *_test_only_* database (development only); nothing was changed', current_database();
  END IF;
  IF host(inet_server_addr()) IS NULL OR host(inet_server_addr()) NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: the connection does not terminate on a loopback address (development only); nothing was changed';
  END IF;
  IF cardinality(listen) = 0 OR NOT (listen <@ ARRAY['127.0.0.1', '::1', 'localhost']) THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: the server listens beyond loopback (development only); nothing was changed';
  END IF;
END
$target$;

-- ---------------------------------------------------------------------------------------------
-- Preconditions: the complete reviewed foundation — PO-01A (with its append-only audit trail
-- enabled), PO-02A and PO-02D1A (F1, seven tables, three guard functions, ten enabled triggers).
-- Judged by catalog semantics; the runner's release preflight checks the same and more.
-- ---------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  t text;
  audit_body constant text := 'BEGIN RAISE EXCEPTION ''Table % is append-only; % is not permitted'', TG_TABLE_NAME, TG_OP; END;';
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_admins', 'platform_sessions', 'platform_login_attempts', 'platform_audit_events',
                           'tenant_access_controls', 'organization_invitations',
                           'platform_settings', 'subscription_packages', 'subscription_package_versions', 'tenant_primary_owners',
                           'tenant_subscriptions', 'subscription_events', 'organization_invitation_terms'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      missing := missing || format('table %s', t);
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B seed refused — precondition failed: %; nothing was changed', array_to_string(missing, '; ');
  END IF;

  -- PO-01A: the audit trail is append-only and ENABLED (decoy-resistant: bound by relation, enabled, BEFORE, the
  -- right events and level, the reviewed function body — the rule of src/lib/platform/audit-protection.ts).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.platform_audit_events'::regclass AND NOT tg.tgisinternal AND tg.tgenabled IN ('O', 'A')
      AND p.proname = 'platform_reject_mutation' AND btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = audit_body
      AND (tg.tgtype & 1) = 1 AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 64) = 0 AND (tg.tgtype & 24) = 24
  ) THEN
    missing := missing || 'the audit trail''s enabled BEFORE UPDATE OR DELETE row trigger (platform_reject_mutation)'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.platform_audit_events'::regclass AND NOT tg.tgisinternal AND tg.tgenabled IN ('O', 'A')
      AND p.proname = 'platform_reject_mutation' AND btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = audit_body
      AND (tg.tgtype & 1) = 0 AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 32) = 32
  ) THEN
    missing := missing || 'the audit trail''s enabled BEFORE TRUNCATE statement trigger (platform_reject_mutation)'::text;
  END IF;

  -- PO-02A: the two indexes, present and valid.
  FOREACH t IN ARRAY ARRAY['sessions_org_active_idx', 'platform_audit_events_entity_idx'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index ix WHERE ix.indexrelid = to_regclass(format('public.%I', t)) AND ix.indisvalid AND ix.indisready) THEN
      missing := missing || format('valid index %s (PO-02A)', t);
    END IF;
  END LOOP;

  -- PO-02D1A F1: users_org_id_id_uq, a validated, non-deferrable UNIQUE (id, org_id) with a valid index.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_index ix ON ix.indexrelid = con.conindid
    WHERE con.conrelid = 'public.users'::regclass AND con.conname = 'users_org_id_id_uq' AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) = 'UNIQUE (id, org_id)' AND con.convalidated AND NOT con.condeferrable
      AND ix.indisvalid AND ix.indisready
  ) THEN
    missing := missing || 'F1 users_org_id_id_uq (validated UNIQUE (id, org_id), valid index)'::text;
  END IF;

  -- PO-02D1A: the three guard functions (search_path pinned, not SECURITY DEFINER).
  FOREACH t IN ARRAY ARRAY['subscription_package_version_guard', 'tenant_primary_owner_guard', 'tenant_subscription_guard'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = t AND p.pronargs = 0
        AND NOT p.prosecdef AND array_to_string(p.proconfig, ',') = 'search_path=pg_catalog'
    ) THEN
      missing := missing || format('guard function %s()', t);
    END IF;
  END LOOP;

  -- PO-02D1A: exactly the ten reviewed triggers, each ENABLED, on its table, with its reviewed definition.
  FOR r IN
    SELECT e.tbl, e.trg, e.def, tg.tgenabled, replace(pg_get_triggerdef(tg.oid), 'public.', '') AS actual
    FROM (VALUES
      ('subscription_package_versions', 'subscription_package_versions_guard', 'CREATE TRIGGER subscription_package_versions_guard BEFORE DELETE OR UPDATE ON subscription_package_versions FOR EACH ROW EXECUTE FUNCTION subscription_package_version_guard()'),
      ('subscription_package_versions', 'subscription_package_versions_no_truncate', 'CREATE TRIGGER subscription_package_versions_no_truncate BEFORE TRUNCATE ON subscription_package_versions FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation()'),
      ('tenant_primary_owners', 'tenant_primary_owners_guard', 'CREATE TRIGGER tenant_primary_owners_guard BEFORE INSERT OR DELETE OR UPDATE ON tenant_primary_owners FOR EACH ROW EXECUTE FUNCTION tenant_primary_owner_guard()'),
      ('tenant_primary_owners', 'tenant_primary_owners_no_truncate', 'CREATE TRIGGER tenant_primary_owners_no_truncate BEFORE TRUNCATE ON tenant_primary_owners FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation()'),
      ('tenant_subscriptions', 'tenant_subscriptions_guard', 'CREATE TRIGGER tenant_subscriptions_guard BEFORE DELETE OR UPDATE ON tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscription_guard()'),
      ('tenant_subscriptions', 'tenant_subscriptions_no_truncate', 'CREATE TRIGGER tenant_subscriptions_no_truncate BEFORE TRUNCATE ON tenant_subscriptions FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation()'),
      ('subscription_events', 'subscription_events_immutable', 'CREATE TRIGGER subscription_events_immutable BEFORE DELETE OR UPDATE ON subscription_events FOR EACH ROW EXECUTE FUNCTION platform_reject_mutation()'),
      ('subscription_events', 'subscription_events_no_truncate', 'CREATE TRIGGER subscription_events_no_truncate BEFORE TRUNCATE ON subscription_events FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation()'),
      ('organization_invitation_terms', 'organization_invitation_terms_immutable', 'CREATE TRIGGER organization_invitation_terms_immutable BEFORE DELETE OR UPDATE ON organization_invitation_terms FOR EACH ROW EXECUTE FUNCTION platform_reject_mutation()'),
      ('organization_invitation_terms', 'organization_invitation_terms_no_truncate', 'CREATE TRIGGER organization_invitation_terms_no_truncate BEFORE TRUNCATE ON organization_invitation_terms FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation()')
    ) AS e(tbl, trg, def)
    LEFT JOIN pg_trigger tg ON tg.tgrelid = to_regclass(format('public.%I', e.tbl)) AND tg.tgname = e.trg AND NOT tg.tgisinternal
  LOOP
    IF r.tgenabled IS NULL THEN
      missing := missing || format('trigger %s.%s', r.tbl, r.trg);
    ELSIF r.tgenabled <> 'O' THEN
      missing := missing || format('trigger %s.%s ENABLED (it is %s)', r.tbl, r.trg, r.tgenabled);
    ELSIF r.actual <> r.def THEN
      missing := missing || format('trigger %s.%s as reviewed (it is: %s)', r.tbl, r.trg, r.actual);
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B seed refused — precondition failed: %; nothing was changed', array_to_string(missing, '; ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------
-- Serialize concurrent seeds (and any concurrent writer of the catalog) before anything is read.
-- SHARE ROW EXCLUSIVE conflicts with itself and with every row write; plain reads continue.
-- ---------------------------------------------------------------------------------------------
LOCK TABLE public.platform_settings, public.subscription_packages, public.subscription_package_versions IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------------------------
-- The approved values — the ONE place they are written. Every step reads them from here.
-- ---------------------------------------------------------------------------------------------
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

-- Every differing key, as "key: existing X, approved Y" (no secret lives in these tables).
CREATE FUNCTION pg_temp.po02d1b_diff(existing jsonb, approved jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT string_agg(a.key || ': existing ' || coalesce(e.value::text, 'absent') || ', approved ' || a.value::text, '; ' ORDER BY a.key)
  FROM jsonb_each(approved) a LEFT JOIN jsonb_each(existing) e ON e.key = a.key
  WHERE e.value IS DISTINCT FROM a.value
$fn$;

-- The approved values are validated against the Stage 2 rules before any row is written.
DO $values$
DECLARE
  a jsonb := pg_temp.po02d1b_approved();
  problems text[] := ARRAY[]::text[];
  m jsonb := a #> '{version,module_groups}';
BEGIN
  IF (a #>> '{settings,default_trial_days}')::int NOT BETWEEN 1 AND 120 THEN problems := problems || 'default_trial_days must be 1–120'::text; END IF;
  IF (a #>> '{version,trial_days}')::int IS DISTINCT FROM (a #>> '{settings,default_trial_days}')::int THEN
    problems := problems || 'the settings default and the published Trial version must state the same trial days'::text;
  END IF;
  IF (a #>> '{settings,grace_days}')::int NOT BETWEEN 0 AND 60 THEN problems := problems || 'grace_days must be 0–60'::text; END IF;
  IF NOT ((a #>> '{settings,manual_billing}')::boolean AND (a #>> '{settings,platform_mfa_required}')::boolean) THEN
    problems := problems || 'manual billing and Platform Owner MFA are locked on'::text;
  END IF;
  IF a #>> '{settings,platform_currency}' <> 'SAR' OR a #>> '{version,currency_code}' <> 'SAR' THEN problems := problems || 'the currency is SAR'::text; END IF;
  IF a #>> '{settings,platform_timezone}' <> 'Asia/Riyadh' THEN problems := problems || 'the business time zone is Asia/Riyadh'::text; END IF;
  IF a #>> '{version,monthly_price}' <> '0.00' OR a #>> '{version,annual_price}' <> '0.00' THEN problems := problems || 'the Trial price is SAR 0.00'::text; END IF;
  IF (a #>> '{version,included_seats}')::int < 1 OR (a #>> '{version,storage_allowance_gb}')::int < 1 THEN problems := problems || 'seats and storage are at least 1'::text; END IF;
  IF a #>> '{package,code}' !~ '^[a-z][a-z0-9-]{1,39}$' OR a #>> '{package,name}' <> btrim(a #>> '{package,name}') THEN problems := problems || 'package code / name format'::text; END IF;
  IF jsonb_typeof(m) <> 'array' OR jsonb_array_length(m) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(m) x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' !~ '^[A-Z][A-Za-z]{1,39}$')
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(m) x) <> jsonb_array_length(m) THEN
    problems := problems || 'module_groups must be a non-empty list of distinct navigation-group labels'::text;
  END IF;
  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'PO-02D1B seed refused — the approved values break a Stage 2 rule: %; nothing was changed', array_to_string(problems, '; ');
  END IF;
END
$values$;

-- ---------------------------------------------------------------------------------------------
-- S1 — platform_settings (the singleton). System-seeded: no operator (updated_by stays NULL).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.po02d1b_seed_settings() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  a jsonb := pg_temp.po02d1b_approved() -> 'settings';
  existing jsonb;
  diff text;
BEGIN
  SELECT jsonb_build_object('default_trial_days', s.default_trial_days, 'grace_days', s.grace_days,
                            'expiry_alerts_enabled', s.expiry_alerts_enabled, 'manual_billing', s.manual_billing,
                            'platform_mfa_required', s.platform_mfa_required, 'platform_currency', s.platform_currency,
                            'platform_timezone', s.platform_timezone)
    INTO existing
  FROM public.platform_settings s WHERE s.id = 1;
  IF existing IS NULL THEN
    INSERT INTO public.platform_settings (id, default_trial_days, grace_days, expiry_alerts_enabled, manual_billing,
                                          platform_mfa_required, platform_currency, platform_timezone, updated_by_platform_admin_id)
    VALUES (1, (a ->> 'default_trial_days')::int, (a ->> 'grace_days')::int, (a ->> 'expiry_alerts_enabled')::boolean,
            (a ->> 'manual_billing')::boolean, (a ->> 'platform_mfa_required')::boolean, a ->> 'platform_currency',
            a ->> 'platform_timezone', NULL);
    PERFORM set_config('po02d1b.settings', 'created', true);
    RETURN 'created';
  END IF;
  diff := pg_temp.po02d1b_diff(existing, a);
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: platform_settings differs from the approved seed (%); nothing was changed', diff
      USING HINT = 'Existing settings are never overwritten by the seed; an owner-approved change needs its own procedure.';
  END IF;
  PERFORM set_config('po02d1b.settings', 'verified', true);
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- S2 — the default Trial package. The only package without an operator (attribution CHECK).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.po02d1b_seed_package() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  a jsonb := pg_temp.po02d1b_approved() -> 'package';
  existing jsonb;
  diff text;
  other text;
BEGIN
  SELECT jsonb_build_object('code', p.code, 'name', p.name, 'description', p.description, 'status', p.status,
                            'is_trial', p.is_trial, 'is_default_trial', p.is_default_trial,
                            'created_by_platform_admin_id', p.created_by_platform_admin_id)
    INTO existing
  FROM public.subscription_packages p WHERE p.code = a ->> 'code';
  IF existing IS NULL THEN
    SELECT string_agg(p.code, ', ' ORDER BY p.code) INTO other
    FROM public.subscription_packages p WHERE p.is_default_trial OR lower(p.name) = lower(a ->> 'name');
    IF other IS NOT NULL THEN
      RAISE EXCEPTION 'PO-02D1B seed refused: another package is already the default Trial or named Trial (code %); nothing was changed', other;
    END IF;
    INSERT INTO public.subscription_packages (code, name, description, status, is_trial, is_default_trial, created_by_platform_admin_id)
    VALUES (a ->> 'code', a ->> 'name', a ->> 'description', a ->> 'status', (a ->> 'is_trial')::boolean,
            (a ->> 'is_default_trial')::boolean, NULL);
    PERFORM set_config('po02d1b.package', 'created', true);
    RETURN 'created';
  END IF;
  diff := pg_temp.po02d1b_diff(existing, a);
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: subscription_packages "%" differs from the approved seed (%); nothing was changed', a ->> 'code', diff;
  END IF;
  PERFORM set_config('po02d1b.package', 'verified', true);
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- S3 — Trial version 1, PUBLISHED. Inserted published (the guard trigger acts on UPDATE / DELETE
-- only); from now on it is immutable and undeletable. published_at is the seed's transaction time.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.po02d1b_seed_version() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  a jsonb := pg_temp.po02d1b_approved() -> 'version';
  pkg uuid;
  existing jsonb;
  diff text;
BEGIN
  SELECT p.id INTO pkg FROM public.subscription_packages p WHERE p.code = pg_temp.po02d1b_approved() #>> '{package,code}';
  IF pkg IS NULL THEN
    RAISE EXCEPTION 'PO-02D1B seed: the Trial package is missing after S2 (internal error); nothing was changed';
  END IF;
  SELECT jsonb_build_object('version_number', v.version_number, 'publish_state', v.publish_state, 'is_trial', v.is_trial,
                            'currency_code', v.currency_code, 'monthly_price', v.monthly_price::text,
                            'annual_price', v.annual_price::text, 'included_seats', v.included_seats,
                            'storage_allowance_gb', v.storage_allowance_gb, 'trial_days', v.trial_days,
                            'module_groups', v.module_groups, 'created_by_platform_admin_id', v.created_by_platform_admin_id)
    INTO existing
  FROM public.subscription_package_versions v
  WHERE v.package_id = pkg AND v.version_number = (a ->> 'version_number')::int;
  IF existing IS NULL THEN
    INSERT INTO public.subscription_package_versions (package_id, version_number, publish_state, is_trial, currency_code,
                                                      monthly_price, annual_price, included_seats, storage_allowance_gb,
                                                      module_groups, trial_days, published_at, created_by_platform_admin_id)
    VALUES (pkg, (a ->> 'version_number')::int, a ->> 'publish_state', (a ->> 'is_trial')::boolean, a ->> 'currency_code',
            (a ->> 'monthly_price')::numeric(14,2), (a ->> 'annual_price')::numeric(14,2), (a ->> 'included_seats')::int,
            (a ->> 'storage_allowance_gb')::int, a -> 'module_groups', (a ->> 'trial_days')::int, now(), NULL);
    PERFORM set_config('po02d1b.version', 'created', true);
    RETURN 'created';
  END IF;
  diff := pg_temp.po02d1b_diff(existing, a);
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1B seed refused: the Trial package''s version 1 differs from the approved seed (%); nothing was changed', diff
      USING HINT = 'A published version is immutable; a change is a new version, never a rewrite.';
  END IF;
  PERFORM set_config('po02d1b.version', 'verified', true);
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- S4 — ONE append-only audit record, only when this run created something (a verifying re-run
-- records nothing). Actor-less, like every migration-time record.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.po02d1b_record_audit() RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  s1 text := current_setting('po02d1b.settings', true);
  s2 text := current_setting('po02d1b.package', true);
  s3 text := current_setting('po02d1b.version', true);
  pkg uuid;
  ver uuid;
BEGIN
  IF s1 IS NULL OR s2 IS NULL OR s3 IS NULL OR '' IN (s1, s2, s3) THEN
    RAISE EXCEPTION 'PO-02D1B seed: a step did not report its outcome (internal error); nothing was changed';
  END IF;
  IF 'created' NOT IN (s1, s2, s3) THEN
    RETURN 'none (everything verified; nothing created)';
  END IF;
  SELECT p.id, v.id INTO pkg, ver
  FROM public.subscription_packages p JOIN public.subscription_package_versions v ON v.package_id = p.id AND v.version_number = 1
  WHERE p.code = pg_temp.po02d1b_approved() #>> '{package,code}';
  INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
  VALUES (NULL, 'migration PO-02D1B seed', 'seed.trial_and_settings_created', 'seed', 'PO02D1B',
          jsonb_build_object('platform_settings', s1, 'trial_package', s2, 'trial_version_1', s3,
                             'trial_package_id', pkg, 'trial_version_id', ver, 'approved', pg_temp.po02d1b_approved()),
          'success');
  RETURN 'recorded';
END
$fn$;

SELECT 'S1 platform_settings: ' || pg_temp.po02d1b_seed_settings() AS po02d1b_step;
SELECT 'S2 subscription_packages trial: ' || pg_temp.po02d1b_seed_package() AS po02d1b_step;
SELECT 'S3 subscription_package_versions trial v1: ' || pg_temp.po02d1b_seed_version() AS po02d1b_step;
SELECT 'S4 platform_audit_events: ' || pg_temp.po02d1b_record_audit() AS po02d1b_step;

-- ---------------------------------------------------------------------------------------------
-- Postconditions before COMMIT: exactly one settings row, exactly one default Trial, its version 1
-- published, the immutability guard still enabled.
-- ---------------------------------------------------------------------------------------------
DO $post$
BEGIN
  IF (SELECT count(*) FROM public.platform_settings) <> 1
     OR (SELECT count(*) FROM public.subscription_packages WHERE is_default_trial) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.subscription_package_versions v JOIN public.subscription_packages p ON p.id = v.package_id
                    WHERE p.is_default_trial AND p.code = 'trial' AND v.version_number = 1 AND v.publish_state = 'published' AND v.published_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.subscription_package_versions'::regclass
                    AND tg.tgname = 'subscription_package_versions_guard' AND tg.tgenabled = 'O') THEN
    RAISE EXCEPTION 'PO-02D1B seed: postcondition failed (one settings row, one default Trial with a published version 1, guard enabled); nothing was changed';
  END IF;
END
$post$;

DROP FUNCTION pg_temp.po02d1b_record_audit();
DROP FUNCTION pg_temp.po02d1b_seed_version();
DROP FUNCTION pg_temp.po02d1b_seed_package();
DROP FUNCTION pg_temp.po02d1b_seed_settings();
DROP FUNCTION pg_temp.po02d1b_diff(jsonb, jsonb);
DROP FUNCTION pg_temp.po02d1b_approved();

COMMIT;
