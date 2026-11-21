# PO-06 — Isolated staging preparation and database migration rehearsal (handover)

**Roadmap:** Prompt 6 of 16. **Mode:** development and staging preparation only.

## Verdict

| Target | Assessment |
|---|---|
| The first **test-only staging** deployment (Prompt 7) | **CONDITIONAL GO.** It is technically ready. It may start only after the owner signs the decisions and approvals in §K and `po06/PROMPT7_APPROVAL_CHECKLIST.md` §1–§2 (§M lists the conditions). |
| **Production** | **NO-GO.** §L lists what blocks it. Nothing in PO-06 authorizes any production change. |

## What PO-06 did not touch

**Production and staging.** PO-06 did not:
- access production Neon or the Hostinger VPS;
- run any SQL against production, read-only or otherwise;
- take a snapshot of, or read, any real customer record;
- provision, buy or reach any staging resource;
- create a real account, domain or secret;
- deploy anything.

**Databases.** Every database PO-06 used was a disposable `*_test_only_*` database, holding fictional data only, on a
loopback PostgreSQL 16.15 cluster that exists only inside the development container.

**Switches and code.**
- No feature switch was on outside disposable test processes.
- No application file, schema, dependency or lockfile changed.

**Git.**
- Nothing was merged.
- PR #11 was not changed.
- Prompt 7 was not started.

**The live Elite ERP is unchanged.**

The supporting files are in `docs/platform-owner/po06/` (index: `po06/README.md`).

## A. Exact branch and SHA

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (the only branch pushed) |
| PO-06 base | `08511d024570eabcf399db3e23658f9e10b7e3f5` (the PO-05 handover head) |
| PO-06 commits, in order | 1. `7092afcc3f5b8b728b53227ec26b19a9fc405f43` — the D-6 manifest and its guarded tool<br>2. `e51068e69573b4302f4d41e81328fe75c9241b86` — the D-7 bundle and the e-mail proposal<br>3. `141f9c91caf92525bd3fde75ef0bd3f747119ceb` — the rehearsal and data-safety suites, with their evidence<br>4. `72d2f19fd51a7390f5612778aa53228006637513` — the staging documents and the readiness checklist (the regression in §I ran on this commit)<br>5. this handover (documentation only) |
| Head | the commit that adds this file. A file cannot name its own SHA; the final report gives it, and it is checked on GitHub there |
| Unchanged and checked on GitHub | `main` = `621f156f7b129b9c2e289bc46d314ce7587beec2` · `fix/team-sensitive-fields-exposure` = `94f936eb019be446282536b8fcdeede6ae9e510c` · PR #11 open, draft, not changed |
| Versions (the PO-05 baseline, unchanged) | Next.js 16.4.6 · React 19.2.4 · `eslint-config-next` 16.4.6 · PostgreSQL 16.15 for every rehearsal |

## B. Changed files

**Modified: none.** `git diff --name-only 08511d0` lists only added files.

The following are byte-for-byte as at the PO-06 base:
- `src/`, `drizzle/` (the 13 reviewed SQL files included);
- `package.json`, `package-lock.json`, `next.config.ts`, `drizzle.config.ts`;
- `scripts/backup.sh`, `scripts/restore.sh`, `scripts/apply-db-hardening.ts`;
- the tracked `.env.example`.

The readiness checklist re-proves this (§I).

No frozen file changed, so no PO-06 approved-delta record was needed (Prompt 6 §13). Every earlier layer is intact:
- the PO-03D undo proof passes;
- the PO-05 layer undoes byte-exact. The original PO-05 proof script still reports the 21 PO-06 additions, which it
  predates, as unlisted; its PO-06-aware copy passes. Both results are in §I.

No dependency was added. The new scripts are deliberately **not** in `package.json`, which stays frozen. They run with
`npx tsx --conditions=react-server <file>`.

**Added: 22 files.**

