# PO-06 — Security and feature-flag matrix for the first test-only staging deployment

**Status:** a plan. No switch was turned on anywhere outside disposable test processes in PO-06. Production keeps every
switch unset, and so does a freshly deployed staging server. Every switch below is off unless its value is exactly
`true`; `TENANT_ACCESS_ENFORCEMENT` is the exception, and is on only when it is exactly `enabled`.

## 1. The switches

| Switch | Turns on | Needs first | Local tests (development) | Staging at deployment | Staging after approval | Production | Turning it back | What stays when it is off |
|---|---|---|---|---|---|---|---|---|
| `PLATFORM_CONSOLE_ENABLED` | `/platform` sign-in, MFA, the console sections | S00–S07 installed; `PLATFORM_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`; one bootstrapped administrator | on, inside test processes only | **off** | on at step F1 (§2) | **off** (separate decision) | unset, then restart: `/platform` answers as absent; open platform sessions stop working | administrators, platform sessions (expire), the platform audit trail |
| `TENANT_ACCESS_ENFORCEMENT` (`enabled`) | customer access checks: a suspended company's users are signed out and refused | S03 (tenant_access_controls) | on in the access suites | **off** | on at F2 | **off** | unset, restart: suspensions are recorded but not enforced | access rows and their audit records |
| `PLATFORM_INVITATIONS_ENABLED` | company invitations (create, revoke, re-issue, one-time link) | the console; the Trial seed (S07); `CUSTOMER_PUBLIC_ORIGIN` | on in the invitation suites | **off** | on at F3 | **off** | unset, restart: the console shows invitations read-only | invitations (pending ones keep their e-mail slot until they expire) |
| `CUSTOMER_INVITE_ACCEPTANCE_ENABLED` | `/register/accept` (a new company with a Trial) | F3; `CUSTOMER_PUBLIC_ORIGIN` = the staging customer origin | on in the acceptance suites | **off** | on at F4 | **off** | unset, restart: the page answers "not available"; no token is read | accepted companies, their primary owner and Trial subscription |
| `PLATFORM_USER_INVITATIONS_ENABLED` | customer-user invitations | the console; **S08** (`user_invitations`, decision L-3) | on in the user-invitation suites | **off** | on at F5, only after L-3 | **off** | unset, restart: the console reports the feature off. The table stays, and its pending rows keep holding seats (L-9) | user invitations |
| `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED` | `/join/accept` | F5 | on in the acceptance suites | **off** | on at F6 | **off** | unset, restart: the page answers "not available" | accepted users |
| `CUSTOMER_SEAT_ENFORCEMENT_ENABLED` | seat limits on Team Add Member and on Platform Owner invitation, re-issue and acceptance (P-8) | a current subscription on each company; owner consent for any seat cap on active tenants | on in the seat suites | **off** | on at F7, last | **off** | unset, restart: seats are shown, not enforced | nothing (enforcement only) |
| `PLATFORM_TRUSTED_PROXY_HOPS` | trust in one or more reverse proxies for the client IP and the forwarded host | the real proxy chain | `0` or unset | `1` (nginx) | unchanged | the real chain (decision) | a wrong value is a security defect: fix it, then restart | — |
| `CUSTOMER_LEGACY_TOKENS` (`reject`) | refusal of customer tokens without a session id (D-8) | — | unset | unset | optional test (D-8) | unset (decision D-8) | unset, restart | — |

## 2. The activation order on staging (Prompt 7, after the owner's approval — never in PO-06)

Each step:
1. Change one line in `/etc/elite-erp-staging/app.env`.
2. `systemctl restart elite-erp-staging`.
3. Run the step's checks. Each must pass before the next step.
4. Record the step in the deployment log (time, operator, result — never a secret).

