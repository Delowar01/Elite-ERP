# Platform Owner — PO-03C: primary-owner transfer, role management, the Team session correction and customer-user invitations

> Phase PO-03C of the Elite ERP Platform Owner programme (Prompt 3 of 16). **Development only.** Three independently
> tested sub-batches on `feat/platform-owner`, from the PO-03B handover `985830f`:
>
> - **A — primary-owner transfer and role management.** The Platform Owner can change a customer user's role and move a
>   company's primary ownership, behind one new permission (`platform.users.manage_roles`), a reason and a fresh TOTP
>   code, in one transaction with the customer's evidence and the platform audit.
> - **B — the customer Team session correction.** A Team deactivation, reactivation or role change now ends the member's
>   sessions in the same transaction. Its own commit, separate from the production-baseline security hotfix.
> - **C — customer-user invitation administration.** Invite a new admin or staff member into an existing company,
>   revoke, re-issue, list and inspect — copy-link only — on a **staged** table that is not installed by the platform SQL
>   chain and is **not authorized for production**. Pending invitations now occupy seats in the display. Behind
>   `PLATFORM_USER_INVITATIONS_ENABLED`, off unless exactly `"true"`.
>
> Out of scope and not done: user-invitation **acceptance** (no route serves the link), **seat enforcement**, any e-mail,
> SMS or WhatsApp, impersonation, a custom role editor, more platform operators, changes to legacy primary-owner
> mappings, changes to public registration, dependency upgrades. Prompt 4 has not been started.
>
> Every database used was a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one
> was dropped. Production (Neon, the Hostinger VPS) was not accessed. No SQL was executed anywhere but those databases.
>
> **Release status: NO-GO for production** (§M): the staged schema needs an owner decision and the D-6 release
> mechanism, the D-7 production measurements are outstanding, and the Next.js security-advisory gate stops every build.

---

## A. Final status and SHA

| Item | Value |
|---|---|
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (PO-03B handover) | `985830f5617767fb1e85aef67723570125ed490c` |
| Code head (A + B + C + change control) | `353e02b` — this document is the commit after it |
| Production `main` | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| Hotfix branch | `fix/team-sensitive-fields-exposure` at `94f936eb019be446282536b8fcdeede6ae9e510c` — untouched (§O) |
| PR #11 | draft, unmerged, not modified |

| Step | Status |
|---|---|
| A — transfer and roles | done (`723ce95`). `verify:platform-owner-transfer` **50/50**, `verify:platform-roles-browser` **36/36** (§C, §D). |
| B — Team session correction | done (`62d5109`). `verify:platform-team-sessions` **28/28** (§E). |
| C — user invitations | done (`3ac0b14`). `verify:platform-user-invitations` **73/73**, `verify:platform-user-invitations-browser` **57/57**, 48 screenshots (§F–§J). |
| Change control | done (`e07c581`). One PO-03C approved-delta layer for A + B + C: 15 files, 69 hunks, 14 added files; both freeze verifiers hooked. (Boundary rule 49, 10 checks, and the K4 barrier were committed with C in `3ac0b14`.) **23 tamper cases, every one caught** (§K). |
| Full regression | **green** at `353e02b` (one run, 08:19–09:10Z): every suite passes; `next build` compiles and generates all 71 pages, then stops at the Next.js advisory gate, which was not bypassed (§K) |
| This document | done |
| **STOP gate** | **STOPPED.** Prompt 4 is not started. No merge, deployment, PR change, production access, real account or real message. |

### A.1 Findings for owner attention

1. **Two older-suite pins were found broken after their sub-batch's commit, and each was fixed in its own commit.**
   - `verify:platform-onboarding-schema` pins the exact list of files that name an onboarding table. A's transfer
     updates `tenant_primary_owners` from `customer-user-actions.ts`; the suite was not re-run at `723ce95`, where it read
     166/167. Fixed in `1e8206f` (test-only): the file is named, with three narrower checks (no other onboarding table,
     exactly one update, no insert or delete).
   - `verify:platform-company-schema` pins which modules reference the PO-02A company tables and which import the
     access-compatibility module. C's modules were not run against it before `3ac0b14`, where it read 108/110; the first
     final-regression attempt found it. Fixed in `353e02b`: both modules named, plus a check that the user-invitation
     rules never name the access table or write a company invitation; the staged declaration's comment no longer names
     `organization_invitations` (so that pin stays exact).
   No product behaviour changed in either fix.
2. **The customer Team seat card counts pending user invitations without saying so** — wherever the staged table exists.
   Its note still reads "Active and disabled accounts both occupy a seat." Changing customer copy was out of scope; it is
   decision L-6 and part of Prompt 4. Production has no `user_invitations` table, so nothing changes there.
3. **The previous primary owner becomes admin** after a transfer. This is a development-only policy that needs approval
   (L-1).
4. **A console "not found" page arrives with HTTP 200**, because console pages stream behind `(console)/loading.tsx`.
   This is pre-existing for every console 404; the page itself is the console's own not-found and shows no data.
5. **One existing console string is stale:** the company page's owners note still says "User management arrives in phase
   PO-03". It is PO-02B text, not changed here.
6. **A reporting correction.** The PO-03B handover quoted `verify:static` as "77/77": that is the line of the chain's
   last suite (lcp-design), not the chain's total. The chain stops on the first failing suite and every suite was also
   run alone, so that result stands; this document gives the total — **1,914 checks in 22 suites** (§K).

---

## B. Changed files and sub-batch commits

