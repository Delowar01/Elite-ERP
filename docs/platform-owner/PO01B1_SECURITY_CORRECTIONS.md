# Platform Owner — PO-01B.1 security corrections

PO-01B.1 is a focused correction to the PO-01B console (`340087c`). Its subject is **session revocation and
audit atomicity**:

- A session change and its audit record now commit together.
- During an audit-trail outage, compromised sessions can still be ended. Those endings are labelled
  unaudited and recorded late.
- A recheck of the security boundary tightened one rule: `X-Forwarded-Host` is trusted only behind a configured proxy.

The approved login, Dashboard, Settings, Arabic RTL, light/dark and mobile screens are unchanged. Nothing is deployed
and the console stays off unless `PLATFORM_CONSOLE_ENABLED=true`. Earlier phases:
[`PO01A_DEVELOPMENT.md`](./PO01A_DEVELOPMENT.md), [`PO01B_DEVELOPMENT.md`](./PO01B_DEVELOPMENT.md).

## Root cause

On `340087c`, every path that ends a platform session made two independent writes:

1. it updated the session row;
2. it inserted the audit row.

Each write committed on its own. When the audit insert failed, the session stayed revoked with **no
audit record**. The Settings path then told the operator the service was "temporarily unavailable"
(`CONFIG_ERROR`): a partial change, and a misleading one.

This was reproduced on `340087c` with a test-only `BEFORE INSERT` trigger that makes the audit insert
fail:

| Path on 340087c | Result under an audit-write outage |
|---|---|
| `revokePlatformSession` (end one session) | session **revoked**, 0 audit rows, error thrown |
| `revokeSessionCore` (Settings "End session") | session **revoked**, 0 audit rows, UI told `CONFIG_ERROR` |
| `revokeAllPlatformSessions` (sign out others) | sessions **revoked**, 0 audit rows, error thrown |
| `validatePlatformSession` (idle expiry) | session **revoked**, 0 audit rows |
| `logoutPlatformSession` (sign out) | session **revoked**, 0 audit rows |

PO-01B tested the case where the audit table's *protection* is missing, which fails closed. It never
tested a failing audit *write*.

## Policy now

| Operation | Normal | During an audit-write outage |
|---|---|---|
| End one session (Settings) | Revoke + `session.revoked` in one transaction | **Nothing applied.** The UI says so: "The audit trail is unavailable" dialog. |
| Sign out of other sessions | Every revoke + a `session.logout_all` row per session + a summary row, in one transaction | **Nothing applied.** Same dialog. |
| Emergency containment (explicit, from that dialog) | Tries the audited path first; if it works, the result is an ordinary audited one | Ends the operator's **own** live sessions without an audit record. Reported `audited: false`; incident logged; recorded late. |
| Sign out (this device) | Revoke + `session.logout` in one transaction | **Fail-safe:** the session is ended anyway, the cookie is cleared, an incident is logged, and the sign-in page says the sign-out could not be recorded. |
| Idle / absolute expiry | Refused on time; revoke + `session.idle_timeout` / `session.expired` in one transaction | Still refused, because expiry is enforced by time. The row write rolls back, an incident is logged, and the next validation records it. |
| Administrative invalidation (`revokeAllPlatformSessions` with any reason) | All rows + all audit rows in one transaction, joining the caller's transaction | Rolls back with the caller and throws `AUDIT_UNAVAILABLE`. |
| Sign-in | Session + `auth.login.succeeded` (unchanged) | **Fails closed** with the generic "temporarily unavailable". No session is created and the TOTP step is not consumed. |
| Recovery-code regeneration | Step-up + rotation + audit in one transaction (unchanged) | **Fails closed**: nothing is rotated, and the operator is told the change was not applied. |

`AUDIT_UNAVAILABLE` has its own message in English and Arabic: "This change was not applied because it could not be
recorded in the audit trail." An unaudited operation is never reported as audited:

- `audited: false` in the result;
- a warning toast or notice in the UI;
- an incident line in the server log;
- a late audit record whose action names it as late.

### Emergency containment

- **Trigger:** offered only after a normal "End session" or "Sign out of other sessions" reports `AUDIT_UNAVAILABLE`.
  It runs only on explicit confirmation ("End without audit record").
- **Authorization:** the same as every console mutation: feature flag, same origin, a live database session and the
  `platform.sessions.manage` permission.
- **Scope:** only ever the operator's own **live** sessions. It is access-reducing by construction, and no code path
  clears `revoked_at`.
- **Where it lives:** the two unaudited writes, `containPlatformSessions` and `containPlatformSessionByToken`, are the
  only exceptions to the atomicity rule. `tests/security/platform-boundary.test.mjs` rule 20 proves:
  - they are called only from the console;
  - they run only after an `AUDIT_UNAVAILABLE` check;
  - each call reports an incident and returns `audited: false`.

### Incident log (no secrets)

`src/lib/platform/incident.ts` writes one line to the server log, `[platform-security-incident] {json}`, with:

| Field | Content |
|---|---|
| `incidentId`, `at` | a fresh id and the time |
| `type` | `unaudited_session_revocation` or `audit_write_failed` |
| `action` | an allow-listed action name |
| `actorAdminId`, `sessionIds` | UUIDs only; at most 50 session ids |
| `count`, `requestId`, `ip` | validated |
| `error` | an error *class* only: `PlatformError:<code>`, `SQLSTATE:<code>` or a constructor name |

