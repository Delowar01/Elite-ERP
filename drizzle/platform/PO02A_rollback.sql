-- =============================================================================================
-- Platform Owner — PO-02A — rollback (reviewed; NOT applied anywhere by PO-02A except tests).
--
-- Removes ONLY what PO02A_company_foundation.sql creates:
--   organization_invitations, tenant_access_controls, sessions_org_active_idx,
--   platform_audit_events_entity_idx.
-- Never touches a tenant row, a PO-01A table or the append-only audit trail's rows or triggers.
--
-- DATA GUARD: refuses, changing nothing, while either PO-02A table holds a row. Dropping recorded
-- access decisions or invitations destroys evidence and needs its own owner-approved, backed-up
-- plan; it is never part of a routine rollback.
--
-- LOCKING: DROP INDEX takes ACCESS EXCLUSIVE on `sessions` for an instant. In production, drop M4
-- first without blocking: DROP INDEX CONCURRENTLY IF EXISTS public.sessions_org_active_idx;
-- (autocommit, outside a transaction), then run this file (its DROP INDEX IF EXISTS is a no-op).
-- An application release that already reads these objects must be rolled back BEFORE this file.
-- PO-02A AUTHORIZATION: disposable `*_test_only_*` databases only. Production is decision D-6.
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.tenant_access_controls') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.tenant_access_controls' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'PO-02A rollback refused: tenant_access_controls holds % row(s); nothing was changed', n
        USING HINT = 'A data-bearing rollback needs its own owner-approved, backed-up plan.';
    END IF;
  END IF;
  IF to_regclass('public.organization_invitations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.organization_invitations' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'PO-02A rollback refused: organization_invitations holds % row(s); nothing was changed', n
        USING HINT = 'A data-bearing rollback needs its own owner-approved, backed-up plan.';
    END IF;
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.organization_invitations;
DROP TABLE IF EXISTS public.tenant_access_controls;
DROP INDEX IF EXISTS public.platform_audit_events_entity_idx;
DROP INDEX IF EXISTS public.sessions_org_active_idx;

COMMIT;
