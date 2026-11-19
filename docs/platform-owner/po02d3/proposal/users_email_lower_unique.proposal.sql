-- =============================================================================================
-- PROPOSAL (PO-02D3) — NOT APPROVED · NOT EXECUTED · NOT IN THE MIGRATION JOURNAL OR drizzle/platform/.
-- An additive, case-insensitive unique index on the CUSTOMER table `users`. It may be copied into a
-- reviewed migration (without the guard below) only after the owner approves the customer-table index
-- (decision A-7 / I-7), D-6 (the production migration mechanism) and a D-7 run of
-- docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql that reports ZERO case-insensitive
-- duplicate groups (E1 = 0). docs/platform-owner/PO02D3_DEVELOPMENT.md §D.
--
-- WHY (defence in depth): users.email already carries the case-SENSITIVE UNIQUE constraint
-- users_email_unique, and every application path that writes users.email stores trim().toLowerCase()
-- (/register, team members, invitation acceptance) — so two application writers can never create two
-- rows with the same normalized e-mail (proven under concurrency in verify:platform-email-uniqueness).
-- What that constraint cannot stop is a NON-normalized writer (manual SQL, an import, future code) or a
-- pre-existing mixed-case row: `Owner@x.test` and `owner@x.test` are different strings to it. This index
-- makes the database itself refuse a second account that differs only by letter case.
--
-- SEMANTICS: lower() follows the database's ctype. On the C.UTF-8 / UTF-8 production collation it folds
-- ASCII exactly as JavaScript's toLowerCase(); invitation e-mails are printable ASCII only (PO-02D2
-- I-7), and the audit's E4 counts non-ASCII addresses so their folding can be reviewed before approval.
--
-- LOCKING: CREATE UNIQUE INDEX CONCURRENTLY takes SHARE UPDATE EXCLUSIVE on `users` — reads AND writes
-- continue during the build (sign-ins update last_login_at; registration and team changes insert).
-- It waits for transactions already running when it starts, and it can fail late (a duplicate
-- committed during the build) leaving an INVALID index: step 1 refuses to continue over one and
-- prints the recovery.
--
-- HOW TO RUN (after approval): statement by statement in autocommit mode,
--     psql -v ON_ERROR_STOP=1 -f users_email_lower_unique.sql
-- NOT inside BEGIN/COMMIT and NOT with `psql -1`. Rollback: users_email_lower_unique_rollback.proposal.sql.
-- =============================================================================================

\set ON_ERROR_STOP on
-- statement
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D3 PROPOSAL — not approved for execution (docs/platform-owner/PO02D3_DEVELOPMENT.md §D)';
END $proposal_guard$;

-- statement
SET lock_timeout = 0;

-- statement
SET statement_timeout = 0;

-- statement
-- 1. Refuse to build over an INVALID leftover or a different definition, without the existing
--    case-sensitive constraint, or while case-insensitive duplicates exist (the build would fail late).
DO $pre$
DECLARE
  actual text;
  is_valid boolean;
  dup_groups bigint;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'PO-02D3 E-1: public.users does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'users' AND con.contype = 'u' AND pg_get_constraintdef(con.oid) = 'UNIQUE (email)'
  ) THEN
    RAISE EXCEPTION 'PO-02D3 E-1: public.users has no UNIQUE (email) constraint — the shape is not the reviewed one';
  END IF;
  SELECT pg_get_indexdef(i.oid), ix.indisvalid AND ix.indisready INTO actual, is_valid
  FROM pg_class i
  JOIN pg_namespace n ON n.oid = i.relnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid
  WHERE n.nspname = 'public' AND i.relname = 'users_email_lower_uq';
  IF FOUND THEN
    IF actual IS DISTINCT FROM 'CREATE UNIQUE INDEX users_email_lower_uq ON public.users USING btree (lower(email))' THEN
      RAISE EXCEPTION 'PO-02D3 E-1: public.users_email_lower_uq exists with a different definition: %', actual;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'PO-02D3 E-1: public.users_email_lower_uq is INVALID (an interrupted or failed build)'
        USING HINT = 'Run: DROP INDEX CONCURRENTLY public.users_email_lower_uq; resolve the duplicates the audit reports; then run this file again.';
    END IF;
  END IF;
  SELECT count(*) INTO dup_groups FROM (SELECT 1 FROM public.users GROUP BY lower(email) HAVING count(*) > 1) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'PO-02D3 E-1: % case-insensitive duplicate e-mail group(s) in public.users', dup_groups
      USING HINT = 'Run docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql and resolve every group with the owner first.';
  END IF;
END
$pre$;

-- statement
-- 2. Build without blocking reads or writes. No-op when the (valid, identical) index already exists.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_email_lower_uq ON public.users USING btree (lower(email));

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
  WHERE n.nspname = 'public' AND i.relname = 'users_email_lower_uq';
  IF NOT FOUND OR NOT is_valid
     OR actual IS DISTINCT FROM 'CREATE UNIQUE INDEX users_email_lower_uq ON public.users USING btree (lower(email))' THEN
    RAISE EXCEPTION 'PO-02D3 E-1: users_email_lower_uq is missing, INVALID or different after the build (%)', coalesce(actual, 'absent')
      USING HINT = 'Run: DROP INDEX CONCURRENTLY IF EXISTS public.users_email_lower_uq; then run this file again.';
  END IF;
END
$post$;

-- statement
RESET lock_timeout;

-- statement
RESET statement_timeout;