It never writes a token, cookie, password, code, secret, e-mail, user agent, connection string or error message. It
never throws.

**Production:** these lines must be collected and alerted on. The log is the only record until the audit trail
returns.

### Late recording

Once the audit trail accepts writes again, the next successful audited change, or the next sign-in, runs
`reconcileUnauditedRevocations`. That function:

- finds each session revoked in the last 30 days that has no revocation audit row, at most 100 per run;
- writes one `session.revocation_recorded_late` row for each. The row has actor `system` and carries
  `recordedLate: true`, the original reason and the original revocation time.

It never invents the original event: no `session.revoked` or `session.logout` row is backdated.

Each revocation is recorded **exactly once**. Reconcilers are serialised by a transaction-scoped advisory lock taken
*before* the select, and a second concurrent reconciler returns at once. Row locks alone could not promise this. A
lock-only row lock does not make PostgreSQL re-check the `NOT EXISTS` condition, so a reconciler whose snapshot
predates another's commit could otherwise record a revocation twice.

## Security boundary recheck

| Area | Result |
|---|---|
| `X-Forwarded-Host` | **Tightened.** It is used for the same-origin check only when `PLATFORM_TRUSTED_PROXY_HOPS` ≥ 1, and only when single-valued. Otherwise `Host` is used, so a client-sent `X-Forwarded-Host` without a trusted proxy is ignored. A malformed hops value is `CONFIG_ERROR`. |
| CSRF / same origin | Re-verified for all six console mutations, the new emergency containment included. Cross-site, null-origin and mismatched-origin requests are refused before any change. |
| Trusted proxy hops, missing or malformed IP | Re-verified: hops unset means the IP is unknown and per-IP throttling is skipped; a malformed IP is ignored; a malformed hops value fails closed. |
| Tenant vs platform tokens | Re-verified both ways, in the proxy and in the guards: either token in either cookie is refused. |
| Live session on server actions | Every action re-validates the database session. The new emergency action included. |
| MFA / recovery-code replay | Re-verified. A sign-in refused during an outage does not consume the TOTP step. |
| Feature flag off | Every `/platform` path is a bare 404, the new paths included. |
| Credential or token leakage | Server output, incident lines, audit rows and action results scanned: nothing found. |

## What did not change

- **Customer ERP.** No customer session, auth, proxy, route, component, library, schema or migration file changed.
  The C8 byte pins and `verify-page-archetypes` group 23 prove it.
- **Approved screens.** 39 of the 44 PO-01B screenshots are byte-identical. The other 5 differ only in live clock values
  (sign-in, expiry and last-activity times).
- **Visible changes**, only during an audit-write outage:
  - the Settings dialog and its warning toast;
  - the sign-in notice after an unrecorded sign-out.

  Both are built from existing components and tokens, in English and Arabic RTL.

## Verification

| Command | Covers |
|---|---|
| `npm run verify:platform-containment` | Real audit-write outage (test-only trigger) in a disposable database. Normal operations are all-or-nothing; emergency containment is available and never "audited"; late recording is exactly once, including concurrent and lock-held reconcilers; concurrent revocations; no regained access; idle, token and row expiry; the tenant ERP untouched; no leakage. |
| `npm run verify:platform-console` | Section 3 now also covers forged, differing and multi-valued `X-Forwarded-Host` with and without a trusted proxy, and the new emergency mutation. |
| `npm run verify:platform-browser` | Section 7b: the outage dialog, explicit containment, Cancel, the unaudited sign-out notice (EN and AR), server incident lines, and late records after recovery. Section 13 counts every session's ending. |
| `npm run verify:platform-boundary` | Rule 19: revocations are atomic and nothing clears `revoked_at`. Rule 20: containment is confined, and incident fields are allow-listed. |
| `npm run verify:platform` | boundary → proxy → schema → auth → bootstrap → console → containment. |

## Change control

`verify/po01b1-approved-delta.mts` records PO-01B.1 the way the earlier layers recorded themselves:

- the hunks in the 14 changed files, `[340087c's text, PO-01B.1's text]`;
- the sha256 of the one added file.

Both freeze verifiers undo the layers in this order: PO-01B.1, PO-01B, PO-01A, LCP, ACC-01. Each older layer and pin
therefore reads its own bytes. Nothing was re-baselined, the older records are byte-identical, and no test was weakened.

`verify-page-archetypes` group 23 also proves:

- every changed file is one an earlier platform layer added or recorded;
- every changed or added file lies under `src/app/(platform)`, `src/components/platform` or `src/lib/platform`, or is
  one of the two verifiers.

The layer was tamper-tested by making each of these changes and confirming each one is caught:

- an unrecorded edit;
- a changed added file;
- an unrecorded new file;
- a customer file slipped into the record;
- an edit to the customer session.

## Open before production

- D-6: production application of the platform SQL. `db:push` does not install the audit triggers.
- The provisional 12 h absolute / 30 min idle session policy.
- `PLATFORM_TRUSTED_PROXY_HOPS` for the real proxy chain. The proxy must set a single `X-Forwarded-Host`, or pass `Host`
  through.
- Riyadh-time display, and package prices (none shown until approved).
- The 5-minute cache of a positive audit-protection check.
- An index for audit lookups by entity (performance).
- Collection and alerting for `[platform-security-incident]` lines.
