# Platform Owner PO-02C.1 — Customer sign-in racing a suspension: session issuance and recovery-code hardening

Development on `feat/platform-owner` only. Baseline: PO-02C head `ea94337`; the live ERP is `621f156` and is not
changed. Nothing here was deployed, migrated or run against production; every test used fictional data in disposable
loopback PostgreSQL databases named `*_test_only_*`. **No schema change.** Both switches stay off by default and their
production activation still needs separate owner approval (PO-02C §9).

## 1. Scope and outcome

PO-02C checked a company's access at sign-in, but the check, the recovery-code consumption, the success record and the
session insert were separate autocommit statements, and the sign-in took no lock that the suspension's company lock
could see. PO-02C.1 makes session issuance and recovery-code consumption race-safe:

- with `TENANT_ACCESS_ENFORCEMENT=enabled`, everything the sign-in writes is ONE READ COMMITTED transaction that starts
  with a SHARE lock on the company row; the access action already holds `FOR NO KEY UPDATE` on that row, so issuance and
  every suspension or reactivation serialize;
- a matched recovery code is spent under the user-row lock, at most once — with the switch on and with it off.

Changed: sign-in (`src/app/(auth)/actions.ts`), the session store and the security-event writer (an optional executor
each), the tenant-access gate (one wrapper), the company-access rule (one locked read) and the access action (its
isolation level made explicit). No file is added under `src/`; no business, accounting, inventory, HR, invoice, payment
or document file is touched; PO-02D is not started.

## 2. Root cause (proven on the unmodified PO-02C build — `verify:platform-login-race` 32/51)

| # | Race | What PO-02C did | Observed on ea94337 |
|---|---|---|---|
| R1 | Suspension during the session insert | Access read with a plain `SELECT`; session inserted later, autocommit. The insert's foreign-key check takes `FOR KEY SHARE` on the company row, which does not conflict with the suspension's `FOR NO KEY UPDATE`. | The suspension committed while the sign-in was paused at its insert; its bulk revocation ended **0** sessions and the new row stayed live. (The per-request check still showed the suspended screen.) |
| R2 | Sign-in spanning a suspension **and** a reactivation | The reactivation's revocation ran before the late insert. | The session was **usable after reactivation without signing in again**. |
| R3 | Suspension after the access check | Recovery code spent and `mfa.recovery_used` + `login.success` recorded before `issueSession`'s re-check. | Code spent (2→1), success recorded, then the re-check threw: HTTP 500, **no session** — a consumed code and a misleading success record. |
| R4 | Suspension in flight at the check | The plain read saw the uncommitted state (active). | The sign-in completed while the suspension was committing; the session escaped the revocation. |
| R5 | Same recovery code, two concurrent sign-ins | Read the encrypted list unlocked, matched in memory, wrote back "list minus code". | **Both accepted**: 2 sessions, 2 success records, one code removed. |
| R6 | Two different codes concurrently | Same read-modify-write of the whole list. | **Lost update**: codes 3→2 instead of 1; the first code was accepted again later. |
| R7 | Database error at the session insert | Autocommit writes before it. | HTTP 500; code spent, success and code-used records written, last sign-in time changed. |
| R8 | Success record cannot be written | Code spent before it. | HTTP 500; code spent, no session. |
| R9 | Switch off, same code twice | Same as R5. | Both accepted. |

Also observed (not vulnerabilities): a sign-in during an in-flight reactivation was refused with the suspended message
(stale but safe), and an account deactivated during sign-in was not re-checked (the per-request `isActive` check still
signs it out).

## 3. Transaction and locking design

**Sign-in, enforcement on** (`completeSignIn`, after the password and second factor are verified; bcrypt stays outside):

```
BEGIN ISOLATION LEVEL READ COMMITTED
 1. SELECT id FROM orgs WHERE id = $org FOR SHARE                  -- company lock (tenant-access-gate → company-access.ts)
 2. SELECT … FROM orgs LEFT JOIN tenant_access_controls …            -- access, fresh snapshot after any wait
    not active → return "suspended" (nothing written)          missing table/column → TenantAccessUnavailableError
 3. SELECT org_id, is_active, mfa_recovery_codes FROM users WHERE id = $user FOR NO KEY UPDATE
    inactive / other company → "account";  matched recovery hash no longer stored → "code_spent"
 4. UPDATE users SET mfa_recovery_codes = <list without the hash, re-encrypted>, last_login_at = now
 5. INSERT INTO sessions …                                          -- createSession(…, tx)
 6. INSERT INTO security_events (mfa.recovery_used)  · INSERT INTO security_events (login.success)
COMMIT  →  clear the rate-limit counter, sign the token, set the cookie, redirect
```

