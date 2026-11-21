# PO-06 — Encrypted backup / restore rehearsal: evidence, findings, and the two separate procedures

**Status:** rehearsed with fictional data on disposable loopback `*_test_only_*` databases only. The rehearsal used
`scripts/backup.sh` and `scripts/restore.sh` **exactly as committed** (no change), a TEST-only gpg key pair and a
TEST-only field-encryption key. All of it was generated in a temporary directory, never printed, and deleted when the
run ended. Suite: `verify/verify-po06-data-safety.mts` §R, **24/24 checks passed** (R0, the TEST key pair, then R1–R23).

**A backup is never called validated because its file exists.** Here, validated means all of these held:
- it decrypts;
- its table of contents reads;
- it restores into a clean database;
- the schema and every row compare equal to the source;
- the application checks pass on the restored copy;
- a tampered copy is refused.

## 1. What the rehearsal proved

| # | Check | Result |
|---|---|---|
| R1 | `backup.sh` (gpg to the TEST recipient, `RETENTION_DAYS=14`) exits 0 and says plainly that uploaded files are **not** in this backup | pass |
| R2 | the archive is OpenPGP-encrypted (no `PGDMP` signature in the file); no plaintext dump remains beside it | pass |
| R3 | retention: a 20-day-old archive pruned; a 2-day-old archive and an unrelated 30-day-old file kept (`find -name 'elite-erp-*' -mtime +14 -delete`) | pass |
| R4 | a manifest beside the archive: sha256 `ae9cc651730e4ee9…`, 87,541 bytes, 787 TOC entries, format CUSTOM, dumped from and by 16.15, plus a digest of every table's row fingerprints; the checksum re-verifies from disk | pass |
| R5 | integrity: decrypts; `pg_restore --list` lists customer tables, platform tables, their triggers and functions | pass |
| R6 | a copy with one flipped byte is refused at decryption | pass |
| R7 | **RB-4**: with only an *untrusted* public key, `gpg --batch` refuses, `backup.sh` fails — and the **plaintext** dump stays in `BACKUP_DIR` | pass (finding reproduced) |
| R8 | with the key's ownertrust set, the same host backs up and **cannot decrypt** its own backups (no secret key there) | pass |
| R9 | **RB-7**: `restore.sh` decrypts, restores, re-applies the immutable-audit triggers, prints `[restore] done.` — and exits **1** | pass (finding reproduced) |
| R10 | **RB-1**: `restore.sh` leaves the decrypted dump beside the archive | pass (finding reproduced) |
| R11 | schema: `pg_dump --schema-only` of source and restore equal, line for line (6,467 lines), except **one** CHECK constraint whose nested `AND` the restore re-parses flat — identical once parentheses are ignored (**RB-8**, textual only) | pass |
| R12 | data: every row of all 81 tables byte-identical (row fingerprints) | pass |
| R13 | versions: source and target 16.15; `pg_dump` / `pg_restore` 16.15 | pass |
| R14 | application checks on the restore: the manifest's pinned end state; the platform, company and onboarding catalog checks; every trigger enabled | pass |
| R15 | the field encrypted before the backup decrypts after the restore with the same TEST key; a stored bcrypt password verifies | pass |
| R16 | with any other key the field cannot be decrypted | pass |
| R17 | the audit trails are still append-only after the restore | pass |
| R18 | the release preflight gives the same verdict on the restore as on the source | pass |
| R19 | the existing hardening check (`scripts/apply-db-hardening.ts --check`) passes on the restore | pass |
| R20 | the source database is unchanged by the backup (every table, the catalog) | pass |
| R21 | an unrelated database on the same server is unchanged by the backup and the restore | pass |
| R22 | the Trial seed is intact after the restore | pass |
| R23 | every reviewed SQL file re-verifies the restored database (S02, S03, S05, S08 "verified"; the seed verified read-only) | pass |

**PostgreSQL version compatibility.** A custom-format dump restores with the same or a newer `pg_restore` into the
same or a newer server major version. Staging restores staging's own backups, so the versions are equal. Staging never
imports a production dump.

## 2. Findings in the backup scripts (reported, not fixed: an ops-script change is not authorized in PO-06)

