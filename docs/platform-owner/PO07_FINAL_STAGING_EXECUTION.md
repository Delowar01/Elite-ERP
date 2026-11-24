# PO-07 — Final staging execution plan (Prompt 7 completion), S12 deferred by owner

**Status (24 Nov 2026): prepared and CI-verified only. Nothing here has been executed on the VPS.** It needs the owner's
fresh written execution authorization (a window and its stages). The repository is public, so this document uses
placeholders; the owner's private companion has the real names, address and vhost text.

## A. The owner's decision: S12 deferred

**S12 — DEFERRED BY OWNER — REQUIRED BEFORE FINAL PRODUCTION DEPLOYMENT** (owner decision, 24 Nov 2026).

The system is still under development; the staging environment holds fictional test data only. The additional backup
infrastructure waits until the complete system is developed, tested, corrected, verified and ready for production:
- encrypted automated backups, an off-host copy and the restore drill;
- Backblaze B2, GPG keys, backup services and timers;
- any related subscription or expense.

It moves to **Prompt 15 — Production Readiness** (`PO07_PRODUCTION_GATES.md`).
- **Kept, not deleted:** the S12 tooling (`s12_backup.sh`, the backup and upload tools, the restore check), its
  documentation (`PO07_OWNER_GPG_B2_GUIDE.md`) and its CI verification. They are still rehearsed in every CI run.
- **Untouched:** every existing backup service, timer, database backup and recovery mechanism of the live ERP or any other
  application. The kit has never touched them, and this change adds nothing that could.

## B. The revised staging acceptance gates

| Gate | Requirement | Enforced by |
|---|---|---|
| S13 may start | S1–S9 done (S9b already done; never repeated) | the stage gates |
| | **website security verified**: `S11.tls-ok` (written only by a fully passing `s11-verify.sh --tls`), then `S11.phaseB-ok` (written only by a fully passing authenticated R1–R12 probe over verified TLS, after `S11.tls-ok`) | `s13_switch.sh` refuses without either record |
| | **S12 accepted OR validly deferred** | `s13_switch.sh`, re-checked at **every** run |
| | the switch is in the window's authorization; strict order; L-3 for F5/F6; the owner's P-8 consent for F7 | unchanged |
| The deferral is valid | recorded by `tools/s12-defer.sh` under **S12DEFER** in the authorization, bound to this host and staging database | `s12_deferral_valid` |
| | **and at that moment** every database URL in every env file is the isolated staging cluster (`127.0.0.1:<PG_PORT>/<DB>`), no env file mentions Neon, file storage is the fictional `fake` driver, and the database is a `_test_only_` one | `staging_only_reasons` |
| The deferral is never | S12 PASS (no `S12.done` is written), valid for production, real customer data or Neon | lint rules and CI tests |
| Staging acceptance | the above + F1–F7 on + the owner's functional checklist (§G) | `pc-kit.sh acceptance staging` |
| **Final production readiness** | **S12 ACCEPTED by its own restore drill** (a deferral never counts) **and** every Prompt 15 item closed | `pc-kit.sh acceptance production` — **always BLOCKED from the staging kit** |

**Staging acceptance is not production acceptance.** Staging acceptance means the Platform Owner work runs correctly,
securely and in isolation on fictional data, behind Basic Auth. Production acceptance is Prompt 15.

## C. Kit

kit-5 (revised): the S12 deferral, the recorded website gates, the acceptance report, and the PC commands for them.
- **80 files; manifest SHA-256 `c632357b0bdaf4cd6aca1fdecf1d5362389d240142e8a2b6d14986e1f1288b69` (digest `c632357b0bdaf4cd`).**
  It supersedes `d6f9bebf4929216e`; the owner reviews it before the window.
- **Verified by CI run 45507780271, all three jobs green.** The kit validation shows the CI copy is exactly a fresh render
  of this kit (same code).
- The approved release is unchanged: `cf64ebc492b56ad91c28ba3aa7640722935e21c5`, archive
  `df96cb5b12b5d2b5723e14f626a8619ef062c5d3d9fea990d67745ecca9e561c`.

## D. The coordinated execution, in order (one window; about 5–6 hours including DNS and certificates)

The window's authorization must list these stages: **RECONCILE PGRESTART S12DEFER S13 F1 F2 F3 F4 F5 F6 F7**. Add the
P-8 seat consent for F7. Any unexpected result is a **STOP**: report it to the owner, keep the evidence and change
nothing more.

**Who does what:**
- **CC** = Claude Code runs it, through `tools/pc-kit.sh`.
- **OWNER** = the owner does it, in CloudPanel, the DNS editor or their own terminal. **No credential ever passes
  through Claude Code.**

