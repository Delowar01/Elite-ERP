# PO-07 — Existing-VPS preflight: the Platform Owner portal on its own subdomain

**Status: PLAN ONLY.**
- Phase A (the read-only VPS inspection) has **not** been executed. It must run in Claude Code on the owner's
  Windows PC (§K).
- Nothing on the VPS, in DNS, in nginx/CloudPanel or in any database was read, changed, restarted or migrated.

**This repository is public.**
- This document holds no server evidence and no secret.
- The Phase A output stays outside the repository (§K). Only a sanitized summary may come back.
- The hostnames appear only as `<ERP_HOST>` (the existing ERP) and `<ADMIN_HOST>` (its `admin.` subdomain, for the
  portal). The real names are in the owner's report.

## Owner decisions recorded from the owner's written instructions (21 Nov 2026)

| Decision | Recorded |
|---|---|
| Hosting | use the **existing** Hostinger VPS; no new server |
| Hostnames | existing ERP `https://<ERP_HOST>`; Platform Owner portal `https://<ADMIN_HOST>` (the `admin.` subdomain of the ERP host) |
| Operator | Claude Code on the owner's local Windows PC, over the existing authorized SSH connection |
| Approval form | the owner's written instructions suffice; no separate signed documents |
| Authorized now | Phase A read-only inspection; Phases B–F analysis and plan |
| Not authorized | changes to the live ERP database, application deployments, service restarts, DNS / nginx / CloudPanel changes, migrations, weakening security, merges, Prompt 8 |

**The repository's own record of the VPS** (`CLAUDE.md` on `main`, owner-confirmed 2026-10-30):
- the VPS runs a **development/testing** deployment, even with `NODE_ENV=production`;
- it holds **no real customers or business data**;
- the owner accepts losing that test data, but not damage to other services, databases, infrastructure or secrets.

Phase A should confirm this is still true (§D-P7-7).

## A. Existing VPS infrastructure

**Pending Phase A.** Sections A1–A6 of the inspection report:
- the distribution;
- CPU, RAM, swap and disk;
- the control panel (CloudPanel or other);
- the listening sockets;
- the running services and Node.js processes.

## B. Existing ERP deployment architecture

From the repository (to be confirmed by Phase A, sections B–C):
- **App process:** Next.js listens on plain HTTP on a loopback port (port 3200, per
  `docs/ui/dev-ui-01-7/integration-with-main.md` on `main`).
- **TLS:** nginx terminates it and forwards with `X-Forwarded-Proto: https` and `Host: localhost:<port>`.
- **PDFs:** `PDF_RENDER_ORIGIN` points the PDF renderer at the loopback origin.
- **Process manager:** the README documents pm2 or systemd; the actual one is unknown until Phase A.

**Open question for Phase A:** does the ERP vhost forward `X-Forwarded-Host`?
- Next.js's Server Actions check compares `Origin` with `X-Forwarded-Host`, falling back to `Host`.
- The customer ERP works today, so the vhost probably forwards it. The exact headers decide the admin vhost's
  settings (§I.2).

## C. Actual deployed application and database state

**Pending Phase A.** Section B of the inspection report lists, for each running Node.js app directory:
- the working directory, the Git SHA and branch, the build ID and time, uncommitted changes;
- the installed Next.js and Node versions;
- the environment variable **names** (never values);
- the database **provider class** (Neon pooled/direct, local, or other). It never shows the URL, user, password, host
  or database name.

**Whether the database holds real customer records:**
- No SQL is authorized in this phase, so Phase A can give only indirect evidence: the access-log aggregates and the
  `uploads/` count (sections H and B1).
- The repository record above says test data only. A definitive answer needs the read-only D-7 bundle, which is not
  authorized.

## D. Admin subdomain availability and DNS status

**Pending Phase A** (section E, run from the VPS; plus `nslookup` from the PC). Phase A must establish:
- whether `<ADMIN_HOST>` resolves;
- whether a wildcard record exists (a random label is probed);
- whether either name points at this VPS;
- the domain's name servers;
- whether any nginx `server_name`, wildcard or `default_server` would already answer that name (section C2).

A lookup from the cloud session gave no usable answer (its resolver returned nothing even for the live ERP name). It is
not evidence.

## E. Option A vs Option B

