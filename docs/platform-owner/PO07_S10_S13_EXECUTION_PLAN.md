# PO-07 — S10–S13 final execution plan (kit-5), decisions D1–D8, rehearsal results and readiness

> **Superseded for execution by `PO07_FINAL_STAGING_EXECUTION.md` (24 Nov 2026).** The owner then deferred S12: it is
> **DEFERRED BY OWNER — REQUIRED BEFORE FINAL PRODUCTION DEPLOYMENT** (D9 below; `PO07_PRODUCTION_GATES.md`). This
> document stays the design and evidence record.

**Status (24 Nov 2026): prepared and rehearsed in isolated CI only. Nothing in this document has been executed on the
VPS.** The repository is public, so this document uses placeholders:
- No DNS record, CloudPanel site, nginx change, certificate, storage account, cloud credential or feature switch exists
  or was changed.
- The real values (`<VPS_IPV4>`, the host names, the web server's worker identity, the current DNS state, the rendered
  vhost text) are in the owner's private operational instructions, kept outside the repository. The owner's decisions
  are recorded in a private decision register.
- Every VPS step below needs its own written execution authorization (§0).

## 0. Approval levels and the owner's decisions D1–D8

Three different approvals. The first two never imply the third.

| Level | Meaning | State on 24 Nov 2026 |
|---|---|---|
| **T** — technical approval | the owner accepts a design or a value | D1–D8 approved |
| **L** — local implementation approval | build, test and rehearse in the repository and in isolated CI | granted for D1–D8 (D7: specification only, §11) |
| **X** — VPS execution authorization | an action on the VPS, inside a written window, with the stages listed | **none open.** The last one (S0–S9b, 24 Nov 2026, 18:00–22:00 Saudi time) was executed and accepted |

| # | Decision (approved 24 Nov 2026) | T | L | X |
|---|---|---|---|---|
| D1 | Kit-4, manifest `cbab8b7a0e19aa65`. Kit-5 (this round) supersedes it for the next window; its digest is in the final report for the owner's review | ✔ | ✔ | ✘ |
| D2 | PostgreSQL staging-only `TasksMax=64` (§3) | ✔ | ✔ | ✘ |
| D3 | Order S11a → S10 → S11b, fail-closed (§4) | ✔ | ✔ | ✘ |
| D4 | Basic Auth credentials owner-controlled: the owner types them, in a separate terminal (§4.3) | ✔ | ✔ | ✘ |
| D5 | Backblaze B2 for the off-host copy (§8, owner guide) | ✔ | ✔ | ✘ |
| D6 | The owner's own GPG private key, never on the VPS (§8) | ✔ | ✔ | ✘ |
| D7 | The PDF concurrency limiter design (`PO07_PDF_CONCURRENCY_SPEC.md`) | ✔ | spec only | ✘ |
| D8 | HSTS `max-age=300` only after trusted HTTPS is verified; no `includeSubDomains`, no `preload` (§6) | ✔ | ✔ | ✘ |
| D9 | **S12 DEFERRED BY OWNER — REQUIRED BEFORE FINAL PRODUCTION DEPLOYMENT.** A staging-only deferral (`tools/s12-defer.sh`, S12DEFER) lets S13 proceed on the isolated fictional-data staging; it is never S12 PASS and never valid for production, real data or Neon. Moved to Prompt 15. D5 and D6 stay recorded for Prompt 15 | ✔ | ✔ | ✘ |

**Date correction:** several documents had dated the post-window work "25 Nov 2026". It all happened on the evening of
**24 Nov 2026** (Saudi time), the same day as the window. All references are corrected.

## 1. S0–S9b closure (owner decision of 24 Nov 2026: ACCEPTED) — unchanged

| Item | State |
|---|---|
| Approved source | `cf64ebc492b56ad91c28ba3aa7640722935e21c5`, tree `6403cf5d822df491f6e16a56068ab9d7c2f1f138` |
| Approved build | run 45228504829; archive SHA-256 `df96cb5b12b5d2b5723e14f626a8619ef062c5d3d9fea990d67745ecca9e561c`; build `zsnzn4exuiKvGWNoIKHtj` |
| Development head | `3de1f449250ea8f9dc9a622ebe8ace02fafeafa1` at the start of this round; later commits touch only `ci/`, `.github/` and `docs/` |
| Installed kit | kit-3, manifest `7177fade9cdda9b4`. Neither kit-4 nor kit-5 is on the VPS |
| Staging on the VPS | S1–S9b complete; one administrator with MFA; keys rotated 24 Nov 2026; no feature switch on; no nginx route |

**Preserved; never repeated without a new decision:**
- the installed application and its read-only tree;
- the administrator and its MFA enrollment (S9b is never repeated);
- the rotated keys;
- the staging database;
- every STOP record and all execution evidence.

## 2. Kit-5 and the installation and reconciliation procedure for the next window

**Kit-5 adds to kit-4's K1–K6:**
- **S11:** the kit-owned vhost text (Phase A closed, Phase B allow-list); read-only checks; the owner-terminal probe;
  the DNS check.
