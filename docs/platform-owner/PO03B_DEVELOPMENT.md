# Platform Owner — PO-03B: customer-user management (directory, disable / enable, session revocation)

> Phase PO-03B of the Elite ERP Platform Owner programme (Prompt 2 of 16, Workstream B). **Development only.** The
> console's **Users** section becomes an operational customer-user directory, with an audited user page and two
> step-up-protected controls: **disable / enable a customer user** and **revoke a customer user's sessions**. Both
> controls make their changes through **one shared customer-user mutation service**
> (`src/lib/team/customer-user-core.ts`), which the customer Team actions also use. So the Team actions and the
> Platform Owner controls enforce the same primary-owner and last-active-owner rules, in the PO-03A lock order. There
> is no second, weaker route.
>
> The Team-field allowlist from the security hotfix candidate (Workstream A, branch
> `fix/team-sensitive-fields-exposure`) is carried as its own commit (`eb43dbe`). It is line-identical to the hotfix
> commit `35d5dcc`.
>
> Out of scope and not done:
> - No schema change, migration or seed.
> - No user impersonation, password reset, role editing or ownership transfer.
> - No seat limit enforced.
> - No customer-user invitation.
> - No message sent.
> - Sign-in, MFA, registration and invitation acceptance are unchanged.
>
> Every database used was a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one
> was dropped. Production (Neon, the Hostinger VPS) was not accessed.
>
> **Release status: NO-GO for production.** The implementation is complete and verified for development. Release still
> needs:
> - the PO-02 foundation SQL in production (D-6, §N.1);
> - the owner decisions in §M;
> - the Next.js security-advisory gate (§N.3).

---

## A. Completion status

| Step | Status |
|---|---|
| B0 — Carry the hotfix | done. `eb43dbe` is the Workstream A allowlist on top of PO-03A's Team page, line-identical to `35d5dcc`. PO-03A's Team-page changes (seat card, primary-owner badge, protected menu) are untouched (§B, §L). |
| B1 — Users directory | done. `/platform/users` shows name and e-mail, company, role, active/disabled, last recorded sign-in, MFA on/off, account creation date, primary-owner designation and the company's seat usage. It has search, four filters, five sorts and numbered pages. Every column is on an explicit allowlist, and server-side authorization (`platform.users.read`) applies on every read (§D). |
| B2 — Account controls | done. **Disable / enable** and **revoke sessions**. Each needs `platform.users.manage`, a fresh replay-protected TOTP code, a 10–500 character reason and the durable step-up throttle. Each runs as one READ COMMITTED transaction in the PO-03A lock order. Primary-owner and last-active-owner protection apply; sessions end on disable; company data is preserved; platform audit and customer security evidence are written inside the transaction (§E). |
| B3 — Shared mutation service | done. `src/lib/team/customer-user-core.ts`: lock order, owner rules, status write, session end and customer evidence. The Team-change service calls it with the same statements in the same order and the same messages (§G). |
| B4 — UI | done. Directory, user detail, status and primary-owner tags, both confirmation dialogs, and loading, error and empty states. English and Saudi Arabic, right-to-left, light and dark, 1440 / 1024 / 768 / 390 / 360 px, white text on orange (§I). |
| B5 — Tests | done. `verify:platform-users` **76/76**: real PostgreSQL, deterministic barriers, categories A–R covering all 18 required verifications. `verify:platform-users-browser` **30/30**, 26 screenshots (§F, §H). |
| B6 — Full regression | done at `335f692` (§J). Green: TypeScript; ESLint identical to `dca3362` finding for finding; `verify:static` 77/77 (its 22 suites also each alone); ACC-01; customer security 22/22 and 18/18; boundary 180/180; `verify:platform` 22 suites, **2,334/2,334** (also each alone); the undo proof; the UI guardrails; all seven Platform Owner browser suites, the login race and two customer browser tiers. The build **compiles**, then stops at the pre-existing Next.js advisory gate (§N.3). |
| B7 — Change control | done. PO-03B approved-delta layer: 14 files, 31 hunks, 8 added files. Freeze-verifier hooks added. Boundary rule 47 (14 checks) added, with named PO-03B exceptions in earlier rules. Four older suites' pins extended by name. **19 tamper cases, every one caught by the verifiers designed to catch it.** The undo proof is byte-exact (§K). |
| B8 — This document | done |
| Git | Seven commits on `feat/platform-owner` only (six code and test commits, and this document). No force-push, merge, deployment or PR change (§B). |
| **STOP gate** | **STOPPED.** PO-03C and Prompt 3 are not started. No production access, no real user or company changed, nothing deployed (§P). |

### A.1 Findings for owner attention

1. **The Team-field exposure on the live ERP is fixed only on two unmerged branches.** The hotfix candidate is
   `fix/team-sensitive-fields-exposure` at `94f936e`: fix `35d5dcc` plus its handover
   `docs/security/TEAM_SENSITIVE_FIELDS_HOTFIX.md`. The development carry is `eb43dbe` on this branch. Production `main`
   (`621f156`) still sends every team member's bcrypt password hash and MFA envelopes to the browser of any owner or
   admin who opens Business Settings. Releasing the hotfix is a separate owner approval.
2. **A customer Team deactivation still does not end the member's sessions.** This is pre-existing behaviour, kept on
   purpose (`verify:platform-users` N2). The deactivated member can no longer use those sessions, because every
   customer request re-checks `is_active`. A Platform Owner disable *does* end them (reason `disabled`). Whether the
   Team action should end sessions too is an owner decision (§M, M-3). The shared service already provides
   `endCustomerUserSessions`.
3. **Residual R-1 (tenant-access enforcement off only).** With `TENANT_ACCESS_ENFORCEMENT` enabled, revocation is
   race-safe through the PO-02C.1 company-row lock protocol (§H). With it off, the legacy sign-in takes no company-row
   lock. A sign-in that commits just after a *revocation* creates a new, valid session: it is a new sign-in by someone
   who knows the password, the same as one a minute later. A *disable* has no such gap. A session inserted after a
   disable is unusable (`is_active` is checked on every request), and enabling the account ends it (reason
   `reenabled`, I7). The production configuration should keep enforcement enabled before these controls are used
   (§M, M-4).
4. **The step-up asks for TOTP and a reason, not the operator's password.** This matches the approved PO-02D2
   invitation revocation and the PO-02C access change. Asking for a password as well is an owner decision (§M, M-1).
5. **Security Center (pre-existing, low / informational, unchanged).** The customer Security Center passes the current
   session's `jti` and the user's own sessions' `tokenHash` values to its client component (Workstream A §6). Recorded
   only; not changed here.

---

