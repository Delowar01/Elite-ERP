# Elite ERP — Stage 11 Security & Compliance Report

**Scope:** Enterprise Security, Compliance & DevSecOps hardening of Elite ERP.
**Constraint honoured:** no redesign, no business-workflow changes, backward
compatible, existing architecture/coding standards followed throughout.
**Standards referenced:** OWASP ASVS, OWASP Top-10 (2021), ISO/IEC 27001:2022
Annex A, SOC 2 Trust Services Criteria.

This single report consolidates the Stage 11 deliverables. Each section is a
deliverable; where a control has its own runbook it is cross-referenced.

---

## 1. Authentication & MFA

- **TOTP MFA** (RFC 6238, dependency-free — `lib/security/totp.ts`): enrolment
  via QR + manual secret, verification with ±1 step drift, constant-time
  comparison. **Single-use recovery codes** (10, bcrypt-hashed, stored
  field-encrypted).
- **MFA challenge on login** (`app/(auth)/actions.ts`): after password success,
  an MFA-enabled user must supply a valid TOTP or recovery code before a session
  is issued. Failures are recorded (`mfa.failed`).
- **MFA can be mandatory** for privileged roles per-org
  (`orgs.mfa_required_for_privileged`); disable is blocked for owner/admin when set.
- Enabling/disabling MFA invalidates other sessions.
- **Verification:** `scratchpad/verify_stage11_mfa.js` — 20/20 (enrol, persist,
  wrong-code rejection, recovery-code consumption, event logging, login gating).

## 2. Session management

- **Server-side session store** (`lib/security/session-store.ts`): each JWT
  carries a `jti`; the store holds a SHA-256 of it. Revoking the row invalidates
  the token immediately, independent of JWT expiry.
- Active-session listing (device/OS/browser/IP), per-session termination,
  "log out all other devices", and **auto-invalidation** on password/MFA change.
- **Backward compatible:** legacy JWTs without a `jti` still validate.

## 3. Password policy

- `lib/security/password-policy.ts`: configurable per-org (length, character
  classes, history depth, expiry), common-password rejection (leet-normalised),
  strength scoring.
- Enforced on registration and change; **reuse blocked** against bcrypt history
  (`password_history`). Password change revokes other sessions.

## 4. Field-level encryption

- `lib/crypto/field-encryption.ts`: **AES-256-GCM**, server-side only, keys from
  `FIELD_ENCRYPTION_KEYS` (never hardcoded). Envelope `v<ver>:<iv>:<tag>:<ct>`
  supports **key rotation** — new writes use the newest version, old envelopes
  decrypt under their pinned version. Legacy plaintext passes through, so
  adoption is incremental.
- Applied to the MFA secret and recovery codes; the same helper wraps any future
  sensitive field (bank/IBAN/salary/national-id).
- **Verification:** `tests/security/crypto-policy.test.mjs` — round-trip,
  rotation, tamper-rejection (GCM auth tag), no-plaintext-leak.

## 5. Signed file access & download auditing

- `lib/security/signed-url.ts`: HMAC-SHA256, time-boxed capability tokens for
  session-less file access; constant-time verify; expiry enforced.
- `/uploads/[folder]/[file]` serves a file only to (a) a session whose org
  matches the filename's org prefix, or (b) a valid signature. Unsigned,
  session-less URLs are **404 (non-enumerable)**. Every serve is written to the
  append-only `file_access_logs`.
- **Verification:** `scratchpad/verify_stage11_files.js` — 9/9 (auth serve +
  audit row, session-less 404, signed 200, tampered/expired 404).

## 6. Security Operations Center

- `/settings/security` (`Security Center`): risk pill, threat alerts, attack
  stats, MFA + password + session management. Admins see the org-wide
  `security_events` timeline.
- **Threat detection** (`lib/security/threat-detection.ts`): brute-force,
  account-enumeration, MFA-bypass, and rate-limit heuristics over the event feed;
  aggregate risk level.

## 7. Compliance Center

- `/settings/compliance` (owner/admin): GDPR/ISO 27001/SOC 2 posture cards
  mapping frameworks to shipped controls (see §12).
- **GDPR Art. 20** data export (downloadable JSON, secrets excluded).
- **GDPR Art. 17** erasure — customer anonymisation that scrubs PII while
  retaining financial-document references (Art. 17(3)(b) legal-obligation
  carve-out).
- Consent records (`consent_records`) with audit trail.
- **Verification:** `scratchpad/verify_stage11_compliance.js` — 9/9.

## 8. DevSecOps CI/CD