- **S12:** encrypted backup, the off-host uploader, the restore check and the owner-PC drill tool.
- **S13:** the switch tool.
- **D2:** the capacity check and the cap's drop-in.

The kit's systemctl allow-list gains `restart` (S13's two app units, D2's staging cluster unit) and `clean --what=state`
(rollback S12). Every unit must still match the staging-unit allow-list.

**The procedure, in this order. Any unexpected result is HOLD: report it to the owner and change nothing.**
1. **Clock and route:** `pc-kit.sh time`; `pc-kit.sh route` (IPv4, or NAT64 on a network without IPv4; strict
   host-key checking either way).
2. **A fresh S0** (read-only, streamed; nothing written on the VPS), then `compare <new s0> --staged --trace`:
   - the chain must trace from B0 (22 Nov) to B4 (post-S9b);
   - `verify-source --github` must pass;
   - every difference must be STAGING (a kit resource, by name) or registered KNOWN with the owner's acceptance;
     anything else is HOLD.
3. **Shared-service health** (read-only):
   - the live ERP: public status, headers and certificate fingerprint;
   - every other site's status;
   - `nginx -t`, the nginx master PID;
   - the cluster `main`'s config hashes and postmaster PID;
   - the §I guard.

   They must equal S0/B4.
4. **Install the final kit:** `pc-kit.sh update` (one verified stream over one connection).
   - The digest must equal the one the owner reviewed.
   - Every replaced kit file is kept under `state/retired/<ts>/` (never deleted).
   - **Nothing is restarted or reloaded, and no installed system file is touched**: the update writes only the
     kit's own directory.
5. **The read-only reconcile report:** `pc-kit.sh reconcile --report`. Expected:
   - every S2/S3/S6/S9 file UNCHANGED;
   - the D2 drop-in PROPOSED;
   - the six S12 files NOT-INSTALLED.
6. **Report every difference.** OUTDATED, MODIFIED, MISSING, WRONG-OWNER-OR-MODE, NOT-A-FILE and UNEXPECTED are
   listed file by file to the owner. They block every stage, and none is fixed automatically.
7. **Reconcile only individually authorized files:** `reconcile --execute <dest>`, with RECONCILE in that window's
   stages; one named file per decision, never "all".
   - The previous version is kept read-only under `state/installed-previous/<ts>/` and the change is logged.
   - Unit files get a `daemon-reload` only. **No restart**: a restart is its own authorized step.
   - `reconcile --execute --restore <dest>` puts the kept version back.

**Reconcile states** (unchanged from kit-4):

| State | Effect |
|---|---|
| UNCHANGED, NOT-INSTALLED | none |
| PROPOSED | never blocks; installed only by an authorized reconcile |
| OUTDATED(kit-N) | blocks; an authorized reconcile may replace it |
| MODIFIED, MISSING, WRONG-OWNER-OR-MODE, NOT-A-FILE, UNEXPECTED | blocks; owner review; never replaced by the kit |

## 3. PostgreSQL `TasksMax=64` for the staging cluster's unit only (D2)

**Derivation** (the configured capacity, not the slice arithmetic):
- postmaster 1;
- auxiliary processes 5;
- `max_connections` 30;
- `autovacuum_max_workers` 3;
- `max_worker_processes` 8;
- pg_ctlcluster's helpers 3.

That totals **50 ≤ 64**. A client beyond `max_connections` is refused by PostgreSQL ("too many clients") before the
cap can matter. Unchanged:
- admin 128, customer 320, slice 512;
- every memory and CPU limit;
- the cluster `main` and its unit.

The caps are ceilings, not reservations.

**Before applying (read-only, `tools/pg-capacity.sh`):**
- It proves it is talking to the staging cluster (`cluster_name`).
- It prints the settings that drive the task count:
  - `max_connections`, `superuser_reserved_connections`, `reserved_connections`;
  - `autovacuum_max_workers`, `max_worker_processes`, `max_parallel_workers`, `max_parallel_workers_per_gather`;
  - `max_wal_senders`.
- It shows the current backends and the unit's current and peak tasks.
- It refuses (exit 3) if the configured capacity exceeds the cap.

Maintenance (autovacuum, `VACUUM --jobs`, `pg_dump`/`pg_restore`) runs inside `max_connections` and the autovacuum
workers, so it is covered by the same count.

**Installation, in a window that authorizes RECONCILE and PGRESTART:**
1. `pg-capacity.sh` → OK.
2. `reconcile --execute /etc/systemd/system/postgresql@16-<cluster>.service.d/20-tasks.conf` (daemon-reload only).
3. **`tools/pg-restart.sh --execute`**: the controlled restart of **the staging cluster unit only**. It runs under the
   stage gates (window, PGRESTART authorization, the installed-files gate, the §I guard), and refuses without PGRESTART.
   - It runs the capacity check again.
   - It resets the start-rate counters and restarts the unit. The two app units restart with it (`Requires=`): expect a
     few seconds of staging downtime and nothing else.
