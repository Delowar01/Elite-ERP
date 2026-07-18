-- Stage 11 Part 9 — enforce append-only audit at the database level.
-- Run this once after `npm run db:push` in production:
--     psql "$DATABASE_URL" -f drizzle/immutable_audit.sql
-- It rejects any UPDATE or DELETE on the audit tables, so even a compromised
-- application account (or an operator with app-DB creds) cannot rewrite history.

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

DROP TRIGGER IF EXISTS security_events_immutable ON security_events;
CREATE TRIGGER security_events_immutable
  BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
