# PO-06 — Regression specification for the staging release candidate

The baseline is the PO-05 regression on `f85acb9`, re-run in PO-06 on the PO-06 head (the handover's §I has the
numbers). For the staging release candidate, the same matrix runs again. "Same" means identical counts; any difference
is investigated before go-live, and no assertion is weakened.

| Tier | Command | PO-05 baseline | Where it runs for staging |
|---|---|---|---|
| Dependency / build | `npx tsx verify/verify-po05-security-update.mts -- --build`; `npx next build` | build exit 0, 71/71 pages | the staging host, on the release SHA |
| TypeScript / lint | `npx tsc --noEmit`; `npx eslint src --max-warnings=0`; `npx eslint src tests scripts verify` | exit 0; exit 0; the same 28 pre-existing findings | CI or the staging host |
| Platform Owner suites | `npm run verify:platform` (28 suites) | 2,634 / 2,634 | the staging host, against disposable `*_test_only_*` databases on its own loopback PostgreSQL — never the staging database itself |
| Static suites | `npm run verify:static` (22 suites) | 1,919 / 1,919 | as above |
| Customer server suites | `npm run verify:server` (25 suites) | 1,137 / 1,137 | as above |
| Finance | ACC-01 inventory costing / project costing | 171 / 50 | as above |
| Security | `tests/security/access-control`, `crypto-policy`, `platform-boundary` | 22 / 18 / 218 | as above |
| PO-06 | `verify/verify-po06-staging-readiness.mts`, `verify-po06-migration-rehearsal.mts`, `verify-po06-data-safety.mts` | the PO-06 handover's counts | as above |
| Browser | the Platform Owner browser suites (760 checks) and the customer release-gate tier | 760 / 760; 49 / 49 suites | against the deployed staging URLs, with fictional data, read-only where the suite allows |
| HTTP probe | the PO-05 probe: every route × anonymous / forged customer / forged platform session, plus the Server Action probes | 318 responses, no unexpected difference | against `https://<STAGING_CUSTOMER_HOST>` |
| Visual | the 256 visual states | byte-identical to the PO-05 set | against the staging build, by fictional-data screenshot |

Rules:
- no suite is skipped silently;
- a timing-sensitive check (N-5) is re-run at the same commit, and both results are recorded;
- every database the suites use is a disposable `*_test_only_*` database — the suites never write to `<STAGING_DB>`.