4. The tool then verifies:
   - both apps answer;
   - the configured `TasksMax` (64) is what the cgroup enforces (`pids.max`);
   - the staging cluster answers;
   - `main`'s postmaster PID is unchanged;
   - the §I guard.

   Then the S8/S9 checks and the R-tests.
5. **Rollback:** `reconcile --execute --restore` and `pg-restart.sh --execute` again.

**Tests (real systemd, CI; the whole rehearsal runs under the cap):**

| Test | Result |
|---|---|
| normal load: S4 roles, S8 migrations, S9 probes, R-tests, two concurrent PDFs | pass; cluster peak 18 tasks (run 45461135817) |
| maintenance: 4-job `VACUUM ANALYZE` and `pg_dump` | pass; peak 18 |
| max and excess connections: 36 extra sessions on top of the apps' pools | 30 ran; **6 refused by PostgreSQL itself**; 0 other errors; peak **42 of 64**; `pids.events max 0` (45461135817). This round: peak **45 of 64**, 16 refused by PostgreSQL, events 0 (45479906055) |
| the VPS path: the drop-in removed (as on the VPS today; `pids.max` 16654), the authorized reconcile, then `tools/pg-restart.sh` | `TasksMax=64` after daemon-reload; the tool is refused without PGRESTART. With it, only the staging cluster restarts; the apps answer again after **5–6 s**; `pids.max` 64; `main` unchanged; **R-tests 27/27** (45479906055; with the tool: 45502721823) |
| backup and restore under the cap | S12's `pg_dump` and the restore drill's `pg_restore` (§8–§9) |
| the cluster `main` unchanged | a real `main` cluster runs from before the CI S0. Its postmaster PID, config, pg_hba and task cap are checked after D2, after S1–S13 and after rollback (§13) |

## 4. S11 — the fail-closed nginx sequence (D3, D4)

### 4.1 Order

| Step | What | Gate to the next step |
|---|---|---|
| **S11a-A** (closed) | The owner creates both sites in CloudPanel with **Basic Auth from the first save** (a different user and password per host) and pastes the kit's **Phase A** text: no `proxy_pass` at all; `location / { try_files /.po07-closed =404; }` | `s11-verify.sh --pre` before; `--phase A` after. Every protected path answers 401, nothing of the application is reachable, `nginx -t` OK, the master PID unchanged |
| **S10** (DNS) | The owner creates the two A records (§5) | `dns-check.sh --after` PASS from two public resolvers |
| **S11b** (TLS) | The owner issues Let's Encrypt certificates in CloudPanel (still Phase A: nothing proxied) | `s11-verify.sh --tls`: a trusted chain; the SAN exactly the host; about 90 days; a wrong name refused; renewal configured |
| **S11a-B** (open) | Only after trusted TLS and the Phase A checks pass: the owner pastes the **Phase B** text (the allow-list and HSTS 300) | `--phase B`; then the owner's authenticated probe (R1–R12, §4.4) in the owner's own terminal |

If any gate fails, the sites stay in Phase A (or are deleted); nothing is proxied. **Rollback:** delete both sites in
CloudPanel; the nginx tree checksum must return to its pre-change value.

### 4.2 The only responses a request without credentials can get

`return` and `rewrite` run in nginx's rewrite phase, before the access phase where Basic Auth is checked. So these
fixed responses are answered without credentials. None of them carries application content, and none reaches the
application.