## B. Branch, commits and exact SHAs

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; no other branch touched by this workstream) |
| Base | `dca33623d7e007866fadca301faea8801f190f46` (PO-03A handover) |
| Code head (the regression ran here) | `335f69299c1ef8101b51cea8330f20328489e499` |
| Final head | the commit that adds this document (reported in the handover) |
| `main` | `621f156f7b129b9c2e289bc46d314ce7587beec2`, unchanged |
| PR #11 | draft, unmerged, untouched |

| # | Commit | What | Size |
|---|---|---|---|
| 1 | `eb43dbe45cd02794df6cccc51b61bf9988d77aa2` | fix(team): send only the five Team member fields to the browser (carry of the TFX hotfix) | 2 files, +11 / −2 |
| 2 | `6346fb5e2dda1db856d17079e014e916b2ed0b69` | refactor(team): one shared customer-user mutation service for the Team and Platform Owner controls | 2 files, +168 / −32 |
| 3 | `101c00841556caf70e5f915114cb77b097aae46c` | feat(platform): PO-03B user directory, user detail and account controls | 16 files, +2187 / −44 |
| 4 | `eb1dc6d176e17239be1117120fe1635fb71d3f50` | test(platform): PO-03B user-management server and browser suites, boundary rule 47 | 5 files, +1469 / −28 |
| 5 | `7ad97228bd1ef88a89edc9680d85ae957d0d6fb4` | chore(platform): PO-03B approved-delta layer and freeze-verifier hooks | 3 files, +222 / −10 |
| 6 | `335f69299c1ef8101b51cea8330f20328489e499` | test(platform): PO-03B — extend four older suites' pins by name | 4 files, +22 / −9 |
| 7 | (this document) | docs(platform): PO-03B handover | 1 file |

The regression ran on the code head (`335f692`). The verification is for that whole head, not for each intermediate
commit. Commit 6 exists because the first regression attempts found four older suites whose pins did not yet name
PO-03B's changes (§J.1).

---

## C. Changed-file inventory

32 files against `dca3362` (+4079 / −125), plus this document.

| File | Kind | Change | Layer |
|---|---|---|---|
| `src/app/(app)/settings/organization/page.tsx` | customer page | the Team query selects exactly `id, name, email, role, isActive` (the hotfix, carried) | edit |
| `src/app/(app)/settings/team/team-panel.tsx` | customer component | prop type narrowed to `TeamMember`, a `Pick` of exactly `id`, `name`, `email`, `role`, `isActive` | edit |
| `src/lib/team/member-changes.ts` | customer service | the Team-change service calls the shared service for its locks, owner rules and status write | edit |
| `src/lib/team/customer-user-core.ts` | customer service | **NEW** — the shared customer-user mutation service (§G) | added |
| `src/lib/platform/customer-users.ts` | platform library | **NEW** — the read model: directory, metrics, audited detail, the dialogs' live state | added |
| `src/lib/platform/customer-user-actions.ts` | platform library | **NEW** — the two controls' cores (the ONE platform module importing the shared service) | added |
| `src/lib/platform/guards.ts` | platform library | two permissions: `platform.users.read`, `platform.users.manage` | edit |
| `src/lib/platform/errors.ts` | platform library | three codes: `LAST_ACTIVE_OWNER`, `OWNER_PROTECTION_UNAVAILABLE`, `CHANGE_IN_PROGRESS` (EN/AR) | edit |
| `src/lib/platform/primary-owners.ts` | platform library | `readPrimaryOwnerUserIds` — one batch read for a directory page (read only) | edit |
| `src/lib/platform/seat-accounting.ts` | platform library | `readSeatAccountingForCompanies` — the PO-03A rules, batched for a page of companies (read only, never enforced) | edit |
| `src/app/(platform)/customer-user-actions.ts` | server actions | **NEW** — three actions with strict schemas: state read, status change, session revocation | added |
| `src/app/(platform)/platform/(console)/users/page.tsx` | console page | the operational directory (was a preview placeholder) | edit |
| `src/app/(platform)/platform/(console)/users/[userId]/page.tsx` | console page | **NEW** — the audited user page | added |
| `src/app/(platform)/platform/(console)/users/[userId]/not-found.tsx` | console page | **NEW** — unknown or malformed user | added |
| `src/app/(platform)/platform/(console)/companies/[orgId]/page.tsx` | console page | **Manage users** is now a link to that company's users | edit |
| `src/components/platform/users-kit.tsx` | component | **NEW** — directory table and cards, role, status, MFA and seat cells | added |
| `src/components/platform/customer-user-controls.tsx` | component | **NEW** — the two confirmation dialogs | added |
| `src/components/platform/companies-kit.tsx` | component | state table: `user_account` (active / disabled), `user_designation` (primary owner) | edit |
| `src/components/platform/i18n.ts` | strings | 107 new strings, each English and Saudi Arabic | edit |
| `src/app/(platform)/platform.css` | styles | two layout classes | edit |
| `tests/security/platform-boundary.test.mjs` | test | rule 47 (14 checks) + named PO-03B exceptions in earlier rules — 180/180 | — |
| `verify/verify-platform-users.mts` | test | **NEW** — 76 checks (A–R) | — |
| `verify/verify-platform-users-browser.mts` | test | **NEW** — 30 checks (U1–U12), screenshots | — |
| `verify/verify-platform-primary-owner.mts` | test | N3 re-targeted: `users.is_active` now has one writer, the shared service | — |
| `verify/verify-platform-containment.mts` | test | the tenant-path pin also undoes the PO-03B layer (the two carried Team files), so they still reduce to `621f156` | — |
| `verify/verify-platform-seat-accounting.mts` | test | N1 and N5 name the customer-user read model, the user pages and the controls (display only; the controls read no seat number) | — |
| `verify/verify-platform-companies.mts` | test | the permission-list pin names PO-03B's two permissions | — |
| `verify/verify-platform-invitations.mts` | test | #7 pins the permission list's last five entries (invite, then PO-03B's two) | — |
| `package.json` | scripts | `verify:platform-users`, `verify:platform-users-browser`; the first joins `verify:platform` | — |
| `verify/po03b-approved-delta.mts` | change control | **NEW** — the PO-03B layer | — |
| `verify/verify-document-form.mts` | change control | the PO-03B undo hook and check | edit |
| `verify/verify-page-archetypes.mts` | change control | the PO-03B undo hook and group 34 | edit |

Untouched: schema modules, SQL, migrations, seeds, sign-in, sessions, MFA, registration, invitation acceptance and
every business module. Page-archetypes group 34 enforces this (§K.1).

---

## D. User directory (B1)

### D.1 What a row shows — and only that

