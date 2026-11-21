# PO-06 — `users_email_lower_uq`: the case-insensitive e-mail uniqueness proposal (decision E-1)

**Status:** PROPOSAL. **Not installed anywhere but disposable `*_test_only_*` databases.** No customer e-mail was read,
changed, normalized or removed anywhere real. The SQL is PO-02D3's, unchanged and still guarded:
- `docs/platform-owner/po02d3/proposal/users_email_lower_unique.proposal.sql`;
- its rollback, `…_rollback.proposal.sql`;
- the audit, `docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql`.

PO-06 adds the tests the earlier work lacked: the real registration and Team writers under the index, concurrency
through the application code, and the end-to-end failure and recovery path. Those tests are
`verify/verify-po06-data-safety.mts` §Q; the PO-02D3 tests 4a–4h stay in `verify:platform-email-uniqueness`.

## 1. Current unique-index behaviour

- `users.email` is `text NOT NULL` with `users_email_unique = UNIQUE (email)`. It is **case-sensitive**: the database
  accepts `Mixed.Twin@…` and `mixed.twin@…` as two accounts (PO-06 Q1, on a disposable copy).
- Every application writer stores `trim().toLowerCase()`: `/register`, Team Add Member, and company and user
  invitation acceptance (PO-02D3 §D.1, static check). Two application writers of one address therefore collide on
  `users_email_unique`.
- What the constraint cannot stop:
  - a writer outside the application (manual SQL, an import, future code that skips normalization);
  - a legacy row stored in mixed case. Sign-in looks up the lower-case form, so such an account cannot sign in, and a
    second, lower-case account can still be created (Q11, below).

## 2. The read-only duplicate audit

The D-7 bundle (`sql/d7_readonly_production_audit.sql`, section D7-08) measures:
- **E1**, the case-insensitive duplicate groups, the largest group, the accounts involved and the groups that span
  companies;
- **E2**, rows not stored normalized; **E3**, white space; **E4**, non-ASCII; plus addresses without exactly one `@`;
- **E5 / E5b**, open company and user invitations whose address is already an account;
- **E6–E8**, the table size and the e-mail collation, the existing unique constraints, and whether the index already
  exists.

The output is counts and per-run pseudonyms only, never an address. On the fictional data it reported exactly the
planted cases (P14): E1 = 1 group of 2 accounts spanning 2 companies, 3 non-normalized, 1 with white space,
1 non-ASCII. **The index cannot be built until E1 = 0** — the proposal refuses at step 1 otherwise (Q3).

## 3. Remediation options for E1 > 0 (each needs the owner's decision per group; none is automatic)

| Option | What happens | When to choose it |
|---|---|---|
| R-a Do nothing; no index | the residual stays: a non-normalized writer could still create a twin | if E1 > 0 cannot be resolved yet, and the residual is accepted in writing |
| R-b Disable the duplicate account | `is_active = false` on the account the owner names; the address stays unique only after R-c or R-d | an obviously abandoned account |
| R-c Change the duplicate's address, with the account holder's consent | the owner contacts the customer; the address is changed through the normal ERP path | both accounts are real and in use |
| R-d Merge or remove | **never routine**: it touches business records (audit, sessions, documents created by the user) — its own approved plan with a backup | a test or erroneous account |

**Customer e-mails are never modified silently.** No script in this repository changes a `users.email`. In the PO-06
test, the fictional twin was deleted on the disposable copy only, to reach E1 = 0 (Q4).

## 4. Locking and the index-build method

- `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_email_lower_uq ON public.users USING btree (lower(email))`,
  run in autocommit, statement by statement — never inside `BEGIN`, never with `psql -1`.
- It holds only **SHARE UPDATE EXCLUSIVE** on `users`, and waits for transactions that were already open.
- Measured (Q5–Q7):
  - the build was observed waiting for an open writer, holding nothing stronger than SHARE UPDATE EXCLUSIVE;
  - meanwhile a registration-style INSERT and a sign-in UPDATE on `users` completed at once (a few milliseconds);
  - when the open transaction ended, the index finished valid.
- Timeouts: `lock_timeout = 0` and `statement_timeout = 0` inside the file, so the build is never cut short half-way.
  The run is bounded from outside, by its maintenance window.
