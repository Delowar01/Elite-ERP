# Backup & Disaster Recovery — Elite ERP

Stage 11 Part 8. Runbook for backing up and restoring an Elite ERP deployment.

**Database state and uploaded files have separate recovery paths, and only the
first is covered by `scripts/backup.sh`.** Everything the application computes
from — documents, ledger, parties, settings — lives in one PostgreSQL database,
so the database backup is the backup of all of that. Uploaded files do not live
there, and do not live on the application host either; see *Uploaded files*
below before assuming they are covered.

## Objectives

| Metric | Target | Rationale |
|---|---|---|
| RPO (max data loss) | ≤ 24h with daily dumps; ≤ 5m with WAL archiving | Choose per business need |
| RTO (max downtime)  | ≤ 1h | Single DB + stateless app restore is fast |

Two tiers, pick based on tolerance:
- **Baseline:** nightly `pg_dump` (implemented in `scripts/backup.sh`).
- **Stricter RPO:** enable continuous WAL archiving / a managed PITR-capable
  Postgres in addition to the nightly logical dump.

## What to back up

1. **Database** — the entire `elite_erp` database (schema + data). Covered by `scripts/backup.sh`.
2. **Uploaded files** — logos, seals, signatures, item and employee images, document attachments. **NOT covered by `scripts/backup.sh`** — see the section below.
3. **Secrets** — `AUTH_SECRET` and every `FIELD_ENCRYPTION_KEYS` version must be
   preserved in your secret store. **A database backup is undecryptable for
   field-encrypted columns (MFA secrets, etc.) without the matching encryption
   key version.** Losing a key version = permanent loss of those fields.

## Taking backups

Use `scripts/backup.sh` (see that file for env vars). It:
- runs `pg_dump -Fc` (custom format, compressed) to a timestamped file,
- optionally encrypts it with `gpg` if a recipient is set,
- prunes backups older than `RETENTION_DAYS`,
- and prints, on every run, what it did and did not cover.

It archives a local upload directory **only** if `UPLOADS_DIR` is explicitly set
(a legacy self-hosted layout). If that variable is set and the directory is
missing, the script **fails** rather than skipping — omitting files the operator
asked for and still exiting 0 is the defect this replaced.

Schedule it via cron/systemd-timer, e.g. nightly:

```
0 2 * * *  /opt/elite-erp/scripts/backup.sh >> /var/log/elite-erp-backup.log 2>&1
```

Store copies **off-host** (object storage / another region). A backup on the
same disk as the database is not a backup.

> **Scheduling note — needs operational confirmation.** The cron/systemd example
> above assumes a host you control. The documented deployment target is Vercel,
> which offers neither. **Whether a scheduled database backup currently runs
> anywhere is not established by anything in this repository** and must be
> confirmed against the actual deployment — either by pointing a scheduler at
> this script from a host that has one, or by recording the managed Postgres
> provider's own backup tier as the answer. Until that is confirmed and written
> down here, treat the RPO target above as an intention rather than a fact.

## Uploaded files

**Uploaded files are not in the database and are not backed up by
`scripts/backup.sh`.**

They are stored in Vercel Blob under `organizations/{orgId}/{folder}/{file}`
(`src/lib/storage/blob-storage.ts`). The database keeps only the app-relative
proxy path — `/uploads/organizations/...` — which is a **pointer, not the
bytes**. Restoring a database dump therefore restores every reference to every
logo, seal, signature, product image and document attachment, and none of the
files themselves. A restore onto an empty blob store yields an application whose
records are intact and whose attachments are all broken links.

### What this means, stated without guessing

Uploaded-file durability currently rests on the blob provider. **This repository
contains no evidence about what that provider guarantees**, and this document
will not assert one. Before relying on it, the following must be established
operationally and recorded here:

- [ ] Which blob store the production `BLOB_READ_WRITE_TOKEN` points at.
- [ ] What retention, versioning or point-in-time recovery that store offers, if any.
- [ ] Whether a deleted or overwritten object can be recovered, and for how long.
- [ ] Whether the store is replicated across regions.
- [ ] What the recovery procedure actually is, and who can perform it.

Until those are answered, the honest position is: **the recovery objective for
uploaded files is unknown**, and it is not covered by the RPO/RTO targets at the
top of this document, which describe the database only.

### If provider durability is judged insufficient

The alternative is an explicit copy — enumerating the blob store and writing the
objects somewhere under your own control, on the same schedule as the database
dump, so the two restore together. That is a change to the backup architecture
rather than a correction to it, and is deliberately **not** implemented here: it
needs a decision about where those copies live and who pays for them.

### Restoring

`scripts/restore.sh` restores the database, and will untar a **legacy local**
uploads archive if one is passed to it. It has no ability to restore blob
objects, and a database-only restore is silently incomplete with respect to
files — which is why this section exists.

## Restoring

See `scripts/restore.sh`. Procedure:

1. Provision a clean PostgreSQL and an empty `elite_erp` database + app role.
2. Restore the dump: `pg_restore --no-owner -d "$DATABASE_URL" backup.dump`
   (the script wraps this, handling decryption first if needed).
3. Restore `uploads/` by untarring into the app root.
4. Ensure `AUTH_SECRET` and all `FIELD_ENCRYPTION_KEYS` versions match the
   originals, or field-encrypted data won't decrypt and existing sessions won't
   validate.
5. Re-apply the immutable-audit triggers on the fresh DB:
   `psql "$DATABASE_URL" -f drizzle/immutable_audit.sql`.
6. Start the app; verify login, a decrypted field (e.g. a user with MFA), and
   that the audit log is present.

## Disaster-recovery drills

- **Rehearse restores quarterly.** An untested backup is a hope, not a plan.
- Record the actual RTO achieved during each drill and adjust the schedule/tier.
- Verify integrity after every restore drill: row counts on core tables, a
  successful login, and one field-decryption check.

## Failure scenarios

| Scenario | Response |
|---|---|
| DB host lost | Provision new host, restore latest dump (+ WAL if enabled), repoint `DATABASE_URL`. |
| Corrupted table | Restore to a scratch DB, extract the table, re-import. |
| Ransomware / bad deploy | Restore from the last known-good off-host backup; rotate `AUTH_SECRET` (forces re-login). |
| Encryption key lost | Field-encrypted columns are unrecoverable — this is why keys live in a durable secret store with their own backup. |
| Accidental data delete | Soft-deleted rows sit in the Recycle Bin; hard losses restore from backup. |