A refusal rolls back and records `login.company_suspended` / `mfa.failed` / `login.failed` outside the transaction; a
missing access table records `login.access_unavailable`; any other failure rolls back, logs only its SQLSTATE or error
class (never its message) and shows "Sign-in is temporarily unavailable. Try again later." No cookie is set on any of
these paths.

**Why it serializes.** `FOR SHARE` conflicts with `FOR NO KEY UPDATE` (held by `setCompanyAccessCore` from before it
changes the access row until it commits) but not with `FOR KEY SHARE` (foreign-key checks of ordinary inserts) or other
`FOR SHARE` lockers (other sign-ins). So:

- a change that **committed first** is seen by statement 2, which starts after the lock is granted;
- a change that **starts later** waits on the company row until the sign-in commits; its own later statements (READ
  COMMITTED) then see the new session, and its bulk revocation ends it — after reactivation the user signs in again.

Both transactions now run at READ COMMITTED explicitly (`{ isolationLevel: "read committed" }`): the guarantee needs
each statement after a lock wait to see what committed during it, and must not depend on a database default.

**The suspension lock is not strengthened.** It stays `FOR NO KEY UPDATE`; only the sign-in side takes a new (weaker)
lock. Foreign-key checks (`FOR KEY SHARE`) of every customer insert stay unblocked by both.

**No deadlock.** Sign-in lock order: company row → user row → new session row → new event rows. The access action locks
the operator row, the company row, the access row and existing session rows — never a user row. No customer transaction
locks a user row and then its company (checked across `src/`: the only transactions that write `users` are the password
change and registration, which inserts a new company and its owner; neither locks an existing company row). Ordinary `UPDATE orgs` statements (settings saves) are single autocommit statements: they and a
sign-in can delay each other by the length of one sign-in transaction, never cycle.

**Registration** (`issueSession`, enforcement on): the same company lock + access check and the session insert in one
transaction, the cookie after it. With the switch off, `issueSession` is unchanged.

**Enforcement off**: the accepted sequence (no company lock, no access check, success record before the session as
before), with one change: a matched recovery code is spent in a small transaction under the user-row lock
(`consumeRecoveryCode`); if it was already spent, the attempt is refused like a wrong code.

## 4. Recovery-code consistency

- The submitted code is matched against the stored bcrypt hashes **outside** any transaction; the matched hash string H
  is kept.
- Under the user-row lock (`FOR NO KEY UPDATE`; a locking read that waited returns the latest committed row in READ
  COMMITTED), the encrypted list is decrypted again, H must still be present (`indexOf` on the exact stored string), it is
  removed and the re-encrypted list is written in the same transaction.
- Same code twice at once: the second waits on the row, then finds H gone → refused (`That code didn't match`). Two
  different codes: each removes its own hash from the latest list → both removed, no lost update. Codes regenerated
  meanwhile: H absent → refused.
- With enforcement on, the spend commits only together with the session and the success record; a suspended company,
  an unreadable access table, a changed account, a database error or a failed success record leaves the code unspent.
- Storage is unchanged: field-encrypted JSON array of bcrypt hashes; the form, messages and MFA steps are unchanged.

## 5. Switches (unchanged policy)

| Switch | Effect | Default |
|---|---|---|
| `TENANT_ACCESS_ENFORCEMENT=enabled` | PO-02C enforcement, now with race-safe issuance (§3) | off |
| `CUSTOMER_LEGACY_TOKENS=reject` | D-8: jti-less tokens refused | off |

Verified: switch off = accepted behavior (no company lock, a suspended row does not block sign-in); legacy-token
rejection is controlled separately; a missing access table fails closed at sign-in; reactivation never recreates or
un-revokes a session; subscription state is not read anywhere in the access decision. Production activation policy is
unchanged.

