-- =============================================================================================
-- PO-02D0 — FICTIONAL fixtures for the legacy onboarding audit (02_legacy_onboarding_audit_readonly.sql).
-- For a DISPOSABLE loopback database whose name contains `_test_only_` ONLY. Never run against
-- production or any shared database. Every name and e-mail is invented (.test TLD); ids use the
-- 9100–9299 range; the platform operator is inactive and its password hash is a format placeholder.
--
-- Works on both shapes the audit must handle:
--   * the branch schema (PO-01A + PO-02A objects present)  → tenant AND platform fixtures;
--   * the production-like tenant shape (no platform tables) → tenant fixtures only.
-- =============================================================================================
\set ON_ERROR_STOP on
SELECT current_database() LIKE '%\_test\_only\_%' AS is_disposable \gset
\if :is_disposable
\else
  \echo 'REFUSED: fixtures may only be loaded into a *_test_only_* database'
  \quit
\endif
SELECT to_regclass('public.platform_admins') IS NOT NULL AS has_platform,
       to_regclass('public.tenant_access_controls') IS NOT NULL AS has_tac,
       to_regclass('public.organization_invitations') IS NOT NULL AS has_inv \gset

BEGIN;

-- Organizations, one per anomaly class (PO-00 §F.5 classes A–F, plus the cases PO-02D adds).
INSERT INTO orgs (id, name) VALUES
  (9101, 'Fixture A — single active owner (registered)'),
  (9102, 'Fixture B — active owner + disabled owner (registered)'),
  (9103, 'Fixture C — two active owners (registered)'),
  (9104, 'Fixture D — only a disabled owner'),
  (9105, 'Fixture E — no users'),
  (9106, 'Fixture F — admin only, no owner role'),
  (9107, 'Fixture G — non-canonical role value'),
  (9108, 'Fixture H — explicit active access row'),
  (9109, 'Fixture I — suspended access row'),
  (9110, 'Fixture J — session org mismatch');

INSERT INTO users (id, org_id, email, password_hash, name, role, is_active, mfa_enabled) VALUES
  (9201, 9101, 'owner.a@fixture.test',  'x', 'Owner A',   'owner', true,  true),
  (9202, 9101, 'staff.a@fixture.test',  'x', 'Staff A',   'staff', true,  false),
  (9203, 9102, 'owner1.b@fixture.test', 'x', 'Owner B1',  'owner', true,  false),
  (9204, 9102, 'owner2.b@fixture.test', 'x', 'Owner B2',  'owner', false, false),
  (9205, 9103, 'owner1.c@fixture.test', 'x', 'Owner C1',  'owner', true,  false),
  (9206, 9103, 'owner2.c@fixture.test', 'x', 'Owner C2',  'owner', true,  false),
  (9207, 9104, 'owner.d@fixture.test',  'x', 'Owner D',   'owner', false, false),
  (9208, 9104, 'admin.d@fixture.test',  'x', 'Admin D',   'admin', true,  false),
  (9209, 9106, 'admin.f@fixture.test',  'x', 'Admin F',   'admin', true,  false),
  (9210, 9107, 'odd.g@fixture.test',    'x', 'Odd G',     'Owner', true,  false),
  (9211, 9108, 'owner.h@fixture.test',  'x', 'Owner H',   'owner', true,  false),
  (9212, 9109, 'owner.i@fixture.test',  'x', 'Owner I',   'owner', true,  false),
  (9213, 9110, 'owner.j@fixture.test',  'x', 'Owner J',   'owner', true,  false),
  -- a case-variant e-mail pair across two companies (allowed by the case-sensitive users_email_unique)
  (9214, 9101, 'Dup.Case@fixture.test', 'x', 'Dup Upper', 'staff', true,  false),
  (9215, 9103, 'dup.case@fixture.test', 'x', 'Dup Lower', 'staff', true,  false);

INSERT INTO sessions (org_id, user_id, token_hash, expires_at, revoked_at) VALUES
  (9101, 9201, 'fixture-hash-d0-1', now() + interval '20 days', NULL),
  (9101, 9202, 'fixture-hash-d0-2', now() - interval '1 day',  NULL),   -- expired, never revoked
  (9103, 9205, 'fixture-hash-d0-3', now() + interval '20 days', now()), -- revoked
  (9110, 9201, 'fixture-hash-d0-4', now() + interval '20 days', NULL);  -- org/user mismatch

