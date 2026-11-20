# Platform Owner — PO-03A: primary-owner protection and read-only user-seat accounting

> Phase PO-03A of the Elite ERP Platform Owner programme. **Development only.** It closes decision **O-3**: no existing
> customer-side operation can demote, deactivate, delete, move or otherwise invalidate the company user designated in
> `tenant_primary_owners`. The Team tab's role change and (de)activation now run as ONE locked READ COMMITTED
> transaction that re-checks every existing rule on the locked rows — which also closes a **pre-existing race** in which
> two owners could leave a company with no owner at all (§F.3, G0). It adds **read-only** user-seat accounting — one
> shared, server-only service — shown on the customer Team tab and on the Platform Owner company detail. **No seat
> limit is enforced**, no primary owner is transferred or assigned to a legacy company, no subscription is created, and
> `/register`, sign-in, MFA, sessions, session duration and the add-member form are unchanged. Every database used was a
> loopback, disposable `*_test_only_*` database holding fictional rows only, and every one was dropped. Production
> (Neon, the Hostinger VPS) was not accessed.
>
> **Release status: NO-GO.** The implementation is complete and verified for development. Releasing it still needs the
> D-6 foundation in production before acceptance is enabled (a migration-order release blocker, §E.6), the D-7 read-only
> measurements (§G.2), the owner decisions in §L and the Next.js advisory gate (§M.3). A **pre-existing HIGH finding in
> the live ERP** — the Business Settings page sends every team member's password hash and MFA envelopes to the browser
> of any owner or admin — is outside this phase and is reported for a separate, approved fix (§A.1).

---

## A. Completion status

| Step | Status |
|---|---|
| 2 — Baseline | done — `main` = `621f156` (live, unchanged), `feat/platform-owner` = `1d036d6`, PR #11 open, **draft, unmerged**, untouched (re-confirmed on GitHub before the final regression); the PO-02D3 handover read in full; the accepted Trial values verified (Trial v1 published: 14 days, **3 seats**, 5 GB, SAR 0.00 monthly and annual, the nine module groups — `verify:platform-onboarding-seed` 113/113); the PO-02D3 acceptance core and shared organization bootstrap unchanged (neither is in this phase's diff; the PO-02D3 layer's drift check is green); email uniqueness 39/39, acceptance 94/94, acceptance browser 99/99; boundary 154/154 and both freeze verifiers green |
| 3 — Mutation-path inventory | done — every production writer of customer `users` and of the mapping, by path and line; ORM and raw SQL; scripts and fixtures; the database's own guarantees (§D) |
| 4 — Primary-owner protection (O-3) | done — the Team-change service (`src/lib/team/member-changes.ts`) and the Team ownership gate (`src/lib/team/ownership-gate.ts`); demotion and deactivation of the mapped owner refused inside the change's own transaction; deletion, organization change and mapping removal refused by the PO-02D1 constraints (proven); no trigger, no schema change (§E) |
| 5 — Lock order and concurrency | done — one documented lock order, compared with PO-02C, PO-02C.1, PO-02D2, PO-02D3 and the future transfer; ten race and failure scenarios on real PostgreSQL with deterministic barriers on independent connections (§F) |
| 6 — Legacy companies | done — unchanged behaviour, "Not designated", never guessed, never backfilled; the read-only A–F analysis SQL, run on the production shape and the full shape of fictional fixtures (§G) |
| 7 — Staged rollout | done — the foundation is asked of the catalog explicitly; installed → always enforced; absent + acceptance on → fail closed; malformed → fail closed; no SQL error is read as "no mapping"; no migration (§E.4); the release-order dependency documented as a blocker (§E.6) |
| 8 — Seat accounting (read-only) | done — `src/lib/platform/seat-accounting.ts`: active + disabled users (+ pending user invitations: 0, none exist), the current subscription's immutable `seats_snapshot`, remaining, over-allowance; `enforced: false` (§H) |
| 9 — Customer Team page | done — a compact, display-only seat card ("2 of 3 user seats occupied"), a "Primary owner" badge, a protected menu; "No subscription assigned" for legacy companies; the add-member form untouched (§H.2, §I) |
| 10 — Console company detail | done — a display-only Users & seats panel; metadata only (§H.2, §I) |
| 11 — Future seat enforcement | designed, **not built or activated** — `assertUserSeatAvailable(tx, orgId, pendingAdds)` (§H.4) |
| 12 — Tests | done — `verify:platform-primary-owner` **83/83**, `verify:platform-seat-accounting` **43/43**, `verify:platform-users-seats-browser` **23/23** (64 screenshots) (§J.1) |
| 13 — Full regression | done at `3fe81dc` (§J.2) — TypeScript, `verify:static` (22 suites, also each alone), ACC-01, the security tests, `verify:platform` (21 suites, **2,244 checks**, also each alone), the undo proof, the UI guardrails, all seven Platform Owner browser suites and two customer browser suites green; the build **compiles** and is then stopped by the pre-existing Next.js advisory gate; ESLint showed one new warning in a PO-03A test file — fixed in `bac447b`, after which ESLint is identical to the baseline finding for finding |
| 14 — Change control | done — PO-03A approved-delta layer (10 files, 39 hunks, 6 added files) and its freeze-verifier hooks; boundary rule 46 (12 checks) and named exceptions in rules 3, 11, 21, 38; three older suites' pins extended by named additions only; **19 tamper tests, every one caught**; the undo proof byte-exact (§K) |
| 15 — This document | done |
| 16 — Git | done — five reviewable commits on `feat/platform-owner` only; no force-push, merge, deployment or PR change (§B) |
| **STOP gate** | **STOPPED.** No seat limit enforced; no primary owner transferred or assigned to a legacy company; acceptance not enabled anywhere; no real user or company; PO-03B not started |

### A.1 Findings for owner attention

1. **Pre-existing, HIGH — password hashes and MFA envelopes reach the browser (live ERP).** `src/app/(app)/settings/
   organization/page.tsx` loads the team with `db.select().from(usersTable)` — every column — and passes the rows to the
   client component `TeamPanel`. React serializes them into the page, so any owner or admin who opens Business Settings
   receives every colleague's bcrypt `password_hash` (crackable offline) and the encrypted `mfa_secret` and
   `mfa_recovery_codes` envelopes (unusable without the server's field key, but secrets all the same). A probe on a
   disposable database (fictional company, counts only) found the fixture's bcrypt hash twice in the HTML (one per
   user) and the keys `passwordHash`, `mfaSecret` and `mfaRecoveryCodes`. `main` (`621f156`) has the same code. A malicious or compromised admin could crack colleagues' passwords offline. **Not changed here** (the
   brief keeps Team changes to the protection); the fix is small — select only the fields the panel renders — but it
   changes a file of the live ERP and must be approved separately. PO-03A neither adds nor widens the exposure: its
   ownership summary sends counts and one user id only (seat suite T2).
2. **Pre-existing race, now closed for the Team actions.** The old actions read, checked and wrote in separate
   autocommit statements with no lock. Replaying their exact statements with barriers, two owners demoting each other
   at the same instant leave the company with **no owner** (G0); two admins deactivating the two owners at once leave
   no active owner. PO-03A serializes every Team change of a company on its row and re-checks on the locked rows
   (G1–G3).
3. **Migration-order release blocker.** With the foundation absent and acceptance enabled, every Team role or status
   change is refused (fail closed, by design). The release order must be: D-6 foundation → this code → (later, separately
   approved) acceptance (§E.6).
4. **Preserved, not endorsed:** an admin can deactivate a non-primary owner while another owner stays active (the old
   toggle never applied the role hierarchy; E6 pins the preserved behaviour). Owner decision (§L).