- Sizing comes from D7-08 E6 (rows and bytes of `users`).

## 5. Compatibility with registration

- Q9: a new address registers normally under the index, through the real `bootstrapOrganization`, in the `/register`
  action's own order (exact-match pre-check, then one transaction).
- Q10: the lower-case form of a legacy mixed-case account. The pre-check (an exact match) misses it. The **database**
  refuses with 23505 on `users_email_lower_uq`, and the whole transaction rolls back: no company is created.
- Q11: without the index the same registration **creates a second account differing only by case**. That residual is
  what the index closes.
- **Finding EI-1.** `src/app/(auth)/actions.ts` has no handler for a unique violation. In this case, and in the
  pre-existing race of two simultaneous registrations, the user sees a failed server action instead of "An account
  with this email already exists." The data stays correct.
  - A one-line mapping (`23505` on a `users_email*` constraint → the existing message) would fix the message.
  - That is an application change, which is not authorized in PO-06. It is recommended with E-1.

## 6. Compatibility with company and user invitations

- Both acceptance services map **any** 23505 on a `users_email*` constraint to the neutral "unavailable" refusal:
  `src/lib/platform/invitation-acceptance.ts` and `src/lib/platform/user-invitation-acceptance.ts`, checked in Q14.
  Team Add Member maps the same to "A user with this email already exists."
- All three re-check `lower(email)` inside their transaction before inserting. With the index present, their outcomes
  do not change; the index only adds the database-level guarantee.
- Q12: Team Add Member, run through the real `addTeamMember` in a request scope, refuses `OWNER.FALCON@…` with its own
  message.
- Pending invitations whose address is already an account are counted by E5 / E5b. They do not block the index, which
  covers `users` only.

## 7. Concurrent registration testing

| Test | Result |
|---|---|
| Q8: two non-normalized writers race (`Race.Twin@…` and `race.twin@…`), with a deterministic barrier | the second is observed waiting on the first's uncommitted index entry. When the first commits, the database refuses the second with 23505 on `users_email_lower_uq` |
| Q13: two concurrent registration processes through the real bootstrap, the same address in two letter cases | exactly one account and one company; the other is refused, with nothing left behind |

## 8. Failure handling

| Failure | Behaviour (tested) | Recovery |
|---|---|---|
| duplicates exist | step 1 refuses and builds nothing (Q3) | resolve per §3, re-run the audit (E1 = 0), run the file again |
| a duplicate committed during the build | the build fails with 23505 and leaves an **INVALID** index (Q16) | the file refuses to continue over the INVALID index and prints `DROP INDEX CONCURRENTLY public.users_email_lower_uq`. Run the rollback (it drops the INVALID index CONCURRENTLY), resolve, build again — valid (Q16) |
| an interrupted build (connection lost) | INVALID index, as above | as above |
| a different definition under the same name | refused at step 1 | investigate; never overwrite |

## 9. The index rollback

The rollback file:
1. runs `DROP INDEX CONCURRENTLY IF EXISTS public.users_email_lower_uq`, in autocommit, with no blocking lock;
2. then checks that the index is gone **and** that `users_email_unique` still exists.

It is idempotent: two runs in a row succeed (Q15). Every row stays byte-identical. Run it before rolling back an
application release that depends on the index — none does today.

## 10. The owner approval gate (all required, in this order)

1. A D-7 run, under the procedure in `D7_AUDIT_PROCEDURE.md`, reporting **E1 = 0** on the target, with E2–E5 reviewed.
2. The owner's written approval of the index on the customer table `users` (decision E-1), naming the target
   environment: staging first.
3. D-6 approved, and the file executed through an approved runbook. Today that means a reviewed copy of the proposal
   **with the approval guard removed in a separate, reviewed commit**: the committed file raises
   "not approved for execution" before any statement (Q2). The copy is applied only by name, to the approved target.
4. EI-1 decided: fix the `/register` message first, or accept it in writing.
5. Rollback file ready; a backup taken (staging: `scripts/backup.sh`); a window agreed.

**Recommendation:** approve the index for the first test-only staging deployment, after E1 = 0 on the fictional
staging data. That is trivially true for a fresh staging database. Decide production only after D-7 on production.