| Commit | Sub-batch | Summary |
|---|---|---|
| `62d5109` | B | `fix(team)`: Team deactivation, reactivation and role changes end the member's sessions |
| `723ce95` | A | `feat(platform)`: primary-owner transfer and customer-user role management |
| `1e8206f` | A (pin) | `test(platform)`: onboarding-schema pin covers A's mapping update (finding A.1-1) |
| `3ac0b14` | C | `feat(platform)`: customer-user invitation administration |
| `e07c581` | change control | `test(platform)`: PO-03C approved-delta layer and freeze-verifier hooks |
| `353e02b` | C (pin) | `test(platform)`: company-schema pins name the user-invitation modules (finding A.1-1); the layer regenerated |
| (next) | docs | this document |

Each commit is reviewable on its own; none was amended, squashed or force-pushed.

### B.1 Sub-batch B (`62d5109`) — 7 files

| File | Change |
|---|---|
| `src/lib/team/customer-user-core.ts` | `endCustomerUserSessions` used by the Team service; `setCustomerUserRole` (the one role write); the Team evidence type `team.member_sessions_ended` |
| `src/lib/team/member-changes.ts` | deactivation, reactivation and a real role change end the member's sessions in the same transaction |
| `verify/verify-platform-team-sessions.mts` | **NEW** — 28 checks |
| `verify/verify-platform-users.mts` (N2), `verify/verify-platform-primary-owner.mts` (N3) | pins re-targeted to the new behaviour |
| `tests/security/platform-boundary.test.mjs` | rules 46/47 extended by name |
| `package.json` | the suite's script |

### B.2 Sub-batch A (`723ce95`) — 20 files

