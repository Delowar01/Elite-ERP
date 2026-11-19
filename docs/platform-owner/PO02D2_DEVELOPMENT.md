# Platform Owner — PO-02D2: company invitation administration

> Phase PO-02D2 of the Elite ERP Platform Owner programme. **Development only.** It adds company invitation
> administration to the Platform Owner console — **create, revoke and re-issue an invitation, copy its one-time link
> once, and review every invitation's status and history** — behind a new feature flag, `PLATFORM_INVITATIONS_ENABLED`,
> which is **off by default**. The public acceptance flow (`/register/accept`) does **not** exist: no link created here can
> onboard anyone, and the console says so wherever a link or an invitation is shown. Nothing is delivered (no e-mail, SMS
> or WhatsApp; copy-link only). No organization, customer user, customer session or subscription was created by the
> code; `/register`, customer sign-in, MFA and customer sessions are unchanged; the default Trial values are unchanged;
> no paid plan was introduced; tenant-access enforcement is unchanged; no dependency was upgraded. Every database used was
> a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one was dropped. Production
> (Neon, the Hostinger VPS) was not accessed. Every invitation policy below is **PROVISIONAL — REQUIRES PRODUCTION OWNER
> APPROVAL** (§C).

---

## A. Completion status

| Step | Status |
|---|---|
| 3 — Baseline | done — `main` = `621f156` (live), `feat/platform-owner` = `1cbbbc1`, PR #11 open, **draft, unmerged**, untouched; PO-01A, PO-02A and PO-02D1A foundations verified (their suites green); the PO-02D1B Trial seed applied through its guarded runner to a disposable database and Trial v1 read back: **14 days, 3 users, 5 GB, nine module groups, SAR 0.00** (monthly and annual); full baseline regression green except the pre-existing Next.js advisory gate (§J) |
| 4 — Service operations | done — `createCompanyInvitation`, `revokeCompanyInvitation`, `reissueCompanyInvitation` (+ the read-only `previewCompanyInvitation` and `readCompanyInvitation`) in `src/lib/platform/invitation-actions.ts`; `getInvitationHistory` and `listInvitationHistory` in `src/lib/platform/invitations.ts` (§D–§G) |
| 5 — Authorization chain | done — both flags → configuration → same-origin (with the trusted-proxy host/IP rules) → live platform session → `platform.companies.invite`; mandatory step-up; transactional audit; durable TOTP replay protection; the sign-in throttle reused; a failed step-up never mutates (§D) |
| 6 — Validation | done — field rules, the ERP's own country catalogue and ISO 4217 currencies, normalized e-mails, the published default Trial only, cycle `trial`; the case-insensitive `users.email` race documented, not claimed closed (§D.4, §K) |
| 7 — Token and link | done — `crypto.randomBytes(32)` base64url, sha256 stored, `<CUSTOMER_PUBLIC_ORIGIN>/register/accept#t=<token>` from validated configuration only; shown once, never stored, logged, audited or re-displayable (§E) |
| 8 — Transactions | done — READ COMMITTED, one documented lock order, the change and its audit record in one transaction (§F, §G) |
| 9 — Concurrency tests | done — every listed race, with deterministic PostgreSQL barriers (§F.3) |
| 10 — UI | done — Invite dialog (form → review → step-up → one-time link), pending list actions, history view, invitation detail with its timeline, EN + natural Saudi Arabic, RTL, light/dark, 1440/1024/390 (§I) |
| 11 — Flag | done — exact `"true"`, requires the console flag; disabled mode is the PO-02B page exactly (§H) |
| 12 — Tests | done — `verify:platform-invitations` **187/187** (23 server categories, real PostgreSQL) and `verify:platform-invitations-browser` **78/78** (category 24, Chromium against the production build) (§J) |
| 13 — Full regression | done (§J); the build **compiles** and generates every page; completion is reported separately (§M) |
| 14 — Change control | done — PO-02D2 approved-delta layer (12 files, 58 hunks, 7 added files); boundary rules 11, 12, 21, 23, 25, 26, 29, 38, 39, 40 narrowed and rule 44 added; three older platform suites' exact pins extended by PO-02D2's named additions only (§B); 12 tamper tests, all caught; undo proof byte-exact (§J.3) |
| 15 — This document | done |
| 16 — Git | done — three reviewable commits (feat, test, docs) on `feat/platform-owner` only; no force-push, merge, deploy or PR change (§A.1) |
| **STOP gate** | **STOPPED.** No acceptance flow, no real invitation delivered, no customer organization or user created, nothing activated in production, PO-02D3 not started |

### A.1 Branch, commits and exact SHAs

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (approved PO-02D1B head) | `1cbbbc14c0634cd8489ab886adc9c5cd7ad1227f` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | open, draft, unmerged — not modified |
| PO-02D2 commits | 1. **feat** `0ce1826e883c1aeb1afb45f3486f75458fd082b4` — the invitation service and read models, the console actions and UI, flags / errors / guards / the companies read model, the approved-delta layer and its freeze-verifier hooks, the boundary rules and the three older platform suites' pin extensions. Checked on its own in a detached worktree: TypeScript exit 0, boundary 139/139, `verify:document-form` 90/90, `verify:page-archetypes` 307/307, `verify:platform-company-schema` 109/109, `verify:platform-onboarding-schema` 167/167, `verify:platform-companies` 190/190<br>2. **test** `d6f573e928713358893b29cfbbc46475befdc0e4` — `verify:platform-invitations`, its second-process helper, `verify:platform-invitations-browser`, both scripts and the `verify:platform` chain entry; the full regression in §J.4 ran at this commit<br>3. **docs** — this document (the branch head; its SHA is in the handover report) |

---

### A.2 Findings for owner attention

1. **Every invitation policy is provisional** (I-2 … I-11, R-5, P-5 — §C). They were implemented exactly as authorized for
   fictional local development/testing; none is an owner approval of production business rules.
2. **No schema change was needed or made.** The revocation reason and the re-issue links (old ⇄ new) live in the
   append-only audit trail; the hourly limit is counted from committed invitation rows; one pending invitation per owner
   e-mail is PO-02A's partial unique index. Consequences a reviewer should know: there is no revocation-reason column, and
   **no durable request-key idempotency** (a retried request is refused — a spent code or `CONFLICT` — never applied twice;
   a response lost after COMMIT cannot be recovered and the operator re-issues) (§F.4, §K).
3. **The customer-user e-mail check is application-level only.** `users.email` has no case-insensitive unique key, so a
   customer registration that commits after the check can still take the e-mail; PO-02D3 must re-check inside its own
   transaction. This is **not** closed by PO-02D2 (§D.4).
4. **A real UI defect was found and fixed during testing**: server actions that revalidated the page unmounted the
   re-issued row — and with it the dialog still showing the new one-time link. The invitation actions no longer
   revalidate; the dialogs refresh the page when the operator closes them (§I.3).
