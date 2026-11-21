# PO-06 — D-6: the deterministic migration manifest and its runbook

**Status:** PROPOSAL for decision D-6. Rehearsed only on loopback, disposable `*_test_only_*` databases with fictional
data (`D6_REHEARSAL_RESULTS.md`). **No production schema change was made or prepared to run against production.** The
tool refuses every target that is not a loopback `*_test_only_*` database before it connects. That is also exactly the
shape of the recommended staging database (`STAGING_INFRASTRUCTURE.md` §1).

| | |
|---|---|
| Manifest | `docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json`: the reviewed artifact — order, checksums, timeouts, pins, retry, locks, failure, rollback |
| Tool | `scripts/platform/release-manifest.ts`: `--check` · `--plan` · `--status` · `--apply` · `--rollback` |
| Rehearsal | `verify/verify-po06-migration-rehearsal.mts` (scenarios A–O) |

## 1. Not a second migration engine

The tool **composes** what already exists:
- the fail-closed `local-db-guard`;
- the reviewed SQL files of PO-01A, PO-02A, PO-02D1, PO-02D1B and PO-03C, byte for byte;
- the catalog checks of `scripts/platform/catalog.ts`;
- the release preflight (H-1 / H-2 / H-3);
- the guarded Trial seed runner.

It adds no SQL and no ledger table. It decides what is complete **from the catalog alone**, by comparing the
database's catalog fingerprint with the manifest's pinned fingerprints. A step is never "complete" because it ran; it is
complete only when the catalog is exactly what the step promises.

It never runs `drizzle-kit push`, `migrate` or `generate`, with one exception: the restricted B00 base step, on an
EMPTY new database only. B00 pushes the tenant schema modules at the 621f156 shape and is verified against a pin.
PO-06 proved B00 identical to a push of `main`'s own schema: `pg_dump --schema-only`, 5,240 lines, identical.

## 2. Order and checksums (`--check` verifies all of this without a database)

| Step | File | SHA-256 (first 16) | Bytes | Execution |
|---|---|---|---|---|
| B00 | (restricted base push) + `drizzle/immutable_audit.sql` | `a3b0138667359a63` | 927 | new database only |
| S00 | — | — | — | read-only check |
| S01 | `drizzle/platform/PO02A_m4_sessions_index_concurrently.sql` | `db89d75915df8320` | 4,162 | autocommit statements |
| S02 | `drizzle/platform/PO01_platform_identity.sql` | `337cdfe1469037bf` | 11,176 | one transaction (5 s / 60 s) |
| S03 | `drizzle/platform/PO02A_company_foundation.sql` | `81c4b1c9dc74f06d` | 23,275 | one transaction (5 s / 120 s) |
| S04 | `drizzle/platform/PO02D1_users_org_id_id_concurrently.sql` | `1da56a0358a10834` | 6,620 | autocommit statements |
| S05 | `drizzle/platform/PO02D1_onboarding_foundation.sql` | `3fae0e23310f1ae3` | 50,104 | one transaction (5 s / 120 s) |
| S06 | — | — | — | read-only gate |
| S07 | `drizzle/platform/PO02D1B_seed_trial_and_settings.sql` | `0bce59ca04e43b35` | 27,125 | the guarded seed runner (5 s / 120 s) |
| S08 | `drizzle/platform/PO03C_user_invitations.sql` | `d72a48f0abdf3fc5` | 23,330 | one transaction (5 s / 120 s) — only after L-3 |
| S09 | — | — | — | read-only final check |
| R08 | `PO03C_user_invitations_rollback.sql` | `e74d68ed8aa5e780` | 3,203 | one transaction |
| R07 | `PO02D1B_seed_rollback.sql` | `026848ed4efd9a30` | 18,705 | the guarded seed runner |
| R05 | `PO02D1_rollback.sql` | `e5f40f3433c47e9c` | 4,900 | one transaction |
| R04 | `PO02D1_users_org_id_id_drop.sql` | `c4a6f0aa5d47197e` | 4,669 | autocommit statements |
| R03 | `PO02A_rollback.sql` | `ed87e54c409f187e` | 2,439 | one transaction |
| R02 | — | — | — | **no reviewed rollback for PO-01A** (D6-F3) |

`--check` also refuses:
- a timeout in the manifest that differs from the one the file itself sets;
- a transaction file that is not one `BEGIN … COMMIT`;
- an autocommit file that opens a transaction;
- any SQL file in `drizzle/platform` the manifest does not cover.

Before executing a file, the tool reads it and re-verifies its checksum. It executes exactly the bytes it verified. A
mismatch exits 5 with nothing connected (scenario I).

