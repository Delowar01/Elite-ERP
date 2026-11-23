# PO-07 S6-R — external build and verified installation (Platform Owner staging)

**Owner decision S6-R1 (23 Nov 2026): APPROVED — build off the VPS with GitHub Actions.** The shared staging VPS
cannot run `next build` of the approved release within the memory its other services can spare
(`PO07_SHARED_VPS_STAGING_PLAN.md` §F.1). The build therefore runs on an isolated GitHub-hosted runner, and the VPS
only installs a verified archive of it (stage S6-R).

This repository is public. Like the staging plan, this document uses placeholders (`<APP_USER>`, `<APP_DIR>`,
`<NS>`, `<PG_PORT>`, …). The real names, the private staging kit and the raw evidence stay in the owner's private
evidence directory.

## 1. What is built, and from what

| Item | Value |
|---|---|
| Source | `Delowar01/Elite-ERP`, branch `feat/platform-owner`, commit `<APPROVED_SHA>` = `cf64ebc492b56ad91c28ba3aa7640722935e21c5`, tree `6403cf5d822df491f6e16a56068ab9d7c2f1f138`. Unchanged: no application file was changed for packaging |
| Workflow | `.github/workflows/po07-staging-artifact.yml` (in later commits on the same branch; it checks out `<APPROVED_SHA>` and never the branch head's application tree) |
| Runner | GitHub-hosted `ubuntu-24.04` (glibc 2.39) |
| Runtime | Node.js **22.23.2** (the staging VPS's version, required to be equal); npm 10.9.8; Next.js **16.4.6** from the committed lockfile |
| Output | `next start` layout (the existing `next.config.ts` has no standalone output, and none was added) |

## 2. The workflow, step by step

The build job has only `contents: read`, uses no repository secret, and checks out with `persist-credentials: false`.
Every third-party action is pinned to a full commit SHA.

1. **Source identity.** `HEAD` = `<APPROVED_SHA>` and `HEAD^{tree}` = the approved tree. The checkout is clean, and the
   commit is in the branch history of the workflow commit. `next.config.*` may not contain `ignoreBuildErrors` or
   `ignoreDuringBuilds`.
2. **Runtime.** `node -v` must equal `v22.23.2`.
3. **Archive validator self-test.** `ci/po07-artifact/test-check-archive.mjs` builds 28 archives: one valid, the
   others hostile. The hostile ones include path traversal, absolute names, link escapes, writes through a link,
   hard links, devices, FIFOs, setuid bits, world-writable modes, tampered or missing files, GNU or `xattr` headers,
   a bad checksum, trailing data and truncation. The validator must accept the valid archive and refuse every hostile
   one for the expected reason.
4. **`npm ci`** from the committed lockfile. Next.js must be 16.4.6, and no tracked file may change.
5. **TypeScript** (`tsc --noEmit`), **ESLint** (`eslint src --max-warnings=0`) and the **platform boundary test**.
6. **Env-embedding probe.** One build runs with a unique random canary in every runtime string value, limited to
   2 CPUs as on the VPS, and is then discarded. Its whole output is searched for every canary; a single hit fails the
   run (§4).
7. **The artifact build.** A clean `next build` with normal type checking. Its only input is a fictional,
   password-less, unreachable `DATABASE_URL`. The log must show "Compiled successfully" and "Running TypeScript", and
   must not contain "Skipping validation of types". No tracked file may change.
8. **Output completeness** (`check-build.mjs`):
   - `BUILD_ID` and every manifest `next start` loads;
   - every page and route under `src/app` (99) has its app-paths entry and compiled server file, with no unexplained
     entry (102 in total, including Next's own `/_not-found`, `/_global-error` and `/favicon.ico`);
   - the Server Action manifest is non-empty (228 actions);
   - every Turbopack external link in `.next/node_modules` resolves to a package.
9. **Native binaries.** Every ELF binary in `node_modules` must load its libraries. The highest glibc version they
   need is recorded (2.30, for `@next/swc`). npm also installs the musl variants of each optional native package;
   these can never load on glibc and are listed as unused.
10. **Package** (`package.sh`), then the **secret scan** (§4), then the **archive validator** with the expected
    provenance.
11. **Relocated install.** The build directory is moved away first, so no absolute build path can still resolve.
    - A pristine `git archive` of `<APPROVED_SHA>` goes to a different path and depth.
    - The archive is extracted as an unprivileged user. The per-file SHA-256 manifest and the link list are
      re-checked on disk, and `.next` and `node_modules` are moved in.
    - Checks: `next --version`; every dependency and Turbopack external resolves inside the tree; the native set and
      glibc need equal the recorded ones; `npm ls`.
12. **The H-1 hostname-security suite runs against the installed archive.** It uses a disposable PostgreSQL on the
    runner's loopback and TEST-ONLY secrets in memory. It starts three `next start` servers from the one build: the
    console with the switch on and one trusted proxy, the customer with the switch unset, and an unbound server. The
    files the servers write are listed.
13. **Upload, only if every step passed.** The archive, `ARTIFACT.json` and `SHA256SUMS` are uploaded uncompressed
    (they are already gzip) and kept 30 days.
14. **Attestation** (a separate job). This job never runs npm, and it alone has `id-token: write` and
    `attestations: write`. It re-checks the SHA-256 of the downloaded archive against the build job's output, then
    signs a SLSA build provenance attestation (Sigstore) for the archive.

## 3. The archive

`po07-staging-build-<sha12>.tar.gz` is a POSIX pax tar with sorted names, numeric owner 0 and one fixed mtime (the
source commit's). It has one top-level directory:

| Path | Content |
|---|---|
| `po07-artifact/.next/` | the build output. Removed: the build cache (`.next/cache/*`, shipped as an **empty** `.next/cache`, which stays empty and read-only, like the whole build: §8, J1) and the build traces (`.next/trace*`) |
| `po07-artifact/node_modules/` | exactly what `npm ci` installed from the lockfile, development tools included (S8 and S9b use `tsx`, `drizzle-kit` and the verify scripts). esbuild's hard-linked binary is shipped as independent copies (the list is in `ARTIFACT.json`) |
| `po07-artifact/MANIFEST.sha256` | the SHA-256 of every file |
| `po07-artifact/SYMLINKS.txt` | every link and its (relative, in-tree) target |
| `po07-artifact/ARTIFACT.json` | provenance: source commit and tree; workflow commit, run id and URL; runner image; Node.js, npm and Next.js versions; hashes of the lockfile, `package.json` and `next.config.ts`; the build id; file, link and byte counts; the hashes of the manifest and the link list; exclusions, link rewrites and hard-link copies; the native-binary list and its glibc need; the build measurements |

The tracked files (`src`, `public`, `package.json`, `package-lock.json`, `next.config.ts`, `drizzle`, `scripts`,
`verify`, …) are **not** in the archive. On the VPS they come from the S5 clone at the same commit, and S6-R checks
that its tree hash equals the approved tree. Same tree, same bytes: nothing from two different builds is ever mixed.

## 4. Build-time environment safety

| Value | Fixed at build time? | Evidence | Supplied at run time by |
|---|---|---|---|
| `DATABASE_URL` | **no**. The build sees only the fictional `postgres://build@127.0.0.1:9/build_test_only_` (no password, an unreachable port) | probe canary (the password) absent; the H-1 suite connects to its own disposable database at run time | the root-only env file (`EnvironmentFile=`) |
| `AUTH_SECRET`, `PLATFORM_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` | **no** | probe canaries absent; H-1 runs with secrets generated at run time | the env files (generated on the VPS at S7, never printed) |
| `PLATFORM_CONSOLE_HOST`, `CUSTOMER_APP_HOST`, `PLATFORM_TRUSTED_PROXY_HOPS` | **no** | probe canaries absent. H-1 runs the one build with the binding, with hops 1, with hops 0 and unbound | the env files |
| `PLATFORM_CONSOLE_ENABLED` and the other `*_ENABLED` switches | **no** | compared with a literal, so a canary search cannot detect them. H-1 proves they are read at run time: the same build is the console (on) and the customer (unset) | `admin.env` only (all off until S13) |
| `CUSTOMER_PUBLIC_ORIGIN`, `PDF_RENDER_ORIGIN`, `PLATFORM_INVITATIONS_LOOPBACK_ORIGIN`, `CHROMIUM_EXECUTABLE_PATH`, `CHROMIUM_PACK_URL`, `STORAGE_*`, `RATE_API_BASE`, `CUSTOMER_LEGACY_TOKENS` | **no** | probe canaries absent | the env files (`PDF_RENDER_ORIGIN` in `customer.env` only) |
| `NEXT_PUBLIC_*` | none exist in the application | source search | — |
| `NODE_ENV` | **yes**: `production` (set by `next build`) | Next.js behaviour | — |

Before the archive is made, the **secret scan** (`scan-artifact.mjs`) checks the staged tree. It prints file and
offset only, never a value.
- **Build output: failure on** an `.env` file; a private-key block; a URL with a password; a GitHub, npm, AWS, Stripe
  or Slack token; a JSON Web Token; any probe canary; the value of the runner's Actions tokens.
- **Dependencies: failure on** a canary, a token value or a GitHub token. Key-like test fixtures that packages ship
  are reported but don't fail the scan.
- **Reported:** where the runner's build path and the fictional database name occur.

## 5. Delivery: GitHub → the owner's PC → the VPS

1. **On the PC** (`pc-kit.sh artifact-fetch <run id>`, owner's existing `gh` login, no VPS access):
   - **Run:** it is from this repository, not a fork; its workflow file is this one; its event is `push` or
     `workflow_dispatch`; its branch is `feat/platform-owner`; its head commit is a reviewed workflow commit; it
     succeeded, and both its jobs succeeded on GitHub-hosted runners.
   - **Artifact:** there is exactly one, named for `<APPROVED_SHA>` and the run, and it hasn't expired.
   - **Download:** the zip's SHA-256 equals GitHub's recorded digest. Its entries (the archive, `ARTIFACT.json` and
     `SHA256SUMS`) are listed before extraction, and `SHA256SUMS` verifies.
   - **Attestation:** `gh attestation verify` checks the repository, the signer workflow, the branch, the commit and
     a GitHub-hosted runner.
   - **Validator:** it passes, with the expected commit, tree, Node.js and Next.js. The inner `ARTIFACT.json` equals
     the outer one.
   - **Output:** a private receipt and `ARTIFACT.expected`.
2. **To the VPS** (`pc-kit.sh artifact-upload <run id>`, only inside an authorized window):
   - The local SHA-256 is re-checked.
   - The archive streams over the existing authenticated SSH into a root-only (`0700`) incoming directory under the
     private kit directory, never into the application tree.
   - It is written to a temporary name and then renamed (it refuses to overwrite).
   - The SHA-256 is re-checked on the VPS, and the expected values are recorded.
3. **S6-R** checks everything again on the VPS (§6).

## 6. S6-R — verified external build installation (prepared; NOT executed)

S6-R runs through the existing staging kit: plan mode by default; execute mode only on the VPS, inside the window,
after the owner's written authorization and a fresh S0; every mutation allow-listed to staging paths and units.

1. **Health.** The §I guard and the start thresholds, against the fresh S0. That S0 is compared with the last S0 of
   the previous window, the S1–S5 objects included.
2. **The approved release.** The clone is at `<APPROVED_SHA>` with the approved tree, `git fsck` passes, and no tracked
   file is changed (`next-env.d.ts`, which `next build` rewrites, is excepted).
3. **S1–S5 intact:**
   - both users (home, `nologin`);
   - the directory modes;
   - the namespace unit is active, with `lo` only;
   - the test cluster is active, proven to be the staging cluster, and the only listener inside `<NS>`
     (`127.0.0.1:<PG_PORT>`);
   - no host listener on the staging ports;
   - the three roles are unprivileged, and the database belongs to its owner role.
4. **The archive:**
   - root-only regular file;
   - SHA-256 = the PC-verified digest;
   - the VPS Node.js equals the artifact's;
   - the VPS glibc is at least the native binaries' need;
   - the validator passes, run as `<APP_USER>`, with the archive on stdin and the full expected provenance.
5. **Record, then remove, only the incomplete on-VPS build output.** That is `.next`, `node_modules` and the npm cache
   in the build user's home: sizes, counts, owners and a listing hash are written to the private log first. Removal
   happens only if everything there belongs to `<APP_USER>`, and only through the kit's allow-listed, symlink-checked
   remove.
6. **Extract as `<APP_USER>`** in a transient unit that:
   - has no network;
   - sees a read-only system, no home directories and none of the other applications' trees;
   - can write only to a new, empty directory;
   - is capped at 512 MB, 50% of a CPU, lowest priority;
   - runs tar with `--keep-old-files`, ignoring the archive's owners and modes.
7. **On disk:**
   - every file's SHA-256, the file count and every link equal the manifest;
   - everything belongs to `<APP_USER>`, with no setuid bit and nothing group- or world-writable;
   - the clone has no `.next` and no `node_modules`.

   Then both are moved in (a rename on the same file system), and the metadata is kept in the private log.
8. **The installed build, not started:**
   - every file's SHA-256 is checked again in place, with the links, the build id and ownership;
   - no tracked file is changed, and there is no `.env`.
   - Then, in a read-only sandbox without network: `next --version` is 16.4.6; every dependency and Turbopack
     external resolves inside the tree; native libraries load; `npm ls` reports nothing missing or invalid.
9. **§I guard; S6 done.** The application starts for the first time at S9, inside its namespace, with S7's env files.

**Never touched:** the ERP and its release, every other application, cluster `main`, nginx, CloudPanel, DNS, the
firewall, SSH, Neon.

**Rollback** (`rollback.sh S6`, with the owner's agreement):
- stop the install unit if it is running;
- remove only the kit-owned `.next`, `node_modules`, npm cache, extraction directory and kit-tools directory;
- unmark S6.

The clone (S5) and everything before it stay. The verified archive and its metadata stay in the root-only kit
directory for audit until acceptance.

## 7. The verified run (23 Nov 2026)

| Item | Result |
|---|---|
| Run | [`45228504829`](https://github.com/Delowar01/Elite-ERP/actions/runs/45228504829), workflow commit `33f4024`, both jobs green on GitHub-hosted `ubuntu-24.04` (image 20261116.133.1) |
| Source | `cf64ebc492b56ad91c28ba3aa7640722935e21c5`, tree `6403cf5d…`; lockfile SHA-256 `8e7d93fa…133524b` |
| Runtime | Node.js v22.23.2, npm 10.9.8, Next.js 16.4.6 |
| Gates | archive self-test 28/28; tsc, ESLint, platform boundary 218/218; env probe 14/14 runtime values not embedded; build "Compiled successfully" + "Running TypeScript"; output check 99 pages/routes (102 entries), 228 Server Actions, 4 externals |
| Archive | `po07-staging-build-cf64ebc492b5.tar.gz`, 249,378,880 bytes, SHA-256 `df96cb5b12b5d2b5723e14f626a8619ef062c5d3d9fea990d67745ecca9e561c`; 45,362 files, 41 links, 922.9 MB unpacked; build id `zsnzn4exuiKvGWNoIKHtj` |
| Secret scan | PASS over 45,362 files; the runner's build path occurs only in `.next/required-server-files.{js,json}` (not used by `next start`: the relocated run below passed with the build directory moved away) |
| Relocated install | per-file SHA-256 and links re-checked on disk; `next --version` 16.4.6; 34 + 14 dependencies and 4 Turbopack externals resolve inside the tree; 18 native binaries (12 glibc, all load; 6 musl, unused), highest glibc need 2.30; `npm ls` OK |
| H-1 suite | **65/65** against the installed archive |
| Attestation | Sigstore build provenance for the archive; verified on the owner's PC (with the GitHub digest of the zip, its contents, `SHA256SUMS`, the validator and `ARTIFACT.json`) |
| Build resources | 2 CPUs: 44 s, largest process 2,118 MB, all build processes 2,631 MB at peak. 4 CPUs: 36 s, 2,174 MB / 2,998 MB |

## 8. The route cache and decision J1 (23 Nov 2026): the whole build stays read-only

**What writes `.next/server/route-cache/`.** This is the file-system response cache of Next.js 16.4.6.
- In `next/dist/server/lib/incremental-cache/` (`file-system-cache.js`, `index.js`, with `../route-cache-key.js`), a
  cached response is stored under an owner-scoped key: `/route-cache/<kind>/<sha256 of the source route>/$<path>`.
- The build writes its prerendered output once, in place, as an immutable seed. This build has exactly two seeds,
  both with `revalidate: false`: `/favicon.ico` (an app route; its body is byte-identical to `src/app/favicon.ico`)
  and `/_global-error`. All 100 application routes are dynamic, and there is no ISR, no cached `fetch` (the one
  `fetch` uses `cache: "no-store"`) and no `use cache`.
- On the first read of a scoped key with no file yet, `FileSystemCache.get()` reads the seed and `promoteSeed()`
  copies it to the scoped path. That copy is the only write seen in CI.
- The promotion is wrapped in `promotion.catch(…)`: a failure is logged only in cache-debug mode, the seed's data is
  returned anyway, and the entry is kept in the in-memory LRU.
- Any later `set()` failure is caught in `IncrementalCache.set()` and logged as a warning. `revalidatePath` and
  `revalidateTag` only update an in-memory tag manifest.

**Is the write required?** No. It is an optimisation that saves re-reading the seed. Correct responses come from the
seed or from memory.

**Measured** (run [45244291151](https://github.com/Delowar01/Elite-ERP/actions/runs/45244291151), the approved
archive):
- **Setup:** `next start` ran with the whole app tree read-only (systemd `ReadOnlyPaths=`), as a customer process and
  a console process bound with the H-1 variables, against a copy that was writable.
- **Route classes, checked by content, not status alone:**
  - favicon bytes;
  - an immutable static chunk;
  - the dynamic sign-in pages of both processes;
  - the protected-route and unknown-path redirects;
  - a dynamic route handler;
  - the image optimizer (SVG refused, ICO served);
  - an unknown Server Action;
  - the H-1 cross-host refusals;
  - 240 concurrent requests;
  - a restart.
- **Read-only result:** 22/22 cases pass, **0 files written**, and the build is byte-identical afterwards.
- **Writable result:** the same 22 responses (0 differ), with 11 entries written (the route-cache seed promotions and
  the image optimizer's cache).
- **The application's own suites with `.next` and `node_modules` read-only:** all pass.

  | Suite | Result |
  |---|---|
  | H-1 | 65/65 |
  | MFA browser suite | 138/138 |
  | Platform auth | 136/136 |
  | Session revocation | 28/28 |
  | Company invitation acceptance | 98/98 |
  | User invitation acceptance | 41/41 |
  | PDF branding with Chromium, print, private storage | pass |
- **Errors observed under read-only:** only for the image optimizer (`/_next/image`). It isn't used by the application,
  since every `next/image` is `unoptimized`, but it is reachable without a session. A crafted
  `?url=/favicon.ico` request was served (200), and its disk-cache setup then logged `⨯ unhandledRejection: ENOENT …
  mkdir '.next/cache/images'` and `Failed to write image to cache`. The process kept serving correctly. With a writable
  shared `.next/cache`, the same unauthenticated request would have written files that both processes then shared.

**Decision taken (J1): the complete build stays read-only.** Neither process gets any writable path in the code tree:
- the units' former `ReadWritePaths=<APP_DIR>/app/.next/cache` is removed from both units and from `elite-po-run`'s
  profiles;
- the response cache lives in each process's own memory;
- so no cache state is shared between the console and the customer hostname.

The per-process tmpfs fallback (a private, size-capped `TemporaryFileSystem=` per unit) was not needed.

**Also measured:** `next start` exits with status 143 when systemd stops it (128 + SIGTERM). Both units now declare
`SuccessExitStatus=143`, so a clean stop no longer leaves a failed unit.

## 9. Rehearsal of the staging kit under real systemd (`.github/workflows/po07-staging-runtime-test.yml`)

The private staging kit is rendered with fictional values (`ci/po07-runtime/kit/`; no private value). The SAME stage
scripts, units, `elite-po-run`, probes and rollback then run on a GitHub-hosted Ubuntu 24.04 runner (systemd 255,
PostgreSQL 16, Google Chrome). The run installs the approved archive and executes S1 → S9 and the full rollback. Only
the VPS-identity, window and authorization gates and the shared-service guard are replaced by a CI subset (no new
host listener, own sockets only, memory, disk).

The rehearsal found and fixed eight defects before any of them could reach the VPS:
1. S4's role check used `LIKE 'prefix_%'`, where `_` is a wildcard. It now compares an exact prefix.
2. The app user's `git` inherited an untraversable working directory and the caller's environment. It now runs from
   the staging directory with `env -i`.
3. S6-R's tar flags: GNU tar 1.35 refuses `--no-overwrite-dir` together with `--keep-old-files`.
4. S6-R's env-file check was too blunt, because the repository tracks `.env.example`. It now refuses exactly what
   `next start` loads, plus anything untracked.
5. S6-R's `npm ls` check: npm's exit code now decides.
6. S9 now creates the socket directory with the web-server group itself.
7. S9's journal pattern now matches `unhandledRejection`.
8. Rollback now stops the slice and removes the cluster's config directory, which `pg_dropcluster` leaves behind.

**And one design gap: the customer unit's `TasksMax=128` is too low for Chromium.**
- In the customer unit's exact sandbox, PDF rendering through the installed `puppeteer-core` (the application's own
  path) failed with `pthread_create: Resource temporarily unavailable` and `Zygote could not fork`.
- One render peaks at 169 tasks and two concurrent renders at 256–261, while memory stays at 545 MB of the 896 MB
  cap.
- **Proposed, pending the owner's approval:** customer `TasksMax=320`. The admin unit (128) and the slice (512) stay
  unchanged.

**Green rehearsal:** run [45261652332](https://github.com/Delowar01/Elite-ERP/actions/runs/45261652332), job
"kit rehearsal":

| Stage | Result |
|---|---|
| S1–S5 | PASS; the staging cluster runs inside the namespace, on its loopback only |
| S6-R | PASS. Re-run at once: re-checks only. After S9: refuses to touch the installed build under running apps |
| S7 | PASS |
| S8 | PASS: V-NET for the tool path 94/94; the migrations through `elite-po-run` with the owner credential via `LoadCredential`; 67 existing customer tables byte-identical |
| S9 | PASS. Properties: no writable code path, the reviewed binds only. Sockets 0660 in a 0750 directory; other users get EACCES; no host TCP path. V-SBX admin 97/97 and customer 99/99 (two concurrent real PDFs: 265 tasks, 553 MB). R2–R9 all PASS. After the R-tests every build file is unchanged and the journal is clean. Budget: the slice is ≤ 600 MB steady |
| After S9 | 22/22: content through the sockets, a restart of both units, 240 concurrent requests, integrity, journal |
| Footprint | admin 64 MB, customer 101 MB, cluster 49 MB, slice 441 MB current (695 MB peak, during the migrations and probes) |
| Rollback, all stages | removes every staging unit, path, user and listener; the archive stays for audit |

## 10. Revised execution plan: S6-R → S7 → S8 → S9 → S9b (prepared; not executed)

**Preconditions:**
- the owner's approval of D31 (the customer task limit) or another value;
- the owner's new written execution authorization, with its window;
- the owner available for S9b.

**In the window:**
1. **Health and traceability.**
   - Run a fresh S0, and compare it with the last S0 of the previous window (S1–S5 in place).
   - That reference must itself be traceable to the original baseline: every difference must be in the private
     register of documented, owner-accepted differences, by exact value. Any new difference is a HOLD for the owner.
2. **Kit update.** kit-3 replaces kit-1 on the VPS; the state stays. The retired on-VPS build script is moved aside.
   The previous authorization and baseline are kept.
3. **STOP resolution, only on the owner's explicit words.**
   - The original S6 failure record is kept unchanged, read-only.
   - The resolution (the owner's reason, verbatim, and the authorization it relies on) is appended.
   - An S6 STOP can be cleared only if the old build is not installed and S6-R is.
4. **Transfer.** The verified archive goes into the root-only incoming directory, with its SHA-256 re-checked on the
   VPS.
5. **S6-R**, as in §6. On the rehearsal it was re-entrant, and it refuses once the applications are running.
6. **S7:** the env files.
7. **S8:** V-NET for the tool path, then the migrations through `elite-po-run`.
8. **S9:**
   - the units and sockets;
   - V-NET/V-SBX in both profiles, including a real PDF;
   - R2–R9;
   - J1: no writable code path, build integrity after the R-tests, and a clean journal;
   - the footprint.
9. **S9b:** the owner's own bootstrap, then the post-check.

**Unchanged:** S10–S13 keep their separate authorization gates. Production security fixes and any ERP or Neon work
stay outside this staging task.

## 11. Open points

- **D31:** the customer task limit needs the owner's decision before S9.
- **The image optimizer endpoint** is not needed by the application. Recommendation for S11a (a separate
  authorization, nginx): deny `/_next/image` on both staging hosts. Until then the read-only build keeps it from
  writing anything.
- **Not provable off the VPS:** the VPS's own kernel and its coexistence with the live services, nginx with Basic
  Auth in front of the sockets (S11a), and the owner's interactive bootstrap (S9b).
- The `www1` aliases of two other sites didn't answer on 23 Nov 2026. The owner accepted this as non-blocking; it is
  recorded in the private register of documented S0 differences.
- PO07-A11Y-01 is accepted temporarily, not resolved.