| # | Criterion | **Option A** — separate test instance, fictional data | **Option B** — the existing ERP app also serves the admin host |
|---|---|---|---|
| 1 | Safety and isolation | the ERP's process, code, env, database and vhost stay untouched. Isolation comes from a separate Linux user, directory, port, systemd unit, secrets and database — **not** from the hostname. Shared kernel, disk, RAM and nginx remain (mitigated: memory cap, systemd hardening, `nginx -t` before every reload) | none between console and ERP: one process, one database. A console defect or an outage affects the ERP |
| 2 | Compatibility with the current app | none needed: it runs `feat/platform-owner` (`1c8682f`) next to the ERP | the ERP must be upgraded to the Platform Owner release: Next.js 16.4.6, the Team fix, every PO-01…PO-06 change, and the customer-side behaviour changes (Team session correction L-8, seat display) |
| 3 | Database | a new loopback PostgreSQL database named `*_test_only_*`. The D-6 tool works exactly as rehearsed. **It shows fictional companies only — not the ERP's companies** | the existing ERP database. It needs the additive Platform Owner schema (S01–S07, S08 optional) and the Trial seed |
| 4 | Authentication and cookies | separate secrets; `__Host-` host-only cookies per hostname. A customer cookie can neither reach the admin host nor validate there | `__Host-` cookies are still per host, so customer and console cookies stay apart, but both route trees are reachable on both hosts unless nginx separates them (§I.2) |
| 5 | Origin / CSRF | the admin vhost forwards `X-Forwarded-Host $host`; `PLATFORM_TRUSTED_PROXY_HOPS=1`. The console's `assertSameOrigin` requires `same-origin`, so a request from the ERP host (same-site, not same-origin) is refused | the same, and the ERP vhost must forward consistent headers too |
| 6 | TLS, nginx, proxy | one new vhost and one new certificate. The ERP vhost is unchanged | one new vhost and one new certificate, plus a `/platform` block on the ERP vhost |
| 7 | Resources | a second Node.js process (several hundred MB), PostgreSQL (~150–300 MB), and a build peak of ~1.5–2.5 GB under a memory cap. **Capacity check required** (Phase A2) | no new process; the same build peak |
| 8 | Deployment / rollback | independent and reversible in minutes (remove the vhost, stop the unit, drop the test database) | a full release with app rollback (keep the previous build) and schema rollback (the reviewed R08 … R02 path, whose guards refuse rather than destroy data; or leave the additive objects, which the old code ignores) |
| 9 | ERP restart | **no** — only a graceful `nginx` reload | **yes** — the ERP process restarts on the new release |
| 10 | Production migrations | **none** | **yes** — on the existing database, through a production-safe method the D-6 tool deliberately does not provide (§G) |

## F. Recommended architecture

**Now: Option A.** A separate Platform Owner instance with fictional data on the existing VPS, behind
`<ADMIN_HOST>`.
- It satisfies "the portal on the existing VPS at the admin hostname".
- It leaves the ERP and its database untouched.
- It reuses the rehearsed D-6 path unchanged.
- It doubles as an on-host rehearsal of the proxy chain, TLS, cookies, MFA and switches.
- It does **not** manage the real ERP companies, and must be labelled as testing (§D-P7-1).

**Later: Option B**, as its own release. It becomes the real rollout once all of these are done:
1. the security release (§H) is on `main` and deployed;
2. a reviewed production-safe migration method exists (§G);
3. D-7, or an owner waiver given the test-data status, and the E-1 / L-8 decisions are complete.

At that point the admin vhost's upstream is switched from the test instance to the ERP port in one reviewed change, and
the test instance is retired.

## G. Database migration and security risks

1. **The D-6 tool stays limited to loopback `*_test_only_*` databases.** It must not be altered or bypassed to reach
   the existing ERP database.
2. **Option B needs a separate, reviewed, production-safe method.** The proposal:
   - a new, explicitly approved target mode, pinned to the database's identity;
   - a dedicated migration role;
   - Neon's **direct** endpoint, because the CONCURRENTLY steps cannot run through a transaction-mode pooler
     (`po06/D6_MIGRATION_RUNBOOK.md`);
   - an instant restore point first (a Neon branch, if the provider is Neon);
   - the same 13 files in manifest order, each verified against its pin;
   - `--concurrent-indexes` mandatory (D6-F4).
