-- =============================================================================================
-- Platform Owner — PO-02A — company database foundation (reviewed, hand-written, retry-safe)
--
-- Creates, and nothing else:
--   M2  tenant_access_controls            (PR #11 Schema.md §4.1) one row per organization
--   M3  organization_invitations          (PR #11 Schema.md §5.1) hashed, single-use invitations
--   M4  sessions_org_active_idx           additive index on the EXISTING customer table `sessions`:
--                                         (org_id) WHERE revoked_at IS NULL
--       platform_audit_events_entity_idx  (entity_type, entity_id, created_at DESC NULLS LAST)
-- It alters no column, constraint, trigger or row of any existing table. It creates NO row: no
-- company is backfilled, suspended or modified; an organization without a tenant_access_controls
-- row stays active through the compatibility rule in src/lib/platform/company-access.ts. It
-- installs no persistent function, trigger or view (its helpers live in pg_temp and are dropped).
--
-- Source of truth: src/db/schema/platform-companies.ts (M2, M3), src/db/schema/security.ts (M4)
-- and src/db/schema/platform.ts (audit index). This file must stay catalog-equivalent to them;
-- `npm run verify:platform-company-schema` proves it on disposable databases.
--
-- Deliberately OUTSIDE the drizzle-kit journal (drizzle/meta/_journal.json), like PO01: the
-- historical migrations build 59 tables against the schema's 67 (PO-00 §F.2, owner decision D-6).
--
-- RETRY-SAFE WITHOUT HIDING INCOMPATIBILITIES. Each object is first built from the exact DDL
-- below into a private scratch schema (po02a_reference), then:
--   absent in public                 -> created in public from the same DDL      ("created")
--   present with exactly that shape  -> left untouched (a re-run, or db:push)   ("verified")
--   present with ANY difference      -> the migration aborts and names every difference
--                                       (columns, defaults, constraints, indexes and their
--                                       validity, triggers, relation kind, row security).
-- ONE transaction: any failure leaves nothing behind, the scratch schema included.
--
-- LOCKING (bounded by lock_timeout; reads are never blocked):
--   - the foreign keys take SHARE ROW EXCLUSIVE on orgs and platform_admins until COMMIT
--     (writes to those tables wait for the few milliseconds the migration takes);
--   - CREATE INDEX on sessions takes SHARE on sessions for the duration of the build (sign-ins,
--     sign-outs and revocations wait). For production, PO02A_m4_sessions_index_concurrently.sql
--     builds M4 first WITHOUT blocking writes; this file then finds it and only verifies it.
--
-- PO-02A AUTHORIZATION: loopback disposable `*_test_only_*` databases only, via
-- `npm run platform:db:apply` (fails closed on any other target). Applying it to production is a
-- separate owner decision (D-6). Requires PostgreSQL >= 14, CREATE privilege on the database (for
-- the scratch schema) and PO01_platform_identity.sql. Rollback: PO02A_rollback.sql.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------
-- Helpers (session-temporary; never in the public schema; dropped before COMMIT).
-- ---------------------------------------------------------------------------------------------

-- Canonical shape of one relation, one line per property. Index definitions are printed without
-- their schema so the public object and its scratch reference compare equal when identical.
CREATE OR REPLACE FUNCTION pg_temp.po02a_shape(p_schema text, p_name text) RETURNS SETOF text
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
  SELECT 'constraint ' || con.conname || ' ' || con.contype::text || ' ' || pg_get_constraintdef(con.oid, true)
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
  SELECT 'trigger ' || tg.tgname || ' ' || tg.tgenabled::text
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_name AND NOT tg.tgisinternal
$fn$;

-- Abort unless public.<name> has exactly the shape of po02a_reference.<name>.
CREATE OR REPLACE FUNCTION pg_temp.po02a_assert_same(p_name text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  diffs text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY line) INTO diffs FROM (
    SELECT 'unexpected in public: ' || s AS line
    FROM (SELECT s FROM pg_temp.po02a_shape('public', p_name) s
          EXCEPT SELECT s FROM pg_temp.po02a_shape('po02a_reference', p_name) s) x
    UNION ALL
    SELECT 'missing in public:    ' || s
    FROM (SELECT s FROM pg_temp.po02a_shape('po02a_reference', p_name) s
          EXCEPT SELECT s FROM pg_temp.po02a_shape('public', p_name) s) y
  ) d;
  IF diffs IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_table',
      MESSAGE = format('PO-02A: public.%I already exists with a different shape; nothing was applied', p_name),
      DETAIL = diffs,
      HINT = 'PO-02A never alters an existing object. Investigate the difference; any change needs an owner-approved plan.';
  END IF;
  RETURN 'verified';
END
$fn$;

-- Build a table (and its indexes) from p_ddl: always into the scratch reference; into public only
-- when absent there. A table present in public must match the reference exactly.
CREATE OR REPLACE FUNCTION pg_temp.po02a_install_table(p_name text, p_ddl text[]) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY p_ddl LOOP
    EXECUTE format(stmt, 'po02a_reference');
  END LOOP;
  IF to_regclass(format('public.%I', p_name)) IS NULL THEN
    FOREACH stmt IN ARRAY p_ddl LOOP
      EXECUTE format(stmt, 'public');
    END LOOP;
    PERFORM pg_temp.po02a_assert_same(p_name);
    RETURN 'created';
  END IF;
  RETURN pg_temp.po02a_assert_same(p_name);
END
$fn$;

-- Build one index on an EXISTING table: the reference is built on an empty structural copy of
-- the table in the scratch schema. An index of that name in public must have the identical
-- definition, be on that table, and be valid (an interrupted CREATE INDEX CONCURRENTLY leaves an
-- INVALID index, which is refused with the exact recovery step).
CREATE OR REPLACE FUNCTION pg_temp.po02a_install_index(p_table text, p_index text, p_ddl text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  expected text;
  actual text;
  on_table text;
  is_valid boolean;
BEGIN
  EXECUTE format('CREATE TABLE po02a_reference.%I (LIKE public.%I)', p_table, p_table);
  EXECUTE format(p_ddl, 'po02a_reference');
  SELECT replace(pg_get_indexdef(i.oid), ' ON po02a_reference.', ' ON ') INTO expected
  FROM pg_class i JOIN pg_namespace n ON n.oid = i.relnamespace
  WHERE n.nspname = 'po02a_reference' AND i.relname = p_index;

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
    RAISE EXCEPTION USING
      ERRCODE = 'duplicate_object',
      MESSAGE = format('PO-02A: public.%I already exists with a different definition; nothing was applied', p_index),
      DETAIL = format('expected: %s%sfound:    %s', expected, E'\n', coalesce(actual, '(not an index of ' || p_table || ')')),
      HINT = 'PO-02A never alters an existing object. Investigate the difference; any change needs an owner-approved plan.';
  END IF;
  IF NOT is_valid THEN
    RAISE EXCEPTION USING
      ERRCODE = 'object_not_in_prerequisite_state',
      MESSAGE = format('PO-02A: public.%I exists but is INVALID (an interrupted CREATE INDEX CONCURRENTLY); nothing was applied', p_index),
      HINT = format('Run DROP INDEX CONCURRENTLY public.%I; then build it again (PO02A_m4_sessions_index_concurrently.sql) and re-run this file.', p_index);
  END IF;
  RETURN 'verified';
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 0. Preconditions: the server, the tenant tables this file references, and PO-01A.
-- ---------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text;
BEGIN
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'PO-02A requires PostgreSQL >= 14 (found %)', current_setting('server_version');
  END IF;
  SELECT string_agg(format('%s.%s %s', r.t, r.c, r.ty), ', ') INTO missing
  FROM (VALUES
          ('orgs', 'id', 'integer'),
          ('sessions', 'org_id', 'integer'),
          ('sessions', 'revoked_at', 'timestamp without time zone'),
          ('platform_admins', 'id', 'uuid'),
          ('platform_audit_events', 'entity_type', 'text'),
          ('platform_audit_events', 'entity_id', 'text'),
          ('platform_audit_events', 'created_at', 'timestamp with time zone')
       ) AS r(t, c, ty)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class cl ON cl.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND cl.relkind = 'r'
      AND a.attname = r.c AND NOT a.attisdropped AND format_type(a.atttypid, a.atttypmod) = r.ty
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02A precondition failed: missing or different column(s): %', missing
      USING HINT = 'Apply drizzle/platform/PO01_platform_identity.sql first, on the ERP schema this file was reviewed against.';
  END IF;
  -- Foreign-key targets must be the primary keys.
  SELECT string_agg(r.t, ', ') INTO missing
  FROM (VALUES ('orgs'), ('platform_admins')) AS r(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = r.t AND con.contype = 'p'
      AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02A precondition failed: no PRIMARY KEY (id) on %', missing;
  END IF;
END
$pre$;

CREATE SCHEMA po02a_reference;

-- ---------------------------------------------------------------------------------------------
-- M2 — tenant_access_controls (Schema.md §4.1). The platform's access decision per organization,
-- independent of subscriptions. Every change is attributed (who, when, why); a suspended row
-- cannot exist without a responsible platform administrator.
-- ---------------------------------------------------------------------------------------------
SELECT 'M2 tenant_access_controls: ' || pg_temp.po02a_install_table('tenant_access_controls', ARRAY[
$ddl$CREATE TABLE %1$I.tenant_access_controls (
  org_id                       integer     NOT NULL,
  access_status                text        NOT NULL DEFAULT 'active',
  reason                       text,
  changed_by_platform_admin_id uuid,
  changed_at                   timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_access_controls_pkey PRIMARY KEY (org_id),
  CONSTRAINT tenant_access_controls_org_fk FOREIGN KEY (org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT tenant_access_controls_changed_by_fk FOREIGN KEY (changed_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT tenant_access_controls_status_chk CHECK (access_status IN ('active', 'suspended')),
  CONSTRAINT tenant_access_controls_reason_chk CHECK (reason IS NULL OR (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 1000)),
  CONSTRAINT tenant_access_controls_change_attribution_chk CHECK ((changed_at IS NULL) = (changed_by_platform_admin_id IS NULL)),
  CONSTRAINT tenant_access_controls_change_reason_chk CHECK (changed_by_platform_admin_id IS NULL OR reason IS NOT NULL),
  CONSTRAINT tenant_access_controls_suspension_chk CHECK (access_status <> 'suspended' OR changed_by_platform_admin_id IS NOT NULL),
  CONSTRAINT tenant_access_controls_timestamps_chk CHECK (updated_at >= created_at AND (changed_at IS NULL OR changed_at >= created_at))
)$ddl$
]) AS po02a_step;

-- ---------------------------------------------------------------------------------------------
-- M3 — organization_invitations (Schema.md §5.1). Pending metadata only — no orgs/users row until
-- acceptance (PO-02D). Only SHA-256(token) is stored. pending -> accepted | revoked (terminal,
-- exclusive) | expired (derived from time). One pending invitation per normalized owner e-mail.
-- Schema.md's initial_package_version_id / initial_cycle are deferred with the package schema.
-- ---------------------------------------------------------------------------------------------
SELECT 'M3 organization_invitations: ' || pg_temp.po02a_install_table('organization_invitations', ARRAY[
$ddl$CREATE TABLE %1$I.organization_invitations (
  id                           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_name                 text        NOT NULL,
  industry                     text,
  company_email                text        NOT NULL,
  country_name                 text        NOT NULL,
  currency_code                text        NOT NULL,
  owner_name                   text        NOT NULL,
  owner_email_normalized       text        NOT NULL,
  token_hash                   text        NOT NULL,
  expires_at                   timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at                  timestamptz,
  accepted_org_id              integer,
  revoked_at                   timestamptz,
  revoked_by_platform_admin_id uuid,
  invited_by_platform_admin_id uuid        NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT organization_invitations_accepted_org_fk FOREIGN KEY (accepted_org_id) REFERENCES public.orgs (id) ON DELETE RESTRICT,
  CONSTRAINT organization_invitations_invited_by_fk FOREIGN KEY (invited_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT organization_invitations_revoked_by_fk FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES public.platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT organization_invitations_token_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT organization_invitations_owner_email_chk CHECK (
    owner_email_normalized = lower(btrim(owner_email_normalized))
    AND length(owner_email_normalized) <= 320
    AND owner_email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ),
  CONSTRAINT organization_invitations_company_email_chk CHECK (
    company_email = lower(btrim(company_email))
    AND length(company_email) <= 320
    AND company_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ),
  CONSTRAINT organization_invitations_company_name_chk CHECK (company_name = btrim(company_name) AND length(company_name) BETWEEN 1 AND 200),
  CONSTRAINT organization_invitations_owner_name_chk CHECK (owner_name = btrim(owner_name) AND length(owner_name) BETWEEN 1 AND 200),
  CONSTRAINT organization_invitations_industry_chk CHECK (industry IS NULL OR (industry = btrim(industry) AND length(industry) BETWEEN 1 AND 100)),
  CONSTRAINT organization_invitations_country_chk CHECK (country_name = btrim(country_name) AND length(country_name) BETWEEN 2 AND 100),
  CONSTRAINT organization_invitations_currency_chk CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT organization_invitations_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CONSTRAINT organization_invitations_terminal_chk CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT organization_invitations_acceptance_chk CHECK ((accepted_at IS NULL) = (accepted_org_id IS NULL)),
  CONSTRAINT organization_invitations_acceptance_window_chk CHECK (accepted_at IS NULL OR (accepted_at >= created_at AND accepted_at <= expires_at)),
  CONSTRAINT organization_invitations_revocation_chk CHECK ((revoked_at IS NULL) = (revoked_by_platform_admin_id IS NULL)),
  CONSTRAINT organization_invitations_revocation_time_chk CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT organization_invitations_updated_chk CHECK (updated_at >= created_at)
)$ddl$,
$ddl$CREATE UNIQUE INDEX organization_invitations_token_hash_uq ON %1$I.organization_invitations USING btree (token_hash)$ddl$,
$ddl$CREATE UNIQUE INDEX organization_invitations_accepted_org_uq ON %1$I.organization_invitations USING btree (accepted_org_id) WHERE accepted_org_id IS NOT NULL$ddl$,
$ddl$CREATE UNIQUE INDEX organization_invitations_pending_email_uq ON %1$I.organization_invitations USING btree (owner_email_normalized) WHERE accepted_at IS NULL AND revoked_at IS NULL$ddl$,
$ddl$CREATE INDEX organization_invitations_pending_expiry_idx ON %1$I.organization_invitations USING btree (expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL$ddl$
]) AS po02a_step;

-- ---------------------------------------------------------------------------------------------
-- M4 — the live sessions of an organization (org-wide revocation in PO-02C). Additive index on
-- the customer table; its columns, constraints, rows and every session code path are unchanged.
-- ---------------------------------------------------------------------------------------------
SELECT 'M4 sessions_org_active_idx: ' || pg_temp.po02a_install_index('sessions', 'sessions_org_active_idx',
$ddl$CREATE INDEX sessions_org_active_idx ON %1$I.sessions USING btree (org_id) WHERE revoked_at IS NULL$ddl$
) AS po02a_step;

-- ---------------------------------------------------------------------------------------------
-- Platform audit lookup by entity (late revocation recording, invitation / company history).
-- platform_audit_events stays append-only: its triggers and every existing index are untouched.
-- ---------------------------------------------------------------------------------------------
SELECT 'audit platform_audit_events_entity_idx: ' || pg_temp.po02a_install_index('platform_audit_events', 'platform_audit_events_entity_idx',
$ddl$CREATE INDEX platform_audit_events_entity_idx ON %1$I.platform_audit_events USING btree (entity_type, entity_id, created_at DESC NULLS LAST)$ddl$
) AS po02a_step;

-- ---------------------------------------------------------------------------------------------
-- Clean up the scratch reference and the session-temporary helpers.
-- ---------------------------------------------------------------------------------------------
DROP SCHEMA po02a_reference CASCADE;
DROP FUNCTION pg_temp.po02a_install_index(text, text, text);
DROP FUNCTION pg_temp.po02a_install_table(text, text[]);
DROP FUNCTION pg_temp.po02a_assert_same(text);
DROP FUNCTION pg_temp.po02a_shape(text, text);

COMMIT;