## 3. PostgreSQL version and prerequisites

- **PostgreSQL ≥ 14** (CREATE OR REPLACE TRIGGER; the files check `server_version_num` themselves). Rehearsed on 16.15.
- UTF8; a primary (not a standby); current schema `public`.
- A **direct** connection: the CONCURRENTLY steps cannot run through a transaction-mode pooler.
- The migration role: CREATE on the database (each file builds its scratch reference schema inside its own
  transaction); ownership of `users` and `sessions`; REFERENCES on `orgs`, `users` and the platform tables.
- Both immutable-audit triggers must exist (S00 checks it; `npm run db:harden` installs them).

## 4. Expected schema state — the pins

The platform catalog fingerprint must be exactly one of these:
- `none` (`c1dd8043…`);
- `afterS02` (`0059c326…`);
- `afterS03` (`8a00be20…`);
- `afterS05` (`2aac461e…`).

The customer catalog must carry exactly the M4 line and the two users-key lines (when installed), and the 38
`user_invitations` lines (digest `aaec6979…`, when S08 ran). A new database after B00 has exactly the 621f156 customer
schema (`c712ee56…`, 1,298 lines).

The pins were computed on two independent clean copies, with identical results. The rehearsal re-proves them with
company data present and after a backup/restore. The restore re-parses one CHECK constraint differently; the pins use
pretty-printed definitions and are unaffected (`BACKUP_RESTORE_EVIDENCE.md`).

## 5. Running it (Prompt 7, on the approved staging host, after approval — never in PO-06)

~~~bash
# 0. the files are the reviewed ones (no database needed)
npx tsx --conditions=react-server scripts/platform/release-manifest.ts --check
# 1. where are we? (read-only)
DATABASE_URL=<staging, owner role> npx tsx --conditions=react-server scripts/platform/release-manifest.ts --status
# 2. a NEW staging database: base schema, then the foundation and the seed — ALWAYS with --concurrent-indexes (D6-F4)
DATABASE_URL=<…> npx tsx --conditions=react-server scripts/platform/release-manifest.ts --apply --base --concurrent-indexes --verify-data
# 3. only after the owner approves L-3: the staged user_invitations table
DATABASE_URL=<…> npx tsx --conditions=react-server scripts/platform/release-manifest.ts --apply --concurrent-indexes --include-staged-user-invitations --verify-data
~~~

The connection string comes from the operator's environment or pgpass, never from a command line other users can see
(`STAGING_ENV_TEMPLATE.md` §1). Exit codes:

| Code | Meaning |
|---|---|
| 0 | every step verified |
| 1 | a step failed or failed verification |
| 2 | the target was refused |
| 3 | blocked by a precondition or the preflight |
| 4 | a reviewed file refused, in its own guard |
| 5 | a manifest or checksum mismatch |

## 6. Per step: retry, locks, preflight, verification, failure, rollback

Measured on PostgreSQL 16.15. The full text is in the manifest; the measurements are in `D6_REHEARSAL_RESULTS.md` §C.

| Step | Safe retry | Locks it takes on customer tables | Preflight after it | Verified by | On failure | Rollback |
|---|---|---|---|---|---|---|
| S01 | no-op when the valid index exists; refuses over an INVALID leftover | SHARE UPDATE EXCLUSIVE on `sessions` (reads and writes continue) | PARTIAL_OR_DRIFTED, the one state S00 accepts (M4 before PO-02A) | M4 line exact and valid | INVALID index → `DROP INDEX CONCURRENTLY`, re-run | R03 |
| S02 | idempotent; a differently shaped pre-existing table is caught by the fingerprint, not by the SQL (D6-F2, G2a/G2b) | SHARE ROW EXCLUSIVE on `orgs` until COMMIT | BLOCKED / REVIEWED_SQL_NOT_APPLIED | fingerprint `afterS02`; `checkPlatformObjects` | nothing persists | **none** (R02) |
| S03 | absent → created; identical → verified (a re-run holds only ACCESS SHARE); different → aborts | SHARE ROW EXCLUSIVE on `orgs`; after S01 nothing on `sessions` beyond ACCESS SHARE; **without S01, SHARE on `sessions` until COMMIT** | BLOCKED / REVIEWED_SQL_NOT_APPLIED | fingerprint `afterS03`; M4; `checkCompanyFoundation` | nothing persists | R03 |
| S04 | no-op when attached; refuses over INVALID or a different key | SHARE UPDATE EXCLUSIVE on `users` for the build; ACCESS EXCLUSIVE only for the catalog-only attach (≤ 5 s lock timeout) | BLOCKED / REVIEWED_SQL_NOT_APPLIED | users-key lines exact | INVALID index → `DROP INDEX CONCURRENTLY`, re-run (scenario D2) | R04 |
| S05 | absent → created; identical → verified (a re-run holds no watched lock); different → aborts | after S04: SHARE ROW EXCLUSIVE on `orgs`, `users`, `organization_invitations`, `platform_admins` until COMMIT. **Without S04: ACCESS EXCLUSIVE on `users` until COMMIT (D6-F4)** | **PUSH_SAFE / REVIEWED_SQL_COMPLETE** | fingerprint `afterS05`; the three catalog checks | nothing persists (scenarios D1, E) | R05 → R04 |
| S06 | read-only | — | PUSH_SAFE / COMPLETE required | the three checks; no scratch schema, no INVALID index, every trigger enabled | stop | — |
| S07 | inserted / verified / refused; a verify writes nothing | none on customer tables | PUSH_SAFE / COMPLETE | `checkTrialSeed` complete | nothing persists (scenario D3) | R07 |
| S08 | absent → created; identical → verified (a re-run holds no watched lock) | SHARE ROW EXCLUSIVE on `orgs`, `users`, `platform_admins` until COMMIT | **BLOCKED — exactly the two statements push would run against `user_invitations` (D6-F1)** | the 38 lines exact | nothing persists | R08 |

