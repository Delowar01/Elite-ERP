# PO-06 — D-6 migration rehearsal: results for scenarios A–O

**Status:** rehearsed on disposable databases only, with fictional data only.
- PostgreSQL 16.15 on a loopback cluster created for the test; every database name contains `_test_only_`.
- No production, staging or other real resource was touched. No production data was read or copied.
- Suite: `verify/verify-po06-migration-rehearsal.mts`, run on 2026-11-21: **126/126 checks passed**, exit 0 (run 5, the final run).

**Inputs:**
- The manifest `D6_MIGRATION_MANIFEST.json` and the tool `scripts/platform/release-manifest.ts`.
- The 13 reviewed SQL files, unchanged.

**The "production shape" used for scenarios with existing data:**
- `pushPreCompanyTenantSchema` plus `drizzle/immutable_audit.sql`.
- PO-06 proved this byte-identical to a push of `main` 621f156's own schema plus its hardening: `pg_dump --schema-only`,
  5,240 lines, SHA-256 `c0e02373f4f1e495…`.

**The "existing company data":** fictional rows from `verify/platform/po06-fixtures.ts`.
- 9 companies and 21 users, covering the PO-00 owner classes A–F.
- Rows in 21 of the 67 customer tables: sessions, audit trails, invoices with items, journal entries with lines, payments,
  bank accounts, products, projects, proforma invoices, delivery challans and more.
- Canary strings in every free-text and secret-like column.

## 1. Results by scenario (Prompt 6 §4)