| File | Change |
|---|---|
| `src/lib/team/customer-user-core.ts` | `demotionBlock` (ONE owner rule for the Team and the console), `OWNER_TRANSFER_REVOKE_REASON`, two evidence types |
| `src/lib/team/member-changes.ts` | the Team role rule calls `demotionBlock` (same behaviour) |
| `src/lib/platform/customer-user-actions.ts` | `changeCustomerUserRoleCore`, `transferPrimaryOwnerCore`, their two reads |
| `src/lib/platform/customer-users.ts` | the role-state and transfer-options reads (allow-listed) |
| `src/lib/platform/guards.ts`, `errors.ts` | `platform.users.manage_roles`; `OWNER_NOT_DESIGNATED`, `TRANSFER_TARGET_INVALID` |
| `src/app/(platform)/customer-user-role-actions.ts` | **NEW** — four server actions, strict schemas |
| `src/components/platform/customer-user-role-control.tsx`, `primary-owner-transfer.tsx` | **NEW** — the Change role dialog and the transfer dialog |
| `users/[userId]/page.tsx`, `companies/[orgId]/page.tsx`, `i18n.ts`, `platform.css` | the controls placed, strings, two layout classes |
| `verify/verify-platform-owner-transfer.mts`, `verify/verify-platform-roles-browser.mts` | **NEW** — 50 and 36 checks |
| boundary test, `verify-platform-companies`, `-invitations` (#7), `-primary-owner` (N5), `package.json` | pins extended by name; scripts; chain |

### B.3 Sub-batch C (`3ac0b14`) — 27 files

| File | Change |
|---|---|
| `drizzle/platform/PO03C_user_invitations.sql`, `PO03C_user_invitations_rollback.sql` | **NEW** — the staged table and its guarded rollback (§G) |
| `src/db/staged/platform-user-invitations.ts` | **NEW** — the matching Drizzle declaration, outside the schema barrel |
| `src/lib/platform/user-invitations.ts` | **NEW** — read model and shared rules |
| `src/lib/platform/user-invitation-actions.ts` | **NEW** — create, revoke, re-issue (the only writer) |
| `src/app/(platform)/user-invitation-actions.ts` | **NEW** — five server actions, strict schemas |
| `src/components/platform/user-invitation-dialogs.tsx` | **NEW** — Invite user, Revoke, Re-issue, the one-time link panel |
| `users/invitations/page.tsx`, `not-found.tsx`, `[invitationId]/page.tsx`, `[invitationId]/not-found.tsx` | **NEW** — list and detail |
| `companies/[orgId]/page.tsx`, `users/page.tsx` | the User invitations panel; the directory's link (flag on) |
| `seat-accounting.ts` | pending invitations occupy seats (display only) |
| `flags.ts`, `guards.ts`, `errors.ts`, `i18n.ts`, `platform.css` | the flag, `platform.users.invite`, two error codes, strings, three classes |
| `verify/verify-platform-user-invitations.mts`, `-browser.mts` | **NEW** — 73 and 57 checks |
| boundary test, `verify-platform-companies`, `-invitations` (#7), `-primary-owner` (N7), `-seat-accounting` (N1), `package.json` | rule 49; pins extended by name; scripts; chain |

### B.4 Change control (`e07c581`) — 3 files

`verify/po03c-approved-delta.mts` (**NEW**) and the hooks in `verify/verify-document-form.mts` and
`verify/verify-page-archetypes.mts` (§K.2).

---

## C. Primary-owner transfer — evidence

**Who and how.** Only a live Platform Owner session with `platform.users.manage_roles`, same-origin, a 10–500 character
reason and a fresh, replay-protected TOTP code (the durable throttle shared with sign-in applies). The dialog first reads
the **current** state and shows the current primary owner, the chosen new owner and the exact effects.

**Who can receive it.** An **active** user of the **same** company who is not the current primary owner. A disabled user,
another company's user, the current owner and an unknown id are refused; the candidate list contains active users of
that company only.

**One READ COMMITTED transaction**, in the PO-03A lock order: TOTP (the operator row) → the company row `FOR NO KEY
UPDATE` → BOTH users by ascending id `FOR NO KEY UPDATE` → the mapping `FOR SHARE`. Inside it, everything is re-checked:
the company has a mapping (else `OWNER_NOT_DESIGNATED` — a legacy company is never inferred or assigned), the mapping
still names the page's owner, the target belongs to this company and is active, and both accounts' change markers
(`updated_at` to the microsecond) still match the page. Then:
1. the new owner becomes an **active owner**;
2. ONE `UPDATE` moves the mapping — by company **and** previous owner, exactly one row;
3. the previous owner becomes **admin** (development policy, L-1);
4. **both** accounts' sessions end (`owner_transfer`);
5. each account's own security log records the change (no IP, user agent or device); the platform audit records
   `company.primary_owner_transferred` — all in the same transaction.

Any failure rolls everything back. Every refusal after the format check is recorded as a rejected attempt with its stage.

| Evidence (`verify:platform-owner-transfer`, 50/50) | |
|---|---|
| X1 authorization | no session, a forged or a customer token → UNAUTHORIZED; cross-site → FORBIDDEN; console off → CONSOLE_DISABLED; the permission is `manage_roles`; nothing changes on refusal |
| X2 options | active candidates of the company only; allow-listed fields; a legacy company "not designated", no candidates |
| X3 success | mapping, roles, both sessions ended, other users untouched, both evidence records, the audit, a new sign-in carries the owner role; transfer to a co-owner |
| X4 refusals | same account / other company / unknown before any code is spent; disabled target inside the transaction (code rolled back); wrong and replayed codes; malformed input; mapping unchanged; rejections recorded |
| X5 legacy and stale | no mapping → OWNER_NOT_DESIGNATED; an owner no longer primary → VERSION_CONFLICT |
| X6 concurrency (barriers) | two transfers: both wait at the company row, exactly one applies; transfer vs disable in both orders |
| X7 stale pages | a changed account → VERSION_CONFLICT, nothing moves (also for a role change) |
| X8 failures | audit refused → nothing; an interruption after the roles, mapping and first evidence → nothing; a lost connection before COMMIT → nothing, then success |
| P1–P4 | business tables byte-identical; no secret or canary in any audit record or console output |

Browser (`verify:platform-roles-browser`, 36/36): R4 transfer (both owners shown, the effects, success, BOTH customers'
browsers signed out, mapping, roles and activity), R5 a legacy company is "Not designated" (control disabled; a direct
POST refused), R6 a stale company page is told to refresh.

---

## D. Role management — security

Roles are the three ERP roles only (owner, admin, staff): no custom role editor, no impersonation, no extra operators.
A change needs `platform.users.manage_roles`, same-origin, a reason, a fresh TOTP code and the version the page showed.

| Rule | How it is enforced | Evidence |
|---|---|---|
| no unauthorized elevation | the permission, re-checked by the server action's core on every call | X1, R8 |
| the mapped primary owner never leaves the owner role | `demotionBlock` → LAST_PRIMARY_OWNER (transfer first) | R2a |
| the last active owner is never demoted | `demotionBlock` → LAST_ACTIVE_OWNER | R2b |
| no cross-company id substitution | the user's company must equal the page's company, else NOT_FOUND | R2d |
| no stale data | the account's change marker must match | X7b |
| no TOTP reuse | replay-protected consumption inside the transaction | R2f |
| invalid roles | strict schema enum + core parser | R2c, R8 |
| same role | CONFLICT | R2e |
| sessions end | `role_change`, that account only | R1a |
| atomic audit | customer evidence + platform audit in the transaction | R1b, X8 |

`demotionBlock` is ONE rule shared with the customer Team role change, so the console and the Team page cannot drift.

---

## E. Team session-revocation correction (sub-batch B)

PO-03B found that a customer Team deactivation left the member's session rows live (every request was still refused,
because `is_active` is checked). Since `62d5109`, in the same READ COMMITTED transaction and PO-03A lock order:

| Team action | Sessions | Reason | Customer evidence |
|---|---|---|---|
| deactivate | every live session of the member ends | `disabled` | `team.member_sessions_ended` (deactivated) |
| reactivate | any session left from before ends — nothing is revived; the member signs in again | `reenabled` | recorded only if one was ended |
| real role change | the member's sessions end | `role_change` | `team.member_sessions_ended` (role_changed) |

Other members' sessions are untouched; the Team interface, permissions, refusals and 13 translated messages are
unchanged. The role write moved into the shared service, so `users.role` and `users.is_active` each have exactly one
writer. **This is a development commit.** It is not part of the production-baseline security hotfix
(`fix/team-sensitive-fields-exposure`) and needs its own release review (L-8).

Evidence (`verify:platform-team-sessions`, 28/28): T1–T3 the three actions and their records; T4 the owner protections
still refuse (sessions stay live); T5 a security-log failure rolls the change back; **T6 races against PO-02C.1 session
issuance** with deterministic barriers (a deactivation waits for an in-flight sign-in, then ends the session it created;
a sign-in that starts during a deactivation is refused); T7 a legacy-path session is unusable and ended on
reactivation; T8 messages, translations and server actions unchanged; T9 business data byte-identical, no secret printed.

---

## F. Customer-user invitations — implementation (sub-batch C)

**What it is.** An invitation asks a NEW person to join an EXISTING company as **admin or staff** (never owner). It is
copy-link only: the link is shown **once**, in the dialog that created it, and nothing is emailed or messaged. Nothing
accepts it yet — `/join/accept` is served by no page or route (§N).

**Gates, in order, on every call** (never trusted from the UI): `PLATFORM_CONSOLE_ENABLED` and
`PLATFORM_USER_INVITATIONS_ENABLED` (each exactly `"true"`) → same-origin → the live Platform Owner session →
`platform.users.invite` (changes) or `platform.users.read` (reads) → the staged table exists
(`USER_INVITATIONS_NOT_INSTALLED` otherwise) → audit protection → strict format → read-only pre-checks → step-up.

| Operation | Step-up | Refused when |
|---|---|---|
| **Create** | password + fresh TOTP | company suspended or unknown; an **unexpired** invitation already holds the e-mail (any company); a customer user has the e-mail (any letter case); a pending **company** invitation holds it; 20 creates/re-issues by this operator in the last hour |
| **Revoke** | fresh TOTP + 10–500 character reason | already revoked (CONFLICT); accepted (INVITE_USED) |
| **Re-issue** (pending, expired or revoked) | password + fresh TOTP | accepted; another unexpired invitation holds the e-mail; the same refusals as create |

- An **expired** invitation holding the e-mail gives up its slot to a new create or re-issue, revoked and audited
  ("Expired; replaced by UIN-…").
- Re-issuing revokes an open source in the same transaction ("Re-issued as UIN-…"); a revoked source stays as it was.
  The lineage (`replaces` / `replacedBy`) is in the audit trail and on both detail pages.
- The token is 32 random bytes (base64url, 43 characters), made by the PO-02D2 generator; **only its SHA-256** is
  stored. The link is `CUSTOMER_PUBLIC_ORIGIN` + `/join/accept#t=<token>` — the token in the **fragment**, which a
  browser never sends — built only from configuration, never from request headers. It lives in the dialog's state
  only: not in the URL, storage, a cookie or a log. Closing the panel loses it; re-issue to get a new one.
- 72-hour expiry (the table caps any window at 30 days). References `UIN-XXXXXXXX`.

**Console.**
- `/platform/users/invitations` — every invitation (pending, expired, revoked, accepted), newest first, 25 per page,
  status filter, search by name, e-mail, company or UIN reference, one company's view (`?org=`) with Invite user.
- `/platform/users/invitations/<id>` — allow-listed details, the history from the audit trail, Re-issue / Revoke; an
  **audited view** (`user_invitation.viewed`): if the record can't be written, nothing is shown.
- The company page's Users tab — a **User invitations** panel: open invitations with their actions, Invite user, a link
  to all of the company's invitations, and the seat note. While the flag is off, the panel is absent.
- The users directory links to the list while the flag is on; otherwise it keeps the disabled Invite user placeholder.
- While the flag is off, both routes are "not found" inside the console (no data, no customer page). Where the table is
  missing, the pages say "User invitations aren't set up".
- Dialogs: a read-only **Check details** first (the effects, the company's seats now and after, every refusal) so no
  code is spent on a request that must fail; one request at a time; password and code cleared after every attempt; a
  dialog acts on the invitation's **current** state (a changed one offers Refresh).

**Audit actions:** `user_invitation.created`, `.revoked`, `.reissued`, `.viewed`, and `.create.rejected`,
`.revoke.rejected`, `.reissue.rejected` (each with its stage). Every success record is written in the transaction.

---

## G. Schema and migration proposal (D-6 / D-7)

**Not executed anywhere but disposable test databases. Not authorized for production.** Both SQL files say so in
their header, and neither is in the platform SQL chain (`PLATFORM_SQL_FILES`).

`drizzle/platform/PO03C_user_invitations.sql` — retry-safe, verified against a scratch reference schema:
- **Preconditions** (refuses otherwise): PostgreSQL ≥ 14; the PO-01/PO-02 objects it references, including
  `organization_invitations.owner_email_normalized`, `tenant_primary_owners.org_id`, `tenant_subscriptions.seats_snapshot`
  and `platform_reject_mutation()`.
- **Table `user_invitations`:** `id` uuid, `org_id`, `name`, `email_normalized`, `requested_role`, `token_hash`,
  `expires_at` (default now + 72 h), `accepted_at`, `accepted_user_id`, `revoked_at`, `revoked_by_platform_admin_id`,
  `invited_by_platform_admin_id`, `created_at`.
- **15 constraints:** the key, four RESTRICT foreign keys, and CHECKs — the token is a 64-character hex digest; the
  e-mail is normalized and at most 320 characters; the name; the role is admin or staff; the window is at most 30 days;
  terminal states, acceptance, acceptance window, revocation and revocation time are consistent.
- **6 indexes:** the key; the token digest (unique); **one open invitation per e-mail** (partial unique,
  `accepted_at IS NULL AND revoked_at IS NULL`); one acceptance per user (partial unique); company + e-mail; company +
  expiry.
- **Guard trigger** `user_invitation_guard()`: no DELETE; an insert must be open; a terminal row is final; the terms
  never change; an acceptance can only name a user of the invitation's OWN company (read `FOR SHARE`). TRUNCATE is
  rejected (`platform_reject_mutation`). The script checks that exactly these triggers exist.
- **Rollback** (`PO03C_user_invitations_rollback.sql`): refuses while any invitation row exists; otherwise appends one
  audit record (`schema.user_invitations_removed`) and drops the table and the guard. A repeated rollback adds nothing.

The Drizzle declaration (`src/db/staged/platform-user-invitations.ts`) mirrors it; `drizzle-kit push` of the
declaration and the reviewed SQL produce the **same** table — every column, constraint and index (S4). Pushing the
declaration onto the SQL-created table plans nothing for it; the eight statements it does plan are the known X-02
drift on four customer foreign keys whose names exceed 63 characters (PO02D1A1_MIGRATION_HARDENING.md §F.4), nothing on
`user_invitations` (S5).

**Release proposal** (for the owner; nothing here is decided on the owner's behalf):
1. Decide L-3 (the schema itself) and D-6 (the migration mechanism) — then fold the table into the reviewed platform
   SQL chain, or release it as a separate reviewed script through the D-6 runner with its preflight gate.
2. Take the D-7 read-only production measurements first (row counts, lock wait budget). The table is new and empty,
   so creating it takes no lock on existing data beyond the brief catalog locks of four foreign keys
   (`orgs`, `users`, `platform_admins` ×2).
3. Install with the flag OFF; verify (the script's own checks and `platform:db:check`); only then decide L-4.
4. Rollback: the reviewed rollback script, refused while any invitation exists.

**D-6 and D-7 are not resolved** and remain production blockers (§M). They did not block development: the staged table
lives only in disposable databases.

---

## H. Seat reservations

Seats occupied = **active users + disabled users + pending invitations**, where a pending invitation is OPEN (not
accepted, not revoked), **unexpired** at the moment of reading, and its e-mail belongs to **no** customer user (any letter
case) — so nobody is counted twice, and a revoked, expired or accepted invitation reserves nothing. The allowance is the
current subscription's immutable `seats_snapshot`; without one there is none. Where the staged table does not exist the
pending term is 0 — nothing is fabricated. `seat-accounting.ts` stays read-only: no write, no lock, no environment read,
`enforced: false`.

Over-limit companies are identified, not blocked: the create check shows "4 of 4 now, 5 of 4 with this invitation —
1 over the allowance, shown only; seats are not enforced", and the invitation is still created (T7, U4).

| Evidence (`verify:platform-user-invitations` T) | |
|---|---|
| T1 | 2 users + 2 pending = 4 (an expired, a revoked and a user-held e-mail excluded) |
| T2 | allowance = the snapshot (3): over by 1 — flagged, never enforced |
| T3 | the directory's batched read gives the same numbers (one rule) |
| T4 | at +80 h the reservation has ended (0 pending) |
| T5 | a revoked invitation releases its seat at once |
| T6 | the create preview reports seats and creates nothing |
| T7 | a company at its allowance still gets the invitation |
| T8 | seat accounting is read-only; no enforcement function exists |

The customer Team card shows the same occupied number; its wording is L-6.

---

## I. Concurrency and audit rollback

**Lock order for user invitations** (create and re-issue; a revoke takes the first two, then the invitation row `FOR UPDATE`, and no company lock): the operator's
`platform_admins` row (the TOTP compare-and-set) → the e-mail's advisory lock
`pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || email, 0))` — **the same lock as company
invitations**, so both kinds queue on one e-mail → the company row `FOR SHARE` with its access re-read (the PO-02C.1
lock, so a suspension waits for, or is seen by, the transaction) → the e-mail's invitation rows `FOR UPDATE` → insert.
Every pre-check is repeated inside. The partial unique index is the database guarantee of one open invitation per
e-mail; a 23505 from it is still reported as CONFLICT.

| Evidence | |
|---|---|
| K1 | two operators, two companies, one e-mail, at once: both wait on the e-mail lock; exactly one invitation; the other CONFLICT |
| K2 | revoke queued first, re-issue behind it: the revoke applies; the re-issue works from the revoked source; never two open |
| K3 | a create waiting on the company row while a suspension commits sees it: COMPANY_SUSPENDED, nothing written |
| K4 | a customer user takes the e-mail (another case) while a create waits after its pre-checks: the in-transaction re-check refuses (EMAIL_CONFLICT, recorded) |
| A1 | the audit trail refuses the record → AUDIT_UNAVAILABLE: no invitation, no code consumed |
| A2 | the invitation insert fails → nothing remains (no row, no success audit, no code consumed) |
| A3 | a revoke whose audit record fails is not applied |
| C14 | the hourly limit is exact (counted from committed rows; the operator row serializes) |
| boundary 49 | every success audit record is written with the transaction; rejections are written outside it |

Transfer and roles: §C X6–X8, R3. Team: §E T5–T6.

---

## J. English / Arabic and mobile screenshots

PNG screenshots of fictional data only, in the session scratchpad — **not committed**, as in earlier phases. No
address bar, cookie or credential is in any of them. Names follow `<step>-<page>-<language>-<theme>-<width>.png`.

**C — `verify:platform-user-invitations-browser`, 48 screenshots:** the flag-off "Page not found" inside the console
(01); "not set up" (02); the company panel empty and with a pending invitation (10, 14); the invite dialog — field
errors (11), the check with seats (12), the one-time link (13); a blocked check (20); the list (30); the detail —
pending (40), revoked with its history (41b), re-issued with "Replaces …" (43); the revoke dialog (41); the re-issued
link (42); the stale-page Refresh (44); and the list, detail and company panel in English and Arabic, light and dark,
at 1440 / 1024 / 768 / 390 / 360 (60–62); the Arabic invite check and one-time link on a phone, dark (63, 64); the
Arabic revoke dialog at 360 (65).

**A — `verify:platform-roles-browser`, 24 screenshots:** the role dialog and its result (40, 41), the protected primary
owner (42), the company's Primary owner panel (43), the transfer dialog and its result (44, 45), the legacy "Not
designated" company (46), and the user controls and Primary owner panel in English / Arabic, light / dark, 1440 and 390
(50, 51), the Arabic role and transfer dialogs on a phone (52, 53), the Arabic legacy company at 360 (54).

Every page in the matrix passes the layout audit: one `h1`, no horizontal overflow, every control named, every field
labelled, white text on orange, nothing clipped, and `lang` / `dir` / theme as chosen (U10, R7).

---

## K. Full regression

One complete run at `353e02b`, 08:19–09:10Z, on loopback `*_test_only_*` databases (fictional rows), each dropped
afterwards. Nothing in this table is carried over from an earlier run.

| Area | Result at `353e02b` |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings), **identical finding for finding** to `985830f` (file, rule, severity, message and line text compared). All 28 are in older `scripts/`, `tests/` and `verify/` files; none is in `src/` or in a PO-03C file |
| `verify:platform` (the chain: 25 suites, real PostgreSQL) | **2,501/2,501** (805 s) |
| each of those 25 suites alone | **0 failures**: boundary 196 · proxy 59 · schema 54 · auth 136 · bootstrap 54 · console 108 · containment 87 · company-schema 110 · migration-safety 92 · company-migration-locks 83 · onboarding-schema 167 · onboarding-migration-safety 202 · release-preflight 59 · onboarding-seed 113 · companies 192 · company-access 116 · invitations 187 · email-uniqueness 39 · invitation-acceptance 94 · primary-owner 83 · seat-accounting 43 · users 76 · team-sessions 28 · owner-transfer 50 · user-invitations 73 |
| `verify:static` (the chain: 22 suites) | **1,914 checks, 0 failed** |
| each of those 22 suites alone | **0 failures**: role-matrix 32 · confirm-policy 62 · dirty-form 66 · skeletons 90 · contrast 187 · typography 43 · status-registry 90 · shell 87 · controls 110 · datatable 69 · document-form 94 · edit-action 59 · store-model 69 · provider-harness 302 · backup-claims 26 · money-precision 12 · number-locale 29 · date-timezone 38 · business-dates 44 · ledger-only-balances 8 · page-archetypes 320 · lcp-design 77 |
| ACC-01 | inventory-costing **171 passed, 0 failed**; project-costing **50/50** |
| Security tests | access-control **22/22**; crypto-policy **18/18**; platform boundary **196/196** |
| Undo proof | **PASS** (§K.2) |
| UI guardrails (report-only) | G1–G5 **identical** to `985830f` (24 · 244 · 8 · 0 · 22 call sites); the tracked report file was restored at once |
| `next build` (test configuration) | **compiled** in 6.6 s; TypeScript 12.2 s; **71/71 pages generated**; then `Error [SecurityFatalError]` (exit 1): the advisory gate, **not bypassed**; its upgrade command and prompts **not followed** (§M-3). Compilation and build completion are reported apart: the first succeeded, the second did not |
| Platform Owner browser suites, on that compiled output (`next start`) | PO-01B **138/138** · PO-02B **111/111** · PO-02C **64/64** · login race **51/51** · PO-02D2 **78/78** · PO-02D3 **99/99** · PO-03A **23/23** · PO-03B **30/30** · PO-03C roles **36/36** · PO-03C user invitations **57/57** — **687/687**, 437 screenshots |
| Customer tiers | staff-runtime **20/20**; shell-runtime **533/533** |
| Tamper tests | **23/23** caught at `e07c581`; the 13 static cases again at `353e02b`: **13/13** (§K.5) |
| Working tree | clean before and after the run |

### K.1 How the full run was reached

1. **The first final run, at `e07c581`, stopped.** TypeScript, ESLint and the comparison passed; the `verify:platform`
   chain then failed at its 8th suite, `verify:platform-company-schema`, **108/110**: two pins (the modules that name the
   PO-02A company tables, and the importers of the access-compatibility module) did not name C's two new modules. The
   run was stopped there and nothing from it is used above.
2. **Fix `353e02b`** (finding A.1-1, test-only plus one comment): both pins name the modules, with a new negative check
   that the user-invitation rules never name the access table or write a company invitation; the staged declaration's
   comment no longer names `organization_invitations`; the layer's recorded hash for that file regenerated (same 15
   files, 69 hunks, 14 added files).
3. **Before re-starting:** company-schema alone at `353e02b`, **110/110**; then the 11 `verify:platform` suites not run
   since sub-batch C (proxy, schema, auth, bootstrap, console, migration-safety, company-migration-locks,
   onboarding-migration-safety, release-preflight, onboarding-seed, email-uniqueness), all green.
4. **The complete run from the start at `353e02b`**, 08:19–09:10Z: the table above.
5. **Tamper re-run at `353e02b`:** the 13 static cases (T01–T08, T10, T12, T14–T16) again, **13/13 caught**, every file
   restored, tree clean. The 10 runtime-backed cases (T09, T11, T13, R01–R07) were not repeated: `353e02b` changed no
   code they tamper with and no suite that catches them (one comment line, one recorded hash, one verify suite).

### K.2 Change control — the PO-03C approved-delta layer

`verify/po03c-approved-delta.mts` follows the rule every earlier phase used: **no re-baseline**.
- **15 changed files, 69 hunks**, recorded byte for byte as `[985830f's text, PO-03C's text]`; undone, each file is
  `985830f`'s to the byte (`PO03C_BASE_SHA`).
- **14 added files** recorded by content hash (`PO03C_NEW`): 12 under `src/` (the staged declaration among them) and the
  two staged SQL files.
- Both freeze verifiers read each file through the PO-03C undo before PO-03B's, keep PO-03C's added files out of the
  directory pins and the `src/` count, and check: exactly these files and hunks; the customer side limited to the two
  Team services (no auth, session, sign-in, registration, MFA, Team page or business file); the only database files the
  staged ones; the only new routes the user-invitation list and detail with their not-founds.
- Hunks are widened per change until unique (the PO-02D2 algorithm), so an end-of-file append is recorded together with
  the change above it. To give `flags.ts` such a change, its header (which lists the console flags) now names the new
  flag — an accurate documentation line.

**Undo proof:** **PASS** at `353e02b` — a proof script (session scratchpad, not committed; it uses only the layer's own exports and `undoPo03c`) applied the layer's undo to the working tree's text: each of the 15 recorded files is `985830f`'s to the byte (69 hunks), each of the 14 added files matches its recorded hash, and no `src/` or `drizzle/` path differs from `985830f` outside the layer. The paths that differ and are not frozen by any layer are the phase's own test and configuration files, reviewed as additions: `package.json`, the boundary test, the layer itself, and the suites companies, company-schema, invitations, onboarding-schema, owner-transfer, primary-owner, roles-browser, seat-accounting, team-sessions, user-invitations (and its browser suite) and users.

### K.3 Boundary rules (`tests/security/platform-boundary.test.mjs`, 196 checks)

- **Rule 48 (A):** the role change and the transfer — order, lock order, the one mapping write, both sessions, evidence
  and audit in the transaction; the four server actions; the controls; the pages.
- **Rule 49 (C, 10 checks):** authorization order and the only checker of `platform.users.invite`; the only writer of
  `user_invitations` (one insert, one revocation update, no delete, never an acceptance); the token, the digest and the
  link (built only from configuration; `/join/accept` served by nothing); the lock order of create, re-issue and revoke,
  and every success audit record in the transaction; the staged table (outside the barrel; who imports it; both SQL
  files not authorized for production and outside the chain); the flag read only in `flags.ts`; the strict server
  actions (never the owner role); the dialogs (their own actions only, credentials cleared, the current state, the link
  copied, never sent); the pages (404 while off, read model only, no POST); no outbound call and no acceptance.
- **Named extensions only** of earlier rules, nothing weakened: 11 (the dialogs' own actions), 12 (the five cores; seven
  action files), 21 (the read model and write core name `orgsTable` to show and check the company), 23 and 39 (the
  permission list), 25 (twelve console pages; the company page may read the user-invitation read model), 37 (the write
  core takes the same PO-02C.1 SHARE lock as session issuance), 39 (the two new routes), 46 (the preview reads the seat
  core; the seat core reads the staged declaration and its catalog probe; the pending term), 47 (`platform.users.read`
  in the new read model; the directory reads the flag).

### K.4 Older suites — pin changes, recorded explicitly

| Suite | Pin | Change | By |
|---|---|---|---|
| `verify:platform-users` | N2: a Team deactivation keeps sessions | now: it ends them | B |
| `verify:platform-primary-owner` | N3: one writer each of `users.role` / `is_active` | the role write is the shared service's | B |
| `verify:platform-primary-owner` | N5: who writes the mapping | adds the transfer's ONE update | A |
| `verify:platform-primary-owner` | N7: no user-invitation system exists | the staged table is named only by its declaration, read model, write core and the seat core | C |
| `verify:platform-companies` | the exact permission list | adds `manage_roles` (A) and `invite` (C) | A, C |
| `verify:platform-invitations` | #7: the permission tail | last six (A), then last seven (C) | A, C |
| `verify:platform-seat-accounting` | N1: who uses the seat service | adds the user-invitation preview | C |
| `verify:platform-onboarding-schema` | files naming an onboarding table | adds `customer-user-actions.ts` (the transfer) + three narrower checks | A (fixed in `1e8206f`) |
| `verify:platform-company-schema` | modules naming the company tables; importers of the compatibility module | adds the user-invitation rules (read-only, checked) and the write core | C (fixed in `353e02b`) |
| `verify:document-form`, `verify:page-archetypes` | the layer chain | the PO-03C layer and its checks | change control |
| `tests/security/platform-boundary.test.mjs` | rules 11–47 | named extensions (§K.3) | A, B, C |

### K.5 Tamper tests

Each case changes ONE thing, runs the verifier(s) designed to catch it, and restores the file byte for byte (sha256
compared; created files removed).

**23 cases, every one caught; every file restored byte for byte.**

| Case | Tamper | Caught by (failing checks) |
|---|---|---|
| T01 | an extra line in a recorded file (`flags.ts`) | document-form (5), page-archetypes (5) |
| T02 | an added file changed (page size 25 → 26) | document-form (2), page-archetypes (2) |
| T03 | an unrecorded new file under `src/lib/platform` | page-archetypes (3), boundary (1) |
| T04 | the layer's base commit changed | page-archetypes (2) — the verifier that pins it |
| T05 | a recorded hunk's text edited in the layer | document-form (5), page-archetypes (5) |
| T06 | the staged SQL's "not authorized" header changed | document-form (2), page-archetypes (2), boundary (1) |
| T07 | the staged table exported from the schema barrel | boundary (1), document-form (6) |
| T08 | the flag defaults on (`!== "false"`) | boundary (1), document-form (5), page-archetypes (5) |
| T09 | the plaintext token stored instead of its digest | boundary (1), user-invitations (2) |
| T10 | the wrong permission (`platform.users.manage`) | boundary (2) |
| T11 | create without the company lock and its in-transaction re-checks | boundary (1), user-invitations (6) |
| T12 | the owner role accepted by the server action | boundary (1) |
| T13 | an outbound call that would send the link | boundary (1), user-invitations (5) |
| T14 | an acceptance route at `/join/accept` | boundary (3), page-archetypes (4) |
| T15 | a seat-enforcement function added | boundary (1), document-form (4), page-archetypes (4) |
| T16 | a success audit record written outside the transaction | boundary (1) |
| R01 | **runtime:** a reservation counted for an e-mail a user already holds | user-invitations (10), boundary (1) |
| R02 | **runtime:** expired invitations counted as reservations | user-invitations (11), boundary (1) |
| R03 | **runtime:** no hourly limit | user-invitations (5) |
| R04 | **runtime:** no in-transaction e-mail re-check | user-invitations (5, K4 among them), boundary (1) |
| R05 | **runtime (B):** a Team change keeps the member's sessions | team-sessions (14) |
| R06 | **runtime (A):** a transfer keeps the previous owner signed in | owner-transfer (4) |
| R07 | **runtime (A):** the mapped primary owner can be demoted | owner-transfer (5), boundary (1) |

Two checks were added while writing these cases, because a tamper would otherwise have been caught only indirectly:
boundary rule 49's "every success audit record is written with the transaction" (T16) and the server suite's **K4**, a
deterministic barrier that proves the in-transaction e-mail re-check (R04).

---

## L. Pending owner decisions

| # | Decision | Built as (development default) |
|---|---|---|
| L-1 | After a primary-owner transfer, what does the previous primary owner become? | **admin** |
| L-2 | The two new permissions `platform.users.manage_roles` and `platform.users.invite` — granted to the single Platform Owner role | yes, both |
| L-3 | Approve the `user_invitations` schema (§G): the 72-hour window and 30-day cap; one open invitation per e-mail platform-wide; immutable terms; no deletion; the guarded rollback | staged, not approved |
| L-4 | `PLATFORM_USER_INVITATIONS_ENABLED` — where and when to turn it on | off everywhere |
| L-5 | D-6 (the migration mechanism) and D-7 (read-only production measurements) | open — production blockers |
| L-6 | The customer Team seat card: say that pending invitations occupy seats (customer copy) | unchanged; part of Prompt 4 |
| L-7 | The acceptance path `/join/accept` and `CUSTOMER_PUBLIC_ORIGIN` for user invitations | path reserved, served by nothing |
| L-8 | Release review of sub-batch B (sessions end on Team changes) — separate from the hotfix | development only |
| L-9 | Should pending invitations keep occupying seats while the flag is off but the table exists? | yes (data, not the flag, decides) |
| L-10 | The hourly limit of 20 user invitations per operator (counted apart from company invitations) | 20 |

---

## M. Production blockers

1. **The staged schema** is not authorized: L-3, then the D-6 mechanism and the D-7 measurements (§G).
2. **The PO-02 foundation SQL** in production remains the D-6 blocker recorded since PO-02D1A.
3. **The Next.js security-advisory gate.** `next build` compiles (TypeScript passes, every page is generated) and then
   stops with `Error [SecurityFatalError]`: the installed Next.js 16.4.3 is affected by a known advisory. The gate was
   **not** bypassed, and the upgrade command and prompts it prints were **not** followed: upgrading dependencies is
   not authorized in this prompt. The browser suites run on the compiled output with `next start`.
4. **Owner decisions** L-1 to L-10.
5. **The Team-field hotfix** (`fix/team-sensitive-fields-exposure`) is still a separate release decision.

---

## N. Prompt 4 — the precise scope

**N.1 User-invitation acceptance.**
- A customer route for `/join/accept` that reads the token from the URL **fragment** in the browser and posts it; the
  server finds the invitation by the SHA-256 of the presented token and re-checks the digest under the row lock (the
  PO-02D3 pattern). A new flag, off by default (e.g. `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED`), a durable public
  throttle, same-origin, and a uniform answer for unknown, expired, revoked and used links.
- **Lock order — must start with the same e-mail advisory lock** as create, re-issue and company invitations, then the
  company row (`FOR NO KEY UPDATE`, for seats, N.2), then the invitation row `FOR UPDATE`. Starting on the invitation
  row would deadlock against a create that holds the company row `FOR SHARE` and waits for the same e-mail's rows.
- Re-check inside: open, unexpired, the company active, the e-mail still free (the users e-mail index is the
  guarantee), the role admin or staff. Create the user in that company with the requested role, set `accepted_at` and
  `accepted_user_id` (the guard allows only a user of the same company), start the session through the PO-02C.1
  issuance lock, write the customer evidence and the platform audit — one transaction.
- Tests: replay, expiry at the boundary, revoke vs accept, re-issue vs accept, two accepts, a registration racing an
  accept, a suspension racing an accept, audit failure, the fragment never in a request or a log.

**N.2 Seat enforcement.**
- At **create**, **re-issue** and **acceptance**, under the company row lock (`FOR NO KEY UPDATE`), so concurrent
  reservations serialize per company: refuse when occupied (users + pending) would exceed the snapshot's seats.
  Decide what happens with no allowance (legacy companies) and whether the Platform Owner may override (owner decision).
- The Team "add member" path (if any) and registration must use the same rule; the customer Team card and the console
  say "enforced" only then.
- The customer Team copy for reservations (L-6).
- Tests: two creates for the last seat, accept vs create, revoke freeing a seat, expiry freeing a seat, the batched
  directory read unchanged.

**N.3 Not in Prompt 4 unless approved:** delivery by e-mail/SMS/WhatsApp, owner-role invitations, impersonation.

---

## O. The hotfix branch is untouched

`fix/team-sensitive-fields-exposure` was read only, never checked out for writing, committed to or pushed. Its remote
head was `94f936eb019be446282536b8fcdeede6ae9e510c` before Prompt 3 began, after every push of this prompt, and at the
end (`git ls-remote` at 2026-11-20 09:15Z, before this document's commit: `94f936eb019be446282536b8fcdeede6ae9e510c`; `main` `621f156f7b129b9c2e289bc46d314ce7587beec2`). Sub-batch B is **not** on it: it is a separate development commit (`62d5109`) that needs
its own release review.
