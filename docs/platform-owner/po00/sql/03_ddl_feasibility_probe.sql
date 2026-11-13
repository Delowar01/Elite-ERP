-- PO-00 — DDL FEASIBILITY PROBE (disposable TEST database only; NOT a migration; never committed).
-- Everything runs inside one transaction that is ROLLED BACK at the end.
-- Each probe prints PASS/FAIL via RAISE NOTICE.
\set ON_ERROR_STOP on
BEGIN;

-- P1 composite FK target: users(org_id, id) must be UNIQUE for tenant_primary_owners' (org_id,user_id) FK
ALTER TABLE users ADD CONSTRAINT po00_users_org_id_id_uq UNIQUE (org_id, id);
DO $$ BEGIN RAISE NOTICE 'P1 PASS users(org_id,id) unique constraint can be added on the push shape'; END $$;

-- P2 primary owner must belong to the same org (composite FK)
CREATE TABLE po00_tenant_primary_owners (
  org_id  integer PRIMARY KEY REFERENCES orgs(id) ON DELETE RESTRICT,
  user_id integer NOT NULL,
  FOREIGN KEY (org_id, user_id) REFERENCES users(org_id, id) ON DELETE RESTRICT
);
INSERT INTO po00_tenant_primary_owners VALUES (9001, 9101);
DO $$ BEGIN
  BEGIN
    INSERT INTO po00_tenant_primary_owners VALUES (9002, 9101); -- user of org 9001 as owner of 9002
    RAISE NOTICE 'P2 FAIL cross-org primary owner was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'P2 PASS cross-org primary owner rejected (foreign_key_violation)';
  END;
END $$;

-- P3 one current subscription per org (partial unique index)
CREATE TABLE po00_tenant_subscriptions (
  id serial PRIMARY KEY,
  org_id integer NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  starts_on date NOT NULL, ends_on date NOT NULL CHECK (ends_on >= starts_on),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX po00_tenant_subscriptions_current_uq ON po00_tenant_subscriptions (org_id) WHERE superseded_at IS NULL;
INSERT INTO po00_tenant_subscriptions (org_id, starts_on, ends_on) VALUES (9001, '2026-11-01', '2026-11-30');
DO $$ BEGIN
  BEGIN
    INSERT INTO po00_tenant_subscriptions (org_id, starts_on, ends_on) VALUES (9001, '2026-12-01', '2026-12-31');
    RAISE NOTICE 'P3 FAIL second current subscription accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'P3 PASS second current subscription rejected (unique_violation)';
  END;
END $$;

-- P4 manual SAR payments: idempotent request_id, case-insensitive receipt reference, positive numeric(14,2)
CREATE TABLE po00_subscription_payments (
  id serial PRIMARY KEY,
  org_id integer NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  entry_type text NOT NULL CHECK (entry_type IN ('receipt','reversal')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  external_reference text
);
CREATE UNIQUE INDEX po00_subscription_payments_ref_uq ON po00_subscription_payments (org_id, lower(external_reference)) WHERE entry_type = 'receipt';
INSERT INTO po00_subscription_payments (org_id, request_id, entry_type, amount, external_reference)
VALUES (9001, '00000000-0000-4000-8000-000000000001', 'receipt', 149.00, 'BANK-REF-001');
DO $$ BEGIN
  BEGIN
    INSERT INTO po00_subscription_payments (org_id, request_id, entry_type, amount, external_reference)
    VALUES (9001, '00000000-0000-4000-8000-000000000002', 'receipt', 149.00, 'bank-ref-001');
    RAISE NOTICE 'P4a FAIL case-variant duplicate receipt reference accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'P4a PASS case-variant duplicate receipt reference rejected';
  END;
  BEGIN
    INSERT INTO po00_subscription_payments (org_id, request_id, entry_type, amount, external_reference)
    VALUES (9001, '00000000-0000-4000-8000-000000000001', 'receipt', 149.00, 'BANK-REF-002');
    RAISE NOTICE 'P4b FAIL replayed request_id accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'P4b PASS replayed request_id rejected (idempotency key)';
  END;
  BEGIN
    INSERT INTO po00_subscription_payments (org_id, request_id, entry_type, amount, currency)
    VALUES (9001, '00000000-0000-4000-8000-000000000003', 'receipt', 10.00, 'USD');
    RAISE NOTICE 'P4c FAIL non-SAR currency accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P4c PASS non-SAR currency rejected';
  END;
END $$;

-- P5 platform audit table reuses the existing reject_mutation() trigger function
CREATE TABLE po00_platform_audit_events (id bigserial PRIMARY KEY, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER po00_platform_audit_events_immutable BEFORE UPDATE OR DELETE ON po00_platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
INSERT INTO po00_platform_audit_events (action) VALUES ('fixture.created');
DO $$ BEGIN
  BEGIN
    UPDATE po00_platform_audit_events SET action = 'tampered';
    RAISE NOTICE 'P5a FAIL platform audit UPDATE accepted';
  EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'P5a PASS platform audit UPDATE rejected by reject_mutation()';
  END;
  BEGIN
    DELETE FROM po00_platform_audit_events;
    RAISE NOTICE 'P5b FAIL platform audit DELETE accepted';
  EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'P5b PASS platform audit DELETE rejected by reject_mutation()';
  END;
END $$;

-- P6 hard delete of an org that has security_events is impossible (cascade DELETE hits the append-only trigger)
DO $$ BEGIN
  BEGIN
    DELETE FROM orgs WHERE id = 9006;
    RAISE NOTICE 'P6 FAIL org with security events was deleted';
  EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'P6 PASS org delete blocked by security_events_immutable (consistent with no-delete policy)';
  END;
END $$;

-- P7 case-insensitive unique e-mail cannot be added while case-variant duplicates exist (legacy pre-check needed)
DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX po00_users_email_lower_uq ON users (lower(email));
    RAISE NOTICE 'P7 FAIL lower(email) unique index created despite duplicates';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'P7 PASS lower(email) unique index refused while case-variant duplicates exist';
  END;
END $$;

-- P8 org-wide session revoke works as one statement; without an org index it is a sequential scan
UPDATE sessions SET revoked_at = now(), revoked_reason = 'org_suspended' WHERE org_id = 9001 AND revoked_at IS NULL;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM sessions WHERE org_id = 9001 AND revoked_at IS NULL;
  IF n = 0 THEN RAISE NOTICE 'P8 PASS org-wide revoke left 0 unrevoked sessions for org 9001';
  ELSE RAISE NOTICE 'P8 FAIL % unrevoked sessions remain', n; END IF;
END $$;
SET LOCAL enable_seqscan = on;
EXPLAIN (COSTS OFF) UPDATE sessions SET revoked_at = now() WHERE org_id = 9001 AND revoked_at IS NULL;
CREATE INDEX po00_sessions_org_live_idx ON sessions (org_id) WHERE revoked_at IS NULL;
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF) UPDATE sessions SET revoked_at = now() WHERE org_id = 9001 AND revoked_at IS NULL;

ROLLBACK;
\echo 'probe transaction rolled back'
