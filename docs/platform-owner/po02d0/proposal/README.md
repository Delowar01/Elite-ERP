# PO-02D0 proposal artifacts — DO NOT EXECUTE

These files are a **proposal for owner review** (PO-02D0). They are not migrations:

- they are not in `drizzle/`, `drizzle/platform/` or the drizzle-kit journal, and no runner reads this directory;
- every file that would change a database (foundation, concurrent index, seed, rollback) starts with a guard that
  aborts execution (`PO-02D0 PROPOSAL — not approved for execution`) inside its transaction, under
  `\set ON_ERROR_STOP on`; the seed file is also deliberately invalid SQL until owner-approved values replace its
  `<<APPROVED:…>>` tokens. The verification file has no guard: it only reads (READ ONLY transaction, ROLLBACK);
- the four writing files were never executed, and no file was checked by an SQL parser (schema execution was not
  authorized, and installing a parser was refused by this environment's permission policy). The read-only verification
  file was run once on a disposable branch-shape database to prove its skip path (`../../PO02D0_DECISIONS.md` §G.12).
  PO-02D1, once approved, must first prove every file on disposable `*_test_only_*` databases (catalog equivalence with
  the Drizzle schema, idempotency, shape refusals, lock measurements, rollback) — see §G and §L there.

| File | Proposed role in PO-02D1 |
|---|---|
| `PO02D1_users_org_id_id_concurrently.proposal.sql` | Production runbook: build `users_org_id_id_uq` without blocking `users` writes (autocommit) |
| `PO02D1_onboarding_foundation.proposal.sql` | The foundation: F1–F8 and three guard functions, retry-safe and shape-checked, one transaction |
| `PO02D1_seed_trial_and_settings.proposal.sql` | Template: settings row + default Trial v1 — only with owner-approved values |
| `PO02D1_verify_readonly.proposal.sql` | Read-only verification / drift detection after the migration |
| `PO02D1_rollback.proposal.sql` | Removes exactly the PO-02D1 objects; refuses while onboarding data exists |

Production application of any of them remains owner decision **D-6** (mechanism) after **D-7** (read-only measurements).