| File | What it is |
|---|---|
| `scripts/platform/release-manifest.ts` | the guarded D-6 tool: `--check`, `--plan`, `--status`, `--apply`, `--rollback`. It is built on the existing framework and adds no second migration engine (§C) |
| `verify/verify-po06-migration-rehearsal.mts` | scenarios A–O on real PostgreSQL (§C) |
| `verify/verify-po06-data-safety.mts` | the D-7 bundle validation (§D), the `users_email_lower_uq` tests (§E), the backup/restore rehearsal (§H) |
| `verify/verify-po06-staging-readiness.mts` | the automated staging-readiness checklist (Prompt 6 §12) |
| `verify/platform/po06-fixtures.ts` | fictional production-shape fixtures: companies of owner classes A–F, users, business rows, canaries |
| `verify/platform/po06-email-child.mts` | a child process that drives the real `/register` and Team writers for the e-mail tests |
| `docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json` | the deterministic D-6 manifest |
| `docs/platform-owner/po06/D6_MIGRATION_RUNBOOK.md` | the manifest explained; the per-step retry, locks, failure and rollback |
| `docs/platform-owner/po06/D6_REHEARSAL_RESULTS.md` | the results of scenarios A–O and the lock measurements |
| `docs/platform-owner/po06/sql/d7_readonly_production_audit.sql` | the D-7 read-only measurement bundle (**not run against production**) |
| `docs/platform-owner/po06/D7_AUDIT_PROCEDURE.md` | what D-7 measures, why it is safe, the owner's execution and approval procedure |
| `docs/platform-owner/po06/EMAIL_LOWER_UNIQUE_PROPOSAL.md` | the `users_email_lower_uq` proposal: the ten points |
| `docs/platform-owner/po06/STAGING_INFRASTRUCTURE.md` | the isolated staging architecture (placeholders only) |
| `docs/platform-owner/po06/STAGING_ENV_TEMPLATE.md` | every configuration variable by name, with how each secret is generated and stored (no values). It is a `.md` file, deliberately not `.env*` |
| `docs/platform-owner/po06/SECURITY_AND_FLAG_MATRIX.md` | the switches, the activation order and how each is turned back; the security controls; the open findings, classified |
| `docs/platform-owner/po06/BACKUP_RESTORE_EVIDENCE.md` | the encrypted backup/restore rehearsal, findings RB-1 … RB-8, the separate recovery and rollback procedures |
| `docs/platform-owner/po06/STAGING_DEPLOYMENT_RUNBOOK.md` | the 20-step Prompt 7 runbook (not executed) |
| `docs/platform-owner/po06/STAGING_REGRESSION_SPEC.md` | the regression matrix for the staging release candidate |
| `docs/platform-owner/po06/OWNER_DECISION_SHEET.md` | every open decision |
| `docs/platform-owner/po06/PROMPT7_APPROVAL_CHECKLIST.md` | what must be signed before Prompt 7 |
| `docs/platform-owner/po06/README.md` | the index of the supporting files |
| `docs/platform-owner/PO06_STAGING_PREPARATION.md` | this handover |

## C. Migration and rollback results (D-6)

### The manifest and the tool

`po06/D6_MIGRATION_MANIFEST.json` fixes the following, all checked by `release-manifest.ts --check` before anything
connects:
- the exact order of the 13 reviewed SQL files, each with its SHA-256 and size;
- each step's declared timeouts and its kind (check, autocommit, one transaction, seed runner);
- the PostgreSQL requirements: ≥ 14 (`server_version_num` 140000), UTF8, a primary, schema `public`, and a direct
  connection for the CONCURRENTLY steps;
- the expected catalog state after each step, as pinned fingerprints;
- retry, locks, failure and rollback for each step;
- the five things that must never run:
  - an unrestricted `drizzle-kit push`;
  - `push --force`;
  - a push after S08 (D6-F1);
  - `drizzle-kit migrate` / `generate`;
  - any file by hand, out of order, or under `psql -1`.

| Step | File / action | Kind |
|---|---|---|
| B00 | a **new, empty** database only: the 621f156 customer schema, then `drizzle/immutable_audit.sql` | base |
| S00 | read-only target check, then the release preflight | check |
| S01 | `PO02A_m4_sessions_index_concurrently.sql` | autocommit, CONCURRENTLY (REQUIRED on a live database) |
| S02 | `PO01_platform_identity.sql` (PO-01A) | one transaction |
| S03 | `PO02A_company_foundation.sql` | one transaction |
| S04 | `PO02D1_users_org_id_id_concurrently.sql` | autocommit, CONCURRENTLY, then attach (REQUIRED on a live database) |
| S05 | `PO02D1_onboarding_foundation.sql` | one transaction |
| S06 | the read-only gate before any row is written | check |
| S07 | `PO02D1B_seed_trial_and_settings.sql` through the existing guarded seed runner | seed runner |
| S08 | `PO03C_user_invitations.sql` (staged; only with `--include-staged-user-invitations`, after decision L-3) | one transaction |
| S09 | read-only final verification | check |
| Rollback | R08 (PO-03C) → R07 (seed) → R05 (PO-02D1) → R04 (users key) → R03 (PO-02A); R02 refuses: PO-01A has no reviewed rollback (D6-F3) | guarded |

