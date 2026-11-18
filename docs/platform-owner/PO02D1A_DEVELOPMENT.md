# Platform Owner — PO-02D1A: onboarding database schema — implementation and validation

> Phase PO-02D1A of the Elite ERP Platform Owner programme. **Schema only.** No Trial package, no published version,
> no settings value, no subscription, no primary owner and no invitation terms exist — the owner has not approved the
> Trial length, seats, storage or module labels, so those values stay **unconfigured**. Nothing here ran against
> production; every database used was a loopback, disposable `*_test_only_*` database holding fictional rows only.
> The SQL files are marked **NOT AUTHORIZED FOR PRODUCTION EXECUTION** (decisions D-6 and D-7 remain open).
>
> **Superseded in part by PO-02D1A.1** (`PO02D1A1_MIGRATION_HARDENING.md`): D-11b (§A finding 2, §K-2) is corrected on
> the branch; the H-2 recovery in §K-1 is incomplete — an interrupted push also drops four customer foreign keys
> (H-3), which must be restored before the reviewed SQL — and `npm run platform:db:preflight` now detects every state.

---

## A. Completion status

| Item | Status |
|---|---|
| Baseline (87efa15, PR #11 draft, live 621f156) re-verified, full baseline regression | done — unchanged from PO-02D0 except the pre-existing Next.js advisory build gate (§J, §K-7) |
| Step 3 — the PO-02D0 proposal SQL executed for the first time (guard-free scratch copies, never the originals) | done — 8 defects found (D-01…D-08), mechanics of D-09 validated; 2 further proposal defects found later by the new suites (D-10, D-11) |
| Step 4 — F1–F8 implemented (`drizzle/platform/PO02D1_*.sql`, `src/db/schema/platform-onboarding.ts`, F1 in `users.ts`) | done — 7 tables, 3 guard functions, 10 triggers, 1 additive key on `users` |
| Step 5 — SQL ≡ Drizzle equivalence | **GO** — full catalog projection identical; `drizzle-kit push` after the SQL issues no PO-02D1 statement and drops, replaces or weakens nothing |
| Step 6 — execution safety | done — guard refusals, preconditions, 23 shape-mismatch cases, retry on 5 shapes, injected failures, production path disabled |
| Step 7 — Trial seed | **deferred** (not executed); only fictional numeric fixtures inside tests, every test database dropped |
| Step 8 — test matrix | done — `verify:platform-onboarding-schema` 167/167 |
| Step 9 — concurrency and locking (measured) | done — `verify:platform-onboarding-migration-safety` 202/202 (§H) |
| Step 10 — rollback | done — exact procedure (§I), both F1 cleanup paths, data guard per table, audit evidence kept |
| Step 11 — ERP protection | done — `/register`, login, MFA, sessions, PO-02C.1 locking, Platform Owner login/Settings, design system: unchanged (§J) |
| Step 12 — full regression + change control | done (§J); PO-02D1A approved-delta layer with 11 tamper tests and an undo-to-87efa15 proof |
| Step 13 — this document | done |
| Step 14 — reviewable commits, push `feat/platform-owner` only | done (§B) |
| **STOP gate** | **STOPPED after PO-02D1A.** No Trial seeded, no invitation administration or acceptance, no production change, no merge, no deploy, no new PR, PR #11 untouched |

**Two findings need owner attention before any merge or production rehearsal** (details §K):
1. **H-1/H-2 — `drizzle-kit push` before the reviewed SQL is unsafe on an existing database.** The repository documents
   `npm run db:push` as production's schema path. With the onboarding module declared, a push onto an existing
   database (a) stops at drizzle-kit's prompt offering to **TRUNCATE `users`** when users has rows (non-interactive:
   aborts, nothing applied), or (b) when users is empty, fails half-way (42830) leaving seven trigger-less tables.
   Applying the reviewed SQL **first** makes a later push a no-op for PO-02D1 (measured). This is a D-6 prerequisite.
2. **D-11b — PO-02A's already-reviewed migration holds ACCESS EXCLUSIVE on `orgs` and `platform_admins` until COMMIT**
   (measured, on first application and on every verify-only re-run): every read of `orgs` — every customer sign-in's
   first statement — waits for it. PO-02D1A corrected the same defect in its own SQL (D-11) but did not change PO-02A's
   approved file. The proven fix is in §D.

---

## B. Branch and commits

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (approved PO-02D0 head) | `87efa158268b8486a8208c0d87d9a5f7a0346a76` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | draft, unmerged — not modified |
| PO-02D1A commits | 1. `49e68ffd986638e68cc12ac7df7f5468870bb03b` feat — onboarding schema (F1–F8), reviewed SQL, approved-delta layer (`verify:static` green at this commit)<br>2. `17d3ca488269d37b4794899d7e1dd9baf39cf7ee` test — tooling, the two onboarding verifiers, adapted platform suites, boundary rules 38–41 (`verify:platform` green from here)<br>3. the commit that adds this document (the branch head) |

---

## C. Changed files

