# Platform Owner — PO-03D: customer-user invitation acceptance and safe user-seat enforcement

> Phase PO-03D of the Elite ERP Platform Owner programme (**Prompt 4 of 16**). **Development only.** Four independently
> tested sub-batches on `feat/platform-owner`, from the PO-03C handover `8c21044`, and this document:
>
> - **B — the shared seat-enforcement core.** ONE server-only check, `assertUserSeatAvailable`, under the company row
>   lock on fresh values, behind `CUSTOMER_SEAT_ENFORCEMENT_ENABLED` (off unless exactly `"true"`).
> - **A — invitation acceptance.** The public page `/join/accept`: the invited person reviews the invitation, chooses a
>   password and joins an existing company as admin or staff — one transaction, no session — behind
>   `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED` (off unless exactly `"true"`).
> - **C — integration.** Every seat-allocating path uses the one check: user-invitation create and re-issue (the company
>   lock upgraded to `FOR NO KEY UPDATE`, taken directly), the acceptance, and the customer Team's Add Member (now one
>   transaction in the shared lock order). The Team card and the console show who occupies the seats and the limit.
> - **D — tests and change control.** Two browser suites, the PO-03D approved-delta layer, 26 tamper cases and the undo
>   proof; the suites' exit codes corrected.
>
> Out of scope and not done: any e-mail, SMS or WhatsApp; owner-role invitations; automatic sign-in after acceptance;
> registration cutover; package management, payments or billing; changes to customer MFA, sign-in or session policy;
> schema changes (the staged PO-03C table is used as it is; no index is installed); dependency upgrades. **Prompt 5 has
> not been started.**
>
> Every database used was a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one
> was dropped. Production (Neon, the Hostinger VPS) was not accessed. No SQL was executed anywhere but those databases.
> Both new switches are off by default and were turned on only in those test processes.
>
> **Release status: NO-GO for production** (§O, §P, §Q): the staged schema and the D-6 mechanism, the D-7 measurements,
> the owner's policy decisions, and the Next.js security-advisory gate that stops every build.

---

## A. Development status and exact SHAs

| Item | Value |
|---|---|
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (PO-03C handover) | `8c21044cde85a5e67ede4d7802e5825742ec6b23` |
| Code head (B + A + C + D + two pin fixes) | `14e9c748365b97011083a678429af66ce677e308` — this document is the commit after it |
| Production `main` | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| Hotfix branch | `fix/team-sensitive-fields-exposure` at `94f936eb019be446282536b8fcdeede6ae9e510c` — untouched |
| PR #11 | draft, unmerged, not modified |

| Step | Status |
|---|---|
| B — seat-enforcement core | done (`d280982`). `verify:platform-seat-enforcement` **32/32** (§F, §G). |
| A — invitation acceptance | done (`8670c4d`). `verify:platform-user-acceptance` **46/46** (45 at A; K11 added in D), `verify:platform-user-acceptance-browser` **41/41**, 32 screenshots (§C–§E). |
| C — integration | done (`337af7b`). `verify:platform-seat-paths` **30/30** (28 at C; K21b and Y1 added in D), `verify:platform-seat-enforcement-browser` **32/32**, 70 screenshots (§G–§J). |
| D — tests and change control | done (`b6ad4ea`). The PO-03D layer: 27 files, 119 hunks, 9 added files; both freeze verifiers hooked; **26 tamper cases, every one caught**; undo proof byte-exact (§N). |
| Full regression | **green** at `14e9c74` (§M). This is the third full run, after the test-side fixes from runs 1 and 2 (A.1-12, A.1-13). Its two non-green steps, older timing-sensitive checks, passed when re-run at the same commit (A.1-14). `next build` compiles and generates all 71 pages, then stops at the advisory gate, which was not bypassed (§P) |
| This document | done |
| **STOP gate** | **STOPPED.** Prompt 5 is not started. No merge, deployment, PR change, production access, real account, real invitation or real message. |

### A.1 Findings for owner attention

1. **Four PO-03D suites exited 0 when a check failed.** `verify:platform-user-acceptance`,
   `verify:platform-seat-enforcement`, `verify:platform-seat-paths` (committed with A, B and C) and the new acceptance
   browser suite printed every failure and their `N/M checks passed` line, but dropped the harness's exit code. The
   first tamper run found it: 12 cases were recorded MISSED although their suites had failing checks. Fixed in D
   (`b6ad4ea`): a failed check now fails the run. Every result reported for these suites earlier was read from their
   check lines (N/N each time), so no earlier result changes; the full regression (§M) ran after the fix, and the 12
   cases were re-run and caught (§N). No other suite had the defect (every other suite uses the returned code).
2. **Tests added because a tamper was caught only indirectly:** user-acceptance **K11** (before it, skipping the
   acceptance's in-transaction seat check was caught only by the success audit's seat evidence), proxy **§8** (the exact
   `/join/accept` path had only a static pin), seat-paths **Y1** (§13 cases 20 and 22 on the Team path) and **K21b**
   (§13 case 21 at the same instant).
3. **Two fixture defects in the new acceptance browser suite**, found on its first runs and fixed before D was
   committed: its 5-seat company filled up with the suite's own pending invitations — with enforcement on, the server
   then correctly refused the link with "no free user seat" — and its keyboard test assumed a password-visibility
   button between the two password fields. Product code unchanged.
4. **A seat change briefly holds back a sign-in to the same company.** Create, re-issue, acceptance and Team Add Member
   take the company row `FOR NO KEY UPDATE`, which conflicts with the sign-in's `FOR SHARE` (PO-02C.1). The wait is
   the length of that short transaction; the seat paths bound their own waits at 5 s (§F).
5. **The Team Add Member does not re-check the company's access inside its transaction**, exactly like the PO-03A
   Team changes: a suspension that commits after the role check does not stop the add; the new member cannot sign in
   while the company is suspended (P-10).
6. **A Team add of an address that an open user invitation holds is allowed** (the legacy rule); that invitation then
   cannot be accepted (neutral `unavailable`) and stops occupying a seat (P-9).
7. **A re-issue that loses to an acceptance** answers `EMAIL_CONFLICT` ("a customer user has this e-mail"), because the
   e-mail check precedes the row check — safe (nothing is written), but not the most specific message.
8. **The Add Member dialog clears its fields after a refusal** (the existing React form reset). Not changed: §10 does
   not allow redesigning the Team page.
9. **The D-7 residual remains, shown explicitly** (user-acceptance K8): a writer outside the application inserting a
   case-variant twin in parallel is not stopped by the case-sensitive `users_email_unique`. `users_email_lower_uq` is
   **not** installed (test database only, inside K8) — an owner decision after the D-7 audit.
10. **No session after acceptance** (Prompt 4 §3) — this replaces the PO-03C handover's §N.1 proposal, which had
    suggested starting one.
11. **One stale console string is still there** (PO-03C A.1-5): the company page's owners note says user management
    "arrives in phase PO-03". PO-02B text, not changed.
12. **The first full regression stopped on an older pin.** `verify:platform-containment` (PO-01B.1) compares the
    customer app-route files and `src/proxy.ts` with the live ERP through the earlier layers only; PO-03D's recorded
    changes to the Team action, the seat card and the proxy were not undone first, so it read **85/87** at `b6ad4ea`. The
    suite was not in the per-sub-batch runs. Fixed in `47abf7e` (test-only; §M.1); no product behaviour changed.
13. **The second full run found three more test-side failures** (§M.1). (a) `verify:platform-user-invitations-browser`
    (PO-03C) read **55/57**: U3 and U6 still expected PO-03C's "can't be used yet … the next phase" copy, which sub-batch
    A changed on purpose to "switched off here"; A had re-targeted only that suite's U12, and the suite (it needs a
    build) had not been run since. Fixed in `14e9c74`. (b) The two customer browser tiers failed at their first step —
    registration answered 500 — because this phase's TEST environment gave the customer server no `AUTH_SECRET` (its
    log: "AUTH_SECRET environment variable is not set"); reproduced, then fixed in the regression runner, which now
    generates TEST-only `AUTH_SECRET` and `FIELD_ENCRYPTION_KEYS` in memory for each run. No product behaviour changed.