**It reuses the existing migration safety framework:**
- `local-db-guard`: both guard steps, on every connection;
- the catalog projections and pins;
- `release-preflight`, run after every step;
- the guarded Trial seed runner;
- the disposable-database push, used only for B00 on an empty database.

**What the tool refuses, and how it reports it:**
- **Targets:** it accepts only a loopback server and a database name containing `_test_only_`. That is enough for the
  recommended staging database (§F). It has no production mode, by design: one is part of D-6.
- **Exit codes:** 0 ok · 1 step failed · 2 target refused · 3 blocked · 4 SQL refusal · 5 manifest mismatch.

### The rehearsal (Prompt 6 §4): **126/126 checks passed**

The details are in `po06/D6_REHEARSAL_RESULTS.md`.

| | Scenario | Result |
|---|---|---|
| A | clean database → full foundation (B00 → S09) | pass — pinned end state, every step verified |
| B | existing ERP-shaped database with company data → additive | pass — every customer table byte-identical after each step; `pg_dump --data-only` identical; catalog change additive only |
| C | retry of a completed migration | pass — skips or re-verifies; nothing changes, no audit record added |
| D | interrupted (terminated, killed CONCURRENTLY build, cancelled seed) | pass — never reported complete; INVALID index detected and refused with its recovery; resumes |
| E | failure and transaction rollback (real lock timeout, 55P03) | pass — nothing persists; the queue effect is measured |
| F | missing prerequisite | pass — refused at S00 or by the file's own precondition |
| G | unexpected existing table or column | pass — refused at S00 (fingerprint); G2b proves D6-F2 |
| H | conflicting constraint or index | pass — refused at S00; the files refuse too (42710) |
| I | incorrect SQL checksum | pass — exit 5 before any connection; one changed byte is named |
| J | Trial seed and guarded seed rollback | pass — the rollback refuses changed values; R08 before R07 |
| K | PO-03C `user_invitations` installation | pass — the reviewed shape; the guard holds |
| L | its rollback on an empty table, and the whole chain | pass — the customer schema returns exactly to the 621f156 shape |
| M | refusal to drop `user_invitations` holding a record | pass — refused, nothing changed |
| N | preflight and verification after every step | pass — every verdict recorded; never complete without its notes |
| O | integrity after each failure | pass — stage, scratch schemas, INVALID indexes, triggers, all 67 existing tables byte-identical |

**Production-shape fidelity.** The "existing ERP" databases are the 621f156 customer schema plus its hardening.
- PO-06 proved it byte-identical to a push of `main`'s own schema: `pg_dump --schema-only`, 5,240 lines, SHA-256
  `c0e02373f4f1e495…`.
- The company data is fictional, in 21 of the 67 customer tables.

**Locks, measured in real transactions.**
- With S01 and S04 (CONCURRENTLY), no step holds anything stronger than SHARE ROW EXCLUSIVE on a customer table.
- Writes to `orgs` and `users` wait only while the step's own short DDL transaction runs; reads never wait.
- **Finding D6-F4:** without S04, S05 holds **ACCESS EXCLUSIVE on `users`** until COMMIT. Without S01, S03 holds
  **SHARE on `sessions`**. So S01 and S04 are REQUIRED on any database in use, and the staging runbook always passes
  `--concurrent-indexes`.
- A writer arriving behind a waiting migration queues for at most the 5 s `lock_timeout` (measured: 4,986 ms).

**Findings.**

| Id | Finding | Handled by |
|---|---|---|
| D6-F1 | after S08 a push would drop `user_invitations` | the preflight blocks it; push never runs after S08 |
| D6-F2 | PO-01's SQL has no shape check | the tool's fingerprint refuses at S00 |
| D6-F3 | no PO-01A rollback | R02 refuses |
| D6-F4 | without S04, ACCESS EXCLUSIVE on `users` | S01/S04 are mandatory |

**Corrections during PO-06.** The 13 reviewed SQL files were never changed. The rehearsal runs found and corrected
defects in the new tool and in the test expectations; `D6_REHEARSAL_RESULTS.md` §5 lists them.

## D. Database audit preparation (D-7)

**The bundle.**

| | |
|---|---|
| File | `po06/sql/d7_readonly_production_audit.sql` |
| SHA-256 | `a1f63ecf12831b71da2b68079b4f7559026243286e5a04c479e0ca58fd91a52f` (also in `D7_AUDIT_PROCEDURE.md`, and checked by the readiness checklist) |
| Measures | everything §5 asks for, in sections D7-00 … D7-12 |

