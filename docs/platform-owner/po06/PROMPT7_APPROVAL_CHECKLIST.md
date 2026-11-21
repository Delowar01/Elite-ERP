# PO-06 — Prompt 7 approval checklist (the first test-only staging deployment)

Prompt 7 may begin **only** when every line in §1 and §2 carries the owner's initials and date. The automated part
(§3) must be green on the release SHA. None of this authorizes anything on production: production keeps its own
gates (§4).

## 1. Owner decisions (from `OWNER_DECISION_SHEET.md`)

| ✓ | Decision | What the owner signs |
|---|---|---|
| ☐ | D-6 (staging) | "the D-6 manifest may be applied to the staging database, with `--concurrent-indexes`" |
| ☐ | T | "the Trial values (14 days · 3 seats · 5 GB · all modules · 0 grace · alerts on · SAR 0.00) for staging" |
| ☐ | N-1 | "Next.js 16.4.6" |
| ☐ | S-1 | provider, account (separate from production), size of the new staging VM |
| ☐ | S-2 | "the staging database is PostgreSQL 16 on the staging host, loopback only, named `*_test_only_*`, least-privilege roles" |
| ☐ | S-3 | the staging-only domain and the two host names |
| ☐ | S-4 | "no external services; outbound traffic denied by default" |
| ☐ | S-5 | "the test storage driver", or a named dedicated staging store |
| ☐ | S-7 | the activation policy F0 → F7, and the named operator |
| ☐ | S-8 | the backup schedule, the off-host location, the key custodian |
| ☐ | E-1 (optional for staging) | "install `users_email_lower_uq` on staging" |
| ☐ | L-3, L-4, L-7 (only for F5 / F6) | "the staged `user_invitations` table and the user-invitation switches on staging" |
| ☐ | P-1, P-3, P-8 (only for F7) | "seat enforcement on staging" |

## 2. The deployment itself

| ✓ | Item |
|---|---|
| ☐ | the exact release SHA of `feat/platform-owner` |
| ☐ | the operator(s) and the time window |
| ☐ | where the deployment log is kept (no secrets in it) |
| ☐ | who may stop the deployment, and how they are reached |
| ☐ | written confirmation that no production credential, DNS record, storage, database or VPS is used |

## 3. Automated readiness (must be green on the release SHA)

`npx tsx --conditions=react-server verify/verify-po06-staging-readiness.mts` checks, and fails closed on:
- the D-6 manifest against the repository (checksums, sizes, timeouts, order, coverage);
- the dependency versions against the PO-05 baseline (Next.js and `eslint-config-next` 16.4.6, React 19.2.4);
- every switch still off by default in the code;
- the env template naming every environment variable the code reads;
- the D-7 procedure's recorded SHA-256 matching the bundle;
- every PO-06 document present, with its required sections;
- the decision sheet covering L-1 … L-10, P-1 … P-10, N-1 … N-7, D-6, D-7, E-1, S-1 … S-8 and R-1;
- no secret, credential or production host in the PO-06 files.

With a test database it also runs the two rehearsal suites (`--with-rehearsals`). The regression of
`STAGING_REGRESSION_SPEC.md` and the complete `next build` are run and recorded separately.

## 4. Still NOT authorized by this checklist

- anything on production: Neon, the Hostinger VPS, the production domain;
- a D-7 run against production or a Neon branch of it — that has its own approval (`D7_AUDIT_PROCEDURE.md` §3);
- merging any branch, or changing PR #11;
- the production security release R-1 — its own approval.