5. **Focus return** — the console dialog had no way to return focus to a control that opened it without a Radix trigger;
   an optional `returnFocus` target was added (existing callers unchanged) (§I.3).
6. **Next.js 16.4.3 advisory gate** — pre-existing; not bypassed; nothing upgraded (§M).
7. **Three older platform suites carried exact pins that PO-02D2 necessarily changes** (which modules may name the
   PO-02A / onboarding tables, the exact permission list, "no invitation flag exists"). Each pin was extended by
   PO-02D2's named additions only — no pattern or wildcard — so any other module, permission or flag still fails it
   (§B). The first final-regression run caught the stale company-schema pin (107/108) before this was done; the run in
   §J.4 is after it.

---

## B. Changed files

**Added — application (all Platform Owner code; recorded in the approved-delta layer)**

| File | Lines | sha256 (16) | Purpose |
|---|---|---|---|
| `src/lib/platform/invitation-actions.ts` | 559 | `30d688b6d68f416f` | the mutation service: create, revoke, re-issue (+ the read-only preview and current-state read); the only writer of invitations and their terms |
| `src/lib/platform/invitations.ts` | 486 | `36eb56d0cd0ba006` | shared rules (origin, token, validation, Trial, e-mail lock, collision checks, hourly count) and the history read models |
| `src/app/(platform)/invitation-actions.ts` | 152 | `d7c1ff6de2b30777` | the "use server" wrappers (strict schemas; no revalidation) |
| `src/components/platform/invitation-dialogs.tsx` | 791 | `7107ffa7a498761e` | Invite dialog, one-time link panel, re-issue / revoke dialogs |
| `src/components/platform/invitations-kit.tsx` | 146 | `a1f67f0b8b1c06c4` | history table, cards and the lifecycle timeline |
| `src/app/(platform)/platform/(console)/companies/invitations/[invitationId]/page.tsx` | 173 | `9536ba421bd094ea` | the invitation detail (audited view) |
| `src/app/(platform)/platform/(console)/companies/invitations/[invitationId]/not-found.tsx` | 24 | `644923dea954aa76` | "Invitation not found" (unknown id, or the flag off) |

**Added — verification and change control (not application code)**

| File | Lines | sha256 (16) | Purpose |
|---|---|---|---|
| `verify/verify-platform-invitations.mts` | 1131 | `8db83bfea223efe4` | the server suite (§J.1) |
| `verify/verify-platform-invitations-browser.mts` | 687 | `e7701d0b674b83e1` | the browser suite (§J.2) |
| `verify/platform/invitation-limit-child.mts` | 30 | `45ce8f12890b11d8` | the separate process proving the hourly limit is durable |
| `verify/po02d2-approved-delta.mts` | 219 | `9ff0b241085022a5` | the PO-02D2 approved-delta record (generated from the diff against 1cbbbc1) |
| `docs/platform-owner/PO02D2_DEVELOPMENT.md` | — | — | this document |

**Modified** (against 1cbbbc1)

| File | Lines | Change |
|---|---|---|
| `src/lib/platform/flags.ts` | +16 −1 | `isPlatformInvitationsEnabled` / `assertPlatformInvitationsEnabled` (exact `"true"`, requires the console flag); one doc line on the console flag |
| `src/lib/platform/errors.ts` | +2 | `INVITATIONS_DISABLED` (EN + AR) |
| `src/lib/platform/guards.ts` | +4 −1 | `platform.companies.invite` appended to the permission list |
| `src/lib/platform/companies.ts` | +6 −2 | `listPendingInvitations(…, { withId })` — opt-in invitation id; without it the rows are PO-02B's exactly |
| `src/components/platform/companies-kit.tsx` | +31 −8 | status table: `revoked` / `accepted` (labels + icons, no tone); invitation rows: optional detail link and actions; `ViewSegments` count optional |
| `src/components/platform/platform-dialog.tsx` | +15 | optional `returnFocus` (existing callers unchanged) |
| `src/components/platform/i18n.ts` | +119 | 118 EN / AR strings |
| `src/app/(platform)/platform.css` | +24 | the PO-02D2 section (logical properties and tokens only) |
| `src/app/(platform)/platform/(console)/companies/page.tsx` | +126 −13 | flag on: the Invite control, row actions and links, the history view; flag off: unchanged |
| `src/app/(platform)/platform/(console)/dashboard/page.tsx` | +4 −1 | flag on: the working Invite control; flag off: the PO-02B preview |
| `tests/security/platform-boundary.test.mjs` | +124 −25 | rules 11, 12, 21, 23, 25, 26, 29, 38, 39, 40 narrowed to PO-02D2's exact exceptions; rule 44 added |
| `verify/verify-document-form.mts` | +12 −4 | the PO-02D2 hooks (6 recorded hunks) and one check |
| `verify/verify-page-archetypes.mts` | +26 −6 | the PO-02D2 hooks (7 recorded hunks) and group 31 (3 checks) |
| `verify/verify-platform-company-schema.mts` | +4 −1 | static pin: the exact list of modules naming the PO-02A tables gains exactly the two invitation modules, plus one new check that they never name `tenant_access_controls` (**109/109**, was 108) |
| `verify/verify-platform-onboarding-schema.mts` | +12 −3 | static pins: the exact list of modules naming onboarding tables gains exactly the two invitation modules, which must name no settings, subscription, subscription-event or primary-owner table; `PLATFORM_INVITATIONS_ENABLED` now exists but only in `flags.ts`; the acceptance flag still nowhere (**167/167**, count unchanged) |
| `verify/verify-platform-companies.mts` | +3 −2 | static pin: the exact permission list gains exactly `platform.companies.invite` (**190/190**, count unchanged) |
| `package.json` | +3 −1 | `verify:platform-invitations`, `verify:platform-invitations-browser`; the `verify:platform` chain runs the server suite last. `db:push` unchanged |

The three older platform suites above pinned "exactly these files / exactly these permissions / no invitation flag" — each
pin now names PO-02D2's additions **exactly** (no pattern, no wildcard), so any other module, permission or flag still
fails it; nothing else in those suites changed.

**Not changed:** `/register`, customer sign-in, MFA, customer sessions, the customer dictionary and every customer route,
component and library; the schema modules, the reviewed SQL (PO-01A, PO-02A, PO-02D1A, PO-02D1B) and the drizzle-kit
journal; the Trial seed and its runner; the release preflight; tenant-access enforcement; every earlier approved-delta
record; the dependencies (`package-lock.json`).

---

## C. Provisional policies — PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL

Authorized for **fictional local development/testing only**. None of these is a final owner approval of a production
business rule; each must be confirmed (or changed) before any production use.