The measurements:
- the company count;
- the owner classes A–F, as counts plus pseudonyms;
- active, disabled, never-signed-in and MFA users;
- role values;
- companies without a primary owner;
- subscription states;
- seat distribution (max, p50, p95, p99, above-Trial);
- e-mail duplicates E1–E8, including case-insensitive collisions;
- schema and index compatibility, including the 18 planned names, INVALID indexes, the H-3 foreign keys, the
  immutable-audit triggers, RLS and extensions;
- sizing for the window and the CONCURRENTLY builds;
- blocking conditions: scratch schemas, prepared transactions, long transactions, foreign locks, the migration role's
  rights.

**How it stays safe.**
- **One transaction:** `REPEATABLE READ READ ONLY`. It checks that it is read-only and quits otherwise, and it ends in
  `ROLLBACK`.
- **Bounded:** statement 15 s, lock 2 s, idle 60 s.
- **Leaves nothing behind:** no CREATE, no temporary object, no function, no row lock.
- **Reveals nothing private:**
  - it never names a password, MFA, token or contact column;
  - it reports aggregates only, plus per-run pseudonyms (a server-generated salt, never printed).

**Validated on fictional databases only.** `verify-po06-data-safety.mts` §P: **28/28 checks**.

| Check | Result |
|---|---|
| P6 | complete in 84 ms |
| P19 | data and catalog identical after two runs |
| P20 | it completes while another session holds EXCLUSIVE on every table it reads |
| P21 | behind ACCESS EXCLUSIVE it stops after its 2 s lock timeout |
| P17, P26 | canaries planted in every sensitive column never appear, and nor does any raw id or e-mail address |
| P18 | pseudonyms differ between runs |
| P22–P22c | under `psql -1` it stays read-only; inside a transaction that has already run a query it stops before measuring; data unchanged |

**Not executed against production or any copy of it.** No production data was read or copied. The owner's execution
procedure is in `D7_AUDIT_PROCEDURE.md` §3:
- written approval naming the target, operator, window, file SHA and output location;
- preferably a Neon branch created for it and then deleted;
- a server-enforced read-only role;
- SHA verification before the run;
- `PGSERVICE`, with no password on the command line;
- the output kept out of git;
- no automatic corrective action.

## E. Email uniqueness safety decision (`users_email_lower_uq`)

**Decision: not installed on any real database. The decision is E-1, the owner's.**

The proposal (`po06/EMAIL_LOWER_UNIQUE_PROPOSAL.md`) answers all ten points:
1. current behaviour;
2. the read-only audit (D-7 E1–E8);
3. remediation options, none automatic;
4. CONCURRENTLY, SHARE UPDATE EXCLUSIVE only;
5. registration;
6. company and user invitations;
7. concurrency;
8. failure handling;
9. rollback;
10. the approval gate.

No customer e-mail was changed anywhere real. The SQL is PO-02D3's, unchanged and still guarded: the committed file
refuses to run.

**Tested on disposable databases:** `verify-po06-data-safety.mts` §Q, **18/18 checks**, with the real `/register` and
Team writers.

| Check | Result |
|---|---|
| Q5–Q7 | the build waits only for already-open transactions; registration and sign-in run meanwhile (5 ms) |
| Q10, Q11 | registering the lower-case form of a legacy mixed-case account: with the index the database refuses it (23505) and the whole transaction rolls back (Q10); without the index a second account is created (Q11) |
| Q16 | a duplicate committed during the build leaves an INVALID index. The file then refuses to continue and names `DROP INDEX CONCURRENTLY` |
| — | the rollback is idempotent; every row stays byte-identical |

**Finding EI-1:**
- `/register` has no handler for a unique violation;
- a race (today) or a legacy case variant (with the index) gives an unhandled error instead of "already exists";
- the data stays correct.

**Recommendation:**
- **Staging:** approve after E1 = 0, which is trivially true on fresh fictional data.
- **Production:** decide only after a D-7 run on production (E1 = 0, E2–E5 reviewed) and a decision on EI-1. Until
  then, the PO-02D3 §D.4 release gate keeps production NO-GO.

## F. Staging architecture

The design is in `po06/STAGING_INFRASTRUCTURE.md`, using placeholders only. Nothing was provisioned.