## 6. Deterministic concurrency suite — `npm run verify:platform-login-race` (needs `next build` first)

Barriers: test-only triggers in the disposable database make a chosen statement call `pg_advisory_xact_lock(k)` while
the suite holds `pg_advisory_lock(k)` on its own connection — the sign-in pauses at its session insert or user-row
update, or the suspension at its audit insert (holding the company lock). The suite reads `pg_stat_activity`
(`wait_event` advisory / transactionid / tuple and the waiting statement) on a separate connection, acts, then releases.
Time bounds are used only to show that something did **not** finish while blocked. Real HTTP: `next start` servers A
(enforcement on), B (off), C (on + D-8), driven in Chromium; suspensions through the real console core.

| § | Scenario | ea94337 | PO-02C.1 |
|---|---|---|---|
| 0 | Suspended before the sign-in; between the password and code steps | pass | pass |
| 1 | Suspension during the session insert | **fail** (not serialized; session escaped) | the suspension waits; ends that session; reactivation → signed out |
| 2 | Paused across suspension + reactivation | **fail** (usable) | signed out |
| 3 | Suspension during recovery consumption | **fail** (code spent, success, no session) | commits whole, then ended |
| 4 | Suspension in flight at the check | **fail** | the sign-in waits, refused, nothing spent |
| 5 | Same recovery code ×2 | **fail** (both) | exactly one |
| 6 | Two codes ×2 | **fail** (lost update) | both removed |
| 7 | DB error at the session insert | **fail** | generic message, nothing applied, no cookie, code reusable |
| 8 | Success record fails | **fail** | nothing applied, no cookie |
| 9 | Reactivation in flight; deactivated while waiting | fail (stale refusal; no re-check) | waits then signs in; re-checked → refused |
| 10 | Legacy / explicit-active / TOTP / bystander / missing table | pass | pass |
| 11 | Switch off: no lock taken; suspended row ignored; same code ×2 | **fail** (code twice) | pass |
| 12 | Legacy JWT, D-8 off and on | pass | pass |
| 13 | Business tables byte-identical (65); no secret in logs/events; no idle transaction | pass | pass |

Totals: **ea94337 32/51 · PO-02C.1 51/51** (runs listed in §7). Behavioral tamper: with only the `FOR SHARE` removed
(rebuilt), 43/51 — exactly the eight serialization checks fail, while atomicity and single-use checks still pass.

## 7. Verification (final run on the PO-02C.1 tree; baseline = the same runner on ea94337)

| Suite | ea94337 | PO-02C.1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| ESLint (src tests scripts verify) | 28 pre-existing problems (7 errors, 21 warnings) | the identical 28; every changed or added file clean |
| `verify:static` chain + its 22 suites run one by one | all pass | all pass — document-form 85 → 86, page-archetypes 284 → 295 (group 27), the other 20 unchanged |
| ACC-01 inventory costing · project costing | 171/171 · pass | 171/171 · pass |
| security: access-control · crypto-policy · platform boundary | 22 · 18 · 97 | 22 · 18 · 104 |
| `verify:platform` (proxy 59, schema 54, auth 136, bootstrap 54, console 108, containment 87, company-schema 107, migration-safety 91, companies 190, company-access 116) | all pass | all pass, same counts |
| UI guardrails · production build (test-only env) | pass · pass | pass · pass |
| browser: PO-01B · PO-02B · PO-02C | 138 · 111 · 64 | 138 · 111 · 64 |
| `verify:platform-login-race` | 32/51 (19 race failures) | 51/51 in three runs; the last two runs' evidence identical (ids and times aside) |

## 8. Change control

`verify/po02c1-approved-delta.mts` records every changed byte of the 8 frozen files (four customer sign-in and session
files, two platform files, the two freeze verifiers), [ea94337, PO-02C.1], 36 hunks; undone, each file is ea94337's to the
byte, so every older layer — PO-02C's added-file pins included — reads its own bytes through the newest-first chain.
`verify-page-archetypes` group 27 pins each customer delta line by line; `verify-document-form` and
`verify-platform-containment` read through the new layer. No older pin was weakened or rebaselined. Boundary rule 34's
sign-in check is re-pinned to the transactional structure and rule 37 is added (lock protocol, wrapper callers, suspension
lock not strengthened, READ COMMITTED, executors). Nine tamper cases (unrecorded and recorded) are all caught.