**Lock-queue effect (measured, scenario E).** While a step waits for a lock, every new writer of that table queues
behind it. In the rehearsal a customer UPDATE of another user waited about 5 s, until the migration's 5 s
`lock_timeout` released it. So:
- run the steps in a quiet window, after checking for long transactions (D7-11);
- `lock_timeout` 5 s is the upper bound of that stall per attempt.

## 7. Rollback order and rules

The order is **R08 → R07 → R05 → R04 → R03**. The application release (or the switch) that uses an object comes
back **first**.

Each rollback file refuses, changing nothing, while its tables hold a row (scenarios J2 and M). Each appends one audit
record when it removes something, and nothing when there is nothing to remove (L2, J4). The tool skips a step whose
object is already gone, so the chain is idempotent.

The R07 seed rollback needs the preflight PUSH_SAFE, so R08 must come first (J6). **PO-01A has no reviewed rollback**
(R02 refuses). Its tables hold the append-only platform audit trail, and they are inert while the console switch is
off.

A data-bearing rollback (onboarding history exists) is **never** routine. It needs its own owner-approved plan, and
normally a restore.

## 8. Never run

- `drizzle-kit push` without the release preflight, or with `--force`.
- Any push after S08 while `user_invitations` is declared outside `src/db/schema`: it would drop the table (D6-F1).
- `drizzle-kit migrate` or `drizzle-kit generate`.
- A manifest file by hand, out of order, inside an outer transaction or with `psql -1`.

## 9. Findings from the rehearsal (D6-F*)

| Id | Finding | Consequence for the runbook |
|---|---|---|
| D6-F1 | after S08 drizzle-kit's push plan is `ALTER TABLE "user_invitations" DISABLE ROW LEVEL SECURITY` and `DROP TABLE "user_invitations" CASCADE`: the staged declaration lives in `src/db/staged`, outside the schema push reads. The preflight blocks both (X-01), and therefore so does the seed runner | push never runs after S08 until L-3 moves the declaration into `src/db/schema` or a reviewed filter exists. A re-verified seed after S08 is checked read-only |
| D6-F2 | PO-01's SQL uses `IF NOT EXISTS` and has no shape check of its own. A pre-existing table with a planned name and the planned columns but, for example, without the bcrypt-only password CHECK is silently accepted: PO-01 succeeds and leaves it weakened (scenario G2b). A grossly different table fails only by accident, at the first index on a missing column (42703, G2a). PO-02A, PO-02D1 and PO-03C do check shapes (42P07 / 42710) | the manifest's fingerprint check refuses both at S00 (exit 3, D-01); D7-09 detects the collision before any run |
| D6-F3 | no reviewed rollback exists for PO-01A | R02 refuses. An owner-approved, backed-up plan is needed before PO-01A could ever be removed |
| D6-F4 | without S04 the users key is added inside S05 by `ALTER TABLE … ADD CONSTRAINT … UNIQUE`, so S05 holds ACCESS EXCLUSIVE on `users` until COMMIT (every sign-in waits). The earlier documents said a plain build takes SHARE | S04 (and S01) are REQUIRED on any database in use: the staging runbook always passes `--concurrent-indexes` |
