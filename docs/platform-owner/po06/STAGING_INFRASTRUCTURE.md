# PO-06 — Isolated staging architecture (requirements; nothing provisioned)

**Status:** preparation only. No server, database, domain, certificate, account or secret was bought, created,
accessed or deployed in PO-06. Angle-bracket names are placeholders. Creating any of these resources is part of Prompt 7
and needs the owner's separate approval (decisions S-1 … S-8 in `OWNER_DECISION_SHEET.md`).

## 1. The shape, in one picture

~~~text
  owner / testers (allow-listed)                      the internet
            │ HTTPS 443                                    ✗ nothing outbound by default (deny-all egress)
            ▼
  ┌────────────────────────── <STAGING_HOST>: a NEW, dedicated VM — not the Hostinger production VPS ──────────────┐
  │  nginx (TLS termination, HTTP→HTTPS, HSTS)                                                                     │
  │    <STAGING_CUSTOMER_HOST>  ─┐                                                                                 │
  │    <STAGING_CONSOLE_HOST>   ─┴─► 127.0.0.1:3000  next start  (one Next.js build: the customer ERP and /platform) │
  │                                       │  DATABASE_URL = <APP_ROLE> over 127.0.0.1                              │
  │                                       ▼                                                                         │
  │                            PostgreSQL 16 (listen_addresses = '127.0.0.1')                                        │
  │                            database <STAGING_DB> whose name contains _test_only_   — fictional data only       │
  │                                                                                                                │
  │  backups: scripts/backup.sh → gpg (public key only) → /var/backups/elite-erp-staging → off-host copy (S-8)     │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        no route, credential, DNS record, storage bucket, webhook or network path to:
        production Neon · the Hostinger production VPS · the production domain's DNS · Vercel Blob production stores
~~~

Why the staging database is a PostgreSQL **on the staging host**, named `*_test_only_*`, listening on loopback only:
- every guarded PO-01…PO-06 tool works unchanged: the manifest tool, the release preflight, the Trial seed (its SQL
  refuses any other name by itself), `platform:bootstrap` and `platform:db:check`;
- no production mode has to be built, and none of those tools can be pointed at production by mistake;
- the database cannot be reached from the network at all.

The `_test_only_` marker is accurate here, because this staging database holds fictional data only.

## 2. Hosting (decision S-1)

| Requirement | Minimum | Notes |
|---|---|---|
| Server | a **new** virtual machine in a separate account or project from production; **never** the Hostinger production VPS, nor a container on it | separate credentials, separate billing scope, separate SSH keys |
| CPU / RAM / disk | 2 vCPU · 4 GB RAM · 40 GB SSD (+ 20 GB for backups if they are kept on the host) | `next build` peaked at about 1.5 GB RSS in PO-05; PostgreSQL with fictional data needs well under 1 GB |
| OS | a current LTS Linux (Ubuntu 24.04 LTS or equivalent), unattended security updates on | the PO-06 rehearsal used PostgreSQL 16.15 on Ubuntu 24.04 |
| Node.js | 22.x LTS (PO-05 regression ran on 22.23.4), installed from the distribution or a pinned tarball with a verified checksum | `npm ci` from the committed lockfile only |
| PostgreSQL | 16.x, the same major version as the rehearsal; ≥ 14 is required by the reviewed SQL | not exposed: `listen_addresses = '127.0.0.1'`; `pg_hba.conf` allows only local and 127.0.0.1 with `scram-sha-256` |
| Chromium | the distribution package, for the PDF renderer (`CHROMIUM_EXECUTABLE_PATH`) | stops the renderer from downloading a browser at runtime |
| HTTPS / TLS | a certificate for each staging host name (an ACME certificate for a staging-only name); TLS 1.2+; HSTS as the application already sends it | the certificate's private key stays on the host; never reuse a production certificate |
| Admin access | SSH key authentication only (no passwords, no root login), from allow-listed owner addresses; `sudo` for named operators; session logging | no shared accounts; keys revoked when staging is retired |
| Firewall | inbound 443/80 (nginx) and 22 (allow-list); everything else closed. Outbound **deny by default**, opened only for OS updates during maintenance | the firewall, not the application, is what guarantees "no live messages" |
| Time | NTP enabled | TOTP sign-in and token expiry depend on the clock |

## 3. Database (decision S-2)

