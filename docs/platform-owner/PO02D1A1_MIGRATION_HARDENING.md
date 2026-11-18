# Platform Owner — PO-02D1A.1: migration lock-safety correction and release guards

> Phase PO-02D1A.1 of the Elite ERP Platform Owner programme. **Development only.** It corrects the confirmed lock
> defect in the reviewed PO-02A SQL (D-11b), proves the corrected file builds the identical schema, and adds a strict,
> read-only, fail-closed release preflight for the push-before-SQL hazards (H-1 / H-2). No Trial, setting, package,
> subscription, primary owner or invitation was created; no feature flag, tenant-access enforcement or customer code was
> changed. Nothing ran against production: every database was a loopback, disposable `*_test_only_*` database holding
> fictional rows only, and every one was dropped. Decisions D-6 and D-7 remain open; `db:push` is unchanged.

---

## A. Completion status

| Step | Status |
|---|---|
| 1 — Baseline | done — `main` = `621f156` (live), `feat/platform-owner` = `43b0611`, PR #11 open, **draft, unmerged**, untouched; PO-02A and PO-02D1A SQL byte-identical to the approved files; full baseline regression green (§H) except the pre-existing Next.js advisory gate (§K) |
| 2 — Reproduce D-11b on the exact approved SQL | done — measured with independent connections and lock barriers (§C, §D) |
| 3 — Correct the PO-02A reference design | done — key-only stand-ins + schema-neutral constraint comparison; **catalog equivalence proven on three shapes** (§E) |
| 4 — Locking acceptance | done — `verify:platform-company-migration-locks` **83/83** (§D) |
| 5 — Revalidate PO-02D1A | done — PO-01A → corrected PO-02A → PO-02D1A, all onboarding suites unchanged and green (§H); **PO-02D1A SQL not modified** (no new defect in it) |
| 6 — H-1/H-2 safety gate | done — `npm run platform:db:preflight` (read-only, fail closed, exits 0 / 3 / 2 / 1); `db:push` **not** changed (§F.7 documents the change, its effects and the approval gate) |
| 7 — Prove the dangerous order | done — `verify:platform-release-preflight` **59/59**: every unsafe order refused before push runs; recovery proven (§F) |
| 8 — Approved-delta protection | done — `verify/po02d1a1-approved-delta.mts` pins all 21 hunks; undo reproduces 43b0611 byte for byte; 8 tamper tests, all caught (§G, §H) |
| 9 — Full regression | done (§H, §I); build **compiles** completely but stops at the pre-existing dependency-advisory gate (§K) |
| 10 — This document | done |
| **STOP gate** | **STOPPED.** Pushed to `feat/platform-owner` only. No merge, deploy, production migration, tenant-access enforcement, Trial seed, subscription or invitation |

**Findings for owner attention:**
1. **D-11b is fixed on the branch** (an approved-delta layer over the approved PO-02A SQL). A verify-only re-run of the
   corrected file no longer blocks any customer sign-in, read or write, nor any Platform Owner sign-in; first
   installation takes only the genuine foreign-key and index-build locks, never ACCESS EXCLUSIVE (§D).
2. **New, measured: H-3 — an interrupted `drizzle-kit push` silently drops four customer foreign keys.** push is not
   transactional and re-creates four long-named customer foreign keys on every run by dropping them first (statements
   8–11 of the 41-statement plan) and re-adding them at the end (37–40). When push fails in between — the H-2 failure
   (42830 at statement 22), or a lock timeout / validation error in an otherwise harmless push — those four tables are
   left **without referential integrity**. PO-02D1A's recovery (rollback step 1 + reviewed SQL) did not restore them.
   The preflight now names them (O-06) and the full recovery is tested (§F.4–§F.6).
3. **H-1/H-2 remain real** (reproduced); the preflight refuses them before any modifying command, but only if it is
   run. Gating `db:push` itself is an owner decision (§F.7).
4. **Next.js 16.4.3 advisory gate (pre-existing release blocker)** — unchanged, not bypassed, nothing upgraded (§K).

---

## B. Branch and commits

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (reviewed PO-02D1A head) | `43b0611f7b9162cf0ca820fab9ace4b17504d2ca` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | open, draft, unmerged — not modified |
| PO-02D1A.1 commits | 1. **fix** — PO-02A lock-safety correction + approved-delta layer (`verify:static` green at this commit)<br>2. **test** — lock acceptance suite, release preflight and its suite, boundary rule 42 (`verify:platform` green from here)<br>3. **docs** — this document (the branch head; exact SHAs in the handover report) |

---

## C. D-11b — root cause

PO-02A's retry-safe design builds every object first into a private scratch schema (`po02a_reference`) and compares
its catalog shape with the public one. The approved file built that reference **from the same DDL text**, whose five
foreign keys said `REFERENCES public.orgs (id)` / `REFERENCES public.platform_admins (id)`:

1. **Building the reference** created five foreign keys **into the live tables**. Creating a foreign key takes SHARE ROW
   EXCLUSIVE on the referenced table and installs referential-integrity triggers on it — so even a verify-only re-run,
   which creates nothing in public, held SHARE ROW EXCLUSIVE on `orgs` and `platform_admins` (every write waits).
2. **Dropping the reference** — `DROP SCHEMA po02a_reference CASCADE` before COMMIT — removes those foreign keys, i.e.
   removes their triggers **from `orgs` and `platform_admins`**, which takes **ACCESS EXCLUSIVE** on both until COMMIT:
   every read of `orgs` (each customer sign-in, every tenant page header, every business insert's FK check) and every
   read of `platform_admins` (each Platform Owner sign-in) waits.

Attribution was measured, not assumed: the same file cut just before its cleanup holds SHARE ROW EXCLUSIVE but no
ACCESS EXCLUSIVE (§D row 2). PO-02D1A had found and fixed the identical defect in its own SQL (D-11) but did not
change PO-02A's approved file.

**The correction (8 hunks, `drizzle/platform/PO02A_company_foundation.sql`):**
- two key-only stand-ins, created right after `CREATE SCHEMA po02a_reference`:
  `po02a_reference.orgs (id integer, PRIMARY KEY)` and `po02a_reference.platform_admins (id uuid, PRIMARY KEY)`;
- the five template foreign keys name `%1$I.orgs` / `%1$I.platform_admins`: formatted with `po02a_reference` they
  point at the stand-ins; formatted with `public` they are the reviewed DDL **to the character**;
- the shape comparison prints constraint definitions without their schema prefix
  (`replace(pg_get_constraintdef(con.oid, true), p_schema || '.', '')`, as PO-02D1's already did), because a reference
  key prints `REFERENCES po02a_reference.orgs(id)` while the public key prints `REFERENCES orgs(id)`;
- header comments (the locking section now states the measured behaviour).

No column, default, CHECK, index, constraint name, ON DELETE rule, precondition, step line or business rule changed
(page-archetypes group 29 pins the executable lines; §E proves the result).

---

## D. Original versus corrected lock measurements

Method (`verify:platform-company-migration-locks`, `verify/platform/lock-probes.ts`): the migration runs on its own
connection with its final COMMIT withheld, so its real locks stay held; each probe runs on another connection
**without** a lock timeout; the barrier is `pg_stat_activity.wait_event_type = 'Lock'`; then the exact blocking
backends (`pg_blocking_pids`) and the ungranted `pg_locks` row are recorded and the probe is cancelled. Every probe
transaction is rolled back. The probes mirror the real code paths: customer sign-in with tenant-access enforcement
off (live default) and on, Platform Owner sign-in (admin read, TOTP-step update, session, last login, audit, attempt),
customer self-registration, and ordinary reads and writes. Statement times are from a local cluster.

| Scenario | Locks held until COMMIT (watched tables) | Customer reads (`orgs`) | Business INSERT (FK check) | Customer sign-in | Platform Owner sign-in | Registration |
|---|---|---|---|---|---|---|
| **Approved**, verify-only re-run | `orgs`, `platform_admins`: **ACCESS EXCLUSIVE** + SHARE ROW EXCLUSIVE + ACCESS SHARE | **BLOCKED** (waits for ACCESS SHARE) | **BLOCKED** | **BLOCKED** (off: at INSERT security_events; on: at its first statement) | **BLOCKED** at its first read | **BLOCKED** at INSERT orgs |
| Approved re-run, stopped before cleanup (attribution) | SHARE ROW EXCLUSIVE on both, no ACCESS EXCLUSIVE | run | run | completes | blocked at the TOTP-step UPDATE | blocked at INSERT orgs |
| **Approved**, first application (production order) | ACCESS EXCLUSIVE on both + SHARE on `platform_audit_events` | **BLOCKED** | **BLOCKED** | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| **Corrected**, verify-only re-run | only ACCESS SHARE on `sessions` and `platform_audit_events` | run | run | completes (off and on) | completes | completes |
| **Corrected**, first application (production order) | SHARE ROW EXCLUSIVE on `orgs`, `platform_admins`; SHARE on `platform_audit_events`; **never ACCESS EXCLUSIVE**; the cleanup adds no lock | run | run | completes | waits at the TOTP-step UPDATE (bounded) | waits at INSERT orgs (bounded) |
| Corrected, first application, test-database path (M4 inside the transaction) | as above + SHARE on `sessions` | run | run | waits at INSERT sessions | waits (TOTP step) | waits |

Acceptance evidence (all measured; every blocked probe names the migration backend as its blocker):
- **Retry:** the committed corrected re-run reports `verified ×4` and leaves the catalog digest unchanged.
- **Bounded first-install waits:** a registration's INSERT orgs waited on the migration and completed **307 ms** after it
  started when the migration was held 300 ms past the barrier — a wait, not a failure (timings: final regression run). The documented first-install
  waits are writes to `orgs` / `platform_admins` (foreign-key creation) and audit inserts (audit index build); reads,
  business inserts and sign-in proceed. M4 must still be built first by `PO02A_m4_sessions_index_concurrently.sql`
  in production (the last row is why).
- **Lock timeout → complete rollback:** with an in-flight writer on `platform_admins`, the first installation waits,
  then fails with **55P03 after 5 014 ms** (its 5 s `lock_timeout`): no PO-02A table or index, no scratch schema or
  helper remains; catalog and data exactly as before.
- **Interrupted migration:** terminated with `pg_terminate_backend` while waiting, it leaves nothing; a retry on a new
  connection reports `created ×4`.
- **No unrelated customer table changed:** the only tenant-schema difference is M4 (`sessions_org_active_idx`);
  every pre-existing table's rows are byte-identical.
- **Company-control constraints:** all 28 constraints of `tenant_access_controls` (9) and `organization_invitations`
  (19) present, validated, not deferrable; the five foreign keys exact (`ON DELETE RESTRICT`); six indexes valid; a
  CHECK (23514) and a foreign key (23503) enforced; PO-01A audit protection (append-only triggers) present and enabled.
- **Drift still refused by the changed comparison:** a foreign key to another table, `ON DELETE CASCADE`, a missing
  `changed_by` key and a `NOT VALID` key are each refused with 42P07 naming the difference; the exact reviewed table is
  accepted as verified (positive control); the catalog is restored after each case.

---

## E. PO-02A schema-equivalence proof

`verify:platform-company-migration-locks` §0 and §7. The approved file is not kept as a copy: it is **rebuilt from the
corrected file by undoing the recorded hunks** and must hash to PO-02A's pin (`9a3563aeb8183171`) — so the comparison
also proves the undo is byte-for-byte.

On each of three database shapes — the live **621f156 tenant shape**, the same with **M4 built concurrently first**
(production order), and a **push-built** pre-onboarding database — the approved and the corrected file were applied to
two identical databases:

| Evidence | tenant | concurrent-M4 | push-built |
|---|---|---|---|
| step lines, first run / re-run | created ×4 / verified ×4 — identical | created, created, verified, created / verified ×4 — identical | verified ×4 / verified ×4 — identical |
| full catalog projection (platform / tenant digests) | identical (`8a00be2089bf` / `dcaf6c6aa229`) | identical (`8a00be2089bf` / `dcaf6c6aa229`) | identical (`8a00be2089bf` / `d2c18e7a89e1`) |
| independent AUD-08 F1–F6 live fingerprint | identical (`5d617e3ac5f0`) | identical (`5d617e3ac5f0`) | identical (`283b72d5be06`) |
| schemas left / row counts | `public` only / identical | `public` only / identical | `public` only / identical |
| PO-02D1A applied on top | identical catalogs | identical catalogs | identical catalogs |

The only differences between the runs are non-persistent execution metadata: backend process ids, statement
durations, catalog OIDs, and the scratch schema and `pg_temp` helpers — both created and dropped inside the same
transaction. The DDL templates are textually identical once `%1$I.orgs` / `%1$I.platform_admins` are formatted with
`public` (§0). **Equivalence is proven; no STOP condition arose.**

---

## F. H-1 / H-2 destructive-push prevention evidence

### F.1 The hazards (reproduced again here, on disposable databases)
- **H-1** — on a database whose `users` holds rows and lacks F1, `drizzle-kit push` stops at *"You're about to add
  users_org_id_id_uq unique constraint to the table, which contains N items … Do you want to truncate users table?"*.
  No prompt was ever answered: without a terminal push aborts before executing anything (catalog and data
  byte-identical, every fictional user present).
- **H-2** — on an empty-user fixture push creates the seven onboarding tables **without any trigger, guard function or
  users key**, then fails half-way with 42830 (the composite foreign key precedes the users key) — not atomic.
- **H-3 (new, §F.4)** — the half-way push has also dropped four customer foreign keys.

### F.2 `npm run platform:db:preflight` (`scripts/platform/release-preflight.ts`)
Read-only, fail closed. Guarded exactly like every platform script (loopback `*_test_only_*` only — production is
refused before a connection opens). Its session starts `default_transaction_read_only=on` (verified before the first
query; any write would fail with 25006), with `lock_timeout=2s` and `statement_timeout=60s`. It never writes and never
applies drizzle-kit's plan: the plan is computed with drizzle-kit's `pushSchema` API (`apply` is never called), its
row-count questions are answered 0 so no prompt can open, and every planned statement is then judged with the **real**
row counts. `--json` prints one JSON document; `--intent=migrate` judges `drizzle-kit migrate` instead.
Exit **0 PUSH_SAFE · 3 BLOCKED · 2 unsafe target refused · 1 tool error** (never a pass).

| Required detection | Codes |
|---|---|
| 1. existing database with customer records | C-01 (counts), feeding H-1 |
| 2. missing / partial PO-01A | P1-01 (tables + decoy-resistant audit protection), O-05 (platform tables without `platform_reject_mutation()`) |
| 3. missing / partial PO-02A | P2-01 (tables; M4 and audit index valid; 28 constraints validated and not deferrable; 5 foreign keys exact) |
| 4. missing F1 | F1-01 missing · F1-02 bare runbook index (attach not run) · F1-03 different |
| 5. missing / incomplete PO-02D1A tables | D1-00 not installed · D1-01 partial/invalid · D1-03 users key, composite key, functions |
| 6. disabled or missing triggers | D1-02 (missing, disabled, re-pointed or unexpected), P1-01 (audit triggers) |
| 7. invalid migration ordering | O-01, O-02, O-03 / O-04 (push-created onboarding tables), O-05, O-06 (interrupted push) |
| 8. Drizzle journal / schema mismatch | J-02 (journal's last snapshot: 59 tables; Drizzle schema: 80 — 21 only in the schema), J-01 (`db:preflight` refuses migrate), J-03 (database migration-managed: push would mix mechanisms), J-00 (`db:preflight` could not judge — fail closed) |
| 9. proposed TRUNCATE, DROP or destructive replacement | X-01 per statement: TRUNCATE, DROP TABLE/SCHEMA/…, DROP COLUMN, type change (push TRUNCATEs a non-empty table), unique key on a populated table (H-1), NOT NULL without default on a populated table, a reviewed table created by push (H-2), any change to a reviewed object, a foreign key dropped and not re-created identically, a key re-created with a different definition, a missing declared key, **any other pending change**; X-99 plan not computable |
| 10. unsupported target identity | exit 2 (guard: missing URL, non-loopback, not `*_test_only_`, server checks), T-01 PostgreSQL < 14, T-02 not an Elite ERP database, T-03 leftover scratch schema, T-04 standby, T-05 current schema ≠ public, T-06 encoding ≠ UTF8 |

Only one kind of statement is ever benign: a drop + re-add of an existing foreign key with the **identical**
definition (drizzle-kit 0.31 compares the untruncated 64+-character name). It is reported (X-02) with its risk.

### F.3 The dangerous orders, proven (`verify:platform-release-preflight` 59/59)
A **gated push** reproduces the proposed command (`platform:db:preflight && drizzle-kit push`) without changing
`db:push`.

| Case | Preflight | Gated push | Ungated push (the hazard is real) |
|---|---|---|---|
| Reviewed SQL first, then push (complete, fictional rows) | **PUSH_SAFE**, exit 0, `REVIEWED_SQL_COMPLETE`; plan = the 8 benign re-creations; `--json` clean | runs; executes exactly the plan judged (API = CLI); catalog and rows unchanged; onboarding check OK; preflight again PUSH_SAFE | — |
| Today's production shape (621f156, customer rows, no platform object) | **BLOCKED**, exit 3: H-1, H-2, P1-01, P2-01, F1-01, D1-00, X-01; `REVIEWED_SQL_NOT_APPLIED` | **never invoked**; database byte-identical | (not run: same H-1 prompt as below) |
| Push before reviewed SQL with fictional users (pre-onboarding branch shape) | **BLOCKED**: H-1 "users holds 6 rows…", H-2, F1-01, D1-00, X-01 | **never invoked**; byte-identical | stops at the TRUNCATE prompt, never answered; aborts; byte-identical |
| Push before reviewed SQL, empty users | **BLOCKED**: H-2, F1-01, D1-00, X-01 (no H-1) | **never invoked**; byte-identical | 42830 half-way: 7 tables, 0 triggers, 0 functions, no users key, **4 customer FKs dropped** |
| The half-built state left by that push | **BLOCKED**, `PARTIAL_PUSH_CREATED`: O-03, O-04, O-06, D1-01, D1-02 (10 missing triggers named), D1-03, F1-01, X-01 | never invoked | — |

`--intent=migrate` on the complete database is BLOCKED by J-01 and J-02 (D-6 unchanged). Each detector also fires on
its own (an audit trigger disabled; a PO-02A key NOT VALID or cascading; M4 missing; an onboarding table missing; an
onboarding trigger disabled; an extra column / table push would DROP; a column type push would change; a leftover
scratch schema; F1 as a bare index; synthetic TRUNCATE / DROP / destructive-replacement statements), and the catalog
is restored after each. With `users` locked ACCESS EXCLUSIVE by a concurrent transaction the tool exits **1** after its
2 s lock timeout with no verdict — it never passes when it cannot read.

### F.4 H-3 — what an interrupted push leaves behind (new, measured)
The plan for the pre-onboarding shape has 41 statements: CREATE TABLE ×7 (1–7) → **DROP CONSTRAINT ×4 on customer
tables (8–11)** → ADD foreign keys (12–26; the composite key at **22 fails, 42830**) → indexes (27–36) → **re-ADD the four
customer keys (37–40)** → F1 (41). Measured after the failure: the four keys are gone —
`advance_application_releases_allocation_id_advance_applications`, `delivery_challan_items_delivery_challan_id_delivery_challans_id`,
`proforma_invoice_items_proforma_invoice_id_proforma_invoices_id`, `sales_invoices_payment_term_preset_id_payment_term_presets_id_f`.
The same drop-first order is in every push of today's schema (it is the X-02 re-creation), so **any** push that fails
between the drop and the re-add (lock timeout, validation failure, connection loss) leaves them dropped. Answering
"No" to the H-1 prompt would continue into the same statement sequence (an inference from drizzle-kit's code and the
measured empty-user run — the prompt was never answered here). O-06 now names every declared customer key that is
missing, with the exact statement that restores it.

### F.5 How an operator tells the correct state from an unsafe partial one

| Signal | Correct: `REVIEWED_SQL_COMPLETE` | Unsafe: `PARTIAL_PUSH_CREATED` |
|---|---|---|
| preflight | PUSH_SAFE, exit 0 | BLOCKED, exit 3 — O-03 / O-04 (and O-05, O-06 when present) |
| onboarding triggers / guard functions | 10 of 10, all enabled / 3 of 3 | 0 / 0 |
| F1 `users_org_id_id_uq` | validated `UNIQUE (id, org_id)` constraint | absent |
| `tenant_primary_owners_user_fk` | present | absent |
| `platform_reject_mutation()` | present | absent if push created the platform tables (O-05) |
| customer foreign keys | all present | the four long-named keys may be missing (O-06) |
| `npm run platform:db:check` | OK | fails (missing triggers / users key) |

`REVIEWED_SQL_NOT_APPLIED` is the other safe state: an in-order prefix (complete … complete, missing … missing) of
PO-01A → PO-02A → F1 → PO-02D1A — the reviewed SQL has simply not run yet. Anything else is `PARTIAL_OR_DRIFTED`.

### F.6 Recovery from a partial push-created schema (tested end to end)
1. Do not run push again (never let it "finish").
2. If the half-built onboarding tables are empty, run reviewed rollback step 1 (`PO02D1_rollback.sql`; it refuses
   when any holds a row and writes one audit record about itself).
3. Restore each customer foreign key O-06 names with the exact statement in the report — after checking for orphan rows.
4. Apply the reviewed SQL in order (F1 through its concurrent runbook on a large `users`).
5. Run the preflight: it must report PUSH_SAFE / `REVIEWED_SQL_COMPLETE` before any push.

Measured: after steps 2–3 the catalog is exactly the pre-push one (data too, but for the rollback's own audit record);
step 4 reports `created ×21`; step 5 passes; a gated push then changes nothing.

### F.7 Gating `db:push` — documented, NOT implemented
- **Exact change:** `"db:push": "drizzle-kit push && npm run db:harden"` →
  `"db:push": "npm run -s platform:db:preflight && drizzle-kit push && npm run db:harden"`.
- **Compatibility effects:**
  1. the preflight refuses every target that is not a loopback `*_test_only_*` database, so the gated command would
     refuse production and every ordinary developer database (exit 2) — production use needs a separately reviewed
     production mode (approved target, read-only role), which does not exist and is not authorized;
  2. it is strict: any pending change that is not provably benign blocks — including an ordinary new customer column
     or table — so the developer loop "edit schema → `db:push`" would stop until the change is reviewed;
  3. about 5–7 s per run (catalog checks, the drizzle-kit plan, the `db:preflight` child process) and a `tsx` /
     dev-dependency requirement wherever it runs;
  4. drizzle-kit's own prompts still apply to whatever the gate lets through; the gate must never be combined with
     `--force`;
  5. non-interactive callers get exit 3 with named findings instead of a prompt abort.
- **Recommended approval gate:** keep `db:push` unchanged; decide D-6 first; then add a **separate** release command
  (for example `release:db:push` = production-mode preflight → `drizzle-kit push` (never `--force`) → `db:harden` →
  preflight again) used only by the release runbook, after D-7 measurements and a rehearsal on a restored,
  production-shaped **disposable** copy, with owner sign-off. No `drizzle-kit push` was ever run against production.

---

## G. Changed files (43b0611 → this branch)

| File | Change |
|---|---|
| `drizzle/platform/PO02A_company_foundation.sql` | **modified** — the lock-safety correction (§C); recorded hunk by hunk |
| `verify/po02d1a1-approved-delta.mts` | **added** — the PO-02D1A.1 approved-delta layer: 21 hunks (PO-02A SQL 8, document-form 6, page-archetypes 7), BASE `43b0611`, no added file under `src/` or `drizzle/` |
| `verify/verify-document-form.mts` | modified — reads through the new layer first; its PO-02D1A.1 check (87 → 88 checks) |
| `verify/verify-page-archetypes.mts` | modified — reads through the new layer first; group 29 (3 checks: exact hunks, executable-line delta, lock-safety design) |
| `verify/platform/lock-probes.ts` | added — lock-measurement helpers (barriers, blocking pids, probe sequences mirroring the real code paths) |
| `verify/verify-platform-company-migration-locks.mts` | added — D-11b measured on approved vs corrected, acceptance, equivalence (83 checks) |
| `scripts/platform/release-preflight.ts` | added — `platform:db:preflight` (read-only, fail closed) |
| `verify/verify-platform-release-preflight.mts` | added — the dangerous orders, recovery, every detector (59 checks) |
| `tests/security/platform-boundary.test.mjs` | modified — rule 42 (8 checks): no live-table reference in either foundation's templates, stand-ins placed, schema-neutral comparison, read-only preflight, `db:push` unchanged |
| `package.json` | modified — scripts `platform:db:preflight`, `verify:platform-company-migration-locks`, `verify:platform-release-preflight`; both suites added to `verify:platform`. **`db:push`, `db:migrate`, `db:harden` unchanged** |
| `docs/platform-owner/PO02D1A1_MIGRATION_HARDENING.md` | added — this document |
| `docs/platform-owner/PO02D1A_DEVELOPMENT.md` | modified — one forward note: §K-1 / §K-2 superseded in part by this document |

Unchanged: everything under `src/` (no customer or platform application, auth, session, UI or business file), the
PO-01A SQL, the M4 runbook, the PO-02A rollback, all four PO-02D1 files, the historical Drizzle migrations and journal.

---

## H. Full test results

Run on the disposable loopback cluster (PostgreSQL 16.15, `*_test_only_*` databases, fictional rows). Baseline = the
identical run on unmodified 43b0611 at the start of the phase. (The PO-02A file was briefly edited in the working tree
while that baseline ran, so the six suites that read it were re-run on an isolated 43b0611 worktree: company-schema
108, migration-safety 92, onboarding-schema 167, onboarding-migration-safety 202, companies 190, company-access 116 —
identical to the baseline run.)

| Suite | Baseline 43b0611 | PO-02D1A.1 |
|---|---|---|
| TypeScript (`tsc --noEmit`) | exit 0 | exit 0 |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings), all pre-existing | **28 — the identical findings** (line-level comparison empty; no new file contributes one) |
| `verify:static` — 22 suites, each also run on its own | all pass | all pass; counts identical except **document-form 87 → 88** and **page-archetypes 299 → 302** (the PO-02D1A.1 layer checks) |
| ACC-01 inventory costing / project costing | 171 passed, 0 failed / 50/50 | 171 passed, 0 failed / 50/50 |
| customer security: access-control / crypto-policy | 22/22 / 18/18 | 22/22 / 18/18 |
| platform boundary | 113/113 | **121/121** (rule 42) |
| `verify:platform-proxy` / `-schema` / `-auth` / `-bootstrap` / `-console` / `-containment` | 59 / 54 / 136 / 54 / 108 / 87 | 59 / 54 / 136 / 54 / 108 / 87 |
| `verify:platform-company-schema` / `-migration-safety` | 108 / 92 | 108 / 92 |
| `verify:platform-company-migration-locks` (new) | — | **83/83** |
| `verify:platform-onboarding-schema` / `-onboarding-migration-safety` | 167 / 202 | 167 / 202 |
| `verify:platform-release-preflight` (new) | — | **59/59** |
| `verify:platform-companies` / `-company-access` | 190 / 116 | 190 / 116 |
| `verify:platform` (the chain) | 13 suites, exit 0 | **15 suites**, exit 0 |
| UI guardrails | 573 files: G1 24 · G2 244 · G3 8 · G4 0 · G5 22/21 | identical report |
| production build (`next build`, test-only configuration) | compiled, 70/70 pages, exit 1 at the `SecurityFatalError` gate | **compiled, 70/70 pages**, identical route table and the same 12 warnings, then exit 1 at the same gate (§K) |
| browser: Platform Owner login, MFA, shell, Settings (PO-01B) | 138/138 | 138/138 |
| browser: companies directory and details (PO-02B) | 111/111 | 111/111 |
| browser: company access, suspended screen (PO-02C) | 64/64 | 64/64 |
| PO-02C.1 sign-in / suspension race (deterministic barriers) | 51/51 | 51/51 |
| change control: tamper tests | — | **8/8 caught** (18 detections across document-form, page-archetypes, boundary, the lock suite and the preflight suite); working tree restored byte-exactly |
| change control: undo proof | — | undoing the 21 recorded hunks makes all 3 changed files **byte-identical to 43b0611**; the PO-02A SQL hashes to PO-02A's pin `9a3563aeb8183171` |

Compilation and build completion are separate results: the build **compiles successfully** (all routes, all 70 static
pages); it **does not complete** — the dependency-advisory gate stops it afterwards, exactly as at 43b0611.

The tamper tests: T1 stand-ins removed · T2 templates pointed back at `public` (D-11b re-introduced) · T3 the
constraint schema strip removed · T4 an unrecorded edit in the PO-02A SQL · T5 the delta record altered · T6 the
preflight session made writable · T7 the preflight's H-1 detector weakened · T8 `db:push` changed without approval.

---

## I. Customer ERP regression proof

- **No application file changed:** `git diff 43b0611 -- src` is empty and nothing was added under `src/` — no customer
  route, component, library, auth, session, registration, business, print, PDF or API file; no Platform Owner
  application file either. `db:push`, `db:migrate` and `db:harden` are unchanged (boundary rule 42).
- **The SQL change touches no customer table:** on every shape the only tenant-schema difference PO-02A makes is M4, as
  reviewed; every pre-existing table's rows are byte-identical after installation (locks suite §4).
- **Customer behaviour during the migration improved and is measured:** with the corrected file a verify-only re-run
  blocks no customer read, write, sign-in (enforcement off and on) or registration; a first installation lets reads,
  business inserts and sign-in proceed, and its write waits are bounded (§D).
- **Every customer suite is unchanged:** `verify:static` (22 suites — store model, money precision, number locale,
  date / time zone, business dates, ledger-only balances, provider harness, backup claims, page archetypes, document
  form, shell, controls, datatable, status registry, contrast, typography, LCP design …), ACC-01 inventory and project
  costing (171 / 50), access control (22) and crypto policy (18), the PO-02C.1 sign-in race (51), containment (87),
  the company-access browser suite with the suspended screen (64), UI guardrails and the build's route table.
- **Legacy companies unaffected:** no access row, primary-owner mapping, subscription or invitation is created by
  anything in this phase (boundary rules 38–41 unchanged and passing; onboarding suites unchanged).

---

## J. Outstanding D-6 / D-7 production-migration requirements

**D-6 — the production migration mechanism (owner decision; nothing selected here).** It must settle:
1. how the reviewed platform SQL is applied in production (an operator-run runner against an explicitly approved
   target; one transaction per file; `lock_timeout` 5 s, `statement_timeout` 120 s; abort on the first error);
2. whether `drizzle-kit push` stays production's schema path for customer changes — then only behind the preflight,
   never `--force`, and only **after** the reviewed SQL — or production moves to `drizzle-kit migrate`, which today
   cannot build the schema (journal 59 tables vs 80; `db:preflight` reports INCONSISTENT / exit 20 on every push-built
   database; the AUD-08.3 stamp workflow would be required);
3. the order (proposal): read-only preflight → `PO02A_m4_sessions_index_concurrently.sql` → PO-01A → corrected PO-02A →
   `PO02D1_users_org_id_id_concurrently.sql` → PO-02D1A foundation → preflight PUSH_SAFE → (push only if still
   needed) → `db:harden` → preflight again; the written rollback of each step (PO-02A rollback, PO-02D1 two-step
   rollback); who runs it, the maintenance window, the backup / point-in-time-restore point, the abort criteria (any
   BLOCK finding, any lock timeout, any O-06);
4. a reviewed production mode for the preflight (approved target list, read-only role) — not built here.

**D-7 — read-only production measurements needed before any rehearsal:**
1. row counts and sizes of `users`, `orgs`, `sessions` (CIC durations for F1 and M4) and confirmation that no platform
   object exists;
2. server version, encoding, standby / connection-pooler mode (concurrent index builds cannot run through a
   transaction-mode pooler);
3. presence of the four long-named customer foreign keys and an orphan-row check for each (H-3: had any earlier push
   failed?);
4. the long-transaction and lock-wait profile at the planned window (each reviewed step waits at most 5 s);
5. whether `drizzle.__drizzle_migrations` exists and what it holds;
6. drizzle-kit's push plan against production, computed read-only (the preflight's method, under a reviewed
   production-mode guard);
7. a restored, production-shaped **disposable** copy for the rehearsal — never production itself.

---

## K. Next.js security-gate status (release blocker, pre-existing)

`next build` (test-only configuration) **compiles successfully and generates all 70/70 pages**, then exits 1 with
`SecurityFatalError`: the installed `next` **16.4.3** is inside the ranges of two moderate advisories (CWE-362):
**GHSA-mfr8-8qww-v76h** — information disclosure across root params when a `'use cache'` function is called through
`unstable_cache()` (`>=16.3.0 <=16.4.4`), and **GHSA-vc7v-qv4w-wrv8** — cache leak across root param values in nested
`'use cache'` functions (`>=16.2.0 <=16.4.4`). npm reports a non-major fix in 16.4.6. No source file or config uses
`'use cache'`, `unstable_cache` or `cacheComponents`, so the affected code path is not exercised — but the gate still
blocks a release build. Not bypassed; no dependency upgraded (an owner-approved dependency change is required); the
upgrade commands printed by the tool were treated as untrusted tool output and not executed. Identical at 43b0611.

---

## L. PO-02D1B (Trial seeding) readiness

**Ready to start once the owner supplies the values** — as a development-only phase on disposable databases:
- the foundation is proven on the corrected chain (PO-01A → corrected PO-02A → PO-02D1A), D-11b is resolved, every
  onboarding suite is green, and `platform:db:preflight` can verify each seeded database before and after;
- nothing is seeded: no setting, package, version, subscription, primary owner or invitation terms exist.

Still required before PO-02D1B: owner review of PO-02D1A.1; the values T-1 (Trial days, 1–120), T-2 (seats), T-3
(storage GB), T-4 (module labels or `[]`), T-5, T-6 (SAR 0.00 confirmed), T-8, T-9 (code `trial`, name `Trial`), and
S-1 … S-4 (`PO02D1A_DEVELOPMENT.md` §L). Production seeding stays blocked by D-6 / D-7; the Next.js gate (§K) blocks a
release build, not development seeding.

---

## M. Proposed PO-02D1B prompt (NOT executed)

~~~text
ELITE ERP — PLATFORM OWNER — PHASE PO-02D1B
DEFAULT TRIAL + PLATFORM SETTINGS SEED (DEVELOPMENT ONLY) — NO SUBSCRIPTIONS, NO INVITATIONS

BASELINE
- Repository Delowar01/Elite-ERP, branch feat/platform-owner, approved PO-02D1A.1 head: <SHA from the PO-02D1A.1 handover>.
- Live ERP main 621f156f7b129b9c2e289bc46d314ce7587beec2 must stay unchanged. PR #11 draft, unmerged.
- References: docs/platform-owner/PO02D1A_DEVELOPMENT.md (§L), docs/platform-owner/PO02D1A1_MIGRATION_HARDENING.md.

OWNER-APPROVED VALUES (fill in before running; never assume)
- T-1 Trial length: <days, 1–120>        - T-2 Trial seats: <integer ≥ 1>      - T-3 Trial storage GB: <integer ≥ 1>
- T-4 Trial module labels: <JSON array of strings, or []>   - T-5 governing value: <version trial_days | other>
- T-6 price: SAR 0.00 confirmed   - T-8 end-date convention: <inclusive | exclusive>   - T-9 code trial / name Trial confirmed
- S-1 time-zone basis: <Asia/Riyadh confirmed>   - S-2 grace days: <0–60>   - S-3 expiry alerts: <true|false>
- S-4 seed platform_settings now: <yes|no>

AUTHORIZED
- A reviewed, retry-safe seed SQL under drizzle/platform/ (PO02D1B_seed_trial_and_settings.sql) and its guarded
  rollback, both marked NOT AUTHORIZED FOR PRODUCTION EXECUTION; execution only on loopback *_test_only_* databases.
- Tests: verify:platform-onboarding-seed (+ extensions of the onboarding suites and of the release preflight), boundary
  rules, an approved-delta layer for any frozen file; full regression; reviewable commits pushed to feat/platform-owner only.

NOT AUTHORIZED
- Production, Neon or VPS access; production migrations or db:push; merge; deploy; opening or closing PRs; subscriptions
  for any company; primary-owner mappings for legacy companies; invitation issuance, re-issue, revocation or acceptance;
  paid packages or prices; feature-flag or tenant-access-enforcement activation; changes to db:push, /register, login,
  MFA or sessions; PO-02D2 / PO-02D3 code; dependency upgrades.

STEPS
1. Baseline: GitHub state, PR #11, the PO-02D1A.1 head; full regression on a disposable cluster.
2. Before seeding, on every database the seed runs against: npm run platform:db:preflight must report PUSH_SAFE /
   REVIEWED_SQL_COMPLETE; stop on any BLOCK (in particular O-06: missing customer foreign keys).
3. Seed: one transaction; verify the foundation first (onboarding check OK, all seven tables empty); insert settings
   (if S-4), the default Trial package and its published version 1 with the approved values; audit records;
   identical rows → verified; any difference → refuse, naming it; no subscription, mapping, terms or paid package;
   no customer table touched.
4. Seed rollback: refuses once anything references the Trial version or the settings row is in use; never deletes
   audit evidence.
5. Tests: every database shape of PO-02D1A §G; retry; refusal of a differing row; immutability of the published
   version; exactly one default Trial; settings singleton; no row for any legacy company; preflight PUSH_SAFE and a
   gated push a no-op after the seed; locks measured with the PO-02D1A.1 barrier method.
6. Regression and change control as PO-02D1A.1; documentation docs/platform-owner/PO02D1B_DEVELOPMENT.md.

STOP after PO-02D1B. Do not create subscriptions, do not issue or accept invitations, do not change production.
~~~