| Area | Design |
|---|---|
| Host (S-1) | a **new** VM in an account separate from production, never the Hostinger production VPS. 2 vCPU / 4 GB / 40 GB, Ubuntu 24.04 LTS |
| Database (S-2) | PostgreSQL 16 on the staging host, **127.0.0.1 only**, database named `*_test_only_*`. Roles: the runtime role is DML-only (rehearsed, §S of the rehearsal); the owner role is used only for migrations. With this design the guard, the manifest tool, the seed runner and the bootstrap CLI all work unchanged |
| Application (S-3) | one Next.js process behind nginx (TLS 1.2+, HSTS, `PLATFORM_TRUSTED_PROXY_HOPS=1`). Two host names under a staging-only registrable domain (customer and console), so there is no cookie, HSTS or DNS link to production |
| External services (S-4, S-5) | none. Outbound traffic denied by default; copy-link invitations; no payment or messaging provider; the test storage driver |
| Logs (S-6) | host-local, with retention |
| Backups (S-8) | daily `scripts/backup.sh`, gpg to a key whose private half is offline, retention 14 days, an off-host copy, and a restore drill before go-live |

## G. Secrets and feature-flag requirements

**Variables** (`po06/STAGING_ENV_TEMPLATE.md`).
- Every environment variable the code reads is named, by name only. The readiness checklist proves the coverage
  (54 names, from `src/` and `scripts/`).
- For each one the template gives its purpose, the staging value or placeholder, whether it is secret, and how it is
  generated (`openssl rand …`) and stored: a `0600` env file and pgpass files owned by the service user.

**Rules for secrets.**
- Never copied from production or development.
- `AUTH_SECRET` and `FIELD_ENCRYPTION_KEYS` are escrowed. A restore needs the same `FIELD_ENCRYPTION_KEYS` (backup
  check R15/R16).
- The two session secrets must differ.
- No password goes in a URL.

**Switches.** Every switch is off at deployment, because only the exact value `true` (or `enabled`) turns one on.

| Step | Switch |
|---|---|
| F0 | all off; the ERP regression runs first |
| F1 | console |
| F2 | `TENANT_ACCESS_ENFORCEMENT` |
| F3 | company invitations |
| F4 | `/register/accept` |
| F5 | user invitations, only after L-3 |
| F6 | `/join/accept` |
| F7 | seat enforcement, last, with consent P-8 |

- One switch per restart, each with its checks before the next. Turning back runs in reverse order.
- The matrix: `po06/SECURITY_AND_FLAG_MATRIX.md` §1–§2.
- The readiness checklist proves that every switch is off by default in the code and unset in the environment.

## H. Backup/restore evidence

The rehearsal used `scripts/backup.sh` and `scripts/restore.sh` exactly as committed, with a TEST-only gpg key and a
TEST-only field key, on fictional data. `verify-po06-data-safety.mts` §R: **24/24 checks**. Details:
`po06/BACKUP_RESTORE_EVIDENCE.md`.

**What "validated" required — the file existing was not enough:**
- it decrypts, and a tampered copy is refused;
- its table of contents reads: 787 entries; the archive is 87,541 bytes, with SHA-256 recorded;
- it restores into a clean database;
- the schema is equal line for line (6,467 lines), apart from RB-8, which is textual only;
- all 81 tables are byte-identical;
- the field encryption round-trips with the same key, and fails with any other key;
- the audit trails are still append-only;
- the release preflight and the hardening check give the same verdict;
- every reviewed SQL file re-verifies the restored database;
- the source and an unrelated database are unchanged.

**Findings in the unchanged scripts.** None is fixed: an ops-script change was not authorized. The runbook works around
each one.

| Id | Finding |
|---|---|
| RB-1 | the decrypted dump is left beside the archive |
| RB-2 | psql runs without `ON_ERROR_STOP` |
| RB-3 | no grants after a restore |
| RB-4 | an untrusted key makes the backup fail **and leave the plaintext dump** |
| RB-5 | the plaintext is written before encryption |
| RB-6 | no target guard in `restore.sh` |
| RB-7 | `restore.sh` exits 1 even on success |
| RB-8 | one CHECK constraint is re-printed flat (textual only) |

**Recovery and rollback are separate procedures:**
- recovery = restoring data, `BACKUP_RESTORE_EVIDENCE.md` §4;
- rollback = undoing a release or schema step, §5.

## I. Test and build results

The full regression ran at `72d2f19`, the last code commit; commit 5 adds only this document. It was run against the
PO-05 baseline, which was recorded at `f85acb9`.
- It used the same matrix, the same commands and the same counting rules as PO-05.
- It ran on a disposable loopback cluster, in the TEST configuration, with every switch off.
- **No verifier was changed, weakened or skipped.**

