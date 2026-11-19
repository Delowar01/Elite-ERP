-- =============================================================================================
-- PROPOSAL (PO-02D3) — NOT APPROVED · NOT EXECUTED. The exact reverse of
-- users_email_lower_unique.proposal.sql: drops ONLY public.users_email_lower_uq (also an INVALID
-- leftover of an interrupted build), without blocking reads or writes. The case-sensitive constraint
-- users_email_unique, every row and every other object of `users` are untouched. Idempotent.
--
-- HOW TO RUN (after approval): statement by statement in autocommit mode,
--     psql -v ON_ERROR_STOP=1 -f users_email_lower_unique_rollback.sql
-- =============================================================================================

\set ON_ERROR_STOP on
-- statement
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D3 PROPOSAL — not approved for execution (docs/platform-owner/PO02D3_DEVELOPMENT.md §D)';
END $proposal_guard$;

-- statement
DROP INDEX CONCURRENTLY IF EXISTS public.users_email_lower_uq;

-- statement
DO $post$ BEGIN
  IF to_regclass('public.users_email_lower_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'PO-02D3 E-1 rollback: public.users_email_lower_uq still exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public' AND cl.relname = 'users' AND con.contype = 'u' AND pg_get_constraintdef(con.oid) = 'UNIQUE (email)'
  ) THEN
    RAISE EXCEPTION 'PO-02D3 E-1 rollback: the case-sensitive UNIQUE (email) constraint is missing — investigate before continuing';
  END IF;
END $post$;