-- Registration provenance as the live /register writes it (recordAudit 'org.registered' and the
-- owner's 'account.created' security event); 9104–9110 have none (seeded/imported/unknown).
INSERT INTO audit_logs (org_id, user_id, user_name, action, entity_type, entity_id, new_value) VALUES
  (9101, 9201, 'Owner A',  'org.registered', 'org', 9101, '{"orgName":"Fixture A"}'),
  (9102, 9203, 'Owner B1', 'org.registered', 'org', 9102, '{"orgName":"Fixture B"}'),
  (9103, 9205, 'Owner C1', 'org.registered', 'org', 9103, '{"orgName":"Fixture C"}'),
  (9103, 9201, 'Owner A',  'fixture.mismatch', 'org', 9103, NULL);        -- user of 9101 on 9103's trail
INSERT INTO security_events (org_id, user_id, email, type, severity, detail) VALUES
  (9101, 9201, 'owner.a@fixture.test',  'account.created', 'info', 'organization owner'),
  (9102, 9201, 'owner.a@fixture.test',  'fixture.mismatch', 'info', NULL); -- user of 9101 on 9102's feed

\if :has_platform
INSERT INTO platform_admins (id, email_normalized, display_name, password_hash, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000d0001', 'operator@fixture.test', 'Fixture Operator',
   '$2b$12$' || repeat('a', 53), false);
\endif

\if :has_tac
INSERT INTO tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) VALUES
  (9108, 'active',    'Fixture: explicit active row', 'aaaaaaaa-0000-4000-8000-0000000d0001', now()),
  (9109, 'suspended', 'Fixture: suspended company',   'aaaaaaaa-0000-4000-8000-0000000d0001', now());
\endif

\if :has_inv
-- token_hash values are fixed 64-hex placeholders, not hashes of any real token. Distinct id prefixes give
-- distinct INV-XXXXXXXX display references (PO-02B shows only the first 8 hex digits of the id).
INSERT INTO organization_invitations
  (id, company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash,
   created_at, expires_at, accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id) VALUES
  ('b0d00001-0000-4000-8000-000000000001', 'Fixture New Co',     'hello@new.fixture.test',  'Saudi Arabia', 'SAR', 'New Owner',  'new.owner@fixture.test',
   repeat('1', 64), now() - interval '1 hour', now() + interval '47 hours', NULL, NULL, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- owner e-mail already belongs to a customer user (exact match)
  ('b0d00002-0000-4000-8000-000000000002', 'Fixture Clash Co',   'hello@clash.fixture.test', 'Saudi Arabia', 'SAR', 'Clash Owner', 'owner.a@fixture.test',
   repeat('2', 64), now() - interval '1 hour', now() + interval '47 hours', NULL, NULL, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- owner e-mail matches two existing users case-insensitively
  ('b0d00003-0000-4000-8000-000000000003', 'Fixture Case Co',    'hello@case.fixture.test',  'Saudi Arabia', 'SAR', 'Case Owner',  'dup.case@fixture.test',
   repeat('3', 64), now() - interval '1 hour', now() + interval '47 hours', NULL, NULL, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- expired but never revoked: still holds its owner-email slot
  ('b0d00004-0000-4000-8000-000000000004', 'Fixture Late Co',    'hello@late.fixture.test',  'Saudi Arabia', 'SAR', 'Late Owner',  'late.owner@fixture.test',
   repeat('4', 64), now() - interval '5 days', now() - interval '2 days', NULL, NULL, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- revoked: holds no slot
  ('b0d00005-0000-4000-8000-000000000005', 'Fixture Gone Co',    'hello@gone.fixture.test',  'Saudi Arabia', 'SAR', 'Gone Owner',  'gone.owner@fixture.test',
   repeat('5', 64), now() - interval '3 days', now() + interval '1 day', NULL, NULL, now() - interval '2 days', 'aaaaaaaa-0000-4000-8000-0000000d0001', 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- company name equal to an existing organization (case/space-insensitively)
  ('b0d00006-0000-4000-8000-000000000006', 'fixture a — single active owner (registered)', 'hello@twin.fixture.test', 'Saudi Arabia', 'SAR', 'Twin Owner', 'twin.owner@fixture.test',
   repeat('6', 64), now() - interval '1 hour', now() + interval '47 hours', NULL, NULL, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001'),
  -- accepted (as PO-02D3 would leave it), pointing at 9108
  ('b0d00007-0000-4000-8000-000000000007', 'Fixture Accepted Co', 'hello@done.fixture.test', 'Saudi Arabia', 'SAR', 'Owner H',    'owner.h@fixture.test',
   repeat('7', 64), now() - interval '2 days', now() + interval '1 day', now() - interval '1 day', 9108, NULL, NULL, 'aaaaaaaa-0000-4000-8000-0000000d0001');
\endif

COMMIT;
\echo 'fixtures loaded'
