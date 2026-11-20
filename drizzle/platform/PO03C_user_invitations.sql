-- =============================================================================================
-- Platform Owner — PO-03C (sub-batch C) — customer-user invitation foundation, SCHEMA ONLY
-- (reviewed, hand-written, retry-safe). A PROPOSAL for the owner's release review.
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION. PO-03C authorizes ONLY loopback disposable
-- `*_test_only_*` databases, applied by its own verification suite (verify:platform-user-invitations).
-- It is deliberately NOT part of the reviewed platform SQL chain (scripts/platform/catalog.ts
-- PLATFORM_SQL_FILES): `npm run platform:db:apply` never runs it, so the D-6 scope is unchanged.
-- Adding it to any database other than a disposable test database is an owner decision (the D-6
-- mechanism and the D-7 measurements first), together with this file's release proposal
-- (docs/platform-owner/PO03C_DEVELOPMENT.md §G).
--
-- Creates, and nothing else:
--   user_invitations          one row per invitation of a NEW user into an EXISTING company (Stage 2
--                             Schema.md §5.2): the company, the invitee's name and normalized e-mail, the
--                             requested role (admin or staff — never owner), ONLY the SHA-256 of the
--                             one-time token, the window, the issuing operator, and the terminal states
--                             (revoked by an operator, or — later, PO-04 — accepted by the new user)
--   user_invitation_guard()   trigger function: an invitation starts open; its company, invitee, role,
--                             token hash, window and issuer never change; it changes ONCE, to revoked or to
--                             accepted (by a user of its own company), and is never deleted
--   two triggers              the guard (INSERT / UPDATE / DELETE) and PO01's platform_reject_mutation()
--                             on TRUNCATE
-- It creates NO row, alters no column, constraint, trigger or row of any existing table, and leaves the
-- PO01 / PO02A / PO02D1 objects exactly as reviewed. Its audit relationship is the append-only platform
-- audit trail: every create, revoke and re-issue records entity_type 'user_invitation' and the
-- invitation's id, and the guard keeps the row those records describe immutable.
--
-- Source of truth: src/db/staged/platform-user-invitations.ts (a STAGED Drizzle declaration, outside
-- src/db/schema and not exported from src/db/schema/index.ts, so `db:push` and every existing catalog
-- comparison are unchanged). verify:platform-user-invitations proves this file catalog-equivalent to it.
-- COLUMN ORDER IS LOAD-BEARING for composite keys (PO-02D1 header); this table has none.
--
-- Deliberately OUTSIDE the drizzle-kit journal, like PO01, PO02A and PO02D1. Never run
-- `drizzle-kit generate` or `migrate`.
--
-- RETRY-SAFE WITHOUT HIDING INCOMPATIBILITIES (the PO-02D1 method). The table is built from the exact DDL
-- below into a private scratch schema (po03c_reference, whose foreign keys point at key-only stand-ins of
-- orgs, users and platform_admins inside that schema, so the reference never locks an existing table); then
--   absent in public                 -> created from the same DDL                 ("created")
--   present with exactly that shape  -> left untouched (a re-run)                 ("verified")
--   present with ANY difference      -> the migration aborts and names every difference.
-- The function and both triggers: absent -> created; present -> identical definition (and ENABLED) or abort;
-- any other trigger on the table aborts. ONE transaction: any failure leaves nothing behind.
--
-- LOCKING (measured by verify:platform-user-invitations; every wait bounded by lock_timeout 5 s):
--   - first application: the new foreign keys take SHARE ROW EXCLUSIVE on orgs, users and platform_admins
--     until COMMIT. Reads, row locks and foreign-key checks continue; INSERT / UPDATE / DELETE on those three
--     tables (a registration, a customer sign-in's last-login write, a Platform Owner TOTP step) wait for the
--     milliseconds the transaction takes;
--   - a verify-only re-run creates nothing and takes no lock on any existing table.
--
-- Requires PostgreSQL >= 14, CREATE privilege on the database, PO01_platform_identity.sql,
-- PO02A_company_foundation.sql and PO02D1_onboarding_foundation.sql. Rollback:
-- PO03C_user_invitations_rollback.sql.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------
-- Helpers (session-temporary; never in the public schema; dropped before COMMIT). The PO-02D1 helpers,
-- renamed: one canonical shape per relation, compared line by line.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.po03c_shape(p_schema text, p_name text) RETURNS SETOF text
LANGUAGE sql STABLE AS $fn$
  SELECT 'relation kind=' || c.relkind::text || ' persistence=' || c.relpersistence::text
         || ' rls=' || c.relrowsecurity::text || ' forced_rls=' || c.relforcerowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name
  UNION ALL
  SELECT 'column ' || a.attnum || ' ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE ' null' END
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
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
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.po03c_assert_same(p_name text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  diffs text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO diffs FROM (
    SELECT 'unexpected in public: ' || s AS line
    FROM (SELECT s FROM pg_temp.po03c_shape('public', p_name) s
          EXCEPT SELECT s FROM pg_temp.po03c_shape('po03c_reference', p_name) s) x
    UNION ALL
    SELECT 'missing in public:    ' || s
    FROM (SELECT s FROM pg_temp.po03c_shape('po03c_reference', p_name) s
          EXCEPT SELECT s FROM pg_temp.po03c_shape('public', p_name) s) y
  ) d;
  IF diffs IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_table',
      MESSAGE = format('PO-03C: public.%I already exists with a different shape; nothing was applied', p_name),
      DETAIL = diffs,
      HINT = 'PO-03C never alters an existing object. Investigate the difference; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.po03c_install_table(p_name text, p_ddl text[]) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY p_ddl LOOP
    EXECUTE format(stmt, 'po03c_reference');
  END LOOP;
  IF to_regclass(format('public.%I', p_name)) IS NULL THEN
    FOREACH stmt IN ARRAY p_ddl LOOP
      EXECUTE format(stmt, 'public');
    END LOOP;
    PERFORM pg_temp.po03c_assert_same(p_name);
    RETURN 'created';
  END IF;
  RETURN pg_temp.po03c_assert_same(p_name);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.po03c_install_function(p_name text, p_ddl text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  expected text;
  actual text;
BEGIN
  EXECUTE format(p_ddl, 'po03c_reference');
  SELECT l.lanname || '|' || pg_get_function_result(p.oid) || '|' || p.provolatile::text || '|' || p.prosecdef::text
         || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || p.prosrc
  INTO expected
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'po03c_reference' AND p.proname = p_name AND p.pronargs = 0;
  SELECT l.lanname || '|' || pg_get_function_result(p.oid) || '|' || p.provolatile::text || '|' || p.prosecdef::text
         || '|' || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || p.prosrc
  INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.proname = p_name AND p.pronargs = 0;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = p_name) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'duplicate_function',
        MESSAGE = format('PO-03C: another public.%I(...) overload exists; nothing was applied', p_name);
    END IF;
    EXECUTE format(p_ddl, 'public');
    RETURN 'created';
  END IF;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_function',
      MESSAGE = format('PO-03C: public.%I() already exists with a different definition; nothing was applied', p_name),
      HINT = 'PO-03C never replaces an existing function. Investigate; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.po03c_install_trigger(p_table text, p_trigger text, p_ddl text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  expected text;
  actual text;
  state text;
BEGIN
  EXECUTE format(p_ddl, 'po03c_reference');
  SELECT replace(replace(pg_get_triggerdef(tg.oid), 'po03c_reference.', ''), 'public.', '') INTO expected
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'po03c_reference' AND c.relname = p_table AND tg.tgname = p_trigger AND NOT tg.tgisinternal;
  SELECT replace(pg_get_triggerdef(tg.oid), 'public.', ''), tg.tgenabled::text INTO actual, state
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = p_table AND tg.tgname = p_trigger AND NOT tg.tgisinternal;
  IF NOT FOUND THEN
    EXECUTE format(p_ddl, 'public');
    RETURN 'created';
  END IF;
  IF actual IS DISTINCT FROM expected OR state <> 'O' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_object',
      MESSAGE = format('PO-03C: trigger %I on public.%I already exists with a different definition or is not enabled; nothing was applied', p_trigger, p_table),
      DETAIL = format('expected: %s [enabled O] | found: %s [enabled %s]', expected, actual, state),
      HINT = 'PO-03C never replaces or re-enables an existing trigger. Investigate; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 0. Preconditions: server, the existing columns and keys referenced, PO01 (identity + append-only
--    function), PO02A (organization invitations) and PO02D1 (primary owners, subscriptions) installed.
-- ---------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text;
BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'PO-03C requires PostgreSQL >= 14 (found %)', current_setting('server_version');
  END IF;
  SELECT string_agg(format('%s.%s %s', r.t, r.c, r.ty), ', ') INTO missing
  FROM (VALUES
          ('orgs', 'id', 'integer'),
          ('users', 'id', 'integer'), ('users', 'org_id', 'integer'), ('users', 'email', 'text'),
          ('platform_admins', 'id', 'uuid'),
          ('platform_audit_events', 'action', 'text'),
          ('organization_invitations', 'owner_email_normalized', 'text'),
          ('tenant_primary_owners', 'org_id', 'integer'),
          ('tenant_subscriptions', 'seats_snapshot', 'integer')
       ) AS r(t, c, ty)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class cl ON cl.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND cl.relkind = 'r'
      AND a.attname = r.c AND NOT a.attisdropped AND format_type(a.atttypid, a.atttypmod) = r.ty
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-03C precondition failed: missing or different column(s): %', missing
      USING HINT = 'Apply and verify PO01_platform_identity.sql, PO02A_company_foundation.sql and PO02D1_onboarding_foundation.sql first.';
  END IF;
  SELECT string_agg(r.t, ', ') INTO missing
  FROM (VALUES ('orgs'), ('users'), ('platform_admins')) AS r(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND con.contype = 'p' AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-03C precondition failed: no PRIMARY KEY (id) on %', missing;
  END IF;
  IF to_regprocedure('public.platform_reject_mutation()') IS NULL THEN
    RAISE EXCEPTION 'PO-03C precondition failed: public.platform_reject_mutation() (PO01) is missing';
  END IF;
END
$pre$;

CREATE SCHEMA po03c_reference;

-- Key-only stand-ins for the three EXISTING tables the new foreign keys reference (the PO-02D1 method: the reference
-- never references, so never locks, a live table; the shape comparison strips the schema prefix).
CREATE TABLE po03c_reference.orgs (id integer NOT NULL, CONSTRAINT orgs_pkey PRIMARY KEY (id));
CREATE TABLE po03c_reference.users (id integer NOT NULL, CONSTRAINT users_pkey PRIMARY KEY (id));
CREATE TABLE po03c_reference.platform_admins (id uuid NOT NULL, CONSTRAINT platform_admins_pkey PRIMARY KEY (id));

-- ---------------------------------------------------------------------------------------------
-- The guard. An invitation starts open (neither revoked nor accepted). Its company, invitee, role, token hash,
-- window, issuer and creation time never change. An open invitation changes ONCE: to revoked (by an operator) or
-- to accepted (by a user of its OWN company — checked under a SHARE lock on that user row; the acceptance flow is
-- PO-04 and is not built). A revoked or accepted invitation is final. Nothing is ever deleted.
-- ---------------------------------------------------------------------------------------------
SELECT 'fn user_invitation_guard: ' || pg_temp.po03c_install_function('user_invitation_guard',
$ddl$CREATE FUNCTION %1$I.user_invitation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'restrict_violation', MESSAGE = 'a user invitation is revoked, never deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.accepted_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a user invitation starts open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL OR OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a revoked or accepted user invitation is final';
  END IF;
  IF (NEW.id, NEW.org_id, NEW.name, NEW.email_normalized, NEW.requested_role, NEW.token_hash, NEW.expires_at,
      NEW.invited_by_platform_admin_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.name, OLD.email_normalized, OLD.requested_role, OLD.token_hash, OLD.expires_at,
      OLD.invited_by_platform_admin_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a user invitation''s company, invitee, role, token, window and issuer are immutable';
  END IF;
  IF NEW.accepted_user_id IS NOT NULL THEN
    PERFORM 1 FROM public.users u WHERE u.id = NEW.accepted_user_id AND u.org_id = NEW.org_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a user invitation is accepted only by a user of its own company';
    END IF;
  END IF;
  RETURN NEW;
END
$body$$ddl$) AS po03c_step;

-- ---------------------------------------------------------------------------------------------
-- user_invitations (Schema.md §5.2). Only SHA-256(token) is stored. open -> revoked | accepted (terminal,
-- exclusive) | expired (derived from time). ONE open invitation per normalized e-mail, platform-wide (customer
-- e-mails are globally unique): a re-issue revokes the old row first, in the same transaction.
-- ---------------------------------------------------------------------------------------------
SELECT 'user_invitations: ' || pg_temp.po03c_install_table('user_invitations', ARRAY[
$ddl$CREATE TABLE %1$I.user_invitations (
  id                           uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id                       integer     NOT NULL,
  name                         text        NOT NULL,
  email_normalized             text        NOT NULL,
  requested_role               text        NOT NULL,
  token_hash                   text        NOT NULL,
  expires_at                   timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at                  timestamptz,
  accepted_user_id             integer,
  revoked_at                   timestamptz,
  revoked_by_platform_admin_id uuid,
  invited_by_platform_admin_id uuid        NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT user_invitations_org_fk FOREIGN KEY (org_id) REFERENCES %1$I.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT user_invitations_accepted_user_fk FOREIGN KEY (accepted_user_id) REFERENCES %1$I.users (id) ON DELETE RESTRICT,
  CONSTRAINT user_invitations_revoked_by_fk FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES %1$I.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT user_invitations_invited_by_fk FOREIGN KEY (invited_by_platform_admin_id) REFERENCES %1$I.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT user_invitations_token_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_invitations_email_chk CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND length(email_normalized) <= 320
    AND email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ),
  CONSTRAINT user_invitations_name_chk CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 200),
  CONSTRAINT user_invitations_role_chk CHECK (requested_role IN ('admin', 'staff')),
  CONSTRAINT user_invitations_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CONSTRAINT user_invitations_terminal_chk CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT user_invitations_acceptance_chk CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL)),
  CONSTRAINT user_invitations_acceptance_window_chk CHECK (accepted_at IS NULL OR (accepted_at >= created_at AND accepted_at <= expires_at)),
  CONSTRAINT user_invitations_revocation_chk CHECK ((revoked_at IS NULL) = (revoked_by_platform_admin_id IS NULL)),
  CONSTRAINT user_invitations_revocation_time_chk CHECK (revoked_at IS NULL OR revoked_at >= created_at)
)$ddl$,
$ddl$CREATE UNIQUE INDEX user_invitations_token_hash_uq ON %1$I.user_invitations USING btree (token_hash)$ddl$,
$ddl$CREATE UNIQUE INDEX user_invitations_open_email_uq ON %1$I.user_invitations USING btree (email_normalized) WHERE accepted_at IS NULL AND revoked_at IS NULL$ddl$,
$ddl$CREATE UNIQUE INDEX user_invitations_accepted_user_uq ON %1$I.user_invitations USING btree (accepted_user_id) WHERE accepted_user_id IS NOT NULL$ddl$,
$ddl$CREATE INDEX user_invitations_org_email_idx ON %1$I.user_invitations USING btree (org_id, email_normalized)$ddl$,
$ddl$CREATE INDEX user_invitations_org_expiry_idx ON %1$I.user_invitations USING btree (org_id, expires_at)$ddl$
]) AS po03c_step;