| Step | Change | Checks before going on |
|---|---|---|
| F0 | none: every switch off | the full customer ERP regression passes with every switch off (runbook step 19 subset); `/platform` and both acceptance pages answer as absent or unavailable |
| F1 | `PLATFORM_CONSOLE_ENABLED=true` | the bootstrapped administrator signs in with password and TOTP; a recovery code works once; a wrong code is refused and throttled; the session idles out and is revoked by sign-out; the customer ERP is unaffected |
| F2 | `TENANT_ACCESS_ENFORCEMENT=enabled` | suspend a fictional company: its open sessions end at the next request and sign-in is refused; restore it: a fresh sign-in works; other companies are unaffected |
| F3 | `PLATFORM_INVITATIONS_ENABLED=true` | create, revoke and re-issue a fictional company invitation; the link is shown once and points at `CUSTOMER_PUBLIC_ORIGIN` (staging); the audit trail records each step |
| F4 | `CUSTOMER_INVITE_ACCEPTANCE_ENABLED=true` | accept the invitation: one company, one owner, one Trial (14 days, 3 seats); a second use is refused; an expired token is refused |
| F5 | `PLATFORM_USER_INVITATIONS_ENABLED=true` (only after L-3 and S08) | invite a fictional user; the pending invitation occupies a seat; revoke and re-issue |
| F6 | `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED=true` | accept: the user is created in the right company without a second seat; a second use is refused |
| F7 | `CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true` | fill a Trial's 3 seats: the 4th user (Team add, invitation, re-issue, acceptance) is refused with nothing written; a company above its allowance keeps its users (P-3) |

**Turning back** goes in the reverse order (F7 → F1): one switch per restart, each followed by its "off" check from §1.
An emergency stop turns every switch off at once (unset them all, then one restart). The data each step left behind
stays and is listed in §1. The schema is not rolled back by turning switches off: that is the separate, guarded D-6
rollback (`D6_MIGRATION_RUNBOOK.md` §6).

## 3. Security controls the staging deployment relies on

| Threat | Control | Verified by | Staging setting |
|---|---|---|---|
| a customer session used against the console, or the reverse | separate cookies (`__Host-elite_erp_session` / `__Host-elite_erp_platform`), separate HS256 secrets, the configuration refuses equal secrets | boundary rule 4; PO-05 HTTP probe (forged sessions); `verify:platform-auth` | distinct staging secrets (`STAGING_ENV_TEMPLATE.md` §2) |
| cross-site requests | Next.js Server Action origin check plus `assertSameOrigin` (Origin = addressed host; `Sec-Fetch-Site`) | `verify:platform-proxy`, `verify:platform-console`, the acceptance suites | nginx passes `Host`; `PLATFORM_TRUSTED_PROXY_HOPS=1` |
| spoofed client IP defeating rate limits | only the configured number of trusted hops is honoured; a malformed value fails closed | `verify:platform-proxy`, the acceptance throttle suites | `1` |
| a stolen administrator password | TOTP MFA required (`platform_mfa_required` locked on), single-use recovery codes, throttled sign-in, step-up for critical actions | `verify:platform-auth`, `verify:platform-bootstrap`, PO-01B browser | — |
| audit history rewritten | append-only triggers on `audit_logs`, `security_events`, `platform_audit_events`; the runtime role cannot disable triggers | `platform:db:check`; PO-06 rehearsal §S | `<APP_ROLE>` without DDL |
| a suspended company keeps working | enforcement on every customer entry point; session revocation | `verify:platform-company-access`, containment suites | F2 |
| invitation token theft or replay | SHA-256 digest only at rest, token in the URL fragment, single use, expiry, durable rate limit | `verify:platform-invitations`, `verify:platform-invitation-acceptance`, `verify:platform-user-acceptance` | `CUSTOMER_PUBLIC_ORIGIN` = staging |
| two accounts for one e-mail address | application writers normalize; acceptance re-checks `lower(email)`; optional database index `users_email_lower_uq` | `verify:platform-email-uniqueness`, PO-06 data-safety §Q | E-1 decision (`EMAIL_LOWER_UNIQUE_PROPOSAL.md`) |
| a migration damaging customer data | the D-6 manifest: guarded target, checksums, pinned fingerprints, one transaction per file, the preflight, no unrestricted push | PO-06 rehearsal A–O | staging database `*_test_only_*` on loopback |
| backups readable by an attacker on the host | gpg encryption to a key whose private half is offline; dump in `0700` | PO-06 data-safety §R | public key only on the host |
| live messages, payments or production systems reached from staging | outbound deny-all firewall; no provider credentials; copy-link invitations | design (`STAGING_INFRASTRUCTURE.md` §5) | firewall |
| a vulnerable framework build | Next.js 16.4.6 (the seven advisories fixed); `npm ci` from the lockfile | PO-05 | the approved SHA |