| # | Step | Who | Action | Pass condition |
|---|---|---|---|---|
| 1 | Fresh S0 | CC | `pc-kit.sh time`; `pc-kit.sh route`; `pc-kit.sh s0` | completes, read-only |
| 2 | Shared-service health | CC | from S0 and `pc-kit.sh footprint` | live ERP status, headers and certificate fingerprint, other sites, `nginx -t`, nginx master PID, cluster `main` and §I all as at B4 |
| 3 | Baseline chain | CC | `pc-kit.sh compare <s0> --staged --trace`; `pc-kit.sh verify-source` | the chain traces B0 → B4; every difference is STAGING or registered KNOWN; the approved source verifies |
| 4 | Revised kit installation | CC | `pc-kit.sh update <s0> "<owner go-ahead>" "<stages>"` | one verified stream; the digest equals the reviewed one; replaced kit files kept; nothing restarted |
| 5 | Installed-file reconciliation | CC | `pc-kit.sh reconcile --report` | 16 UNCHANGED, `20-tasks.conf` PROPOSED, the 6 S12 files NOT-INSTALLED (S12 deferred). **Anything else: STOP, report file by file** |
| 6 | PostgreSQL `TasksMax=64` | CC | `pc-kit.sh reconcile --execute /etc/systemd/system/postgresql@16-<cluster>.service.d/20-tasks.conf` | PROPOSED → installed; previous state kept; daemon-reload only |
| 7 | Controlled staging PostgreSQL restart | CC | `pc-kit.sh run PGRESTART --execute`, then `pc-kit.sh run S9 --execute` (re-check only) | the staging cluster alone restarts; apps back in seconds; `pids.max` 64; `main` unchanged; S9 re-check and R-tests pass |
| 8 | S11a-A: protected sites (closed) | OWNER, then CC | §F.1; then `pc-kit.sh s11-verify --pre` (before) and `--phase A` (after) | every protected path 401; nothing of the app reachable; nginx unchanged except the two new sites |
| 9 | S10: DNS | CC, OWNER, CC | `pc-kit.sh dns-check --before`; §F.2; `pc-kit.sh dns-check --after` | exactly two A records to the VPS, TTL 300; the ERP record unchanged |
| 10 | S11b: trusted certificates | OWNER, then CC | §F.3; `pc-kit.sh s11-verify --tls` | trusted chain, exact name, ≥ 30 days, renewal job; **records `S11.tls-ok`** |
| 11 | S11a-B: proxy routes | OWNER, then CC | §F.4; `pc-kit.sh s11-verify --phase B` | the exact allow-list; HSTS 300; unauthenticated matrix pass |
| 12 | R1–R12 | OWNER | `bash /root/elite-po-kit/tools/s11-owner-probe.sh` in the owner's own SSH terminal (types the two Basic Auth logins; nothing echoed) | `S11-PROBE phase=B … fail=0` and `RECORDED …/S11.phaseB-ok`. The owner tells CC only those two lines |
| 13a | S12 deferral record | CC | `pc-kit.sh run S12DEFER --execute`; `pc-kit.sh run S12DEFER --status` | "valid for this isolated fictional-data staging only"; no `S12.done` |
| 13b | S13 F1–F7 | CC (+ OWNER checks) | §G, one switch per run | each switch's automated checks pass, then the owner's checks for it |
| 14 | Staging functional acceptance | OWNER | §G checklist in the browser, fictional data only | every item recorded by the owner |
| 15 | Final health and resources | CC | `pc-kit.sh s0`; `compare --staged --trace`; `footprint`; `pc-kit.sh acceptance` | shared services as at step 2; staging footprint within §F; `STAGING: COMPLETE`, `PRODUCTION: BLOCKED` |

**Rollback points:**
- F*n* → `run S13 --execute Fn off`, in reverse order.
- Phase B → paste Phase A again.
- The sites → delete both in CloudPanel; the nginx tree returns to its step-8 checksum.
- DNS → delete the two records.
- D2 → `reconcile --execute --restore` plus `run PGRESTART --execute`.
- The deferral → withdrawn by rollback S12.

## E. The websites