14. **Two older checks are timing-sensitive; each failed once in the third full run** (§M.1). Both are in code that
    PO-03D did not change, and neither check was changed or loosened.
    (a) `verify:platform-containment` (PO-01B.1, `715422a`) — "6 concurrent requests on an idle-expired session → all
    SESSION_EXPIRED, exactly one `session.idle_timeout` record". Each request that finds the session idle revokes it
    conditionally: the first revocation to commit records the expiry in the same transaction, and the others match
    nothing. A request that reads the row only after that commit finds it already revoked. It is refused as
    UNAUTHORIZED ("session not live") instead of SESSION_EXPIRED (`src/lib/platform/session.ts`, unchanged since
    `6575061`). Access is refused either way, and the single expiry record held; only the expected refusal code differs.
    It read **87/88** in that run's chain. It then read **88/88** alone in the same run, and **88/88** in the chain
    re-run.
    (b) `verify:platform-user-invitations-browser` (PO-03C, `3ac0b14`) U10 — "Escape closes it and the focus returns to
    Revoke". The check reads the focused element the moment the dialog is hidden. The dialog library hands focus back to
    the trigger as its focus scope unmounts, which can be a frame later. The suite read **56/57** in that run. U10
    passed in run 2, in the suite's run alone after `14e9c74` (**57/57**), and in the re-run
    (**57/57**, 121 s). PO-03D changed only two parts of that dialog file: the link panel's notice and the create dialog's
    seat lines. The revoke dialog, its trigger and its focus handling are untouched.
    **Recommendation** (for the owner; not done here, as it would change older phases' tests): wait for the focus in U10
    (poll up to about a second), and give the containment check a deterministic barrier. The barrier holds the first
    revocation until all six requests have read the row; alternatively, the check could accept either refusal code.

---

## B. Changed files and commits

| Commit | Sub-batch | Summary |
|---|---|---|
| `d280982` | B | `feat(platform)`: shared user-seat enforcement core |
| `8670c4d` | A | `feat(platform)`: customer-user invitation acceptance at `/join/accept` |
| `337af7b` | C | `feat(platform)`: enforce user seats on every allocating path |
| `b6ad4ea` | D | `test(platform)`: PO-03D tests and change control |
| `47abf7e` | D (pin) | `test(platform)`: the containment pins name PO-03D's recorded changes (finding A.1-12) |
| `14e9c74` | D (pin) | `test(platform)`: PO-03C user-invitation browser pins follow PO-03D's console copy (finding A.1-13) |
| (next) | E | this document |

Each commit is reviewable on its own; none was amended, squashed or force-pushed. From `8c21044` to `14e9c74`, 54
files: 25 `src/` files changed and 9 added; `package.json`; the boundary test; and 18 under `verify/` — the layer, the
two freeze verifiers, the throttle child process, the two new browser suites and 12 suites changed or added
(company-schema, containment, email-uniqueness, primary-owner, proxy, seat-accounting, seat-enforcement, seat-paths,
user-acceptance, user-invitations and its browser suite, users).

### B.1 Sub-batch B (`d280982`) — 8 files
- **added** `src/lib/platform/seat-enforcement.ts` — the lock (`lockCompanyForSeatChange`, `boundSeatLockWait`), the
  pure policy (`seatVerdict`), the enforcing check (`assertUserSeatAvailable`), the read-only preview
  (`previewUserSeat`), refusal codes.
- `src/lib/platform/seat-accounting.ts` — `enforced` = the caller's reading of the switch AND a current subscription;
  replaced-invitation exclusion; `src/lib/platform/flags.ts` — `CUSTOMER_SEAT_ENFORCEMENT_ENABLED`;
  `src/lib/platform/errors.ts` — `SEAT_LIMIT`, `SUBSCRIPTION_REQUIRED`, `SEAT_ENFORCEMENT_UNAVAILABLE`.
- tests: **added** `verify/verify-platform-seat-enforcement.mts`; `verify/verify-platform-seat-accounting.mts`; the
  boundary test; `package.json`.

### B.2 Sub-batch A (`8670c4d`) — 27 files
- **added** the route `src/app/(invite)/join/accept/` (`page.tsx`, `join-invitation.tsx`, `actions.ts`, `copy.ts`); the
  bridge `src/lib/onboarding/user-invitation-acceptance.ts` and `user-acceptance-types.ts`; the core
  `src/lib/platform/user-invitation-acceptance.ts`.
- `src/proxy.ts` (the exact path); `src/lib/platform/flags.ts` (`CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED`),
  `config.ts` (two keyed-digest purposes), `user-invitations.ts`, `user-invitation-actions.ts` (the link's comment and
  the acceptance state), the console's invitation list, detail and dialogs (acceptance open or switched off),
  `src/components/platform/i18n.ts`, `src/app/(platform)/user-invitation-actions.ts`.
- tests: **added** `verify/verify-platform-user-acceptance.mts`, `verify/platform/user-acceptance-throttle-child.mts`;
  named pin changes in company-schema, email-uniqueness, primary-owner, seat-accounting, user-invitations and its
  browser suite (U12); the boundary test (rule 50, part A); `package.json`.

### B.3 Sub-batch C (`337af7b`) — 27 files
- **added** `src/lib/team/member-add.ts` (the Add Member service).
- `src/app/(app)/settings/team/actions.ts` (delegates to it), `seat-summary.tsx` (breakdown, limit line, note),
  `src/lib/team/ownership-gate.ts` (the seat lock and check for the Team), `seat-summary-types.ts`,
  `member-changes.ts` (its note), `src/lib/i18n/dict.ts` (the customer strings).
- `src/lib/platform/user-invitation-actions.ts` (pre-check, upgraded lock, the check, evidence),
  `seat-enforcement.ts` (the e-mail-keyed lock order), `companies.ts`, `customer-users.ts`, `display.ts`; the console's
  company page, user page and users directory; `users-kit.tsx`, `user-invitation-dialogs.tsx`, `i18n.ts`,
  `src/app/(platform)/user-invitation-actions.ts`.
- tests: **added** `verify/verify-platform-seat-paths.mts`; named pin changes in email-uniqueness, primary-owner,
  seat-accounting, user-invitations, users; the boundary test (rule 50, part C); `package.json`.

### B.4 Sub-batch D (`b6ad4ea`; pin fixes `47abf7e`, `14e9c74`) — 10 files + 2
- **added** `verify/po03d-approved-delta.mts`, `verify/verify-platform-user-acceptance-browser.mts`,
  `verify/verify-platform-seat-enforcement-browser.mts`.
- `verify/verify-document-form.mts`, `verify/verify-page-archetypes.mts` (the layer's hooks; group 36);
  `verify/verify-platform-proxy.mts` (§8); the exit-code fix and the new checks in user-acceptance, seat-enforcement and
  seat-paths; `package.json` (the two browser suites).
- `47abf7e`: `verify/verify-platform-containment.mts` — the PO-03D layer undone first; the proxy read through it; one new
  check (A.1-12, §M.1).
- `14e9c74`: `verify/verify-platform-user-invitations-browser.mts` — U3 and U6 follow PO-03D's console copy (A.1-13,
  §M.1).

---

## C. Invitation acceptance — implementation (sub-batch A)

**What it is.** The public page `/join/accept` lets the person a Platform Owner invited (PO-03C) join an **existing**
company as **admin or staff** — never owner — by choosing a password. Behind `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED`,
off unless exactly `"true"`, independent of every console flag (F1–F3).

**Files.**

| Layer | File | Role |
|---|---|---|
| Route | `src/app/(invite)/join/accept/page.tsx` | per-request (`force-dynamic`), `noindex, nofollow, nocache`, `no-referrer`; checks the flag first and hands the client only a mode (`disabled`, `signed-in`, `ready`) — never a token or invitation data |
| | `join-invitation.tsx` | the client: reads the fragment, removes it, holds the token in a ref, renders review / form / done / refusal |
| | `actions.ts` | exactly two server actions (check, accept), strict schemas: the token, and for acceptance only the name and the two passwords — never an e-mail, role or company (V2) |
| | `copy.ts` | English and Saudi Arabic copy (P5: every string has its Arabic entry) |
| Customer bridge | `src/lib/onboarding/user-invitation-acceptance.ts` (+ `user-acceptance-types.ts`) | the ONE customer module that reaches the platform core: the `/register` password policy, the hash (before the transaction), the user insert and the customer evidence, as callbacks run inside the core's transaction |
| Platform core | `src/lib/platform/user-invitation-acceptance.ts` | gates, throttle, token lookup, preview, the transaction |
| Proxy | `src/proxy.ts` | passes exactly `/join/accept` (a set of one path, no prefix — proxy §8 pins nine near misses as protected) |

**Every request, in order** (never trusted from the client): the flag → configuration (the canonical customer origin,
the platform key) → same origin, from the canonical `CUSTOMER_PUBLIC_ORIGIN` only (O1) → the protected audit trail →
the staged `user_invitations` table exists (else `unavailable`, F4) → the durable per-IP block → the token's format (43
base64url characters) → lookup by `sha256(token)` → the per-invitation block → the lifecycle (pending / expired /
revoked / accepted).