| Tier | Command | PO-05 baseline | PO-06 at `72d2f19` |
|---|---|---|---|
| Dependencies | `npm ls --all`; `npm audit --audit-level=high`; the full audit; the offline registry-signature check of the 12 updated packages | exit 0; exit 0; 13 moderate, 0 high/critical; 12/12 | **identical**: exit 0; exit 0; 13 moderate, 0 high/critical; 12/12 |
| TypeScript | `npx tsc --noEmit -p .` (covers the new `.ts` / `.mts` files) | exit 0 | **exit 0** |
| ESLint | `npx eslint src tests scripts verify`; `npx eslint src --max-warnings=0` | 28 problems (7 errors, 21 warnings), the PO-03D baseline finding for finding; exit 0 | **the same 28, IDENTICAL finding for finding** (the new files add none); **exit 0** |
| Platform Owner suites | `npm run verify:platform` (28 suites) | 2,634 / 2,634 | attempt 1: stopped at the 7th suite — `verify:platform-containment` 87/88 (the known check A, below). The other six suites were green; the remaining 21 did not run.<br>Attempt 2, same commit: **2,634 / 2,634, all 28 suites identical to PO-05 suite by suite.**<br>Each suite alone afterwards: **28/28 suites green, 2,634 / 2,634, identical suite by suite** (containment 88/88) |
| Static suites | `npm run verify:static`, then each of the 22 suites alone | 1,919 / 1,919 | **1,919 / 1,919**, 22/22 suites green |
| Finance | ACC-01 inventory costing / project costing | 171 / 50 | **171 / 50** |
| Customer server suites | `npm run verify:server` (25 suites, `db:harden`-ed full-schema TEST database) | 1,137 / 1,137 | **1,137 / 1,137**, 0 suites differing |
| Security | `tests/security/access-control`, `crypto-policy`, `platform-boundary` | 22 / 18 / 218 | **22 / 18 / 218** |
| Change control | `verify:po05-security-update`; the PO-03D and PO-05 undo proofs | 19/19; both PASS | **19/19**; PO-03D **PASS** (27 files, 119 hunks); PO-05: see the note below |
| UI guardrails | `npm run ui:guardrails` | exit 0 | **exit 0** |
| Build | `npx next build`; `verify:po05-security-update -- --build`; the route table | exit 0, 71/71 pages; 23/23; 101 lines | **exit 0, 71/71 pages** (the same 12 Turbopack tracing warnings); **23/23**; **identical, 101 lines** |
| Platform Owner browser suites | the 12 suites on the compiled build | 760 / 760 | **760 / 760**, every suite equal (login race 51/51; user invitations 57/57) |
| Customer release-gate tier | `verify/run-browser-suites.mjs --skip-build` on a copy of the visual-baseline seed | 49 / 49 suites | **49 / 49**, 0 suites differing, 2,672 = 2,672 counted checks |
| Visual | the 256 states, compared with the PO-05 capture | 256 | **256 / 256 byte-identical** |
| HTTP probe | PO-05's probe of every route × anonymous / forged customer / forged platform session, plus the Server Action probes and the acceptance-page check | 318 responses; 30/30 | **318 responses, 0 differences from PO-05's 16.4.6 run**, 0 security-invariant problems (cookies, headers, redirects, forged sessions), the same status mix; **30/30** |
| PO-06 suites | rehearsal; data safety; readiness | — | **126/126; 72/72; 35/35**; and readiness with both rehearsals re-run on the final code: **37/37** (rehearsal 126/126, data safety 72/72) |

**The timing-sensitive check (finding N-5, Prompt 5 §J.2 check A).**

- **Attempt 1:** the chain stopped at its 7th suite. `verify:platform-containment` read 87/88. The failing check was
  "6 concurrent requests on an idle-expired session → all SESSION_EXPIRED, exactly one session.idle_timeout record".
- **Attempt 2:** the same commit, nothing changed: 88/88, and the whole chain passed. The suite passed 88/88 again
  in its own run.
- **What the failure is.** It is PO-05 §J.2 check A, the nondeterministic observation measured there (about 0.6–0.8 % of
  runs on both Next.js versions). One of the six concurrent requests can read the row after another request's
  revocation has committed. It is then refused as `UNAUTHORIZED`, not `SESSION_EXPIRED`.
- **What was never seen.** In PO-05's 1,600 study iterations, no idle-expired session was ever granted access, and never
  was there more or less than one expiry record.
- **Handling.** The assertion was not changed, weakened or skipped. Both results are reported, as decision N-5
  requires. The failed attempt's log is kept with the run's evidence.
- **Recommendation.** It stays the owner's test-only hardening decision (N-5).

**The PO-05 undo proof at the PO-06 head.**
- **The PO-05 layer itself undoes exactly:**
  - `package.json`: 3 hunks, byte-exact;
  - `package-lock.json`: 17 hunks, byte-exact;
  - only the lockfile pin moved.
- **The original script fails anyway (FAIL (21)).** Its allow-list names only PO-05's own additions, so it reports all
  21 PO-06 additions as "UNLISTED". That result is recorded, not hidden.