5. **Future seat lock mode.** PO-00 (C-7) proposed an organization-row `FOR UPDATE` for seat allocation. This phase
   recommends `FOR NO KEY UPDATE` instead (§H.4.3) — owner decision.

---

## B. Branch, commits and exact SHAs

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (reviewed PO-02D3 head) | `1d036d6d1d0ceb558e61052c023b561def073e08` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | open, draft, unmerged — not modified |
| PO-03A commits | 1. **feat** `be73706fb1de57e1c9fc5abe8ee6568a9c5a3905` — the read-only primary-owner and seat-accounting cores; the console's Users & seats (TypeScript exit 0 on its own, detached worktree)<br>2. **feat** `32fd14393f0e35874d4f2937dedbadd93b125922` — the Team-change service, the ownership gate, the Team actions, the seat card and panel, the activity executor, the Arabic strings (TypeScript exit 0 on its own)<br>3. **test** `3fe81dcc75475d0c1a81c07ddbcba9a90538f6d3` — the three suites, the approved-delta layer and its hooks, boundary rule 46, the three older suites' pin extensions, the legacy analysis SQL, the scripts; **the full regression in §J.2 ran at this commit**<br>4. **fix** `bac447b46632c796b328cb10845e07b28837272a` — removes the unused import the ESLint comparison found in the PO-03A browser suite; the affected checks re-run at this commit (§J.3)<br>5. **docs** — this document (the branch head; its SHA is in the handover report) |
| Final SHA | the docs commit above — the branch head (also in the handover report) |

---

## C. Changed-file inventory

`git diff --stat 1d036d6..3fe81dc`: 26 files, +2,976 / −95. Then `bac447b` removes one line from `verify/verify-platform-users-seats-browser.mts`, and the docs commit adds this document.

| File | Kind | Change | Frozen (layer) |
|---|---|---|---|
| `src/app/(app)/settings/team/actions.ts` | customer | `changeRoleAction` / `toggleMemberActiveAction`: same signatures, same `requireRole("owner", "admin")`, now delegate to the service; `addTeamMemberAction` unchanged | EDIT (4 hunks) |
| `src/app/(app)/settings/team/team-panel.tsx` | customer | seat card; "Primary owner" badge; the primary owner's menu offers no other role and no deactivation, only a disabled "protected" notice | EDIT (9 hunks) |
| `src/app/(app)/settings/organization/page.tsx` | customer | `readTeamOwnershipSummary(session.orgId)` → `TeamPanel` (the members query is unchanged — see §A.1) | EDIT (3 hunks) |
| `src/app/(app)/settings/team/seat-summary.tsx` | customer | NEW — the display-only seat card (client-safe; numbers in LTR isolates) | NEW |
| `src/lib/team/member-changes.ts` | customer | NEW — the Team-change service (lock order, rules, protection, messages) | NEW |
| `src/lib/team/ownership-gate.ts` | customer | NEW — the ONE customer module that reaches the two platform cores; fail-closed | NEW |
| `src/lib/team/seat-summary-types.ts` | customer | NEW — client-safe summary types | NEW |
| `src/lib/activity.ts` | customer | `logActivity(session, entry, executor = db)` — optional transaction executor; every existing caller unchanged | EDIT (3 hunks) |
| `src/lib/i18n/dict.ts` | customer | the new Team messages and seat strings in Saudi Arabic (appended) | EDIT (1 hunk) |
| `src/lib/platform/primary-owners.ts` | platform | NEW — read-only mapping core (foundation probe; read; read FOR SHARE) | NEW |
| `src/lib/platform/seat-accounting.ts` | platform | NEW — the one seat-accounting service (read-only, `enforced: false`) | NEW |
| `src/lib/platform/companies.ts` | platform | company detail gains `seats` and `primaryOwner` (fail-soft) | EDIT (4 hunks) |
| `src/app/(platform)/platform/(console)/companies/[orgId]/page.tsx` | platform | display-only Users & seats panel | EDIT (3 hunks) |
| `src/components/platform/i18n.ts` | platform | `seats.*` strings, EN + AR | EDIT (1 hunk) |
| `verify/verify-platform-primary-owner.mts` | test | NEW — 83 checks | — |
| `verify/verify-platform-seat-accounting.mts` | test | NEW — 43 checks | — |
| `verify/verify-platform-users-seats-browser.mts` | test | NEW — 23 checks, 64 screenshots | — |
| `verify/po03a-approved-delta.mts` | change control | NEW — the layer | — |
| `verify/verify-document-form.mts`, `verify/verify-page-archetypes.mts` | change control | PO-03A hooks (undo chain, walk exclusions, the PO-03A checks) | EDIT (4 + 7 hunks) |
| `verify/verify-platform-companies.mts`, `verify-platform-containment.mts`, `verify-platform-onboarding-schema.mts` | test | pins extended by PO-03A's named additions only (§K.3) | — |
| `tests/security/platform-boundary.test.mjs` | test | rule 46 and named exceptions (§K.2) | — |
| `package.json` | scripts | three scripts; the two server suites appended to `verify:platform` | — |
| `docs/platform-owner/po03a/sql/legacy_owner_seat_analysis_readonly.sql` | analysis | NEW — read-only D-7 A–F analysis (§G.2) | — |
| `docs/platform-owner/PO03A_DEVELOPMENT.md` | docs | this document | — |

Nothing under `src/db/`, `drizzle/`, `src/app/(auth)/`, `src/app/(invite)/`, `src/lib/security/`, `src/lib/session.ts`
or `src/lib/auth.ts` changed (page-archetypes group 33 pins this).

---

## D. Complete customer-user mutation-path audit

### D.1 Every production code path that writes a customer `users` row or a primary-owner mapping

Inventory at `3fe81dc` (ORM and raw SQL; `src/`, `scripts/`, `drizzle/`). `verify:platform-primary-owner` N1–N7 pin it,
so a new writer fails the suite.