| Portal | URL | Protection, in order |
|---|---|---|
| Platform Owner | `https://<ADMIN_HOST>` | Basic Auth (its own login) → HTTPS (Let's Encrypt, HSTS 300) → host binding (only the console exists here) → console sign-in with password **and TOTP MFA** (the existing administrator; never re-bootstrapped) |
| Customer ERP test | `https://<CUST_HOST>` | Basic Auth (a different login) → HTTPS → host binding (no console here) → customer sign-in |

**Behind both:**
- Server Action origin checks;
- the apps reachable only through two Unix sockets (no TCP listener);
- the isolated database in its own namespace;
- fictional data only.

There is no unrestricted public access.

## F. Owner instructions (do these yourself; never paste a password into an AI session)

The real host names, the VPS address and the exact text to paste are in your private companion. Menu names may differ
slightly between CloudPanel versions. If something looks different, stop and ask before saving.

### F.1 CloudPanel — create the two sites, closed (step 8)

For each host (`<ADMIN_HOST>`, then `<CUST_HOST>`):
1. Log in to CloudPanel in your browser.
2. **Sites → Add Site → Create a Static HTML Site.**
   - Domain Name: the host.
   - Site User: a new name, e.g. `po07admin` / `po07cust`.
   - Site User Password: a strong one, saved in your password manager and never used for anything else.
   - Create.

   CloudPanel issues its own temporary self-signed certificate.
3. Open the site → **Security** → **Basic Authentication**. Turn it on with a user name and password **different for
   each site**, saved in your password manager. Save.
4. Open **Vhost**.
   - Keep these generated lines: `listen`, `server_name`, the certificate lines, the logs, the Basic Authentication
     lines, the http → https redirect, and the `/.well-known` block. If that block lacks `auth_basic off;`, add only
     that line inside it.
   - Delete every other `location { … }` block.
   - Paste **Phase A** for this host from the private companion, inside the server block, after the kept lines.
5. **Save.** CloudPanel tests the configuration and reloads nginx. If it reports an error, do not force it: tell Claude
   Code.
6. Tell Claude Code "site <host> saved (Phase A)". It runs the read-only checks.

### F.2 DNS — add the two records (step 9)

Only after Claude Code reports `dns-check --before` PASS.
1. Open your DNS provider's panel → the zone `<ZONE>` → DNS records.
2. **Add record:** type **A**, name `<ADMIN_LABEL>`, points to `<VPS_IPV4>`, TTL **300**. Save.
3. **Add record:** type **A**, name `<CUST_LABEL>`, points to `<VPS_IPV4>`, TTL **300**. Save.
4. Add nothing else: no AAAA, no CNAME, no wildcard. Edit or delete no existing record.
5. Tell Claude Code "DNS added". It waits for propagation (up to about 10 minutes) and runs `dns-check --after`.

### F.3 CloudPanel — trusted certificates (step 10)

Only after `dns-check --after` PASS. For each site:
1. Open the site → **SSL/TLS** → **Actions** → **New Let's Encrypt Certificate**.
2. The domain is only the site's own host (no `www`) → **Create and Install**.
3. Tell Claude Code "certificates issued". It runs `s11-verify --tls`, which records `S11.tls-ok` on a full pass.

If issuance fails, the sites stay closed (Phase A). Nothing is proxied, and S13 cannot start.

### F.4 CloudPanel — open the routes (step 11)

Only after `S11.tls-ok` is recorded. For each site:
1. **Vhost**: replace the Phase A block with **Phase B** from the private companion. Keep the generated lines; HSTS
   `max-age=300` is part of Phase B.
2. **Save.** Tell Claude Code. It runs `s11-verify --phase B`.

### F.5 Your R1–R12 run (step 12)

In **your own** terminal:
```
ssh -t <your VPS alias>      (or the NAT64 form)
bash /root/elite-po-kit/tools/s11-owner-probe.sh
```
- Enter each site's Basic Auth user and password when asked. The password is not shown.
- Tell Claude Code only the last lines: `RECORDED …` and `S11-PROBE phase=B pass=… fail=0`.

## G. F1–F7 activation (steps 13b–14)

For each switch, in order:
1. CC: `pc-kit.sh run S13 --execute Fn on`. The tool:
   - rewrites one line;
   - restarts only the two staging app units;
   - checks the process environment, the console route and both surfaces, and that no error was logged;
   - on any failure, reverts the switch and STOPs.
2. OWNER: the checks for that switch, in the browser, with fictional records only.
3. OWNER says "Fn accepted" before the next one. Any failure → CC: `run S13 --execute Fn off`.

| Step | Switch | The owner's checks |
|---|---|---|
| F1 | console | sign in to the Platform Owner portal with the existing administrator, password + TOTP; a wrong code is refused and throttled; idle timeout; sign-out revokes the session; the console exists only on the admin host |
| F2 | tenant enforcement | company management; suspend a fictional company → its sessions end and sign-in is refused; restore → a fresh sign-in works; other companies unaffected; step-up for sensitive actions |
| F3 | company invitations | create, revoke, re-issue; the link is shown once and points at `https://<CUST_HOST>`; audit records |
| F4 | invitation acceptance | onboarding: one company, one primary owner, one Trial (14 days, 3 seats); reuse and expiry refused; primary-owner management |
| F5 | user invitations | a pending invitation occupies a seat; revoke and re-issue |
| F6 | user invitation acceptance | the user is created in the right company without a second seat; reuse refused |
| F7 | seat enforcement (with P-8) | the 4th user is refused on every path with nothing written; a company above its allowance keeps its users |

**Across all switches (step 14):**
- session revocation;
- the existing customer ERP (sales, purchases, inventory, accounting basics on fictional data);
- **English and Arabic** (RTL mirrored; numbers, dates and currency left-to-right);
- **desktop and mobile**, **light and dark**;
- **PDF generation**;
- **private file storage** (a fictional upload is visible only to its own company).

Then CC runs step 15. The administrator account and its MFA enrollment are used as they are: S9b is never repeated, and
no key is rotated.

## H. Still tracked, not part of staging acceptance

`PO07_PRODUCTION_GATES.md`:
- S12 backups and the restore drill;
- production database migration and recovery preparation;
- the external attested production build;
- the independent production ERP security release;
- the PDF concurrency limiter;
- PO07-A11Y-01;
- the intermittent invitation-acceptance check B10.
