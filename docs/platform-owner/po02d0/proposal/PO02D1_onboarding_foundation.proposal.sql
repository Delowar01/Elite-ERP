-- =============================================================================================
-- PROPOSAL (PO-02D0) — NOT APPROVED · NOT EXECUTED · NOT IN THE MIGRATION JOURNAL OR drizzle/platform/.
-- Unvalidated by execution or by a parser in PO-02D0 (schema execution was not authorized); PO-02D1's
-- first task is to prove it on disposable databases (catalog equivalence with the Drizzle schema,
-- idempotency, shape refusals, lock measurements, rollback) before anyone relies on it.
--
-- Platform Owner — PO-02D1 — company onboarding foundation (proposed reviewed, retry-safe SQL)
--
-- Would create, and nothing else:
--   F1 users_org_id_id_uq             additive UNIQUE INDEX on the EXISTING customer table users (org_id, id)
--                                     — the composite FK target (verified here; built concurrently first in production)
--   F2 platform_settings              singleton (id = 1), Stage 2 locked values
--   F3 subscription_packages          catalog identity; at most one default Trial, never archived
--   F4 subscription_package_versions  SAR terms; immutable once published (guard trigger); Trial rule
--   F5 tenant_primary_owners          one per company; composite FK (org_id, user_id) -> users (org_id, id)
--   F6 tenant_subscriptions           one current per company; immutable snapshots (guard trigger)
--   F7 subscription_events            append-only (PO01's platform_reject_mutation)
--   F8 organization_invitation_terms  the deferred initial package version + cycle of an invitation (1:1)
--   plus three trigger functions in public: subscription_package_version_guard(),
--   tenant_primary_owner_guard(), tenant_subscription_guard().
-- It creates NO row (the default Trial and the settings row are a separate, approval-gated seed),
-- alters no column, constraint, trigger or row of any existing table, leaves PO-01A/PO-02A objects
-- exactly as reviewed (so their own files stay re-runnable), and never touches tenant business data.
--
-- Outside the drizzle-kit journal like PO01/PO02A (journal builds 59 tables vs the schema's 67 tenant
-- tables: PO-00 §F.2, decision D-6, mechanism B). PO-02D1 must add the matching Drizzle declarations
-- (a new src/db/schema module plus the F1 index in users.ts) so a later `drizzle-kit push` neither
-- drops nor re-creates these objects; every FK is explicitly named (all names <= 63 characters).
--
-- RETRY-SAFE WITHOUT HIDING INCOMPATIBILITIES (the PO-02A pattern): each object is built from the
-- exact DDL below into a private scratch schema (po02d1_reference); absent in public -> created from
-- the same DDL ("created"); present with exactly that shape -> untouched ("verified"); present with ANY
-- difference -> abort, naming every difference. Trigger functions are compared by language, result,
-- volatility, configuration and source. ONE transaction: any failure leaves nothing behind.
--
-- LOCKING (bounded by lock_timeout 5 s; reads are never blocked):
--   * new foreign keys take SHARE ROW EXCLUSIVE on orgs, users and platform_admins until COMMIT: writes to
--     those tables (sign-ins' users.last_login_at update, registration, team and settings changes,
--     operator step-ups) wait the few milliseconds the migration takes. Row locks taken by sign-ins and
--     access changes (FOR SHARE / FOR NO KEY UPDATE on orgs) do not conflict with it;
--   * F1, when absent, is built with a plain CREATE UNIQUE INDEX: SHARE on users for the whole build.
--     Production runs PO02D1_users_org_id_id_concurrently.sql first; this file then only verifies F1.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;
-- Inside the transaction on purpose: even a client that ignores errors is left in an aborted
-- transaction, so every later statement is refused and the final COMMIT rolls back.
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D0 PROPOSAL — not approved for execution (docs/platform-owner/PO02D0_DECISIONS.md §G)';
END $proposal_guard$;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------
-- Helpers (session-temporary; dropped before COMMIT) — PO-02A's, renamed, plus function identity.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.po02d1_shape(p_schema text, p_name text) RETURNS SETOF text
LANGUAGE sql STABLE AS $fn$
  SELECT 'relation kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text
         || ' rls=' || c.relrowsecurity::text || ' forced_rls=' || c.relforcerowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name
  UNION ALL
  SELECT 'column ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE ' null' END
         || ' default=' || coalesce(replace(pg_get_expr(d.adbin, d.adrelid), p_schema || '.', ''), '-')
         || ' identity=' || coalesce(nullif(a.attidentity::text, ''), '-')
         || ' generated=' || coalesce(nullif(a.attgenerated::text, ''), '-')
         || ' collation=' || coalesce(co.collname, '-')
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_collation co ON co.oid = a.attcollation AND co.collname <> 'default'
  WHERE n.nspname = p_schema AND c.relname = p_name AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint ' || con.conname || ' ' || con.contype::text || ' '
         || replace(pg_get_constraintdef(con.oid, true), p_schema || '.', '')
         || CASE WHEN con.convalidated THEN '' ELSE ' NOT VALID' END
         || CASE WHEN con.condeferrable THEN ' DEFERRABLE' ELSE '' END
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name
  UNION ALL
  SELECT 'index ' || replace(pg_get_indexdef(ix.indexrelid), ' ON ' || quote_ident(p_schema) || '.', ' ON ')
         || CASE WHEN ix.indisvalid AND ix.indisready THEN '' ELSE ' INVALID' END
  FROM pg_index ix
  JOIN pg_class c ON c.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name
  UNION ALL
  SELECT 'trigger ' || tg.tgname || ' ' || tg.tgenabled::text || ' '
         || replace(pg_get_triggerdef(tg.oid), quote_ident(p_schema) || '.', '')
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name AND NOT tg.tgisinternal
$fn$;
-- NOTE for PO-02D1: the replace() of the schema prefix in defaults, constraints and trigger definitions
-- lets references between NEW objects (po02d1_reference.x vs public.x) compare equal; references to
-- EXISTING tables are written public.<table> in both copies and are compared verbatim.

CREATE OR REPLACE FUNCTION pg_temp.po02d1_assert_same(p_name text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  diffs text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO diffs FROM (
    SELECT 'unexpected in public: ' || s AS line
    FROM (SELECT s FROM pg_temp.po02d1_shape('public', p_name) s
          EXCEPT SELECT s FROM pg_temp.po02d1_shape('po02d1_reference', p_name) s) x
    UNION ALL
    SELECT 'missing in public:    ' || s
    FROM (SELECT s FROM pg_temp.po02d1_shape('po02d1_reference', p_name) s
          EXCEPT SELECT s FROM pg_temp.po02d1_shape('public', p_name) s) y
  ) d;
  IF diffs IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_table',
      MESSAGE = format('PO-02D1: public.%I already exists with a different shape; nothing was applied', p_name),
      DETAIL = diffs,
      HINT = 'PO-02D1 never alters an existing object. Investigate the difference; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.po02d1_install_table(p_name text, p_ddl text[]) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY p_ddl LOOP
    EXECUTE format(stmt, 'po02d1_reference');
  END LOOP;
  IF to_regclass(format('public.%I', p_name)) IS NULL THEN
    FOREACH stmt IN ARRAY p_ddl LOOP
      EXECUTE format(stmt, 'public');
    END LOOP;
    PERFORM pg_temp.po02d1_assert_same(p_name);
    RETURN 'created';
  END IF;
  RETURN pg_temp.po02d1_assert_same(p_name);
END
$fn$;

-- A trigger function (no arguments): built in the reference schema; created in public when absent;
-- otherwise its language, result type, volatility, SECURITY, configuration and source must be identical.
CREATE OR REPLACE FUNCTION pg_temp.po02d1_install_function(p_name text, p_ddl text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  expected text;
  actual text;
BEGIN
  EXECUTE format(p_ddl, 'po02d1_reference');
  SELECT l.lanname || '|' || pg_get_function_result(p.oid) || '|' || p.provolatile || '|' || p.prosecdef
         || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || p.prosrc
  INTO expected
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'po02d1_reference' AND p.proname = p_name AND p.pronargs = 0;
  SELECT l.lanname || '|' || pg_get_function_result(p.oid) || '|' || p.provolatile || '|' || p.prosecdef
         || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || p.prosrc
  INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.proname = p_name AND p.pronargs = 0;
  IF NOT FOUND THEN
    EXECUTE format(p_ddl, 'public');
    RETURN 'created';
  END IF;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_function',
      MESSAGE = format('PO-02D1: public.%I() already exists with a different definition; nothing was applied', p_name),
      HINT = 'PO-02D1 never replaces an existing function. Investigate; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

-- F1 on an EXISTING table (PO-02A's install_index, unchanged in substance): reference built on an empty
-- structural copy; an index of that name in public must be identical, on users, valid and unique.
CREATE OR REPLACE FUNCTION pg_temp.po02d1_install_index(p_table text, p_index text, p_ddl text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  expected text;
  actual text;
  on_table text;
  is_valid boolean;
BEGIN
  EXECUTE format('CREATE TABLE po02d1_reference.%I (LIKE public.%I)', p_table, p_table);
  EXECUTE format(p_ddl, 'po02d1_reference');
  SELECT replace(pg_get_indexdef(i.oid), ' ON po02d1_reference.', ' ON ') INTO expected
  FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace
  WHERE n.nspname = 'po02d1_reference' AND i.relname = p_index;
  SELECT replace(pg_get_indexdef(i.oid), ' ON public.', ' ON '), t.relname, ix.indisvalid AND ix.indisready
  INTO actual, on_table, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid
  LEFT JOIN pg_class t ON t.oid = ix.indrelid
  WHERE n.nspname = 'public' AND i.relname = p_index;
  IF NOT FOUND THEN
    EXECUTE format(p_ddl, 'public');
    RETURN 'created';
  END IF;
  IF actual IS DISTINCT FROM expected OR on_table IS DISTINCT FROM p_table THEN
    RAISE EXCEPTION 'PO-02D1: public.% exists with a different definition; nothing was applied', p_index;
  END IF;
  IF NOT is_valid THEN
    RAISE EXCEPTION 'PO-02D1: public.% is INVALID (an interrupted CREATE INDEX CONCURRENTLY); nothing was applied', p_index
      USING HINT = format('Run DROP INDEX CONCURRENTLY public.%I; then PO02D1_users_org_id_id_concurrently.sql, then this file.', p_index);
  END IF;
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 0. Preconditions: server, the tenant columns referenced, PO-01A (identity + append-only function)
--    and PO-02A (access controls + invitations) installed.
-- ---------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text;
BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'PO-02D1 requires PostgreSQL >= 14 (found %)', current_setting('server_version');
  END IF;
  SELECT string_agg(format('%s.%s %s', r.t, r.c, r.ty), ', ') INTO missing
  FROM (VALUES
          ('orgs', 'id', 'integer'),
          ('users', 'id', 'integer'), ('users', 'org_id', 'integer'), ('users', 'role', 'text'), ('users', 'is_active', 'boolean'),
          ('platform_admins', 'id', 'uuid'),
          ('organization_invitations', 'id', 'uuid'), ('organization_invitations', 'accepted_org_id', 'integer'),
          ('tenant_access_controls', 'org_id', 'integer')
       ) AS r(t, c, ty)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class cl ON cl.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND cl.relkind = 'r'
      AND a.attname = r.c AND NOT a.attisdropped AND format_type(a.atttypid, a.atttypmod) = r.ty
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1 precondition failed: missing or different column(s): %', missing
      USING HINT = 'Apply and verify PO01_platform_identity.sql and PO02A_company_foundation.sql first.';
  END IF;
  SELECT string_agg(r.t, ', ') INTO missing
  FROM (VALUES ('orgs'), ('users'), ('platform_admins'), ('organization_invitations')) AS r(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND con.contype = 'p' AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1 precondition failed: no PRIMARY KEY (id) on %', missing;
  END IF;
  IF to_regprocedure('public.platform_reject_mutation()') IS NULL THEN
    RAISE EXCEPTION 'PO-02D1 precondition failed: public.platform_reject_mutation() (PO01) is missing';
  END IF;
END
$pre$;

CREATE SCHEMA po02d1_reference;

-- ---------------------------------------------------------------------------------------------
-- F1 — users (org_id, id): composite FK target. Customer table: index only, nothing else changes.
-- ---------------------------------------------------------------------------------------------
SELECT 'F1 users_org_id_id_uq: ' || pg_temp.po02d1_install_index('users', 'users_org_id_id_uq',
$ddl$CREATE UNIQUE INDEX users_org_id_id_uq ON %1$I.users USING btree (org_id, id)$ddl$
) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- Trigger functions (search_path pinned; no SECURITY DEFINER; no '%' in bodies because of format()).
-- ---------------------------------------------------------------------------------------------
SELECT 'fn subscription_package_version_guard: ' || pg_temp.po02d1_install_function('subscription_package_version_guard',
$ddl$CREATE FUNCTION %1$I.subscription_package_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.publish_state = 'published' THEN
      RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a published package version cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.publish_state = 'published' THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a published package version is immutable; publish a new version';
  END IF;
  IF NEW.id <> OLD.id OR NEW.package_id <> OLD.package_id OR NEW.is_trial <> OLD.is_trial
     OR NEW.version_number <> OLD.version_number OR NEW.created_at <> OLD.created_at
     OR NEW.created_by_platform_admin_id IS DISTINCT FROM OLD.created_by_platform_admin_id THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a package version identity and provenance cannot change';
  END IF;
  RETURN NEW;
END
$body$$ddl$) AS po02d1_step;

SELECT 'fn tenant_primary_owner_guard: ' || pg_temp.po02d1_install_function('tenant_primary_owner_guard',
$ddl$CREATE FUNCTION %1$I.tenant_primary_owner_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a primary-owner mapping is transferred, never deleted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = NEW.user_id AND u.org_id = NEW.org_id AND u.role = 'owner' AND u.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the primary owner must be an active owner of the same company';
  END IF;
  RETURN NEW;
END
$body$$ddl$) AS po02d1_step;

SELECT 'fn tenant_subscription_guard: ' || pg_temp.po02d1_install_function('tenant_subscription_guard',
$ddl$CREATE FUNCTION %1$I.tenant_subscription_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'subscription history cannot be deleted';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a superseded subscription is history and cannot change';
  END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.package_version_id <> OLD.package_version_id
     OR NEW.version_state <> OLD.version_state OR NEW.is_trial <> OLD.is_trial OR NEW.cycle <> OLD.cycle
     OR NEW.start_date <> OLD.start_date OR NEW.price_snapshot_sar <> OLD.price_snapshot_sar
     OR NEW.seats_snapshot <> OLD.seats_snapshot OR NEW.storage_snapshot_gb <> OLD.storage_snapshot_gb
     OR NEW.module_groups_snapshot <> OLD.module_groups_snapshot OR NEW.assignment_source <> OLD.assignment_source
     OR NEW.created_by_platform_admin_id IS DISTINCT FROM OLD.created_by_platform_admin_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'an assignment snapshot is immutable; supersede it with a new assignment';
  END IF;
  RETURN NEW;
END
$body$$ddl$) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F2 — platform_settings (Schema.md §9; PRD P-09). Locked Stage 2 values are CHECKs. No DEFAULT for
-- default_trial_days: the seed must state the owner-approved value. invite_only is deliberately NOT
-- created here (decision R-3: it would be a stored claim that is false while /register is public).
-- ---------------------------------------------------------------------------------------------
SELECT 'F2 platform_settings: ' || pg_temp.po02d1_install_table('platform_settings', ARRAY[
$ddl$CREATE TABLE %1$I.platform_settings (
  id                           smallint    NOT NULL DEFAULT 1,
  default_trial_days           integer     NOT NULL,
  grace_days                   integer     NOT NULL DEFAULT 0,
  expiry_alerts_enabled        boolean     NOT NULL DEFAULT true,
  manual_billing               boolean     NOT NULL DEFAULT true,
  platform_mfa_required        boolean     NOT NULL DEFAULT true,
  platform_currency            char(3)     NOT NULL DEFAULT 'SAR',
  platform_timezone            text        NOT NULL DEFAULT 'Asia/Riyadh',
  updated_by_platform_admin_id uuid,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_pkey PRIMARY KEY (id),
  CONSTRAINT platform_settings_updated_by_fk FOREIGN KEY (updated_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT platform_settings_singleton_chk CHECK (id = 1),
  CONSTRAINT platform_settings_trial_days_chk CHECK (default_trial_days BETWEEN 1 AND 120),
  CONSTRAINT platform_settings_grace_days_chk CHECK (grace_days BETWEEN 0 AND 60),
  CONSTRAINT platform_settings_locked_chk CHECK (manual_billing AND platform_mfa_required),
  CONSTRAINT platform_settings_currency_chk CHECK (platform_currency = 'SAR'),
  CONSTRAINT platform_settings_timezone_chk CHECK (platform_timezone = 'Asia/Riyadh')
)$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F3 — subscription_packages (Schema.md §6.1). (id, is_trial) is the FK target that lets versions
-- carry is_trial declaratively; an operator creates every package except the system-seeded Trial.
-- ---------------------------------------------------------------------------------------------
SELECT 'F3 subscription_packages: ' || pg_temp.po02d1_install_table('subscription_packages', ARRAY[
$ddl$CREATE TABLE %1$I.subscription_packages (
  id                           uuid        NOT NULL DEFAULT gen_random_uuid(),
  code                         text        NOT NULL,
  name                         text        NOT NULL,
  description                  text,
  status                       text        NOT NULL DEFAULT 'draft',
  is_trial                     boolean     NOT NULL DEFAULT false,
  is_default_trial             boolean     NOT NULL DEFAULT false,
  created_by_platform_admin_id uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_packages_pkey PRIMARY KEY (id),
  CONSTRAINT subscription_packages_id_trial_uq UNIQUE (id, is_trial),
  CONSTRAINT subscription_packages_created_by_fk FOREIGN KEY (created_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_packages_code_chk CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  CONSTRAINT subscription_packages_name_chk CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100),
  CONSTRAINT subscription_packages_description_chk CHECK (description IS NULL OR (description = btrim(description) AND length(description) BETWEEN 1 AND 1000)),
  CONSTRAINT subscription_packages_status_chk CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT subscription_packages_default_trial_chk CHECK (NOT is_default_trial OR (is_trial AND status <> 'archived')),
  CONSTRAINT subscription_packages_attribution_chk CHECK (created_by_platform_admin_id IS NOT NULL OR is_default_trial),
  CONSTRAINT subscription_packages_timestamps_chk CHECK (updated_at >= created_at)
)$ddl$,
$ddl$CREATE UNIQUE INDEX subscription_packages_code_uq ON %1$I.subscription_packages USING btree (code)$ddl$,
$ddl$CREATE UNIQUE INDEX subscription_packages_name_uq ON %1$I.subscription_packages USING btree (lower(name))$ddl$,
$ddl$CREATE UNIQUE INDEX subscription_packages_default_trial_uq ON %1$I.subscription_packages USING btree (is_default_trial) WHERE is_default_trial$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F4 — subscription_package_versions (Schema.md §6.2). SAR only; Trial versions are free and carry
-- 1–120 trial days, paid versions carry 0; module groups are display labels (array of strings, the
-- allowed label list is validated by the service and decided by the owner: decision P-6).
-- (id, publish_state, is_trial) is the FK target that limits assignments/invitations to PUBLISHED
-- versions declaratively; the guard trigger makes a published row immutable and undeletable.
-- ---------------------------------------------------------------------------------------------
SELECT 'F4 subscription_package_versions: ' || pg_temp.po02d1_install_table('subscription_package_versions', ARRAY[
$ddl$CREATE TABLE %1$I.subscription_package_versions (
  id                           uuid          NOT NULL DEFAULT gen_random_uuid(),
  package_id                   uuid          NOT NULL,
  is_trial                     boolean       NOT NULL,
  version_number               integer       NOT NULL,
  publish_state                text          NOT NULL DEFAULT 'draft',
  currency_code                char(3)       NOT NULL DEFAULT 'SAR',
  monthly_price                numeric(14,2) NOT NULL,
  annual_price                 numeric(14,2) NOT NULL,
  included_seats               integer       NOT NULL,
  storage_allowance_gb         integer       NOT NULL,
  module_groups                jsonb         NOT NULL DEFAULT '[]'::jsonb,
  trial_days                   integer       NOT NULL DEFAULT 0,
  published_at                 timestamptz,
  created_by_platform_admin_id uuid,
  created_at                   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT subscription_package_versions_pkey PRIMARY KEY (id),
  CONSTRAINT subscription_package_versions_number_uq UNIQUE (package_id, version_number),
  CONSTRAINT subscription_package_versions_ref_uq UNIQUE (id, publish_state, is_trial),
  CONSTRAINT subscription_package_versions_package_fk FOREIGN KEY (package_id, is_trial) REFERENCES %1$I.subscription_packages (id, is_trial) ON DELETE RESTRICT,
  CONSTRAINT subscription_package_versions_created_by_fk FOREIGN KEY (created_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_package_versions_number_chk CHECK (version_number > 0),
  CONSTRAINT subscription_package_versions_state_chk CHECK (publish_state IN ('draft', 'published')),
  CONSTRAINT subscription_package_versions_published_at_chk CHECK ((publish_state = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT subscription_package_versions_currency_chk CHECK (currency_code = 'SAR'),
  CONSTRAINT subscription_package_versions_prices_chk CHECK (monthly_price >= 0 AND annual_price >= 0),
  CONSTRAINT subscription_package_versions_seats_chk CHECK (included_seats >= 1),
  CONSTRAINT subscription_package_versions_storage_chk CHECK (storage_allowance_gb >= 1),
  CONSTRAINT subscription_package_versions_modules_chk CHECK (
    jsonb_typeof(module_groups) = 'array' AND NOT jsonb_path_exists(module_groups, '$[*] ? (@.type() != "string")')
  ),
  CONSTRAINT subscription_package_versions_trial_terms_chk CHECK (
    (is_trial AND trial_days BETWEEN 1 AND 120 AND monthly_price = 0 AND annual_price = 0)
    OR (NOT is_trial AND trial_days = 0)
  ),
  CONSTRAINT subscription_package_versions_attribution_chk CHECK (created_by_platform_admin_id IS NOT NULL OR is_trial)
)$ddl$,
$ddl$CREATE TRIGGER subscription_package_versions_guard BEFORE UPDATE OR DELETE ON %1$I.subscription_package_versions FOR EACH ROW EXECUTE FUNCTION %1$I.subscription_package_version_guard()$ddl$,
$ddl$CREATE TRIGGER subscription_package_versions_no_truncate BEFORE TRUNCATE ON %1$I.subscription_package_versions FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F5 — tenant_primary_owners (Schema.md §4.2). Exactly the spec's columns. The composite FK makes a
-- cross-company owner impossible (PO-00 P2); the guard checks role = 'owner' and is_active at every
-- write and forbids deleting a mapping. Protecting the mapped user from demotion/deactivation through
-- the customer team screen is NOT done here (decision O-3: PO-03, with service checks and messages).
-- ---------------------------------------------------------------------------------------------
SELECT 'F5 tenant_primary_owners: ' || pg_temp.po02d1_install_table('tenant_primary_owners', ARRAY[
$ddl$CREATE TABLE %1$I.tenant_primary_owners (
  org_id                        integer     NOT NULL,
  user_id                       integer     NOT NULL,
  assigned_at                   timestamptz NOT NULL DEFAULT now(),
  assigned_by_platform_admin_id uuid,
  CONSTRAINT tenant_primary_owners_pkey PRIMARY KEY (org_id),
  CONSTRAINT tenant_primary_owners_user_uq UNIQUE (user_id),
  CONSTRAINT tenant_primary_owners_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT tenant_primary_owners_user_fk FOREIGN KEY (org_id, user_id) REFERENCES public.users (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenant_primary_owners_assigned_by_fk FOREIGN KEY (assigned_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT
)$ddl$,
$ddl$CREATE TRIGGER tenant_primary_owners_guard BEFORE INSERT OR UPDATE OR DELETE ON %1$I.tenant_primary_owners FOR EACH ROW EXECUTE FUNCTION %1$I.tenant_primary_owner_guard()$ddl$,
$ddl$CREATE TRIGGER tenant_primary_owners_no_truncate BEFORE TRUNCATE ON %1$I.tenant_primary_owners FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F6 — tenant_subscriptions (Schema.md §7.1). One current row per company; the version must be a
-- PUBLISHED one (version_state carried + composite FK); Trial <=> trial cycle, zero price; dates are
-- business dates (Asia/Riyadh). assignment_source + nullable operator: an invitation acceptance has no
-- operator in its transaction (PO-02D3 lock-order rule); every other assignment names one.
-- ---------------------------------------------------------------------------------------------
SELECT 'F6 tenant_subscriptions: ' || pg_temp.po02d1_install_table('tenant_subscriptions', ARRAY[
$ddl$CREATE TABLE %1$I.tenant_subscriptions (
  id                           uuid          NOT NULL DEFAULT gen_random_uuid(),
  org_id                       integer       NOT NULL,
  package_version_id           uuid          NOT NULL,
  version_state                text          NOT NULL DEFAULT 'published',
  is_trial                     boolean       NOT NULL,
  cycle                        text          NOT NULL,
  lifecycle_state              text          NOT NULL,
  start_date                   date          NOT NULL,
  end_date                     date          NOT NULL,
  superseded_at                timestamptz,
  price_snapshot_sar           numeric(14,2) NOT NULL,
  seats_snapshot               integer       NOT NULL,
  storage_snapshot_gb          integer       NOT NULL,
  module_groups_snapshot       jsonb         NOT NULL,
  manual_note                  text,
  assignment_source            text          NOT NULL,
  created_by_platform_admin_id uuid,
  created_at                   timestamptz   NOT NULL DEFAULT now(),
  updated_at                   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT tenant_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_subscriptions_id_org_uq UNIQUE (id, org_id),
  CONSTRAINT tenant_subscriptions_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT tenant_subscriptions_version_fk FOREIGN KEY (package_version_id, version_state, is_trial) REFERENCES %1$I.subscription_package_versions (id, publish_state, is_trial) ON DELETE RESTRICT,
  CONSTRAINT tenant_subscriptions_created_by_fk FOREIGN KEY (created_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT tenant_subscriptions_version_state_chk CHECK (version_state = 'published'),
  CONSTRAINT tenant_subscriptions_cycle_chk CHECK (cycle IN ('trial', 'monthly', 'annual')),
  CONSTRAINT tenant_subscriptions_trial_cycle_chk CHECK (is_trial = (cycle = 'trial')),
  CONSTRAINT tenant_subscriptions_lifecycle_chk CHECK (lifecycle_state IN ('trialing', 'active', 'paused', 'cancelled')),
  CONSTRAINT tenant_subscriptions_trialing_chk CHECK ((lifecycle_state = 'trialing') <= (cycle = 'trial') AND (lifecycle_state = 'active') <= (cycle <> 'trial')),
  CONSTRAINT tenant_subscriptions_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT tenant_subscriptions_price_chk CHECK (price_snapshot_sar >= 0 AND (cycle <> 'trial' OR price_snapshot_sar = 0)),
  CONSTRAINT tenant_subscriptions_seats_chk CHECK (seats_snapshot > 0),
  CONSTRAINT tenant_subscriptions_storage_chk CHECK (storage_snapshot_gb > 0),
  CONSTRAINT tenant_subscriptions_modules_chk CHECK (jsonb_typeof(module_groups_snapshot) = 'array'),
  CONSTRAINT tenant_subscriptions_note_chk CHECK (manual_note IS NULL OR (manual_note = btrim(manual_note) AND length(manual_note) BETWEEN 1 AND 1000)),
  CONSTRAINT tenant_subscriptions_source_chk CHECK (assignment_source IN ('invitation_acceptance', 'platform_assignment')),
  CONSTRAINT tenant_subscriptions_attribution_chk CHECK (assignment_source = 'invitation_acceptance' OR created_by_platform_admin_id IS NOT NULL),
  CONSTRAINT tenant_subscriptions_timestamps_chk CHECK (updated_at >= created_at AND (superseded_at IS NULL OR superseded_at >= created_at))
)$ddl$,
$ddl$CREATE UNIQUE INDEX tenant_subscriptions_current_uq ON %1$I.tenant_subscriptions USING btree (org_id) WHERE superseded_at IS NULL$ddl$,
$ddl$CREATE INDEX tenant_subscriptions_expiry_idx ON %1$I.tenant_subscriptions USING btree (end_date, lifecycle_state) WHERE superseded_at IS NULL$ddl$,
$ddl$CREATE INDEX tenant_subscriptions_version_idx ON %1$I.tenant_subscriptions USING btree (package_version_id, superseded_at)$ddl$,
$ddl$CREATE TRIGGER tenant_subscriptions_guard BEFORE UPDATE OR DELETE ON %1$I.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION %1$I.tenant_subscription_guard()$ddl$,
$ddl$CREATE TRIGGER tenant_subscriptions_no_truncate BEFORE TRUNCATE ON %1$I.tenant_subscriptions FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F7 — subscription_events (Schema.md §7.2). Append-only. The (subscription, org) composite FK keeps an
-- event on its subscription's company; actor_label mirrors platform_audit_events (actor-less events are
-- only the 'assigned' event of an invitation acceptance, labelled 'invitee').
-- ---------------------------------------------------------------------------------------------
SELECT 'F7 subscription_events: ' || pg_temp.po02d1_install_table('subscription_events', ARRAY[
$ddl$CREATE TABLE %1$I.subscription_events (
  id                      bigint      NOT NULL GENERATED ALWAYS AS IDENTITY,
  tenant_subscription_id  uuid        NOT NULL,
  org_id                  integer     NOT NULL,
  event_type              text        NOT NULL,
  actor_platform_admin_id uuid,
  actor_label             text        NOT NULL,
  before_safe             jsonb,
  after_safe              jsonb,
  reason                  text,
  request_id              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_events_pkey PRIMARY KEY (id),
  CONSTRAINT subscription_events_subscription_fk FOREIGN KEY (tenant_subscription_id, org_id) REFERENCES %1$I.tenant_subscriptions (id, org_id) ON DELETE RESTRICT,
  CONSTRAINT subscription_events_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_events_actor_fk FOREIGN KEY (actor_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_events_type_chk CHECK (event_type IN ('assigned', 'renewed', 'paused', 'resumed', 'superseded', 'cancelled', 'terms_updated')),
  CONSTRAINT subscription_events_actor_chk CHECK (
    length(btrim(actor_label)) BETWEEN 1 AND 200
    AND (actor_platform_admin_id IS NOT NULL OR (event_type = 'assigned' AND actor_label = 'invitee'))
  ),
  CONSTRAINT subscription_events_snapshot_chk CHECK (
    (before_safe IS NULL OR jsonb_typeof(before_safe) = 'object') AND (after_safe IS NULL OR jsonb_typeof(after_safe) = 'object')
  ),
  CONSTRAINT subscription_events_reason_chk CHECK (reason IS NULL OR (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 1000))
)$ddl$,
$ddl$CREATE UNIQUE INDEX subscription_events_request_uq ON %1$I.subscription_events USING btree (tenant_subscription_id, request_id, event_type) WHERE request_id IS NOT NULL$ddl$,
$ddl$CREATE INDEX subscription_events_subscription_idx ON %1$I.subscription_events USING btree (tenant_subscription_id, created_at DESC)$ddl$,
$ddl$CREATE INDEX subscription_events_org_idx ON %1$I.subscription_events USING btree (org_id, created_at DESC)$ddl$,
$ddl$CREATE TRIGGER subscription_events_immutable BEFORE UPDATE OR DELETE ON %1$I.subscription_events FOR EACH ROW EXECUTE FUNCTION public.platform_reject_mutation()$ddl$,
$ddl$CREATE TRIGGER subscription_events_no_truncate BEFORE TRUNCATE ON %1$I.subscription_events FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- F8 — organization_invitation_terms: Schema.md §5.1's deferred initial_package_version_id and
-- initial_cycle, one row per invitation, written with it (PO-02D2) and immutable. A separate 1:1 table
-- keeps PO-02A's organization_invitations exactly as reviewed (its own file stays re-runnable) — decision
-- I-1; PO-02D3 refuses an invitation without terms. Only PUBLISHED versions can be referenced.
-- ---------------------------------------------------------------------------------------------
SELECT 'F8 organization_invitation_terms: ' || pg_temp.po02d1_install_table('organization_invitation_terms', ARRAY[
$ddl$CREATE TABLE %1$I.organization_invitation_terms (
  invitation_id              uuid        NOT NULL,
  initial_package_version_id uuid        NOT NULL,
  initial_version_state      text        NOT NULL DEFAULT 'published',
  initial_is_trial           boolean     NOT NULL,
  initial_cycle              text        NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invitation_terms_pkey PRIMARY KEY (invitation_id),
  CONSTRAINT organization_invitation_terms_invitation_fk FOREIGN KEY (invitation_id) REFERENCES public.organization_invitations (id) ON DELETE RESTRICT,
  CONSTRAINT organization_invitation_terms_version_fk FOREIGN KEY (initial_package_version_id, initial_version_state, initial_is_trial) REFERENCES %1$I.subscription_package_versions (id, publish_state, is_trial) ON DELETE RESTRICT,
  CONSTRAINT organization_invitation_terms_state_chk CHECK (initial_version_state = 'published'),
  CONSTRAINT organization_invitation_terms_cycle_chk CHECK (initial_cycle IN ('trial', 'monthly', 'annual') AND initial_is_trial = (initial_cycle = 'trial'))
)$ddl$,
$ddl$CREATE INDEX organization_invitation_terms_version_idx ON %1$I.organization_invitation_terms USING btree (initial_package_version_id)$ddl$,
$ddl$CREATE TRIGGER organization_invitation_terms_immutable BEFORE UPDATE OR DELETE ON %1$I.organization_invitation_terms FOR EACH ROW EXECUTE FUNCTION public.platform_reject_mutation()$ddl$,
$ddl$CREATE TRIGGER organization_invitation_terms_no_truncate BEFORE TRUNCATE ON %1$I.organization_invitation_terms FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$
]) AS po02d1_step;

-- ---------------------------------------------------------------------------------------------
-- Clean up the scratch reference and the session-temporary helpers.
-- ---------------------------------------------------------------------------------------------
DROP SCHEMA po02d1_reference CASCADE;
DROP FUNCTION pg_temp.po02d1_install_index(text, text, text);
DROP FUNCTION pg_temp.po02d1_install_function(text, text);
DROP FUNCTION pg_temp.po02d1_install_table(text, text[]);
DROP FUNCTION pg_temp.po02d1_assert_same(text);
DROP FUNCTION pg_temp.po02d1_shape(text, text);

COMMIT;
