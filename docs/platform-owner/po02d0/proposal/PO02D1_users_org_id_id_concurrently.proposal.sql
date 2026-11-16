-- =============================================================================================
-- PROPOSAL (PO-02D0) — NOT APPROVED · NOT EXECUTED · NOT IN THE MIGRATION JOURNAL OR drizzle/platform/.
-- PO-02D1 would copy this file to drizzle/platform/ (without the guard below) only after the owner
-- approves decision U-1 (an additive index on the customer table `users`) and D-6.
--
-- Platform Owner — PO-02D1 — F1 for a production runbook: build users_org_id_id_uq WITHOUT blocking
-- writes to the customer `users` table.
--
-- WHY: tenant_primary_owners references users through the composite key (org_id, user_id) so the
-- database itself guarantees the primary owner belongs to the same company (Schema.md §4.2: "a simple
-- single-column FK alone is insufficient"; PO-00 probes P1/P2, conflict C-9). PostgreSQL accepts a
-- plain non-partial UNIQUE INDEX as a foreign-key target, so no table constraint (and no ACCESS
-- EXCLUSIVE ALTER TABLE) is needed. users.id is the primary key, so the index can never reject a row;
-- it changes no column, constraint, trigger, row or code path of `users`.
--
-- LOCKING: CREATE UNIQUE INDEX CONCURRENTLY takes SHARE UPDATE EXCLUSIVE — reads AND writes continue
-- (sign-ins update users.last_login_at; registration and team changes insert/update users). A plain
-- CREATE INDEX (what PO02D1_onboarding_foundation.sql does when the index is absent) holds SHARE and
-- blocks every users write for the build: use this file first wherever users is not trivially small
-- (size it with L13 of 02_legacy_onboarding_audit_readonly.sql under D-7).
--
-- HOW TO RUN (after approval): statement by statement in autocommit mode,
--     psql -v ON_ERROR_STOP=1 -f PO02D1_users_org_id_id_concurrently.sql
-- NOT inside BEGIN/COMMIT and NOT with `psql -1`. An interrupted build leaves an INVALID index:
-- step 1 refuses to continue over it and prints the recovery (DROP INDEX CONCURRENTLY, re-run).
-- =============================================================================================

\set ON_ERROR_STOP on
-- statement
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D0 PROPOSAL — not approved for execution (docs/platform-owner/PO02D0_DECISIONS.md §G)';
END $proposal_guard$;

-- statement
SET lock_timeout = 0;

-- statement
SET statement_timeout = 0;

-- statement
-- 1. Refuse to build over an INVALID leftover, a different definition, or a missing/unexpected table.
DO $pre$
DECLARE
  actual text;
  is_valid boolean;
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
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready INTO actual, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'users_org_id_id_uq';
  IF FOUND THEN
    IF actual IS DISTINCT FROM 'CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (org_id, id)' THEN
      RAISE EXCEPTION 'PO-02D1 F1: public.users_org_id_id_uq exists with a different definition: %', actual;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'PO-02D1 F1: public.users_org_id_id_uq is INVALID (an interrupted build)'
        USING HINT = 'Run: DROP INDEX CONCURRENTLY public.users_org_id_id_uq; then run this file again.';
    END IF;
  END IF;
END
$pre$;

-- statement
-- 2. Build without blocking writes. No-op when the (valid, identical) index already exists.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_org_id_id_uq ON public.users USING btree (org_id, id);

-- statement
-- 3. Verify: present, valid, ready, unique, exactly the reviewed definition.
DO $post$
DECLARE
  actual text;
  is_valid boolean;
BEGIN
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready AND ix.indisunique INTO actual, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'users_org_id_id_uq';
  IF NOT FOUND OR NOT is_valid
     OR actual IS DISTINCT FROM 'CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (org_id, id)' THEN
    RAISE EXCEPTION 'PO-02D1 F1: users_org_id_id_uq is missing, INVALID or different after the build (%)', coalesce(actual, 'absent')
      USING HINT = 'Run: DROP INDEX CONCURRENTLY IF EXISTS public.users_org_id_id_uq; then run this file again.';
  END IF;
END
$post$;

-- statement
RESET lock_timeout;

-- statement
RESET statement_timeout;