## 4. Open security findings, classified (none is fixed in PO-06: no feature or ops-script change is authorized)

| Id | Finding | Severity for the first test-only staging | Blocks staging? | Blocks production? | Owner |
|---|---|---|---|---|---|
| HF-1 | the Team-field exposure fix (`fix/team-sensitive-fields-exposure`, `94f936e`) is still not on `main` or production | high (production) / none on this branch (the fix is carried) | no | **yes**, a separate production security release | owner (decision R-1) |
| N-2 | production runs Next.js 16.4.3 with seven advisories | high (production) | no (staging builds 16.4.6) | **yes** | owner |
| N-3 | 13 moderate npm audit findings; `uuid` through `exceljs` reaches production | moderate | no | review | owner |
| D6-F1 | after S08 a push of `src/db/schema` would DROP `user_invitations`; the preflight blocks it | high if push were run | no (push never runs after S08) | yes, until L-3 moves the declaration or a reviewed filter exists | owner (L-3) |
| D6-F2 | PO-01's SQL cannot detect a differently shaped pre-existing table (`IF NOT EXISTS`, no shape check): one without the bcrypt-only CHECK is silently accepted (G2b); the manifest's fingerprint refuses it | medium | no | no (D-7 D7-09 checks it first) | — |
| D6-F3 | no reviewed rollback for PO-01A | low | no | an owner-approved plan before production | owner |
| D6-F4 | without S04, S05 builds the users key with `ALTER TABLE … ADD CONSTRAINT … UNIQUE` and holds ACCESS EXCLUSIVE on `users` until COMMIT (every sign-in waits) | high on a live database | no — the staging runbook always uses `--concurrent-indexes` | yes, until the production runbook mandates S01/S04 | — |
| EI-1 | `/register` has no handler for a unique violation: a race (today) or a legacy case variant (with `users_email_lower_uq`) gives an unhandled error, not "already exists" | low (UX; the data stays correct) | no | review with E-1 | owner |
| RB-1 | `restore.sh` leaves the decrypted dump beside the archive | medium | no — the runbook deletes it | fix before relying on the script | owner (ops change) |
| RB-2 | `restore.sh` runs `psql -f immutable_audit.sql` without `ON_ERROR_STOP` (a failure would be ignored) | low | no — the runbook checks the triggers | fix | owner |
| RB-3 | dumps carry no grants (`--no-privileges`): after a restore the runtime role has no rights until they are re-granted | low | no — runbook step | document | — |
| RB-4 | with an untrusted public key `gpg --batch` refuses, `backup.sh` fails **and leaves the plaintext dump** in `BACKUP_DIR` | medium | no — set the ownertrust at provisioning; monitor backup failures | fix | owner |
| RB-5 | `backup.sh` writes the plaintext dump to disk before encrypting it | low | no — encrypted volume recommended | review | owner |
| RB-6 | `restore.sh` has no target guard (`pg_restore --clean` drops objects in whatever database `DATABASE_URL` names) | high if mis-pointed | no — the runbook checks the target first | add a guard (ops change) | owner |
| RB-7 | `restore.sh` exits 1 even after a complete restore (its EXIT trap returns the status of a cleanup loop over an always-empty list) | medium (operators learn to ignore the exit status) | no — the runbook judges a restore by its checks | fix | owner (ops change) |
| RB-8 | a dump/restore re-parses one CHECK constraint with a flattened `AND` (textual only; the manifest pins and every reviewed file accept the restore) | none | no | no | — |
| N-5 | two timing-sensitive older checks (A.1-14) | low (test flake) | no | no | owner |
| L-8 | the Team session correction (PO-03C B) has not had its release review | medium | no | yes | owner |