| Scenario | What was rehearsed | Result | Evidence |
|---|---|---|---|
| A | A clean, new database → the full foundation (B00 → S09) | **pass** | A1–A4: every step ran in manifest order (B00 S00 S02 S03 S05 S06 S07 S08 S09); every modifying step `applied`, every check `checked`; the final catalog is the pinned end state; the read-only CLI `--status` agrees (exit 0) |
| B | An existing ERP-shaped database with company data → additive (S00 → S09, both indexes CONCURRENTLY) | **pass** | B1–B6: every step ran (S00–S09); after every modifying step the existing customer tables were byte-identical (row fingerprints); `pg_dump --data-only` of every customer table byte-identical before and after (SHA-256 `388ac69c70215e14…`, 60,515 bytes; the bytes differ between runs because the fixtures carry the run's timestamps, never within a run); the customer catalog changed only additively — M4 (1 line), the users key (2 lines), the staged `user_invitations` objects (38 lines), nothing removed; the platform objects equal the empty-database ones (one data-independent pin) |
| C | Retry of a completed migration, and the lock taken by each step | **pass** | C1: a repeated run skips every completed step and changes nothing. C2: a forced re-run of every file (`--reverify`) reports each step `verified`. C3: afterwards every table (customer and platform) is byte-identical, the catalog projection is identical and no audit record was added. C4–C7: the lock records in §2 |
| D | Interrupted migrations — the backend terminated or cancelled mid-step | **pass** | D1: S05 (one transaction) killed while waiting (57P01): not complete, nothing it created is visible, a re-run resumes at S05. D2: the CONCURRENTLY build (S04) killed: an INVALID index is left, which the tool reports as `invalid` (never complete) and refuses at S00 (I-01) with the recovery `DROP INDEX CONCURRENTLY`; after it, the re-run completes. D3: the seed (S07) cancelled (57014): nothing of the seed survives; a re-run seeds normally |
| E | Migration failure and transaction rollback — a real lock timeout | **pass** | E1–E4: S05 waits behind an open customer transaction, gives up after its 5 s `lock_timeout` (55P03; 9,224 ms for the whole step, including the preflight that runs before it), is not complete, and leaves nothing behind; the lock-queue effect is measured in §2; once the long transaction ends the same step succeeds |
| F | Missing prerequisites | **pass** | F1: an empty database (no ERP schema) is refused at S00 (exit 3, T-02), and so is the CLI; a database without the `_test_only_` marker and a non-loopback host are refused before any connection (exit 2). F2: PO-02D1 out of order refuses in its own precondition (P0001). F3: the Trial seed before PO-02D1 is refused by its preflight gate (exit 3), nothing written. F4: PO-03C before PO-02D1 refuses (P0001) |
| G | Unexpected existing tables and columns | **pass** | G1: a differently shaped `tenant_access_controls` → refused at S00 (D-01); PO-02A itself aborts (42P07 "already exists with a different shape; nothing was applied"), nothing else created. G2a: a one-column `platform_admins` → refused at S00 (D-01); PO-01's own SQL fails only by accident (42703, its first index names a missing column). **G2b** (finding D6-F2): PO-01's own `platform_admins` statement without the bcrypt-only CHECK → refused at S00 (D-01), but PO-01's own SQL **succeeds** and leaves the table without the CHECK. G3: an extra column on an installed onboarding table → refused (D-01); PO-02D1 aborts (42P07). G4: an unexpected `user_invitations` → refused (D-03); PO-03C aborts (42P07) |
| H | Conflicting constraints and indexes | **pass** | H1: `users_org_id_id_uq` with the wrong column order → refused at S00 (D-02); PO-02D1 refuses (42710 "with a different definition; nothing was applied"), and so does the CONCURRENTLY file (P0001). H2: an extra CHECK on a PO-02A table → refused (D-01); PO-02A aborts (42P07). H3: `sessions_org_active_idx` with another definition → refused (D-02); PO-02A refuses (42710). Customer rows byte-identical in all three |
| I | Incorrect SQL checksum | **pass** | I1: a manifest checksum that does not match → refused with exit 5 before any connection. I2: an untouched copy of the files passes `--check` (exit 0). I3: one changed byte in `PO02A_company_foundation.sql` (same size) is named by its SHA-256, and the CLI `--check` exits 5. I4: an unreviewed SQL file added beside them is reported as not covered |
| J | The Trial seed and its guarded rollback | **pass** | J1: a re-run verifies the approved values and writes nothing. J2: settings changed after seeding (21 days) → the seed rollback REFUSES (exit 4), names the difference and removes nothing. J3: with the approved value back, R08 (nothing to undo) then R07 remove the seed, with one rollback audit record. J4: a repeated rollback changes nothing. J5: seeding again works, and so does S08. J6: the seed rollback run directly while `user_invitations` exists is refused (exit 3): R08 must come first |
| K | The staged `user_invitations` installation (S08) | **pass** | K1: 2 enabled triggers, 15 constraints, 6 indexes and `user_invitation_guard()` — the reviewed shape. K2: the guard holds (an open invitation can be inserted; its terms cannot change; it cannot be deleted; the table cannot be truncated — probe rolled back, nothing persists). K3: the release preflight after S08 is BLOCKED by exactly the two X-01 statements for `user_invitations` (finding D6-F1) |
| L | The `user_invitations` rollback on an empty table, and the full rollback chain | **pass** | L1: R08 on the empty table removes the table, its two triggers and the guard function, and appends one audit record. L2: a repeated R08 is skipped and records nothing. L3: S08 installs it again, exactly to the pin. L4: the full chain R08 → R07 → R05 → R04 → R03 returns the customer schema to EXACTLY the 621f156 shape (pinned digest); PO-01A remains (stage S02) with its audit trail. L5: R02 refuses (exit 3): there is no reviewed rollback for PO-01A (D6-F3) |
| M | Refusal to drop `user_invitations` while it holds a record | **pass** | M1: R08 with one record is REFUSED (exit 4, "holds 1 row(s); nothing was changed"); the table, its triggers and the record are intact, and no audit record was added |
| N | The preflight and the verification after every completed step | **pass** | N1: the preflight verdict after each step of A — BLOCKED / REVIEWED_SQL_NOT_APPLIED through S03 (the safe in-order prefix), PUSH_SAFE / REVIEWED_SQL_COMPLETE after S05–S07, BLOCKED / COMPLETE after S08 and S09. N2: after S08 the preflight blocks exactly `ALTER TABLE "user_invitations" DISABLE ROW LEVEL SECURITY;` and `DROP TABLE "user_invitations" CASCADE;`. N3: every result carries its post-verification notes; a step is never reported complete without them |
| O | Database integrity after each failure | **pass** | after every failing or refused scenario (D1–D3, E, F1–F4, G1–G4, H1–H3, I1, J, M) the same integrity check: the expected catalog stage, no scratch schema, no INVALID index (except D2's, which is the point of D2), every trigger enabled, both immutable-audit triggers present, and all 67 existing tables byte-identical |
| + | A least-privilege runtime role (the staging recommendation) | **pass** | S1–S4: a DML-only role reads and writes business rows, but cannot disable a trigger, drop or create a table or truncate (42501); the append-only triggers still refuse to rewrite audit history; the role existed only inside a rolled-back transaction |

**The rule "never complete when required objects are missing or malformed" held throughout.**
- A step is complete only when the catalog reaches that step's pinned fingerprint (`complete()` / `verifyAfter()`).
- An INVALID index, a drifted catalog, a seed that differs from the approved values, or a malformed table each refuse
  instead (D2, G1–G4, H1–H3, J2).

## 2. Lock behaviour, measured with real PostgreSQL transactions

The locks are read from `pg_locks` at the point of COMMIT, inside the step's own transaction, which is then rolled back
(`locksHeldAtCommit`).

| Step | Locks held on customer tables until COMMIT | Effect on a live database |
|---|---|---|
| S02 (PO-01A), first application | `orgs`: SHARE ROW EXCLUSIVE; ACCESS EXCLUSIVE only on the new platform tables | writes to `orgs` wait for the transaction (milliseconds) |
| S03 (PO-02A) **without** S01 | `sessions`: **SHARE** (the plain M4 build); `orgs`: SHARE ROW EXCLUSIVE | every session write (sign-in, sign-out, touch) waits for the whole build |
| S03 **after** S01 (M4 built CONCURRENTLY) | `sessions`: ACCESS SHARE only; `orgs`: SHARE ROW EXCLUSIVE | no session write waits |
| S05 (PO-02D1) **without** S04 — finding **D6-F4** | `users`: **ACCESS EXCLUSIVE** (`ALTER TABLE users ADD CONSTRAINT … UNIQUE` builds the key inside the transaction) | every read of `users`, so every sign-in, waits for the whole transaction |
| S05 **after** S04 (the key built CONCURRENTLY, then attached) | `users`, `orgs`: SHARE ROW EXCLUSIVE at most | writes to `users` wait for milliseconds; reads never wait |
| S07 (the seed) | none (only platform tables) | none |
| S08 (PO-03C, staged) | `orgs`, `users`: SHARE ROW EXCLUSIVE | writes wait for milliseconds |
| re-run (verify only) of S02 / S03 / S05 / S08 | none stronger than ACCESS SHARE on a customer table | none |
| S01 / S04 (CONCURRENTLY, autocommit) | SHARE UPDATE EXCLUSIVE; waits for transactions already open (observed in D2) | no reader or writer waits |

**Lock-queue effect (E3).**
- While S05 waited behind a long customer transaction, an UPDATE of **another** user queued behind the waiting migration
  for **4,986 ms**. That wait is bounded by the migration's 5 s `lock_timeout`; then the UPDATE ran.
- This is why the runbook keeps `lock_timeout` short, and requires that no long transaction is open before S05 or S08.

## 3. How a failure looks to the operator

| Exit | Meaning | Examples |
|---|---|---|
| 0 | done; every step verified | A, B, C |
| 1 | a step failed (lock timeout, cancellation, termination); nothing of that step persists | D1, D3, E2 |
| 2 | target refused before any connection (not loopback, no `_test_only_` marker, production not supported) | F1 |
| 3 | blocked: a precondition or finding (T-, I-, D- codes, or the seed's preflight gate) | F1, G, H, D2, J6, L5 |
| 4 | an SQL-level refusal from a guarded file (seed or rollback refuses to change data) | J2, M1 |
| 5 | the manifest does not match the files (checksum, size, order, coverage) | I1, I3 |

## 4. Findings from the rehearsal

| Id | Finding | Where | Handled by |
|---|---|---|---|
| D6-F1 | after S08 a push of `src/db/schema` would DROP `user_invitations` | K3, N2 | the preflight blocks it; push never runs after S08; a seed re-verification after S08 is read-only |
| D6-F2 | PO-01's SQL has no shape check (`IF NOT EXISTS`): a subtly different table is silently accepted | G2b | the tool's catalog fingerprint refuses it at S00; D7-09 finds it before any run |
| D6-F3 | there is no reviewed rollback for PO-01A | L5 | R02 refuses; a separate owner-approved plan is needed |
| D6-F4 | without S04, S05 holds ACCESS EXCLUSIVE on `users` until COMMIT | C5 | S01 and S04 are REQUIRED on any database in use; the staging runbook always passes `--concurrent-indexes` |

## 5. Corrections made during PO-06 (recorded, none in the reviewed SQL)

The 13 reviewed SQL files were never changed; their SHA-256 values equal the manifest's in every run.

**Runs 1–3 found defects in the new tool, which were corrected:**
- a re-verification of S02/S03 must accept "at least this state";
- the seed runner refuses after S08 (D6-F1), so a re-verification of S07 after S08 is read-only;
- a resumed run must accept the one partial state S01 leaves before PO-01A;
- the data comparison covers customer tables only. Platform tables legitimately change.

**Run 3 also corrected one test expectation and one ordering:**
- the C5 expectation was wrong: finding D6-F4 is real;
- D1's kill came after the lock timeout, so it was reordered.

**Run 4 (113/122) found nine mistakes in the test expectations; the migration behaved correctly in each:**
- six expected the generic P0001, while the reviewed files deliberately raise 42P07 (`duplicate_table`) or 42710
  (`duplicate_object`);
- G2 used a malformation PO-01 happens to trip over (now G2a), and G2b was added for the real case;
- H3 lacked its PO-01A prerequisite;
- the I2/I3 CLI run from a copied directory needed the `@/` path alias (`--tsconfig`).

**Run 5:** 126/126 checks passed. Of the nine corrected checks, G2 became two (G2a, G2b), and G2b adds a fixture check.

## 6. Reproduce

~~~bash
PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db whose name contains _test_only_> \
  npx tsx --conditions=react-server verify/verify-po06-migration-rehearsal.mts
~~~

It needs a loopback PostgreSQL 16 cluster used for nothing else. It creates and drops its own `*_test_only_*`
databases. Every connection goes through `scripts/platform/local-db-guard`.
