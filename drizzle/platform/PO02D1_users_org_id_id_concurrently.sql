-- =============================================================================================
-- Platform Owner — PO-02D1 (validated in PO-02D1A) — F1 production-runbook companion:
-- build users_org_id_id_uq WITHOUT blocking writes to the customer `users` table, then attach it as
-- the UNIQUE (id, org_id) constraint in its own autocommit statement.
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION (decisions D-6 and D-7 are open). PO-02D1A runs it ONLY on
-- loopback disposable `*_test_only_*` databases, statement by statement, from its verifiers.
--
-- WHY: tenant_primary_owners references users through (user_id, org_id) -> users (id, org_id), so the
-- database itself guarantees the primary owner belongs to the same company (Schema.md §4.2). users.id is
-- the primary key, so the key can never reject a row; it changes no column, row or code path of `users`.
--
-- LOCKING (measured by verify:platform-onboarding-migration-safety on disposable databases):
--   statement 3 CREATE UNIQUE INDEX CONCURRENTLY holds only SHARE UPDATE EXCLUSIVE on users: reads AND
--               writes of users continue (measured during the build: user INSERT, UPDATE of
--               last_login_at and a complete customer sign-in transaction); it waits for transactions
--               older than itself, twice;
--   statement 5 ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX takes ACCESS EXCLUSIVE on users for
--               the catalog change only (no scan; measured ~5 ms in autocommit). While it WAITS for that
--               lock (behind a long reader of users), new readers of users queue behind it: lock_timeout
--               5 s bounds that queue, and on a timeout the valid index stays unattached for a re-run;
-- afterwards PO02D1_onboarding_foundation.sql only verifies F1 and never locks users exclusively.
--
-- HOW TO RUN: statement by statement in autocommit mode, NOT inside BEGIN/COMMIT and NOT with psql -1.
-- An interrupted build leaves an INVALID index: statement 2 refuses to continue over it and names the
-- recovery (DROP INDEX CONCURRENTLY, then re-run).
-- =============================================================================================

-- statement
SET lock_timeout = 0;

-- statement
SET statement_timeout = 0;

-- statement
-- 2. Refuse to build over an INVALID leftover, a different definition, a squatting object, or a missing table.
DO $pre$
DECLARE
  con_def text;
  idx_def text;
  idx_ok boolean;
  kind text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'PO-02D1 F1: public.users does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'users' AND con.contype = 'p' AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)'
  ) THEN
    RAISE EXCEPTION 'PO-02D1 F1: public.users has no PRIMARY KEY (id)';
  END IF;
  SELECT pg_get_constraintdef(con.oid) INTO con_def FROM pg_constraint con
  WHERE con.conrelid = 'public.users'::regclass AND con.conname = 'users_org_id_id_uq';
  IF FOUND AND con_def IS DISTINCT FROM 'UNIQUE (id, org_id)' THEN
    RAISE EXCEPTION 'PO-02D1 F1: public.users has a constraint users_org_id_id_uq with a different definition: %', con_def;
  END IF;
  SELECT c.relkind::text INTO kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'users_org_id_id_uq';
  IF FOUND AND kind <> 'i' THEN
    RAISE EXCEPTION 'PO-02D1 F1: public.users_org_id_id_uq exists and is not an index (relkind %)', kind;
  END IF;
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready INTO idx_def, idx_ok
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'users_org_id_id_uq';
  IF FOUND THEN
    IF idx_def IS DISTINCT FROM 'CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (id, org_id)' THEN
      RAISE EXCEPTION 'PO-02D1 F1: public.users_org_id_id_uq exists with a different definition: %', idx_def;
    END IF;
    IF NOT idx_ok THEN
      RAISE EXCEPTION 'PO-02D1 F1: public.users_org_id_id_uq is INVALID (an interrupted build)'
        USING HINT = 'Run: DROP INDEX CONCURRENTLY public.users_org_id_id_uq; then run this file again.';
    END IF;
  END IF;
END
$pre$;

-- statement
-- 3. Build without blocking writes. No-op when the (valid, identical) index or constraint already exists.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_org_id_id_uq ON public.users USING btree (id, org_id);

-- statement
-- 4. Verify the index: present, valid, ready, unique, exactly the reviewed definition.
DO $built$
DECLARE
  idx_def text;
  idx_ok boolean;
BEGIN
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready AND ix.indisunique INTO idx_def, idx_ok
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'users_org_id_id_uq';
  IF NOT FOUND OR NOT idx_ok
     OR idx_def IS DISTINCT FROM 'CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (id, org_id)' THEN
    RAISE EXCEPTION 'PO-02D1 F1: users_org_id_id_uq is missing, INVALID or different after the build (%)', coalesce(idx_def, 'absent')
      USING HINT = 'Run: DROP INDEX CONCURRENTLY IF EXISTS public.users_org_id_id_uq; then run this file again.';
  END IF;
END
$built$;

-- statement
-- 5. Attach the index as the UNIQUE constraint (catalog change only; bounded wait) unless already attached.
DO $attach$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_org_id_id_uq') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_org_id_id_uq UNIQUE USING INDEX users_org_id_id_uq;
  END IF;
END
$attach$;

-- statement
-- 6. Verify the constraint.
DO $post$
DECLARE
  con_def text;
BEGIN
  SELECT pg_get_constraintdef(con.oid) INTO con_def FROM pg_constraint con
  WHERE con.conrelid = 'public.users'::regclass AND con.conname = 'users_org_id_id_uq' AND con.contype = 'u'
    AND con.conindid = 'public.users_org_id_id_uq'::regclass AND NOT con.condeferrable AND con.convalidated;
  IF con_def IS DISTINCT FROM 'UNIQUE (id, org_id)' THEN
    RAISE EXCEPTION 'PO-02D1 F1: the users_org_id_id_uq constraint is missing or different after the attach (%)', coalesce(con_def, 'absent');
  END IF;
END
$post$;

-- statement
RESET lock_timeout;

-- statement
RESET statement_timeout;