3. **The production schema baseline is not verified.** PO-06 proved that a push of `main` plus hardening equals the
   expected shape. The real database may differ (drift, H-3 damage, a missing `db:harden`). D-7's D7-09 checks this
   read-only.
4. **D-7.** It is required to know:
   - the owner classes A–F (primary-owner backfill, O-2);
   - E1 duplicates (E-1);
   - sizes and blockers.
   Given the test-data status, the owner may instead run it on a Neon branch, or waive it. That is an owner decision
   (§D-P7-7).
5. **Legacy companies** have no primary-owner mapping and no subscription:
   - the console shows them as legacy;
   - Platform Owner invitations for them are refused until a subscription is assigned (P-4).
6. **E-mail uniqueness:** `users_email_lower_uq` needs E1 = 0. `/register` lacks a 23505 handler (EI-1).
7. **Backups** (Option B): a database restore point plus the previous build, kept for an instant code rollback.
8. **Verdict: production database deployment — NO-GO** until 1–7 are complete.

## H. Team security hotfix and Next.js update — the safest release sequence (independent of Platform Owner)

`main` still lacks two fixes:
- the Team sensitive-field fix (`fix/team-sensitive-fields-exposure`: `35d5dcc` + handover `94f936e`, based exactly
  on `main` `621f156`);
- Next.js 16.4.6 (PO-05 commit `9b8aa85`: `package.json`, `package-lock.json`, `verify/document-form-pins.json`).
  PO-05 showed these same three files build the hotfix branch with exit 0.

**The sequence, each step needing its own approval — nothing here is executed:**
1. Create a release branch from `main` `621f156`. Fast-forward it to the hotfix (`94f936e`), then cherry-pick
   `9b8aa85` as one separate commit.
2. On disposable TEST databases, verify:
   - `npm ci`, TypeScript, ESLint;
   - the complete build (71 pages);
   - the customer tiers (`verify:server`, `verify:static`, the browser tier), the HTTP probe, and the Team-field canary
     check.
3. Open a PR to `main`. The owner reviews and merges.
4. Deploy to the VPS with its existing procedure (Phase A, B2), in a quiet window:
   - keep the previous build for rollback;
   - restart the ERP (a brief interruption);
   - verify.
5. Rollback: redeploy the previous build or SHA and restart.
6. Afterwards, merge `main` into `feat/platform-owner`. Both changes are already there, so this is expected to be
   trivial.

The Platform Owner branch is neither merged nor deployed by this sequence.

## I. Exact changes required for Option A (proposed; none made)

Placeholders `<…>` are fixed after Phase A. **Each step is production-affecting: run it only with the owner's go-ahead
for that stage.**

**Relation to the PO-06 runbook.** `po06/STAGING_DEPLOYMENT_RUNBOOK.md` assumed a new host and forbade the Hostinger
VPS. The owner's instruction of 21 Nov 2026 replaces only the host. Option A follows that runbook's steps 3–19 on the
existing VPS, and everything else it forbids still holds:
- production credentials, production storage and production Neon;
- live messaging or payment services;
- production DNS records other than the new admin name.

The deltas for a VPS shared with the ERP:
- no host-wide firewall change. Instead, the test unit's runtime traffic is limited to loopback (§I.3);
- its own Linux user, port `<ADMIN_PORT>`, systemd unit, `0600` env file and PostgreSQL database;
- the build runs under a memory cap at a quiet time;
- nginx gets a new vhost only (the ERP vhost is untouched), with `nginx -t` before a graceful reload;
- verification adds the "ERP unchanged" checks (§I.5).

### I.1 DNS and TLS