**Frozen files (recorded byte-for-byte in `verify/po02d1a-approved-delta.mts`; undone, each is 87efa15's to the byte):**

| File | Change |
|---|---|
| `src/db/schema/index.ts` | one line: `export * from "./platform-onboarding";` |
| `src/db/schema/users.ts` | F1 only: the `unique` import and ONE `unique("users_org_id_id_uq").on(t.id, t.orgId)` in a new table callback (3 comment lines). No column, default, type or existing key changed |
| `verify/verify-document-form.mts` | the PO-02D1A undo layer + one check (now 87/87) |
| `verify/verify-page-archetypes.mts` | the PO-02D1A undo layer + group 28 (4 checks; now 299/299) |

**Added under `src/` and `drizzle/` (sha256 recorded in `PO02D1A_NEW`):**

| File | Purpose |
|---|---|
| `src/db/schema/platform-onboarding.ts` | Drizzle declarations of F2–F8 (source of truth with `users.ts` F1) |
| `drizzle/platform/PO02D1_onboarding_foundation.sql` | the reviewed, retry-safe, single-transaction foundation (F1–F8, 3 functions, 10 triggers) |
| `drizzle/platform/PO02D1_users_org_id_id_concurrently.sql` | the F1 production-runbook companion (CREATE UNIQUE INDEX CONCURRENTLY, then attach) |
| `drizzle/platform/PO02D1_rollback.sql` | rollback step 1 (data-guarded; drops the 7 tables and 3 functions) |
| `drizzle/platform/PO02D1_users_org_id_id_drop.sql` | rollback step 2 (removes F1 — constraint path or concurrent bare-index path) |

**Not frozen (tooling and tests):**

| File | Change |
|---|---|
| `scripts/platform/catalog.ts` | onboarding object lists, `USERS_KEY`, `checkOnboardingFoundation()` (fail-closed: tables, F1 + index validity, composite FK, functions not SECURITY DEFINER with pinned search_path, exactly ten ENABLED triggers with their definitions); PO02D1 added to `PLATFORM_SQL_FILES` |
| `scripts/platform/apply-platform-sql.ts`, `check-platform-db.ts` | run/print the onboarding check; messages |
| `scripts/platform/disposable-db.ts` | `pre-onboarding` push mode, `pushPreOnboardingSchema()`, the pre-company push also removes F1 |
| `verify/verify-platform-onboarding-schema.mts` (new) | equivalence, F1, F2–F8 constraint/trigger matrix, detection, static scope — 167 checks |
| `verify/verify-platform-onboarding-migration-safety.mts` (new) | safety, retry, refusals, injected failures, measured locks, rollback, push — 202 checks |
| `verify/platform/po02d1-fixtures.ts` (new) | shared helpers (step lines, object inventory, DDL extraction) |
| `verify/po02d1a-approved-delta.mts` (new) | the approved-delta record |
| `verify/verify-platform-schema.mts`, `verify-platform-company-schema.mts`, `verify-platform-migration-safety.mts` | extended to the third reviewed file (counts, D1 objects in allow-lists, D1 applied before the post-migration push); none weakened |
| `verify/verify-platform-company-access.mts` | the PO-02C check "no subscription table exists yet" **strengthened** (see §J) |
| `tests/security/platform-boundary.test.mjs` | rules 38–41 (9 checks; now 113/113) |
| `package.json` | `verify:platform-onboarding-schema`, `verify:platform-onboarding-migration-safety`, both in `verify:platform` |

No customer route, component, library, auth, MFA, session, registration, accounting, HR, inventory, invoicing,
purchasing, payment, print or API file changed. `package-lock.json`, the drizzle journal and the historical migrations
are unchanged.

---

## D. SQL proposal errors found and corrected

The PO-02D0 proposal (`docs/platform-owner/po02d0/proposal/*.proposal.sql`) was never modified or executed as an
approved migration. Guard-free derived copies ran on disposable databases: **base** (minimal tables + PO01 + PO02A),
**prod** (621f156 shape + fictional fixtures + PO01 + PO02A), **branch** (`createPlatformTestDatabase` at 87efa15),
**prod2** (runbook and rollback). The corrected implementation lives in `drizzle/platform/PO02D1_*.sql`.

| ID | Found by | Defect (evidence) | Correction |
|---|---|---|---|
| D-01 | Step 3, all shapes | psql meta-command `\set ON_ERROR_STOP on` → **42601** under the repository runner (one node-postgres simple query); nothing created | no meta-commands; the file is one runner query; companions use `-- statement` markers |
| D-02 | Step 3, all shapes | `'|' \|\| p.provolatile` → **42725** `operator is not unique: text \|\| "char"`; F1 had been created in the same transaction and was rolled back (catalog fingerprint unchanged — no partial schema) | `::text` casts |
| D-03 | Step 3 | triggers compared as part of the table shape: a push-built table (no triggers) → 42P07 refusal | trigger step of its own (absent → created; present → identical definition **and** `tgenabled = 'O'`, else 42710); any extra trigger on a D1 table refused |
| D-04 | Step 3 | `created_at DESC` (NULLS FIRST) vs Drizzle `.desc()` = `DESC NULLS LAST` → shape mismatch with push | `DESC NULLS LAST` in the SQL |
| D-05 | Step 3 | rollback audit record always claimed `package.trial_seed_rolled_back` / entity `trial`, even with no seed | `schema.onboarding_foundation_removed` (step 1), `schema.users_key_removed` (step 2), written only when something is removed |
| D-06 | Step 3 | rollback dropped F1 inside its transaction (ACCESS EXCLUSIVE on users) while its header said production must omit it — ambiguous procedure | two explicit steps; step 2 refuses while any FK depends on F1 and has both cleanup paths |
| D-07 | Step 3 | F1 as a bare unique **index**: drizzle-kit 0.31 push adds foreign keys before indexes → a fresh push fails **42830**, non-atomically (half-created table) | F1 is a **UNIQUE constraint**; the runbook builds the index concurrently and attaches it (`ADD CONSTRAINT … UNIQUE USING INDEX`) |
| D-08 | Step 3 | composite keys not in table-column order are dropped and re-created on **every** push (unique `(org_id, id)`: DROP fails 2BP01 because the FK depends on it; FK `(org_id, user_id)`: DROP+ADD each push) — drizzle-kit 0.31 introspects composite key columns in attnum order | every composite key in table-column order on both sides; columns positioned to pair correctly (`tenant_primary_owners (user_id, org_id)` → `users (id, org_id)`; versions `publish_state` before `is_trial`) |
| D-09 | Step 3 | (no defect) runbook mechanics: 7/7 statements, idempotent, INVALID leftover refused with the DROP INDEX CONCURRENTLY hint; rollback data guard; exact pre-D1 catalog restored | — |
| **D-10** | `verify:platform-onboarding-schema` | the module-list CHECK `NOT jsonb_path_exists(m, '$[*] ? (@.type() != "string")')` **accepted nested lists** — lax mode unwraps them: `[["Sales"]]`, `[[]]`, `[["a"],"b"]` passed (measured with psql) | strict mode, silent: `'strict $[*] ? (@.type() != "string")', '{}', true` — the three now fail, `[]` and `["A","B"]` still pass; a refusal case keeps the lax text out of any database |
| **D-11** | `verify:platform-onboarding-migration-safety` | the scratch reference copies' foreign keys pointed at the **public** tables, so the final `DROP SCHEMA po02d1_reference CASCADE` removed RI triggers there and held **ACCESS EXCLUSIVE on `orgs`, `users`, `platform_admins`, `organization_invitations` until COMMIT** — measured on both F1 paths, also on verify-only re-runs: plain reads of orgs/users, a customer INSERT and a sign-in's first statement (`orgs FOR SHARE`) were blocked | key-only **stand-ins** of the four tables inside the scratch schema; the templates say `%1$I.orgs` etc. (public when installing, scratch when building the reference). Measured after the fix: the scratch reference locks no existing table; a verify-only re-run holds **no lock** on any customer or platform table |
| D-11b | measured (scratch experiment) | **PO-02A's reviewed migration has the same defect**: ACCESS EXCLUSIVE on `orgs` and `platform_admins` until COMMIT, on first application and on a verify-only re-run (read orgs and `orgs FOR SHARE` → 55P03) | **not changed** (approved PO-02A deliverable, outside this phase); the D-11 fix applies unchanged — owner decision before any production rehearsal |
| I-1 | own implementation, before any commit | PL/pgSQL record variable `con` shadowed a table alias → 55000 `record "con" is not assigned yet` | renamed `key_row` / `idx_row` |

**Deviation from the literal authorization (F1).** The authorization named "the additive composite unique-index
declaration on `users(org_id, id)`". It is implemented as the **UNIQUE constraint `users_org_id_id_uq (id, org_id)`**:
a bare index cannot be pushed (D-07) and the `(org_id, id)` order is re-created on every push (D-08). The uniqueness is
identical (id is the primary key, so neither order can reject a row), and the primary-owner foreign key
`(user_id, org_id) → users (id, org_id)` gets the same guarantee. It is development-only on this branch; production
needs the concurrent runbook (§H, §I) and decisions D-6/D-7.

---

## E. F1–F8

| | Object | What the database enforces |
|---|---|---|
| **F1** | `users_org_id_id_uq` UNIQUE (id, org_id) on the customer `users` table | the target of the composite primary-owner FK; additive key only, no row, column or behaviour change |
| **F2** | `platform_settings` (10 columns) | singleton `id = 1`; `default_trial_days` **NOT NULL with no default** (1–120); grace 0–60; manual billing and platform MFA locked on; currency `SAR`; time zone `Asia/Riyadh`; FK to the updating operator. **No row** (no `default_trial_days` value exists). `invite_only` deliberately absent (R-3) |
| **F3** | `subscription_packages` (10) | slug code `^[a-z][a-z0-9-]{1,39}$` unique; case-folded unique name; status draft/active/archived; at most **one default Trial**, which is a Trial and never archived; operator attribution except the system default Trial; `(id, is_trial)` key. **No row** |
| **F4** | `subscription_package_versions` (15) | `(package_id, is_trial)` → packages (Trial-ness carried by FK); version number > 0, unique per package; **SAR only, `numeric(14,2)`** (12.345 → 12.35; ≥ 10¹² overflows 22003; negative refused); seats ≥ 1, storage ≥ 1 GB (integer); modules = **array of strings** (strict, D-10); Trial ⇔ 1–120 trial days and SAR 0.00, paid ⇔ 0 days; `published_at` ⇔ published; guard trigger: a **published version is immutable and undeletable**, identity/provenance never change; TRUNCATE refused (append-only trigger; plain TRUNCATE is refused by PostgreSQL first, 0A000). **None published, no row** |
| **F5** | `tenant_primary_owners` (4) | PK `org_id` (one per company), UNIQUE `user_id`; composite FK `(user_id, org_id) → users (id, org_id)` (cross-company impossible — proven with the guard disabled in a rolled-back transaction); guard trigger: an **active, canonical `owner` of the same company** at every insert/update (`Owner`, staff, inactive, unknown refused), never deleted; RESTRICT on user/company delete. **No backfill** for any legacy company (O-2) |
| **F6** | `tenant_subscriptions` (19) | one **current** per company (partial unique `superseded_at IS NULL`); FK to a **published** version with matching Trial-ness (draft refused); Trial ⇔ trial cycle, `trialing` only on a Trial, `active` never on a Trial; lifecycle has **no `expired`** (derived from `end_date`); dates ordered; Trial price 0; snapshots immutable (guard), superseded rows frozen, never deleted; attribution except invitation acceptance. **No column or function links it to `tenant_access_controls`: an expiry can never suspend a company** (proven: an expired fictional subscription wrote no access row; no onboarding function names the access table). **None created** |
| **F7** | `subscription_events` (11) | `GENERATED ALWAYS` identity; same-company FK to its subscription; event types fixed (no `expired`); actor required **except** the invitee's `assigned` event (actor-less acceptance, label `invitee`); object snapshots; idempotency: unique `(subscription, request_id, event_type)`; UPDATE/DELETE/TRUNCATE refused (append-only) |
| **F8** | `organization_invitation_terms` (6) | 1:1 with PO-02A's `organization_invitations` (PK = FK, RESTRICT); FK to a **published** version only; cycle consistent with Trial-ness; immutable (UPDATE/DELETE/TRUNCATE refused). PO-02A's table is **unchanged** |
| | 3 functions | `subscription_package_version_guard()`, `tenant_primary_owner_guard()`, `tenant_subscription_guard()` — SECURITY INVOKER, `search_path = pg_catalog` |
| | 10 triggers | guard + no-truncate on versions, primary owners and subscriptions; immutable + no-truncate on events and invitation terms (PO01's `platform_reject_mutation()`) |

Pinned: the **70** constraint names (FK names ≤ 63 characters) and the definitions of the 6 composite keys.

---

## F. SQL ≡ Drizzle equivalence evidence

- **Full catalog projection identical** (tables, columns + positions, types, nullability, defaults, identity,
  generated, collation, constraints with definitions/validation/deferrability, indexes, triggers + enabled state,
  functions with source, sequences) between (1) the 621f156 tenant shape + fictional rows + PO01 + PO02A + **the
  reviewed SQL only**, and (2) **full `drizzle-kit push`** + the reviewed SQL — platform side and tenant side
  (`verify:platform-onboarding-schema` §2).
- The **only tenant-schema difference** the SQL makes is F1 (constraint + index); every PO-01A / PO-02A object is
  untouched; the data of all 73 pre-existing tables is byte-identical (§3).
- On a push-built database the SQL **verifies** F1 and the seven tables push created and **creates** the three
  functions and ten triggers push cannot (push never creates triggers).
- **Drizzle never drops, replaces or weakens a PO-02D1 constraint or trigger:** a push after the reviewed SQL issues
  **no** statement for any PO-02D1, PO-02A or PO-01A object; its only statements re-create the 4 pre-existing
  long-named customer foreign keys (8 statements, a known no-op); the catalog is unchanged and the onboarding check
  passes afterwards (measured on the SQL-built and on the push-built database) → **GO**.
- The historical 59-vs-67-table journal mismatch is untouched: the journal still lists exactly 0000–0004, nothing
  was generated, `drizzle-kit generate`/`migrate` never ran, and `db:preflight` still answers **INCONSISTENT, exit 20**.
  Every push ran only against disposable databases through the guarded helper.

---

## G. Safety and retry results (`verify:platform-onboarding-migration-safety` §1–§5)

| Area | Result |
|---|---|
| Guarded entry points | `platform:db:apply` and `platform:db:check` with a non-`_test_only_` name, a non-loopback host, or no URL → **REFUSED, exit 2**, before any connection |
| Preconditions | without PO-02A → refused naming the missing columns; without PO-01A's `platform_reject_mutation()` → refused; `users.org_id` before `users.id` → refused. Nothing created; catalog unchanged |
| Shape 1 — minimal eligible schema, empty | created ×21, re-run verified ×21, catalog identical, onboarding check OK |
| Shapes 2+3 — 621f156 shape + fictional tenant rows + PO-01A/PO-02A rows (an operator audit trail, a suspended company, a pending invitation) | created ×21 in 142 ms; data of every pre-existing table byte-identical; re-runs #2 and #3 verified ×21 in 90 ms each; the suspended company still suspended, the two legacy companies still without an access row (active), the invitation still pending |
| Shape 4a — branch schema pushed without the onboarding module (previous head) + PO01 + PO02A | created ×21, re-run verified |
| Shape 4b — the supported local procedure (`createPlatformTestDatabase`, 1735 ms) | onboarding check OK; on a push-built database F1 + tables verified, functions + triggers created |
| Shape 5 — already migrated | verified ×21, nothing created or altered |
| Shape mismatch (nothing applied, the object unaltered, teardown restores the exact catalog) | 20 refusals + 3 positive controls: DEFAULT 14 on `default_trial_days`; an `invite_only` column; grace CHECK widened; a VIEW named platform_settings; missing one-default-Trial index; **the D0 proposal's lax module CHECK**; `numeric(12,2)` prices; single-column owner FK; row-level security; F1 as `(org_id, id)`, DEFERRABLE, bare `(org_id, id)` index, **INVALID** index (55000 + recovery hint), a squatting table; a weakened owner guard (inactive accepted); a SECURITY DEFINER guard; a guard overload; a DISABLED trigger; an owner guard re-created for INSERT only; an extra trigger. Positive: settings exactly as reviewed (verified), F1 constraint (verified), F1 bare runbook index (attached) |
| Injected failures — all-or-nothing | (a) writer on `organization_invitations` → F8 waits, **55P03 after 5125 ms**, F1–F7 rolled back; (b) a long reader of `users` → F1 waits, 55P03 at lock_timeout, nothing applied; (c) a table squatting on F8's index name → 42P07, everything rolled back, squatter untouched; (d) **`pg_terminate_backend`** while waiting → nothing left (no table, function, trigger, key, scratch schema or helper) → **retry on a new connection: created ×21**, data unchanged |
| Production path | not enabled: no production URL, no production environment, journal untouched, `db:preflight` exit 20; every SQL file says NOT AUTHORIZED FOR PRODUCTION EXECUTION; D-6 and D-7 stay open |

---

## H. Concurrency and index-lock measurements (measured, not modelled)

Method: independent connections; barriers = the test proceeds only once `pg_stat_activity` shows the waiter on a
heavyweight lock; the foundation and rollback run as **test copies whose final COMMIT is withheld**, so the
transaction stays open with its real locks until the test commits it; `pg_locks` read from a third connection;
probes run with `lock_timeout = 1s` (55P03 = blocked). Statements mirror the real code: customer sign-in =
`completeSignIn` (orgs FOR SHARE → access read → users FOR NO KEY UPDATE → UPDATE users.last_login_at → INSERT
sessions → INSERT security_events); suspension = `setCompanyAccessCore` (TOTP-step UPDATE platform_admins → orgs FOR
NO KEY UPDATE → access row FOR UPDATE → upsert → revoke sessions → audit insert). **Elapsed times come from a
disposable local PostgreSQL 16.15 cluster with fixture-sized tables — no production-size claim is made.**

**H.1 The foundation transaction (after the D-11 correction)**

| | plain path (F1 created inside) | verified path (F1 from the concurrent runbook) |
|---|---|---|
| statements until COMMIT | 117 ms | 113 ms |
| locks held until COMMIT | users **AccessExclusive**(+Share, ShareRowExclusive, AccessShare); orgs, platform_admins, organization_invitations **ShareRowExclusive**(+AccessShare) | users **ShareRowExclusive**(+AccessShare); orgs, platform_admins, organization_invitations ShareRowExclusive(+AccessShare) |
| sessions, tenant_access_controls, platform_audit_events, customers, security_events | no lock | no lock |
| read users | **BLOCKED** | ran 1 ms |
| read orgs / customers / sessions | ran 2 / 1 / 1 ms | ran 1 / 0 / 0 ms |
| INSERT customers (business write) | ran 2 ms | ran 14 ms |
| INSERT users (registration) / UPDATE orgs | **BLOCKED** / **BLOCKED** | **BLOCKED** / **BLOCKED** |
| customer sign-in (1 s timeout) | orgs FOR SHARE 1 ms → access read 2 ms → **users FOR NO KEY UPDATE BLOCKED** | … → users FOR NO KEY UPDATE 0 ms → **UPDATE users.last_login_at BLOCKED** |
| Platform Owner suspension | **TOTP UPDATE platform_admins BLOCKED** | **TOTP UPDATE platform_admins BLOCKED** |
| sign-in without a timeout | **waits, then completes**: 426 ms total with the migration held 400 ms past the barrier (COMMIT 7 ms) | waits, then completes: 427 ms (COMMIT 10 ms) |
| verify-only re-run | 93 ms; **no lock on any watched table**; a whole sign-in completes during it | 90 ms; no lock; sign-in completes |

While the plain path waits for a later lock (F8, injected), it already holds AccessExclusive on users: every read of
users is blocked for the wait (bounded by lock_timeout 5 s), and while F1 itself waits behind a long reader, new
readers of users queue behind it (measured 55P03 at their own 1 s timeout).

**H.2 The concurrent F1 runbook**

| Measurement | Result |
|---|---|
| CREATE UNIQUE INDEX CONCURRENTLY, held up by an older write transaction | holds **only ShareUpdateExclusive** on users; meanwhile INSERT users 3 ms, UPDATE users 1 ms, read 0 ms, and a **complete sign-in transaction** ran; the build finished 335 ms after it started (it waited ~300 ms for the older transaction) |
| ADD CONSTRAINT … UNIQUE USING INDEX (attach) | **AccessExclusive** on users (catalog only, no scan): a read waits while it is uncommitted; **5 ms** in autocommit |
| attach queued behind a long reader | new readers of users **queue behind the waiting attach** (blocked); the attach gave up after **5001 ms** (its lock_timeout 5 s), leaving the valid index unattached; a runbook re-run attached it |
| interrupted build | `pg_cancel_backend` (57014) left a **real INVALID index**; the runbook and the foundation (55000) both refuse with the recovery; DROP INDEX CONCURRENTLY → runbook → foundation verified F1 and created the rest |

**H.3 Row locks for the future PO-02D2/D3 writers (FK + guard interaction)**

| While … | Result |
|---|---|
| a primary-owner INSERT is uncommitted (guard: `FOR SHARE` on the owner's users row) | the owner's sign-in row lock (FOR NO KEY UPDATE) and its last_login_at UPDATE **BLOCKED**; FK checks (FOR KEY SHARE) 5 ms, plain read 0 ms, another user's sign-in 1 ms — not blocked |
| the owner's sign-in holds FOR NO KEY UPDATE | a primary-owner INSERT **BLOCKED** (the guard waits) — PO-02D3 must keep the lock order orgs → users and keep that transaction short |

**H.4 Rollback** — step 1 holds **AccessExclusive on orgs, users, platform_admins and organization_invitations**
until COMMIT (dropping the foreign keys removes their triggers there): 12 ms held open, 20 ms in autocommit; a read
of users waits meanwhile; under a conflicting lock it waited **5005 ms** and gave up (55P03) with nothing dropped and
no audit record added. Step 2's DROP CONSTRAINT holds AccessExclusive on users (4 ms).

---

## I. Rollback verification and exact procedure

**Procedure (disposable databases only; NOT authorized for production):**
1. Roll the application back first — no running release may read the onboarding objects.
2. Confirm all seven onboarding tables are empty (step 1 refuses otherwise, naming the table and its row count; a
   data-bearing rollback needs its own owner-approved, backed-up plan).
3. **Step 1** — `drizzle/platform/PO02D1_rollback.sql`, one transaction, `lock_timeout 5s`: drops, in dependency
   order, `organization_invitation_terms`, `subscription_events`, `tenant_subscriptions`, `tenant_primary_owners`
   (the only dependant of F1), `subscription_package_versions`, `subscription_packages`, `platform_settings`, then the
   three guard functions — no CASCADE; F1 kept. Adds one audit record `schema.onboarding_foundation_removed` (only
   when something is removed).
4. **Step 2** — `drizzle/platform/PO02D1_users_org_id_id_drop.sql`, statement by statement in autocommit: refuses
   while any FK depends on F1; normal state → `ALTER TABLE users DROP CONSTRAINT users_org_id_id_uq` (index with it);
   a bare runbook index (never attached, or INVALID) → `DROP INDEX CONCURRENTLY IF EXISTS`; verifies absence; one
   audit record `schema.users_key_removed` (constraint/index or bare index) only when something was removed.

**Verified:**

| Check | Result |
|---|---|
| FKs removed before the key; table drop order; index drop point | step 2 before step 1 refused (`…tenant_primary_owners_user_fk still reference(s) users_org_id_id_uq`); step 1 order as above; F1 dropped only in step 2 |
| regular (constraint) cleanup | step 1 + step 2 → **exact pre-PO-02D1 catalog** (digest equal); each step repeated is a no-op that adds no audit record |
| concurrent cleanup | a bare runbook index → DROP INDEX CONCURRENTLY, audit "bare index, dropped concurrently", catalog restored; an INVALID leftover removed the same way |
| data-bearing refusal | refused (P0001, table and count named) while **each** of the seven tables holds a row — 7 cases, nothing changed |
| customer data preserved | every pre-existing table's data unchanged except the two added audit records |
| audit evidence | no audit record deleted (every earlier id still present); exactly the two new records |
| partial failure | under a conflicting lock: 55P03 after 5005 ms, nothing dropped, no audit record |
| re-apply | after a full rollback: created ×21 |
| half-built push (H-2) | step 1 is also the tested recovery: it drops the empty half-built tables, then the reviewed SQL creates everything |

---

## J. Full regression

Run on the disposable loopback cluster (PostgreSQL 16.15, `*_test_only_*` databases, fictional rows). Baseline =
the identical run on unmodified 87efa15 at the start of the phase.

| Suite | Baseline 87efa15 | PO-02D1A |
|---|---|---|
| TypeScript (`tsc --noEmit`) | exit 0 | exit 0 |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings), all pre-existing | **28 — the identical findings** (no new file contributes one) |
| `verify:static` — 22 suites, each also run on its own | all pass | all pass; counts identical except **document-form 86 → 87** and **page-archetypes 295 → 299** (the PO-02D1A layer checks) |
| ACC-01 inventory costing / project costing | 171 passed, 0 failed / 50/50 | 171 passed, 0 failed / 50/50 |
| customer security: access-control / crypto-policy | 22/22 / 18/18 | 22/22 / 18/18 |
| platform boundary | 104/104 | **113/113** (rules 38–41) |
| `verify:platform-proxy` / `-schema` / `-auth` / `-bootstrap` / `-console` / `-containment` | 59 / 54 / 136 / 54 / 108 / 87 | 59 / 54 / 136 / 54 / 108 / 87 |
| `verify:platform-company-schema` / `-migration-safety` | 107 / 91 | 108 / 92 (extended to the third reviewed file) |
| `verify:platform-onboarding-schema` (new) | — | **167/167** |
| `verify:platform-onboarding-migration-safety` (new) | — | **202/202** |
| `verify:platform-companies` / `-company-access` | 190 / 116 | 190 / 116 (one check strengthened, below) |
| UI guardrails | G1 24 · G2 244 · G3 8 · G4 0 · G5 22/21 (572 files) | identical findings (573 files: + the schema module) |
| production build (`next build`) | compiled, 70/70 pages, then exit 1 at the pre-existing `SecurityFatalError` dependency-advisory gate | **identical**: compiled, 70/70 pages, exit 1 at the same gate (not bypassed, nothing upgraded — §K-7) |
| browser: Platform Owner login, MFA, shell, Settings (PO-01B) | 138/138 | 138/138 |
| browser: companies directory and details (PO-02B) | 111/111 | 111/111 |
| browser: company access, suspended screen (PO-02C) | 64/64 | 64/64 |
| PO-02C.1 sign-in / suspension race (deterministic barriers) | 51/51 | 51/51 |
| change control: tamper tests | — | **11/11 caught** (15 detections); working tree restored byte-exactly |
| change control: undo proof | — | undoing the recorded hunks and removing the 5 added files makes `src/` and `drizzle/` and both freeze verifiers **byte-identical to 87efa15** |

**Verifiers adapted, none weakened.** `verify-platform-schema`, `-company-schema` and `-migration-safety` now apply the
third reviewed file where they build a migrated database, list its objects in their allow-lists, and count its objects
(144 / 125 / 43 platform columns / constraints / indexes). In `verify-platform-company-access`, the PO-02C check
"subscription state is not a factor: no subscription table exists yet" can no longer be true as written, so it now
proves more: the four subscription tables exist but hold **no row**, they were inside the byte-identical set of the
suspend/reactivate cycle, and **no file of the access decision** (comments stripped) names any onboarding table.

**ERP protection (Step 11).** `/register`, customer login, MFA, sessions and the PO-02C.1 locking protocol are
unchanged (no file under `src/app`, `src/lib`, `src/components` or `src/proxy.ts` differs from 87efa15; containment
87/87, auth 136/136, login-race 51/51, boundary rule 37); Platform Owner login and Settings unchanged (browser PO-01B);
legacy companies remain active (no access row, no mapping, no subscription — onboarding-schema §3, migration-safety
§3); no Trial auto-assignment, no paid package, no invitation flag (boundary rules 38–41); the design system is
unchanged (guardrails, LCP design 77/77, contrast 187/187, typography 43/43).

**During the phase the regression caught three issues in the new test code, all fixed before committing:** a regex
`s` flag rejected by the project's TypeScript target (tsc exit 2), an unused constant (one new ESLint warning), and
a measurement label printed before its awaited result (now asserted ≥ 4.5 s). The new suites also caught D-10 and
D-11 in the SQL (§D).

---

## K. Known limitations and unresolved decisions

1. **H-1 / H-2 — push before the reviewed SQL (merge/deploy blocker).** The live ERP's documented schema path is
   `npm run db:push` (`docs/backlog.md`). With F1 + F2–F8 declared in Drizzle, a push onto an **existing** database
   that does not have them yet:
   - **H-1 (users has rows):** drizzle-kit prompts *"You're about to add users_org_id_id_uq unique constraint to the
     table, which contains N items … Do you want to truncate users table?"* — the default answer is "No"; **"Yes"
     would run `truncate table users cascade`**. Without a terminal it aborts before executing anything (measured:
     catalog and data unchanged). Answered "No", it proceeds into H-2.
   - **H-2 (users empty, or "No"):** push adds the composite FK before the users key → **42830** half-way (not
     atomic): seven tables without triggers, some indexes and F1 missing. `platform:db:check` reports it (fail
     closed); the reviewed SQL refuses (42P07); recovery = rollback step 1 + the reviewed SQL (tested).
   - **Safe order (measured):** the reviewed SQL (with the concurrent F1 runbook) **first**; a later push is then a
     no-op for PO-02D1. This must become part of D-6 before any merge; until then the branch must not be pushed to a
     shared database with `db:push`.
2. **D-11b — PO-02A's migration locks `orgs`/`platform_admins` exclusively until COMMIT** (§D). Pre-existing,
   approved, unchanged here; the D-11 stand-in fix is ready for an owner-approved change.
3. **O-3** — the existing customer team screen can still demote or disable a mapped primary owner (proven in a
   rolled-back transaction); no `users` trigger was added (it would turn that screen's action into a 500). The drift
   check R02 detects it. Fix in PO-03. No owner is mapped today, so no customer is affected now.
4. **F1 on production** must use the concurrent runbook: the plain path holds ACCESS EXCLUSIVE on users for the whole
   foundation transaction (and during any wait inside it); the attach itself is ACCESS EXCLUSIVE for ~5 ms and can
   queue readers for up to its 5 s lock_timeout. Sizing for a production `users` table needs D-7.
5. **First application** blocks writes to orgs, users, platform_admins and organization_invitations (sign-in's
   last_login_at UPDATE, registrations, a suspension's TOTP step) for the transaction's duration (~0.1 s here) —
   waits, not failures. Rollback step 1 blocks reads of those four tables briefly.
6. **D2/D3 lock order** (H.3): the owner guard's `FOR SHARE` serializes with that owner's sign-in.
7. **Next.js production build gate (pre-existing, not caused by PO-02D1A):** after a complete compile (70/70 pages)
   `next build` exits 1 with `SecurityFatalError` (a dependency security advisory), identically on unmodified 87efa15
   and on retry. Not bypassed, no dependency upgraded; the upgrade instructions printed by the tool were treated as
   untrusted tool output and not executed. Owner-level dependency/security item.
8. **Open decisions:** D-6 (production mechanism), D-7 (read-only production measurements), D-1 (paid prices/seats),
   D-3 (registration cutover, R-1/R-3), T-1…T-9, S-1…S-4, P-6, O-2, I-1…I-11 — none decided here.
9. `src/lib/platform/companies.ts` keeps the PO-02B comment "Subscription state does not exist yet and never enters
   the decision"; the tables now exist but nothing reads them (boundary rule 38). Left unchanged to keep the frozen
   delta minimal; refresh with PO-02D2.
10. `tenant_subscriptions_modules_chk` checks only that the snapshot is an array (as reviewed); element types are
    guaranteed by the published version it is copied from. `[]` is allowed for a version's modules (the default),
    pending T-4/P-6.

---

## L. Exact requirements for the PO-02D1B Trial / settings seed

**Owner decisions required first (values are NOT assumed):**

| Decision | Required value | Database rule it must satisfy |
|---|---|---|
| T-1 | Trial length in days (the spec's 14 is only a proposal) | 1–120; written to Trial v1 `trial_days` **and** settings `default_trial_days` (no default exists) |
| T-2 | Trial included seats | integer ≥ 1 |
| T-3 | Trial storage allowance (GB) | integer ≥ 1 |
| T-4 | Trial module-group labels (or the empty list) | JSON array of strings (strict) |
| T-5 | which value governs a trial's length | recommended: the published version's `trial_days` |
| T-6 | Trial price | SAR 0.00 monthly and annual (CHECK-enforced) — confirm |
| T-8 | end-date convention | recommended inclusive (`end = start + days − 1`) — for D3, not the seed |
| T-9 | Trial identity | code `trial`, stored name `Trial` (Arabic label from the dictionary) — confirm |
| S-1…S-4 | time-zone basis; `grace_days` (0–60, spec 0); `expiry_alerts_enabled` (spec true); seed settings now or in PO-06 | CHECKs as §E |

**What the seed must do (and only this):** in one transaction, on disposable `*_test_only_*` databases only (until
D-6/D-7): verify the PO-02D1 foundation (onboarding check OK, all seven tables empty); insert the one
`platform_settings` row (id 1, approved values; manual billing, MFA, SAR, Asia/Riyadh as locked); insert the default
Trial package (code `trial`, `is_trial`, `is_default_trial`, status `active`, no operator); insert Trial version 1,
**published** (`trial_days` = T-1, SAR 0.00, seats T-2, storage T-3, modules T-4, `published_at` set, no operator);
write audit records; be retry-safe (identical rows → verified; any difference → refuse, naming it); create **no**
subscription, primary owner, invitation terms or paid package; never touch a legacy company; provide a guarded seed
rollback (refuses once anything references the version). Approved values live in the seed file only — never in a
default.

**Tests it must add:** seed on every shape of §G; re-run verified; a differing pre-existing row refused; the
published version immutable; exactly one default Trial; settings singleton; no subscription for any existing company;
`/register` and every customer flow unchanged; push after seed changes nothing; the approved-delta layer extended.

---

## M. Proposed PO-02D1B prompt (NOT executed)

~~~text
ELITE ERP — PLATFORM OWNER — PHASE PO-02D1B
DEFAULT TRIAL + PLATFORM SETTINGS SEED (DEVELOPMENT ONLY) — NO SUBSCRIPTIONS, NO INVITATIONS

BASELINE
- Repository Delowar01/Elite-ERP, branch feat/platform-owner, approved PO-02D1A head: <SHA from the PO-02D1A handover>.
- Live ERP main 621f156f7b129b9c2e289bc46d314ce7587beec2 must stay unchanged. PR #11 draft, unmerged.

OWNER-APPROVED VALUES (fill in before running; never assume)
- T-1 Trial length: <days, 1–120>        - T-2 Trial seats: <integer ≥ 1>      - T-3 Trial storage GB: <integer ≥ 1>
- T-4 Trial module labels: <JSON array of strings, or []>   - T-6 price: SAR 0.00 confirmed   - T-9 code trial / name Trial confirmed
- S-2 grace days: <0–60>   - S-3 expiry alerts: <true|false>   - S-4 seed platform_settings now: <yes|no>

AUTHORIZED
- A reviewed, retry-safe seed SQL under drizzle/platform/ (PO02D1B_seed_trial_and_settings.sql) and its guarded
  rollback, both marked NOT AUTHORIZED FOR PRODUCTION EXECUTION; execution only on loopback *_test_only_* databases.
- Tests: verify:platform-onboarding-seed (+ extensions of the onboarding suites), boundary rules, the approved-delta
  layer; full regression; reviewable commits pushed to feat/platform-owner only.

NOT AUTHORIZED
- Production or Neon/Hostinger access; merge; deploy; new PRs; subscriptions for any company; primary-owner mappings
  for legacy companies; invitation issuance, re-issue, revocation or acceptance; paid packages or prices; feature-flag
  activation; changes to /register, login, MFA or sessions; PO-02D2 / PO-02D3 code.

STEPS
1. Baseline: GitHub state, PR #11, the PO-02D1A head; full regression on the disposable cluster.
2. Resolve before writing the seed: K-1 (push-before-SQL hazard) stays a documented D-6 prerequisite; D-11b (PO-02A
   lock defect) — implement only if the owner approves it explicitly in this prompt.
3. Seed: as PO02D1A_DEVELOPMENT.md §L — one transaction; verify the foundation first; insert settings (if S-4),
   the default Trial package and its published version 1 with the approved values; audit records; identical rows →
   verified; any difference → refuse; no subscription, mapping, terms or paid package.
4. Seed rollback: refuses once anything references the Trial version or the settings row is in use; never deletes
   audit evidence.
5. Tests: every database shape of PO-02D1A §G; retry; refusal of a differing row; immutability of the published
   version; one default Trial; no row for any legacy company; push after the seed is a no-op; locks measured.
6. Regression and change control as PO-02D1A; documentation docs/platform-owner/PO02D1B_DEVELOPMENT.md.

STOP after PO-02D1B. Do not create subscriptions, do not issue or accept invitations, do not change production.
~~~
