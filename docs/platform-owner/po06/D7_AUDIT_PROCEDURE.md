# PO-06 — D-7: the production-safe read-only measurement bundle and its owner procedure

**Status:** prepared and validated on fictional data only. **Not executed against production or any copy of
production. No production data was read or copied.** Running it needs the owner's separate written approval (§3).

| | |
|---|---|
| File | `docs/platform-owner/po06/sql/d7_readonly_production_audit.sql` |
| SHA-256 | `a1f63ecf12831b71da2b68079b4f7559026243286e5a04c479e0ca58fd91a52f` |
| Replaces nothing | the PO-00, PO-02D0 and PO-02D3 audit files stay unchanged; this bundle consolidates and extends them into one run |
| Validated by | `verify/verify-po06-data-safety.mts` §P (on the production shape with fictional company data, and on the full branch shape with fictional Platform Owner rows) |

## 1. What it measures, and the decision each answer feeds

| Section | Measures | Feeds |
|---|---|---|
| D7-00 | server version, encoding, collation, standby, schema, the session's read-only proof, the measuring role's attributes, connection and lock limits | D-6: target support (PostgreSQL ≥ 14, UTF8, primary); whether the reviewed SQL can run as is |
| D7-01 | companies; created in the last 30 days | sizing; registration rate (R-2) |
| D7-02 | the PO-00 owner classes A–F, as counts plus up to 20 pseudonyms per class | O-2: whether any primary-owner backfill is possible (only class A is a candidate) |
| D7-03 | users: active, disabled, never signed in, MFA-enabled (counts) | A-2 (MFA for new owners); seat counting P-1 |
| D7-04 | role values, including non-canonical ones; companies without an active owner; companies whose only owners are disabled | O-2, O-5 |
| D7-05 | companies without a primary-owner mapping, and mappings that no longer name an active owner (once PO-02D1 exists) | O-2; drift R02 |
| D7-06 | subscription states (lifecycle, cycle, current); companies without a current subscription | P-4 (legacy companies stay unlimited until assigned) |
| D7-07 | users per company: maximum, p50, p95, p99; companies above the Trial's 3 seats; the distribution | P-1, P-3 (grandfathering), P-8 (seat-enforcement consent) |
| D7-08 | e-mail uniqueness E1–E8 (`EMAIL_LOWER_UNIQUE_PROPOSAL.md` §2) | E-1: **E1 must be 0** before `users_email_lower_uq` |
| D7-09 | the 18 planned object names (collisions); M4, the users key and the e-mail index (valid?); INVALID indexes; the four long-named customer foreign keys and orphan rows (H-3); immutable-audit triggers; disabled triggers; event triggers; RLS; extensions; the Drizzle journal | D-6: whether the manifest's S00 would pass; whether an earlier push left H-3 damage; whether `db:harden` was ever run |
| D7-10 | database size; size, rows, statistics age and dead tuples of the tables the migration touches; proxies for the two CONCURRENTLY index builds | D-6: maintenance-window length, S01 and S04 duration |
| D7-11 | leftover scratch schemas; functions with planned names; prepared transactions; old and idle-in-transaction sessions; other sessions' locks on the key tables; the role's CREATE right and ownership of `users`, `sessions`, `orgs` | D-6: blocking conditions, the migration role |
| D7-12 | rows already in the Platform Owner tables, where they exist | the actual state of the target before D-6 |

**Not measurable from SQL**, so read from the hosting side:
- free disk space or the storage quota;
- whether the connection goes through a pooler, and in which mode — the CONCURRENTLY steps need a direct connection;
- the lock-wait profile over a whole day.

## 2. Safety — what makes it production-safe, and how that was proven