| Request (either host unless noted) | Phase A | Phase B |
|---|---|---|
| `http://…` any path | 301 → `https://<host>/…`, **no** `WWW-Authenticate` (credentials are never requested over plain HTTP) | same |
| `/.well-known/acme-challenge/<token>` | HTTP: 301 to HTTPS; HTTPS: served by nginx from the challenge directory, Basic Auth off (404 if absent) | same |
| `/robots.txt` | 200 `Disallow: /`, `X-Robots-Tag: noindex` | same |
| admin `/` | 401 | **302 → `/platform/login`** (a fixed redirect) |
| blocked paths (admin: the ERP's paths and acceptance pages; customer: `/platform*`) | 401 | **404 from nginx** |
| `/_next/image` | 401 | **404** (denied, R8) |
| a path with `/../`, `%2e`, `%2f` or `%5c` | 400 | **400** (refused before routing) |
| an unknown host | the existing default server, unchanged (never a staging vhost) | same |
| **everything else, including every proxied page and every Server Action POST** | **401** | **401** (the application is reachable only with that host's credentials) |

Also enforced:
- wrong credentials → 401;
- the customer host's credentials do not open the admin host;
- no unauthenticated request writes anything (sessions, attempts, events, users, companies are counted before and
  after);
- the `Authorization` header is never forwarded to the application.

### 4.3 Credentials (D4)

- Separate credentials per host, created by the owner in CloudPanel and kept in the owner's password manager. They are
  never in an AI session, a file, argv or the environment.
- The owner runs `tools/s11-owner-probe.sh` **in their own terminal**. It reads each host's user and password with
  `read -rs` and passes them to the probe on a file descriptor, never on disk or in a process listing.
- The probe **refuses to send credentials** over plain HTTP and over any TLS connection it has not verified (no `-k`).
  So the authenticated checks run only after S11b's trusted certificates.

### 4.4 R1–R12 through nginx (exact outcomes, CI run 45475691931; repeated in every later rehearsal)

| # | Check | Outcome |
|---|---|---|
| R1 | admin `/` | 302 → `/platform/login` |
| R2 | admin `/login`, `/register`, `/dashboard`, `/api/document-pdf/…`, `/print/…`, `/uploads/…` | 404 each |
| R3 | admin `/platform/login` (F1 off) | 404, noindex (after F1: 200, §10) |
| R4 | customer `/platform/login`, `/platform/dashboard` | 404 each |
| R5 | the console sign-in action posted at customer `/login`, with spoofed forwarding headers | 200 from the customer page; the action never runs; no platform cookie; no row |
| R6 | the customer login action posted at admin `/platform/login` and `/platform/dashboard` | 404, 404; no session cookie; no row |
| R7 | actions at `*.png` paths on the wrong host (admin `/login.png`, `/dashboard/x.png`; customer `/platform/companies/x.png`, `/dashboard/x.png`) | 404, 404, 404, 307; no cookie; no row |
| R8 | admin `/register/accept` and `/join/accept`; a customer action with a foreign Origin or the admin Origin | 404, 404; 500 and 500 (refused); no cookie; nothing written |
| R9 | the customer session cookie through nginx (fictional sign-up) | `__Host-`, Secure, HttpOnly, `Path=/`, no `Domain` |
| R10 | client-sent `X-Forwarded-For`, `X-Real-IP` and `Forwarded` | replaced by nginx: the forged address recorded 0 times; the real address +1 |
| R11 | customer `/register/accept` and `/join/accept` (the invitation landing pages) | 200 each, behind Basic Auth |
| R12 | a customer PDF through nginx | 200 `application/pdf`, 189,076 bytes |

**Also measured in the same run:**

| Check | Result |
|---|---|
| Phase A (unauthenticated) | 47/47, both with the self-signed certificate and after the trusted one |
| Phase B | unauthenticated 57/57; authenticated 95/95 |
| Header normalization | single, constant `Host` and `X-Forwarded-Host`; `X-Forwarded-Proto: https`; `X-Forwarded-For` = the real address (overwritten, never appended); duplicates collapsed; `Forwarded`, `X-Forwarded-Server/Port/Prefix`, `X-Original-URL`, `X-Rewrite-URL`, `X-Middleware-Subrequest`, `Authorization` and `Proxy` removed (a header-echo backend behind the same text) |
| Static paths | `/_next/static/*`, `/favicon.ico`, `/uploads/*` (authorized by the app) and the PDF route proxied; `/_next/image` 404 |
| TLS | each chain verified; SAN exactly the host; 89 days; a wrong name refused; a renewed certificate served after a graceful reload, with all 40 requests during the reload answered 200 |
| Sockets and listeners | sockets `0660 root:<NGINX_GROUP>`; `nobody` and the app user cannot open them; no permission error in the nginx log; no new TCP listener |
| Rollback | the nginx file tree equal to its pre-change checksum; master PID unchanged |

## 5. S10 — DNS (owner-performed in the DNS provider's editor; never through an AI session)

1. **Repeat the conflict checks first:** `pc-kit.sh dns-check --before` (DNS-over-HTTPS, two resolvers). It must
   PASS:
   - both names NXDOMAIN;
   - no wildcard under `<ERP_HOST>`;
   - `<ERP_HOST>` exactly its recorded A record and TTL, no AAAA, no CNAME;
   - no CAA restriction.

   It passed on 24 Nov 2026; repeat it in the window.
2. **Create exactly two records:**

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `<ADMIN_LABEL>` | `<VPS_IPV4>` (the existing VPS address, the same as `<ERP_HOST>`'s) | 300 |
| A | `<CUST_LABEL>` | `<VPS_IPV4>` | 300 |

   - **No AAAA, no CNAME, no wildcard.**
   - No change to `<ERP_HOST>` or to any other record.
3. **Verify:** `dns-check --after`. Each name has exactly one A record to the VPS, TTL ≤ 300, no AAAA or CNAME, and
   `<ERP_HOST>` is unchanged. Allow up to 10 minutes for the cached NXDOMAIN (negative TTL 600 s) to expire.
4. **Rollback:** the owner deletes the two records.

## 6. S11b — HTTPS and HSTS (D8)

- **Prerequisites:**
  - S10 verified;
  - Phase A in place (nothing proxied);
  - the ACME path reachable as in §4.2;
  - no CAA restriction.
- **Issue** in CloudPanel → site → SSL/TLS → Let's Encrypt: one certificate per host, its own name only (no `www`
  alias).
- **Verify** with `s11-verify.sh --tls`, without `-k`:
  - a trusted chain to a Let's Encrypt root;
  - the SAN equals the host exactly;
  - about 90 days to expiry;
  - a wrong host name refused;
  - CloudPanel's automatic renewal configured (checked again after the first renewal).
- **HSTS:**
  - `Strict-Transport-Security: max-age=300` is part of the Phase B text, so it appears **only after** trusted HTTPS
    has been verified;
  - no `includeSubDomains`, no `preload`.
  - It is raised (for example to one year) only at staging acceptance, by a separate decision.
- **Inherited HSTS (reviewed 24 Nov 2026, read-only):**
  - the zone apex sends none;
  - a sibling host sends `includeSubDomains`, which covers only names under that sibling, not `<ERP_HOST>` or the two
    new names;
  - `<ERP_HOST>` sends none;
  - the zone is not in Chromium's HSTS preload list.

  So nothing forces HTTPS on the new names before Phase B, and nothing in this plan adds a policy above them.
- **Unchanged:**
  - every existing certificate file;
  - `<ERP_HOST>`'s certificate fingerprint and vhost;
  - every other site.
- **If issuance fails:** stay in Phase A; S11a-B and S13 do not start. Fix the cause (DNS, port 80, the challenge
  path), or roll back (§4.1).

## 7. The web server's worker identity and the Unix sockets

**Facts:**
- Both sockets are `0660 root:<NGINX_GROUP>` in `/run/elite-po-staging` (0750).
- S0 records, every time, the user and group of the site web server's workers. The current identity, and an
  observation about it, are in the private instructions. **The kit never changes the worker identity.**
- What the socket mode does:
  - it refuses every identity that is neither the owner nor a member of `<NGINX_GROUP>`;
  - S9 and the CI rehearsal prove it: `nobody` and the app user get EACCES.
- What the socket mode does **not** do: **it does not exclude root.** Any process running as root on the host can open
  both sockets. Against a root-level actor, staging relies on what sits behind the socket:
  - H-1 host binding;
  - sign-in with TOTP;
  - tenant enforcement;
  - fictional data only.

**Checks at S11a, before and after each save:**
1. The worker identity equals S0's.
2. Both sockets and their directory are unchanged.
3. `nobody` and the app user still get EACCES.
4. R1 reaches the application through nginx (not 502).
5. No permission error in the nginx error log.

**If a worker cannot connect** (for example after a web-server update changes its user): set `SocketGroup=` to that
worker group in the two `.socket` units. That is a kit change, CI-rehearsed, owner-approved, applied by an authorized
reconcile and a restart of the two sockets only. Never `0666`, never a shared directory, never a user added to a
privileged group.

## 8. S12 — encrypted backups and the off-host copy (D5, D6) — DEFERRED BY OWNER (D9)

> Not executed for staging. Required before final production deployment (Prompt 15). The design and tooling below are
> kept and CI-verified.

**Policy:**
- daily, 14-day retention;
- a private bucket with Object Lock, default retention 14 days, Governance mode;
- a bucket-scoped key without `deleteFiles` or `bypassGovernance`; **no master key on the VPS**;
- unique timestamped names; a lifecycle compatible with the lock (hide after 15 days, delete hidden after 1 day);
- billing caps and alerts;
- encrypted files only leave the host.

The owner's setup is in `PO07_OWNER_GPG_B2_GUIDE.md`.

**What a backup holds:** `po07-staging-<UTC>.tar.gpg` holds:
- a custom-format `pg_dump` of the staging database;
- a tar of the fictional file storage, with its SHA-256 list;
- `schema.tsv` and `rowcounts.tsv`;
- `manifest.json`: the kit version, the release, tree, build and run, and the member checksums.

It is encrypted to the owner's public key only, and a `.sha256` sidecar sits next to it. **No env file, no key, no
password and no recovery code is in any backup.** Administrator and MFA data are in the dump only as their stored
forms: password hashes, and field-encrypted secrets that need the owner-held field key.

**Two separate identities:**

| | Backup (`elite-po-backup.service`, daily 00:20 UTC) | Upload (`elite-po-offsite.service`, daily 01:20 UTC) |
|---|---|---|
| Network | inside the staging namespace: **no internet** | outside the namespace; the internet only; localhost, link-local, multicast and private ranges denied (`IPAddressDeny`); the namespace is not weakened |
| Identity | the app's backup role, read-only database access by `LoadCredential` | a **dynamic user** with only the upload group: no database role, no secret, no app or storage path |
| Reads / writes | reads the database and the fictional storage; writes **only** the encrypted outbox (setgid 2750) | reads only the outbox; writes only its own receipts; never modifies the database |
| Plaintext | only in a RAM-backed `/tmp` (tmpfs, 256 M) | none |
| Encryption | `gpg --recipient-file` (no keyring, no private key), AES-256 | — |
| Self-checks (refuses on failure) | no internet; `/tmp` is tmpfs; env files unreadable; the fingerprint matches; no secret key present | secrets, database, app and storage paths absent; local database ports unreachable; the outbox read-only; only expected files |
| Copy | — | `rclone copy --immutable --size-only --s3-no-head` (never `sync`, never delete, never overwrite; never a HEAD or GET, because the key cannot read: the destination is listed); size verified by listing after upload |

**Stage `s12_backup.sh` (one authorized window):**
1. It checks:
   - the bucket name set;
   - the owner's public key and fingerprint (`pc-kit.sh backup-key`; a file with a private key is refused);
   - the owner-entered `rclone.conf` (0600 root, the expected section; never printed).
2. It creates the upload group (empty) and the outbox, then installs the tools and the four units.
3. It runs one backup and one upload, and verifies both.
4. It enables the timers.
5. **S12 is complete only after a successful restore drill (§9).** If the off-host copy or the restore fails, the S12
   gate fails.

Rollback S12 removes the units, timers, tools, the group and the uploader's state, and keeps every backup.

**CI rehearsal** (an object-storage **stand-in**, not B2, with fictional credentials):
- **The stand-in:** MinIO built from its archived upstream source at a pinned commit, because MinIO no longer
  publishes images. It runs a bucket with Object Lock, default retention Governance 14 days, and two keys: upload
  (put and list only) and read.
- **The "owner":** a fictional owner key pair on the "PC" side. Only its public half reaches the VPS side.
- **Checks:**
  - the object is encrypted to the owner's encryption subkey, with no plaintext anywhere;
  - the namespace and dynamic-user properties in effect;
  - retention applied;
  - **delete refused**;
  - an overwrite attempt leaves the original version intact.
- Results: §13.

## 9. The restore drill (required before staging acceptance)

1. **Retrieve.** The owner downloads one off-host copy and its `.sha256` sidecar: from the provider's web console, or
   with a separate read-only key kept on the PC.
2. **Decrypt privately.** In the owner's own terminal, `tools/pc-restore-drill.sh <file> <sidecar>`:
   - it checks the sidecar;
   - GnuPG asks for the owner's passphrase;
   - the decrypted stream goes over the owner's SSH route straight into `restore-verify.sh --execute <sha>`;
   - nothing decrypted is written to the PC's disk.
3. **Restore and verify** (`restore-verify.sh`, on the VPS). It accepts only a backup whose SHA-256 the uploader
   recorded as verified off-host.
   - It restores into a **disposable database** `elite_po_restore_<ts>_test_only_` (`pg_restore --no-owner`) and an
     **isolated directory**.
   - It verifies:
     - every member's checksum;
     - the schema equal to the recorded one;
     - every table's row count;
     - the files' SHA-256 list;
     - the administrator count;
     - **field-encrypted data decrypts** with the field key currently in use (counts only; nothing is printed).
   - **The active database is never overwritten:** its checksum of row counts is compared before and after.
   - The disposable database and directory are removed **only after** every check passed. A failure keeps them for
     review and STOPs.
4. **Disaster recovery:** a full rebuild needs three owner-held items. The administrator's MFA stays recoverable
   without exposing anything, because the dump holds only encrypted forms.
   - the GPG private key and passphrase;
   - the staging keys saved at S9b (`FIELD_ENCRYPTION_KEYS` is essential for MFA and other encrypted fields);
   - the administrator password (only its hash is in the dump).

**CI:** the drill runs end to end, plus negative cases: an unknown SHA-256 refused, and a corrupted object refused.
Results: §13.

## 10. S13 — feature activation (one switch at a time)

`s13_switch.sh --execute F<n> on|off` (one switch per run, in strict order; `--plan` and `--status` are read-only):

| Step | Switch | Files | Owner acceptance (fictional records only) |
|---|---|---|---|
| F1 | `PLATFORM_CONSOLE_ENABLED=true` | admin | sign-in with password and TOTP; a wrong code refused and throttled; a recovery code works once; idle timeout; sign-out revokes the session; R3 now 200 on admin only |
| F2 | `TENANT_ACCESS_ENFORCEMENT=enabled` | both | company management; suspending a company ends its sessions and refuses sign-in; restoring allows a fresh sign-in; other companies unaffected; step-up for sensitive actions |
| F3 | `PLATFORM_INVITATIONS_ENABLED=true` | admin | company invitation create, revoke, re-issue; the link shown once, pointing at `https://<CUST_HOST>`; audit records |
| F4 | `CUSTOMER_INVITE_ACCEPTANCE_ENABLED=true` | both | onboarding: one company, one primary owner, one Trial (14 days, 3 seats); reuse and expiry refused; primary-owner management |
| F5 | `PLATFORM_USER_INVITATIONS_ENABLED=true` (after L-3) | admin | user invitations; a pending one occupies a seat; revoke and re-issue |
| F6 | `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED=true` | both | the user created in the right company without a second seat; reuse refused |
| F7 | `CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true` (with the P-8 consent) | both | the 4th user refused on every path with nothing written; a company above its allowance keeps its users |

**Each run:**
1. **Preconditions:** S9b done; S11b and S11a-B passed and **recorded** (`S11.tls-ok`, `S11.phaseB-ok`); S12 done **or
   validly deferred (D9, staging only, re-checked at every run)**; the switch named in the window's authorization; all
   earlier switches on and no later switch on; the L-3 table check for F5 and F6.
2. **The change:** the switch line in the env file(s), rewritten in place. Every other line is verified unchanged, and
   nothing is printed.
3. **The restart:** **the two staging app units only**, followed by a health poll.
4. **Automated checks:**
   - the variable in effect in each process (yes/no only);
   - F1's route 200 on admin and 404 on customer;
   - customer `/login` 200;
   - no error in either journal since the restart.
5. **Then the owner's acceptance checks** for that switch, plus the cross-cutting ones below.
6. **On failure:** the switch is reverted, the apps are restarted, and the tool STOPs. Turning off runs in reverse
   order, F7 → F1.

**Across all steps (owner-run, fictional data only):**
- session revocation;
- the customer ERP regression subset and R1–R12 again;
- **English and Arabic** (RTL mirrored; numbers, dates and currency LTR), **desktop and mobile**, **light and dark**,
  on both hosts;
- PDF generation and storage;
- the shared services' health after every restart;
- **30 minutes of footprint monitoring** after F7, including a PDF burst.

Nothing is activated on the VPS by this plan. **Scope:** controlled, owner-only staging behind Basic Auth. It is not
public or production availability.

## 11. The PDF limiter (D7) — a separate application workstream

`PO07_PDF_CONCURRENCY_SPEC.md`:
- at most 2 concurrent renders per customer process;
- a FIFO queue of 4 with a 15 s maximum wait;
- 503 with `Retry-After: 10` beyond either limit;
- native English and Arabic messages;
- timeout and cancellation release the slot; nothing leaks in the response;
- a full regression plan.

It is not implemented, and `cf64ebc` is unchanged. It needs its own approved release before any unrestricted public
availability.

## 12. The production ERP security release — strategy (no merge, no deploy, no production credentials)

Plan: `PO07_ERP_SECURITY_RELEASE_PLAN.md`.

**The candidate:**
- `main` `621f156` + the Team fix (`35d5dcc`, `94f936e`) + the Next.js 16.4.6 commit `9b8aa85`;
- assembled **only on an isolated runner** (`.github/workflows/erp-security-release-measure.yml`); nothing is pushed,
  merged or deployed.

**Measured on 24 Nov 2026, with 2 CPUs as on the VPS** (runs 45478667896 and 45479330665):

| Measure | Result |
|---|---|
| Candidate tree | `211bc69abed66d0d47cf28fb79607c564f2e9223`, identical in both runs (the cherry-pick is clean and reproducible) |
| `npm ci`, TypeScript, ESLint | pass |
| `next build`, no memory cap | **completes; peak 2.8–2.9 GB**; about 1 min 15–20 s CPU |
| `next build` under the old on-VPS cap (`MemoryMax=1536M`, no swap) | **OOM-killed** at 1.5 G, in both runs |
| The archive a verified external build would install (`.next`, `node_modules`, the lockfiles) | 421 MB, 48,661 entries. Measurement only: not attested, not approved |

**Conclusion: the plan's N3 (building on the VPS) cannot work.** The release must use a **verified external build**,
as S6-R did for staging.

**Requirements before any production step:**
1. **Owner go-ahead for N1:** a release branch from `main` with the three commits, reviewed; the H-1 and ERP suites
   green.
2. **The build:** a GitHub-hosted workflow on that branch.
   - `npm ci`, the gates, `next build`;
   - an archive with `ARTIFACT.json` (commit, tree, build, run);
   - a Sigstore build-provenance attestation;
   - the runner's SHA-256.
3. **Transfer and checks:**
   - the PC verifies the digest and the attestation (as `pc-artifact.sh`);
   - the VPS receives it verify-then-publish (as K2) and checks the archive offline (as `check-archive.mjs`);
   - nothing is built, downloaded or installed by a package script on the VPS.
4. **Installation beside the live release** (a new directory), switched by one owner-authorized restart.
   - The previous release directory and its unit configuration are kept untouched.
   - **Rollback:** the previous unit configuration and one restart, measured in a rehearsal first.
5. **Separations kept:**
   - the production ERP, its database (Neon) and its credentials are never used in CI or by the staging kit;
   - staging and production share no file, socket, database or key.

## 13. Final CI (isolated GitHub-hosted runners, fictional data)

**The final run, 45502721823: all three jobs green.** It used the final kit-5 code (77 files; final manifest digest `d6f9bebf4929216e`, which differs from the rehearsed one only by the private README, a documentation file the render excludes) and
the approved archive only.

| Area | Result |
|---|---|
| K1–K6 regression tests (Linux) | 82/82, no skip |
| K4: the approved commit reachable, pinned tree (offline and through the GitHub API) | pass |
| S1–S9 (S6 = S6-R) | pass. V-NET tool 107, admin 110, customer 112, all passing; R-tests 27/27; after S9 22/22 |
| D24 restricted recovery | 30/30 |
| D31 PDF load | 12/12. Customer unit tasks peak 252/320; slice 286/512 |
| K3 reconciliation | 13 checks; 22 files listed, 0 needing attention |
| D2 (the VPS path) | as on the VPS today, `pids.max` 16654 (no own cap) → authorized reconcile → `tools/pg-restart.sh` refused without PGRESTART, then restarts the staging cluster only. Apps back in 5 s, `pids.max` 64, R-tests 27/27 |
| PG saturation under the cap | peak 41 of 64; 16 sessions refused by PostgreSQL itself; `pids.events max 0` |
| The cluster `main` (a real cluster from before the CI S0) | the same postmaster PID, config, pg_hba and task cap after D2, after S1–S13 and after the full rollback |
| nginx, TLS, Basic Auth, R1–R12 | 246 probe checks: Phase A 47 + 47, Phase B unauthenticated 57, authenticated 95. TLS, renewal, sockets and listeners pass; the nginx tree is restored (§4.4) |
| S12 backup | encrypted to the owner's subkey only (440,534 bytes, 81 tables); no plaintext on disk; the backup ran in the namespace; the uploader is a dynamic identity outside it |
| S12 simulated off-host copy | the stand-in (MinIO from pinned source, not B2), Object Lock GOVERNANCE 14 days. The upload key cannot delete; a hostile overwrite PUT is refused; the original version stays byte-identical and retained; even the root key cannot delete it without a bypass |
| S12 restore drill | an unverified object refused; a corrupted backup refused. The success path: schema (988 columns) and 81 tables' counts identical; the encrypted MFA field decrypts; both fictional uploads (one nested, one 64 KiB binary) restored with matching SHA-256; the active database unchanged; the disposable database and directory removed; S12 accepted |
| S13 | F2 before F1 refused; an unknown switch refused. F1–F7 on in order, each with its automated checks; an injected F7 failure reverts and STOPs; F3 off while F4 is on refused; F7 → F1 off. 14 recorded passes; every file and process back to no switch |
| Rollback | the full rollback (S13 → S1) leaves no staging unit, path, user, group or listener; the encrypted backups and fictional storage are kept for the owner |
| J1 read-only matrix and the H-1 security suites | pass: `SUITES PASS failed=0`; invitation acceptance browser 98/98 |

**Defects this round found and fixed in the kit, not in the tests:**
- Refuse-on-match checks piped into `grep -q` under pipefail, where SIGPIPE could hide a match. This hid the
  journal-error and log-permission checks, and caused the first backup failure. A lint rule now forbids the pattern.
- The upload key cannot read, but rclone HEADs objects (403).
- `RuntimeMaxSec` is ignored for `Type=oneshot` (both units are now capped by `TimeoutStartSec`).
- The S13 expected-state computation was defeated by the inherited ERR trap.
- Deliberate restarts hit systemd's start limit.
- D2 had no kit tool for its restart (now `tools/pg-restart.sh`).
- The restore could not read its root-only directory.

**One intermittent failure, recorded, not hidden:** in run 45498360294 one J1 browser check failed once,
`invitation-acceptance-browser` B10 (a signed-in customer sees "You're signed in"; 97/98). The same suite passed 98/98 in
every other run of this round, on the same archive and suite code. It is reported for the application workstream; the
suite was not changed.

**PO07-A11Y-01 remains open** (accepted temporarily, not resolved). No test was weakened or skipped to obtain these
results.

## 14. Remaining risks and blockers

**Risks:**
- R2: the sandbox is unproven on the VPS's own kernel until each stage runs there.
- R4: `OOMScoreAdjust` applies to the staging cluster.
- R6: the strict listener rule versus services opening random ports.
- R9: PDF concurrency, until D7 is released.
- PO07-A11Y-01 is open.
- The production-hardening items of the staging plan §K are open.
- A shared-host observation about the web server is recorded privately.

**Blockers to the next VPS phase** (all are the owner's to resolve; none is a code defect):
- an execution authorization (window, stages);
- the owner's review of the kit-5 digest;
- for S12: the B2 account, bucket and restricted key, and the GPG key pair (owner guide);
- for S13: S11a-B, S11b and S12 passed.

## 15. GO / NO-GO for the next separately authorized execution phase

| Phase | Verdict |
|---|---|
| Install kit-5 and run the read-only reconcile report (§2) | **GO when authorized**, once the owner has reviewed the kit-5 digest |
| D2 (reconcile plus a controlled restart of the staging cluster) | **GO when authorized** (RECONCILE and the restart named in the window) |
| S11a-A → S10 → S11b → S11a-B | **GO when authorized**, in that order, with the owner performing the CloudPanel, DNS and certificate steps and running the authenticated probe |
| S12 | **DEFERRED BY OWNER (D9)**: not part of staging; required before final production (Prompt 15) |
| S13 | **GO when authorized**, after S11b and S11a-B are recorded and with S12 accepted or validly deferred (D9); one switch per run |
| Production ERP security release | **NO-GO** until N1 is approved and the external-build path (§12) is built and rehearsed |
| Public or production availability of the Platform Owner work | **NO-GO** (D7, §12, the staging plan §K) |