- **A PO-06-aware copy passes.** It runs every check unchanged and adds one rule:
  - a file PO-06 **added** since `08511d0` is allowed only under `scripts/platform/`, `verify/` or
    `docs/platform-owner/`;
  - a PO-06 modification, deletion or rename still fails it.
- **Its result: PASS.** 21 additions, 0 modifications, no `src/` or `drizzle/` path.

**Not re-run here:** `npm audit signatures`. Its Sigstore host is refused by this environment's network policy, as in
PO-05 (decision N-4). The offline registry-signature check above covers the 12 updated packages.

## J. Outstanding security findings

None is fixed in PO-06: no feature or ops change was authorized. The full classification is in
`po06/SECURITY_AND_FLAG_MATRIX.md` §4.

| Id | Finding | Blocks the first test-only staging? | Blocks production? |
|---|---|---|---|
| HF-1 | the Team-field exposure fix (`94f936e`) is still not on `main` or production | no (this branch carries it) | **yes** — a separate production security release (R-1) |
| N-2 | production runs Next.js 16.4.3 with seven advisories | no (staging builds 16.4.6) | **yes** |
| N-3 | 13 moderate npm audit findings (`uuid` through `exceljs`) | no | review |
| D6-F1 | a push after S08 would drop `user_invitations` | no (push never runs after S08) | yes, until L-3 |
| D6-F2 | PO-01's SQL has no shape check | no (the fingerprint refuses) | no (D-7 D7-09 checks first) |
| D6-F3 | no PO-01A rollback | no | an approved plan first |
| D6-F4 | without S04, ACCESS EXCLUSIVE on `users` | no (`--concurrent-indexes` always) | yes, until the production runbook mandates S01/S04 |
| EI-1 | `/register` has no unique-violation handler | no | review with E-1 |
| RB-1 … RB-7 | `backup.sh` / `restore.sh` defects (§H) | no (runbook workarounds) | fix RB-1, RB-2, RB-4, RB-6 and RB-7 before relying on the scripts |
| RB-8 | textual CHECK re-print | no | no |
| N-5 | two timing-sensitive older checks. Check A failed once in this regression and passed when re-run at the same commit (§I) | no | no |
| L-8 | the Team session correction has not had its release review | no | **yes** |

## K. Owner decisions

The whole sheet is `po06/OWNER_DECISION_SHEET.md`. **The development behaviour is a default, not an authorization.**
Nothing was decided on the owner's behalf.

| Needed before | Decisions |
|---|---|
| the first staging deployment | D-6 (staging, with `--concurrent-indexes`) · T (the Trial values) · N-1 (Next.js 16.4.6) · S-1 (host) · S-2 (database) · S-3 (domain) · S-4 (no external services) · S-5 (storage) · S-7 (activation policy and operator) · S-8 (backups, off-host location, key custodian) |
| specific switches on staging | L-3, L-4, L-7 (F5/F6, the staged `user_invitations`) · P-1, P-3, P-8 (F7, seat enforcement) · E-1 (the index on staging, optional) |
| production (not now) | D-6 production mode · D-7 · E-1 production · R-1 and N-2 (the production security release, recommended **first** and independently) · L-1, L-2, L-6, L-8 … L-10 · P-2, P-4 … P-7, P-9, P-10 · N-3, N-4 · D-8 |

## L. Exact remaining blockers

**The first test-only staging deployment has no technical blocker. Before it can start:**
1. The owner signs `po06/PROMPT7_APPROVAL_CHECKLIST.md`:
   - §1: the staging decisions in §K;
   - §2: the release SHA, the operator and window, the deployment log location, the stop authority, and the written
     confirmation that no production resource is used.
2. The staging host, domain, accounts and secrets are created. They do not exist yet; creating them is Prompt 7's work,
   after approval.
3. The readiness checklist and the regression are re-run green on the approved release SHA (runbook steps 5, 6 and 19).

**Production remains NO-GO. Each of these blocks it:**
1. HF-1 / R-1 — the Team-field fix is not released.
2. N-2 — production runs Next.js 16.4.3.
3. D-7 has not been run, so the real data's classes, duplicates and sizes are unknown.
4. E-1 is undecided — the PO-02D3 §D.4 release gate.
5. D6-F1 — L-3 is needed before any push after S08.
6. D6-F4 — a production runbook must mandate S01/S04.
7. D6-F3 — there is no PO-01A rollback.
8. The manifest tool has no production mode, by design (D-6).
9. RB-1, RB-2, RB-4, RB-6, RB-7 — the backup/restore script fixes.
10. L-8 — the release review.
11. N-3 — the review.