| Property | How it is guaranteed | Proven on fictional data (§P) |
|---|---|---|
| read-only | `BEGIN … REPEATABLE READ READ ONLY`; the file checks `transaction_read_only = on` and REPEATABLE READ before measuring, and quits otherwise; it ends in `ROLLBACK` | P1, P5; data, catalog and relation count identical after two runs (P19) |
| bounded | `statement_timeout 15 s`, `lock_timeout 2 s`, `idle_in_transaction_session_timeout 60 s` (SET LOCAL) | behind an ACCESS EXCLUSIVE lock it stopped after 2.0 s (P21) |
| no persistent object | no CREATE of any kind, no temporary table, no function, no prepared statement | static scan (P2, P3); catalog projection identical (P19) |
| no row lock, no write | plain SELECTs (ACCESS SHARE only) | it completed while another session held EXCLUSIVE on every customer table it reads (P20) |
| no secret or business content | never names a password hash, MFA secret, token, phone, address, tax id, notes column (P4); aggregates and per-run pseudonyms only | canary strings planted in every such column, and distinctive ids: none of them, no e-mail address and no raw id appeared (P17, P26) |
| pseudonyms unlinkable | `sha256(server-generated salt ‖ kind ‖ id)`; the salt is never printed and is lost at exit | two runs give different pseudonyms (P18) |
| outer transactions | under `psql -1` the nested BEGIN still makes the transaction READ ONLY and REPEATABLE READ (P22); inside a transaction that has already queried, it stops before measuring (P22b) | data unchanged (P22c) |

## 3. Owner execution and approval procedure (for a later, separately approved run — not done in PO-06)

1. **Written approval names everything:**
   - the target;
   - the operator;
   - the time window, outside business hours;
   - this file by commit SHA and SHA-256;
   - where the output goes (an owner-controlled location outside git);
   - when the raw output is deleted.

   The fixture files and every proposal file are never run.
2. **Preferred target: a Neon branch of production**, created for the measurement and deleted afterwards. It is
   copy-on-write, isolated from production traffic, and equal to production at branch time. Creating and deleting the
   branch are operations in the production account and belong to the same approval. The alternative is production
   itself through a read-only credential.
3. **Read-only enforced by the server, not only by the file.**
   - Use a role with `default_transaction_read_only = on` and `pg_read_all_data`, or SELECT on the tables read.
     Creating that role is a production change and part of the approval.
   - Minimum fallback: an existing read-only credential plus `PGOPTIONS='-c default_transaction_read_only=on'`.
4. **Check the file first:** `sha256sum d7_readonly_production_audit.sql` must print the SHA-256 above. Any difference:
   stop.
5. **Run it.** Use a service file or `PGPASSFILE`, so no password ever appears on a command line or in shell history:
   `PGSERVICE=<approved-service> psql -X -q -v ON_ERROR_STOP=1 -f d7_readonly_production_audit.sql > <owner-location>/d7.out`
   - Never use `-e` or `-a`: echoing would print the pseudonym salt.
   - Exit status 0 and a final `=== D7-END` line mean a complete report. Any other status means it is incomplete and
     nothing was changed; re-run later.
6. **Handle the output as confidential.** It holds aggregates and pseudonyms, and those are still business metrics.
   Keep it out of git, tickets and chat. Report only aggregates in the decision record. Delete the raw output once the
   decisions are taken.
7. **Delete the Neon branch**, if one was used. Record that it was deleted.
8. **No corrective action follows automatically.** Each answer feeds a decision (§1). Any backfill, e-mail
   remediation or schema repair is its own approved phase, with a backup.

## 4. Expected answers for a database that is ready for D-6

| Check | Ready when |
|---|---|
| D7-00 | `server_version_num` ≥ 140000, UTF8, `standby = f`, schema public |
| D7-08 E1 | 0 (or the owner has decided per group and accepted the residual) |
| D7-09 | no planned object exists unexpectedly; 0 INVALID indexes; the four long-named FKs present, validated, 0 orphans; both immutable-audit triggers present and enabled (otherwise run `npm run db:harden` first, under its own approval) |
| D7-11 | 0 scratch schemas, 0 named functions, 0 prepared transactions; the migration role can CREATE and owns `users` and `sessions` |
| D7-10 | sizes known, so the S01 / S04 CONCURRENTLY durations and the window can be estimated |