**What the invitee sees.** A check returns an **allow-listed** preview only — reference, company, name, e-mail, role,
expiry (both languages), plan and seats (T3) — never an id, the token or its digest. The form shows the company, the
e-mail and the role as fixed text and the name prefilled and editable; the only inputs are name, password and
confirmation (J4). The seats line is the shared seat accounting: "2 of 3 in use, including the seat reserved for you",
and, while the company's limit is enforced, "The company's user limit applies to this invitation."

**Public answers** (one word each, never more): `disabled`, `invalid` (unknown, malformed, revoked and missing alike),
`expired`, `used`, `throttled`, `unavailable` (a system failure **and** an e-mail that already has an account — the
neutral answer, R2), `seats_full`, `company_unavailable`. Try again is offered only where it can help (`throttled`,
`unavailable`, `seats_full`, `company_unavailable`).

**Success.** One user in the invitation's company, with the invited role, the lower-cased e-mail, the confirmed name
(white space collapsed), active, a bcrypt hash of the chosen password (S1); the invitation accepted **by that user**
(S2); the evidence (S3): platform audit `user_invitation.accepted` (actor `invitee`, pending → accepted, the reference,
the user, the role, the seat decision), customer security event `account.created`, the company's activity
`team.member-joined`. **No session is issued** (S4): the done screen links to the existing `/login`, and the new member
signs in there (J6). A replay answers `used` (S5).

---

## D. Password and token security

| Requirement (§4, §6) | How | Evidence |
|---|---|---|
| fragment read only in the browser | `#t=` parsed once on the client (never the query: `?t=` is ignored) | J2, boundary rule 50 |
| removed from history and the Next.js router before any request | one `history.replaceState` (state preserved, URL without the fragment) before the first fetch; the router never held it | J3 (the history write precedes every fetch; `router.refresh()` brings nothing back) |
| transient memory only | a React ref — never state that renders, never a cookie or Web Storage, IndexedDB or the Cache API | J3 (DOM, fields, history entry, storage, cookies scanned) |
| never in a URL, cookie, log, audit, analytics or page source | travels only as the `token` field of the two server actions' POST bodies | J9 (every request URL and header, Referer and Cookie included; console; server output); P1–P2 (every table scanned) |
| SHA-256 checked server-side | the row is found by `sha256(token)` and the digest re-checked on the locked row | T1, the `changed` stage |
| refuse invalid, expired, revoked, used | the lifecycle, before and again after the locks | T1–T2, S5, K2–K4 |
| noindex, no-store, no-referrer | page metadata and `Cache-Control: no-store` | J9 |
| cleared on success and page exit | the ref is dropped on success, on a final refusal and on `pagehide`; a page restored from the back/forward cache or given a second link reloads | J3, J6 |
| screenshots | the page never renders the token, so no screenshot can contain it | J3 (`tokenInDom` false) |

**Passwords.** The `/register` policy (`DEFAULT_POLICY`: 8–200 characters, upper and lower case, a digit, a symbol, not a
common password) is checked in the bridge; the client mirrors it for immediate feedback only (J5: a common password
passes the browser and is refused by the server under the field). The bcrypt hash is computed **before** the
transaction (no lock is held while it runs) and handed to the insert callback; platform code never sees the password or
its hash. No password, token or digest appears in any record, line or table (P1–P2, J9).

**Throttle (§12).** The durable PO-02D3 store (`platform_login_attempts`) under purposes of its **own** —
`user-invite-accept-ip` and `user-invite-accept-email`, keyed digests — so it never counts against, or blocks, a
company-invitation acceptance, a console sign-in or a step-up (H2, H3). Per IP: 10 failures / 15 min → 15 min block, 50
/ 24 h → 24 h. Per invitation (client-caused refusals of a real invitation): 5 / 15 min, 20 / 24 h. Four independent
processes recording at once are counted exactly (H4, per-key advisory locks). A refusal never reveals whether an
account exists.

---

## E. Atomic transaction and rollback evidence

**One READ COMMITTED transaction**, exactly the order §6 proposed:

| § 6 step | Code |
|---|---|
| 1 token, origin, configuration, rate limits | before the transaction (§C) |
| 2 the normalized-e-mail advisory lock | `lockInvitationEmail` — the PO-02D2 key `platform-invitation-email:<email>` |
| 3 the company row `FOR NO KEY UPDATE` | `lockCompanyForSeatChange` (bounded: `lock_timeout` 5 s) |
| 4 the invitation row `FOR UPDATE` | |
| 5 the decision time | `platformClock.now()` read **after** the locks (K4) |
| 6 status and expiry again | `userInvitationState` on the locked row |
| 7 company access again | `getTenantAccess` (K5) |
| 8 e-mail uniqueness in ANY letter case | `customerEmailInUse(tx, email)` (`lower(email)`, K7) |
| 9 role admin or staff | the staged table refuses owner too (CHECK, S6) |
| 10 the reserved seat and the allowance | `assertUserSeatAvailable(tx, lock, 1, { path: "invitation_accept", replacingInvitationIds: [id] })` (R3–R5, K11) |
| 11 the user | the bridge's callback, with the precomputed hash |
| 12 the invitation accepted by that user | ONE update, only while neither accepted nor revoked |
| 13 customer evidence | the bridge's callback: `account.created`, `team.member-joined` |
| 14 platform audit | `user_invitation.accepted` |
| 15 COMMIT | |

**Rollback (Y1).** A failure injected (a test-only trigger) at the user insert, at the acceptance mark (the user already
inserted — §13 case 22), at the security event, at the activity record or at the platform audit (§13 case 20) answers
`unavailable` and leaves **nothing**: no user, no accepted invitation, no success record; the link then works. An
audit-trail outage is reported as an incident line with the error class only (Y2). The same holds for the Team's Add
Member (seat-paths Y1: a failure at the user insert or at the activity record rolls the whole add back).

**Exactly once.** Two simultaneous acceptances queue on the e-mail lock: one user, the other `used` (K1). The
acceptance mark is conditional (`accepted_at is null and revoked_at is null`), so a lost race can never mark twice.

---

## F. Lock-order and deadlock analysis

**The global order** (a path takes a prefix of it, never out of order):

> platform_admins row (console TOTP step-up only) → the e-mail advisory lock → the company row → invitation rows /
> user rows (ascending id) → the primary-owner mapping (`FOR SHARE`) → inserts → evidence → COMMIT

