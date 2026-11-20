-- =============================================================================================
-- Platform Owner — PO-03C (sub-batch C) — rollback of the customer-user invitation foundation: removes
-- user_invitations, its two triggers and user_invitation_guard() — and nothing else.
--
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION (PO03C_user_invitations.sql itself is a proposal; decisions D-6
-- and D-7 are open). PO-03C runs it ONLY on loopback disposable `*_test_only_*` databases.
--
-- EXACT PROCEDURE (one way only):
--   0. Roll the APPLICATION back first, or switch PLATFORM_USER_INVITATIONS_ENABLED off: no running release
--      may write the table (with the table absent, the console's invitation pages report "not installed"
--      and seat accounting counts no reservation — both fail closed).
--   1. This file — ONE transaction: the table (its triggers go with it), then the function (refused by
--      PostgreSQL while a trigger still uses it: no CASCADE anywhere).
--
-- LOCKING (measured): dropping the table removes its foreign keys' triggers on orgs, users and
-- platform_admins, so this file holds ACCESS EXCLUSIVE on those three tables until COMMIT (milliseconds on a
-- disposable database; every read of them waits meanwhile). lock_timeout 5 s bounds each wait; a timeout
-- rolls the whole file back (nothing dropped, no audit record added).
--
-- DATA GUARD: refuses, changing nothing, while user_invitations holds ANY row (open, expired, revoked or
-- accepted): those rows are the subject of platform audit records, and a data-bearing rollback needs its own
-- owner-approved, backed-up plan. It never touches a tenant row, an earlier platform object or the append-only
-- platform audit trail: one audit record of the rollback itself is ADDED (only when there is something to
-- remove); none is deleted.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.user_invitations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.user_invitations' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'PO-03C rollback refused: user_invitations holds % row(s); nothing was changed', n
        USING HINT = 'A data-bearing rollback needs its own owner-approved, backed-up plan.';
    END IF;
  END IF;
END
$guard$;

-- Evidence of the rollback itself (append-only; actor-less, like every migration-time record). Written only when a
-- PO-03C object is present, so a repeated rollback adds nothing.
INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
SELECT NULL, 'migration PO-03C rollback', 'schema.user_invitations_removed', 'schema', 'PO03C',
       jsonb_build_object('removes', 'user_invitations, two triggers, user_invitation_guard()'),
       'success'
WHERE to_regclass('public.user_invitations') IS NOT NULL OR to_regprocedure('public.user_invitation_guard()') IS NOT NULL;

DROP TABLE IF EXISTS public.user_invitations;
DROP FUNCTION IF EXISTS public.user_invitation_guard();

COMMIT;
