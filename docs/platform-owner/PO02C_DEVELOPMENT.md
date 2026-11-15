# Platform Owner PO-02C — Company access: suspend, reactivate and customer enforcement

Development on `feat/platform-owner` only. Baseline: PO-02B head `7637e4e`; the live ERP is `621f156` and is not
changed. Nothing here was deployed, migrated or run against production; every test used fictional data in disposable
loopback PostgreSQL databases named `*_test_only_*`. **Production activation of suspension, of customer enforcement and
of legacy-token rejection needs separate owner approval** (§9).

## 1. Scope and activation

PO-02C makes company access operational:

- a server-only access service (`src/lib/platform/company-access-actions.ts`) that suspends, reactivates and reads one
  company's access, behind `platform.companies.manage_access` and a fresh password + TOTP step-up;
- customer enforcement through ONE customer module, the tenant-access gate (`src/lib/security/tenant-access-gate.ts`),
  used by the session check (`src/lib/session.ts`), sign-in and session issuance (`src/app/(auth)/actions.ts`) and the
  signed-file path of the uploads route;
- a bilingual access-suspended screen (`/access-suspended`) and the Platform Owner confirmation dialog.

Two switches, both **off by default**, read in exactly one place each:

| Switch | Effect when set | Default |
|---|---|---|
| `TENANT_ACCESS_ENFORCEMENT=enabled` (exact) | The customer gate applies company access on every request, at sign-in and to signed files; the console can suspend. | off — customer behavior is byte-for-byte the previous lookup; the console refuses to suspend (`ENFORCEMENT_DISABLED`) but can reactivate |
| `CUSTOMER_LEGACY_TOKENS=reject` (exact) | D-8 proposal: customer tokens without a server-side session id are refused. | off — legacy tokens stay valid until they expire (they still cannot bypass a suspension) |

No schema object is added: PO-02C uses the PO-02A objects (`tenant_access_controls`, the partial index
`sessions_org_active_idx`, the audit entity index).

## 2. Access-path inventory and coverage

Method: every route handler, every page and layout (73 pages), every `"use server"` module (203 exported actions in 47
files, AST-checked for a guard reached directly or through helpers), every direct `getSession()` caller, the edge proxy,
signed URLs, PDF rendering, timers, outbound calls and operator scripts.

| # | Entry point | Auth before PO-02C | Bypass before | PO-02C correction | Test |
|---|---|---|---|---|---|
| 1 | Sign-in (`loginAction`) | rate limit → user → password → TOTP / recovery code → session | no company check | access checked after full authentication; suspended → neutral EN/AR message, no session, recovery code not spent, last-login not written; unreadable access → "temporarily unavailable" | browser §3, §5 |
| 2 | Registration | creates org + owner | none (a new org has no access row → active) | none | unchanged |
| 3 | Session issuance (`issueSession`) | — | could mint for a suspended org | refuses a company whose access is not active (defence in depth) | in-process §12(b) |
| 4 | Session check (`lookupSessionByToken` → `getSession` / `requireSession` / `requireRole`) | signature → session row → active user | never checked company access; token/row/user ownership not compared | per-request access check independent of revocation; row bound to token user AND company; user must still belong to it; `suspended` / `unavailable` states | in-process §11, §15; browser §3 |
| 5 | Edge proxy | signature only | n/a (server decides) | none | proxy suite |
| 6 | Pages (70 data pages, print) | `requireSession` / `requireRole` | covered by 4 | none | browser §3 (4 direct GETs) |
| 7 | Pages without their own guard (design-system, products/new, settings/team) | layout guard; no tenant data | none | none | — |
| 8 | Server actions (198 guarded; login, register, logout, locale, theme public by design) | `requireSession` / `requireRole` | covered by 4 | none; logout keeps working while suspended | browser §3 (captured POST replayed) |
| 9 | Exports (documents, finance reports, statements) | `requireSession` | covered by 4 | none | browser §3 |
| 10 | Print / PDF (`/api/document-pdf` → Puppeteer → `/print` with the forwarded cookie) | `requireSession` at each step | covered by 4 | none (refused before any lookup or render) | browser §3 |
| 11 | Import templates | `requireSession` | covered by 4 | none | browser §3 |
| 12 | Uploads, session path | `getSession()` + org match | covered by 4 | none | browser §3 |
| 13 | Uploads, **signed** path (branding folders) | HMAC signature only | **yes** — a valid signature served bytes regardless of access | explicit access check; refused (404) while not active, fail closed when unreadable | browser §1, §3, §5, §6 |
| 14 | Signed-URL minting (`signFileUrl`) | — | no callers | none; capability documented | — |
| 15 | Cached protected bytes | `private`; 1 h (session) / remaining signature life (signed) | browsers may reuse privately cached bytes up to that age; downloads cannot be recalled | documented limit | browser §1 (headers) |
| 16 | Logout | token signature; revokes its row | n/a | none | browser §4 |
| 17 | `/auth/clear` | none (clears cookie) | n/a | none | — |
| 18 | Root page, auth layout | `getSession()` | covered by 4 | none | — |
| 19 | Locale / theme actions | cookie only | n/a | none | — |
| 20 | Public links (share, portal, reset, webhooks) | none exist | — | — | — |
| 21 | Background / scheduled work | none in the app; operator scripts run outside customer access | — | none | — |