| Lock | Mode | Taken by | Purpose |
|---|---|---|---|
| operator row `platform_admins` | `FOR UPDATE` | console step-up (TOTP), first in every console write | replay-protected TOTP consumption |
| e-mail advisory lock `hashtextextended('platform-invitation-email:'‖email, 0)` | transaction advisory | company invitations (PO-02D2), company acceptance (PO-02D3), user invitations create / re-issue / revoke (PO-03C), **user acceptance and Team Add Member (PO-03D)** | one e-mail is handled by one transaction at a time across every path that can create or reserve an account for it |
| company row `orgs` | `FOR NO KEY UPDATE`, direct, `lock_timeout` 5 s | company suspension (PO-02C), Team changes (PO-03A), account controls, role change and transfer (PO-03B / PO-03C), **create / re-issue (upgraded from `FOR SHARE`), acceptance, Team Add Member (PO-03D)** | THE seat lock: seat-allocating changes of one company serialize; access changes serialize with them |
| company row `orgs` | `FOR SHARE` | session issuance (PO-02C.1 sign-in) | a sign-in and a suspension (or a seat change) never interleave |
| user rows `users` | `FOR NO KEY UPDATE`, ascending id | Team changes, account controls, transfer, sign-in (after its company row), **Team Add Member (the acting member)** | the acting / target accounts cannot change mid-decision |
| `user_invitations` rows | `FOR UPDATE` | create / re-issue / revoke (PO-03C), **acceptance** | the lifecycle of one invitation is decided once |
| `organization_invitations` rows | `FOR UPDATE` | company invitations and their acceptance | (PO-02D2 / PO-02D3) |
| `tenant_access_controls` row | `FOR UPDATE` | company suspension, after the company row | (PO-02C) |
| primary-owner mapping | `FOR SHARE` | Team changes, account controls, transfer (after the users) | (PO-03A) |
| throttle keys `platform-invite-accept:<key>` | transaction advisory, short own transaction | the public throttle (outside the acceptance transaction) | exact counting across processes |

**No cycle.** Checked pairwise against every path §9 lists:

| Other path | Its order | With PO-03D's paths |
|---|---|---|
| PO-02C suspension | company row → access row | both start at the company row after (or without) the e-mail lock; the suspension never takes the e-mail lock or an invitation row — whoever holds the company row first finishes first (K5 both orders) |
| PO-02C.1 session issuance | company row `FOR SHARE` → user row | `FOR SHARE` conflicts with `FOR NO KEY UPDATE`, so a sign-in into that company waits for a seat change (bounded by that short transaction) or the seat change waits for the sign-in; neither then wants a lock the other holds (no PO-03D path locks an existing user row before the company row) |
| PO-02D2 company invitations | operator → e-mail lock → its invitation rows | a new company: no `orgs` row is locked; shares only the e-mail lock, which is first for both |
| PO-02D3 company acceptance | e-mail lock → its invitation row → a NEW company and owner | the same e-mail queues on the e-mail lock; no existing company row. (`/register` takes no e-mail lock — the unique e-mail index is its guard: K6) |
| PO-03A Team changes | company row → users → mapping | no e-mail lock; Team Add Member takes e-mail → company → acting user: the company row is the first lock they share, so they serialize there |
| PO-03B account controls | operator → company row → user → mapping | as Team changes |
| PO-03C transfer | operator → company row → both users → mapping | as Team changes |
| PO-03C create / re-issue / revoke | operator → e-mail → company (now `FOR NO KEY UPDATE`, directly) → invitation rows; revoke: operator → e-mail → invitation row | the same prefix as acceptance; revoke takes no company row (freeing a seat needs none) |

**Upgrade (§9).** Create and re-issue took the company row `FOR SHARE` (PO-03C); they now take `FOR NO KEY UPDATE`
**directly**, after the e-mail lock and before the invitation rows — never `FOR SHARE` first and upgraded (boundary rule
49 pins the order; PO-03C's K3 now waits on `FOR NO KEY UPDATE`).

**Proven, with deterministic barriers:** a transaction that takes the order the wrong way round (company row, then the
e-mail lock) deadlocks with an acceptance; PostgreSQL aborts one side (40P01) and nothing half-done remains, whichever
side it is (K9). Every seat path bounds its waits: a company row held longer than 5 s makes an acceptance answer
`unavailable` (K10), a Team add answer "busy" (seat-paths K23) and a create or re-issue `CHANGE_IN_PROGRESS` — writing
nothing.

**Contract for later phases (PO-05 subscriptions):** any writer of `tenant_subscriptions` must take the company row
`FOR NO KEY UPDATE` first, so a seat check waiting behind it decides on the committed allowance (seat-paths K19,
seat-enforcement E13–E14, user-acceptance K11).

---

## G. Seat-enforcement rules

**One server-only service:** `src/lib/platform/seat-enforcement.ts` — `assertUserSeatAvailable(tx, lock, adds, context)`
where `lock` can only be made by `lockCompanyForSeatChange` (proof that THIS transaction holds the company row), on
fresh values read inside the transaction (`readSeatAccounting(tx, …)`); `previewUserSeat` applies the same pure policy
(`seatVerdict`) read-only and decides nothing. Client numbers and previews are never trusted. Behind
`CUSTOMER_SEAT_ENFORCEMENT_ENABLED`, off unless exactly `"true"`: off, nothing is refused (the PO-03C behaviour).

`occupied = active users + disabled users + valid pending invitations` — a valid pending invitation is open (not
accepted, not revoked), unexpired (`expires_at > the decision time`) and for an e-mail no customer user holds.
`remaining = max(0, seats_snapshot − occupied)`; the current subscription's immutable `seats_snapshot` is authoritative.

| Rule (§3, §8) | Decision | Evidence |
|---|---|---|
| a current subscription | `occupied − replaced + adds ≤ seats` → allowed; else `SEAT_LIMIT` | seat-enforcement P5, E2; seat-paths E1 |
| three occupied refuse a fourth; two allow exactly one | | §13 cases 16–17: seat-paths E1, seat-enforcement P5 |
| re-issue of a PENDING invitation | its source is replaced: no double reservation | seat-paths E4 |
| re-issue of an EXPIRED or REVOKED invitation | a new reservation: needs a free seat | seat-enforcement E4, seat-paths E5 |
| revocation | frees the seat at once | seat-paths E6 |
| expiry | frees the seat at the boundary instant (one millisecond before: full) | seat-paths E5, seat-enforcement E7 |
| acceptance | its own reservation becomes the user (3 of 3 before and after) | user-acceptance R5, seat-paths E13 |
| a disabled user | keeps the seat | seat-paths E10, seat-enforcement E8 |
| a company above its allowance | keeps every user; no new seat (create, Team add, and even converting a reservation) | seat-paths E11, seat-enforcement P7, E9, user-acceptance R3 |
| no current subscription | Team Add Member: the legacy rule (allowed); a Platform Owner invitation, a re-issue or an acceptance: `SUBSCRIPTION_REQUIRED` | seat-paths E12, user-acceptance R4 |
| missing, partial or malformed foundation (a subscription table missing, none at all, a 0-seat snapshot) | `SEAT_ENFORCEMENT_UNAVAILABLE` — never "unlimited" | seat-enforcement P2–P3, Z1–Z4, seat-paths Z1, user-acceptance F4 |
| a change that adds nothing | allowed only within the allowance | seat-enforcement P8 |
| one seat at most per change | `adds` ∈ {0, 1} | `checkAdds` |

**Where it runs** — every path that allocates a seat, inside its own transaction, under the company lock:

| Path | Lock order | Refusal shown as |
|---|---|---|
| user-invitation **create** | pre-check (read-only, before the step-up: no TOTP is spent on a refusal) → operator → e-mail → company → open invitation rows → the check → insert | the dialog's notice (`uinv.blockSeatLimit` / `blockNoSubscription` / `blockSeatsUnavailable`); audit stage `seat_limit` / `no_subscription` / `seat_check_unavailable` |
| user-invitation **re-issue** | the same, replacing its source | the same |
| **acceptance** | e-mail → company → invitation row → the check (replacing its own reservation) | `seats_full` ("This company has no free user seat") or `unavailable` |
| Team **Add Member** | e-mail → company → the acting member → the check | the toast "This company has reached its user limit. Nothing was changed. Free a seat, or ask your Elite ERP contact about more seats." (EN / AR); one security event `team.member_add_refused` |

**Displays (§11)** say "enforced" only when the switch is on **and** the company has a current subscription **and** the
foundation is readable (`SeatAccounting.enforced`): the Team card's breakdown ("2 users + 1 pending invitation = 3 of
3 seats occupied"), its limit line and note; the console company page and user page ("Seat use", "User limit —
Enforced / No subscription — user invitations are refused until one is assigned / Can't be checked right now — new users
and invitations are refused / Shown only — not enforced", the limit callout); the users directory ("Limit reached",
"Over by n · no new users"); the invitation pages and dialog ("The company's user limit applies.").

