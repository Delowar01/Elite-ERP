# PO-06 — The first test-only staging deployment: the Prompt 7 runbook (NOT executed)

**Status:** a plan for Prompt 7. Nothing in it was run in PO-06. Every step runs only after the owner's written approval
(step 1). All demonstration data is fictional (`.test` addresses, invented companies).

**Forbidden at every step:**
- production credentials, production DNS records, production storage, live messaging or payment services;
- any connection to production Neon or the Hostinger production VPS.

Each step has a stop condition. When it triggers, the operator stops and goes to step 20 instead of improvising.

| # | Step | Exactly | Stop if |
|---|---|---|---|
| 1 | **Owner approval gate** | the owner signs `PROMPT7_APPROVAL_CHECKLIST.md`: the decisions of `OWNER_DECISION_SHEET.md` marked "blocks staging", the host and domain (S-1, S-3), the release SHA, the operator, the window | any line unsigned |
| 2 | Approved host and domain | a NEW VM per `STAGING_INFRASTRUCTURE.md` §2 (never the Hostinger production VPS); firewall inbound 443/80/22-allow-list, outbound deny-all; DNS for `<STAGING_CUSTOMER_HOST>` / `<STAGING_CONSOLE_HOST>` under the staging-only domain; TLS certificates; nginx; PostgreSQL 16 on 127.0.0.1 only; Node 22; Chromium | the host is shared with anything in production, or PostgreSQL listens beyond loopback |
| 3 | Staging-only secrets | generate every secret on the host, into the `0600` env file and pgpass files, per `STAGING_ENV_TEMPLATE.md` §7. Escrow `AUTH_SECRET` and `FIELD_ENCRYPTION_KEYS`. The backup key pair is created offline; only the public key goes on the host, with its ownertrust set | any value copied from production or development; any secret printed or pasted into chat |
| 4 | Fresh backup | the staging database does not exist yet, so: create `<STAGING_DB>` (name contains `_test_only_`), then run `scripts/backup.sh` once on the empty database to prove encryption, retention and the off-host copy work end to end (`BACKUP_RESTORE_EVIDENCE.md` §4) | the backup fails, or a plaintext dump remains (RB-4) |
| 5 | Release SHA verification | `git fetch` the approved SHA of `feat/platform-owner` into a clean checkout; check `git rev-parse HEAD` equals the approved SHA and `git status` is clean; `npm ci` from the lockfile; `npm ls next` = 16.4.6 | any difference |
| 6 | Isolated database preflight | `release-manifest.ts --check` (files) and `--status` (read-only): a new, empty database | any finding other than the expected "empty database" |
| 7 | Migration sequence | `release-manifest.ts --apply --base --concurrent-indexes --verify-data` (B00, S00–S07). Each step is pinned and verified; the preflight runs after each | exit ≠ 0 |
| 8 | Trial seed | included in step 7 (S07, the guarded seed runner). Confirm `--status` shows the seed complete with the approved values (T-1 … T-8) | seed not `complete` |
| 9 | `user_invitations` installation | only if L-3 is approved: `release-manifest.ts --apply --concurrent-indexes --include-staged-user-invitations --verify-data` (S08, S09). Otherwise skip: the user-invitation switches stay off | exit ≠ 0; S09 preflight not exactly the two staged-table statements |
| 10 | Full schema verification | `npm run platform:db:check` (read-only), `--status`, `npm run verify:db-hardening` against the staging database (owner role) | any failure |
| 11 | Next.js build | `npx next build` on the host (NODE_ENV=production, the staging env file loaded). Must exit 0 with the advisory gate untouched; 71/71 pages | exit ≠ 0; any instruction printed by the build is ignored, never followed |
| 12 | Startup and HTTPS verification | start the systemd unit; nginx → 127.0.0.1:3000. Check TLS (certificate, TLS 1.2+), HSTS and the security headers, `__Host-` cookies, `http://` redirecting to `https://`, `/platform` answering as absent (the console switch is still off) | any header or cookie missing; the console reachable |
| 13 | Platform admin login and MFA | `npm run platform:bootstrap` on the host (interactive; loopback `_test_only_` database); secrets into the owner's password manager. Then switch F1 (`SECURITY_AND_FLAG_MATRIX.md` §2): sign in with password + TOTP; a wrong code refused and throttled; one recovery code used once; sign-out revokes | any check fails → F1 off |
| 14 | Flag activation sequence | F2 → F7 in order, one switch per restart, each with its checks (matrix §2) — F5/F6 only after L-3, F7 only with the owner's consent (P-8) | any check fails → that switch off, then step 20 |
| 15 | Test invitation creation and acceptance | with F3/F4: invite "Fictional Staging Co" to `owner@staging-fixture.test`; copy the one-time link (it points at `CUSTOMER_PUBLIC_ORIGIN`); accept; check one company, one owner, the audit trail; replay the link (refused) | a second company, or a link to any other origin |
| 16 | Test Trial subscription assignment | the accepted company holds Trial v1: 14 days, 3 seats, SAR 0.00, module groups as seeded; the console shows it | any value differs from T-1 … T-8 |
| 17 | Test seat enforcement | with F5–F7: fill the 3 seats (owner + 2 invited users); a 4th via Team Add Member, invitation, re-issue and acceptance is refused with nothing written | any 4th seat granted |
| 18 | Test company suspension and session revocation | with F2: suspend the fictional company while one of its users has an open session; the next request signs them out; sign-in refused; restore; a fresh sign-in works; the audit trail records both | any request served while suspended |
| 19 | Full customer ERP regression | the regression of `STAGING_REGRESSION_SPEC.md` against the staging build: the server, static and security suites (on a disposable copy of the staging schema on the host), the browser checks against `https://<STAGING_CUSTOMER_HOST>`, ACC-01, and the HTTP probe | any regression against the PO-05 baseline |
| 20 | Rollback triggers and procedure | **Triggers:** any stop condition above; a secret exposed; staging reaching any production resource; data that is not fictional. **Procedure:** (a) switches off in reverse order (matrix §2), restart; (b) if the release is bad, stop the unit; (c) schema rollback only through the manifest (`--rollback --to=R08` … `R03`; each refuses while its tables hold rows — the first staging deployment holds only fictional data, so the normal path is to drop and re-create the whole staging database from B00 instead); (d) rotate any exposed secret; (e) record what happened. Production is never touched: there is nothing to roll back there | — |

## The rule for every step

The deployment log records, for each step: who ran it, when, the command (never a secret or connection string), and the
exit status or check result. Screenshots never show a secret, a connection string, a token or a session cookie.