## 9. Known limitations and production risks

1. No absolute in-flight cutoff (as PO-02C): a request already past its session check when a suspension commits can finish.
   The guarantee is that no session is issued around a suspension and none escapes its revocation.
2. Sign-ins of one company wait for that company's in-flight access change (and vice versa), each holding a pooled
   connection (node-postgres default 10). The wait is bounded by one access-change transaction (milliseconds); no
   `lock_timeout` is set (owner option).
3. A sign-in transaction briefly delays `UPDATE orgs` of the same company (settings saves) and vice versa.
4. Switch off keeps the accepted order: a database failure after a recovery code is spent still spends it; the success
   record still precedes issuance (enforcement on is the target state).
5. Coordination assumes every access change goes through `setCompanyAccessCore`. A manual SQL edit of
   `tenant_access_controls` without the company lock is not serialized (the per-request check still applies).
6. Legacy jti-less tokens have no server-side row to end: refused while suspended, usable again after reactivation until
   they expire. D-8 closes it.
7. Customer TOTP codes still have no replay protection within their window (pre-existing; needs a schema change).
8. The login rate limiter is in memory, per process (pre-existing).

## 10. PO-02D prerequisite gaps (reviewed against PR #11 at 357e93e; nothing implemented)

| Prerequisite (spec) | State on this branch | Gap |
|---|---|---|
| Trial package + version (Plan PO-02; Schema §6) | no `subscription_packages` / `subscription_package_versions` | tables, immutability trigger, one default Trial; **trial days, seats, storage and module labels need approval** (PRD/Schema give 14 days as the *initial default*; no seat value is given) |
| Initial tenant subscription (TRD §5; Schema §7) | no `tenant_subscriptions` / `subscription_events` / `platform_settings` | one-current-per-org table, append-only events, platform business date (Asia/Riyadh in spec) |
| Primary owner mapping (Schema §4.2) | no `tenant_primary_owners` | composite `(org_id, user_id)` FK needs an **additive unique key on existing `users(org_id, id)`** (customer table — approval); legacy orgs: read-only owner audit, no guessed backfill |
| Invitation package/version/cycle (Schema §5.1) | deferred by PO-02A | additive `initial_package_version_id`, `initial_cycle` before any invitation exists |
| `/register` vs invite-only (appflow §4, TRD §5) | `/register` public; creates org + owner + seed + session | cutover is last and separately approved; decide whether register-created orgs get access/subscription/owner rows before it |
| Prices / paid seats (PRD §6(a)) | none | **no approved values**: paid versions stay unpublished drafts; no paid subscriptions |

Proposed sequence: **PO-02D0** read-only reconciliation + decision record (no code) → **PO-02D1** additive foundation
schema + approved Trial only (isolated DB, reviewed SQL, rollback, migration-safety tests) → **PO-02D2** invitation
issuance / revoke / re-issue (hashed one-time tokens, step-up, audit; no public endpoint) → **PO-02D3** transactional
acceptance (public token route; one locked transaction: org + owner + seed via the refactored shared registration path,
access row, primary owner, Trial subscription, accepted mark, audit; session through the PO-02C.1 issuance path) →
**registration cutover** (separately approved switch). D2 and D3 could be merged, but keeping issuance without a public
endpoint first gives a smaller reviewed step. Not inventing prices, seats, subscriptions or primary owners anywhere.

## 11. Open owner decisions

1. Accept the one enforcement-off change (atomic single-use recovery codes) — recommended.
2. Whether enforcement-off sign-in should also become the single transaction (recommended later, not needed now).
3. Optional `SET LOCAL lock_timeout` on the sign-in transaction (defer until production metrics).
4. D-8 and `TENANT_ACCESS_ENFORCEMENT` activation — unchanged (PO-02C §9/§10).
5. Customer TOTP replay protection — a future, schema-changing phase.
6. PO-02D0 inputs: Trial days / seats / labels, `users(org_id, id)` key, `/register` policy before cutover, invitation
   permission and step-up, acceptance sign-in behavior.