| Brief | Shown as | Source (allow-listed column or derived value) |
|---|---|---|
| User name and e-mail | name (link to the user page) and e-mail (kept left-to-right) | `users.name`, `users.email` |
| Company | company name (link) and `ORG-` reference | `orgs.id`, `orgs.name` |
| Role | Owner / Admin / Staff | `users.role` |
| Active / disabled | neutral status tag from the ONE state table | `users.is_active` |
| Last recorded sign-in | date and time, or "Never" | `users.last_login_at` |
| MFA | On / Off | `users.mfa_enabled` (a boolean — never the secret) |
| Account creation date | date | `users.created_at` |
| Primary-owner designation | "Primary owner" tag | `tenant_primary_owners` (read only; "not installed" if the foundation is absent) |
| Company seat usage | "5 of 3", "over by 2", "no allowance" | PO-03A seat accounting (display only) |

Each user also gets a `USR-000123` reference.

The read model never selects a whole row. No statement that reads `users`, `sessions` or `orgs` names a password, MFA,
recovery, token or network column (server A5–A6, boundary rule 47). The detail adds only these: the change marker,
whether the user is the last active owner, a **count** of live sessions (never a session), the company's seat
accounting and the Platform Owner events about the account.

### D.2 Search, filters, sorting, pagination

- **Search.** Name, e-mail, company name, `USR-` and `ORG-` references. Up to 100 characters. LIKE wildcards are
  matched literally, and control characters are refused.
- **Filters.** Role (owner / admin / staff), status (active / disabled), MFA (on / off) and company (`?org=<id>`). The
  company detail's **Manage users** opens this filter.
- **Sorts.** Newest (the default), oldest, name, latest sign-in (users who never signed in come last) and company.
- **Pages.** 10 / 25 / 50 rows (the default is 25 and the maximum is 50), numbered and up to page 10,000. Each page
  states its total and page count. A page costs a fixed number of queries whatever its size (Q7, no N+1).
- **Malformed parameters.** Any malformed parameter returns `VALIDATION_FAILED`. The page shows a clear message and a
  way to start over, never data and never an error page (U2).
- **No match.** An empty state with a hint.

### D.3 Authorization and data access

Every export of the read model authorizes first. The checks run in this order:
1. The console is enabled.
2. There is a live Platform Owner session (the platform token; a customer ERP session is never read: C3).
3. The session has the permission:
   - `platform.users.read` for the directory, metrics and detail;
   - `platform.users.manage` for the dialogs' live-state read.

Only the read model checks `platform.users.read`. Only the controls and that state read check
`platform.users.manage` (boundary rule 47). The console's `owner` role holds both (D3). The pages read data only
through the read model. They hold no server action, POST form or handler.

### D.4 The user page (`/platform/users/[userId]`)

The page has four panels:
- **Account:** details, status, MFA, last sign-in, created, live session count.
- **Controls:** the two actions and the protection notes.
- **Company seats:** read only.
- **Activity:** the Platform Owner events about the account, newest first, at most 20, with reasons, in the operator's
  language.

**Viewing a user is audited.** The view writes `customer_user.viewed` on `customer_user/<id>`, with the company and the
operator, before anything is returned. If that record cannot be written, nothing is shown (`AUDIT_UNAVAILABLE`, R2).
An unknown id and a malformed id get the same answer, not found (R3).

---

## E. Account controls and security checks (B2)

### E.1 Disable / enable — the order of checks (`setCustomerUserStatusCore`)

1. The console is enabled, then a same-origin check (CSRF), then a live Platform Owner session, then
   `platform.users.manage`.
2. The audit trail must be protected. A change that could not be recorded is never made.
3. The request format is checked without touching the database, so nothing is spent: user id, target
   (`disabled` / `active`), reason (10–500 characters, no control characters), the six-digit code shape, and the
   account version the page showed.
4. The user's company is looked up, unlocked, only to know which company row to lock first. An unknown user returns
   `NOT_FOUND`, and the attempt is recorded.
5. The durable step-up throttle is checked. It is shared with platform sign-in.
6. **One READ COMMITTED transaction:**
   1. Consume the TOTP code, with replay protection.
   2. Lock the company row (`FOR NO KEY UPDATE`).
   3. Lock the user row (`FOR NO KEY UPDATE`).
   4. Read the primary-owner mapping (`FOR SHARE`, fail closed).
   5. Version check: the account must be the one the page showed, or the change is refused with `VERSION_CONFLICT`.
   6. State check: the account must not already be in the target state, or the change is refused with `CONFLICT`.
   7. For a disable, the owner rules: the mapped primary owner is refused with `LAST_PRIMARY_OWNER`; the company's last
      active owner is refused with `LAST_ACTIVE_OWNER`.
   8. The status write, scoped to the user id **and** the company.
   9. Every live session of that one user is ended: reason `disabled` on a disable, and `reenabled` on an enable too,
      so no session from a racing sign-in can come back to life.
   10. The customer's own security event.
   11. The platform audit record.

   It is all or nothing.
7. Every refusal decided inside the transaction rolls it back, the TOTP code included. The refusal is then recorded as
   a rejected attempt with its stage: `mfa`, `replay`, `not_found`, `state`, `stale`, `primary_owner`, `last_owner`,
   `protection_unavailable` or `busy`. A bounded lock wait (`55P03`) or a deadlock (`40P01`) becomes
   `CHANGE_IN_PROGRESS`, and nothing is applied.

### E.2 Revoke sessions (`revokeCustomerUserSessionsCore`)

