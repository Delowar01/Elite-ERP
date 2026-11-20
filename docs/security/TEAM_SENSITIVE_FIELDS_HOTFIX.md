# Security hotfix candidate — Team page sends authentication fields to the browser

| | |
|---|---|
| Status | **Candidate for an owner-approved production hotfix. Not merged, not deployed.** |
| Repository | `Delowar01/Elite-ERP` |
| Branch | `fix/team-sensitive-fields-exposure` |
| Based on | `main` at `621f156f7b129b9c2e289bc46d314ce7587beec2` (the production baseline) and nothing else |
| Fix commit | `35d5dcc7d2fbc245178ce094788d890dd424bc32` (this document is the commit after it) |
| Scope | 2 production files (+11 / −2), 2 verification files (the change-control record for `main`'s freeze verifier) |
| Data, schema, environment | No migration, no seed, no data change, no new environment variable, no dependency change |

## 1. The vulnerability

`src/app/(app)/settings/organization/page.tsx` (Business Settings, the Team tab) loaded the team with an
unqualified query:

~~~ts
const members = await db.select().from(usersTable).where(eq(usersTable.orgId, session.orgId)).orderBy(asc(usersTable.name));
~~~

`db.select()` with no column list returns **every column** of `users` (`src/db/schema/users.ts`), including:

- `password_hash`: the bcrypt password hash, which can be attacked offline;
- `mfa_secret`: the field-encrypted TOTP secret envelope;
- `mfa_recovery_codes`: the field-encrypted envelope of the bcrypt-hashed recovery codes.

It also returns `password_changed_at` and `last_login_at`.

The page passed these rows to `TeamPanel` (`src/app/(app)/settings/team/team-panel.tsx`). That is a **client**
component typed `members: User[]`, so React serialized every field of every member into the page sent to the browser.
The fields appear in the inline flight data of the HTML document and in the RSC payload of a client-side navigation.
`TeamPanel` uses only `id`, `name`, `email`, `role` and `isActive`.

**Who received the fields:** any signed-in **owner or admin** who opened Business Settings, for every member of
**their own company**. Staff users are redirected away from the page. The query is scoped to `session.orgId`, so no
other company's users are included.

**What the envelopes mean:** the MFA secret and the recovery codes are encrypted with the server-side field key
(`FIELD_ENCRYPTION_KEYS`), and the recovery codes are bcrypt hashes inside that envelope. The envelopes are therefore
not directly usable without the server key. The bcrypt password hash is the material that can be attacked offline,
and a weak password can be recovered from it.

### 1.1 How it was verified

No real user record was read.

1. **Code inspection** of the three files above at `621f156`: the unqualified `db.select()`, the `User[]` prop, and
   the fields `TeamPanel` actually reads.
2. **Runtime proof on `main` itself**, using a disposable loopback PostgreSQL database named `*_test_only_*` and
   fictional data only:
   - A fictional company was registered through the real `/register` flow.
   - Two fictional members were added with distinctive **canary** values: a bcrypt-shaped password hash each, an MFA
     secret envelope each and a recovery-code envelope each. Canary MFA envelopes were also set on the owner.
   - The production build of `main` was started, and the owner opened Business Settings → Team.
   - The actual server-to-client payloads were captured: the HTML document exactly as the browser received it, and
     the RSC payload the page itself fetches.
   - Only counts were recorded, never values.

| Payload (unchanged `main`) | HTML document | RSC payload |
|---|---|---|
| Each of the 8 canary values (2 hashes, 3 MFA envelopes, 3 recovery envelopes) | 1 each | 1 each |
| The owner's real (fictional-account) bcrypt hash | 1 | 1 |
| **Total canary occurrences** | **9** | **9** (18 in all) |
| Keys `passwordHash` / `mfaSecret` / `mfaRecoveryCodes` | 3 / 3 / 3 | 3 / 3 / 3 |
| Keys `passwordChangedAt` / `lastLoginAt` | 3 / 3 | 3 / 3 |
| bcrypt-shaped strings (`$2a/b/y$NN$` + 53 characters) | 3 | 3 |

There is one occurrence per member: three members, each with three authentication fields. The vulnerability is
confirmed.

## 2. The fix

The two production files change, and nothing else in the application.

~~~diff
--- a/src/app/(app)/settings/organization/page.tsx
+++ b/src/app/(app)/settings/organization/page.tsx
-  const members = await db.select().from(usersTable).where(eq(usersTable.orgId, session.orgId)).orderBy(asc(usersTable.name));
+  // Security: only the fields the Team panel renders. The rows are serialized to the browser, so never select the
+  // password hash or the MFA secret / recovery-code envelopes here.
+  const members = await db
+    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive })
+    .from(usersTable)
+    .where(eq(usersTable.orgId, session.orgId))
+    .orderBy(asc(usersTable.name));

