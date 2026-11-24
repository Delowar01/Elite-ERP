# PO-07 — S10–S13 execution plan, kit-4 corrections and resource reviews

**Status (25 Nov 2026): PLAN ONLY.** The repository is public, so this document uses placeholders.
- Nothing in this document has been executed.
- No DNS record, CloudPanel site, nginx change, certificate, storage account or feature switch exists or was changed.
- The real values (`<VPS_IPV4>`, the host names, the web server's worker identity, the current DNS state) are in the
  owner's private operational instructions, `plans/PO07_S10_S13_PRIVATE.md`, which are kept outside the repository.
- S10 and every later stage needs its own written authorization from the owner. **The first change to a shared
  service is S11a, an nginx reload.**

## 1. S0–S9b closure (owner decision of 25 Nov 2026: ACCEPTED)

| Item | State |
|---|---|
| Approved source | `cf64ebc492b56ad91c28ba3aa7640722935e21c5`, tree `6403cf5d822df491f6e16a56068ab9d7c2f1f138` |
| Approved build | run 45228504829; archive SHA-256 `df96cb5b12b5d2b5723e14f626a8619ef062c5d3d9fea990d67745ecca9e561c`; build `zsnzn4exuiKvGWNoIKHtj` |
| Development baseline | `b84bc318c97b4c73c409d4c6e196582b4008bcc0` at acceptance. The kit-4 commits after it touch only `ci/`, `.github/` and `docs/`; the approved release does not change |
| Installed kit | kit-3, manifest `7177fade9cdda9b4`. kit-4 is prepared (§2) and is NOT on the VPS |
| Staging on the VPS | S1–S9b complete: the isolated cluster and namespace; both app processes (read-only build, J1); proxy sockets; one administrator with MFA (the owner's bootstrap); staging keys rotated on 24 Nov 2026; no feature switch on; no nginx route |
| Evidence | the owner's private window log and the S0 chain B0–B4 (private) |

**Preserved; never repeated without a new decision:**
- the running staging services and their resources;
- the administrator account and its MFA enrollment (S9b is not repeated);
- the rotated keys (no new rotation without a genuine reason and a separate approval);
- the read-only application tree;
- the artifact and its provenance;
- every earlier STOP record and all execution evidence.

## 2. Kit-4: the six corrections (K1–K6)

Each correction is in the private kit, rendered with fictional values into `ci/po07-runtime/kit/`, and covered by
regression tests: `ci/po07-runtime/kit-k-tests.sh`, plus the real-systemd steps in `rehearsal.sh`.

| # | Defect in the 24 Nov 2026 window | Correction |
|---|---|---|
| K1 | `pc-kit.sh update`'s retire step parsed only the Linux `hash  ./path` form. The PC writes `hash *./path`, so all 45 kit files were moved to `state/retired/` | `tools/manifest.sh`: one strict parser for both forms. It refuses traversal, absolute paths, duplicates, escaped names, a CR, a tab, any other layout, and `state/` or `incoming/` paths. `tools/kit-install.sh` receives the whole kit as ONE tar stream over ONE connection into a new directory, verifies every file and the exact file set, then replaces the kit. Retired files are moved (never deleted, structure kept), at most 10 and never all of them; links are refused |
| K2 | `artifact-upload` renamed `.part` to the final name BEFORE checking the SHA-256. An interrupted transfer got the final name with 77 of 249 MB | `tools/artifact-receive.sh` (on the VPS): a unique temporary file → size → SHA-256 → the archive's `ARTIFACT.json` identity (run, commit, tree, build) → an atomic hard link to the final name (never over an existing file) → `<archive>.verified`. Failed or interrupted transfers are quarantined (0400). S6-R and recovery-authorize require the `.verified` record. The 24 Nov partial copy is kept untouched |
| K3 | The S2 wrapper `/usr/local/sbin/elite-po-run` was still kit-1's (`ReadWritePaths=.next/cache`) after the kit was updated: the S9 STOP | §3 below |
| K4 | S0 required the approved commit to be the branch TIP | `tools/verify-source.sh`: the commit exists, has the pinned tree, and is reachable from the branch (0 behind). It lists later non-tooling changes as a NOTE. The approved run, archive SHA-256 and build are pinned in the kit's config; S6-R and recovery-authorize refuse any other artifact. S0 §9b shows, read-only, the commit, tree and build installed in the staging tree |
| K5 | One single-step register (22 Nov → post-S5) | The chain B0 (22 Nov) → B1 (post-S5) → B2 (24 Nov pre-execution) → B3 (post-S9) → B3b (post-rotation) → B4 (final post-S9b). Each file's SHA-256 is recorded. `tools/s0-trace.mjs` classifies every difference as STAGING (a kit resource, by name; never a TCP listener), KNOWN (registered for that step with the owner's acceptance) or FAIL. The 24 Nov listener change of another application (a restart outside staging) is registered with the owner's recorded acceptance. Compare `--trace` requires the latest baseline |
| K6 | The SSH alias was pinned to IPv4. On 24 Nov the PC lost its IPv4 route | `tools/ssh-args.sh`: route `ipv4` or `nat64` (RFC 6052 `64:ff9b::/96` of the same address). There is ONE host identity in both (`HostKeyAlias` = the known_hosts name); `StrictHostKeyChecking=yes`; `UpdateHostKeys=no`; BatchMode with the owner's agent; no forwarding. A state-changing command first proves the route, so a dead route changes nothing |

## 3. Installed-file reconciliation plan (K3)

**The list:** `units/installed-files.tsv` names all 16 system files the kit installs outside its directory, each
with its destination, mode, owner, kit source, stage and history key:
- S2: the slice, the namespace unit, tmpfiles and the wrapper;
- S3: the cluster's `conf.d`, its `pg_hba` and its drop-ins;
- S6: the two kit tools in the app directory;
- S9: the six unit files.

Generated files (env files, credentials) and the application tree are not listed.

**The states:**

| State | Meaning | Effect |
|---|---|---|
| UNCHANGED | the file equals this kit's source, with the listed mode and owner | none |
| NOT-INSTALLED | its stage has not run | none |
| PROPOSED | added to the kit after its stage ran (flag `proposed`) | never blocks; installed only by an authorized reconcile |
| OUTDATED(kit-N) | equals a known earlier kit version in `units/history/` (e.g. `wrapper@kit-1`) | blocks every stage; an authorized reconcile can replace it |
| MODIFIED | any other content | blocks; never replaced by the kit (owner review) |
| MISSING | absent although its stage is complete | blocks (owner review) |
| WRONG-OWNER-OR-MODE, NOT-A-FILE | anything else in its place (links are never followed) | blocks (owner review) |
| UNEXPECTED | a file or directory in the kit's install locations that is not listed (e.g. an override drop-in) | blocks (owner review) |

**Gates and mechanics:**
- **The gate.** Every stage starts with `installed_files_gate`. A stage never installs a file by itself once it is
  complete: `put_file` refuses a missing destination for a completed stage.
- **Report.** `pc-kit.sh reconcile --report` is read-only and needs no authorization.
- **Apply.**
  - `pc-kit.sh reconcile --execute <dest>…` needs RECONCILE in the owner's recorded authorization for the window.
  - Every file must be named; there is no "all".
  - It replaces only OUTDATED files and installs only PROPOSED ones, inside the staging allow-list.
  - The previous version is kept read-only under `state/installed-previous/<ts>/<dest>`, and the change is logged.
  - Unit files get a `daemon-reload`. Nothing is restarted: a restart is a separate, authorized step.
- **Rollback.** `reconcile --execute --restore <dest>` puts the kept version back, but only while the file is still
  what reconcile installed.

**Regression evidence (CI, real systemd):**
1. The stale kit-1 wrapper is put back in place and reported `OUTDATED(kit-1)`.
2. A real stage refuses to run.
3. Reconcile without RECONCILE is refused.
4. With it, reconcile replaces the wrapper and keeps kit-1 read-only; restore works.
5. A MODIFIED wrapper is never replaced.
6. An unexpected drop-in blocks.
7. An absent proposed file does not block, and S3's re-check does not install it.

**On the VPS at the next authorized window**, after `update` to kit-4: `reconcile --report` should show every file
UNCHANGED except the proposed `20-tasks.conf` (§4.2), which shows as PROPOSED.

## 4. Remaining resource risks

### 4.1 PDF concurrency (R9): recommendation, no code change in this task

- **Measured:** one render, then two concurrent renders through the customer socket, stay within the customer unit's
  limits (tasks 247–254 of 320; memory 454–463 MB of MemoryHigh 768).
- **The risk:** Chromium needs about 120 tasks per render, so a third simultaneous render would hit the unit's cap and
  fail inside the unit. The application has no concurrency limit.

**Recommendation** (application code; a separate approved change, verified before any unrestricted public access):
1. **A per-process render limiter** in the PDF path (`src/lib/pdf/`):
   - at most `PDF_MAX_CONCURRENT` renders at once (2 on staging, from the measurement);
   - a bounded queue of waiting requests (`PDF_QUEUE_MAX`, e.g. 4), each waiting at most `PDF_QUEUE_WAIT_MS`
     (e.g. 15 000);
   - beyond either limit: **503 with `Retry-After`** and a bilingual message (native Arabic and English, per the
     project rule) instead of a failed render;
   - log the queue depth and the rejections.
2. **Tests:**
   - unit tests of the limiter;
   - an integration test with 3 and 5 concurrent requests: 2 render, the rest wait or get 503, the customer unit stays
     below 90 % of `TasksMax` (288), and there are no memory events;
   - the existing PDF tests are unchanged.
3. **Optional, measured first:** reuse one browser per process, with a fresh `BrowserContext` per render. This cuts
   the tasks and memory per render; tenant isolation is kept by the separate context.

**Until it is done:** the staging test stays owner-only behind Basic Auth (S11a), and the unit and slice caps contain
any failure.

### 4.2 PostgreSQL task cap (R10): proposed `TasksMax=64` for the staging cluster's unit only

**Derivation** (from the cluster's own configuration, not from the arithmetic of the slice):

| Component | Tasks |
|---|---|
| postmaster | 1 |
| auxiliary processes (checkpointer, background writer, WAL writer, autovacuum launcher, logical replication launcher) | 5 |
| `max_connections` | 30 |
| `autovacuum_max_workers` | 3 |
| `max_worker_processes` (parallel query) | 8 |
| **full configured capacity** | **47** |
| pg_ctlcluster's start/stop helpers | 3 |
| **total** | **50** |

The idle count was measured at 6. **64** leaves 14 for connection attempts beyond `max_connections`, each of which
is forked before PostgreSQL refuses it. So PostgreSQL's own limit binds first: a client beyond 30 gets "too many
clients", never a failed fork. The cap stops only a runaway from taking the slice's tasks from the two app units.

**What stays the same:**
- slice 512, admin 128, customer 320;
- every memory and CPU limit.

Every unit's cap is below the slice's. The sum of caps (520) exceeds the slice by 8 only as ceilings, not as
reservations: the measured concurrent peak of the whole slice is 280–287.

**Tested in CI:** the rehearsal's fresh S3 installs the drop-in, so the whole rehearsal runs under the cap:
- S8 migrations, the S9 probes and R-tests, the PDF load;
- a 4-job `VACUUM ANALYZE` and a `pg_dump`;
- a saturation test: 36 extra sessions on top of the apps' pools.

**Measured, CI run 45461135817 (25 Nov 2026), cluster unit cgroup:**

| Measure | Value |
|---|---|
| idle | 6 tasks |
| lifetime peak through S4, S8, S9 and the two-PDF load | 18 tasks |
| after `VACUUM ANALYZE --jobs=4` and `pg_dump` | 18 tasks |
| saturation: 36 extra sessions on top of 1 held by the apps | 30 ran; **6 refused by PostgreSQL itself** ("too many clients"); 0 other errors; sampled peak 36, lifetime peak **42 of 64** |
| task-cap events | `pids.events max 0` (no fork was ever refused) |

The cluster stayed healthy, and the slice's PDF peak was 287 of 512.

**On the VPS:** only after the owner's approval, by `reconcile --execute` (RECONCILE authorized), then an authorized
restart of the staging cluster unit, then the S8/S9 checks. Never automatic.

### 4.3 Accessibility

PO07-A11Y-01 stays an open, tracked issue (accepted temporarily, not resolved). No browser test is weakened.

## 5. S10 — DNS (owner-performed in Hostinger DNS; NOT authorized now)

**Conflict checks, done read-only on 25 Nov 2026 over DNS-over-HTTPS (values in the private instructions):**
- `<ADMIN_HOST>` and `<CUST_HOST>`: **NXDOMAIN**, so both are free.
- A random label under `<ERP_HOST>`: NXDOMAIN, so **there is no wildcard**.
- `<ERP_HOST>`: one A record `<VPS_IPV4>`, TTL `<ERP_TTL>`; **no AAAA, no CNAME**.
- The zone's NS are the registrar's (Hostinger) name servers; its negative-cache TTL is 600 s.
- **No CAA record** on the zone or `<ERP_HOST>`, so Let's Encrypt may issue.

**The records**, only these two, created by the owner in the Hostinger DNS editor of `<ZONE>`:

| Type | Name (relative to `<ZONE>`) | Points to | TTL |
|---|---|---|---|
| A | `<ADMIN_LABEL>` (= `<ADMIN_HOST>` without `.<ZONE>`) | `<VPS_IPV4>`, exactly the value of the existing `<ERP_HOST>` record | 300 |
| A | `<CUST_LABEL>` | `<VPS_IPV4>` | 300 |

**Never:**
- an AAAA record (the ERP has none);
- a wildcard;
- a CNAME (it would follow any later change of `<ERP_HOST>`);
- any change to the existing `<ERP_HOST>` record or to any other record;
- Hostinger credentials in an AI session.

**Verification (read-only):**
1. Two public resolvers (DNS-over-HTTPS) return `<VPS_IPV4>` for both names. Allow up to 10 minutes for a cached
   NXDOMAIN to expire.
2. `<ERP_HOST>` still returns exactly its old record and TTL.
3. There is no AAAA for either name.
4. The VPS's own resolver agrees.

**Rollback:** the owner deletes the two A records.

**Recommended order (decision D3):** S11a **before** S10. Both sites exist behind Basic Auth, with CloudPanel's
self-signed certificate, and are tested with `curl --resolve` before any public name points at them. Only then S10,
then S11b. The plan's §N lists S10 first; S11a does not need DNS.

## 6. S11a — CloudPanel and nginx (NOT authorized now)

**Pre-change evidence (read-only, the S11a pre-step):**
1. A fresh S0: the nginx tree checksum, every vhost checksum, the master PID and the worker identity (§7), the
   certificate files, and every site's status.
2. `nginx -t`, which must be OK.
3. The content of `sites-enabled/default.conf`. Requests for an unknown host must keep getting what they get today.
   It is not changed.

**Steps (owner in the CloudPanel UI; Claude Code only verifies; CloudPanel credentials never in an AI session):**
1. Create site `<ADMIN_HOST>` (type: reverse proxy, or static, as CloudPanel offers). **Before anything is proxied**,
   enable Basic Authentication on the site:
   - a staging-only user and password, different per site, stored in the owner's password manager;
   - check that `curl -sk --resolve <ADMIN_HOST>:443:<VPS_IPV4> https://<ADMIN_HOST>/` returns **401**;
   - check that `http://` returns a **301 to https without a `WWW-Authenticate` header**. CloudPanel's
     scheme redirect runs in nginx's rewrite phase, before the access phase, so credentials are never requested over
     plain HTTP.
2. Edit the vhost:
   - delete every generated `location` block except CloudPanel's `/.well-known` handling, which stays outside Basic
     Auth (`auth_basic off`);
   - keep the generated certificate, log, Basic Auth and scheme-redirect lines;
   - add the block below.
   - On save, CloudPanel runs `nginx -t` and reloads gracefully (the master PID is unchanged).
3. The same for `<CUST_HOST>`, with its own block.
4. Verify (below), then the regression checks.

**`<ADMIN_HOST>`** (inside its server block):
```nginx
# PO-07 staging, fictional data only. Server-level: every request header the app trusts is set here, never passed on.
add_header X-Robots-Tag "noindex, nofollow" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
client_max_body_size 2m;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host "<ADMIN_HOST>";              # a constant: never the client's Host
proxy_set_header X-Forwarded-Host "<ADMIN_HOST>";  # H-1 binds the console to this name
proxy_set_header X-Forwarded-Proto "https";
proxy_set_header X-Forwarded-For $remote_addr;     # overwrites, never appends (PLATFORM_TRUSTED_PROXY_HOPS=1)
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header Forwarded "";                     # strip every other forwarding or override header a client sends
proxy_set_header X-Forwarded-Server "";
proxy_set_header X-Forwarded-Port "";
proxy_set_header X-Original-URL "";
proxy_set_header X-Rewrite-URL "";
proxy_set_header X-Middleware-Subrequest "";
proxy_connect_timeout 5s;
proxy_read_timeout 60s;
location = /robots.txt { auth_basic off; default_type text/plain; return 200 "User-agent: *\nDisallow: /\n"; }
location = / { return 302 /platform/login; }
location = /platform { proxy_pass http://unix:<ADMIN_SOCK>:; }
location ^~ /platform/ { proxy_pass http://unix:<ADMIN_SOCK>:; }
location ^~ /_next/image { return 404; }           # the image optimizer is unused (R8): denied
location ^~ /_next/static/ { proxy_pass http://unix:<ADMIN_SOCK>:; }
location = /favicon.ico { proxy_pass http://unix:<ADMIN_SOCK>:; }
location / { return 404; }                         # nothing else of the application exists on this host
```

**`<CUST_HOST>`** (inside its server block): the same server-level lines, with `<CUST_HOST>` in `Host` and
`X-Forwarded-Host` and `client_max_body_size 12m;`. Then:
```nginx
location = /robots.txt { auth_basic off; default_type text/plain; return 200 "User-agent: *\nDisallow: /\n"; }
location = /platform { return 404; }               # the console never exists on the customer host
location ^~ /platform/ { return 404; }
location ^~ /_next/image { return 404; }
location / { proxy_pass http://unix:<CUST_SOCK>:; } # pages, /register/accept, /join/accept, /api/*, /print/*, /uploads/*, /assets/*, /_next/static/*
```

**Notes:**
- **Unexpected hosts:** they never reach these server blocks. `server_name` is exact, and an unknown host goes to
  the existing default server, unchanged.
- **Inside the application:** H-1 still refuses a wrong host or forwarded host on its own (R5–R8 at S9). nginx is the
  first line, not the only one.
- **Static assets:** `/_next/static/` on both hosts; `/assets/*` and `/uploads/*` through the customer app (its own
  authorization).
- **No new TCP listener:** nginx already listens on 80 and 443. The apps are reachable only through the two Unix
  sockets.

**Verification (`curl --resolve`, `-k` until S11b):**
- **Without credentials:** every path returns 401 except `/.well-known/acme-challenge/*` and `/robots.txt`; HTTP
  returns a 301 to HTTPS with no `WWW-Authenticate`.
- **With the owner's Basic Auth (decision D4: the owner runs the probe in their own terminal, or creates a root-only
  credential file on the VPS that the probe reads and never prints):** R1–R12 through nginx:

| # | Expected |
|---|---|
| R1 | admin `/` → 302 `/platform/login` |
| R2 | admin customer paths → 404 |
| R3 | admin `/platform/login` → 404 (F1 off) |
| R4 | customer `/platform*` → 404 |
| R5–R8 | cross-host actions refused |
| R9 | `__Host-` Secure cookies |
| R10 | a client-sent `X-Forwarded-For: 1.2.3.4` is replaced by the real address (seen in the app's throttle and audit records) |
| R11 | invitation links point at `https://<CUST_HOST>` |
| R12 | a customer PDF downloads |

  Plus: `/_next/image` → 404 on both hosts; spoofed `Host`, `X-Forwarded-Host` and `Forwarded` headers have no
  effect; nginx's error log shows no `connect() … (13: Permission denied)`.
- **Prerequisite (to be built and rehearsed in CI before the S11a window):** an nginx stage in the rehearsal that
  applies exactly these blocks (stock nginx, self-signed certificate, Basic Auth, the rehearsal's sockets) and runs
  the checks above.

**Regression (must all hold after each save):**
- the nginx tree checksum differs ONLY by the new site's files (its vhost, certificate, Basic Auth file);
- every existing vhost checksum is unchanged, including `<ERP_HOST>`'s;
- `nginx -t` OK, and the master PID unchanged;
- every existing site answers exactly as in S0;
- the `<ERP_HOST>` public status, headers and certificate fingerprint are unchanged;
- the §I guard.

**Rollback:** the owner deletes the two sites in CloudPanel (vhost, certificate, Basic Auth). Then `nginx -t`, and
the nginx tree checksum must equal the pre-change value. The staging services stay as they are.

## 7. Unix socket access: verification requirements

Facts:
- Both sockets are `0660 root:<NGINX_GROUP>`, in `/run/elite-po-staging` (0750).
- S0 records, at every stage, the user and group of the site web server's worker processes (the children of the
  `nginx.service` master). The current identity is in the private instructions.
- A worker can connect only if its user owns the socket, or its group is the socket's group, or it is root.

Requirements, at the S11a pre-step and again after each save:
1. The workers' user and group equal the identity recorded in S0 (`ps -o user=,group= --ppid <master>`). CloudPanel's
   own panel nginx is a separate service and is not involved.
2. Both sockets are `0660 root:<NGINX_GROUP>` and their directory is unchanged.
3. Non-web-server users (`nobody`, the app user) still get EACCES (as at S9).
4. Through nginx, R1 reaches the application (not a 502); the error log has no permission error.

**If the worker identity ever cannot connect**, e.g. after a web-server update changes its user, the narrowest change
is:
- set `SocketGroup=` in the two `.socket` units to that worker group;
- that is a kit change, CI-rehearsed, owner-approved, applied by an authorized reconcile and a restart of the two
  sockets only.

Never `0666`, never a socket in a shared directory, never a user added to a privileged group.

## 8. S11b — HTTPS (NOT authorized now)

**Prerequisites:**
- S10 propagated, verified by public resolvers;
- S11a passed (the sites exist behind Basic Auth);
- `/.well-known/acme-challenge/` reachable over HTTP without Basic Auth (CloudPanel's handling);
- no CAA restriction (verified).

**Steps (owner, CloudPanel → site → SSL/TLS):** a new Let's Encrypt certificate for each host, its own name only (no
`www` alias). CloudPanel renews it automatically.

**Verification:**
- `curl -v` without `-k`: a valid chain, the subject alternative name equals the host, about 90 days to expiry;
- HTTP → 301 → HTTPS;
- the cookies are `__Host-`, Secure, HttpOnly, with no `Domain` (R9);
- then `add_header Strict-Transport-Security "max-age=300" always;` on both hosts, without `includeSubDomains`. It is
  raised (e.g. to one year) only at staging acceptance.

**Unchanged:**
- every existing certificate file;
- `<ERP_HOST>`'s certificate fingerprint;
- every existing site's status.

**If issuance fails:** the sites stay behind Basic Auth with the self-signed certificate and S13 does not start. Fix
the cause (DNS, port 80, challenge path), or roll back the sites (§6).

## 9. S12 — backup and restore (NOT authorized; nothing purchased or provisioned)

**Policy (preserved):**
- daily encrypted staging backups, 14-day retention;
- an independent off-host copy in object storage;
- an upload credential **without delete permission**;
- the owner's GPG private key never on the VPS and never seen by Claude Code;
- a verified restore before staging acceptance.

**Provider recommendation: Backblaze B2** (S3-compatible; rclone has a native B2 backend):
- **Application keys** have explicit per-key capabilities. The upload key is restricted to one bucket with
  `listBuckets`, `listFiles` and `writeFiles` only: **no `deleteFiles`**, no `bypassGovernance`, and no
  retention-write capabilities.
- **Object Lock** with a bucket default retention of 14 days. Every upload is retained automatically, even if the key
  leaked. Governance mode is recommended: only the owner's master key can shorten it.
- **A lifecycle rule** deletes versions after 15 days, once their retention has passed.
- **Cost (published price, 2026):** US$6.95 per TB-month, the first 10 GB free, egress free up to three times the
  stored volume. The fictional staging dumps are small (megabytes each): 14 copies stay well inside the free 10 GB,
  so the expected cost is **US$0 per month**. Even 1 GB a day would be about US$0.03 a month. Check the price at
  sign-up.
- **Not recommended:**
  - Cloudflare R2: its object read-and-write token does not clearly exclude deletion; only bucket locks would protect
    the copies.
  - Wasabi: it bills a minimum of 1 TB.

**Owner-only steps (no credential ever in an AI session):**
1. Create the B2 account and a private bucket with Object Lock enabled at creation and a default retention of 14 days
   (Governance).
2. Create the bucket-restricted upload key with exactly the capabilities above. Store its ID and secret only in the
   password manager. Later, enter them on the VPS yourself, into a root-only 0600 file, in your own terminal.
3. **The GPG key on Windows (Gpg4win / Kleopatra):**
   - install Gpg4win from its official site and verify the installer's signature or checksum;
   - Kleopatra → *New OpenPGP Key Pair*: name "Elite PO staging backups", a staging-only e-mail address;
     *Advanced settings*: ECC (Curve25519) or RSA 4096; expiry 2 years; a strong passphrase in the password manager;
   - *Export* the **public** key (`.asc`) and note its **fingerprint**: these two are the only things given to the VPS;
   - *Backup Secret Keys* to an offline encrypted medium (and the password manager), never to the VPS or the
     repository;
   - CLI alternative: `gpg --quick-generate-key "Elite PO staging backups <…>" ed25519 sign 2y`, then
     `gpg --quick-add-key <fingerprint> cv25519 encr 2y`, then `gpg --armor --export <fingerprint>`.

**Kit stage S12** (to be written, CI-rehearsed and owner-approved before its window):

| Unit | Design |
|---|---|
| `elite-po-backup.service` / `.timer` | inside the namespace and the slice, sandboxed, as the backup role (its credential by `LoadCredential`, never printed). Daily: `pg_dump -Fc` of `<DB>`, a tar of the fake storage, and a row-count sidecar → `gpg --encrypt` to the owner's public key only (a keyring holding just that key) → `/var/lib/elite-po-staging/backups/` (0700). The 14 newest are kept. An unencrypted file is never written outside the private temporary directory |
| `elite-po-offsite.service` / `.timer` | outside the namespace (it needs the internet), with **no** database access: it reads only the encrypted files. `rclone copy --immutable` (never `sync`, never deletes), with the owner-entered key |

Stop conditions: an unencrypted file is written; the off-host copy fails; any §I item.

**The restore drill** (fictional data; the running staging database is never touched):
1. The owner downloads one off-host copy (the web console, or a separate read-only key on the PC) and checks its
   SHA-256 sidecar.
2. They decrypt it **on the PC** with their private key.
3. They stream it over SSH into a kit restore tool, which:
   - creates a new `*_restore_test_only_` database in the staging cluster;
   - runs `pg_restore --no-owner` as the owner role;
   - compares every table's row count with the sidecar;
   - drops the restore database.

The drill passes when every count matches. It is required before staging acceptance.

## 10. S13 — feature activation and acceptance (NOT authorized; every switch stays off)

**Mechanics** (a kit stage, to be written and CI-rehearsed):
- one switch per step: the env file(s) are edited on the host (root 0600, never printed);
- `PLATFORM_CONSOLE_ENABLED`, `PLATFORM_INVITATIONS_ENABLED` and `PLATFORM_USER_INVITATIONS_ENABLED` go only in the
  admin file; `TENANT_ACCESS_ENFORCEMENT` and the `CUSTOMER_*` switches are identical in both files;
- then a restart of **the two staging units only**, the matrix check for that switch (`po06/SECURITY_AND_FLAG_MATRIX.md`
  §2), and a footprint sample;
- any failure turns that switch off. Turning back is in reverse order, F7 → F1.

| Step | Switch | Acceptance checks (fictional records only) |
|---|---|---|
| F1 | `PLATFORM_CONSOLE_ENABLED=true` | the administrator signs in with password and TOTP; a wrong code is refused and throttled; a recovery code works once; idle timeout; sign-out revokes the session; R3 now 200 on admin only; the customer ERP is unaffected |
| F2 | `TENANT_ACCESS_ENFORCEMENT=enabled` | company management; suspending a fictional company ends its sessions at the next request and refuses sign-in; restoring it allows a fresh sign-in; other companies are unaffected; step-up for sensitive actions |
| F3 | `PLATFORM_INVITATIONS_ENABLED=true` | create, revoke and re-issue a company invitation; the link is shown once and points at `https://<CUST_HOST>`; audit records for each step |
| F4 | `CUSTOMER_INVITE_ACCEPTANCE_ENABLED=true` | customer onboarding: acceptance creates one company, one primary owner and one Trial (14 days, 3 seats); a second use and an expired token are refused; primary-owner management |
| F5 | `PLATFORM_USER_INVITATIONS_ENABLED=true` (after L-3) | user invitations: a pending invitation occupies a seat; revoke and re-issue |
| F6 | `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED=true` | acceptance creates the user in the right company without a second seat; a second use is refused |
| F7 | `CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true` (with the P-8 consent) | seat limits: the 4th user is refused on every path with nothing written; a company above its allowance keeps its users |

**Across all steps:**
- session revocation;
- the customer ERP regression subset (`po06/STAGING_REGRESSION_SPEC.md`) and R1–R12 again;
- **English and Arabic** (RTL mirrored, numbers and dates LTR), **mobile and desktop** widths, **light and dark**
  themes, on both hosts;
- PDF generation (§4.1 limits);
- the §F footprint for at least 30 minutes, including a PDF burst;
- the live ERP's and the shared services' S0 checks unchanged after every restart.

**Scope:** this is **controlled, owner-only staging testing**: behind Basic Auth, fictional data, named operator
only. **It is not public or production availability.** That needs, separately:
- the PDF limiter (§4.1);
- the production ERP security release (§13);
- the production hardening items (staging plan §K);
- a production plan of its own.

## 11. Remaining risks and decisions

**Decisions for the owner:**

| # | Decision |
|---|---|
| D1 | Approve kit-4 (manifest digest in the closure report) for installation, as the first step of the next authorized window |
| D2 | Approve the proposed PostgreSQL `TasksMax=64` (reconcile, then a restart of the staging cluster only) — or keep the slice-only bound |
| D3 | The order S11a → S10 → S11b (recommended) instead of S10 → S11a |
| D4 | How the authenticated R1–R12 run through nginx: the owner runs the probe, or a root-only credential file read by the kit's probe |
| D5 | The backup provider (Backblaze B2 recommended), the Object Lock mode (Governance recommended), and the account and key, created by the owner |
| D6 | The owner's backup GPG key: generate it and provide the public key and fingerprint |
| D7 | The PDF limiter (§4.1) as an application change, before any unrestricted access |
| D8 | The HSTS policy (short `max-age` at S11b; one year at acceptance) |

**Risks:**
- R4: the template's `OOMScoreAdjust` applies to the staging cluster.
- R6: the strict listener rule versus services opening random ports.
- R8: `/_next/image`, denied at S11a.
- R9: §4.1.
- R10: §4.2.
- PO07-A11Y-01 is open.
- The staging services run continuously (contained; no route).
- The 24 Nov partial archive is kept as evidence.
- The owner's PC network may need the NAT64 route.
- The production-side items of the staging plan §K are still open (SSH root and password login, the CloudPanel
  admin port, internal services on all interfaces).

## 12. GO / NO-GO for the next separately authorized execution phase

| Phase | Verdict |
|---|---|
| A window to install kit-4 (`update`), then `reconcile --report` (read-only), and, if D2 is approved, the PostgreSQL cap | **GO, when authorized**, once the kit-4 CI run is green and the owner approves the digest |
| S11a (nginx) | **GO only with a separate authorization**, after D3/D4 and after the nginx rehearsal (§6) is built and green |
| S10 (DNS), S11b (certificates) | the owner performs them, after S11a (D3) |
| S12 | **NO-GO** until D5/D6 and the S12 kit stage is written and rehearsed |
| S13 | **NO-GO** until S11b and S12 pass and the S13 kit stage is written and rehearsed |
| Public or production availability | **NO-GO** (§10 scope) |

## 13. The production ERP security release (a separate workstream; not merged, not deployed)

Plan: `PO07_ERP_SECURITY_RELEASE_PLAN.md`. State on 25 Nov 2026:
- `main` = `621f156` (Next.js 16.4.3); it no longer passes the build's advisory gate.
- `fix/team-sensitive-fields-exposure` = `621f156` + `35d5dcc` (the Team fix) + `94f936e` (handover), unchanged.
- The Next.js 16.4.6 commit `9b8aa85` exists only on `feat/platform-owner`. N1 (the release branch and the
  cherry-pick) has not started.

**New finding from PO-07:**
- The plan's N3 builds the release **on the VPS** under `MemoryMax=1536M`.
- A Next.js 16.4.6 build of the Platform Owner branch needed **more than 2.3 GB** on this VPS and failed three times
  (`PO07_SHARED_VPS_STAGING_PLAN.md` §F.1). An ERP build is likely to need a similar amount.
- **Recommendation:** first measure the ERP release build in CI. Then replace N3 with a verified external build
  (as S6-R): a GitHub-hosted build, an attested archive, its SHA-256 checked on the VPS, and installation beside the
  live release.

**Readiness: the plan is complete, but NOT ready to execute.**
- N1 needs the owner's go-ahead.
- N3 must be revised and measured first.
- Nothing is merged or deployed.