The authorization, audit protection, format checks (no version: revocation does not depend on the page's view),
company lookup and throttle are the same as for disable / enable. Then one READ COMMITTED transaction:
1. Consume the TOTP code.
2. Lock the company row.
3. Lock the user row.
4. End that user's live sessions in that company, reason `platform_revoked`. Expired and already-revoked sessions are
   left exactly as they were (H3).
5. Write the customer security event.
6. Write the platform audit record.

No other user's or company's sessions are touched (H4, C2).

### E.3 Answers the operator sees (English / Saudi Arabic)

| Code | English | العربية |
|---|---|---|
| `LAST_PRIMARY_OWNER` | The company must keep its primary owner. | يجب أن تحتفظ الشركة بمالكها الرئيسي. |
| `LAST_ACTIVE_OWNER` | The company must keep at least one active owner, so this account can't be disabled. | يجب أن تحتفظ الشركة بمالك نشط واحد على الأقل، لذا لا يمكن تعطيل هذا الحساب. |
| `VERSION_CONFLICT` | This record was changed by someone else. Refresh and try again. | عدّل شخص آخر هذا السجل. حدّث الصفحة وحاول مرة أخرى. |
| `CONFLICT` | This change conflicts with the current state. Refresh and try again. | يتعارض هذا التغيير مع الحالة الحالية. حدّث الصفحة وحاول مرة أخرى. |
| `MFA_INVALID` | The verification code is incorrect or has already been used. | رمز التحقق غير صحيح أو سبق استخدامه. |
| `CHANGE_IN_PROGRESS` | Another change to this company's users is in progress. Nothing was changed. Try again in a moment. | يجري تغيير آخر على مستخدمي هذه الشركة. لم يُغيَّر أي شيء. حاول مرة أخرى بعد لحظات. |
| `OWNER_PROTECTION_UNAVAILABLE` | Owner protection can't be checked right now, so nothing was changed. Try again later. | يتعذّر التحقق من حماية المالك حاليًا، لذا لم يُغيَّر أي شيء. حاول مرة أخرى لاحقًا. |
| `AUDIT_UNAVAILABLE` | This change was not applied because it could not be recorded in the audit trail. | لم يُطبَّق هذا التغيير لتعذّر تسجيله في سجل التدقيق. |

Before asking for a code, the dialog reads the account's live state (`platform.users.manage`):
- If the account is protected, it explains why and asks for nothing.
- If the account changed since the page loaded, it offers **Refresh** instead of the form (U9).

The server applies every rule regardless. A direct server-action POST to disable the primary owner is refused (U8).

### E.4 Evidence

| Where | What |
|---|---|
| Platform audit (`platform_audit_events`, inside the transaction) | `customer_user.disabled` / `customer_user.enabled` / `customer_user.sessions_revoked`: operator, company, user, reason, sessions ended, result. Refusals are recorded as rejected attempts with their stage. `customer_user.viewed` is recorded for each user-page view. |
| Customer security log (`security_events`, inside the same transaction) | `account.disabled_by_platform` / `account.enabled_by_platform` / `sessions.revoked_by_platform`, with the number of sessions ended and detail `platform_operator`. **IP, user agent, browser, OS and device are all empty, and the operator is not named.** The operator's network identity never reaches the customer's log (B3, boundary rule 47). |
| Never recorded anywhere | password, TOTP secret or code, recovery code, platform or customer token, session id or hash (P2–P4) |

An audit or evidence failure rolls the whole change back (L1–L4).

### E.5 What the controls deliberately do not do

- No user impersonation.
- No password reset or password administration.
- No role editing.
- No ownership transfer.
- No user deletion.
- No change to company data: the business tables are byte-identical after the whole suite (P1).
- Disabled users keep occupying their seat (PO-03A L-4). The seat count is display only.
- No message is sent.

---

## F. Security and concurrency tests (B5)

### F.1 `verify:platform-users` — 76/76 (real disposable PostgreSQL, deterministic barriers)

The suite uses one disposable database with the reviewed schema, the platform SQL and the PO-02D1B Trial seed. It
holds fictional companies, users, sessions and operators only. TEST-only secrets are generated in memory and never
printed. Every race runs in a known interleaving: a barrier (a held transaction or row lock) is observed waiting in
`pg_stat_activity` before it is released.

| Cat. | Brief # | What is proven | Checks |
|---|---|---|---|
| A | 1 | Every directory, detail and state field is allow-listed. No statement on a customer table names a secret column or selects a whole row. | 6 |
| B | 2, 18 | No canary hash, MFA or recovery envelope, session hash, token, user agent or IP in any output. No bcrypt-shaped string. The customer evidence carries no network identity. | 3 |
| C | 3 | A Team admin of company A cannot change a user of company B. The shared lock returns only the given company's users. A customer session cannot read the console. | 3 |
| D | 4 | No session, a forged token, a customer token, a cross-site request and an Origin-less request are all refused. The console switch is enforced. Permissions are real. A refused request changes nothing and spends no code. | 4 |
| E | 5 | A wrong code, a replayed code and another operator's code are refused. Malformed input spends no code. | 5 |
| F | 6 | The mapped primary owner cannot be disabled. The refusal is recorded, the code is rolled back and no evidence is written. | 3 |
| G | 7 | The last active owner cannot be disabled (legacy company). A second, non-primary owner can be disabled and enabled. | 4 |
| H | 8 | A disable ends every live session of that user (`disabled`) and nobody else's. Expired and revoked sessions are untouched. Evidence and audit are written. Enable ends stragglers (`reenabled`). A repeat is `CONFLICT`. | 7 |
| I | 9 | Revocation and disable against a concurrent sign-in, both orders (§H). Enforcement off: I7. | 7 |
| J | 10 | Two operators on one user: both wait at the company row. Exactly one applies; the other gets `VERSION_CONFLICT`. One success record and one rejected attempt. The refused code is not consumed. | 4 |
| K | 11 | A page loaded before another operator's decision cannot overwrite it. A customer Team role change moves the version too. | 2 |
| L | 12 | Audit down: nothing applied, no evidence, code not consumed, an incident line without secrets, the same code usable afterwards. A customer-evidence failure also applies nothing. | 4 |
| M | 13 | Legacy company: nothing inferred. Mapping table absent: legacy behaviour; with acceptance on: fail closed and recorded. | 3 |
| N | 14 | Team role change, deactivation and activation work through the same service, with the PO-03A messages and protections. | 3 |
| O | 15 | A disabled user still occupies a seat, never enforced. The Trial allowance and the over-limit fact are display only. No subscription, package, settings or mapping row is written. | 3 |
| P | 17, 18 | Every business table is byte-identical (checksum over all rows). No secret or canary in any audit row or captured output. | 4 |
| Q | — | Search, literal wildcards, four filters, five sorts, numbered pages, input validation, constant query count | 7 |
| R | — | The audited user view: the record is written or nothing is returned; NOT_FOUND for unknown and malformed ids; the bounded activity list | 4 |

### F.2 `verify:platform-users-browser` — 30/30 (real browser on the compiled build)

| Cat. | What is proven |
|---|---|
| U1 | The operational directory: live figures (users, active, disabled, two-factor) and the full row (5 of 3 seats, over by 2). Only the mapped primary owner carries the tag. |
| U2 | Search, the Disabled filter, pages of 10 sorted by name (page 2 continues page 1), the empty state with a hint, and a malformed query handled cleanly |
| U3 | **The real server-to-client payloads** (HTML and RSC) of the directory, the user page and this build's customer Team tab hold no canary and no bcrypt-shaped string. The Team tab sends only the five member fields. |
| U4–U7 | User page; revoke validation, a wrong code (the field is cleared, nothing changes) and success (**the customer's own browser is signed out**); disable (effects explained, focus held; the customer can no longer sign in); enable (the customer can sign in again); the audit trail and activity in order |
| U8 | The primary owner's Disable control is disabled with a visible reason. A direct server-action POST is refused (`LAST_PRIMARY_OWNER`). |
| U9 | A stale page is told to refresh; after refresh it shows the newer decision |
| U10 | English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360. For each: one h1, no horizontal overflow, every control named, every field labelled, white text on orange, nothing clipped, and the lang / dir / theme as chosen. The Arabic dialog works as a phone bottom sheet. Escape returns focus to the trigger. Numbers and e-mails stay left-to-right with Western digits. |
| U11 | The company detail's **Manage users** opens the filtered directory |
| U12 | With no platform cookie the request is redirected. A cross-site POST is refused. An unexpected field returns `VALIDATION_FAILED`. Nothing extra is recorded. |

### F.3 The 18 required verifications

| # | Verification | Where |
|---|---|---|
| 1 | Every user-list field is allow-listed | A1–A6; boundary rule 47 |
| 2 | No sensitive authentication field reaches the browser | B1–B2; browser U3 (real HTML / RSC payloads) |
| 3 | Cross-company data is never exposed to customer users | C1–C3 |
| 4 | Platform permissions are checked server-side | D1–D4; browser U8, U12 |
| 5 | Invalid or replayed TOTP is refused | E1–E5; browser U5 |
| 6 | A primary owner cannot be disabled | F1–F3; N3; browser U8 |
| 7 | The last active owner cannot be disabled | G1–G2; N3 |
| 8 | Disabling a user revokes their sessions | H1–H6; browser U6 |
| 9 | Session revocation survives concurrent sign-in | I1–I7 (§H) |
| 10 | Two operators changing one user cannot bypass authorization | J1–J4 |
| 11 | A stale page cannot overwrite newer decisions | K1–K2; browser U9 |
| 12 | Audit failure rolls back sensitive operations | L1–L4 |
| 13 | Legacy companies remain compatible | M1–M3; G1 |
| 14 | Existing Team actions remain functional | N1–N3; PO-03A primary-owner suite 83/83; customer browser tier (§J) |
| 15 | Trial seat accounting remains read-only | O1–O3; PO-03A seat-accounting suite (§J) |
| 16 | English / Arabic, mobile and both themes pass | browser U10 |
| 17 | No customer business records are modified | P1 |
| 18 | No password, MFA secret, recovery code or session token is exposed | B1–B3, P2–P4; browser U3 |

---

## G. Shared mutation-service design (B3)

### G.1 The module — `src/lib/team/customer-user-core.ts`

The module is server-only and imports exactly `server-only`, `drizzle-orm`, `@/db` and the Team ownership gate
(boundary rule 47). Exactly two modules import it:
- the customer Team-change service (`src/lib/team/member-changes.ts`);
- the platform controls (`src/lib/platform/customer-user-actions.ts`).

| Export | What it does |
|---|---|
| `lockCompanyUsers(tx, orgId, userIds)` | Sets a bounded `lock_timeout` (5 s), then locks the company row (`FOR NO KEY UPDATE`), then that company's given users in ascending id order (`FOR NO KEY UPDATE`). Each user comes back with its stale-page marker. A user of another company is simply absent. |
| `lockCompanyPrimaryOwner(tx, orgId)` | The mapped primary owner, read through the Team ownership gate (`FOR SHARE`, fail closed). |
| `lockCustomerUsers(tx, orgId, ids)` | Both of the above, in that order (the platform disable / enable). |
| `deactivationBlock(tx, user, primaryOwnerId)` | Returns `primary_owner` first, then `last_owner` (an owner with no other active owner), or `null`. |
| `setCustomerUserActive(tx, user, isActive)` | The ONE status write: `is_active` and `updated_at`, `WHERE id AND org_id`. |
| `endCustomerUserSessions(tx, user, reason, now)` | Ends one user's live sessions in one company. It sets `revoked_at` and `revoked_reason` where `org_id`, `user_id`, `revoked_at IS NULL` and `expires_at > now` all match, and returns the count. |
| `recordPlatformChangeEvidence(tx, user, …)` | The customer's own security event: one insert, all network fields null. |
| `companyOfCustomerUser`, `isOwnerProtectionUnavailable` / `hasOtherActiveOwner` | Helpers: the first two for the platform controls (which company row to lock; the fail-closed error); the third for the Team role-change rule |
| constants | `CUSTOMER_USER_LOCK_TIMEOUT = "5s"`; the reasons `disabled`, `reenabled`, `platform_revoked` |

The Team-change service imports `CUSTOMER_USER_LOCK_TIMEOUT`, `deactivationBlock`, `hasOtherActiveOwner`,
`lockCompanyPrimaryOwner`, `lockCompanyUsers` and `setCustomerUserActive`. The platform controls import exactly 11 names,
pinned by boundary rule 47: the three reasons, `companyOfCustomerUser`, `deactivationBlock`, `endCustomerUserSessions`,
`isOwnerProtectionUnavailable`, `lockCompanyUsers`, `lockCustomerUsers`, `recordPlatformChangeEvidence` and
`setCustomerUserActive`.

The service writes three things: a user's status (one update), one user's live sessions (one update) and the
customer's evidence (one insert). Nothing else (boundary rule 47).

### G.2 The lock order — unchanged from PO-03A

> **company row → affected user rows (ascending id) → primary-owner mapping → authorized mutation and audit**

- **Team change** (`lockTeamChange`): `lockCompanyUsers(tx, orgId, [actor, target])`, then the actor and target
  checks, then `lockCompanyPrimaryOwner`, then the rule checks, the write and the activity record.
- **Platform disable / enable**: TOTP consumption, then `lockCustomerUsers(tx, orgId, [user])`, then the version,
  state and owner rules, then the write, the session end, the customer evidence and the platform audit.
- **Platform revocation**: TOTP consumption, then `lockCompanyUsers(tx, orgId, [user])`, then the session end, the
  evidence and the audit.

The TOTP consumption runs on the platform's own tables before the first customer lock. It takes no customer lock, so
it cannot invert the order.

The same company-row lock serializes the Team changes, the platform user controls and the PO-02C access change. With
enforcement on, a customer sign-in takes a SHARE lock on the same row for its session insert (PO-02C.1). That is what
makes revocation race-safe (§H).

### G.3 Behaviour preserved

The Team-change service runs the same statements in the same order, with the same refusal messages and the same
activity records:
- the PO-03A primary-owner suite passes (83/83);
- its only change is N3, which now names the shared service as the single `is_active` writer;
- the role write stays in the Team service.

Boundary rule 46 names the shared service where the statements moved, with the same assertions. The Team
deactivation still leaves session rows as they were (N2). Changing that is an owner decision (M-3).

---

## H. Session-revocation race tests (B5 #9, #10, #11)

Every scenario runs on real PostgreSQL with independent connections. Each barrier is observed waiting in
`pg_stat_activity` before it is released, so the interleaving is known, not hoped for.

| Test | Interleaving | Result |
|---|---|---|
| I1–I2 | A customer sign-in (enforcement on) holds its SHARE lock on the company row mid-insert. The revocation starts. | The revocation **waits** at the company row. Once the sign-in commits, the revocation ends the session it created (`platform_revoked`) and counts it. |
| I3–I4 | The revocation holds the company row. A sign-in starts. | The sign-in **waits**. The revocation commits first and ends every session that existed. The waiting sign-in inserts its session only afterwards. It is a new sign-in, and it is the only live session. |
| I5 | A disable meets an in-flight sign-in | It waits, then ends the session the sign-in created (`disabled`) |
| I6 | A sign-in waits behind a disable | Its re-check refuses it (the account is inactive) and it creates no session |
| I7 | Enforcement **off** (the legacy sign-in takes no company-row lock); a session is inserted after a disable | The session is unusable, because the account is checked on every request. Enabling ends it (`reenabled`), so it never comes back to life. |
| J1–J4 | Two operators change one user at once | Both wait at the company row and serialize. Exactly one applies. The other sees the moved version and gets `VERSION_CONFLICT`. Sessions are ended once. There is one success record and one rejected attempt. The refused operator's code is not consumed. |
| K1–K2 | A page loaded before another decision | The older page's disable gets `VERSION_CONFLICT`. A customer Team role change also moves the marker. |

**The stale-page marker** is `to_char(users.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')`. It is the account row's exact
timestamp to the microsecond, and boundary rule 47 pins it as the same expression in the read model and the shared
service. Sign-in does not move it. A role, status or password change does.

**Residual R-1** (§A.1 item 3): with enforcement off, a legacy sign-in that commits just after a revocation is a new,
valid session. Disable has no such gap. Recommendation: keep `TENANT_ACCESS_ENFORCEMENT` enabled wherever the
controls are used (M-4).

---

## I. UI (B4) and screenshots

### I.1 The approved design system

- The console shell, cards, tables (cards on narrow screens), the GET filter form and the pager are the Companies
  pages' components.
- Status and designation are neutral tags from the ONE Platform Owner state table: `user_account` (Active / Disabled)
  and `user_designation` (Primary owner, crown icon). No users file chooses a badge tone (boundary rule 47).
- Dialogs use the existing dialog component, which becomes a bottom sheet on phones. Focus is held inside and returns
  to the trigger.
- Orange action buttons carry white text (U10).
- **Invite user** is shown disabled with its reason, because customer-user invitations are not in this phase.

States:
- **Loading:** the console's `loading.tsx`; the dialog's "checking" step; "Disabling… / Revoking…" while pending.
- **Errors:** the console's `error.tsx`; a malformed query message with a way back; every typed refusal in both
  languages; the user page's not-found.
- **Empty:** no users, no match.

### I.2 Screenshots of the final browser run

The screenshots are PNGs of fictional data only, in the session scratchpad. They are **not committed**, as in earlier
phases. A page screenshot shows no address bar, cookie or credential.

26 screenshots (`verify:platform-users-browser`, final run), named `<step>-<page>-<language>-<theme>-<width>.png`:

| File | What it shows |
|---|---|
| `20-users-directory-en-light-1440` | the directory: live figures, filters, the table with role, status, two-factor, last sign-in, created and seats (5 of 3, over by 2), the Primary owner tag |
| `21-user-page-en-light-1440` | the user page: account, controls, company seats, Platform Owner activity |
| `22-revoke-dialog-en-light-1440` | the session-revocation confirmation: effects, reason, authenticator code |
| `23-disable-dialog-en-light-1440` | the disable confirmation: signed out, no sign-in, data kept, seat still occupied, recorded |
| `24-user-disabled-en-light-1440` | after the disable: Disabled tag, Enable user, 0 sessions |
| `25-primary-owner-protected-en-light-1440` | the primary owner: Disable control disabled, with the reason shown |
| `26-users-filtered-by-company-en-light-1440` | Manage users from a company: the directory filtered to it, with a way back |
| `30-users-{en,ar}-{light,dark}-{1440,768,390}` (9) | the directory: English and Arabic (RTL), both themes, desktop / tablet / phone (cards); English/light/1440 is file 20 |
| `31-user-{en,ar}-{light,dark}-{1440,768,390}` (9) | the user page in the same matrix; English/light/1440 is file 21 |
| `32-disable-dialog-ar-dark-390` | the Arabic disable dialog as a phone bottom sheet, dark |

Tablet (768 px) is shot in English/light and Arabic/dark. The U10 layout audits cover every combination at 1440 / 1024
/ 768 / 390 / 360.

---

## J. Full regression results (B6)

TEST-only settings, loopback disposable databases, code head `335f692`.

### J.1 How the final run was reached

The final run did not pass at the first attempt. In every case the product code was fine: an older suite's pin had
not yet been told about a PO-03B change.

1. **First attempt, at `7ad9722`.** The static and security stages were green. The `verify:platform` chain stopped at
   `verify:platform-containment`, **86/87**: its tenant-path pin did not undo the PO-03B layer for the two carried Team
   files. Run directly, `verify:platform-seat-accounting` showed **41/43**: N1 and N5 did not know the user read model
   and pages.
2. **Second attempt, at `7614197`**, with those two pins extended. The chain stopped at `verify:platform-companies`,
   **191/192**. A sweep of the remaining suites found `verify:platform-invitations` **186/187**. Both pin the exact
   permission list.
3. **The fix.** All four extensions were folded into one commit (`335f692`, §K.3). A pre-flight on that tree ran the
   build and every browser suite (seven Platform Owner suites, the login race and two customer tiers): all green.
   **The full regression below then ran from the start at `335f692`.** It was resumed twice after container restarts;
   the runner refuses to resume if HEAD moved or the tree is dirty, and re-runs any step not recorded green.

### J.2 Results at `335f692`

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint (`src tests scripts verify`) | 28 findings (7 errors, 21 warnings), **identical to `dca3362` finding for finding**. All are pre-existing; none is in a PO-03B file. |
| `verify:static`, the chain | **77/77** |
| `verify:static`, each of its 22 suites alone | 0 failures. Includes document-form 93/93, page-archetypes 316/316, status-registry 90/90, shell 87/87 and provider-harness 302/302. |
| ACC-01 `verify:inventory-costing` / `verify:project-costing` | 171 passed, 0 failed / 50/50 |
| Customer security `access-control` / `crypto-policy` | 22/22 / 18/18 |
| `platform-boundary` | **180/180** |
| `verify:platform`, the chain (22 suites) | **2,334/2,334** (862 s) |
| `verify:platform`, each suite alone | 0 failures (22 suites) |
| PO-03A primary-owner / seat-accounting | 83/83 / 43/43 |
| PO-02D3 invitation acceptance / e-mail uniqueness | 94/94 / 39/39 |
| PO-02D2 invitations | 187/187 |
| PO-02C company access | 116/116 |
| PO-03B `verify:platform-users` | **76/76** |
| Undo proof | PASS (14 files, 31 hunks, 8 added; no `src/` or `drizzle/` path outside the layer) |
| `ui:guardrails` | pass (the tracked baseline JSON restored afterwards) |
| `next build` (test configuration) | compiles (70/70 pages); stopped by the advisory gate (§N.3) |
| Browser — PO-01B console | 138/138 |
| Browser — PO-02B companies | 111/111 |
| Browser — PO-02C company access | 64/64 |
| PO-02C.1 login race (on the build) | 51/51 |
| Browser — PO-02D2 invitations | 78/78 |
| Browser — PO-02D3 acceptance | 99/99 |
| Browser — PO-03A users & seats | 23/23 |
| Browser — **PO-03B users** | **30/30** (26 screenshots) |
| Customer browser tier `staff-runtime` / `shell-runtime` | pass / pass |
| Tamper tests | 19 cases, every one caught (§K.4) |

The working tree was clean before and after the run. Every disposable database was dropped, and the disposable
cluster itself is removed at the end of the phase.

### J.3 Scope of the browser regression

The customer browser tier holds 49 suites. The two that drive the Team tab and role-gated actions (`staff-runtime`,
`shell-runtime`) were run, the same scope as PO-03A and the hotfix. PO-03B changes no customer file outside the Team
area (page-archetypes group 34), and the PO-03A users & seats browser suite drives the Team tab end to end. Every
Platform Owner browser suite was run.

---

## K. Change control (B7)

### K.1 The layer — `verify/po03b-approved-delta.mts`

It follows the rule every earlier phase used: **no re-baseline**.
- **14 changed files, 31 hunks**, recorded byte for byte as `[dca3362's text, PO-03B's text]`. Undone, each file is
  `dca3362`'s to the byte (`PO03B_BASE_SHA`).
- **8 added files**, recorded by content hash (`PO03B_NEW`).

Both freeze verifiers read each file through the PO-03B undo before PO-03A's, so every older pin keeps its strength.
Both prove the hunks are each file's only change:
- `verify:document-form` 93/93;
- `verify:page-archetypes` 316/316, in group 34.

Group 34 also pins three more things:
- the base commit;
- the scope: three customer files, all in the Team area; no auth, session, sign-in, registration, MFA, schema, SQL or
  business file;
- the only new route: the user page and its not-found.

**Undo proof:** PASS. 14 files are byte-exact and 8 added files are as recorded. No `src/` or `drizzle/` path lies
outside the layer. The paths that differ from `dca3362` but are frozen by no layer are this phase's tests, its layer
and `package.json`, each reviewed as an addition.

### K.2 `tests/security/platform-boundary.test.mjs` — 180/180

Rule 47 adds 14 checks:
- ONE platform → customer bridge: the shared service's names, imports and importers.
- What the shared service writes, and the customer evidence with no network identity.
- The stale-page marker expression.
- The exact order of both controls.
- The controls write nothing themselves.
- The read model's allow-listed columns and its audited view.
- Which modules check the two permissions.
- The three server actions' strict schemas.
- The pages read only through the read model.
- Neutral state tags.
- Manage users is a link.
- The carried Team allowlist.

Earlier rules (11, 12, 18, 21, 23, 25, 29, 33, 39 and 46) gained named PO-03B entries only. Nothing was weakened. In
rule 46, the PO-03A Team-change pins now name the shared service where the statements moved, with the same assertions.

### K.3 Older suites — pins extended by named additions only

| Suite | Pin | PO-03B addition |
|---|---|---|
| `verify:platform-primary-owner` | N3: one writer each of `users.role` and `users.is_active` | `is_active` is now written only by the shared service; `role` still only by the Team service. Each has one update. |
| `verify:platform-containment` | tenant paths reduce to `621f156` through the recorded layers | the PO-03B layer is undone first (the two carried Team files); no file added |
| `verify:platform-seat-accounting` | N1: who uses the seat service; N5: who reads `overLimit` / `remaining` | N1 adds the customer-user read model. N5 adds the user directory, the user page and their read model (display only), plus a new assertion: the user controls name no seat number. |
| `verify:platform-companies` | the exact permission list | adds `platform.users.read`, `platform.users.manage` |
| `verify:platform-invitations` | #7: `platform.companies.invite` after read and manage_access | the pinned tail is now the last five entries, the two users permissions after invite |

### K.4 Tamper tests — 19 cases, every one caught

Each case changes one thing, runs the verifier(s) designed to catch it, and restores the file byte for byte (sha256
compared; created files removed).

| Case | Tamper | Caught by |
|---|---|---|
| T01 | an extra line in a recorded file (`guards.ts`) | document-form (7 fail), page-archetypes (7) |
| T02 | an added file changed (lock timeout `5s` → `50s`) | document-form (2), page-archetypes (2), boundary (1) |
| T03 | an unrecorded new file under `src/lib/platform` | page-archetypes (3), boundary (1) |
| T04 | the Team page goes back to `db.select()` (every column) | document-form (3), page-archetypes (9), boundary (1) |
| T05 | the stale-page check removed | boundary (1) |
| T06 | the customer evidence takes a network value | boundary (1), document-form (2), page-archetypes (2) |
| T07 | the read model selects `passwordHash` | boundary (1) |
| T08 | the Team service writes the status itself (bypassing the shared service) | boundary (1), primary-owner (2), document-form (3), page-archetypes (3) |
| T09 | a second platform module imports the shared service | boundary (1) |
| T10b | the layer's base commit changed | page-archetypes (2), the verifier that pins it, as in PO-03A's T18. A first run of T10 also listed document-form, which by design does not pin the base constant, so that run reads "missed"; the corrected case was re-run. |
| T11 | a recorded hunk's text edited in the layer | document-form (7), page-archetypes (7) |
| T12 | a recorded base hash edited in the layer | document-form (2), page-archetypes (2) |
| T13 | a recorded added-file hash edited in the layer | document-form (2), page-archetypes (2) |
| T14 | an unrecorded change to the Team panel (a carried file) | containment (3), document-form (3), page-archetypes (7) |
| T15 | a user control names a seat number | seat-accounting (2), page-archetypes (2) |
| T16 | an extra permission (`platform.users.impersonate`) appended to the list | companies, invitations, boundary (3), document-form (7), page-archetypes (7) |
| R1 | **runtime:** disable no longer ends sessions | `verify:platform-users` (11 fail) |
| R2 | **runtime:** the version check removed | `verify:platform-users` (7) |
| R3 | **runtime:** the company-row lock removed | `verify:platform-users` (10), primary-owner (2) |

After the first set of runs, the tree was compared with a backup: identical (26 files, 0 differing). T14–T16 ran after
the final regression; the tree was clean afterwards.

---

## L. Existing customer compatibility

| Area | Result |
|---|---|
| Team page (Business Settings) | It sends only `id, name, email, role, isActive` (U3; boundary rule 47; T04). PO-03A's seat card, primary-owner badge and protected menu are unchanged. Every Team action works: N1–N3, and the PO-03A primary-owner suite 83/83. |
| Team actions | Same statements, order, messages and activity records through the shared service (§G.3). A Team deactivation still leaves sessions in place (N2, pre-existing). |
| Customer browser tier | `staff-runtime` (drives the Team tab and role-gated actions) and `shell-runtime` on this build: both pass (§J) |
| Customer Security Center | It shows the three new event types as their raw type text, like every other type, with empty network columns. Threat detection counts only failed sign-ins, failed MFA and rate limits, so a platform change raises no alert. |
| Sign-in, sessions, MFA, registration, invitation acceptance | Not in the diff (page-archetypes group 34) |
| Legacy companies (no mapping, no subscription) | Nothing is inferred. "Not designated" and "no allowance" are shown. The last active owner is protected (G1, M1–M3). |
| Business data | Byte-identical after the whole server suite (P1) |
| Database | No schema change, migration or seed |

---

## M. Remaining owner decisions

| # | Decision | Recommendation |
|---|---|---|
| M-1 | Step-up for the user controls: TOTP + reason (as built, the same as PO-02C / PO-02D2), or also the operator's password | keep TOTP + reason + throttle; revisit for all step-ups together |
| M-2 | Release the Workstream A hotfix to production before the Platform Owner staging deployment | yes, it is independent, minimal and verified (`docs/security/TEAM_SENSITIVE_FIELDS_HOTFIX.md` §7) |
| M-3 | Should a customer **Team** deactivation also end the member's sessions (as the platform disable does)? | yes, in a small customer-security change through `endCustomerUserSessions` (the requests are already refused) |
| M-4 | Use of the controls while `TENANT_ACCESS_ENFORCEMENT` is off (residual R-1) | enable enforcement before staging use; R-1 is documented |
| M-5 | Should viewing a user page stay an audited event (as built), and should the page's activity list include views? In the browser run, repeated views filled the 20-row list (screenshot `31-user-ar-dark-768`) | keep views audited (a view is a data-access event); show only changes in the page's list, with views kept in the platform activity log |
| M-6 | Who holds `platform.users.manage` beyond the console `owner` role | owner only until operator roles are designed |
| M-7 | Security Center `jti` / `tokenHash` to the client (Workstream A §6, low) | a separate reviewed change: opaque per-row id |
| M-8 | Carried from PO-03A: L-2 (mapping existing companies), L-3 / L-4 (seat caps, disabled users occupy a seat — kept), L-6 … L-10 | as recommended in PO-03A §L |

---

## N. Production database and build blockers

### N.1 D-6 — the foundation

PO-03B introduces no schema change. The directory's primary-owner designation and the owner protection need the
reviewed PO-02A and PO-02D1 SQL applied in production through the D-6 procedure (PO-02D1A.1 preflight H-1 / H-2 green),
and the PO-02D1B seed through its guarded runner. Each step needs its own owner approval. Release order:
1. the foundation;
2. PO-03A and PO-03B code;
3. acceptance, if ever enabled.

With the foundation absent, the directory says "not installed". The controls keep the legacy rules (owner protection
fail-closes only when acceptance is on) (M2–M3).

### N.2 D-7 — read-only measurements

Still pending, under separate authorization: the PO-03A legacy owner / seat analysis and the PO-02D3 e-mail audit.

### N.3 Next.js security-advisory gate

Next.js **16.4.3** (Turbopack), unchanged; no dependency upgraded (not authorized).

| | Result (final run at `335f692`) |
|---|---|
| Compilation | **succeeds**. "Compiled successfully in 38.7s", TypeScript finished, every page generated (70/70). The route table lists `ƒ /platform/users` and `ƒ /platform/users/[userId]`. |
| Warnings | 12 Turbopack warnings, all in the storage test double (`src/lib/storage/blob-client-fake.ts`, dynamic file patterns). The same 12 appear at PO-03A; none is in PO-03B code. |
| Full build | **stopped by the Next.js security-advisory gate**: `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.` (exit 1), as at every earlier phase and on the hotfix branch |
| Browser suites | run against `next start` on the compiled output, as in every earlier phase |

The build output's own instructions are tool output and were **not followed**: an upgrade command, a scripted question
to the user, and "retry to continue". The gate was not bypassed, disabled or worked around. Upgrading Next.js is an
owner decision about a dependency of the live ERP.

### N.4 Invitation acceptance

`CUSTOMER_INVITE_ACCEPTANCE_ENABLED` stays **off** and is enabled nowhere (PO-03A §M.4 unchanged).

---

## O. Proposed next phase — NOT executed

Following the sequence in PO-03A §N, **PO-03C — primary-owner transfer**:
- a step-up-protected Platform Owner action, and possibly a customer-side request, to move the
  `tenant_primary_owners` designation to another active owner of the same company;
- in the PO-03A lock order, extended to the two affected users in ascending id order;
- the old and new owner both locked;
- the mapping row updated in place;
- platform audit and customer evidence written atomically;
- tests for concurrent transfers, a transfer racing a disable and stale pages.

Prerequisites: the M-decisions above, the D-6 foundation plan, and the owner's approval of Prompt 3. **Not started.**

---

## P. Stop-gate verification

Checked on GitHub (read only) before this document was committed. The handover re-confirms it after the push.

| Check | Result |
|---|---|
| Production `main` | `621f156f7b129b9c2e289bc46d314ce7587beec2`, unchanged |
| PR #11 | open, **draft**, **unmerged**, last updated 2026-11-06; untouched |
| Branches pushed in Prompt 2 | `fix/team-sensitive-fields-exposure` (Workstream A) and `feat/platform-owner` (this workstream), and nothing else; no force-push |
| Production database / server | not accessed (Neon, the Hostinger VPS). Every database was a loopback, disposable `*_test_only_*` database with fictional rows, and dropped. |
| Real customer users | none read or modified. Every user was fictional (`.test` addresses). |
| Deployment | neither workstream merged, deployed or released; no service restarted |
| Messages, invitations | none sent |
| PO-03C / Prompt 3 | not started |

**STOP.** Prompt 3 needs the owner's approval.