| # | Path (file:line) | Operation | Columns | Ownership effect | PO-03A treatment |
|---|---|---|---|---|---|
| U1 | `src/lib/org-bootstrap.ts:52` (`bootstrapOrganization`, used by `/register` and PO-02D3 acceptance) | INSERT | the owner of a NEW company (`role = owner`) | creates the first owner | unchanged; seat-enforcement integration point (§H.4) |
| U2 | `src/app/(app)/settings/team/actions.ts:38` (`addTeamMemberAction`) | INSERT | a member (owner / admin / staff, `canAssignRole`) | can add an owner, never removes one | unchanged (brief §9); seat-enforcement integration point |
| U3 | `src/lib/team/member-changes.ts:161` (`changeTeamMemberRole`, from `changeRoleAction`) | UPDATE | `role`, `updated_at` | **can demote an owner** | the locked service — protection O-3 |
| U4 | `src/lib/team/member-changes.ts:178` (`setTeamMemberActive`, from `toggleMemberActiveAction`) | UPDATE | `is_active`, `updated_at` | **can disable an owner** | the locked service — protection O-3 |
| U5 | `src/app/(auth)/actions.ts:80` (atomic recovery-code consumption, PO-02C.1) | UPDATE | `mfa_recovery_codes` | none | unchanged |
| U6 | `src/app/(auth)/actions.ts:108`, `:191` (sign-in) | UPDATE | `last_login_at` (and `mfa_recovery_codes` when a recovery code was used) | none | unchanged |
| U7 | `src/app/(app)/settings/security/actions.ts:39`, `:54`, `:77`, `:110` (own MFA set-up / enable / disable, own password) | UPDATE | `mfa_secret`, `mfa_enabled`, `mfa_recovery_codes`, `password_hash`, `password_changed_at` | none (the session's own row) | unchanged |
| M1 | `src/lib/platform/invitation-acceptance.ts:380` (PO-02D3 acceptance core) | INSERT `tenant_primary_owners` | `user_id`, `org_id`, `assigned_at` | the ONE mapping writer — a new company only | unchanged |

### D.2 What does not exist

- **No deletion of a customer user** anywhere in `src/` (no ORM delete, no `DELETE FROM users`) — N2.
- **No change of `users.org_id`** (no `.set({ orgId })` on users, no raw update) — N4.
- **No deletion of a company** in `src/` (`orgs → users` is `ON DELETE CASCADE` in the schema, but no code path uses it).
- **No customer-user invitations** (PO-00 M6, `user_invitations`, not built) — N7; none is fabricated as a pending seat.
- **No Platform Owner user-creation or user-edit route.**
- **No update or delete of a mapping** in application code — N5.

### D.3 What the database itself guarantees (PO-02D1 foundation; proven in C1–C4 on real PostgreSQL)

| Attempt on a mapped primary owner | Result |
|---|---|
| `DELETE FROM users` of the mapped user | refused — 23503 (composite FK `(user_id, org_id) → users(id, org_id)`, `ON DELETE RESTRICT`) — C1 |
| `UPDATE users SET org_id = <other>` | refused — 23503 (the same composite FK) — C2 |
| `DELETE FROM orgs` of the company | refused — 23503 (`tenant_primary_owners.org_id`, RESTRICT) — C3 |
| `DELETE FROM tenant_primary_owners` | refused — 23001 (guard trigger: a mapping is transferred, never deleted) — C4 |
| a mapping write naming a user who is not an active owner of the company | refused — 23514 (guard trigger, which locks the named user row FOR SHARE first) — G4 |

So deletion, re-parenting and unmapping are already impossible at the database; demotion and deactivation are the two
application-level gaps, and PO-03A closes both in the only code paths that perform them (U3, U4).

### D.4 Non-production writers (not reachable from the application)

`scripts/platform/company-fixtures.ts` (a guarded fictional-fixture loader: disposable / preview databases only),
`scripts/platform/disposable-db.ts` (DDL on disposable shapes), `scripts/tests/*.test.ts` (insert and delete their own
fictional rows on disposable databases), `tests/ui-baseline/*` and `verify/*` (test suites). None runs in the ERP, and
none creates a mapping. Any future production tool that writes `users` must use the Team-change service (or its
successor) and the seat guard (§H.4).

### D.5 Pre-existing defects in the old Team actions (all closed or preserved deliberately)

| Defect (`1d036d6`) | Now |
|---|---|
| read → check → write in separate autocommit statements, no lock: concurrent changes can remove every owner (G0) | one locked transaction; re-checks on the locked rows (G1–G3) |
| `changeRoleAction` updated `where id = ?` only (the preceding read was company-scoped) | the update is scoped to the id **and** the company |
| `toggleMemberActiveAction` read the target's role `where id = ?` without the company | the target is read only among the locked rows of the session's company |
| the activity record was written after the update, in its own autocommit (a failure left an unrecorded change) | same transaction (E9 identical `xmin`; G9 failure → nothing applied) |
| English-only messages | the same English words (M3) plus Saudi Arabic (M1, M2) |
| an admin may deactivate a non-primary owner | **preserved** (E6) — owner decision (§L) |

---

## E. Primary-owner protection implementation

### E.1 The modules

| Module | Role |
|---|---|
| `src/app/(app)/settings/team/actions.ts` | authorize (`requireRole("owner", "admin")`), hand the change to the service, revalidate on success |
| `src/lib/team/member-changes.ts` | the Team-change service: ONE transaction per change, the lock order, every rule on the locked rows, the update, the activity record; localized results |
| `src/lib/team/ownership-gate.ts` | the ONE customer module that reaches `src/lib/platform/primary-owners.ts` and `seat-accounting.ts`; the fail-closed foundation logic; the Team page's read-only summary |
| `src/lib/platform/primary-owners.ts` | read-only: foundation probe, mapping read, mapping read FOR SHARE |
| `src/app/(app)/settings/team/team-panel.tsx` | display: badge, a menu that does not offer a protected change (the server refuses it anyway — W7) |

### E.2 The brief's ten requirements

| # | Requirement | Where |
|---|---|---|
| 1 | the actor is still authorized | `requireRole` before; then the actor's **locked** row: active, role owner or admin, same company — else "You no longer have permission to manage the team." (E7, E8) |
| 2 | the target is scoped to the actor's company | the user-row lock reads `org_id = session.orgId AND id IN (actor, target)` — another company's id is simply not found, and its rows are never locked (D1–D3) |
| 3 | lock the mapping and the affected user rows | company row → user rows (ascending id) → mapping FOR SHARE (§F.1, K1) |
| 4 | re-read after locking | every rule is evaluated on the locked rows, not on the session or the page (E8, G6) |
| 5 | refuse an invalid mutation | primary owner: no role other than owner, no deactivation; plus the existing rules |
| 6 | apply the permitted mutation transactionally | update + activity record in the same transaction (E9) |
| 7 | existing role restrictions | `canAssignRole` pre-checks in the old order and again on the locked actor; own role / own account; unknown role (E1–E5) |
| 8 | the last-active-owner safeguard | as before for deactivation (F1–F4), plus defence in depth on demotion |
| 9 | tenant session behaviour | untouched — no session, sign-in or MFA file changed; G10 proves a sign-in and a Team change on the same company queue without deadlock |
| 10 | clear, localized errors | §E.3 |

### E.3 Answers (English is the dictionary key; Arabic in `src/lib/i18n/dict.ts`)

| Situation | English | Arabic |
|---|---|---|
| demote the primary owner | This member is the company's primary owner. Their role can't be changed. | هذا العضو هو المالك الرئيسي للشركة، ولا يمكن تغيير دوره. |
| deactivate the primary owner | This member is the company's primary owner and can't be deactivated. | هذا العضو هو المالك الرئيسي للشركة، ولا يمكن إلغاء تفعيله. |
| the actor lost the right meanwhile | You no longer have permission to manage the team. | لم تعد لديك صلاحية إدارة الفريق. |
| a lock wait over 5 s or a deadlock | Another change to this team is in progress. Try again in a moment. | يجري تعديل آخر على الفريق الآن. حاول مرة أخرى بعد لحظات. |
| the foundation is missing or malformed while required | Team changes are unavailable right now. Nothing was changed. Try again later. | تعديلات الفريق غير متاحة حاليًا، ولم يتغيّر شيء. حاول مرة أخرى لاحقًا. |
| any other failure (rolled back) | The change couldn't be saved. Nothing was changed. | تعذّر حفظ التغيير، ولم يتغيّر شيء. |
| the seven existing messages | unchanged, word for word (M3) | new Arabic translations |

A refused change to the primary owner commits exactly one customer security event, `team.primary_owner_protected`
(severity medium, detail `role_change` / `deactivation`, the target's id) and nothing else (A3, B2). Every other
failure is logged by SQLSTATE or error class only — never a message, e-mail or hash (G7, M4).

### E.4 Staged rollout — fail closed, never silently weaker

The production ERP does not yet have the PO-02D1 foundation. The gate asks the catalog
(`to_regclass('tenant_primary_owners')`, unqualified, so it resolves through the same `search_path` as the
application's queries) and decides:

| Database | `CUSTOMER_INVITE_ACCEPTANCE_ENABLED` | Team role / status change | Team page shows |
|---|---|---|---|
| foundation installed | any | **always enforced** (L1) | the primary owner, or "Not designated" |
| foundation absent | off (default) | works exactly as before — no mapping can exist (L2) | "Not designated" |
| foundation absent | **on** | **refused** — "unavailable", nothing changed, an incident line (L3) | "unavailable" |
| foundation malformed (e.g. a column missing: 42703) | any | **refused** — "unavailable", nothing changed (L4) | "unavailable" |
| any other database error | any | rolled back — "couldn't be saved" (G7) | "unavailable" |

A failing query is never read as "no mapping", and no flag can switch the protection off. The seat summary follows the
same rule: unreadable → "unavailable", never "No subscription assigned" (M7–M10).

### E.5 What PO-03A deliberately does not do

No database trigger on `users`, no schema or constraint change, no migration, no primary-owner transfer, no mapping
for any existing company, no change to adding a member, to sign-in, sessions, MFA or registration. **An additional
database constraint is not required** for the application: deletion, re-parenting and unmapping are already refused by
the PO-02D1 constraints (§D.3), and demotion and deactivation have exactly one code path each (§D.1). The residual —
a non-application writer (manual SQL) demoting or disabling a mapped owner — is detectable, not preventable, at this
stage: the analysis SQL reports it (P02, R02 drift) and the console marks it ("no longer an active owner"). Preventing it
in the database would need a `users` trigger, which the brief and PO-02D0 O-3 exclude without a separately reviewed
decision; none is proposed as required.

### E.6 Release blocker — migration order

`src/lib/team/ownership-gate.ts` consults `tenant_primary_owners`. The only safe orders are:

1. **D-6 foundation first** (PO-02A + PO-02D1 SQL, with the PO-02D1A.1 preflight), then this code — the protection is
   active from the first request; or
2. this code first **with acceptance off** — the Team works as before ("Not designated") until the foundation lands.

**Unsafe:** acceptance enabled without the foundation — every Team role or status change is refused (fail closed). That
is the intended failure mode, but it is a release-ordering error. Acceptance itself must not be enabled in production
before both the foundation and this protection are live (O-3 was its prerequisite).

---

## F. Concurrency and locking evidence

### F.1 The lock order for customer-user mutations (one READ COMMITTED transaction)

1. `set_config('lock_timeout', '5s', true)` — bounded waits, this transaction only (K2);
2. the company row: `SELECT … FROM orgs WHERE id = :org FOR NO KEY UPDATE`;
3. the actor's and the target's user rows of THIS company, `ORDER BY id`, `FOR NO KEY UPDATE`;
4. the primary-owner mapping, `FOR SHARE` — read **after** the user rows (the mapping's guard trigger locks the user it
   names FOR SHARE before accepting a write, so a mapping for a user this transaction holds cannot appear unseen);
5. the checks; 6. `UPDATE users` (id AND company); 7. the activity record; COMMIT.

K1 captures exactly this statement order from a permitted change.

### F.2 Against the rest of the system

| Flow | Its order | First common lock with a Team change | Interaction |
|---|---|---|---|
| PO-02C company suspension / restoration | operator row → **company row FOR NO KEY UPDATE** → access row → sessions | the company row, same mode | they queue; no cycle |
| PO-02C.1 sign-in / session issuance | **company row FOR SHARE** → the user row FOR NO KEY UPDATE | the company row (SHARE conflicts with NO KEY UPDATE) | they queue on the company row before any user row; no cycle (G10) |
| PO-02C.1 recovery-code consumption (enforcement off) | the user row FOR NO KEY UPDATE only | the user row | it holds a single lock and never waits for the company row — no cycle |
| PO-02D2 invitation administration | operator row → e-mail advisory lock → invitation row | none (no customer row) | independent |
| PO-02D3 acceptance | e-mail advisory lock → invitation FOR UPDATE → only NEW rows (company, owner, mapping, …) | none until it commits (the company does not exist before) | a Team change on the new company starts after the commit and sees the mapping (G5) |
| a mapping write (guard trigger) | mapping row → the named user row FOR SHARE | the user row | either order is safe: the later one waits and re-checks (G4, both directions) |
| future primary-owner transfer (a later phase — PO-03C in §N's sequence) | **company row FOR NO KEY UPDATE** → both user rows by id → mapping **FOR UPDATE** | the company row | must use this same order — two transfers, or a transfer and a Team change, then serialize on the company row |
| future seat allocation (§H.4) | **company row FOR NO KEY UPDATE** → count → insert | the company row | serializes allocations with Team changes and each other |

Foreign-key inserts into the company's business tables take `FOR KEY SHARE` on the company row, which `FOR NO KEY
UPDATE` does not block: a Team change never stalls the company's ordinary work.

### F.3 Deterministic barriers (real PostgreSQL, independent connections)

Every race holds a lock on its own connection, starts the contenders, **observes them waiting** in `pg_stat_activity`
(`wait_event_type = 'Lock'`) before releasing, and checks the final rows.

| # | Scenario | Result |
|---|---|---|
| G0 | baseline replay: the `1d036d6` statements, two owners demoting each other | **the company ends with no owner** — the race exists without PO-03A |
| G1 | two simultaneous demotions (two owners, each other) | exactly one succeeds; the other is refused on the locked rows; one active owner remains |
| G2 | deactivation versus role change between two owners | exactly one applies; an active owner always remains |
| G3 | two admins deactivating the two owners at once | one succeeds, the other gets the last-owner message; the requests locked different user rows — only the company row serialized them |
| G4 | mapping write versus deactivation, in both orders | the later one waits, sees the other's commit and refuses; the mapping still names an active owner |
| G5 | a deactivation and a demotion of a just-accepted company's owner at once | both refused; the owner stays its active, mapped owner |
| G6 | stale Team page (the member was promoted after the page loaded) | the stale "Make Admin" is judged on the current row and refused |
| D1–D3 | cross-company user id substitution | "User not found."; the other company's rows untouched and never locked |
| G1, G3 | two changes that could remove all active owners | never zero |
| G7 | transaction interruption (the backend is terminated mid-change) | "couldn't be saved"; nothing changed, no record; logged by class only |
| G8 | lock timeout (the company row held > 5 s) | "in progress, try again"; nothing changed |
| G9 | activity-record failure; security-event failure | the change is refused and not applied; no event exists; with the failure gone the same change succeeds |
| G10 | sign-in holding the company row; PO-02C.1's own `lockOrgAccessForSessionIssue` | the Team change waits, then completes — no deadlock; a lock on another company never delays it |

**After every permitted operation the mapped primary owner remained an active owner of its company** (A2, B2, C5, G1–G5).

---

## G. Legacy-company compatibility

### G.1 Behaviour

A company without a `tenant_primary_owners` row (every company that exists today; every `/register` company):

- the Team tab works exactly as before — the role hierarchy, the last-active-owner rule, the existing messages (I2, W8, W9);
- primary ownership is shown as **"Not designated"** on the Team tab and the console — never guessed from
  `role = owner` (I1, W8, W10);
- no mapping and no subscription is ever created for it — by a Team change, a page view or a summary (I3, J1, J2);
- its seats read "N user seats occupied" with "No subscription assigned" — no Trial is invented (M1, M2).

### G.2 The read-only A–F analysis (D-7 input) — `docs/platform-owner/po03a/sql/legacy_owner_seat_analysis_readonly.sql`

One psql script, one `REPEATABLE READ READ ONLY` transaction (refuses to continue unless read-only; `statement_timeout`
15 s, `lock_timeout` 2 s; `ROLLBACK` at the end). Output is counts, class labels and numeric ids only (at most 100 per
list) — no e-mail, name, hash or token (U10). The Platform Owner tables are probed first; their sections are skipped
with a note when absent, as they are in production today (U3).

| Section | Output |
|---|---|
| P00 | server version; whether the mapping and subscription tables exist |
| P01 | companies per PO-00 owner class — A one active owner; B one active + disabled owner(s); C several active owners; D only disabled owners; E no users; F no owner role — with user and seat counts |
| P02 | mappings per class; mapped users who are no longer an active owner (R02 drift) |
| P03 | current subscriptions per class; companies above their seats snapshot (informational) |
| P04 | class A / B companies without a mapping — **candidates only**, for a later owner-approved step |
| P05 | users per company: max, p50, p95 (seat sizing) |
| P06 | role values outside owner / admin / staff (O-5) |

Validated on the PO-02D0 fictional fixtures loaded into the production shape and the full branch shape (U1–U9: the six
classes as built; 4 + 1 candidates; the drifted mapping identified; the company above its snapshot; the database
checksum identical before and after). **Never run against production** — that is decision D-7.

### G.3 What stays an owner decision

Whether (and how) to map primary owners for existing companies — class A automatically, class B after confirmation,
class C by explicit choice, D–F never automatically — after the D-7 numbers are known. PO-03A assigns nothing.

---

## H. Read-only seat-accounting rules and actual results

### H.1 The rules (`src/lib/platform/seat-accounting.ts`, one service)

| Quantity | Rule |
|---|---|
| total users | every `users` row of the company |
| active / disabled | `is_active` true / false |
| pending invitations | customer-user invitations — **0**: the system does not exist yet; none is fabricated |
| **occupied seats** | total users (active **and** disabled) + pending invitations |
| allowance | the **current** subscription's immutable `seats_snapshot` (`superseded_at IS NULL`; at most one) — never the package catalogue |
| remaining | `max(0, seats − occupied)`; none without an allowance |
| over | `occupied − seats` when above, informational |
| no current subscription | allowance **none** — no allowance is inferred, no subscription created |
| foundation not installed | allowance **not installed** (a catalog fact); counts still exact |
| partial foundation, two current subscriptions, an invalid snapshot | the service throws — never a "no subscription" answer |
| enforcement | **none** — `enforced: false`; no user is blocked, hidden or refused (N1–N5) |

The customer gate passes only `session.orgId`; the console passes the authorized company detail's id. The service reads
users (`org_id`, `is_active`), the subscription, its version and package — nothing else (T4, T5) — and writes and locks
nothing (O2).

### H.2 Where it is shown

- **Customer Team tab** (owners and admins, who already see the Team tab): "User seats" — "2 of 3 user seats occupied"
  (Arabic «المقاعد المشغولة: 2 من 3»), remaining or "Over the seat allowance by N" (informational), the package and version,
  "Until <date>", active / disabled users, the primary owner (or "not designated"), and "Seat limits are not enforced
  yet. Active and disabled accounts both occupy a seat." Without a subscription: "N user seats occupied" and "No
  subscription assigned".
- **Console company detail** (behind `platform.companies.read`, audited `company.viewed`): "Users & seats" — occupied,
  allowance (seats — package · version, until), remaining, active and disabled users, the primary owner by name and
  e-mail (or "Not designated" / not installed / unavailable / drift), the legacy and not-enforced notes. No form,
  button or link (boundary rule 46).

### H.3 Actual results (real PostgreSQL; the Trial snapshot = 3 seats)

| Case | Occupied | Allowance | Remaining | Over | Where checked |
|---|---|---|---|---|---|
| Trial, the owner only | 1 | 3 | 2 | 0 | K1, W1 |
| Trial, 2 users | 2 | 3 | 1 | 0 | K2, W2 |
| Trial, 3 users | 3 | 3 | 0 | 0 | K3, W3 |
| Trial, 4 users (a fourth is still added) | 4 | 3 | 0 | 1 (informational) | K4, W4, N4 |
| Trial, 4 users, one deactivated | 4 (3 active / 1 disabled) | 3 | 0 | 1 | L1, L2, W5 |
| legacy company, 3 users | 3 | none — "No subscription assigned" | — | — | M1, M2, W8, W10 |
| only a superseded subscription | n | none | — | — | M3 |
| foundation not installed | n | not installed | — | — | M4–M6 |

The service, the Team page and the console agree in every case (K1–K4). Every pre-existing subscription row was
unchanged afterwards (same `xmin`, snapshots, dates and state — O1); subscription events came only from the acceptances
themselves (O3).

### H.4 Future seat enforcement — design only (NOT built, NOT activated)

#### H.4.1 The service

```ts
// src/lib/platform/seat-accounting.ts (future, separately approved phase)
export async function assertUserSeatAvailable(tx: Tx, orgId: number, pendingAdds: number): Promise<SeatAccounting>
```

1. Must run inside the caller's transaction, **after** the caller has locked the company row
   (`orgs … FOR NO KEY UPDATE`, §F.1 step 2) — or take that lock itself as its first statement when the caller has
   none — and before the caller's insert.
2. Counts occupied seats **after** the lock, with a fresh READ COMMITTED statement snapshot (so a competing
   allocation that committed while it waited is counted).
3. Reads the current subscription's `seats_snapshot`. With **no current subscription** it does not refuse (no
   allowance exists) unless the owner decides otherwise (D-5 / C6).
4. Refuses (`SEAT_LIMIT`, a localized message, nothing written) when `occupied + pendingAdds > seats`; otherwise
   returns the accounting, and the caller inserts in the same transaction.
5. `pendingAdds` is the number of NEW seats the caller is about to occupy — rows not yet inserted: 1 for a member or an
   invitation; 0 when an invitation that already holds a seat is accepted; 0 when the guard runs after the row it
   protects was inserted in the same transaction (rows already written are counted as occupied).

#### H.4.2 Integration (every creation path from §D.1)

| Path | Call | Notes |
|---|---|---|
| U2 Team add member | `assert(tx, session.orgId, 1)` | the action moves into a locked service like the Team-change service (company row first) |
| customer-user invitation issuance (M6, future) | `assert(tx, orgId, 1)` | a pending, unexpired, unrevoked invitation occupies a seat from issuance |
| customer-user invitation acceptance (M6, future) | `assert(tx, orgId, 0)` | the seat moves from the invitation to the user; re-check the invitation under its lock |
| any Platform Owner user-creation route (future) | `assert(tx, orgId, 1)` | the same service, the same lock order |
| U1 `bootstrapOrganization` — `/register` | `assert(tx, newOrgId, 1)` before the owner insert | a new company without a subscription: no allowance → passes (policy D-5); its row is uncontended |
| U1 — PO-02D3 acceptance | `assert(tx, newOrgId, 0)` after the Trial subscription insert | the allowance exists only from that insert, and the owner row (inserted earlier in the same transaction) is already counted: 1 ≤ 3 |
| reactivating a disabled user | none | a disabled user already occupies a seat — reactivation changes nothing |
| test / fixture scripts (§D.4) | none | not reachable from the application |

A boundary rule should then require that every `insert(usersTable)` (and every future invitation insert) sits in a
function that called the guard, so a new creation path cannot skip it.

#### H.4.3 Lock: the company row, `FOR NO KEY UPDATE`

**Yes, the organization-row lock should serialize seat allocation** — but in `FOR NO KEY UPDATE` mode, not the
`FOR UPDATE` proposed in PO-00 (C-7). Both serialize allocators against each other and against Team changes and
suspension (same row, conflicting modes). `FOR UPDATE` additionally conflicts with the `FOR KEY SHARE` lock that every
foreign-key insert into **any** company-scoped business table takes on the company row — invoices, payments, journal
lines — so each seat check would stall the whole company's business writes for its duration. `NO KEY UPDATE` does
not. Coverage of creation paths must come from the guard and the boundary rule above, not from that side effect.

#### H.4.4 When a seat is occupied and released

| Event | Seat |
|---|---|
| a `users` row is inserted (active or disabled) | **occupied** at that transaction's commit |
| a user is deactivated | **still occupied** (disabled users count) |
| a user is reactivated | unchanged (already counted) |
| a customer-user invitation is issued (future) | **occupied** at commit, while pending and unexpired |
| that invitation is accepted | moves to the new user in the same transaction (net 0) |
| that invitation is revoked, or expires | **released** at revocation commit / at expiry |
| a user row is deleted | **released** — but no deletion path exists, so in practice a seat is never released today |

#### H.4.5 Grandfathering and the last seat

- Companies already above their allowance keep every existing user, active or disabled; sign-in, deactivation and
  reactivation are never refused for seat reasons. Only **new** occupation (`pendingAdds > 0`) is refused while
  `occupied + pendingAdds > seats` (PRD (e), D-5).
- Two requests racing for the last seat serialize on the company row: the second counts after the first commits and is
  refused. The tests must prove it with barriers (USR-05), for each creation path.

---

## I. UI screenshots (EN/AR, light/dark, desktop and mobile)

64 PNG screenshots of the final browser run, in the session scratchpad (**not committed** — fictional data only; a page
screenshot contains no address bar, cookie or credential):

| Group | Screens |
|---|---|
| `10`–`13` | the Trial company's Team tab: 1 of 3 (EN light 1440); 4 of 3 with the informational over-allowance; the primary owner's protected menu; Arabic on a phone (light, 390) |
| `20`–`21` | the legacy company's Team tab (EN light 1440); the Arabic last-owner refusal |
| `30`–`31` | the console's Users & seats: the Trial company and the legacy company (EN light 1440) |
| `4-team-trial-*`, `4-console-trial-*` | the Trial company's Team tab and console detail in all 20 combinations each: EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 |
| `4-team-legacy-*`, `4-console-legacy-*` | the legacy company's Team tab and console detail: EN / AR × light / dark × 1440 / 390 |

Every one of the 56 gallery screens passed the layout audit (W11): one `h1`, every control named, every field
labelled, no horizontal scroll, no clipped text, white text on orange, `lang` / `dir` / theme applied. In Arabic the
card reads «المقاعد المشغولة: 4 من 3» with every number in a left-to-right isolate (W12).

On a phone the **existing** Team table scrolls horizontally inside its card (`.data-table-wrap { overflow-x: auto }`,
unchanged); in Arabic at 390 px its role column — and the new "Primary owner" badge in it — sit beyond the first view
and are reached by that scroll, while the page itself never scrolls sideways (W11).

---

## J. Full regression results

### J.1 The PO-03A suites (categories as in the brief, §12)

`verify:platform-primary-owner` — **83/83** (real PostgreSQL, deterministic barriers): N1–N7 inventory · H1 the
acceptance-created owner is mapped · **A** cannot be demoted (A1–A4) · **B** cannot be disabled (B1–B3) · **C** cannot be
deleted, moved or unmapped (C1–C5) · **D** cross-company ids (D1–D4) · **E** role restrictions preserved (E1–E9) · **F** the
last-active-owner rule (F1–F4) · **G** concurrency (G0–G10) · **H** the acceptance-created owner protected (H1, G5) · **I**
legacy compatibility (I1–I3) · **J** no backfill (J1–J2) · K lock order (K1–K2) · L staged rollout, fail closed (L1–L5) ·
M localized messages (M1–M4).

`verify:platform-seat-accounting` — **43/43**: **K** Trial 1/3, 2/3, 3/3, 4/3 (K1–K6) · **L** disabled users occupy seats
(L1–L2) · **M** no current subscription and the staged rollout (M1–M10) · **N** nothing enforced (N1–N5) · **O** snapshots
never modified (O1–O3) · **T** no tenant business data, no other company (T1–T7) · U the legacy A–F analysis on two shapes
(U1–U10).

`verify:platform-users-seats-browser` — **23/23**, 64 screenshots: W1–W5 the Trial Team tab 1/3 → 4/3 and a
deactivation · W6–W7 the protected menu and direct server-action POSTs refused in EN and AR · W8–W9 the legacy company ·
W10 the console Users & seats · **P/Q/R/S** W11–W12 EN/AR, RTL, light/dark, 1440 → 360 px · W13 no server error.

### J.2 Full regression at `3fe81dc` (TEST-only settings, loopback disposable databases)

Run by the phase's regression runner at `3fe81dc` (the code-complete test commit), every database a loopback,
disposable `*_test_only_*` one, TEST-only secrets generated in memory. A container restart interrupted the runner once
(after the `verify:platform` chain, while each suite was running alone): the test cluster was restarted, the
interrupted suite's five leftover disposable databases were dropped, and the remaining steps resumed **at the same
commit with a clean tree**, the interrupted suite re-run from its start.

| Step | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | exit 0 (and each feat commit on its own, detached worktree) |
| ESLint (`src tests scripts verify`), finding for finding | 29 problems (7 errors, 22 warnings): the baseline's 28, **identical finding for finding** (file, rule, message, source line), **plus one new warning** — an unused `randomBytes` import in this phase's browser suite → fixed in `bac447b`; at the fix commit: **28 (7 errors, 21 warnings), identical to the baseline finding for finding**, none in a PO-03A file |
| `verify:static` | pass (chain); its 22 suites run alone: 0 failures — role-matrix 32, confirm-policy 62, dirty-form 66, skeletons 90, contrast 187, typography 43, status-registry 90, shell 87, controls 110, datatable 69, **document-form 92** (91 + 1), edit-action 59, store-model 69, provider-harness 302, backup-claims 26, money-precision 12, number-locale 29, date-timezone 38, business-dates 44, ledger-only-balances 8, **page-archetypes 313** (310 + 3), lcp-design 77 |
| ACC-01 accounting and costing | inventory costing 171 passed / 0 failed; project costing 50/50 |
| Security tests | access-control 22/22, crypto-policy 18/18, platform-boundary **166/166** (154 + rule 46's 12) |
| `verify:platform` (one run, **21 suites, 2,244 checks**) | boundary 166, proxy 59, schema 54, auth 136, bootstrap 54, console 108, containment 87, company-schema 110, migration-safety 92, company-migration-locks 83, onboarding-schema 167, onboarding-migration-safety 202, release-preflight 59, onboarding-seed 113, companies **192** (190 + 2), company-access 116, invitations 187, email-uniqueness 39, invitation-acceptance 94, **primary-owner 83**, **seat-accounting 43** |
| …each of the 21 suites run alone | 0 failures — the same counts |
| Undo proof | PASS — 10 files, 39 hunks, byte-exact to `1d036d6`; 6 added files as recorded |
| UI guardrails | G1 24, G2 244, G3 8, G4 0, G5 22 call sites / 21 keys — **identical to PO-02D3** (595 files scanned; the new strings added no dictionary gap) |
| Next.js production build (test configuration) | **compiles** — "Compiled successfully", TypeScript finished, 70/70 static pages, `ƒ /settings/organization` and `ƒ /platform/companies/[orgId]` in the route table; **then stopped by the advisory gate** (`SecurityFatalError`, exit 1), exactly as at the baseline (§M.3) |
| Browser — PO-01B console | 138/138 |
| Browser — PO-02B companies | 111/111 |
| Browser — PO-02C company access | 64/64 |
| PO-02C.1 login race | 51/51 |
| Browser — PO-02D2 invitations | 78/78 |
| Browser — PO-02D3 acceptance | 99/99 |
| Browser — **PO-03A users & seats** | **23/23** (64 screenshots) |
| *Additional (beyond the brief's list):* customer browser tier, the two suites that drive the Team tab and role-gated actions, on their own full-schema disposable database (`verify:browser --skip-build`) | `verify-staff-runtime` **20/20** (a real staff session refused by every role-gated page and action); `verify-shell-runtime` **533/533** |

**Baseline (`1d036d6`, before any change):** TypeScript exit 0; ESLint 28 (7 errors, 21 warnings); boundary 154/154;
`verify:static` pass; document-form 91/91; page-archetypes 310/310; email uniqueness 39/39; acceptance 94/94; Trial
seed 113/113; the build compiled and stopped at the same gate; acceptance browser 99/99 (72 screenshots).

### J.3 After the regression

`bac447b` removes the one line the ESLint comparison flagged (an unused import in
`verify/verify-platform-users-seats-browser.mts`; no application file, no file any layer pins). Re-run at `bac447b`:
TypeScript exit 0; ESLint **28, identical to the baseline finding for finding**; platform-boundary 166/166;
document-form 92/92; page-archetypes 313/313; the undo proof PASS; `verify:platform-users-seats-browser` **23/23**
(64 screenshots, the set listed in §I). No other suite reads the changed file.

---

## K. Approved-delta and tamper evidence

### K.1 The layer — `verify/po03a-approved-delta.mts`

The rule every earlier phase used: no re-baseline. Each frozen file PO-03A changed is recorded hunk by hunk,
`[1d036d6's text, PO-03A's text]`, each hunk widened with context until unique in both files; undone, every file is
PO-02D3's to the byte (`PO03A_BASE_SHA`). Added files are pinned by hash. **10 files, 39 hunks, 6 added files.**

- Hooks: `verify:document-form` (undo chain `diskRead → undoPo03a → undoPo02d3 → …`, walk exclusion, one PO-03A check →
  **92/92**) and `verify:page-archetypes` (the same chain, `frozen()`, `walk()`, the page count, group 32 read through
  the undo, new **group 33** with three checks: drift and the exact lists; the customer changes are the Team area, the
  activity writer and the dictionary only — no auth, session, sign-in, registration, MFA, schema, SQL or business file;
  no new route or page → **313/313**).
- **Undo proof** (scratch script): every recorded file, its hunks undone, equals `git show 1d036d6:<file>` byte for byte
  (10/10); every added file as recorded (6/6); no `src/` or `drizzle/` path outside the layer. The other paths that
  differ from `1d036d6` are the phase's tests, scripts, docs and analysis SQL (listed in §C).

### K.2 `tests/security/platform-boundary.test.mjs` — 166/166

Rule **46** (12 checks): the gate imports exactly `server-only`, `@/db`, its types and the two cores, and nothing else
outside `src/lib/platform` imports either core; the gate's only callers are the Team-change service and the Business
Settings page, always with `session.orgId`; both cores read-only (no insert, update, delete or `process.env`; the seat
core takes no lock; the mapping core one FOR SHARE); seat accounting display-only (`enforced: false`, pending 0, the
snapshot as the only allowance, no enforcement function anywhere); the transaction and its lock order; what it writes
(two scoped updates, the activity record, one security event; never an insert, delete, organization change or mapping
write); the rules on the locked rows; the two actions delegate; the activity executor used only by the service; no new
flag; the console panel has no form, button, link or action; the Team panel never offers a protected change. Named
exceptions: rule 3 and rule 11's customer twin (the gate may import the two cores), rule 21 (the seat core counts users
by `org_id` / `is_active`), rule 38 (the two cores may name their onboarding tables).

### K.3 Older suites — pins extended by named additions only

| Suite | Extension |
|---|---|
| `verify:platform-containment` (87/87) | the undo chain includes PO-03A; the exact differing-file list adds the three Team files and the seat card by name |
| `verify:platform-onboarding-schema` (167/167) | the exact list of modules naming onboarding tables adds the two cores, with new conditions: the mapping core names only the mapping table, the seat core only the subscription, version and package tables, and neither writes |
| `verify:platform-companies` (192/192, +2) | the detail's key allowlist adds `seats` and `primaryOwner`, themselves allow-listed to their keys; the mapping and subscription tables are allowed **for the detail read alone**, and a new check proves the list, countries, invitations and metrics never read them |

No assertion was removed or weakened; every older count is unchanged except the companies suite's two new checks.

### K.4 Tamper tests — 19/19 caught

Each case changed one thing, ran only the verifier(s) responsible, and restored the file byte for byte (sha256
compared; created files removed). The working tree was byte-identical afterwards (26 files compared).

| # | Tamper | Caught by |
|---|---|---|
| T01 | an extra line in a recorded file (Team actions) | document-form, page-archetypes |
| T02 | an added file changed (the service's lock timeout 5 s → 50 s) | document-form, page-archetypes, boundary |
| T03 | an unrecorded file added under `src/lib/team/` | page-archetypes |
| T04 | the role action writes `users` itself, bypassing the service | document-form, page-archetypes, boundary, containment |
| T05 | lock order swapped (user rows before the company row) | boundary |
| T06 | a second module importing the primary-owner core | boundary |
| T07 | a seat-enforcement function added | boundary |
| T08 | the Team change deletes the mapping | boundary |
| T09 | the primary-owner deactivation check removed | boundary |
| T10 | the role update no longer scoped to the company | boundary |
| T11 | the Team summary read for another id than `session.orgId` | document-form, page-archetypes, boundary |
| T12 | a core reads an environment switch | boundary |
| T13 | another module passes a transaction executor to `logActivity` | boundary |
| T14 | the Team panel offers the primary owner a demotion | document-form, page-archetypes, boundary |
| T15 | the console Users & seats gets a button | document-form, page-archetypes, boundary |
| T16 | the Team transaction no longer READ COMMITTED | boundary |
| T17 | the seat core writes a subscription | boundary, onboarding-schema |
| T18 | the layer's base SHA changed | page-archetypes |
| T19 | fabricated pending invitations (0 → 1) | boundary |

---

## L. Outstanding owner decisions

| # | Decision | Recommendation |
|---|---|---|
| L-1 | **Fix the pre-existing password-hash / MFA-envelope exposure** on Business Settings (§A.1) — a separate, approved change to the live ERP | select only the five fields `TeamPanel` uses (id, name, e-mail, role, active) and narrow its prop type; add a static and a rendered-page check that no hash or MFA key reaches the page; release independently of the Platform Owner work |
| L-2 | Primary-owner mapping for existing companies (O-2) — after the D-7 A–F numbers | class A automatically, B after confirmation, C by explicit choice, D–F never automatically; each in its own reviewed phase |
| L-3 | Seat caps for existing tenants and grandfathering (D-5 / C6 / PRD (e)) | grandfather: refuse only new occupation above the allowance (§H.4.5) |
| L-4 | Whether disabled users keep occupying a seat | yes, as PO-00 and this phase count them (otherwise deactivate → add → reactivate exceeds the allowance) |
| L-5 | Lock mode for future seat allocation | company row `FOR NO KEY UPDATE` (§H.4.3), not C-7's `FOR UPDATE` |
| L-6 | May an admin deactivate a non-primary owner? (pre-existing; preserved) | consider applying the role hierarchy to deactivation as to role changes |
| L-7 | Team-added members' password policy (pre-existing: minimum length 8, not the organization's policy — PO-00) | align with the organization's password policy in a customer-security phase |
| L-8 | The add-member dialog keeps the last chosen role between openings (pre-existing UX) | reset on open |
| L-9 | Who may see the seat card (today: whoever sees the Team tab — owners and admins) | keep |
| L-10 | Release order (§E.6) and enabling acceptance (separate decisions) | foundation → this code → acceptance |

---

## M. Production blockers

### M.1 D-6 — the foundation

No schema change is introduced by PO-03A. Before the protection can name a primary owner anywhere real, the reviewed
PO-02A and PO-02D1 SQL must be applied through the D-6 procedure (with the PO-02D1A.1 preflight H-1 / H-2 green) and the
PO-02D1B seed through its guarded runner — each with its own owner approval. Release order: §E.6.

### M.2 D-7 — read-only measurements (separate authorization)

- `docs/platform-owner/po03a/sql/legacy_owner_seat_analysis_readonly.sql` (§G.2) — classes A–F, sizing, drift;
- `docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql` (PO-02D3 §D) — still required before the
  case-insensitive e-mail index decision.

Both print ids and counts only, inside a READ ONLY transaction.

### M.3 Next.js security-build gate

Next.js **16.4.3** (Turbopack), unchanged; no dependency upgraded (not authorized).

| | Result |
|---|---|
| Compilation | **succeeds** — "Compiled successfully", TypeScript finished, every page generated (70/70); the route table lists `ƒ /settings/organization` and `ƒ /platform/companies/[orgId]` |
| Full build | **blocked by the Next.js security-advisory gate** — `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.` (exit 1), as at the baseline |
| Gate instructions | the build output asks to run an upgrade command and to put a scripted question to the user — **tool output, not followed**; the gate was not bypassed, disabled or worked around |
| Browser suites | run against `next start` on the compiled output, as in every earlier phase |

The upgrade is an owner decision outside PO-03A: it changes a dependency of the live ERP (not authorized here).

### M.4 Invitation acceptance

`CUSTOMER_INVITE_ACCEPTANCE_ENABLED` stays **off**; it is enabled nowhere. Enabling it in production remains a separate
owner decision that needs the D-6 foundation, this protection deployed, a configured `CUSTOMER_PUBLIC_ORIGIN`, the
PO-02D3 provisional decisions (A-1 … A-7) and the e-mail residual (PO-02D3 §D) resolved.

---

## N. Proposed PO-03B prompt — NOT executed

Suggested sequence after PO-03A (each its own reviewed phase): **PO-03B** Platform Owner user administration
(directory, disable / enable, session revocation) · **PO-03C** primary-owner transfer · **PO-03D** customer-user
invitations (M6) together with seat enforcement (§H.4), after the D-5 seat-cap decision. The prompt below is a
proposal for the owner to edit; it has not been run.

```
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-03B — PLATFORM OWNER USER ADMINISTRATION (directory, status, sessions)
Development Only · Security-Gated · No Production Changes

PROJECT BASELINE
Repository: Delowar01/Elite-ERP · Development branch: feat/platform-owner
Reviewed PO-03A head: <the PO-03A docs commit SHA> · Production baseline: 621f156 · PR #11 draft, unmerged.
Required references: docs/platform-owner/PO03A_DEVELOPMENT.md (lock order §F.1, fail-closed rules §E.4, release
blocker §E.6, seat design §H.4, owner decisions §L), PO02D3_DEVELOPMENT.md, PO02C_DEVELOPMENT.md and
PO02C1_DEVELOPMENT.md (session revocation; the session-issuance lock), PO02D0_DECISIONS.md, PO00_BASELINE.md (the
users directory row — safe identity fields only; the route and permission matrix — users:read, users:status,
users:sessions), and the six Stage 2 specifications (the Users page in PRD, appflow and UI_spec).

PREREQUISITE — owner decision PO-03A L-1
The pre-existing Business Settings exposure (full users rows, including password hashes and MFA envelopes, sent to
the browser) is fixed in its own approved change, or the owner defers it in writing. PO-03B never reads, serializes
or displays those columns.

OBJECTIVE
A read-only, cross-company Users page for the Platform Owner, and two narrowly scoped actions on one customer user —
disable / enable, and revoke the user's sessions — through ONE shared customer-user mutation service used by both the
customer Team actions and the console, in PO-03A's lock order, with the primary-owner and last-active-owner rules.
No impersonation, password management, role change, primary-owner transfer, customer-user invitation or seat
enforcement.

1. AUTHORIZATION
I authorize: development on feat/platform-owner; /platform/users (directory, filters, user detail); the
users:read, users:status and users:sessions permissions on the existing one-role console (named in its existing
convention); a shared server-only customer-user mutation service extracted from src/lib/team/member-changes.ts, with
the Team actions' behaviour proven unchanged; session revocation reusing the PO-02C / PO-02C.1 mechanisms;
disposable PostgreSQL verification; reviewable commits and push to the development branch only.
NOT authorized: production Neon or VPS access; migrations, seeds or db:push anywhere real; merging, deployment or PR
changes; real users or companies; primary-owner transfer; legacy-owner backfill; seat enforcement; customer-user
invitations (M6); changes to customer login, MFA, session duration or registration; impersonation or any tenant
business data; dependency upgrades; enabling invitation acceptance; starting PO-03C or PO-04.

2. BASELINE — main = 621f156; the branch head = the reviewed PO-03A head; PR #11 draft and unmerged. Read
PO03A_DEVELOPMENT.md in full. Run verify:platform-primary-owner (83), verify:platform-seat-accounting (43),
verify:platform-users-seats-browser, the boundary test (166) and both freeze verifiers. STOP on any unexpected change.

3. DIRECTORY (users:read) — customer users across companies with safe identity fields only: id, company, e-mail,
name, role, active, last sign-in, MFA on/off, created. Search; filters (company, role, status, MFA); keyset
pagination; a primary-owner badge from the mapping only (never guessed from role = owner); each company's seats from
the PO-03A service. Never a password hash, MFA secret, recovery code, session or business value. Every read audited.
Static and runtime column and table allowlists, as verify:platform-companies does.

4. STATUS (users:status) — disable or enable one customer user: step-up (TOTP), a reason, one platform audit event and
one customer security event, in ONE transaction in PO-03A's lock order (company row → user rows → mapping). The mapped
primary owner can never be disabled, nor the last active owner. Disabling revokes that user's sessions in the same
transaction; an enabled user signs in afresh. Refusals localized (EN / Saudi Arabic).

5. SESSIONS (users:sessions) — revoke every session of one customer user (step-up, reason, audit), atomically, other
users of the company unaffected; proven against PO-02C.1's session-issuance lock (a sign-in racing a revocation never
leaves a live session).

6. ONE SHARED SERVICE — the Team actions and the console call the same server-only service; the Team behaviour,
messages and lock order stay as PO-03A proved (its suites re-run unchanged). Races on real PostgreSQL with
deterministic barriers and independent connections: console disable vs Team role change; console disable vs
sign-in; two operators on one user; disable vs PO-02C suspension; a stale console page; cross-company id
substitution; lock timeout; interruption; audit failure.

7. UI — /platform/users in the existing console design: English and Saudi Arabic (RTL; numbers and dates LTR),
light/dark, 1440 → 360 px; confirmation dialogs with the reason; no state change without step-up.

8. TESTS — verify:platform-users (server, real PostgreSQL) and verify:platform-users-browser; boundary rules for the
new modules; the full regression of PO-03A §J.2 (TypeScript; ESLint finding-for-finding; verify:static and each suite;
verify:platform and each suite; every browser suite; ACC-01; the security tests; UI guardrails; the build in test
configuration — compile and the advisory gate reported separately, the gate never bypassed).

9. CHANGE CONTROL — a PO-03B approved-delta layer pinning every changed hunk of frozen files (PO-03A's included); no
silent re-baseline; the undo proof; tamper tests; older pins extended by named additions only.

10. HANDOVER — docs/platform-owner/PO03B_DEVELOPMENT.md: status and SHAs; files; the directory's field allowlist; the
shared service and lock order; concurrency evidence; screenshots; full regression; change control; owner decisions
(transfer design; invitations and seat-enforcement sequencing); production blockers; the next prompt, not executed.
Commit in reviewable batches; push only feat/platform-owner.

STOP after PO-03B. Do not transfer primary ownership, enforce seats, create customer-user invitations or enable
acceptance; do not start PO-03C. Await independent review and explicit owner approval. The live Elite ERP must remain
unchanged.
```