Verdict: **GO** — every path is covered by one central session gate plus three explicit checks (sign-in, issuance,
signed files), with no business-logic change.

## 3. The access action

Order of checks (pinned by boundary rule 32):

1. console enabled → 2. same-origin / CSRF → 3. live Platform Owner session (the platform token only; a customer
   token is UNAUTHORIZED) → 4. `platform.companies.manage_access`
2. the audit trail must be protected (append-only triggers in force) — otherwise CONFIG_ERROR before anything else
3. request FORMAT (no database, reveals nothing; a malformed request spends no second-factor code): target, typed
   reference exactly `ORG-…`, reason 10–500 characters after whitespace collapse, no control or bidi-override
   characters, a six-digit code, a password
4. a suspension is refused while enforcement is off (`ENFORCEMENT_DISABLED`); reactivation stays possible
5. step-up: the durable throttle shared with sign-in, the password, then — inside the transaction — the TOTP code,
   consumed with replay protection
6. company validation after the step-up, inside the transaction
7. the change; 8. the audit record in the same transaction.

**Transaction** (READ COMMITTED, one `db.transaction`):

| Step | Statement | Why |
|---|---|---|
| 1 | `consumeTotpCode` (conditional update of the admin's last step) | the code is spent with the change or not at all; concurrent uses of one code serialize on the admin row |
| 2 | `select id from orgs where id = $1 for no key update` | serializes access changes per company; unlike `FOR UPDATE` it does not block the foreign-key checks of the company's own inserts (measured: `FOR UPDATE` → lock timeout 55P03 behind an in-flight insert; the suspension did not wait) |
| 3 | `select … from tenant_access_controls … for update` | locks an existing access row |
| 4 | effective state by the PO-02A rule; same as target → CONFLICT (rolled back) | no duplicate transition |
| 5 | upsert the access row: status, reason, operator, `changed_at`, `updated_at` (never earlier than `created_at`) | the CHECKs require attribution and a reason |
| 6 | `update sessions set revoked_at, revoked_reason = 'org_suspended' where org_id = $1 and revoked_at is null and expires_at > now` | ends live sessions (index `sessions_org_active_idx`); **also on reactivation**, so a session created by a sign-in that raced the suspension can never become usable |
| 7 | `recordPlatformAudit(…, tx)` — `company.suspended` / `company.reactivated` with before `{accessStatus, source}`, after `{accessStatus, sessionsEnded}`, the reason, operator and request metadata | if it cannot be written, everything above is rolled back (AUDIT_UNAVAILABLE) |

Refusals are recorded as `company.suspend.rejected` / `company.reactivate.rejected` with a stage: `password`, `mfa`,
`replay`, `throttle`, `state`, `not_found`, `enforcement_disabled` (linked to the company when it exists). Failed
passwords and codes count against the durable throttle.

**Idempotency.** There is no request-key table (the PO-02A schema has none and no schema change was approved). A
retried request is therefore not recognized as a duplicate; it is refused instead — a used code (`MFA_INVALID`) or the
state check (`CONFLICT`) — and never applied twice. Proven under concurrency (§7).

**Read operation.** `readCompanyAccessCore` (manage_access) returns the current state from one statement; the dialog
calls it on open so the operator never confirms a state the page only showed.

## 4. Customer enforcement

| Token / row / company | Enforcement off | Enforcement on |
|---|---|---|
| jti token, live row, active (or no access row) | active | active |
| jti token, live row, **suspended** (missed revocation) | active (as before) | **suspended** |
| jti token, row revoked `org_suspended`, still suspended | signed out | suspended (screen) |
| jti token, row revoked otherwise / expired / missing | signed out | signed out |
| row of another user or company than the token | (not compared) | signed out |
| user moved to another company / deactivated | deactivated → signed out | signed out |
| jti-less legacy token, active / suspended | active / active | active / **suspended**; with `CUSTOMER_LEGACY_TOKENS=reject` → signed out |
| access table or column missing | (not read) | **unavailable** — denied, never shown as a suspension |
| unknown stored status | (not read) | suspended (fails closed) |

`requireSession` sends `suspended` and `unavailable` to `/access-suspended` (the cookie is kept so the screen can
re-check and offer sign-out); `getSession` returns no session for either, so route handlers and the uploads session
path refuse. With enforcement on, a session check costs one extra indexed query (2 → 3).

**Sign-in.** Errors before the password stay generic ("Invalid email or password."). After the password and second
factor: suspended → "Your company's access is suspended. Contact your service provider." (EN/AR); unreadable access →
"Sign-in is temporarily unavailable. Try again later.". No session is issued, a matching recovery code is not spent,
the last-login time is not written.

**Signed files.** A valid, unexpired signature is refused (404) while the owning company is not active, before the
store is read; fail closed when access cannot be read. Limits: a signature minted before a suspension serves again after
reactivation until it expires (signatures are time-limited, not revocable); bytes a browser already cached privately
(≤ 1 h by session, ≤ the signature's remaining life when signed) and files already downloaded cannot be recalled. No
shared cache may store them (`private`).

**In-flight requests.** A request whose session check passed before the suspension committed may complete (measured:
an insert in flight completed and was kept). Every check that starts after the commit is refused. PO-02C does not claim
an absolute in-flight cutoff.

**Known limitation.** Logging out from the access-suspended screen overwrites that one session row's revocation reason
(`org_suspended` → `logout`), as the existing customer logout always does; the suspension itself stays in the audit
trail with its session count.

## 5. UI

- Company detail: Suspend / Reactivate in the header and in Access & controls (`CompanyAccessControl`). With
  enforcement off, Suspend is disabled and says why; Reactivate stays available.
- Confirmation dialog (Radix: focus trap, focus return, page hidden from assistive technology, Escape when idle):
  consequences (all users lose access at once, sign-ins refused, records kept, subscription unchanged, fresh sign-in
  after reactivation); the typed reference, the reason with a counter, password and TOTP; states: checking (inputs
  disabled), validation errors (no request sent), server errors (password and code cleared), success with the number of
  sessions ended, audit trail unavailable ("not applied"), changed-since-loaded / conflict with Refresh. On phones it is
  a bottom sheet. Latin names and references are isolated (U+2068/U+2069) inside Arabic sentences.
- Customer `/access-suspended`: the sign-in layout (logo, neutral icon, explanation, records kept, how to restore,
  Log out); no company data or administrative note; an `unavailable` variant.
- The PO-02B notes that promised PO-02C now state the actual enforcement state (directory, dashboard tile, access tab).
- Platform states stay neutral tags (no new status colours; the shared customer status registry is unchanged).

## 6. Security controls (tests/security/platform-boundary.test.mjs, 97 checks)

Updated with exact, named exceptions: rule 3 / 11 (the gate is the ONE customer importer of the platform rule), rule 12
(three action files; the two new cores), rule 21 (the access action uses `orgs.id` only), rule 23 (manage_access exists
and only the access action checks it), rule 24 (the detail's access state from one statement), rule 26 (suspend /
reactivate only through the dialog). New rules 30–36: gate imports and users, fail-closed codes, the exact switches and
their single readers, the action's order and transaction, what it may write (one upsert; sessions only ended), the
customer gate lines, the suspended screen's imports, the dialog's actions and cleared credentials.

## 7. Verification (final run on the PO-02C tree; baseline = the same runner on 7637e4e)

| Run | PO-02C result | Baseline |
|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 |
| ESLint `src tests scripts verify` | 28 problems (7 errors, 21 warnings) — identical, finding for finding, to the baseline; none in a PO-02C file | 28 (7 / 21) |
| `verify:static` chain | exit 0 | exit 0 |
| each `verify:static` suite on its own (22) | all pass; counts identical except `document-form` 85/85 and `page-archetypes` 284/284 (the PO-02C layer checks) | 84/84, 274/274 |
| ACC-01 `inventory-costing` / `project-costing` | 171 passed, 0 failed / 50/50 | same |
| `tests/security` access-control / crypto-policy | 22/22 / 18/18 | same |
| `verify:platform-boundary` | 97/97 | 78/78 |
| `verify:platform-proxy` / `-schema` / `-auth` / `-bootstrap` / `-console` | 59/59 · 54/54 · 136/136 · 54/54 · 108/108 | same |
| `verify:platform-containment` | 87/87 (live-ERP check reads through the PO-02C layer) | 86/86 |
| `verify:platform-company-schema` / `-migration-safety` / `-companies` | 107/107 · 91/91 · 190/190 | same |
| `verify:platform-company-access` (new) | 116/116 | — |
| `ui:guardrails` | G1 24 · G2 244 (97 unresolvable) · G3 8 · G4 0 · G5 22 call sites / 21 keys — every finding count unchanged | same |
| `next build` (test-only configuration) | exit 0 | exit 0 |
| `verify:platform-browser` / `-companies-browser` | 138/138 · 111/111 | same |
| `verify:platform-company-access-browser` (new) | 64/64, 39 screenshots | — |
| tamper tests on the PO-02C layer and rules | 9/9 caught, tree restored | — |

Measured in the final run (in-process suite, 1,016 organizations, 300 tokens, loopback, 600 checks each): session
check p50 1.56 → 2.03 ms, p95 2.20 → 3.04 ms with enforcement on (2 → 3 queries; an earlier run measured p95 1.88 →
2.26 ms); the access lookup has primary-key paths for both tables and ending a company's sessions uses
`sessions_org_active_idx`. Race evidence: validations that finished before a suspension saw
the company active, every validation that started after it returned saw it suspended, overlapping ones saw either.

## 8. Change control

`verify/po02c-approved-delta.mts` records every changed file's hunks byte for byte against `7637e4e` (17 files, 67
hunks) and pins the 5 added files by sha256; both freeze verifiers read older layers through it. Group 26 of
`verify:page-archetypes` pins the five customer deltas line by line (session store and uploads additive; nine
dictionary entries; sign-in's only removed code is the in-loop recovery-code consumption; the session check's removed
lines are the old null-returning forms, and the per-request access check and ownership binding must be present).
Tamper tests: 9/9 caught (unrecorded and recorded removal of the per-request check, recorded removal of the signed-file
check, an unrecorded customer module reading the rule, enforcement on by default, a recorded rewrite of an existing
translation, TOTP after the lock, un-revoking sessions, a recorded early recovery-code spend); tree restored exactly.

## 9. Deployment prerequisites (nothing here was done; each step needs owner approval)

1. D-6 decided and the PO-02A objects installed and verified in production (`platform:db:check`), D-7 measurements done.
2. Deploy the code with `TENANT_ACCESS_ENFORCEMENT` **unset**: customer behavior is unchanged; the console can only
   reactivate.
3. Verify on production: `platform:db:check`, a smoke of sign-in, the dashboard and one upload, and that the server log
   shows no `[tenant-access]` line.
4. Only then, with explicit owner approval, set `TENANT_ACCESS_ENFORCEMENT=enabled` and restart. Monitor for
   `[tenant-access] access-control objects unavailable` (fail-closed denials).
5. Rollback: unset the switch and restart — enforcement stops at once; access rows and audit records stay; no data
   rollback is needed. Ended sessions are not restored (users sign in again).
6. D-8 (`CUSTOMER_LEGACY_TOKENS=reject`) is a separate decision; expected impact nil (session ids since Stage 11,
   30-day token lifetime), but it signs out any remaining legacy token.

## 10. Open owner decisions

- **D-6** production migration mechanism (PO-02A §5) — required before any deployment.
- **D-7** read-only production measurements (session table size, `sessions.org_id = users.org_id`) — before enabling.
- **D-8** legacy jti-less token rejection — implemented as a proposal behind its own switch; not enabled.
- **D-9** platform session lifetimes (12 h absolute / 30 min idle) — still provisional.
- Kept as before (not changed by PO-02C): neutral platform tags, the owner e-mail display policy, the not-found
  behavior. The suspension sign-in message wording is the one this prompt specified (EN/AR), for owner confirmation.

## 11. Local preview (owner inspection; loopback `_test_only_` databases only)

```
PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> npm run platform:preview-db
export DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<the printed *_test_only_* name>
npm run platform:bootstrap               # fictional Platform Owner + authenticator enrolment
npm run platform:preview-companies 120   # synthetic companies, users, access rows and invitations
npx next build && PLATFORM_CONSOLE_ENABLED=true TENANT_ACCESS_ENFORCEMENT=enabled npx next start -p 3000 -H 127.0.0.1
# console:  http://localhost:3000/platform/login → Companies → a company → Access & controls → Suspend / Reactivate
# customer: register a fictional company at /register, suspend it from the console, reload → /access-suspended
# without TENANT_ACCESS_ENFORCEMENT: Suspend is disabled and says why; customers behave exactly as before PO-02C
```

## Appendix — proposed PO-02D prompt (NOT executed; for owner review)

~~~text
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-02D — SAFE COMPANY INVITATION ONBOARDING (COPY-LINK ONLY)

Repository Delowar01/Elite-ERP, branch feat/platform-owner. Baselines: the reviewed PO-02C head; the live ERP 621f156 stays
unchanged; PR #11 stays a draft.

AUTHORIZATION: isolated development of PO-02D on feat/platform-owner only — local implementation and testing with
fictional data in disposable loopback PostgreSQL databases named *_test_only_*; reviewable commits pushed to that branch.
NOT authorized: merge, deployment, PR creation, production Neon/VPS access, production migrations or db:push, real
invitations, any e-mail or notification sending, impersonation, changes to accounting/finance/inventory/HR/documents/
payments, packages or subscriptions (PO-04/PO-05), user administration (PO-03), the public /register cutover (D-3).

STEP 1 — Baseline: verify the PO-02C head, rerun every Platform Owner, customer-security and freeze suite; re-read
PO02A_DEVELOPMENT.md §6.4 (the invitation contract) and decide, with evidence, whether the initial package fields are
required before any invitation exists (PO-02A §4 / Plan.md minimum Trial package) — if they are, STOP and report.

STEP 2 — Create (platform.companies.invite): flag → origin → live platform session → permission → fresh password + TOTP
step-up → validation (company name, country and currency exactly as /register validates them, owner name, normalized
owner e-mail that no customer user and no other pending invitation holds) → ONE transaction: revoke any pending row for
that e-mail, insert the invitation with ONLY sha256(token) stored (32 random bytes, base64url), audit
invitation.created → return the link ONCE (copy-link only; never logged, never stored in plain text).

STEP 3 — Revoke and re-issue (same step-up): revoke records the operator and time; re-issue = revoke + create in one
transaction; both audited; expired invitations stay visible as expired until revoked.

STEP 4 — Accept (public, token, rate-limited, CSRF-protected, allow-listed in the customer proxy): ONE transaction —
hash the token, select the invitation FOR UPDATE; pending, unexpired and unrevoked or a typed error that reveals
nothing about other invitations; re-check e-mail uniqueness; create orgs + the owner user (the recipient sets the
password, the existing password policy applies) + seedOrgDefaults + the ACTIVE tenant_access_controls row; set
accepted_at / accepted_org_id; audit invitation.accepted; commit; then sign the owner in through the existing customer
session issuance (which the PO-02C gate checks). A double-submitted acceptance yields exactly one company.

STEP 5 — UI (EN/AR, RTL, light/dark, desktop/tablet/mobile): Invite company dialog (the PO-02C dialog pattern),
pending/expired invitations with Revoke and Re-issue, the one-time link display with copy, the public acceptance page
in the customer sign-in layout; neutral platform tags; no new status colours.

STEP 6 — Tests: authorization matrix; step-up (password, TOTP, replay, throttle); token entropy, hash-only storage,
single use, expiry, revoke, re-issue; concurrent acceptance; e-mail collisions incl. case variants; audit-failure
rollback; acceptance creating exactly one org, owner, access row and seeded defaults; no cross-company effect;
business-table checksums; secrets never in logs, audit or HTML; the PO-02C gate on the new owner session; browser
suite with screenshots; every existing suite individually and in its chain; a PO-02D approved-delta layer with tamper
tests.

STEP 7 — Handover A–N in one copyable block; STOP. Do not send an invitation outside the test databases.
~~~