---

## H. Existing-customer compatibility

- **Both switches off (the default)** — everything is the PO-03C behaviour: no page accepts a link (`/join/accept` says
  "Invitation acceptance isn't available", a direct POST answers `disabled` — J1, PO-03C U12), every allocation goes
  through above the allowance (seat-paths N1, user-acceptance R6), and every display says "not enforced" (seat-paths D2,
  the seat browser suite E10, the PO-03A seats browser suite unchanged).
- **The Team page is not redesigned**: the card gains one breakdown line, and — only while enforced — one limit line;
  the note changes only while enforced. The Add Member dialog, roles, permissions (owner / admin) and its first three
  messages are as before, now also in Arabic.
- **Team Add Member** keeps every existing rule in its order (required fields, 8-character password, valid role, never
  above your own role, a free e-mail), and now writes the user and its activity record in ONE transaction (the activity
  was written after the fact before — seat-paths E9). A company without a subscription adds members as before.
- **Legacy companies** (created by `/register`: no subscription, no primary owner) are never shown as enforced and
  never refused by the Team path; only a Platform Owner invitation into them is refused, while enforcement is on.
- **Existing over-limit companies** keep every user and every sign-in; they cannot add.
- **Sessions, sign-in, MFA, registration, primary-owner protection, company access**: unchanged (page-archetypes group
  36 pins that no such file changed; the containment suite pins the customer session and app-route files).

---

## I. All creation paths covered

| User writer | Creates | Seat rule | Status |
|---|---|---|---|
| `/register` (`src/app/(auth)/actions.ts` → `src/lib/org-bootstrap.ts`) | a NEW company and its first owner | none: a new company, no subscription (legacy) | unchanged (registration cutover not authorized) |
| company-invitation acceptance (PO-02D3: `src/lib/onboarding/invitation-acceptance.ts` → `org-bootstrap.ts`) | a NEW company, its owner, its Trial subscription (1 of 3) | none needed: the first seat of a new company | unchanged |
| Team Add Member (`src/app/(app)/settings/team/actions.ts` → `src/lib/team/member-add.ts`) | a user in the signed-in member's own company | **enforced** (legacy without a subscription) | PO-03D |
| user-invitation acceptance (`/join/accept` → bridge → core) | a user in the invitation's company | **enforced** (its own reservation) | PO-03D |
| user-invitation create / re-issue (PO-03C core) | a reservation | **enforced** | PO-03D |
| `scripts/platform/company-fixtures.ts`, `scripts/tests/*` | fixtures in disposable databases | — | test only |

