-- =============================================================================================
-- Platform Owner — PO-02A — M4 for a production runbook: build sessions_org_active_idx WITHOUT
-- blocking writes to the customer `sessions` table (reviewed; NOT applied anywhere by PO-02A).
--
-- PO02A_company_foundation.sql builds M4 inside its transaction with a plain CREATE INDEX, which
-- holds a SHARE lock on `sessions` for the whole build: sign-ins, sign-outs and revocations wait.
-- On a large table, run THIS file first instead. CREATE INDEX CONCURRENTLY takes only SHARE UPDATE
-- EXCLUSIVE (reads and writes continue) at the cost of a slower build that waits for transactions
-- already running. Then run PO02A_company_foundation.sql, which finds the index and verifies it.
--
-- HOW TO RUN: statement by statement in autocommit mode, e.g.
--     psql -v ON_ERROR_STOP=1 -f drizzle/platform/PO02A_m4_sessions_index_concurrently.sql
-- NOT inside BEGIN/COMMIT and NOT with `psql -1`: CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block. Statements are separated by "-- statement" marker lines (used by the tests).
--
-- FAILURE: if the build is interrupted it leaves an INVALID index. Step 1 refuses to continue over
-- it and prints the recovery: DROP INDEX CONCURRENTLY public.sessions_org_active_idx; then re-run.
-- Retry-safe: when the valid index already exists, step 2 is a no-op and step 3 verifies it.
-- PO-02A AUTHORIZATION: disposable `*_test_only_*` databases only. Production is decision D-6.
-- =============================================================================================

-- statement
-- No lock wait is cut short half-way through a concurrent build (that would leave an INVALID
-- index); bound the run from outside (maintenance window) instead.
SET lock_timeout = 0;

-- statement
SET statement_timeout = 0;

-- statement
-- 1. Refuse to build over an INVALID leftover, a different definition, or a missing table.
DO $pre$
DECLARE
  actual text;
  is_valid boolean;
BEGIN
  IF to_regclass('public.sessions') IS NULL THEN
    RAISE EXCEPTION 'PO-02A M4: public.sessions does not exist';
  END IF;
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready INTO actual, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'sessions_org_active_idx';
  IF FOUND THEN
    IF actual IS DISTINCT FROM 'CREATE INDEX sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE (revoked_at IS NULL)' THEN
      RAISE EXCEPTION 'PO-02A M4: public.sessions_org_active_idx exists with a different definition: %', actual;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'PO-02A M4: public.sessions_org_active_idx is INVALID (an interrupted build)'
        USING HINT = 'Run: DROP INDEX CONCURRENTLY public.sessions_org_active_idx; then run this file again.';
    END IF;
  END IF;
END
$pre$;

-- statement
-- 2. Build without blocking writes. No-op when the (valid, identical) index already exists.
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE revoked_at IS NULL;

-- statement
-- 3. Verify: present, valid, ready, and exactly the reviewed definition.
DO $post$
DECLARE
  actual text;
  is_valid boolean;
BEGIN
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready INTO actual, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'sessions_org_active_idx';
  IF NOT FOUND OR NOT is_valid
     OR actual IS DISTINCT FROM 'CREATE INDEX sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE (revoked_at IS NULL)' THEN
    RAISE EXCEPTION 'PO-02A M4: sessions_org_active_idx is missing, INVALID or different after the build (%)', coalesce(actual, 'absent')
      USING HINT = 'Run: DROP INDEX CONCURRENTLY IF EXISTS public.sessions_org_active_idx; then run this file again.';
  END IF;
END
$post$;

-- statement
RESET lock_timeout;

-- statement
RESET statement_timeout;
