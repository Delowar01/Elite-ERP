-- PO-00 — FICTIONAL fixtures for a DISPOSABLE TEST-ONLY database (po00_test_only_pushshape).
-- Never run against production. All names/emails are invented (.test TLD).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO orgs (id, name) VALUES
  (9001, 'Fixture Org A — single active owner'),
  (9002, 'Fixture Org B — no owner (admin only)'),
  (9003, 'Fixture Org C — two active owners'),
  (9004, 'Fixture Org D — only an inactive owner'),
  (9005, 'Fixture Org E — one active + one inactive owner'),
  (9006, 'Fixture Org F — no users at all');
INSERT INTO users (id, org_id, email, password_hash, name, role, is_active) VALUES
  (9101, 9001, 'owner.a@fixture.test',   'x', 'Owner A',   'owner', true),
  (9102, 9001, 'admin.a@fixture.test',   'x', 'Admin A',   'admin', true),
  (9103, 9001, 'staff.a@fixture.test',   'x', 'Staff A',   'staff', false),
  (9201, 9002, 'admin.b@fixture.test',   'x', 'Admin B',   'admin', true),
  (9301, 9003, 'owner1.c@fixture.test',  'x', 'Owner C1',  'owner', true),
  (9302, 9003, 'owner2.c@fixture.test',  'x', 'Owner C2',  'owner', true),
  (9401, 9004, 'owner.d@fixture.test',   'x', 'Owner D',   'owner', false),
  (9402, 9004, 'admin.d@fixture.test',   'x', 'Admin D',   'admin', true),
  (9501, 9005, 'owner1.e@fixture.test',  'x', 'Owner E1',  'owner', true),
  (9502, 9005, 'owner2.e@fixture.test',  'x', 'Owner E2',  'owner', false),
  -- case-variant duplicate e-mail across orgs: allowed by the case-sensitive users_email_unique
  (9104, 9001, 'Dup.Case@Fixture.test',  'x', 'Dup Upper', 'staff', true),
  (9303, 9003, 'dup.case@fixture.test',  'x', 'Dup Lower', 'staff', true),
  -- a role value outside owner|admin|staff (users.role is free text, no CHECK)
  (9105, 9001, 'odd.role@fixture.test',  'x', 'Odd Role',  'Owner', true);
INSERT INTO sessions (org_id, user_id, token_hash, expires_at, revoked_at) VALUES
  (9001, 9101, 'fixture-hash-1', now() + interval '20 days', NULL),
  (9001, 9102, 'fixture-hash-2', now() + interval '20 days', NULL),
  (9001, 9102, 'fixture-hash-3', now() - interval '1 day',  NULL),   -- expired, never revoked
  (9003, 9301, 'fixture-hash-4', now() + interval '20 days', now()), -- revoked
  (9002, 9101, 'fixture-hash-5', now() + interval '20 days', NULL);  -- org/user mismatch anomaly
INSERT INTO security_events (org_id, user_id, email, type, severity) VALUES
  (9006, NULL, NULL, 'fixture.event', 'info');
COMMIT;
