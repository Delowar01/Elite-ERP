-- =============================================================================================
-- Platform Owner — PO-01A — platform identity foundation (reviewed, hand-written, idempotent)
--
-- Creates ONLY platform-owned objects:
--   platform_admins, platform_sessions, platform_login_attempts, platform_audit_events,
--   function platform_reject_mutation(), and the append-only triggers on platform_audit_events.
-- It alters no existing table. Its only reference into tenant data is the nullable
-- platform_audit_events.org_id -> orgs(id) ON DELETE RESTRICT (PR #11 Schema.md §3.4).
--
-- Source of truth for tables/columns/constraints/indexes: src/db/schema/platform.ts. This file
-- must stay catalog-equivalent to it; `npm run verify:platform-schema` proves that on disposable
-- databases. The triggers exist only here, because `drizzle-kit push` cannot create them.
--
-- This file is deliberately OUTSIDE the drizzle-kit journal (drizzle/meta/_journal.json):
-- the committed historical migrations are incomplete relative to the live schema (PO-00 §F.2),
-- so `drizzle-kit generate` / `migrate` must not be used for these objects.
--
-- PO-01A AUTHORIZATION: apply only to loopback-hosted, disposable `*_test_only_*` databases via
-- `npm run platform:db:apply`, which fails closed on any other target. Applying it to production
-- is a separate, owner-authorized decision (PO-00 decision D-6).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION/TRIGGER.
-- Requires PostgreSQL >= 14 (CREATE OR REPLACE TRIGGER; gen_random_uuid() is built in since 13).
-- =============================================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------
-- platform_admins (Schema.md §3.1) — separate operator identity; no org_id, no tenant role.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_admins (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  email_normalized     text        NOT NULL,
  display_name         text        NOT NULL,
  password_hash        text        NOT NULL,
  is_active            boolean     NOT NULL DEFAULT true,
  mfa_secret_encrypted text,
  mfa_recovery_hashes  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  mfa_enrolled_at      timestamptz,
  mfa_last_totp_step   bigint,
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_pkey PRIMARY KEY (id),
  CONSTRAINT platform_admins_email_chk CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND length(email_normalized) <= 320
    AND email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ),
  CONSTRAINT platform_admins_display_name_chk CHECK (length(btrim(display_name)) >= 1 AND length(display_name) <= 200),
  -- bcrypt only: plaintext (or any other) password storage is impossible.
  CONSTRAINT platform_admins_password_hash_chk CHECK (password_hash ~ '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$'),
  -- field-encryption envelope v<ver>:<iv>:<tag>:<ciphertext>; a plaintext base32 seed cannot match.
  CONSTRAINT platform_admins_mfa_secret_chk CHECK (
    mfa_secret_encrypted IS NULL
    OR mfa_secret_encrypted ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'
  ),
  CONSTRAINT platform_admins_recovery_hashes_chk CHECK (
    jsonb_typeof(mfa_recovery_hashes) = 'array' AND jsonb_array_length(mfa_recovery_hashes) <= 16
  ),
  -- Mandatory MFA: an active operator must have an enrolled, encrypted TOTP secret.
  CONSTRAINT platform_admins_active_requires_mfa_chk CHECK (
    NOT is_active OR (mfa_secret_encrypted IS NOT NULL AND mfa_enrolled_at IS NOT NULL)
  ),
  CONSTRAINT platform_admins_totp_step_chk CHECK (mfa_last_totp_step IS NULL OR mfa_last_totp_step >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_email_lower_uq ON platform_admins USING btree (lower(email_normalized));
CREATE INDEX IF NOT EXISTS platform_admins_active_idx ON platform_admins USING btree (is_active) WHERE is_active;

-- ---------------------------------------------------------------------------------------------
-- platform_sessions (Schema.md §3.2) — revocable sessions; only SHA-256(jti) is stored.
-- A row exists only after MFA succeeded (mfa_verified_at NOT NULL). 12 h absolute ceiling
-- (provisional, PO-00 D-9).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_sessions (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  platform_admin_id uuid        NOT NULL,
  token_hash        text        NOT NULL,
  mfa_verified_at   timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_reason    text,
  ip_address        text,
  user_agent        text,
  CONSTRAINT platform_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT platform_sessions_admin_fk FOREIGN KEY (platform_admin_id) REFERENCES platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT platform_sessions_token_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT platform_sessions_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours'),
  CONSTRAINT platform_sessions_last_seen_chk CHECK (last_seen_at >= created_at),
  CONSTRAINT platform_sessions_mfa_chk CHECK (mfa_verified_at <= last_seen_at),
  CONSTRAINT platform_sessions_revocation_chk CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      -- explicit: `NULL IN (...)` is NULL, which a CHECK would accept
      AND revoked_reason IS NOT NULL
      AND revoked_reason IN ('logout', 'logout_all', 'revoked', 'idle_timeout', 'expired', 'password_change', 'mfa_change', 'admin_disabled')
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_sessions_token_hash_uq ON platform_sessions USING btree (token_hash);
CREATE INDEX IF NOT EXISTS platform_sessions_admin_state_idx ON platform_sessions USING btree (platform_admin_id, revoked_at, expires_at);

-- ---------------------------------------------------------------------------------------------
-- platform_login_attempts (Schema.md §3.3) — durable throttling; e-mail/IP as keyed HMAC only.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_login_attempts (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  email_hash    text,
  ip_hash       text,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  outcome       text        NOT NULL,
  blocked_until timestamptz,
  CONSTRAINT platform_login_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT platform_login_attempts_outcome_chk CHECK (outcome IN ('success', 'failure', 'blocked', 'mfa_required')),
  CONSTRAINT platform_login_attempts_email_hash_chk CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT platform_login_attempts_ip_hash_chk CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT platform_login_attempts_blocked_chk CHECK (blocked_until IS NULL OR blocked_until > attempted_at)
);
CREATE INDEX IF NOT EXISTS platform_login_attempts_email_idx ON platform_login_attempts USING btree (email_hash, attempted_at);
CREATE INDEX IF NOT EXISTS platform_login_attempts_ip_idx ON platform_login_attempts USING btree (ip_hash, attempted_at);

-- ---------------------------------------------------------------------------------------------
-- platform_audit_events (Schema.md §3.4) — append-only operator audit.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_events (
  id                      bigserial   NOT NULL,
  actor_platform_admin_id uuid,
  actor_label             text        NOT NULL,
  action                  text        NOT NULL,
  entity_type             text        NOT NULL,
  entity_id               text        NOT NULL,
  org_id                  integer,
  reason                  text,
  before_safe             jsonb,
  after_safe              jsonb,
  result                  text        NOT NULL,
  request_id              uuid,
  ip_address              text,
  user_agent              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT platform_audit_events_actor_fk FOREIGN KEY (actor_platform_admin_id) REFERENCES platform_admins (id) ON DELETE RESTRICT,
  CONSTRAINT platform_audit_events_org_fk FOREIGN KEY (org_id) REFERENCES orgs (id) ON DELETE RESTRICT,
  CONSTRAINT platform_audit_events_action_chk CHECK (action ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  CONSTRAINT platform_audit_events_result_chk CHECK (result IN ('success', 'rejected', 'failed')),
  CONSTRAINT platform_audit_events_entity_chk CHECK (
    length(btrim(entity_type)) >= 1 AND length(btrim(entity_id)) >= 1 AND length(btrim(actor_label)) >= 1
  ),
  CONSTRAINT platform_audit_events_snapshot_chk CHECK (
    (before_safe IS NULL OR jsonb_typeof(before_safe) = 'object')
    AND (after_safe IS NULL OR jsonb_typeof(after_safe) = 'object')
  )
);
CREATE INDEX IF NOT EXISTS platform_audit_events_org_idx ON platform_audit_events USING btree (org_id, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS platform_audit_events_actor_idx ON platform_audit_events USING btree (actor_platform_admin_id, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS platform_audit_events_action_idx ON platform_audit_events USING btree (action, created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS platform_audit_events_request_idx ON platform_audit_events USING btree (request_id);

-- ---------------------------------------------------------------------------------------------
-- Append-only enforcement. A platform-owned function (not the tenant reject_mutation(), which is
-- installed separately by `npm run db:harden`) keeps this file self-contained and leaves the tenant
-- hardening untouched. Row triggers block UPDATE/DELETE; a statement trigger blocks TRUNCATE.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE OR REPLACE TRIGGER platform_audit_events_immutable
  BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION platform_reject_mutation();

CREATE OR REPLACE TRIGGER platform_audit_events_no_truncate
  BEFORE TRUNCATE ON platform_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_reject_mutation();

COMMIT;
