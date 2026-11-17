-- =============================================================================================
-- Platform Owner — PO-02D1 (validated in PO-02D1A) — rollback, step 2 of 2: removes F1
-- (users_org_id_id_uq) from the EXISTING customer table users, and nothing else.
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION (decisions D-6 and D-7 are open). PO-02D1A runs it ONLY on
-- loopback disposable `*_test_only_*` databases, statement by statement (autocommit), from its verifiers.
--
-- ORDER: only AFTER PO02D1_rollback.sql (step 1). The primary-owner foreign key depends on this key;
-- statement 2 refuses while anything still references it (PostgreSQL would refuse too).
-- Two cleanup paths, chosen by the state found — both are exercised by the PO-02D1A verifiers:
--   the UNIQUE constraint (normal state)   -> statement 3: ALTER TABLE ... DROP CONSTRAINT (drops its index
--                                             too; ACCESS EXCLUSIVE on users for the catalog change —
--                                             measured —, bounded by lock_timeout 5 s; no scan)
--   a bare index from the concurrent runbook (never attached, or INVALID after an interrupted build)
--                                          -> statement 5: DROP INDEX CONCURRENTLY (no blocking lock)
-- No row of users (or of any table) is read or changed; one platform audit record is ADDED when a key
-- or index is actually removed.
--
-- HOW TO RUN: statement by statement in autocommit mode — NOT inside BEGIN/COMMIT, NOT with psql -1.
-- =============================================================================================

-- statement
SET lock_timeout = '5s';

-- statement
-- 2. Refuse while anything still depends on the key (run PO02D1_rollback.sql first).
DO $pre$
DECLARE
  dependants text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'PO-02D1 F1 drop: public.users does not exist';
  END IF;
  SELECT string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ' ORDER BY con.conname) INTO dependants
  FROM pg_constraint con
  WHERE con.contype = 'f' AND con.confrelid = 'public.users'::regclass
    AND con.conindid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = 'users_org_id_id_uq');
  IF dependants IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1 F1 drop refused: % still reference(s) users_org_id_id_uq; nothing was changed', dependants
      USING HINT = 'Run PO02D1_rollback.sql (step 1) first.';
  END IF;
END
$pre$;

-- statement
-- 3. Normal state: drop the UNIQUE constraint (and with it its index).
DO $constraint$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_org_id_id_uq') THEN
    ALTER TABLE public.users DROP CONSTRAINT users_org_id_id_uq;
    INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
    VALUES (NULL, 'migration PO-02D1 rollback', 'schema.users_key_removed', 'schema', 'PO02D1',
            jsonb_build_object('step', 2, 'removed', 'users_org_id_id_uq (constraint and index)'), 'success');
  END IF;
END
$constraint$;

-- statement
SET lock_timeout = 0;

-- statement
-- 4. Note (for this session only) whether a bare index is about to be removed, so step 6 can record it.
SELECT set_config('po02d1.bare_index_found',
                  CASE WHEN to_regclass('public.users_org_id_id_uq') IS NOT NULL THEN 'yes' ELSE 'no' END, false);

-- statement
-- 5. A bare index left by the concurrent runbook (never attached, or INVALID): remove it without blocking.
--    A no-op when statement 3 already removed the key.
DROP INDEX CONCURRENTLY IF EXISTS public.users_org_id_id_uq;

-- statement
-- 6. Verify: no constraint and no relation of that name remain; record a bare-index removal.
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_org_id_id_uq')
     OR to_regclass('public.users_org_id_id_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D1 F1 drop: users_org_id_id_uq is still present';
  END IF;
  IF current_setting('po02d1.bare_index_found', true) = 'yes' THEN
    INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
    VALUES (NULL, 'migration PO-02D1 rollback', 'schema.users_key_removed', 'schema', 'PO02D1',
            jsonb_build_object('step', 2, 'removed', 'users_org_id_id_uq (bare index, dropped concurrently)'), 'success');
  END IF;
END
$post$;

-- statement
RESET lock_timeout;