| Requirement | Staging design |
|---|---|
| Separate | its own PostgreSQL on the staging host. No Neon project, branch or connection string; no `pg_dump` of production; no production import of any kind |
| Fictional data only | the companies, users and documents are created by the Prompt 7 runbook (§10 steps 15–18) or by the verification fixtures, with `.test` addresses |
| Name | `<STAGING_DB>`, containing `_test_only_` (the guard and the seed require it) |
| Least privilege | `<OWNER_ROLE>` for migrations and the bootstrap (DDL, used only by the operator on the host); `<APP_ROLE>` for the application (DML only — no DDL, no TRUNCATE, no trigger control; rehearsed in `verify-po06-migration-rehearsal` §S); `<BACKUP_ROLE>` (`pg_read_all_data`); `<AUDIT_ROLE>` (read-only by default) |
| Schema | installed by the D-6 manifest only: B00 (a new database) → S00 … S07, then S08 after L-3 (`D6_MIGRATION_RUNBOOK.md`). Never `drizzle-kit push` without the preflight, never `migrate` |
| Backup / restore | `scripts/backup.sh` with gpg (public key only on the host), retention 14 days, an off-host copy; a restore drill before go-live into a second disposable database on the same host (`BACKUP_RESTORE_EVIDENCE.md` §4) |

## 4. Applications (decision S-3)

| Requirement | Staging design |
|---|---|
| Customer ERP and Platform Owner console | the same Next.js build of the approved SHA; the console is the `/platform` branch of the same process, behind `PLATFORM_CONSOLE_ENABLED` |
| Test-only URLs and TLS | `https://<STAGING_CUSTOMER_HOST>` and `https://<STAGING_CONSOLE_HOST>` under a staging-only registrable domain. Neither is a sub-name of the production domain (recommended), so production HSTS, DNS and certificates are never involved |
| Canonical customer origin | `CUSTOMER_PUBLIC_ORIGIN=https://<STAGING_CUSTOMER_HOST>`: every invitation link points at staging |
| No route or cookie collision | separate host names. Both session cookies are `__Host-` cookies in production mode (`__Host-elite_erp_session`, `__Host-elite_erp_platform`): host-only, `Secure`, `Path=/`, never shared with another host. The two secrets are distinct from each other and from production's |
| Reverse proxy | nginx passes `Host` unchanged and sets exactly one `X-Forwarded-For` / `X-Forwarded-Host`; `PLATFORM_TRUSTED_PROXY_HOPS=1`. The origin guard refuses a comma-separated forwarded host |
| Process | a systemd unit running `next start` as an unprivileged user, `EnvironmentFile=/etc/elite-erp-staging/app.env` (0600 root), `Restart=on-failure`, `ProtectSystem=strict`, `NoNewPrivileges=true`, `PrivateTmp=true` |
| Robots | staging answers `X-Robots-Tag: noindex, nofollow` (nginx) and may sit behind HTTP basic authentication for testers (S-3) |

## 5. External services (decision S-4)

| Service | Staging rule |
|---|---|
| E-mail, SMS, WhatsApp | none configured. The invitation workflow is copy-link only. The firewall blocks SMTP and every provider API |
| Payments | no gateway, no keys. Manual billing only (Trial seed: `manual_billing = true`) |
| Real data | none. No production export, no customer document, no real person's name or address |
| Production webhooks | none registered toward staging. Staging sends none |
| File storage | `STORAGE_DRIVER=fake` (the test driver on the host's disk). No Vercel Blob token, unless S-5 approves a dedicated staging store |
| Exchange rates | `RATE_API_BASE` points at a local stub, or outbound traffic is blocked and the fetch fails closed (it records its attempt) |
| PDF renderer | the local Chromium; no runtime download |
| Monitoring and logs | host-local journald with a retention limit. Any log shipping (S-6) goes to a staging-only sink, never production's, and never with secrets or request bodies |

## 6. What PO-06 verified about this design, and what it did not

| Verified on the disposable loopback cluster | Not verified (needs the real staging host, Prompt 7) |
|---|---|
| the D-6 manifest on a new database and on a company database; rollback; refusals | TLS, nginx, firewall and DNS behaviour |
| a DML-only runtime role cannot run DDL, TRUNCATE or disable a trigger, and the audit trails stay append-only | the full application regression under `<APP_ROLE>` |
| the encrypted backup and restore cycle with `scripts/backup.sh` / `scripts/restore.sh` | off-host backup copy, real disk sizing, restore time at staging scale |
| the D-7 bundle's safety and answers on fictional data | production's actual D-7 numbers (D-7 needs separate approval) |