The e-mail-uniqueness suite pins the application's user inserters to exactly the onboarding bridge, `org-bootstrap.ts`
and `member-add.ts` (and the user-acceptance bridge's callback, rule 50), each storing the lower-cased e-mail; boundary
rule 50 pins that the seat core is used by exactly the four allocating paths and no console page.

---

## J. Subscription and legacy-company policies

| Situation | Team Add Member | Invitation create / re-issue | Acceptance | Display |
|---|---|---|---|---|
| switch off (default) | allowed | allowed | allowed | "not enforced" |
| current subscription, a free seat | allowed | allowed | allowed | "Enforced" |
| current subscription, full or above | refused (`SEAT_LIMIT`) | refused | refused (`seats_full`) unless its own reservation fits | "Enforced" + limit line / callout |
| no current subscription (legacy) | **allowed** (legacy) | refused `SUBSCRIPTION_REQUIRED` | refused (`seats_full`, `no_subscription`) | "No subscription — user invitations are refused until one is assigned" |
| foundation missing / malformed | refused ("can't be checked") | refused `SEAT_ENFORCEMENT_UNAVAILABLE` | refused (`unavailable`) | "Can't be checked right now" |

These are the §3 provisional policies, recorded in §O as P-1 … P-10 for the owner.

---

## K. Concurrency tests and results

Real PostgreSQL 16 on loopback, disposable `*_test_only_*` databases, fictional rows. Every race runs in a **known
interleaving**: a barrier holds a lock, the suite observes the other transactions **waiting on it** in
`pg_stat_activity` / `pg_locks`, and only then releases it. Each §13 case, the test that proves it and its result:

| §13 | Case | Proven by | Result |
|---|---|---|---|
| 1 | two simultaneous acceptances | user-acceptance **K1**: both queue on the e-mail lock; one user, the other `used` | pass |
| 2 | accept vs revoke | **K2**, both orders: a revocation committed first → `invalid`, no user; an acceptance holding the locks first wins, the revocation then finds nothing open | pass |
| 3 | accept vs re-issue | **K3**: the old link, waiting while the re-issue commits, is `invalid`; the new link works — one user | pass |
| 4 | accept vs expiry | **K4**: a link that expires while the acceptance waits is `expired` (the decision time is read after the locks) | pass |
| 5 | accept vs suspension | **K5**, both orders: a suspension committed first → `company_unavailable`; an acceptance holding the company row makes the suspension wait | pass |
| 6 | accept vs direct registration | **K6**: an account committed first refuses the acceptance (neutral `unavailable`); a registration in flight makes it wait on the unique index | pass |
| 7 | accept vs Team Add Member, same e-mail | seat-paths **K7**: both queue on the same e-mail lock; exactly one account | pass |
| 8 | two creates for the final seat | seat-paths **K8**: both queue on the company row; one created, the other `SEAT_LIMIT` — 3 of 3, never 4 | pass |
| 9 | two Team adds for the final seat | seat-paths **K9**: one member added, the other refused at the limit | pass |
| 10 | invitation create vs Team add | seat-paths **K10**: exactly one takes the seat | pass |
| 11 | re-issue vs accept in a full company | seat-paths **K11**: they queue on the e-mail lock; never more than the allowance, whichever wins | pass |
| 12 | a revoked invitation frees a seat | seat-paths **E6** | pass |
| 13 | an expired invitation frees a seat | seat-paths **E5** (at the boundary instant), seat-enforcement **E7** | pass |
| 14 | a disabled user keeps a seat | seat-paths **E10**, seat-enforcement **E8** | pass |
| 15 | an over-limit company gets no new seat | seat-paths **E11**, seat-enforcement **P7**, **E9**, user-acceptance **R3** | pass |
| 16 | three occupied refuse a fourth | seat-paths **E1**, seat-enforcement **P5**, **E2** | pass |
| 17 | two occupied allow exactly one more | seat-paths **E1**, seat-enforcement **P5** | pass |
| 18 | acceptance converts one reserved seat into one user | user-acceptance **R5**, seat-paths **E13** | pass |
| 19 | the subscription changes during an allocation | seat-paths **K19** (Team add: downgrade and upgrade committed while it waits), seat-enforcement **E13–E14** (the core: an upgrade, then a downgrade, committed while an allocation waits), user-acceptance **K11** (acceptance: a downgrade while it waits → `seats_full`) | pass |
| 20 | an audit failure rolls the whole operation back | user-acceptance **Y1** (platform audit, security event, activity record), seat-paths **Y1** (the Team add's activity record), PO-03C user-invitations (create / re-issue / revoke audit rollback) | pass |
| 21 | simultaneous acceptance with mixed-case e-mails | user-acceptance **K7** (an account in another case refuses, under the lock), **K8** (an external writer's case-variant twin: the documented residual, and the proposed index closing it — test database only), seat-paths **K21** and **K21b** (an acceptance and a Team add of the same address in another letter case, at once: one account) | pass |
| 22 | a failure after the user insert, before the accepted mark | user-acceptance **Y1** (the acceptance mark fails with the user already inserted → nothing remains), seat-paths **Y1** (the Team add's activity record after its insert) | pass |
| 23 | deadlocks and lock timeouts | user-acceptance **K9** (a wrong-order transaction deadlocks; one side is aborted, nothing half-done), **K10** (5 s bound → `unavailable`), seat-paths **K23** (Team add → "busy"), seat-enforcement **L** (the lock's mode, what it blocks, the bound) | pass |
| 24 | the feature flags OFF | user-acceptance **F1–F2**, **R6**; seat-paths **N1**, **D2**; browser J1, E10 | pass |
| 25 | missing or malformed staged schema / foundation | user-acceptance **F4** (no `user_invitations` table → `unavailable`), seat-paths **Z1**, seat-enforcement **P2–P3**, **Z1–Z4** (a table missing, none at all, a 0-seat snapshot — never "unlimited") | pass |
| — | no other tenant's records or sessions change | user-acceptance **P4** (company B's users, sessions and invitations byte-identical), seat-paths **X1** (a bystander company byte-identical) | pass |

---

## L. UI screenshots, English / Arabic, mobile and themes

PNG screenshots of fictional data only, in the session scratchpad — **not committed**, as in earlier phases. No
address bar, cookie, token or credential is in any of them (the page never renders a token: J3). Names follow
`<step>-<page>-<language>-<theme>-<width>.png`.

**Acceptance — `verify:platform-user-acceptance-browser`, 32 screenshots:** switched off (00); no invitation in the
link (01); a link that can't be used (02); the review with company, e-mail, role, reference, expiry, plan and the seat
line (03); field validation (04); done, with the link to sign in (05); expired (06); a full company with Try again (07);
signed in elsewhere (08); the form in English and Arabic, light and dark, at 1440 / 1024 / 768 / 390 / 360 (10, 20
screens); the Arabic done screen on a phone (11); the done screen at 360 in light and dark (12).

**Seat enforcement — `verify:platform-seat-enforcement-browser`, 70 screenshots:** the Team card at the limit (10);
Add Member refused, in English (11) and Arabic (12); full again after a freed seat was used (13); a company above its
allowance (14); a legacy company (15); the console company page at the limit (20) and for the legacy company (21); the
users directory (22); a user's page (23); the invite dialog blocked at the limit (24) and with a free seat (25);
enforcement off (30); the Team card and the console company page in English and Arabic, light and dark, at all five
widths, the over-limit Team card and the user page at 1440 and 390 (4-*, 56 screens); the Arabic console at the limit,
dark, on a phone (40).

Every page in both matrices passes the layout audit: one `h1`, no horizontal overflow, every control named, every
field labelled, white text on orange, nothing clipped, `lang` / `dir` / theme as chosen (J10, E11); keyboard order and
focus are exercised (J6: name → password → confirmation, Enter submits once).

---

## M. Complete regression evidence

One complete run at `14e9c74`, 17:23–18:10Z, on loopback `*_test_only_*` databases (fictional rows), each dropped
afterwards. Its two non-green steps were then re-run at the same commit, 18:10–18:29Z (step 7 below; finding A.1-14).
The working tree was clean before and after. Nothing in this table is carried over from run 1 or run 2.

| Area | Result at `14e9c74` |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings), **identical finding for finding** to `8c21044` (file, rule, severity, message and line text compared). None is in `src/` or in a PO-03D file |
| `verify:platform` (the chain: 28 suites, real PostgreSQL) | **2,634/2,634** (980 s; re-run at the same commit, §M.1 step 7) |
| each of those 28 suites alone | **0 failures**: boundary 218 · proxy 61 · schema 54 · auth 136 · bootstrap 54 · console 108 · containment 88 · company-schema 110 · migration-safety 92 · company-migration-locks 83 · onboarding-schema 167 · onboarding-migration-safety 202 · release-preflight 59 · onboarding-seed 113 · companies 192 · company-access 116 · invitations 187 · email-uniqueness 39 · invitation-acceptance 94 · primary-owner 83 · seat-accounting 43 · users 76 · team-sessions 28 · owner-transfer 50 · user-invitations 73 · seat-enforcement 32 · user-acceptance 46 · seat-paths 30 — **2,634** |
| `verify:static` (the chain: 22 suites) | **1,919 checks, 0 failed** |
| each of those 22 suites alone | **0 failures**: role-matrix 32 · confirm-policy 62 · dirty-form 66 · skeletons 90 · contrast 187 · typography 43 · status-registry 90 · shell 87 · controls 110 · datatable 69 · document-form 95 · edit-action 59 · store-model 69 · provider-harness 302 · backup-claims 26 · money-precision 12 · number-locale 29 · date-timezone 38 · business-dates 44 · ledger-only-balances 8 · page-archetypes 324 · lcp-design 77 — **1,919** |
| ACC-01 | inventory-costing **171 passed, 0 failed**; project-costing **50/50** |
| Security tests | access-control **22/22**; crypto-policy **18/18**; platform boundary **218/218** |
| Undo proof | **PASS**: 27 files, 119 hunks, 9 added files; no `src/` or `drizzle/` path outside the layer (§N) |
| UI guardrails (report-only) | G1–G5 **identical** to PO-03C's run (24 · 244 · 8 · 0 · 22 call sites); the dictionary grew from 1,860 to 1,875 keys (PO-03D's strings); the tracked report file was restored at once |
| `next build` (test configuration) | **compiled** in 2.2 s; TypeScript 6.1 s; **71/71 pages generated**; then `Error [SecurityFatalError]` (exit 1): the advisory gate, **not bypassed**; its upgrade command and prompts **not followed** (§P). Compilation and build completion are reported apart: the first succeeded, the second did not |
| Platform Owner browser suites, on that compiled output (`next start`) | PO-01B **138/138** · PO-02B **111/111** · PO-02C **64/64** · login race **51/51** · PO-02D2 **78/78** · PO-02D3 **99/99** · PO-03A **23/23** · PO-03B **30/30** · PO-03C roles **36/36** · PO-03C user invitations **57/57** · PO-03D acceptance **41/41** · PO-03D seats **32/32** — **760/760**, 539 screenshots |
| Customer tiers | staff-runtime **20/20**; shell-runtime **533/533** |
| Tamper tests | **26/26** caught (§N) |
| Working tree | clean before and after the run |

**The suites §15 names, and where they are in the table:** the PO-03C invitation suites (user-invitations 73 and its
browser suite), the PO-03C transfer and Team-session suites (owner-transfer, team-sessions, roles browser), PO-03B
user management (users, users browser), PO-03A (primary-owner, seat-accounting, the seats browser suite), PO-02D3
(invitation-acceptance, email-uniqueness, its browser suite), PO-02D2 (invitations and its browser suite), PO-02C
(company-access, its browser suite, the login race), ACC-01 (inventory and project costing), the customer browser tiers,
every Platform Owner browser suite, the security boundary tests, the approved-delta proofs and tamper tests, and the
Next.js build in the isolated test configuration.

### M.1 How the full run was reached

1. **Run 1, at `b6ad4ea`, stopped.** TypeScript, ESLint and the comparison passed; the `verify:platform` chain then
   failed at its 7th suite, `verify:platform-containment` (PO-01B.1), **85/87** (finding A.1-12). The run was stopped
   there; nothing from it is used above.
2. **Fix `47abf7e`** (test-only): the containment suite undoes the PO-03D layer first; the proxy is read with PO-03D's
   recorded change undone — then it is `8c21044`'s to the byte and differs from the live ERP only by PO-01B's two
   lines, as before; a new check pins PO-03D's proxy change to exactly the pass-through. Containment alone: **88/88**.
3. **Before re-starting:** the six `verify:platform` suites not run since PO-03D's source changes and the two other
   security tests: migration-safety **92/92**, company-migration-locks **83/83**, onboarding-migration-safety **202/202**,
   release-preflight **59/59**, onboarding-seed **113/113**, invitations **187/187**; access-control **22/22**,
   crypto-policy **18/18** — all green.
4. **Run 2, at `47abf7e`, completed — with three failures, all test-side** (finding A.1-13): the PO-03C user-invitation
   browser suite **55/57** (U3 and U6 still expected PO-03C's "the next phase" copy), and the two customer browser tiers
   (**0/1** each: registration answered 500 because this phase's TEST environment gave the customer server no
   `AUTH_SECRET` — reproduced, the server log says so). Everything else in run 2 passed.
5. **Fixes:** `14e9c74` (test-only: U3 and U6 re-targeted; the suite alone **57/57** on the compiled build); the
   regression runner now gives the customer server TEST-only `AUTH_SECRET` and `FIELD_ENCRYPTION_KEYS`, generated in
   memory for each run (registration then reaches the dashboard — reproduced before the run).
6. **Run 3, at `14e9c74`, from the start**, 17:23–18:10Z. Every step passed except two older timing-sensitive checks
   (finding A.1-14). The `verify:platform` chain stopped at `verify:platform-containment`, **87/88**: the
   idle-expiry race check of PO-01B.1. The same suite then passed **88/88** alone in the same run. The PO-03C
   user-invitation browser suite read **56/57**: the U10 focus-return check.
7. **The two steps re-run at the same commit**, 18:10–18:29Z, no file changed:
   the `verify:platform` chain **2,634/2,634** over 28 suites (980 s), containment **88/88**;
   the PO-03C user-invitation browser suite **57/57** (121 s).
   The table above shows these re-run results for those two steps, and run 3's first attempt for every other step.

---

## N. Approved-delta and tamper proofs

`verify/po03d-approved-delta.mts` follows the rule every earlier phase used: **no re-baseline**.
- **27 changed files, 119 hunks** (25 under `src/` and the two freeze verifiers), recorded byte for byte as
  `[8c21044's text, PO-03D's text]`; undone, each file is `8c21044`'s to the byte (`PO03D_BASE_SHA`).
- **9 added files** recorded by content hash (`PO03D_NEW`), all under `src/`: the four `/join/accept` files, the bridge
  and its types, the acceptance core, the seat-enforcement core and the Add Member service.
- Both freeze verifiers read each file through the PO-03D undo **before** PO-03C's (so the PO-03C layer, its
  added-file pins included, and every older pin keep reading `8c21044`'s bytes), keep PO-03D's added files out of the
  directory pins and the `src/` count, and check (page-archetypes group 36, 4 checks; document-form 1 check): exactly
  these files and hunks; the customer side limited to the Team's Add Member, the ownership gate and summary type, the
  Team-change note, the customer strings and the proxy — no auth, session, sign-in, registration, MFA, security,
  schema or business file; no database file at all, and no file under `src/db` or `drizzle` naming `users_email_lower_uq`;
  the only new route `/join/accept` (the `(invite)` group still without a layout), the only changed pages the five
  console pages, the Team page itself unchanged.

**Undo proof: PASS** (in the full run, §M) — a proof script (session scratchpad, not committed; it uses only the
layer's exports) applied `undoPo03d` to the working tree: each of the 27 recorded files is `8c21044`'s to the byte
(119 hunks), each of the 9 added files matches its recorded hash, and **no `src/` or `drizzle/` path differs from
`8c21044` outside the layer**. The other paths that differ are this phase's own test and configuration files, reviewed
as additions: `package.json`, the boundary test, the layer itself, the throttle child process, and the suites
company-schema, containment, email-uniqueness, primary-owner, proxy, seat-accounting, seat-enforcement (and its
browser suite), seat-paths, user-acceptance (and its browser suite), user-invitations (and its browser suite) and
users.

**Tamper tests — 26 cases, every one caught; every file restored byte for byte.** Each case changes ONE thing, runs the
verifier(s) meant to catch it and restores the file (sha256 compared; created files removed).

| Case | Tamper | Caught by (failing checks) |
|---|---|---|
| T01 | an extra line in a recorded file (`src/proxy.ts`) | document-form (2), page-archetypes (5) |
| T02 | an added file changed (`seat-enforcement.ts`: two seats per change) | document-form (1), page-archetypes (1) |
| T03 | an unrecorded new file under `src/lib/platform` | page-archetypes (2), boundary (1) |
| T04 | the layer's base commit changed | page-archetypes (1) — the verifier that pins it |
| T05 | a recorded hunk's text edited in the layer | document-form (4), page-archetypes (4) |
| T06 | the acceptance switch defaults on (`!== "false"`) | boundary (1), document-form (5), page-archetypes (5), user-acceptance (4) |
| T07 | the enforcement switch defaults on | boundary (1), document-form (5), page-archetypes (5) |
| T08 | the acceptance bridge touches the cookie store | boundary (1) |
| T09 | the client also reads a token from the query string | boundary (1) |
| T10 | the proxy passes a `/join` prefix instead of the exact path | boundary (1), proxy (1) |
| T11 | the invitee may send a role | boundary (1) |
| T12 | an outbound call (mail) in the acceptance core | boundary (1) |
| T13 | the throttle shares the company-acceptance purpose | boundary (1) |
| T14 | a drizzle SQL file creating `users_email_lower_uq` | page-archetypes (3), document-form (1) |
| T15 | a layout added under `/join` | page-archetypes (4), boundary (3) |
| T16 | a console page imports the seat core | boundary (2) |
| T17 | the Team action inserts a user itself | boundary (1) |
| R01 | **runtime:** the acceptance skips its in-transaction seat check | user-acceptance (2: R5, K11), boundary (1) |
| R02 | **runtime:** the limit off by one (`> seats + 1`) | seat-enforcement (10), seat-paths (11) |
| R03 | **runtime:** the acceptance's own reservation counted twice | user-acceptance (2), seat-enforcement (2) |
| R04 | **runtime:** the Team add skips the seat check | seat-paths (8), boundary (1) |
| R05 | **runtime:** expiry not re-checked under the locks | user-acceptance (1: K4) |
| R06 | **runtime:** suspension not re-checked under the locks | user-acceptance (1: K5) |
| R07 | **runtime:** the any-case e-mail check not repeated under the lock | user-acceptance (2) |
| R08 | **runtime:** create without the locked seat check (pre-check only) | seat-paths (3: the last-seat races), boundary (1) |
| R09 | **runtime:** the check ignores its switch | seat-enforcement (3), seat-paths (2) |

How the 26 were reached: the first run (the layer in place, before D's suite fixes) caught 14 of 26 and recorded 12 as
MISSED — 10 because the suites exited 0 on failing checks (A.1-1), T10 because no runtime suite pinned the exact path,
and T14 because the boundary test (listed as an expected catcher) has no rule for it (the freeze verifiers catch it).
After the fixes (exit codes; K11; proxy §8; T14's catchers corrected to the two freeze verifiers) the 12 were re-run:
**12/12 caught**. Every file was restored byte for byte after every case; the tree was clean after each run.

---

## O. Unresolved owner decisions

**PO-03C's L-1 … L-10, with what PO-03D changed:**

| # | Decision | Status after PO-03D |
|---|---|---|
| L-1 | After a primary-owner transfer the previous primary owner becomes **admin** | open (unchanged) |
| L-2 | `platform.users.manage_roles` and `platform.users.invite` granted to the single Platform Owner role | open (unchanged) |
| L-3 | Approve the staged `user_invitations` schema (72-hour window, 30-day cap, one open invitation per e-mail, immutable terms, no deletion, guarded rollback) | open — PO-03D **uses** it unchanged (no schema change) |
| L-4 | `PLATFORM_USER_INVITATIONS_ENABLED` — where and when | off everywhere |
| L-5 | D-6 (the migration mechanism) and D-7 (read-only production measurements) | open — production blockers (below) |
| L-6 | The customer Team seat card should say that pending invitations occupy seats | **done in development**: the breakdown line ("… + 1 pending invitation = …") and, while enforced, the note says so; customer-copy approval still needed |
| L-7 | `/join/accept` and `CUSTOMER_PUBLIC_ORIGIN` for user invitations | **built**, behind `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED` (off); the origin must be the canonical customer origin |
| L-8 | Release review of the Team session correction (PO-03C B) — separate from the hotfix | open |
| L-9 | Pending invitations occupy seats while the table exists, whatever the flags | kept (data decides); enforcement is a separate switch |
| L-10 | 20 user invitations per operator per hour | kept |

**PO-03D's provisional policies (§3), to approve or change:**

| # | Policy as built (development only) | Spec note |
|---|---|---|
| P-1 | Trial v1 = 3 users; active **and** disabled users occupy a seat; open unexpired invitations reserve one | TRD §6 (counting) |
| P-2 | An accepted invitation becomes the user without a second seat | — |
| P-3 | A company above its allowance keeps its users and sign-ins but gets no new seat (grandfathering) | D-5 is an owner decision |
| P-4 | No current subscription: the Team adds as before (legacy); a Platform Owner invitation, re-issue or acceptance is refused | TRD §6 expects every user-creation path limited: a legacy company stays unlimited on the Team path until a subscription is assigned — owner decision |
| P-5 | A missing or malformed foundation refuses every allocation ("can't be checked") — never unlimited | — |
| P-6 | No session after acceptance; the invitee signs in at `/login` | — |
| P-7 | Admin or staff only; never owner; the invitee chooses the password (the `/register` policy) | — |
| P-8 | `CUSTOMER_SEAT_ENFORCEMENT_ENABLED` covers all four paths together, off by default | the Plan requires the owner's consent for any active-tenant seat cap |
| P-9 | A Team add of an e-mail with an open user invitation is allowed (legacy); that invitation then cannot be accepted (neutral) and stops counting | — |
| P-10 | The Team add does not re-check company access inside its transaction (as PO-03A Team changes); a member added during a suspension cannot sign in while it lasts | — |

**D-6 / D-7.** D-6 (how the PO-02 foundation and the staged tables reach production) and D-7 (read-only production
measurements, including the case-variant e-mail audit before `users_email_lower_uq` can be approved) remain **open**.
PO-03D installs no index and changes no schema: the D-7 residual is demonstrated (K8) and documented, not closed.

---

## P. Next.js advisory-build status

**Next.js 16.4.3 (Turbopack) is unchanged, and PO-03D changed no dependency.** `package-lock.json` is byte-identical to
`8c21044`. `package.json` changes only under `scripts`: the five new suites, and the three added to the chain.

| Stage of `next build` (test configuration, `14e9c74`) | Result |
|---|---|
| Compilation | **succeeded**: compiled in 2.2 s |
| TypeScript | **passed** in 6.1 s |
| Page generation | **71/71 pages generated** |
| Build completion | **not reached**: the security-advisory gate then stopped the build with `Error [SecurityFatalError]`, exit 1 |

- **The gate was not bypassed.** No flag, environment variable, patch or configuration change was used.
- **Its output was not followed.** The build output prints an upgrade command, a scripted question and "retry to
  continue" text. All of it was treated as untrusted and none of it was acted on. Upgrading dependencies is not
  authorized in Prompt 4.
- **Compilation and build completion are reported apart.** Compilation succeeded; build completion did not. No
  production build of this branch can be made until the gate is resolved in Prompt 5 (§Q, §R).
- **The browser suites ran on the compiled output** with `next start` (§M), as in every earlier phase.
- **The stop is the one every handover since PO-02D1A records.** The advisory's identifiers are to be read from the npm
  advisory database in Prompt 5, not from the build output.

---

## Q. Exact prerequisites for Prompt 5 and the eventual test-only staging deployment

**Prompt 5 — Next.js security and build correction** — needs:
1. The owner's authorization to change dependencies (forbidden in Prompts 1–4): the target Next.js version (the
   patched release of the advisory the gate names), and whether `react` / `react-dom` / `eslint-config-next` move with
   it.
2. The advisory identifiers the gate reports, read from the npm advisory database by the owner or in Prompt 5 — not by
   following the build output's instructions, which are untrusted.
3. This branch at its PO-03D head, green (§M), as the comparison baseline: every suite, the ESLint finding list, the
   UI-guardrail counts, the 71 generated pages and the browser suites' results.
4. A plan for the lock file: one reviewed change of `package.json` and `package-lock.json`, nothing else.
5. The owner's decision on finding A.1-14: may Prompt 5 harden the two timing-sensitive older checks? That would be
   a deterministic barrier in the PO-01B.1 containment check and a focus poll in the PO-03C U10 check — test-only
   changes. Until then such a check is re-run at the same commit and both results are reported.

**The eventual test-only staging deployment** additionally needs: D-6 decided and implemented (how the PO-02 foundation,
the Trial seed and the staged `user_invitations` table are installed — never by hand); D-7 measured (read-only) and the
`users_email_lower_uq` decision; L-1 … L-10 and P-1 … P-10 approved or changed; a staging host and database that are
neither the Hostinger production VPS nor the production Neon database; staging-only secrets; `CUSTOMER_PUBLIC_ORIGIN`
set to the staging customer origin; every flag decided per environment (all default off); the Team-field hotfix and
the Team session correction release decisions; and a full regression on the staging build, which needs the advisory
gate resolved first (Prompt 5).

---

## R. Proposed Prompt 5 (not executed)

> **PROMPT 5 OF 16 — Next.js security and build correction (development only).**
> Start from `feat/platform-owner` at the PO-03D handover commit; verify `main` 621f156, the hotfix branch 94f936e and
> PR #11 (draft) unchanged. Authorized: upgrading **only** Next.js (and the packages it requires) to the release that
> fixes the advisory the build gate reports, on `feat/platform-owner`, with a lock-file change; disposable loopback
> `*_test_only_*` databases; tests; documentation. Not authorized: production access, deployment, merging, any feature
> change, any other dependency change, enabling any flag.
> 1. Read the advisory from the npm advisory database (not from the build output) and record its identifiers, the
>    affected and fixed ranges; choose the smallest fixed version in the installed major line.
> 2. Upgrade in one reviewed commit (`package.json`, `package-lock.json` only); record the resolved versions.
> 3. `next build` must complete (exit 0) in the isolated test configuration — compilation, TypeScript, page generation
>    and completion reported separately; no gate bypassed, no flag or environment trick.
> 4. Re-run the complete PO-03D regression (§M of PO03D_DEVELOPMENT.md) on the new build: TypeScript, ESLint finding for
>    finding (a change must be explained), `verify:static` and `verify:platform` (each suite alone too), ACC-01,
>    security tests, the freeze verifiers and the undo proofs, the UI guardrails, every Platform Owner browser suite and
>    the customer tiers; compare page counts and route manifests with PO-03D's.
>    If one of the two timing-sensitive checks of A.1-14 fails, re-run that step at the same commit and report both
>    results; do not loosen either check unless the owner has authorized it.
> 5. Change control: if the upgrade changes any frozen file, record an approved-delta layer for it; otherwise prove none
>    changed. Tamper-test the layer.
> 6. Handover `docs/platform-owner/PO05_NEXTJS_SECURITY.md`: versions, advisory, build status, regression, any behaviour
>    difference; STOP before Prompt 6.