| Id | Finding | Evidence | Until fixed, the runbook… |
|---|---|---|---|
| RB-1 | `restore.sh` leaves the decrypted plaintext dump beside the archive. `decrypt_if_needed` adds it to `tmp_files` inside `$(…)`, a subshell, so the EXIT trap never sees it | R10 | deletes `<archive without .gpg>` right after every restore and checks it is gone |
| RB-2 | `restore.sh` runs `psql "$DATABASE_URL" -f drizzle/immutable_audit.sql` without `ON_ERROR_STOP`: a failure there would be ignored | code | checks both immutable-audit triggers after every restore (`platform:db:check`, `verify:db-hardening`) |
| RB-3 | dumps are taken with `--no-privileges`: a restore brings back no grants, so the runtime role has no rights until they are re-granted | code + design | re-runs the grant script for `<APP_ROLE>` after a restore |
| RB-4 | with an untrusted recipient key, `gpg --batch` refuses, `backup.sh` exits non-zero **and leaves the plaintext dump** | R7 | sets the key's ownertrust at provisioning; alerts on any backup failure; checks `BACKUP_DIR` holds no `*.dump` |
| RB-5 | the plaintext dump is written to disk before it is encrypted | code | places `BACKUP_DIR` on an encrypted volume, mode `0700` |
| RB-6 | `restore.sh` has no target guard: `pg_restore --clean --if-exists` drops objects in whatever database `DATABASE_URL` names | code | runs `release-manifest.ts --status` against the intended target first — it refuses anything but loopback `*_test_only_*` — and restores only into a newly created database |
| RB-7 | `restore.sh` always exits **1**, even after a complete restore: its EXIT trap's last command is a cleanup loop over the always-empty list (`[ -n "" ] && …` → 1) | R9; reproduced in isolation | judges a restore by the checks of §1 (R11–R23), never by the script's exit status alone |
| RB-8 | a dump/restore re-parses one CHECK constraint (`subscription_events_actor_chk`) with a flattened `AND`: the non-pretty text differs, the meaning does not | R11 | compares schemas modulo that normalization. The manifest pins (pretty-printed) and every reviewed file's own verification accept the restore (R14, R23) |

The recommended script fixes go in one reviewed ops change, later (decision S-8):
- RB-1 and RB-7: fill the list in the parent shell, and make the trap `exit` with the saved status;
- RB-2: `-v ON_ERROR_STOP=1`;
- RB-4: remove the plaintext on any failure;
- RB-6: refuse unless an explicit `RESTORE_TARGET_CONFIRM` names the database.

## 3. Uploaded files

`backup.sh` does not cover uploaded files: Vercel Blob, or the test driver's directory on staging. It says so on every
run (R1). On staging with `STORAGE_DRIVER=fake` (decision S-5), the fake driver's directory either joins the backup
through `UPLOADS_DIR`, or is declared disposable test data. Fictional uploads can be regenerated.

## 4. RECOVERY — restoring the staging database after loss or corruption (a disaster-recovery procedure)

Use it when the staging database is lost, corrupted, or must be returned to a known point in time. It replaces the
whole database. It is **not** how a migration is undone (§5).

1. Stop the application: `systemctl stop elite-erp-staging`.
2. Pick the archive. Verify its checksum against its manifest. Decrypt it **on the restore workstation that holds the
   private key** (not the staging host). Run `pg_restore --list` to confirm the table of contents.
3. Create a NEW, empty database (`<STAGING_DB>_restore_<date>`, still containing `_test_only_`). Confirm the target
   with `release-manifest.ts --status`: an empty database is reported, and anything else is refused (RB-6).
4. Restore into it: `scripts/restore.sh <archive>` with `DATABASE_URL` set to the new database. Ignore its exit status
   (RB-7). Delete the decrypted leftover at once (RB-1).
5. Verify, in this order:
   - `release-manifest.ts --status` shows the pinned end state;
   - `npm run platform:db:check`;
   - `verify:db-hardening` (both immutable-audit triggers, RB-2);
   - re-grant `<APP_ROLE>` (RB-3);
   - row counts against the archive's manifest;
   - one field-decryption check with the escrowed `FIELD_ENCRYPTION_KEYS`;
   - one fictional sign-in.
6. Point `DATABASE_URL` at the restored database. Start the application. Run the smoke checks of the runbook (steps 12
   and 13).
7. Keep the damaged database until the restore is accepted, then drop it. Record the recovery point (RPO) and the time
   taken (RTO) against `docs/security/backup-dr.md` (RPO ≤ 24 h with daily dumps; RTO ≤ 1 h).

## 5. ROLLBACK — undoing a migration or a release (separate from recovery)

Use it when a release or a migration step must be undone **while the data is kept**.

| What is undone | How | Never |
|---|---|---|
| a feature | turn its switch off (`SECURITY_AND_FLAG_MATRIX.md` §2), restart | change code on the server |
| an application release | redeploy the previous approved SHA (the schema is additive, so older code runs against it) | roll the schema back first |
| a migration step | the manifest's reviewed rollback, newest first: `release-manifest.ts --rollback --to=R08` … `R03`. Each file refuses while its tables hold rows, and adds one audit record | run a rollback file by hand; force past a refusal |
| PO-01A | no reviewed rollback (R02 refuses); its tables are inert while the console is off | drop them |
| a data-bearing state (onboarding history exists) | not a rollback. It needs its own owner-approved plan, which for staging normally means re-creating the staging database from B00, since staging holds fictional data only | restore a backup to "undo" a migration while keeping newer data |