--- a/src/app/(app)/settings/team/team-panel.tsx
+++ b/src/app/(app)/settings/team/team-panel.tsx
+/** Exactly what the panel renders — the props are serialized to the browser, so no authentication field belongs here. */
+export type TeamMember = Pick<User, "id" | "name" | "email" | "role" | "isActive">;
 ...
-  members: User[];
+  members: TeamMember[];
~~~

- The query names exactly the five allowlisted fields, with the same `where` (the session's own company) and the same
  order.
- The prop type is narrowed to exactly those fields. A full `User` row can no longer be passed: TypeScript rejects it.
- Unchanged: the Team interface, its actions (add member, change role, activate, deactivate), permissions, sign-in,
  MFA, sessions, the schema and every other page.

### 2.1 Change control on `main`

`main`'s freeze verifier (`verify:page-archetypes`) pins Business Settings byte for byte. The hotfix is recorded the
same way as every earlier approved change, with no re-baseline:

- `verify/team-fields-hotfix-approved-delta.mts` (new) records the two hunks byte for byte. Undone, each file is
  `621f156`'s to the byte (sha256 pinned).
- `verify/verify-page-archetypes.mts` reads the two files through that record. A new group 21 holds 2 checks:
  - each recorded hunk is the file's only change;
  - the query names exactly the five fields, and `TeamPanel` takes `TeamMember[]`.

  The verifier goes from 255 to **257/257** checks.
- **Undo proof:** with the hunks undone, both files are byte-identical to `621f156`. PASS.
- **Tamper proof:** three tampered copies of the fix were each rejected by the verifier (**3/3 caught**). Group 21
  scored 0/2 each time:
  - T1, the unqualified full-row `db.select()` restored: 250/257;
  - T2, a sixth field added to the selection: 248/257;
  - T3, `TeamPanel`'s prop widened back to `User[]`: 251/257.

## 3. Corrected payload evidence

The fix's production build was tested with the same fictional harness and the same canary values on a fresh
`*_test_only_*` database:

| Payload (fix) | HTML document | RSC payload |
|---|---|---|
| Canary occurrences (all 8) | 0 | 0 |
| The owner's real (fictional-account) bcrypt hash | 0 | 0 |
| Keys `passwordHash` / `mfaSecret` / `mfaRecoveryCodes` / `passwordChangedAt` / `lastLoginAt` | 0 | 0 |
| bcrypt-shaped strings | 0 | 0 |
| Member names present (the payload really is the Team tab) | yes | yes |

**All canary values are absent.**

The Team tab still works. 8/8 functional checks passed on the fix and on the baseline:

- names and e-mails are shown;
- role labels and Active statuses are shown;
- **Add Team Member** creates the member and shows it;
- **Change role** (Make Admin → confirm) is stored;
- **Deactivate** (confirm) is stored;
- **Activate** is stored.

## 4. Test results (baseline `621f156` against fix `35d5dcc`, same harness, UTF-8 disposable cluster)

| Check | Baseline `main` | Fix |
|---|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors | 0 errors |
| ESLint (`src tests scripts verify`) | 28 findings (7 errors, 21 warnings) | 28 findings (7 errors, 21 warnings), **identical finding for finding** |
| `verify:static`, the full chain | 77/77 | 77/77 |
| `verify:static`, each of its 23 suites run on its own | 0 failures | 0 failures (page-archetypes 257/257 with group 21) |
| ACC-01 `verify:inventory-costing` / `verify:project-costing` | 171 passed, 0 failed / 50/50 | 171 passed, 0 failed / 50/50 |
| Customer security `access-control` / `crypto-policy` | 22/22 / 18/18 | 22/22 / 18/18 |
| `ui:guardrails` | pass | pass |
| Team payload canary (this document §1.1 / §3) | 18 occurrences | **0 occurrences** |
| Team functional checks | 8/8 | 8/8 |
| Browser tier `staff-runtime` | pass | pass |
| Browser tier `shell-runtime` (run twice) | pass, pass | pass, pass |

During an earlier run on a cluster initialized as SQL_ASCII, the fix's `shell-runtime` tier failed one check, 532/533,
on two runs. The failing check differed each time: a navigation drawer's Escape/focus-return check at 390 px in
English, then at 600 px in Arabic. Neither involves the Team page. The cluster was re-initialized as UTF-8, which the
release preflight requires. On UTF-8, `shell-runtime` passed twice on both the baseline and the fix.

## 5. Build status

`next build` on the fix:

- **Compilation succeeded.** `✓ Compiled successfully`, `Finished TypeScript`, page data collected, and the route
  table printed.
- **The build was then stopped by Next.js's security-advisory gate** (`SecurityFatalError`, exit 1). Next.js 16.4.3 is
  flagged by a published advisory.
- **The gate pre-dates this hotfix and does not depend on it.** It is nondeterministic. On the same day the baseline
  `main` build met the same gate as a warning and continued (exit 0), while the fix builds met it as a fatal stop after
  compiling.
- **The gate was not bypassed, and no dependency was changed.** Upgrading Next.js is a separate owner decision.

## 6. Adjacent customer-to-browser boundaries (read-only review; not changed by this patch)

| Location | Finding | Assessment |
|---|---|---|
| Security Center (`src/app/(app)/settings/security/`) | The page passes the current session's `jti` and the signed-in user's **own** sessions' `tokenHash` values to its client component, to mark "this device" and to revoke a session | **Low / informational.** These belong to the user's own sessions. A session token is a JWT signed with `AUTH_SECRET`, so a `jti` or a SHA-256 `tokenHash` alone cannot mint a session. Recommended as a separate, reviewed change: pass an opaque per-row id and compute "current" on the server. |
| Team server actions (`src/app/(app)/settings/team/actions.ts`) | They return `{ error? }` only, never user rows | No exposure |
| App shell (`src/components/layout/app-shell.tsx`) | It receives the signed-in user's name, e-mail and role only | No exposure |
| Admin security events (Security Center) | They are mapped to display fields before reaching the client | No exposure |

As instructed, these were recorded separately and not added to this patch.

## 7. Standalone release procedure (for the owner; not executed)

This hotfix is independent of the Platform Owner work. It can be released before, after or without the Platform Owner
staging deployment.

1. **Review.** Open a pull request `fix/team-sensitive-fields-exposure` → `main` and review the diff:
   - the two production files (§2);
   - the change-control record and the verifier hook (§2.1);
   - this document.
2. **Verify** on a disposable test database (never production):
   - `npx tsc --noEmit -p .`
   - `npm run verify:static` (expect 77/77; `verify:page-archetypes` 257/257)
   - `node tests/security/access-control.test.mjs`
   - `node tests/security/crypto-policy.test.mjs`
   - the browser tiers
   - optionally, the canary check of §1.1 with fictional users

   Expect the build to compile and then possibly stop at the Next.js advisory gate (§5). That gate is not caused by
   this change.
3. **Approve and merge** into `main` by the owner, and record the merge SHA.
4. **Deploy** with the existing production procedure for `main`:
   - update the checkout to the merge SHA;
   - `npm ci` from the unchanged lockfile;
   - build;
   - restart the application service.

   There is no database migration, no seed, no environment change and no data change. How the advisory gate is handled
   in the production build is the owner's existing decision. This patch does not change it.
5. **Post-deploy check**, with an owner or admin account:
   - open Business Settings → Team and confirm that names, e-mails, roles and statuses render and that the Team actions
     work;
   - in the browser's developer tools, confirm that neither the page source nor the RSC response contains
     `passwordHash`, `mfaSecret` or `mfaRecoveryCodes`.
6. **Rollback** if needed: revert the merge commit and redeploy. There is no schema or data state to restore.
7. **Owner decisions after release** (not part of this patch):
   - whether the exposure warrants a forced password change for members of companies where more than one person
     holds the owner or admin role, because those are the only users who could have seen colleagues' hashes;
   - whether customers should be notified;
   - whether any intermediary could have cached the dynamic page.

   The MFA and recovery envelopes are encrypted with the server-side key. Rotating that key is a separate, larger
   decision.

## 8. What this work did not do

- It did not merge, deploy, restart any service, or access the production database or server.
- It did not read or modify any real user or company record. All evidence came from fictional data on disposable
  loopback databases named `*_test_only_*`, dropped afterwards.
- It did not change PR #11, upgrade a dependency, or bypass the build gate.
- It did not include values in this document. Every canary appears here only as a count.
