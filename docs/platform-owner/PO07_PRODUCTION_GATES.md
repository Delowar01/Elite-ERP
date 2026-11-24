# PO-07 → Prompt 15 (Production Readiness): what final production acceptance still requires

Recorded 24 Nov 2026 so that nothing deferred or found during PO-07 is forgotten. **Staging acceptance (Prompt 7) is not
production acceptance.** None of these items blocks the isolated, fictional-data staging, and every one of them blocks
final production. The staging kit mirrors this list in `units/production-gates.tsv`, and `pc-kit.sh acceptance production`
always reports BLOCKED.

| # | Item | Origin | What closes it |
|---|---|---|---|
| S12 | **Additional automated backups and restore verification: DEFERRED BY OWNER — REQUIRED BEFORE FINAL PRODUCTION DEPLOYMENT** | owner decision, 24 Nov 2026 | daily encrypted backups (14-day retention), an independent off-host copy under Object Lock with a key that cannot delete, and a **passing restore drill**. The tooling, the owner guide (`PO07_OWNER_GPG_B2_GUIDE.md`) and the CI rehearsal are ready; only the owner's account, bucket, key pair and a window are missing |
| PROD-DB | Production database migration and recovery preparation | PO-07 scope | the migration plan for the production database, a verified recovery path (point-in-time or dump restore) and a rehearsal on a copy, never on the live database |
| PROD-BUILD | An external, attested production build | measured 24 Nov 2026: `next build` peaks at 2.8–2.9 GB and is OOM-killed under the on-VPS 1536M cap | a GitHub-hosted build with provenance, digest verification on the PC and the VPS, installation beside the live release, rehearsed rollback (`PO07_S10_S13_EXECUTION_PLAN.md` §12) |
| PROD-SEC | The independent production ERP security release (the Team sensitive-field fix + Next.js 16.4.6) | `PO07_ERP_SECURITY_RELEASE_PLAN.md` | N1 approved by the owner, the release branch reviewed and green, then PROD-BUILD |
| PDF-LIMIT | The PDF concurrency limiter (D7) | measured: a third simultaneous render would hit the unit's task cap | implementation and verification per `PO07_PDF_CONCURRENCY_SPEC.md`, in its own release |
| A11Y-01 | PO07-A11Y-01 accessibility issue | accepted temporarily | fixed and verified by the browser suites |
| B10 | Intermittent invitation-acceptance browser check B10 ("a signed-in customer sees 'You're signed in'") | failed once (run 45498360294), 98/98 in every other run | the cause found (test timing or application) and the suite stable over repeated runs; the check is never weakened |

The staging-only deferral (`tools/s12-defer.sh`) can never satisfy S12 here: it writes no `S12.done`, it is void outside
the isolated fictional-data staging (any other database URL, Neon, real storage), and the production gate does not
read it.