## M. Whether Prompt 7 is technically ready

**Yes, technically. CONDITIONAL GO** for the first test-only staging deployment.

**The technical evidence:**
- the D-6 manifest and tool pass scenarios A–O (126/126) with zero change to existing data;
- the backup/restore cycle is proven end to end (24/24);
- the D-7 bundle is validated (28/28);
- the e-mail index path is tested (18/18);
- the readiness checklist is green: 35/35, and 37/37 with both rehearsals re-run on the final code;
- the full regression equals the PO-05 baseline, including a complete `next build` (§I).

**Conditions — all are required:**
1. The owner's signatures (§L 1). The development defaults are not that approval.
2. The 20-step runbook (`po06/STAGING_DEPLOYMENT_RUNBOOK.md`) is followed exactly:
   - `--concurrent-indexes` always;
   - the RB workarounds;
   - one switch per restart;
   - every stop condition honoured.
3. F5/F6 only after L-3, L-4 and L-7. F7 only after P-1, P-3 and P-8.
4. Production stays untouched. Any sign that staging reaches a production resource is a stop condition (runbook
   step 20).

**Production: NO-GO** (§L).

## N. Proposed Prompt 7 — NOT executed

~~~text
ELITE ERP — LOCKED ROADMAP PROMPT 7 OF 16 — FIRST TEST-ONLY STAGING DEPLOYMENT (ISOLATED, FICTIONAL DATA)

Mode: test-only staging deployment. Production stays completely unchanged.

Baseline: Delowar01/Elite-ERP, branch feat/platform-owner at the release SHA the owner signs
(PO-06 head or later); main 621f156f7b129b9c2e289bc46d314ce7587beec2;
fix/team-sensitive-fields-exposure 94f936eb019be446282536b8fcdeede6ae9e510c; PR #11 draft.

0. PRECONDITION — STOP unless all hold:
   - docs/platform-owner/po06/PROMPT7_APPROVAL_CHECKLIST.md §1 and §2 signed by the owner
     (D-6 staging, T, N-1, S-1, S-2, S-3, S-4, S-5, S-7, S-8; the release SHA, operator, window,
     deployment-log location, stop authority, written "no production resource" confirmation);
   - verify-po06-staging-readiness green on the release SHA.

1. AUTHORIZED (only within the signed scope):
   - provision the approved NEW staging VM and staging-only domain/host names (never the Hostinger
     production VPS, never a production DNS name, account, storage or credential);
   - generate staging-only secrets ON the host (STAGING_ENV_TEMPLATE.md §7); never print them;
   - PostgreSQL 16 on 127.0.0.1 with a *_test_only_* database and least-privilege roles;
   - deploy the release SHA (npm ci from the lockfile; next build; systemd + nginx + TLS);
   - apply the D-6 manifest with release-manifest.ts --apply --base --concurrent-indexes --verify-data
     (S08/S09 only if L-3 is signed);
   - bootstrap one platform administrator (password + TOTP; secrets to the owner's password manager);
   - activate switches F0 → F4 one per restart with their checks; F5/F6 only after L-3/L-4/L-7;
     F7 only after P-1/P-3/P-8;
   - fictional invitation, Trial, seat and suspension tests (runbook steps 15–18);
   - the staging regression (STAGING_REGRESSION_SPEC.md) and a backup + restore drill.

2. NOT AUTHORIZED:
   - anything on production Neon, the Hostinger VPS or the production domain; any production SQL,
     including D-7 (it has its own approval);
   - real customer data; copying data from production or development;
   - outbound integrations (payments, messaging, live e-mail); real customer invitations;
   - merging, changing PR #11, changing main or the hotfix branch;
   - any application feature, dependency or schema change; db:push against any database;
   - starting Prompt 8.

3. EXECUTE docs/platform-owner/po06/STAGING_DEPLOYMENT_RUNBOOK.md steps 1–20 exactly; any stop
   condition → step 20 (switches off in reverse, stop the unit, rotate exposed secrets, record).

4. EVIDENCE: a deployment log per step (who, when, command, result; never a secret or connection
   string); screenshots without secrets, tokens or cookies; regression counts against PO-06; the
   restore drill results.

5. DELIVERABLE: docs/platform-owner/PO07_STAGING_DEPLOYMENT.md — host and SHA, every step's result,
   switch states, regression, backup/restore drill, incidents, findings, and a GO / NO-GO for
   broader staging testing.

FINAL STOP GATE: STOP after Prompt 7. No production change of any kind. Do not merge. Do not change
PR #11. Do not start Prompt 8.
~~~
