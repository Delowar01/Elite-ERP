# Backup & Disaster Recovery — Elite ERP

Stage 11 Part 8. Runbook for backing up and restoring a self-hosted Elite ERP
deployment. All application state lives in one PostgreSQL database, so the
database backup **is** the system backup, plus the `uploads/` directory for
org branding assets.

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

1. **Database** — the entire `elite_erp` database (schema + data).
2. **`uploads/`** — logos, seals, signatures. Small; tar it alongside the dump.
3. **Secrets** — `AUTH_SECRET` and every `FIELD_ENCRYPTION_KEYS` version must be
   preserved in your secret store. **A database backup is undecryptable for
   field-encrypted columns (MFA secrets, etc.) without the matching encryption
   key version.** Losing a key version = permanent loss of those fields.

## Taking backups

Use `scripts/backup.sh` (see that file for env vars). It:
- runs `pg_dump -Fc` (custom format, compressed) to a timestamped file,
- tars `uploads/`,
- optionally encrypts both with `age`/`gpg` if a recipient/passphrase is set,
- prunes backups older than `RETENTION_DAYS`.

Schedule it via cron/systemd-timer, e.g. nightly:

```
0 2 * * *  /opt/elite-erp/scripts/backup.sh >> /var/log/elite-erp-backup.log 2>&1
```

Store copies **off-host** (object storage / another region). A backup on the
same disk as the database is not a backup.

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