- `.github/workflows/devsecops.yml`: static analysis (`tsc`, `eslint
  --max-warnings=0`), dependency scan (`npm audit` high), secret scan
  (`gitleaks`), and a committed security test suite (`crypto-policy` +
  `access-control`) plus a production build against a Postgres service.

## 9. Infrastructure security

- Runbook: `docs/security/infrastructure.md` — secrets management + key
  rotation, least-privilege DB role, immutable-audit triggers, TLS, reverse-proxy
  and host hardening, pre-go-live checklist.

## 10. Backup & disaster recovery

- Runbook: `docs/security/backup-dr.md`; scripts `scripts/backup.sh` (verified,
  valid 54-table dump) and `scripts/restore.sh` (re-applies immutable-audit
  triggers). RPO/RTO targets, drills, failure scenarios, and the
  encryption-key-preservation caveat documented.

## 11. Immutable audit logging & threat detection

- `lib/security/audit.ts`: **insert-only** helpers for `audit_logs` and
  `security_events` — no update/delete anywhere. `drizzle/immutable_audit.sql`
  installs `BEFORE UPDATE OR DELETE` triggers that reject mutation at the DB
  level, so the trail is append-only even if the app role is compromised.
- **Verification:** the MFA E2E confirms the DB trigger blocks `UPDATE
  security_events` at runtime.

## 12. API / access-control security review

Elite ERP exposes its mutating surface through **Server Actions**, not a public
REST API; every action is a server entry point subject to the same review.

- **Authorization:** every mutating action calls `requireSession`/`requireRole`.
- **Tenant isolation:** `tenantScope(orgId, table)` is the only legal way to
  query tenant data; enforced on reads and writes, cross-org detail access
  returns `notFound()`.
- **Injection:** all queries are parameterised via Drizzle; a SQL-style payload
  is stored literally.
- **Transport/session:** `__Host-` cookie, `HttpOnly` + `Secure` + `SameSite`;
  HSTS/CSP/`X-Frame-Options`/`nosniff` headers; login rate limiting.
- **Verification:**
  - `tests/security/access-control.test.mjs` — 16/16 static invariants (every
    mutating action gated, tenantScope usage, signed-URL/HMAC, upload gating,
    no committed secrets/insecure fallbacks).
  - `scratchpad/verify_stage11_isolation.js` — 9/9 runtime (cross-org 404,
    unauth redirect, injection stored literally, HttpOnly/SameSite cookie,
    security headers, upload namespace isolation).

### OWASP Top-10 (2021) coverage

| Risk | Control |
|---|---|
| A01 Broken Access Control | `requireSession/Role` on every action; `tenantScope`; cross-org 404; signed/scoped file access |
| A02 Cryptographic Failures | AES-256-GCM field encryption + rotation; bcrypt passwords; HMAC signed URLs; `__Host-` Secure cookie |
| A03 Injection | Parameterised Drizzle queries end-to-end |
| A04 Insecure Design | Two-step create/post workflow, immutable audit, least-privilege roles |
| A05 Security Misconfiguration | CSP/HSTS/frame/nosniff headers; AUTH_SECRET fail-fast; SVG upload removed |
| A06 Vulnerable Components | `npm audit` (high) in CI |
| A07 Auth Failures | MFA, password policy, rate limiting, server-side revocable sessions |
| A08 Integrity Failures | gitleaks + committed security tests in CI; transactional ledger posting |
| A09 Logging/Monitoring Failures | Immutable `audit_logs` + `security_events`; threat detection; download auditing |
| A10 SSRF | No server-side fetch of user-supplied URLs |

### ISO 27001 Annex A / SOC 2 mapping

Surfaced live in the Compliance Center posture cards: A.9 (RBAC+MFA), A.10
(field encryption + rotation), A.12.4 (immutable audit), A.16 (threat feed);
SOC 2 Security (signed URLs, headers, rate limiting), Confidentiality (tenant
isolation), Availability (backup/DR), Processing Integrity (transactional posting).

---

## Verification summary

| Suite | Result |
|---|---|
| MFA + sessions + Security Center (E2E) | 20/20 |
| Signed file access + audit (E2E) | 9/9 |
| Compliance Center (E2E) | 9/9 |
| Tenant isolation + OWASP (E2E) | 9/9 |
| Crypto/policy (committed, CI) | 18/18 |
| Access-control static review (committed, CI) | 16/16 |
| Regression: Section 3 sales chain / Section 10 security | 24/24 / 11/11 |
| `tsc` / `eslint --max-warnings=0` / production build | clean |

No regressions were introduced; all existing workflows continue to pass.
