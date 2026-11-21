# PO-06 supporting files — isolated staging preparation (no deployment, no production access)

The handover is `docs/platform-owner/PO06_STAGING_PREPARATION.md` (sections A–N). The files here are its evidence and
plans.

| File | What it is |
|---|---|
| `D6_MIGRATION_MANIFEST.json` | the deterministic D-6 manifest: order, SHA-256 and size of every reviewed SQL file, declared timeouts, catalog pins, retry, locks, failure, rollback |
| `D6_MIGRATION_RUNBOOK.md` | the manifest explained, the staging commands, the D6-F1 … F4 findings |
| `D6_REHEARSAL_RESULTS.md` | scenarios A–O on disposable databases: results and the lock measurements |
| `sql/d7_readonly_production_audit.sql` | the D-7 read-only bundle (production-safe; **not run against production**) |
| `D7_AUDIT_PROCEDURE.md` | what it measures, why it is safe, the owner's execution and approval procedure |
| `EMAIL_LOWER_UNIQUE_PROPOSAL.md` | the `users_email_lower_uq` proposal (decision E-1): the ten points |
| `STAGING_INFRASTRUCTURE.md` | the isolated staging architecture (requirements; placeholders only) |
| `STAGING_ENV_TEMPLATE.md` | every configuration variable by name, how each secret is generated and stored (no values) |
| `SECURITY_AND_FLAG_MATRIX.md` | the switches, the activation order and how each is turned back; the security controls; the open findings, classified |
| `BACKUP_RESTORE_EVIDENCE.md` | the encrypted backup / restore rehearsal, findings RB-1 … RB-8, and the separate recovery and rollback procedures |
| `STAGING_DEPLOYMENT_RUNBOOK.md` | the 20-step Prompt 7 runbook (not executed) |
| `STAGING_REGRESSION_SPEC.md` | the regression matrix for the staging release candidate |
| `OWNER_DECISION_SHEET.md` | every open decision: question, recommendation, risk, today's behaviour, what it blocks, reversibility, the approval needed |
| `PROMPT7_APPROVAL_CHECKLIST.md` | what must be signed before Prompt 7 |

Code added in PO-06 (scripts, tests and documents only; no application feature):
- `scripts/platform/release-manifest.ts`;
- `verify/verify-po06-migration-rehearsal.mts`, `verify/verify-po06-data-safety.mts`, `verify/verify-po06-staging-readiness.mts`;
- `verify/platform/po06-fixtures.ts`, `verify/platform/po06-email-child.mts`.

Run them with `npx tsx --conditions=react-server <file>`. They are deliberately **not** added to `package.json`, so no
frozen file changes.