-- ---------------------------------------------------------------------------------------------
-- Triggers (drizzle-kit push never creates them; they are installed or verified here).
-- ---------------------------------------------------------------------------------------------
SELECT 'trigger ' || r.t || '.' || r.g || ': ' || pg_temp.po03c_install_trigger(r.t, r.g, r.ddl) AS po03c_step
FROM (VALUES
  (1, 'user_invitations', 'user_invitations_guard',
   $ddl$CREATE TRIGGER user_invitations_guard BEFORE INSERT OR UPDATE OR DELETE ON %1$I.user_invitations FOR EACH ROW EXECUTE FUNCTION %1$I.user_invitation_guard()$ddl$),
  (2, 'user_invitations', 'user_invitations_no_truncate',
   $ddl$CREATE TRIGGER user_invitations_no_truncate BEFORE TRUNCATE ON %1$I.user_invitations FOR EACH STATEMENT EXECUTE FUNCTION public.platform_reject_mutation()$ddl$)
) AS r(n, t, g, ddl)
ORDER BY r.n;

-- No trigger other than these two may exist on the table (a decoy or leftover would be accepted silently).
DO $only$
DECLARE
  extra text;
BEGIN
  SELECT string_agg(tg.tgname, ', ' ORDER BY tg.tgname) INTO extra
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'user_invitations' AND NOT tg.tgisinternal
    AND tg.tgname NOT IN ('user_invitations_guard', 'user_invitations_no_truncate');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_object',
      MESSAGE = format('PO-03C: unexpected trigger(s) on user_invitations: %s; nothing was applied', extra),
      HINT = 'PO-03C never drops an existing trigger. Investigate; any change needs an owner-approved plan.';
  END IF;
END
$only$;

-- ---------------------------------------------------------------------------------------------
-- Clean up the scratch reference and the session-temporary helpers.
-- ---------------------------------------------------------------------------------------------
DROP SCHEMA po03c_reference CASCADE;
DROP FUNCTION pg_temp.po03c_install_trigger(text, text, text);
DROP FUNCTION pg_temp.po03c_install_function(text, text);
DROP FUNCTION pg_temp.po03c_install_table(text, text[]);
DROP FUNCTION pg_temp.po03c_assert_same(text);
DROP FUNCTION pg_temp.po03c_shape(text, text);

COMMIT;