| Item | Change |
|---|---|
| DNS (owner, at the domain's DNS provider) | an A record for `<ADMIN_HOST>` → the VPS's IPv4 (plus AAAA if the VPS serves IPv6), TTL 300. **Not needed** if Phase A finds a wildcard already pointing at the VPS. If Phase A finds a CDN or proxy in front of the ERP host, decide whether the admin host uses it too (this changes `PLATFORM_TRUSTED_PROXY_HOPS`) |
| TLS | a Let's Encrypt certificate for `<ADMIN_HOST>`, through CloudPanel's SSL tab or `certbot`, once DNS resolves. It will appear in public Certificate Transparency logs, so the hostname becomes discoverable (§D-P7-4) |

### I.2 nginx — the admin host serves only the console

**Design:**
- `/` redirects to `/platform/login`;
- only `/platform`, `/platform/*`, `/_next/static/*` and `/favicon.ico` are proxied. The console's pages, RSC requests and Server
  Actions all live under `/platform`, and its fonts and scripts under `/_next/static`;
- everything else is 404: customer pages, `/api/*` (including PDF routes), `/print/*`, `/login`, `/register*`,
  `/join*`;
- the noindex header and a deny-all `robots.txt`;
- the ERP vhost stays unchanged.

On CloudPanel, create a reverse-proxy site for the hostname (UI, or `clpctl site:add:reverse-proxy` — confirm the
syntax with `clpctl list`), then apply the locations below in its vhost editor. On plain nginx, add a new file in
`sites-available`, link it, then `nginx -t` and `systemctl reload nginx` (graceful).

~~~nginx
server {
    listen 443 ssl;                 # add "listen [::]:443 ssl;" if the host has an AAAA record
    http2 on;                       # nginx older than 1.25.1: drop this line, use "listen 443 ssl http2;"
    server_name <ADMIN_HOST>;
    ssl_certificate     <CERT_FULLCHAIN>;
    ssl_certificate_key <CERT_KEY>;
    add_header X-Robots-Tag "noindex, nofollow" always;
    client_max_body_size 2m;

    location = /           { return 302 /platform/login; }
    location = /robots.txt { default_type text/plain; return 200 "User-agent: *\nDisallow: /\n"; }
    location = /platform         { proxy_pass http://127.0.0.1:<ADMIN_PORT>; include <ADMIN_PROXY_PARAMS>; }
    location ^~ /platform/       { proxy_pass http://127.0.0.1:<ADMIN_PORT>; include <ADMIN_PROXY_PARAMS>; }
    location ^~ /_next/static/   { proxy_pass http://127.0.0.1:<ADMIN_PORT>; include <ADMIN_PROXY_PARAMS>; }
    location = /favicon.ico      { proxy_pass http://127.0.0.1:<ADMIN_PORT>; include <ADMIN_PROXY_PARAMS>; }
    location /                   { return 404; }
}
# <ADMIN_PROXY_PARAMS>
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header Connection        "";
~~~

- The port-80 server only redirects to HTTPS and serves the ACME challenge.
- Every location relies on the server-level `add_header`. A location that adds its own `add_header` stops inheriting
  it and must repeat the `X-Robots-Tag` line.
- Optional, per §D-P7-4: an IP allow-list or basic auth in front of the console.
- `PLATFORM_TRUSTED_PROXY_HOPS=1` assumes nginx is the only proxy. If Phase A finds a CDN or proxy in front, the hop
  count changes and this must be re-decided.

### I.3 The separate instance

| Item | Proposal |
|---|---|
| Linux user | a new unprivileged user (or a CloudPanel site user), owning only its own directory |
| Code | the approved head of `feat/platform-owner` (application code as at `1c8682f`; PO-07 changed only `docs/`), cloned from the public repository (no credential needed) or copied as a verified `git bundle` |
| Node.js | 22.x. Reuse the ERP's Node if it is 22. Otherwise install a separate copy for this user only — **never change the ERP's Node** |
| Database | PostgreSQL bound to 127.0.0.1 only (16, or the distribution's version ≥ 14, rehearsed first), with a database named `*_test_only_*`, a migration role and a DML-only runtime role |
| Service | a new systemd unit:<br>• `next start -H 127.0.0.1 -p <ADMIN_PORT>`<br>• `MemoryMax`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict` with only its own build and storage paths writable<br>• runtime network limited to loopback: `IPAddressDeny=any` with `IPAddressAllow=localhost` (needs cgroup v2, Phase A2; checked after start)<br>• its own env file (`0600`, owned by that user) |
| Environment | its own `AUTH_SECRET` and `PLATFORM_AUTH_SECRET` (distinct) and `FIELD_ENCRYPTION_KEYS`, generated on the host without being printed; `PLATFORM_TRUSTED_PROXY_HOPS=1`; `STORAGE_DRIVER=fake`; `NEXT_TELEMETRY_DISABLED=1`; every switch unset at first; the rest as in `po06/STAGING_ENV_TEMPLATE.md` (for example `STORAGE_FAKE_DIR`, and `RATE_API_BASE` pointing at a local stub). **No variable of the ERP is copied** |
| Migration | the rehearsed sequence of PO-06 runbook steps 6–10:<br>• `release-manifest.ts --check`, then `--status`<br>• `--apply --base --concurrent-indexes --verify-data` (B00, S00–S07). `--base` creates the customer schema, and only on a new, empty database<br>• then, because L-3 is approved for staging, `--apply --concurrent-indexes --include-staged-user-invitations --verify-data` (S08, S09)<br>• then `npm run platform:db:check` and `npm run verify:db-hardening` |
| Build | `next build` as that user, under a memory cap, at a quiet time, so the ERP is never starved. Build-time egress is needed only for npm and Google Fonts |
| First administrator | **the owner runs `npm run platform:bootstrap` personally** in their own terminal. It prints the TOTP secret and recovery codes once, and these must not pass through an AI session |
| Switches | F1 → F7, one per restart of **this unit only**, each with its checks. F4/F6 need a customer origin for the test instance (§D-P7-3) |

### I.4 What is affected on the VPS

**Affected:**
- nginx: one new vhost and a graceful reload;
- system packages: PostgreSQL, unless a suitable one already exists;
- CPU, RAM and disk;
- DNS and TLS for one new name.

**Not affected:** the ERP's process, code, `.env`, port, database and vhost.

### I.5 Post-deployment verification

**The ERP is unchanged:**
- the same PID and uptime (proving no restart);
- the same status and headers for its routes as the Phase A baseline;
- the same certificate;
- a working sign-in.

**The admin host behaves as designed:**
- `/` returns 302 to `/platform/login`;
- `/platform/login` returns 200 once F1 is on, and 404 before;
- `/login`, `/api/…`, `/register` and `/print/…` return 404;
- the `X-Robots-Tag` header is present;
- the cookie is `__Host-elite_erp_platform` (Secure, HttpOnly, `Path=/`, no `Domain`);
- password + TOTP login, a refused cross-origin POST, sign-out and revocation, and the F1–F7 checks;
- then the staging regression subset of `po06/STAGING_REGRESSION_SPEC.md`.

## J. Rollback plan

**Option A — the ERP is never touched:**
1. switches off;
2. remove (or disable) the admin vhost, then `nginx -t` and `systemctl reload nginx`;
3. `systemctl disable --now` the test unit;
4. drop the test database and roles, and remove the user and directory if wanted;
5. delete the DNS record if wanted.

**Option B (later):**
1. switches off in reverse order;
2. redeploy the previous build and restart;
3. leave the additive schema in place (the old code ignores it), or use the reviewed rollback path (R08 … R02);
4. as a last resort, the restore point.

## K. Read-only evidence

**Gathered in the cloud session** (repository and public metadata only; no SSH, no SQL, no VPS access):

| Fact | Evidence |
|---|---|
| Console paths | the console lives entirely under `/platform` (route group `(platform)`, one route handler at `/platform/session-expired`). It references no other app path, except Next.js's `/_next/static` and the root `favicon.ico` |
| Console gate | `/platform` is gated by `PLATFORM_CONSOLE_ENABLED`: off means 404 plus noindex (`src/lib/platform-edge/proxy-gate.ts`). There is **no hostname binding** in the code, so host separation is nginx's job, and a code-level host binding is a recommended later improvement |
| Same-origin check | `assertSameOrigin` (`src/lib/platform/origin.ts`) compares `Origin` with `X-Forwarded-Host` when `PLATFORM_TRUSTED_PROXY_HOPS` ≥ 1, otherwise with `Host`, and requires `Sec-Fetch-Site: same-origin` |
| Server Actions | `next.config.ts` sets no Server Actions `allowedOrigins`, so Next.js's own check relies on the forwarded host |
| Existing VPS | the ERP behind TLS on loopback port 3200, with `PDF_RENDER_ORIGIN` set (public doc on `main`); dev/test status and test-only data (`CLAUDE.md` on `main`) |
| Branches | hotfix = `main` + 2 commits; Next.js update = commit `9b8aa85` (3 files) |
| Repository | public |
| Inspection script | tested here on a fictional fixture (fake Next.js processes, nginx tree, certificate, access log, git checkout):<br>• 43/43 helper checks and 33/33 end-to-end checks<br>• no file changed (178 entries compared)<br>• none of the fixture's secrets or addresses appeared in the output |

**Phase A procedure for the local operator (Claude Code on the owner's PC):**
1. Extract the script into a folder outside the repository, without checking the branch out. `git cat-file blob`
   writes the exact committed bytes. A Windows checkout can convert the line endings, which breaks the script on Linux.

   ~~~bash
   git fetch origin feat/platform-owner
   mkdir -p ~/elite-erp-po07
   git cat-file blob FETCH_HEAD:docs/platform-owner/po07/vps_readonly_inspection.sh > ~/elite-erp-po07/vps_readonly_inspection.sh
   sha256sum ~/elite-erp-po07/vps_readonly_inspection.sh
   ~~~

   - The hash must be `94c42572f8e64a089bcde5af64ebbed9cd12917b2f95bdae163b44a357d5e0bc`.
   - Read the script before running it.
2. Identify the alias with `grep -iE '^[[:space:]]*Host[[:space:]]' ~/.ssh/config`. Then
   `ssh -G <alias> | grep -E '^(hostname|user|port|identityfile|forwardagent|proxyjump|stricthostkeychecking) '` shows
   names and paths only; the key itself is never shown.
3. Confirm the target is the ERP host:
   - `nslookup <ERP_HOST>` gives the alias's host name or address. A CDN in front makes these differ; then rely on the
     next two checks;
   - `ssh-keygen -F <host name from ssh -G>` finds a known host key. A new or changed key is never accepted silently;
   - after connecting, the inspection's section C2 shows the ERP host's `server_name` on that server.
4. Run the inspection, saving the output outside the repository:

   ~~~bash
   ssh -o BatchMode=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o StrictHostKeyChecking=yes <alias> \
     'bash -s -- <ERP_HOST> <ADMIN_HOST>' < ~/elite-erp-po07/vps_readonly_inspection.sh > ~/elite-erp-po07/vps-inspection.txt 2>&1
   ~~~

   If SSH fails (host key, key passphrase, permission), stop and tell the owner:
   - never relax host-key checking;
   - never ask for a key or passphrase;
   - the owner can run the same command in their own terminal.
5. Public checks from the PC:
   - `curl -sSI https://<ERP_HOST>/login`: the status line, plus `strict-transport-security`,
     `content-security-policy` present or absent, `x-robots-tag`, `server`, and cookie **names**;
   - `nslookup <ADMIN_HOST>`.
6. Read the output for anything sensitive before sharing it. Report only a sanitized summary for sections A–D. Never
   commit the raw output.

## L. GO / NO-GO for the actual implementation

| Item | Verdict |
|---|---|
| Phase A (read-only inspection) | **ready to run** on the owner's PC (§K). Not executed: the cloud session cannot reach the VPS |
| Option A implementation | **NO-GO until** Phase A shows enough capacity and no conflicting vhost/DNS, and the owner decides D-P7-1…6 and D-P7-9. Then GO for a staged execution, each step production-affecting and individually confirmed |
| Option B / production database deployment | **NO-GO** (§G) |
| Security release | **ready to prepare** as its own approved task (§H); not started |

### Owner decisions that cannot be inferred

| Id | Decision |
|---|---|
| D-P7-1 | Option A now? Accept that the admin host shows **fictional** companies, labelled as testing, until Option B. For this test instance, this replaces S-1 (a separate hosting account) and the PO-06 runbook's "never the Hostinger VPS" |
| D-P7-2 | Accept installing PostgreSQL on the existing VPS for the test instance (a new local service, loopback only) |
| D-P7-3 | Invitation acceptance (F4/F6) in Option A. Either add a test customer hostname, or test F1–F3 and F5 only. The admin host must not serve customer routes |
| D-P7-4 | Add an IP allow-list or basic auth on the admin host (it becomes discoverable through Certificate Transparency)? |
| D-P7-5 | The Node.js 22 source for the test instance, if the ERP runs another version |
| D-P7-6 | The repository is public. Keep VPS evidence out of it (recommended); review the existing public mention of the internal port |
| D-P7-7 | Confirm the `CLAUDE.md` data status (test data only) still holds, and choose proportionate gates for Option B (D-7 on a Neon branch, or a waiver) |
| D-P7-8 | Authorize preparing the security release (§H) as a separate task |
| D-P7-9 | Who creates the DNS record, and at which provider |