| ID | Policy | Implementation | Status |
|---|---|---|---|
| I-2 | Permission `platform.companies.invite` | appended to `PLATFORM_PERMISSIONS` (guards.ts); checked by every change and by the dialogs' current-state read; history reads use `platform.companies.read` | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-3 | Create / re-issue: password + fresh TOTP. Revoke: fresh TOTP + mandatory reason | password verified outside the transaction (throttled); the TOTP code consumed inside the change's transaction (compare-and-set on `platform_admins.mfa_last_totp_step`); revoke reason 10–500 characters, no control or direction-override characters | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-4 | 72-hour expiry | `INVITATION_TTL_MS`, written explicitly from the platform clock (never the column default) | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-5 | Reject a duplicate unexpired pending invitation; replace an expired slot through audited revocation | `CONFLICT` naming the pending `INV-…`; an expired holder is revoked in the same transaction, attributed to the operator, audited (`Expired; replaced by INV-…`) | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-6 | 20 per operator per hour, plus step-up throttling | creates **and** re-issues counted from committed rows in a rolling hour — before the step-up and again inside the transaction under the operator row lock; the sign-in throttle (5 failures / 15 min → 15-minute block; 20 / 24 h) shared by every step-up | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-7 | Normalize e-mail; case-insensitive existing-user conflict | `lower(btrim())`, printable ASCII only (so JavaScript and PostgreSQL lower-casing agree), the PO-02A CHECK shape, ≤ 320; `EMAIL_CONFLICT` when any customer user holds the e-mail in any letter case | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-8 | Copy-link only — no e-mail, SMS or WhatsApp | no delivery code exists; proven statically and at run time (§H) | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-9 | Canonical `CUSTOMER_PUBLIC_ORIGIN`; HTTPS except explicitly approved loopback tests | exactly an origin (no path, query, fragment or credentials), https; plain http only for a loopback host **and** `PLATFORM_INVITATIONS_LOOPBACK_ORIGIN === "true"` (a test-only approval — never to be set in production); anything else `CONFIG_ERROR` before anything is spent | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-10 | Duplicate company name → warning + explicit confirmation | a match against registered companies (`orgs.name`, case- and space-insensitive) or slot-holding invitations needs `confirmDuplicateName`; the dialog shows the counts and a confirmation checkbox; the server re-checks inside the transaction | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| I-11 | `INV-` + 8 hex, display only | `INV-` + the first 8 hex of the invitation id, upper case; never a key (actions use the id) | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| R-5 | `PLATFORM_INVITATIONS_ENABLED` default OFF, exact `"true"` | flags.ts: on only when the console flag is on **and** the value is exactly `"true"` | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |
| P-5 | Only the published default Trial version, cycle `trial` | the newest **published** version of the **active** default Trial package; terms written with the invitation (immutable, PO-02D1A trigger); the database refuses terms that reference a draft version (composite foreign key) | PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL |

**Derived behaviour (documented, not separately decided):** a re-issue offers the **current** published default Trial
(not necessarily the original's version); the re-issued invitation is attributed to the re-issuing operator and counts
against that operator's hourly limit.

---

## D. Authorization and permissions

### D.1 The chain (every change, in this order — `authorizeInvitationChange`)

1. `PLATFORM_CONSOLE_ENABLED === "true"` and `PLATFORM_INVITATIONS_ENABLED === "true"` (`assertPlatformInvitationsEnabled`;
   otherwise `CONSOLE_DISABLED` / `INVITATIONS_DISABLED`).
2. Same-origin (`assertSameOrigin`): `Origin` must name the addressed host; a present `Sec-Fetch-Site` must be
   `same-origin`; the addressed host is `Host`, or the single `X-Forwarded-Host` of a configured trusted proxy
   (`PLATFORM_TRUSTED_PROXY_HOPS`; a list is refused; a malformed setting fails closed). The client IP used for the
   throttle and the audit record comes from the same trusted-proxy rule.
3. Configuration and the live Platform Owner session (`authorizePlatformToken`: signing key, field encryption, the live
   session row, idle/absolute limits) — the platform token only; a customer ERP session is never read or accepted.
4. Permission `platform.companies.invite`.
5. Create / re-issue: `CUSTOMER_PUBLIC_ORIGIN` must be valid (else `CONFIG_ERROR`).
6. The audit trail must be protected (append-only triggers in force), else `CONFIG_ERROR`.
7. Request **format** (no database): a malformed request spends no second-factor code.
8. Read-only pre-checks (each repeated inside the transaction): the hourly limit, the published default Trial, an
   unexpired invitation holding the e-mail, a customer user with the e-mail, an unconfirmed name collision (create); the
   invitation's state (revoke / re-issue).
9. Step-up: the durable throttle shared with sign-in, then the password (create / re-issue).
10. ONE READ COMMITTED transaction: the TOTP code consumed first (replay-protected), then the owner e-mail lock, then the
    change and its audit record (§F).

A refused step-up records a throttle failure and an audited rejection and changes nothing; an invalid code is never
consumed; a code consumed by a transaction that then fails is rolled back with it.

### D.2 Permissions

| Permission | Who checks it |
|---|---|
| `platform.companies.read` | the company read model and (PO-02D2) the invitation history reads |
| `platform.companies.manage_access` | the PO-02C access action only |
| `platform.companies.invite` (new) | `src/lib/platform/invitation-actions.ts` only (boundary rule 23) |

### D.3 Audit vocabulary (entity `organization_invitation`)

`invitation.created`, `invitation.reissued`, `invitation.revoked` (operator reason; or the system reasons
`Re-issued as INV-…` / `Expired; replaced by INV-…`), `invitation.viewed` (the detail page), and the rejections
`invitation.create.rejected` (entity `new`), `invitation.revoke.rejected`, `invitation.reissue.rejected` with a `stage`
(`rate_limit`, `no_trial`, `pending_conflict`, `email_conflict`, `throttle`, `password`, `mfa`, `replay`, `accepted`).
Snapshots are allow-listed metadata (reference, company, country, currency, owner e-mail, package, version, cycle,
expiry, `replaces` / `replacedBy`) — never a token, hash or link.

### D.4 Validation

Company name 1–200 and owner name 1–200 (white space collapsed; control and bidirectional-override characters refused;
Arabic accepted as entered); industry optional, ≤ 100; company and owner e-mails normalized and validated; country from
the ERP catalogue (`COUNTRIES`, by exact name); currency an ISO 4217 code the ERP supports; the published default Trial
only, cycle `trial`. The database CHECKs remain the backstop.

**Documented race (not closed):** `users.email` has no case-insensitive unique constraint. The invitation refuses an
e-mail any customer user holds in any letter case, inside its transaction, but a customer registration committing after
that check is not seen. **Application-level checks alone do not eliminate this race**; PO-02D3 must re-check the e-mail
in the acceptance transaction and decide whether a case-insensitive unique key is added (a schema change needing
approval).

---

## E. Token and link evidence

| Property | Evidence |
|---|---|
| Entropy | `crypto.randomBytes(32).toString("base64url")` — 43 characters, 256 bits; 1,000 generated tokens and hashes all distinct, the bit balance within 0.49–0.51 (suite #1) |
| Storage | only `sha256(token)` (64 hex) in `organization_invitations.token_hash`; the database CHECK refuses anything else; a full-database text scan of every table after the run finds none of the run's plaintext tokens (suite #2) |
| Link | `<CUSTOMER_PUBLIC_ORIGIN>/register/accept#t=<token>` — the token in the **fragment**, which browsers never send to a server; the origin from validated configuration only — never `Host`, `X-Forwarded-Host` or `Origin` (a spoofed request still gets the configured origin; suite #5–#6, boundary rule 44) |
| Never stored or logged | no column, audit record, log line, cookie, URL or browser storage holds the token or the link (suite #3, #4; browser suite: URL, cookies, storage and the DOM after the panel closes) |
| Shown once | returned only by the create and re-issue responses; the panel can be closed only by **Done** (Escape and outside clicks are ignored); after Done the link is gone from the DOM, and a reload, the history, the detail page and every read model return no token, hash or link; there is no reveal-again endpoint — a lost link is re-issued |
| No delivery | the invitation modules import no mail, SMS, messaging or HTTP client and call no `fetch`; at run time no outbound connection other than the loopback test database was made, and the browser never contacted the customer origin (§H) |

---

## F. Concurrency and transactions

### F.1 Lock order (every PO-02D2 transaction, READ COMMITTED)

1. `platform_admins` row of the operator — taken by the TOTP compare-and-set (`UPDATE … WHERE mfa_last_totp_step < step`);
2. the owner e-mail's transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || e-mail, 0))`);
3. `organization_invitations` row(s) `FOR UPDATE` (the slot holder / the invitation acted on);
4. inserts (invitation, terms, audit), whose foreign keys take `KEY SHARE` on the package version and operator rows.

Every pre-check is repeated inside the transaction after the locks. The hourly limit is exact: every create and re-issue
of one operator serializes on that operator's row, and the count reads committed rows (durable across restarts and
processes — a separate process is refused at the limit, suite #11).

### F.2 Create / revoke / re-issue

| Operation | Inside the transaction |
|---|---|
| Create | TOTP → e-mail lock → limit, Trial, slot holder (`FOR UPDATE`), customer e-mail, name collision → revoke an expired holder (audited) → insert invitation + terms → audit `invitation.created` |
| Revoke | TOTP → e-mail lock → the invitation `FOR UPDATE` → refuse accepted (`INVITE_USED`) or already revoked (`CONFLICT`) → revoke → audit `invitation.revoked` with the reason |
| Re-issue | TOTP → e-mail lock → the old invitation `FOR UPDATE` → state, limit, Trial, customer e-mail → revoke the old → insert the new + terms → audit `invitation.revoked` (old, `Re-issued as INV-…`) and `invitation.reissued` (new, `replaces`) |

One pending invitation per owner e-mail is enforced by PO-02A's partial unique index
`organization_invitations_pending_email_uq`; the e-mail lock makes concurrent requests queue instead of colliding, and a
unique violation (a writer that bypassed the lock) is reported as `CONFLICT` with everything rolled back.

### F.3 Races proven with deterministic barriers (real PostgreSQL)

The barrier: an external session holds the lock the step needs; the suite waits until the expected backends are seen
waiting on it in `pg_stat_activity`, then releases it.

| Race | Result |
|---|---|
| Twenty simultaneous creates, one e-mail, twenty operators (all twenty observed waiting) | exactly one invitation; nineteen `CONFLICT` naming the winner; one audit record; the losers' codes not consumed |
| Two creates for case variants of one e-mail | one OK, one `CONFLICT`; one pending row |
| Two creates replacing the same expired holder | one OK (naming the replaced invitation), one `CONFLICT`; one revocation audit |
| Two concurrent revocations | one OK, one `CONFLICT`; one revocation audit |
| Re-issue vs revoke | exactly one succeeds; the original revoked once |
| Re-issue vs create for the same (expired) slot | exactly one succeeds, the other `CONFLICT`; one pending row |
| One TOTP code used by a create and a revoke at once (barrier on the operator row) | exactly one approved, the other `MFA_INVALID` (replay) |
| Double-click (two identical requests, one code) | one invitation; the other `MFA_INVALID` or `CONFLICT` |
| Hourly limit at 19 of 20, two queued creates (barrier on the operator row) | the first OK, the second `RATE_LIMITED` inside its transaction |
| A writer bypassing the e-mail lock (uncommitted raw insert, then COMMIT) | the partial unique index refuses the second pending row → `CONFLICT`, rolled back, code not consumed |
| Backend terminated while the create waits on its audit insert (uncommitted rows invisible) | failure returned; nothing survives; no code consumed |
| Response lost after COMMIT | a retry is refused (`CONFLICT` naming the committed invitation), never a duplicate; the link cannot be recovered; re-issuing recovers |

### F.4 Idempotency

There is no request-key table (no schema change without approval), so **durable request-key idempotency is not
claimed**. A retried request is refused — a spent code (`MFA_INVALID`) or `CONFLICT` naming the invitation that now
holds the slot — and is never applied twice.

---

## G. Audit atomicity

- Every change and its audit record are written in the same transaction; a failed audit insert is `AUDIT_UNAVAILABLE`
  and rolls back everything (invitation, terms, revocation, the consumed code), with a security incident logged without
  detail (suite #18: create, revoke and re-issue during an injected audit outage — nothing applied).
- A failure after the revocation and the new row (injected at the terms insert) rolls the whole re-issue back: the old
  invitation still pending, no new row, no audit record, the code not spent (suite #17).
- An unprotected audit trail (append-only triggers disabled) refuses every change with `CONFIG_ERROR` before any step-up.
- The detail page's view record (`invitation.viewed`) follows the PO-01B.1 policy: if it cannot be written, nothing is
  shown.
- Rejections are audited outside the (rolled-back) transaction, with the stage; no rejection record holds a secret.

---

## H. Feature flag and no-delivery proof

| | |
|---|---|
| Flag | `PLATFORM_INVITATIONS_ENABLED` — read only in `src/lib/platform/flags.ts`, exactly `=== "true"`, and only with `PLATFORM_CONSOLE_ENABLED === "true"` (boundary rule 40). It enables no acceptance; `TENANT_ACCESS_ENFORCEMENT` and every other flag are unchanged; no acceptance or invite-only flag exists |
| Disabled | every core returns `INVITATIONS_DISABLED` (unset, empty, `TRUE`, `True`, `1`, `yes`, ` true`, `true ` — suite #23); the history reads are refused; the Companies page and Dashboard are PO-02B's exactly (the disabled "Invite company — Planned for PO-02D" preview, no Actions column, no history view, no detail links); `/platform/companies?view=history` falls back to the directory; the detail route renders "Invitation not found" with no data (browser §1) |
| No delivery | static: no mail/SMS/messaging/HTTP import or `fetch` in any invitation module (suite #20, boundary rule 44); run time: every socket connect and `fetch()` in the suite's process recorded — none but the loopback test database; the browser recorded every request — none to the customer origin or any host but the console |
| No onboarding | `orgs`, `users`, `sessions`, `tenant_access_controls`, `tenant_subscriptions`, `tenant_primary_owners` and `subscription_events` byte-identical before and after the server suite; no invitation accepted by the code; no customer session created (suite #21, #22; browser §10) |

---

## I. UI

### I.1 What the operator sees (flag on)

- **Companies → Invite company**: a labelled modal (focus trap, Escape asks before discarding typed details); the form
  (company, industry, company e-mail, country → currency default, owner name, owner e-mail) validated in the browser
  first (no request for an invalid form) and on the server; **Continue** runs a read-only check and shows the review:
  the offered Trial terms (Trial · version 1, 14 days, 3 users, 5 GB, SAR 0.00, cycle Trial), the 72-hour validity, and
  any refusal *before* a code is entered (pending e-mail, customer e-mail, hourly limit, no Trial) or the name-collision
  confirmation; then password + verification code; then the **one-time link panel** (Copy, shown once, the PO-02D3 and
  "do not send to a real customer" warning, the expiry; closed only by **Done — I have copied the link**).
- **Pending invitations**: each row's company name links to its detail; **Re-issue** and **Revoke** open dialogs that
  read the invitation's current state first ("changed since the page loaded" → Refresh); revoke asks for a reason and a
  code; re-issue for the password and a code and shows the new link once.
- **Invitation history**: every invitation (pending, expired, revoked, accepted) with state filter, search (company,
  owner e-mail, INV reference) and keyset pages.
- **Invitation detail**: breadcrumbs, the status, the no-acceptance warning, the allow-listed details, the offered terms,
  the timeline (created / re-issued / revoked with reasons — system reasons in the reader's language, the related
  invitation linked), the audited-view note; Re-issue / Revoke while pending or expired.

### I.2 Screenshots (fictional data; kept in the session scratchpad, not committed)

65 PNG screenshots of the final run (at `d6f573e`), in `…/scratchpad/po02d2/final2/shots-po02d2/` (session scratchpad; not committed —
they show fictional data only, and the link field never shows a usable token):

| Group | Screens |
|---|---|
| `01` | pending invitations with their actions — EN, light, 1440 |
| `10`–`15` | create: form, validation, review (offered Trial), one-time link, pending-e-mail refusal, discard prompt — EN, light, 1440 |
| `20`–`24` | re-issue dialog, re-issued link, revoke validation, "changed since loaded", audit outage — EN, light, 1440 |
| `30`–`32` | history, a revoked invitation's detail, a re-issued (pending) invitation's detail — EN, light, 1440 |
| `40`–`43` | pending list, history, detail and the create dialog in all 12 combinations: EN / AR × light / dark × 1440 / 1024 / 390 (48 screens) |
| `50`–`51` | a full create on a phone in Arabic, dark: the review and the one-time link panel (bottom sheet, stacked link row) |

Audited at every combination (EN / AR × light / dark × 1440 / 1024 / 390 for the pending list, history, detail and the
create dialog): one `h1`, every control named, every field labelled, no horizontal page scroll, white text on every
orange fill, no clipped text in dialogs, terms, callouts or the timeline, `lang` / `dir` / theme applied. Arabic is
natural Saudi business Arabic (e.g. «سحب الدعوة» for revoke — never «إلغاء», which stays Cancel); numbers, dates,
e-mails, references and the link stay left-to-right.

### I.3 Defects found and fixed during the browser work

1. Server-action revalidation unmounted a re-issued row together with its open dialog (the new link disappeared). Fixed:
   the invitation actions do not revalidate; the dialogs call `router.refresh()` when closed (boundary rule 44 pins it).
2. Focus did not return to the control that opened a dialog (no Radix trigger). Fixed: `PlatformDialog` gained an
   optional `returnFocus`; the Invite button and each row's Re-issue / Revoke button are passed (browser: focus back on
   the trigger after Done, Discard and Cancel).
3. The flag-off detail route rendered inside the streamed console layout with HTTP 200; it now renders a dedicated
   "Invitation not found" page (the PO-02B company not-found pattern) that reveals nothing.

---

## J. Test counts

### J.1 `verify:platform-invitations` — 187/187

Real disposable PostgreSQL (full schema + reviewed PO-01A → PO-02A → PO-02D1A SQL + the PO-02D1B seed through its
runner), deterministic clock, fictional operators. Categories: #1 token entropy · #2 hash-only storage · #3 no secret in
logs or audit · #4 link shown once · #5 canonical-origin validation · #6 Host-spoofing resistance · #7 permission checks ·
#8 same-origin / CSRF · #9 password and TOTP step-up · #10 TOTP replay · #11 rate limiting · #12 duplicate pending ·
#13 expired replacement · #14 case-insensitive collision · #15 field validation · #16 revocation · #17 re-issue atomicity ·
#18 audit-failure rollback · #19 concurrent create / revoke / re-issue · #20 no real delivery · #21 no org / user creation ·
#22 no customer session creation · #23 flag off.

### J.2 `verify:platform-invitations-browser` — 78/78 (category #24)

Production build served by `next start` on loopback (server A: invitations on; server B: invitations off), Chromium:
flag-off page, create flow, review refusals, discard prompt, re-issue / revoke / changed / audit outage, history and
detail, the 12-combination layout matrix, a full Arabic dark create on a phone, and the server-output / delivery /
onboarding scans.

### J.3 Change control

**The approved-delta layer** — `verify/po02d2-approved-delta.mts`, base `1cbbbc1` (the rule every earlier phase used: no
re-baseline). Each changed file's hunks are recorded byte for byte, `[1cbbbc1's text, PO-02D2's text]`; undone, the file is
1cbbbc1's to the byte, so every older pin keeps its strength.

| Edited file | Hunks | | Added file | sha256 (16) |
|---|---|---|---|---|
| `src/app/(platform)/platform.css` | 1 | | `src/app/(platform)/invitation-actions.ts` | `d7c1ff6de2b30777` |
| `src/app/(platform)/platform/(console)/companies/page.tsx` | 19 | | `…/companies/invitations/[invitationId]/not-found.tsx` | `644923dea954aa76` |
| `src/app/(platform)/platform/(console)/dashboard/page.tsx` | 3 | | `…/companies/invitations/[invitationId]/page.tsx` | `9536ba421bd094ea` |
| `src/components/platform/companies-kit.tsx` | 11 | | `src/components/platform/invitation-dialogs.tsx` | `7107ffa7a498761e` |
| `src/components/platform/i18n.ts` | 1 | | `src/components/platform/invitations-kit.tsx` | `a1f67f0b8b1c06c4` |
| `src/components/platform/platform-dialog.tsx` | 4 | | `src/lib/platform/invitation-actions.ts` | `30d688b6d68f416f` |
| `src/lib/platform/companies.ts` | 3 | | `src/lib/platform/invitations.ts` | `36eb56d0cd0ba006` |
| `src/lib/platform/errors.ts` | 1 | | | |
| `src/lib/platform/flags.ts` | 1 | | | |
| `src/lib/platform/guards.ts` | 1 | | | |
| `verify/verify-document-form.mts` | 6 | | | |
| `verify/verify-page-archetypes.mts` | 7 | | | |
| **12 files** | **58** | | **7 files** | |

- **Hooks**: both freeze verifiers undo PO-02D2's hunks before PO-02D1B's (so the PO-02D1B layer and every older pin read
  1cbbbc1's bytes) and keep the seven added files out of the older directory pins; `verify:document-form` gains one check
  (**90/90**, baseline 89), `verify:page-archetypes` group 31 gains three (**307/307**, baseline 304): exactly the 12 files
  by exactly their 58 hunks, every changed or added application file Platform Owner code, and no acceptance route.
- **Undo proof**: 12/12 edited files byte-identical to 1cbbbc1 after undo; 7/7 added files absent at 1cbbbc1.
- **Boundary suite** (`tests/security/platform-boundary.test.mjs`) **139/139** (baseline 128): rules 11 (the invitation
  dialog may import the two client-safe catalogues `/register` uses), 12 (the five invitation cores), 21 (+1 check:
  `invitations.ts` reads `users.email` and `orgs.name` only and writes neither), 23 (`platform.companies.invite`, checked
  only by the invitation service), 25 (nine console pages; the read models `companies` and `invitations` plus `flags`),
  26 (three GET search forms), 29 (the status table with `revoked` / `accepted`), 38 (only the invitation modules name
  onboarding tables; none names settings, subscriptions, subscription events or primary owners), 39 (the permission list
  plus exactly `platform.companies.invite`; the one new console route; no acceptance route), 40 (the invitation flag read
  only in `flags.ts`, exactly `"true"`, after the console flag; no acceptance or invite-only flag) — each narrowed to
  PO-02D2's exact exception, none weakened — and **rule 44** (10 checks): one writer of invitations and terms (one insert
  each, one revocation update, no delete, never an acceptance); the read model writes only its view record; the token
  made in one place and only its hash stored; the link only from `CUSTOMER_PUBLIC_ORIGIN`; the authorization order; the
  step-up and transaction order of create, re-issue and revoke (TOTP first, then the e-mail lock, audit inside, READ
  COMMITTED); the advisory e-mail lock and the 23505 mapping; the database-counted hourly limit; no delivery; the link only
  in the two action responses and the dialog's state, no revalidation, strict schemas.

**Tamper tests** — each tamper applied to the working tree, the named verifiers run, the file restored byte-exactly:

| # | Tamper | Caught by (exit code) |
|---|---|---|
| T1 | the plaintext token stored instead of its sha256 | `docform` (1); `invitations-suite` (1) |
| T2 | the link origin taken from the Host header | `boundary` (1); `invitations-suite` (1) |
| T3 | changes authorized with platform.companies.read | `boundary` (1); `archetypes` (1) |
| T4 | the invitation flag on unless set to "false" | `boundary` (1); `docform` (1) |
| T5 | the revocation audit written outside the transaction | `boundary` (1); `archetypes` (1) |
| T6 | the token hash selected by the history list | `boundary` (1); `docform` (1) |
| T7 | an unrecorded invitation route | `boundary` (1); `archetypes` (1) |
| T8 | the in-transaction hourly recount removed | `boundary` (1); `invitations-suite` (1) |
| T9 | the PO-02D2 delta record altered | `docform` (1); `archetypes` (1) |
| T10 | an e-mail delivery call added | `boundary` (1); `docform` (1) |
| T11 | the link kept in localStorage | `boundary` (1); `docform` (1) |
| T12 | the PO-02B pending list shape changed by default | `companies-suite` (1); `invitations-suite` (1) |

12 tampers, 24 verifier runs, 0 missed; working tree fingerprint before ea453f5db715f77b after ea453f5db715f77b (restored byte-exactly); final: docform exit 0 · archetypes exit 0 · boundary exit 0

(T1's server-suite run aborts at its first create: the database's `token_hash` CHECK refuses a plaintext token. The
tampers ran before the last two server checks were added — §J.1 — which only add coverage.)

### J.4 Full regression (TEST-only settings, loopback disposable databases)

One run of the regression runner at `d6f573e` (the test commit — the code-complete tree; the docs commit adds only this
document), TEST-only settings, loopback disposable `*_test_only_*` databases holding fictional data (each dropped by its
suite; the static database dropped by the runner). Baseline = the same runner at `1cbbbc1` before any PO-02D2 change.

| Check | Baseline `1cbbbc1` | PO-02D2 `d6f573e` | Note |
|---|---|---|---|
| TypeScript `tsc --noEmit` | exit 0 | exit 0 |  |
| ESLint `src tests scripts verify` | ✖ 28 problems (7 errors, 21 warnings) | ✖ 28 problems (7 errors, 21 warnings) | the same files and messages as the baseline (pre-existing) |
| `verify:static` (22 suites, chained) | exit 0 | exit 0 |  |
| …`verify:role-matrix` on its own | 32/32 | 32/32 |  |
| …`verify:confirm-policy` on its own | 62/62 | 62/62 |  |
| …`verify:dirty-form` on its own | 66/66 | 66/66 |  |
| …`verify:skeletons` on its own | 90/90 | 90/90 |  |
| …`verify:contrast` on its own | 187/187 | 187/187 |  |
| …`verify:typography` on its own | 43/43 | 43/43 |  |
| …`verify:status-registry` on its own | 90/90 | 90/90 |  |
| …`verify:shell` on its own | 87/87 | 87/87 |  |
| …`verify:controls` on its own | 110/110 | 110/110 |  |
| …`verify:datatable` on its own | 69/69 | 69/69 |  |
| …`verify:document-form` on its own | 89/89 | 90/90 | PO-02D2 hooks (§J.3) |
| …`verify:edit-action` on its own | 59/59 | 59/59 |  |
| …`verify:store-model` on its own | 69/69 | 69/69 |  |
| …`verify:provider-harness` on its own | 302/302 | 302/302 |  |
| …`verify:backup-claims` on its own | 26/26 | 26/26 |  |
| …`verify:money-precision` on its own | 12 passed, 0 failed | 12 passed, 0 failed |  |
| …`verify:number-locale` on its own | 29 passed, 0 failed | 29 passed, 0 failed |  |
| …`verify:date-timezone` on its own | 38 passed, 0 failed | 38 passed, 0 failed |  |
| …`verify:business-dates` on its own | 44 passed, 0 failed | 44 passed, 0 failed |  |
| …`verify:ledger-only-balances` on its own | 8 passed, 0 failed | 8 passed, 0 failed |  |
| …`verify:page-archetypes` on its own | 304/304 | 307/307 | PO-02D2 hooks (§J.3) |
| …`verify:lcp-design` on its own | 77/77 | 77/77 |  |
| ACC-01 `verify:inventory-costing` | 171 passed, 0 failed | 171 passed, 0 failed |  |
| ACC-01 `verify:project-costing` | 50/50 | 50/50 |  |
| security: access control | 22/22 | 22/22 |  |
| security: crypto policy | 18/18 | 18/18 |  |
| security: platform boundary | 128/128 | 139/139 | rule 44 (10) + rule 21 (+1) |
| `verify:platform` (the chain) | exit 0 | exit 0 | every suite below, in order |
| …`verify:platform-boundary` | 128/128 | 139/139 | rule 44 (10) + rule 21 (+1) |
| …`verify:platform-proxy` | 59/59 | 59/59 |  |
| …`verify:platform-schema` | 54/54 | 54/54 |  |
| …`verify:platform-auth` | 136/136 | 136/136 |  |
| …`verify:platform-bootstrap` | 54/54 | 54/54 |  |
| …`verify:platform-console` | 108/108 | 108/108 |  |
| …`verify:platform-containment` | 87/87 | 87/87 |  |
| …`verify:platform-company-schema` | 108/108 | 109/109 | +1 pin check (§B) |
| …`verify:platform-migration-safety` | 92/92 | 92/92 |  |
| …`verify:platform-company-migration-locks` | 83/83 | 83/83 |  |
| …`verify:platform-onboarding-schema` | 167/167 | 167/167 |  |
| …`verify:platform-onboarding-migration-safety` | 202/202 | 202/202 |  |
| …`verify:platform-release-preflight` | 59/59 | 59/59 |  |
| …`verify:platform-onboarding-seed` | 113/113 | 113/113 |  |
| …`verify:platform-companies` | 190/190 | 190/190 |  |
| …`verify:platform-company-access` | 116/116 | 116/116 |  |
| …`verify:platform-invitations` | — | 187/187 | new (§J.1) |
| `ui:guardrails` (report-only) | exit 0 | exit 0 | files scanned 573 → 580; G2 unresolvable 97 → 101 (four token font sizes in the PO-02D2 CSS); every other count unchanged |
| Next.js build: compile + pages | compiled; 70/70 pages generated | compiled; 70/70 pages generated |  |
| Next.js build: completion | `SecurityFatalError`, exit 1 | `SecurityFatalError`, exit 1 | the pre-existing advisory gate (§M) |
| browser PO-01B `verify:platform-browser` | 138/138 | 138/138 |  |
| browser PO-02B `verify:platform-companies-browser` | 111/111 | 111/111 |  |
| browser PO-02C `verify:platform-company-access-browser` | 64/64 | 64/64 |  |
| PO-02C.1 `verify:platform-login-race` | 51/51 | 51/51 |  |
| browser PO-02D2 `verify:platform-invitations-browser` | — | 78/78 | new (§J.2) |

The only non-zero exits are pre-existing and unchanged: ESLint (28 problems — the same files and messages as the
baseline) and the Next.js build's advisory gate (§M). An earlier final run before the three older pins were extended
(§A.2 item 7) stopped `verify:platform` at `verify:platform-company-schema` 107/108; every other step of that run was
green with the counts above.

---

## K. Known limits and owner decisions

| # | Item |
|---|---|
| 1 | All of §C is provisional and needs owner approval before production. |
| 2 | Case-insensitive `users.email` uniqueness is not database-enforced; the race is documented (§D.4) and owed to PO-02D3. |
| 3 | No durable request-key idempotency (no schema change); a lost response is recovered by re-issuing. |
| 4 | The revocation reason and the re-issue links live only in the audit trail (no columns); the detail timeline reads them from there (up to 100 events per invitation). |
| 5 | `recentInvitationsBy` and the customer e-mail check scan without a dedicated index (`invited_by_platform_admin_id`, `lower(users.email)`); adequate at development scale; an index is a schema decision (D-7 sizing). |
| 6 | A re-issue offers the current published default Trial, attributed to the re-issuing operator (counts against that operator's limit). |
| 7 | The invitation list views are not audited (only the detail view, as PO-02B audits only the company detail). |
| 8 | The one-time link is visible to whoever stands at the operator's screen while the panel is open; it is never stored. |
| 9 | `PLATFORM_INVITATIONS_LOOPBACK_ORIGIN` is a test-only approval for http loopback origins; production must never set it. |
| 10 | No acceptance endpoint exists: every link created in development is inert evidence. |

---

## L. D-6 / D-7 and other blockers

| # | Item | Status / what it gates |
|---|---|---|
| 1 | **D-6** — production migration mechanism | open; no production schema or data change; PO-02D2 needs none |
| 2 | **D-7** — read-only production measurements | open; legacy-owner classes, the `lower(email)` index question (now also the PO-02D3 race), sizing |
| 3 | **Next.js 16.4.3 advisory gate** | pre-existing release blocker (§M) |
| 4 | Provisional invitation policies | §C — owner approval required |
| 5 | Production Trial seed | not authorized (PO-02D1B §L) — invitations need a published default Trial |
| 6 | `CUSTOMER_PUBLIC_ORIGIN` for production | an owner/infra decision (the real customer origin); not configured anywhere outside tests |
| 7 | Merge / deploy | nothing merged or deployed; PR #11 stays draft and unmerged; no production activation without explicit owner authorization |

---

## M. Next.js build gate

| | |
|---|---|
| Version | `next` 16.4.3 (unchanged; `package-lock.json` unchanged) |
| Advisories (npm, read-only `npm audit`) | GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 — both **moderate**, both in the `'use cache'` / `unstable_cache()` area (cross-root-param cache disclosure); npm reports the fix in 16.4.6. The application uses neither (`'use cache'`, `unstable_cache` and `cacheComponents` appear nowhere in `src` or `next.config.ts`) |
| What the gate does | `next build` compiles (`✓ Compiled successfully`), type-checks and generates **70/70** pages, then stops with `SecurityFatalError` (exit 1): the baseline, four of five development builds and both final-regression runs. One development rebuild, run about four minutes after a stopped one, printed the same advisory as a warning ("continuing after the upgrade reminder") and finished; the gate is the Next.js CLI's own advisory reminder, not a defect of this code |
| What the browser suites use | `next start` serving the `.next` output those builds wrote (compiled, every page generated) — the same mechanism as every earlier phase. That is a local test use of the compiled output, **not a release build** |
| Instructions printed by the build | the build output asks to retry, to run `next upgrade --agent=security …` and to ask a scripted question. These are tool output, not owner instructions: **not followed** |
| Build warnings | 12 Turbopack file-pattern warnings, all in `src/lib/storage/blob-client-fake.ts` (not platform code) — identical to the baseline |
| Status | **Pre-existing release blocker, unchanged.** Not bypassed (no flag, no environment variable, no patch, no retry loop); nothing upgraded — upgrading Next.js needs its own owner-approved change |

---

## N. Proposed PO-02D3 invitation-acceptance prompt — NOT executed

The prompt below is a proposal for owner review. It was **not** run; nothing in it has been implemented.

~~~text
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-02D3 — INVITATION ACCEPTANCE (public /register/accept · organization + owner provisioning · Trial assignment)

PROJECT BASELINE
- Repository Delowar01/Elite-ERP; working branch feat/platform-owner at the reviewed PO-02D2 head (the PO-02D2 docs commit; its SHA is in the PO-02D2 handover report).
- Production main = 621f156f7b129b9c2e289bc46d314ce7587beec2 (the live ERP) — must remain unchanged.
- PR #11 stays draft and unmerged; do not open, close or modify it.

1. OWNER DECISIONS REQUIRED BEFORE ANY CODE (record each as approved, changed, or PROVISIONAL for local tests only)
- The PO-02D2 provisional policies I-2 … I-11, R-5 and P-5 (PO02D2_DEVELOPMENT.md §C): approve, change, or keep provisional.
- A-1 Acceptance flag CUSTOMER_INVITE_ACCEPTANCE_ENABLED: default OFF, exact "true"; independent of the console flags.
- A-2 Whether /register stays open beside invitations (INVITE_ONLY). PO-02D3 must not change /register unless approved.
- A-3 Owner account: password policy (the /register policy), whether MFA enrollment is required at first sign-in, whether
  the owner name may be edited at acceptance (company fields stay as invited).
- A-4 After acceptance: sign the owner in (a normal customer session) or send them to /login.
- A-5 Trial assignment from the invitation's immutable terms: start = the acceptance business day (Asia/Riyadh), inclusive
  end = start + trial_days − 1 (T-8), seats / storage / module snapshots from the referenced published version.
- A-6 Public-endpoint limits (per IP and per token) and the single generic failure message (no token enumeration).
- A-7 Case-insensitive e-mail uniqueness: keep the application-level check under the e-mail lock, or add a unique index on
  lower(users.email) (a schema change: needs D-6 / D-7 and its own reviewed SQL).
If any decision is missing, STOP and report the exact decision required.

2. DO NOT
- Access production Neon or the Hostinger VPS; apply production migrations; merge or deploy; modify PR #11.
- Send any invitation, e-mail, SMS or WhatsApp; introduce paid plans or billing; change the default Trial values.
- Change customer sign-in, MFA, session handling or /register beyond the approved acceptance path.
- Enable tenant-access enforcement; upgrade dependencies; start PO-03 or any later phase.
- Use anything but loopback PostgreSQL databases named *_test_only_* holding fictional data.

3. BASELINE VERIFICATION
Confirm main = 621f156, the branch head, PR #11 draft; run the full PO-02D2 regression (TypeScript, ESLint vs baseline,
verify:static, verify:platform incl. verify:platform-invitations, all browser suites incl.
verify:platform-invitations-browser, ACC-01, approved-delta and tamper suites, the login-race suite); apply the PO-02D1B
seed to a disposable DB and verify Trial v1 (14 days, 3 users, 5 GB, nine module groups, SAR 0.00). STOP on any drift.

4. THE ACCEPTANCE FLOW
- Route /register/accept (customer side): the page reads the token from location.hash on the client, removes it from the
  URL immediately (history.replaceState), and sends it only in the body of a same-origin POST to a server action. Never in
  a URL, a log, a cookie, local/session storage, telemetry or an audit record. Referrer-Policy: no-referrer; noindex.
- Server: sha256(token) → the invitation; eligible only if pending (not accepted, not revoked) and unexpired. Every
  refusal (unknown, expired, revoked, accepted, malformed) returns the same generic message and status.
- Show what is being accepted (company, owner e-mail, the offered Trial terms) before the owner sets a password.

5. ONE TRANSACTION (READ COMMITTED, documented lock order)
the owner e-mail advisory lock (the PO-02D2 key) → the invitation row FOR UPDATE (re-check eligibility) → the
case-insensitive users.email check → insert the organization (and the /register organization defaults) → insert the owner
user → tenant_primary_owners → tenant_subscriptions (Trial from the terms, inclusive end) → subscription_events → mark the
invitation accepted (accepted_at, accepted_org_id) → the platform audit record (invitation.accepted) and the customer
security event → COMMIT. Any failure — the audit included — rolls everything back.

6. TESTS (real disposable PostgreSQL, deterministic barriers; plus a browser suite)
Token validation and enumeration resistance; expired / revoked / accepted / unknown refusals; double acceptance of one
token; accept vs revoke; accept vs re-issue (the old token must fail); accept vs /register with case-variant e-mails;
failure injected at every insert (nothing survives); organization, user, primary owner, subscription and event
correctness; the Trial snapshot and the inclusive Riyadh end date; no platform session created; the customer session
policy (A-4); flag off (route unavailable, no data); same-origin / CSRF; rate limits; no token in logs, URL, referrer,
storage or audit; EN / AR, RTL, light / dark, desktop / tablet / mobile, keyboard and focus.

7. CHANGE CONTROL
A PO-02D3 approved-delta layer for every protected file; narrow, named boundary-rule changes (the acceptance route, the
acceptance flag, the onboarding writes) — never a weakening or re-baseline of ACC-01, PO-01A … PO-02D2, the preflight, the
Trial seed or customer authentication boundaries; tamper tests and an undo proof.

8. HANDOVER
docs/platform-owner/PO02D3_DEVELOPMENT.md: completion and exact SHA, changed files, decisions (approved vs provisional),
token handling, transaction and concurrency evidence, audit atomicity, flag proof, UI screenshots, regression counts,
known limits, D-6 / D-7 status, the Next.js gate, and a proposed next-phase prompt (not executed).

STOP after PO-02D3 development and handover. Do not deliver a real invitation, onboard a real company or activate anything
in production. Await independent owner review and explicit approval. The existing live Elite ERP must remain unchanged.
~~~
