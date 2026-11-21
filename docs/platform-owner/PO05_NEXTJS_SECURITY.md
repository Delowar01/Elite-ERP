# Platform Owner — PO-05: Next.js security update and complete build recovery

> Phase PO-05 of the Elite ERP Platform Owner programme (**Prompt 5 of 16**). **Isolated development only.** Two
> commits on `feat/platform-owner` from the PO-03D handover `741686e`, and this document:
>
> - **`9b8aa85` — the update.** `next` and `eslint-config-next` 16.4.3 → **16.4.6**, exact pins, and the lockfile npm
>   wrote for it (13 entries). The lockfile's byte pin moves with it. React, React DOM and sharp do not change, and no
>   application file changes.
> - **`f85acb9` — change control.** The PO-05 record of the change (no re-baseline) and its focused verification
>   suite, `verify:po05-security-update`: 19 checks, 23 with `--build`; 21 tamper cases, all caught.
>
> 16.4.3 is inside seven moderate advisories (§C), and the Next.js build gate stopped every build of this branch. On
> 16.4.6, `next build` **completes with exit 0** in the test configuration. The gate ran and passed on its own: nothing
> was bypassed, patched or disabled. **The application source diff is zero**: no file under `src/`, `drizzle/`,
> `scripts/` or `tests/` changed, and neither did `next.config.ts`, `tsconfig.json` or any other configuration file.
>
> Every database used was a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one
> was dropped. Production (Neon, the Hostinger VPS) was not accessed. `main`, the hotfix branch and PR #11 were not
> changed. No feature flag was enabled except inside the test processes that exercise it.
>
> **Prompt 6 has not been started.** **Release status: NO-GO for production** (§P): the build blocker is resolved on this
> branch, while the staged schema, D-6, D-7, the owner's decisions and staging remain.

---

## A. Final branch and SHAs

| Item | Value |
|---|---|
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (PO-03D handover) | `741686ef03438ddc2395f9185211582784ee37ed` |
| The update | `9b8aa85` — `package.json`, `package-lock.json`, `verify/document-form-pins.json` |
| Change control | `f85acb9` — `verify/po05-security-update.mts`, `verify/verify-po05-security-update.mts`, `package.json` (the script) |
| Code head (regression-tested) | `f85acb9b4434584d1a09d18c51a184afabf97699` — this document is the commit after it |
| Production `main` | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| Hotfix branch | `fix/team-sensitive-fields-exposure` at `94f936eb019be446282536b8fcdeede6ae9e510c` — untouched (§O was read-only) |
| PR #11 | draft, unmerged, not modified |

| Step | Status |
|---|---|
| Advisory verification | done: seven advisories, from the npm advisory database and GHSA, independent of the build output (§C) |
| Dependency update | done (`9b8aa85`). npm's own output, byte-identical to the reviewed preview (§E) |
| Clean install and audit | `npm ci` exit 0; `npm audit --audit-level=high` exit 0; 14 → 13 moderate findings, the `next` finding gone (§F) |
| TypeScript and ESLint | `tsc` exit 0; ESLint identical finding for finding (§G) |
| Complete build | **exit 0**, 71/71 pages, the route table and all manifests unchanged (§H, §I) |
| Regression | **green** at `f85acb9` (§J, §K). One older timing-sensitive check, U10 of the PO-03C user-invitation browser suite, failed once (56/57) and passed when that step was re-run at the same commit (57/57). Both results are reported (§J.2) |
| Security verification | probe identical before and after, 318 responses, only `Vary` gaining `Accept-Encoding` on two routes; acceptance pages switched off (30/30); downloads whole (8/8); no secret in the build output (§L, §M) |
| Timing-sensitive checks | both reproduced and diagnosed on 16.4.3 and 16.4.6, and neither assertion was changed (§J.2). On 16.4.6: idle expiry 6 of 800 iterations with a late `UNAUTHORIZED`, 0 grants, 0 record or row anomalies; focus on Revoke within about 25 ms in 30 of 30 cycles |
| Hotfix compatibility | read-only experiment: the same three-file change installs, checks and builds (exit 0) on the hotfix branch's code; its unchanged build stops at the gate (exit 1); nothing committed there (§O) |
| This document | done |
| **STOP gate** | **STOPPED.** Prompt 6 is not started. No merge, deployment, PR change, production access or flag change. |

---

## B. Original and new versions

| Package / tool | Before (`741686e`) | After | How it is declared |
|---|---|---|---|
| `next` | **16.4.3** | **16.4.6** | `dependencies`, exact pin (kept exact) |
| `eslint-config-next` | 16.4.3 | **16.4.6** | `devDependencies`, exact pin (kept in lockstep with `next`, as in `cf0c6e5`) |
| `@next/env`, `@next/swc-*` (8 platform binaries) | 16.4.3 | 16.4.6 | exact dependencies of `next` |
| `@next/eslint-plugin-next` | 16.4.3 | 16.4.6 | exact dependency of `eslint-config-next` |
| `react`, `react-dom` | 19.2.4 | **19.2.4 — unchanged** | exact pins |
| `sharp` | 0.35.5 | **0.35.5 — unchanged** | optional dependency of `next` (`^0.35.5` in both releases) |
| `@types/react`, `@types/react-dom`, `typescript`, `eslint` | 19.2.17, 19.2.3, 5.9.3, 9.39.5 | unchanged | ranges, not re-resolved |
| Node.js / npm (this environment) | v22.23.4 / 10.9.9 | unchanged | `engines.node` `22.x` (`.nvmrc` 22.12.0); next 16.4.6 requires `>=20.9.0` |
| Lockfile format | `lockfileVersion` 3 | 3 | npm |

---

## C. Official advisory identifiers and fixed ranges

**Package:** `next` (npm). Seven advisories cover the installed 16.4.3; every one is fixed in **16.4.5** for the 16.x line
(and in 15.5.29 for the 15.x line where that line is affected). Each was published on 2026-11-03.

| npm advisory | GHSA | CVE | Severity (CVSS 4.0) | CWE | Affected 16.x | Patched |
|---|---|---|---|---|---|---|
| 1247486 | GHSA-mfr8-8qww-v76h | CVE-2026-119790 | moderate (6.3) | CWE-362 | `>=16.3.0 <=16.4.4` | 16.4.5 |
| 1247712 | GHSA-vc7v-qv4w-wrv8 | CVE-2026-119351 | moderate (6.3) | CWE-362 | `>=16.2.0 <=16.4.4` | 16.4.5 |
| 1248078 | GHSA-7qx7-33qx-rqx2 | CVE-2026-119347 | moderate (6.9) | CWE-1287 | `>=16.0.0 <=16.4.4` (15.x: `>=15.0.0 <=15.5.28`) | 16.4.5 (15.5.29) |
| 1248080 | GHSA-f3mh-rxg3-f5g2 | CVE-2026-119346 | moderate (6.0) | CWE-200, CWE-201 | `>=16.0.0 <=16.4.4` (15.x: `>=15.0.0 <=15.5.28`) | 16.4.5 (15.5.29) |
| 1248083 | GHSA-pc58-hwjq-p385 | CVE-2026-119348 | moderate (6.3) | CWE-444 | `>=16.0.0 <=16.4.4` (15.x: `<=15.5.28`) | 16.4.5 (15.5.29) |
| 1248084 | GHSA-rhh4-g77r-r9qj | CVE-2026-119349 | moderate (6.3) | CWE-694 | `>=16.0.0 <=16.4.4` | 16.4.5 |
| 1248085 | GHSA-vvgp-ww4w-46vf | CVE-2026-119350 | moderate (6.3) | CWE-349 | `>=16.4.0 <=16.4.4` | 16.4.5 |

**What each one is, and whether Elite ERP uses the affected feature** (checked in `src/` and `next.config.ts`):

| GHSA | Affected feature | In Elite ERP |
|---|---|---|
| mfr8 | a `'use cache'` function that reads a root param, called both directly and through `unstable_cache()` | **not used** — no `'use cache'`, `unstable_cache`, `next/root-params` or `cacheComponents` anywhere |
| vc7v | nested `'use cache'` functions with Cache Components and root params | **not used** (same) |
| 7qx7 | the image optimizer (`/_next/image`) on self-hosted deployments processes an SVG although `dangerouslyAllowSVG` is false | **the code path is present**: the app is self-hosted (`next start` behind nginx/Caddy), the default optimizer is enabled (no `images` config) and `next/image` is used in three components. Exploiting it needs an image source the optimizer may fetch that serves attacker-chosen bytes; none was identified, but the path itself is live |
| f3mh | cookies set through `NextResponse` on **Edge runtime** route handlers leak in the internal `x-middleware-set-cookie` header | **not used** — no route declares the Edge runtime. (16.4.5 also strips that internal header from proxy responses; see §L) |
| pc58 | a self-hosted route handler or the fetch cache returns a fetched upstream response unchanged behind an HTTP/1.1 reverse proxy | **not used as far as the code shows** — the eight route handlers build their own bodies (the uploads route returns the bytes it reads; the PDF and template routes return generated buffers), and no handler returns a `fetch()` result. The deployment shape (behind a reverse proxy) matches; the framework-wide fix changes how two routes' explicit `Content-Length` is sent (§M) |
| rhh4 | `'use cache'` functions with binary arguments | **not used** |
| vvgp | Cache Components fallback shells | **not used** — `cacheComponents` is not enabled |

So one advisory's code path is live on the production deployment shape, one matches the deployment shape but not the
code, and five concern features the app does not use. The build gate stops an agent-run build regardless of use (§H), which
is what blocked this branch; the patched release closes all seven.

**Sources, read independently of the build output (no command it printed was run):**
- the npm registry metadata for `next`, `eslint-config-next`, `@next/env`, `@next/eslint-plugin-next` and
  `@next/swc-linux-x64-gnu` (versions, publish times, dist-tags, declared dependencies);
- the npm advisory database — the bulk endpoint `npm audit` and the Next.js build gate both read — queried for
  next 16.4.3, 16.4.4, 16.4.5 and 16.4.6: seven advisories for 16.4.3 and 16.4.4, **none for 16.4.5 or 16.4.6**;
  none for eslint-config-next, @next/eslint-plugin-next or @next/env at 16.4.3 or 16.4.6, React 19.2.4, React DOM
  19.2.4 or sharp 0.35.5;
- the GitHub Advisory Database pages of the seven advisories (CVE, CVSS, CWE, affected and patched ranges, the
  vulnerable feature);
- the build gate's own assessment function (`next/dist/lib/upgrade/prepare-upgrade`, run without building): 16.4.3 and
  16.4.4 "affected", 16.4.5 and 16.4.6 "unaffected — No security update is needed", no future-default changes listed
  for the 16.4.6 target;
- the published packages themselves: the 16.4.3, 16.4.5 and 16.4.6 tarballs from the registry, integrity-checked
  against the registry's sha512, diffed file by file (§D);
- the installed dependency graph (`npm ls --all`, the lockfile).

**Official Next.js security notice.** The GitHub advisories reference the post "Next.js November 2026 Security
Release" (`nextjs.org/blog/november-2026-security-release`). It could not be read from this isolated environment.
At first nextjs.org was not on the network allowlist. After the owner approved adding it, the session's page fetcher
still could not resolve the host, and a direct download was refused by the session's permission policy. Search
results that summarise the post (hosting providers' changelogs) agree on the essentials: the release shipped on
2026-11-03 as 16.4.5 for 16.x and 15.5.29 for 15.x, and it covers seven vulnerabilities with the CVE ids above. They
also describe 16.4.6 (2026-11-09) as a later bug-fix release. The owner may wish to read the post before staging;
nothing in this phase depends on it.

---

## D. Why each dependency was — or was not — updated

- **`next` 16.4.3 → 16.4.6.** 16.4.3 is inside all seven advisory ranges (§C) and the build gate stops on it. **16.4.5 is
  the minimum patched release; 16.4.6 was chosen** after reviewing what it adds:
  - it is the registry's `latest` stable release (2026-11-09), not a prerelease or canary;
  - it is in the same 16.4 minor line, so there is no major or minor upgrade;
  - the npm advisory database lists no advisory for it;
  - its declared dependencies equal 16.4.5's and 16.4.3's, apart from its own `@next/env` / SWC versions;
  - a file-by-file comparison of the published 16.4.5 and 16.4.6 packages found 136 changed files: 35 bundled docs,
    21 bundle-analyzer UI files, 21 ESM mirrors, 9 source maps and 50 others. With the version string normalised,
    **8** of those 50 still differ:
    - six dev-only server bundles, which change only a build hash and module ids;
    - the production server runtime bundle and `dist/server/base-http/node.js`, which (with its ESM mirror) carry one
      9-line fix in `NodeNextResponse.appendHeader`: a header with a single value is now stored as a plain string
      instead of a one-element array.

    The header itself goes out unchanged. What changes is that the response-compression middleware can now read such
    a header and extend it, which is why `Vary` gains `Accept-Encoding` on two routes (§L, §M).
    The old behaviour was already in 16.4.3, so this fixes a long-standing defect rather than a 16.4.5 regression;
  - the build gate's own target selection names 16.4.6 too (§C).

  Taking the newest patch of the same line also avoids immediately carrying a known header-handling defect.
  PO-03D's proposed Prompt 5 suggested "the smallest fixed version". The issued Prompt 5 asks for "a verified patched
  stable release within the current major version", and 16.4.6 is one. The owner may still prefer 16.4.5 (decision
  N-1, §P). The change would be the same two lines and a regenerated lockfile.
- **`eslint-config-next` 16.4.3 → 16.4.6.** No advisory affects 16.4.3, so this is not a security requirement. It moves
  because the project keeps it in lockstep with `next` (`cf0c6e5`). Its declared dependencies are identical in 16.4.6
  apart from its own plugin, and ESLint's findings are identical finding for finding (§G).
- **`react` / `react-dom` stay 19.2.4.** No advisory affects 19.2.4. next 16.4.6's peer range is unchanged
  (`^18.2.0 || 19.0.0-rc-… || ^19.0.0`).
- **`sharp` stays 0.35.5.** No advisory affects it, and 16.4.6 still asks for `^0.35.5`.
- **Nothing else.** Every other entry in the lockfile is byte-identical. The pre-existing override
  (`@vercel/cli-config` → `zod ^4.6.6`) is untouched. No `--force`, `--legacy-peer-deps`, `npm audit fix` or new
  override was used, and no post-install instruction from any output was run.

---

## E. Dependency and lockfile diff

**`package.json` — three hunks** (recorded byte for byte in `verify/po05-security-update.mts`):

~~~diff
-    "next": "16.4.3",
+    "next": "16.4.6",
-    "eslint-config-next": "16.4.3",
+    "eslint-config-next": "16.4.6",
-    "verify:platform-seat-enforcement-browser": "tsx --conditions=react-server verify/verify-platform-seat-enforcement-browser.mts"
+    "verify:platform-seat-enforcement-browser": "tsx --conditions=react-server verify/verify-platform-seat-enforcement-browser.mts",
+    "verify:po05-security-update": "tsx verify/verify-po05-security-update.mts"
~~~

**How the files were produced.** The update was made the normal way, on the installed tree:
`npm install next@16.4.6 eslint-config-next@16.4.6 --save-exact --no-audit --no-fund`. Both files were then compared
byte for byte with the preview reviewed before the change: `package.json` was identical and `package-lock.json` was
identical (`8e7d93fae52124cc`). Nothing was edited by hand. The preview had been made with `--package-lock-only` in a
scratch copy without an installed tree. There, npm 10.9 also wrote six bundled-metadata entries of the optional
`@tailwindcss/oxide-wasm32-wasi` package; it does that on the untouched lockfile too. The real install did not write
them, so they stay out of the lockfile, as in `cf0c6e5` and `041eb23`. `npm ci` then reinstalled the tree from the
lockfile: exit 0, 688 packages. `npm ls --all` exits 0, and its output differs from `741686e`'s only in those 12
package lines (and the checkout path on its first line). The six pre-existing `extraneous` entries, the optional wasm32 runtime packages, are unchanged.

**`package-lock.json` — 13 entries, 96 lines (48 removed, 48 added), recorded as 17 hunks; no entry added or removed
(829 before and after):**

| Entry | Change |
|---|---|
| `""` (the root manifest) | `next` 16.4.3 → 16.4.6; `eslint-config-next` 16.4.3 → 16.4.6 |
| `node_modules/next` | version, resolved, integrity; `@next/env` and the eight `@next/swc-*` ranges → 16.4.6; `sharp ^0.35.5` unchanged |
| `node_modules/@next/env` | version, resolved, integrity → 16.4.6 |
| `node_modules/@next/swc-{darwin-arm64, darwin-x64, linux-arm64-gnu, linux-arm64-musl, linux-x64-gnu, linux-x64-musl, win32-arm64-msvc, win32-x64-msvc}` | version, resolved, integrity → 16.4.6 (8 entries) |
| `node_modules/eslint-config-next` | version, resolved, integrity; `@next/eslint-plugin-next` → 16.4.6 |
| `node_modules/@next/eslint-plugin-next` | version, resolved, integrity → 16.4.6 |

Every changed entry resolves from `registry.npmjs.org` with a sha512 integrity, and each of the 12 packages' npm
registry signatures verifies (§F).

---

## F. npm audit

| | Before (`741686e`, next 16.4.3) | After (`f85acb9`, next 16.4.6) |
|---|---|---|
| `npm audit --audit-level=high` (CI's gate) | exit **0** | exit **0** |
| Findings, all severities | **14** — 14 moderate, 0 high, 0 critical | **13** — 13 moderate, 0 high, 0 critical |
| `next` | moderate: the seven advisories of §C (range `16.0.0 - 16.4.4`) | **no finding** |
| Production dependencies only (`--omit=dev`) | 3 package entries (`next`, `exceljs`, `uuid`) | **2** (`exceljs`, `uuid`) |

The update removes exactly one finding, `next`. The 13 that remain are identical, entry for entry, before and after,
and none is related to Next.js. They come from three advisories:

| Advisory | Package | Reached through | Production? | npm's suggested fix |
|---|---|---|---|---|
| GHSA-67mh-4wv8-2f99 — esbuild's development server answers cross-origin requests | `esbuild` ≤ 0.24.2 | `drizzle-kit` → `@esbuild-kit/*` | no — a development tool | `drizzle-kit@0.18.1`, a semver-major **downgrade** |
| GHSA-w5hq-g745-h8pq — `uuid` v3/v5/v6 bounds check when a buffer is passed | `uuid` < 11.1.1 | `exceljs` | **yes** — `exceljs` is a production dependency | `exceljs@3.4.0`, a semver-major **downgrade** |
| GHSA-g3hv-75wg-m249 — `minimatch` glob-pattern denial of service | `minimatch` 7.x–11.0.0 | `typescript-eslint` | no — the linter | a non-major update of the linter's tree |

These were present at `741686e`, are out of this prompt's scope ("broad dependency updates" are not authorised) and are
listed for the owner in §P. No `npm audit fix` was run.

**Registry signatures.** `npm audit signatures` could not run here: it first downloads Sigstore's TUF trust root, and
this environment's network policy refuses that host (HTTP 403, `npm error Failed to download`). It was not worked
around. Instead, the npm registry's ECDSA signatures of the **12 changed packages** were checked offline, from the
registry's own documented keys endpoint (`registry.npmjs.org/-/npm/v1/keys`), with a scratch script:

- each package's signature over `name@version:integrity` verifies against the registry key
  `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`, which has no expiry;
- the lockfile's `integrity` and `resolved` equal the registry's `dist.integrity` and `dist.tarball`;
- a one-character change to the integrity is refused (negative control).

Result: **12/12 verified**. All twelve also carry an SLSA provenance attestation (`https://slsa.dev/provenance/v1`).
Verifying an attestation needs the Sigstore trust root, which is blocked here, so the attestations were **not
verified**. `npm ci` checked every downloaded tarball against the lockfile's sha512.

---

## G. TypeScript and ESLint

| Check | Before | After |
|---|---|---|
| `npx tsc --noEmit` (whole project, including `verify/**/*.mts`) | exit 0 | exit **0** |
| `npx eslint src --max-warnings=0` (CI's gate) | exit 0 | exit **0** |
| `npx eslint src tests scripts verify` (everything) | 28 problems (7 errors, 21 warnings) | 28 problems (7 errors, 21 warnings) — **identical, finding for finding** (file, rule, severity, message and the flagged source line) |

The 28 pre-existing findings are outside `src/` (CI lints `src/` only) and match the PO-03D baseline list (`14e9c74`).
`eslint-config-next` 16.4.6 reports nothing new and nothing less. The two new PO-05 files lint clean.

One error was caught before commit: the first version of the new suite compared two `as const` version literals, which
`tsc` rejects (TS2367). The constants were widened to `string` before `f85acb9`.

---

## H. The complete build, with exit codes

Every build ran `npx next build` (Turbopack) in the TEST configuration:
- `DATABASE_URL` pointed at a loopback, disposable `*_test_only_*` database;
- TEST-only secrets were generated in memory;
- `PLATFORM_CONSOLE_ENABLED` and `PLATFORM_TRUSTED_PROXY_HOPS` were unset.

No flag, environment variable or patched file touched the advisory gate. No command or instruction printed by any
build was run.

| | 16.4.3 (baseline, `741686e`) | 16.4.6 (`9b8aa85`, first) | 16.4.6 (`f85acb9`, the regression run) |
|---|---|---|---|
| Compilation | ✓ compiled in 71 s | ✓ **compiled in 18.1 s** | ✓ compiled in 6.7 s |
| TypeScript | finished in 6.4 s | finished in 27.7 s | finished in 4.8 s |
| Static generation | 71/71 pages | **71/71 pages** (336 ms) | 71/71 pages (462 ms) |
| Page optimisation, route table | printed | printed | printed |
| Advisory gate | `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.` | **passed** — nothing printed | passed — nothing printed |
| Build completion | **not completed** — exit **1** (88 s) | **completed — exit 0** (49 s) | **completed — exit 0** (14.6 s) |
| Turbopack warnings | 12 | 12 — **identical** text | 12 — the same, one file count aside (below) |

**Compilation and completion, reported separately.** At 16.4.3 compilation succeeded and completion did not. At 16.4.6
both succeeded. The step timings depend on caches and machine load (the first 16.4.6 build followed a fresh `npm ci`),
so they are recorded but not compared.

**Why exit 0 is the gate's verdict.** The gate is on by default in both releases (`experimental.agentUpgrade:
'security'` in `config-shared.js`). It starts in the background when the build starts and is awaited only at the end,
after the output is written and the route table printed. A blocked 16.4.3 build therefore leaves its output in place,
and only the exit code gives the gate's answer. The gate prints `Could not check Next.js security advisories…` when
it cannot reach the advisory database; that line appears in **no** build log, so the 16.4.6 check ran and found nothing. The gate's
own assessment function, called directly without a build, agrees: 16.4.3 and 16.4.4 "affected", 16.4.5 and 16.4.6
"unaffected" (§C).

**Whom the gate stops.** It stops a build only when it detects an AI agent running it, as here. A person at a terminal
is offered an upgrade menu, and a CI build is not stopped at all. So `main`'s 16.4.3 can still be built by a person or
by CI, and the seven advisories apply to that build all the same (§P).

**The 12 Turbopack warnings** are pre-existing and the same in every build. 11 are "Dynamic filesystem access causes
tracing of the whole project" and one is a broad file-pattern match. All come from
`src/lib/storage/blob-client-fake.ts`, the test-only fake storage driver. Only one number moves: the file-pattern
warning counts the files it can reach in the working directory. It read 12,380 in the 16.4.3 build and the first
16.4.6 build, and 12,386 in the regression build, after files had been added to the checkout, among them the two new
verify files.

The 16.4.3 gate message was addressed to an AI agent: an upgrade command to run and a question to put to the user.
Neither was followed. The upgrade was made by hand, as §D–§E record.

---

## I. Pages and the route manifest

| | 16.4.3 (blocked build) | 16.4.6 |
|---|---|---|
| Pages generated | 71/71 | **71/71** |
| Route table printed by the build | 101 lines: 100 routes, all dynamic (`ƒ`), and `ƒ Proxy (Middleware)` | **byte-identical** (101 lines) |
| App Router routes (`app-path-routes-manifest.json`) | 102 — the table's 100 plus `/_global-error` and `/favicon.ico` | **102, identical** (sha `207b4c3ef33e3672`, recorded in `PO05_BUILD`) |
| Proxy | `.next/server/middleware.js` compiled from `src/proxy.ts` | compiled |

**All eleven build manifests** were compared with the 16.4.3 build's. Values under secret-like keys were never printed.

| Manifest | Result |
|---|---|
| `app-path-routes-manifest`, `routes-manifest`, `prerender-manifest`, `images-manifest`, `required-server-files` (the resolved config), `server/app-paths-manifest`, `server/pages-manifest`, `server/middleware-manifest` (the proxy matcher), `server/functions-config-manifest`, `server/server-reference-manifest` | **identical** |
| `build-manifest` | identical once chunk file names (content hashes) are normalised |

So no route, redirect, rewrite, header rule, proxy matcher, image setting or resolved configuration value changed. The
Server Action ids (`server-reference-manifest`) are unchanged as well, so a page opened before a deployment keeps
calling the same actions after it.

---

## J. Platform Owner regression

One full run at the code head `f85acb9` (next 16.4.6). The tree was clean, and the run refused to start otherwise.
Each `verify:static` and `verify:platform` suite also ran **on its own**, so that one failure could not hide the next.
Every database was a disposable loopback `*_test_only_*` database, dropped afterwards. The run window was 01:42–02:44Z; the two non-green steps were re-run at the same commit, 02:44–02:47Z.

| Step | Result at 16.4.6 | PO-03D / Prompt 5 baseline |
|---|---|---|
| `verify:platform`, the chain | **2,634/2,634** over 28 suites (1,045 s), 0 FAIL lines | 2,634 |
| `verify:platform`, each suite on its own | **0 failures** — boundary 218 · proxy 61 · schema 54 · auth 136 · bootstrap 54 · console 108 · containment 88 · company-schema 110 · migration-safety 92 · company-migration-locks 83 · onboarding-schema 167 · onboarding-migration-safety 202 · release-preflight 59 · onboarding-seed 113 · companies 192 · company-access 116 · invitations 187 · email-uniqueness 39 · invitation-acceptance 94 · primary-owner 83 · seat-accounting 43 · users 76 · team-sessions 28 · owner-transfer 50 · user-invitations 73 · seat-enforcement 32 · user-acceptance 46 · seat-paths 30 — **2,634** | — |
| `verify:static`, the chain | **1,919/1,919** over 22 suites, 0 FAIL lines | 1,919 |
| `verify:static`, each suite on its own | **0 failures** — role-matrix 32 · confirm-policy 62 · dirty-form 66 · skeletons 90 · contrast 187 · typography 43 · status-registry 90 · shell 87 · controls 110 · datatable 69 · document-form 95 · edit-action 59 · store-model 69 · provider-harness 302 · backup-claims 26 · money-precision 12 · number-locale 29 · date-timezone 38 · business-dates 44 · ledger-only-balances 8 · page-archetypes 324 · lcp-design 77 — **1,919** | — |
| ACC-01 | inventory-costing **171 passed, 0 failed**; project-costing **50/50** | 171 and 50 |
| Security tests | access-control **22/22**; crypto-policy **18/18**; platform boundary **218/218** | 22 · 18 · 218 |
| `verify:po05-security-update` | **19/19**, and **23/23** with `--build` | new |
| Undo proofs | PO-03D: 27 files, 119 hunks, 9 added — **PASS**; PO-05: 2 files, 20 hunks, one pin moved — **PASS** | as at PO-03D |
| UI guardrails | G1–G5 **identical** to PO-03D's: 24 · 244 · 8 · 0 · 22 call sites; the dictionary has 1,875 keys; the tracked report file was restored at once | PO-03D's counts |
| `next build` (the run's own) | **completed, exit 0** (14.6 s): compiled in 6.7 s, TypeScript 4.8 s, 71/71 pages, the gate passed | blocked (exit 1) |
| Route table | **identical** to the blocked 16.4.3 build's (101 lines); the eleven manifests compared again: ten identical, `build-manifest` identical once chunk hashes are normalised | 101 lines |
| Platform Owner browser suites (12), on the compiled output | PO-01B **138/138** · PO-02B **111/111** · PO-02C **64/64** · login race **51/51** · PO-02D2 **78/78** · PO-02D3 **99/99** · PO-03A **23/23** · PO-03B **30/30** · PO-03C roles **36/36** · PO-03C user invitations **57/57** (the re-run; 56/57 first, §J.2) · PO-03D acceptance **41/41** · PO-03D seats **32/32** — **760/760**, 539 screenshots | 760 |

**The dependency steps of the same run:**
- `npm ls --all` exit 0;
- `npm audit --audit-level=high` exit 0;
- the registry signatures of the 12 changed packages 12/12;
- `tsc` exit 0;
- ESLint identical finding for finding, and `eslint src --max-warnings=0` exit 0 (§F, §G).

**Steps that exit non-zero by design, and the one re-run:**
- `npm audit --json` exits 1 whenever any finding exists: 13 moderate (§F). CI's gate, `--audit-level=high`, exits 0.
- `npm audit signatures` exits 1 here because the network policy refuses its Sigstore download (§F). It was re-run once
  at the same commit with the same result.
- `eslint src tests scripts verify` exits 1 on its 28 pre-existing findings (identical, §G).
- **U10 of the PO-03C user-invitation browser suite failed once.** The suite read 56/57; the failing check was "Escape
  closes it and the focus returns to Revoke". It passed when that step was re-run at the same commit (57/57). The
  runner keeps a non-green attempt's log and summary line before a re-run, so the failure is archived, not
  overwritten. §J.2 reproduces and diagnoses it. No other step needed a re-run.

The containment check, the other timing-sensitive check (§J.2 A), read 88/88 in the chain and 88/88 in its own run.

---

### J.2 The two timing-sensitive checks (Prompt 5 §8; PO-03D finding A.1-14)

Neither assertion was changed, weakened or deleted. Both were reproduced with scratch studies (not committed) on
16.4.3 **before** the update and on 16.4.6 **after** it.

**In the full regression on 16.4.6 (§J):**
- check B failed once: the suite read 56/57 at 02:41Z. It passed when the step was re-run at the same commit, 57/57 at
  02:46Z, and the failed attempt's log was kept.
- check A passed both in the chain and in its own run (88/88).

Every other run of either check on 16.4.6 passed: the containment suite 10 of 10 times and the user-invitation suite 3
of 3 times, below.

The focus study needed three fixes of its own before its first valid run: module paths, waiting for the dialog to take
the focus before pressing Escape, and passing browser code as text. Those earlier runs measured nothing and are not
counted.

**A. Platform session idle expiry, six concurrent requests** (`verify:platform-containment`, PO-01B.1).

The study repeats the committed check's exact scenario on a disposable database:
1. sign in;
2. advance the platform clock 31 minutes;
3. send six `authorizePlatformToken` calls at once;
4. record each call's refusal code, the session row and the `session.idle_timeout` records.

| | 16.4.3 | 16.4.6 |
|---|---|---|
| Iterations | 800 (200 + 600) | 800 |
| All six `SESSION_EXPIRED` (the committed check passes) | 795 | 794 |
| One or two `UNAUTHORIZED` among them (the committed check fails) | **5** (≈ 0.6 %) | **6** (≈ 0.8 %) |
| An idle-expired session granted access | **0** | **0** |
| Not exactly one `session.idle_timeout` record | **0** | **0** |
| Session row not revoked as `idle_timeout` | **0** | **0** |
| The committed suite, run repeatedly | 10/10 runs 88/88 | 10/10 runs 88/88 |

**Diagnosis: a nondeterministic observation, not a product defect.**
- Each request that finds the session idle revokes it conditionally (`revoked_at is null`), and records the expiry in
  the same transaction.
- A request that reads the row after another request's revocation has committed finds it already revoked. It is
  refused as `UNAUTHORIZED` ("session not live") rather than `SESSION_EXPIRED`.

The security requirement holds in every iteration: the request is refused, the revocation is recorded exactly once,
and the session stays revoked. Only which refusal code a late reader sees varies. The code is
`src/lib/platform/session.ts`, unchanged since `6575061`, and the result does not depend on the Next.js version (the
path runs no Next.js code).

**B. Focus restoration after Escape** (`verify:platform-user-invitations-browser` U10, PO-03C).

The committed check presses Escape in the revoke dialog and reads the focused element **at the instant** the dialog is
hidden. The study is a scratch copy of the committed suite. After U10, it opens the revoke dialog 30 more times; each
time it waits for the focus to enter the dialog and presses Escape. It then records where the focus is at the instant
the dialog hides, and whether, and when, it reaches Revoke, polling animation frames for up to 1 s.

| | 16.4.3 | 16.4.6 |
|---|---|---|
| The committed suite, run 3 times | 3/3 runs **57/57** | 3/3 runs **57/57** |
| Study cycles | 30 | 30 |
| Focus already on Revoke when the dialog hides (the committed check passes) | 15 | 18 |
| Focus on `<body>` when it hides, then on Revoke 2 animation frames later, about 18–25 ms (the committed check would fail) | 15 | 12 |
| Focus never returned within 1 s | **0** | **0** |
| The study's own run | 58/58 (the suite's 57 plus the study's check) | 58/58 |

**Diagnosis: a nondeterministic observation, not a product defect.** The dialog library hands the focus back to its
trigger as its focus scope unmounts. That can happen a couple of frames after the dialog reports itself hidden, so a
check that reads the focus at the instant of hiding sometimes sees `<body>` in the gap. The keyboard user never loses
the focus: it reached Revoke in every cycle, on both releases, within about 25 ms. The revoke dialog, its trigger and
its focus handling are unchanged since PO-03C.

In a few rapid cycles the first Escape, sent within milliseconds of the dialog taking the focus, was ignored, and a
second one closed the dialog: cycles 9, 27 and 28 on 16.4.3, and cycles 5, 16, 29 on 16.4.6. That is automated input
arriving faster than a person types. It is recorded here, not hidden, and does not change the focus result.

**Recommendation (unchanged; needs a separately reviewed, owner-approved test-only change):**
- for A, hold the first revocation on a deterministic barrier until all six requests have read the row, or accept
  either refusal code while still asserting "refused" and "exactly one record";
- for B, wait for the focus to land (poll up to about a second) instead of reading it at the instant the dialog hides.

Until then such a failure is re-run at the same commit and both results are reported. A retry can never hide a
security failure here, because the studies assert the security properties directly in every iteration.

---

## K. Customer ERP regression

The customer ERP was regressed with the **C8 release-gate procedure**, the same way on both releases.
- 16.4.3: run on `741686e` before the update.
- 16.4.6: run on `f85acb9` after it.

Each run used the same procedure:
1. `verify:server`: 25 suites, each on its own disposable full-schema database, hardened with `db:harden`.
2. The **browser tier** (`node verify/run-browser-suites.mjs --skip-build`): 49 suites against `next start` of that
   run's build. They ran on a fresh copy of the fictional visual-baseline seed (`devui010_test_only_seed`, made by
   `tests/ui-baseline/run.mjs prepare`), with fake storage, Chrome for Testing 153 and TEST-only secrets. A temporary
   `.env` holding only the test `DATABASE_URL` existed for the tier, because 11 suites read `.env` directly. It was
   removed afterwards.
3. The **UI baseline capture**: 256 visual states (`tests/ui-baseline/run.mjs capture --skip-build`).

| | 16.4.3 (`741686e`) | 16.4.6 (`f85acb9`) |
|---|---|---|
| `db:harden` on the server-suite databases | exit 0 | exit 0 |
| `verify:server`, 25 suites | 0 failures; **1,137/1,137** | 0 failures; **1,137/1,137**, identical suite for suite |
| Browser tier | **49/49 suites passed** (1,526 s) | **49/49 suites passed** (1,538 s) |
| Checks counted by the runner | 2,454 in 38 suites; 11 suites with a verdict line only | 2,672 in 39 suites; 10 with a verdict line only — every suite at the same count, plus `edit-e2e`'s 218 (below) |
| UI baseline capture | 256 states (309 s) | 256 states (316 s) |
| Visual comparison, 16.4.3 → 16.4.6 | — | **256/256 byte-identical** |

The two customer counts the prompt names are inside the tier: `staff-runtime` **20/20** (baseline 20) and
`shell-runtime` **533/533** (baseline 533).

**Per suite.** Every one of the 49 suites passed in both runs. The 38 that printed a count in both runs printed the
same count each time:
account-arabic 34, advances 172, ar-locale-hydration 169, bank-gl 21, business-date-hydration 108, confirm-e2e 34,
controls-runtime 302, currency-lock 13, datatable-runtime 132, dc-no-bank 21, delete-refusal 16, dirty-core 72,
dirty-ui 8, document-attachments 14, document-form-runtime 188, duplicate 40, expense-categories-hidden 16,
favorites 20, fx-dashboard 6, fx-posting 108, note-currency 19, payment-dialog 28, payment-fx 66, pdf-branding 15,
private-storage 22, rate-oneclick 28, rate-screen 13, register-outstanding 5, registration-currency 20,
reversal-status 16, settings-timezone-hydration 85, shell-runtime 533, sidebar-scroll 14, skeleton-runtime 11,
staff-replay 9, staff-runtime 20, statement-reversal 25 and vendor-inline 31. Ten print only a verdict line, in both
runs: bank-opening, color-theme, compliance-claims, dark-theme, draft-buttons, draft-func, edit, preset-zatca,
print-apply and proforma-payments.

**`edit-e2e`** passed in both runs (exit 0; 90 s and 92 s). On 16.4.6 the runner captured its count, **218/218**, which
is its documented count from DEV-UI-01.6 onward. On 16.4.3 the runner recorded the pass without the count line. The
runner keeps a suite's output only when the suite fails, so the reason cannot be read back. The suite prints its
count unconditionally before it exits, and nothing in it changed between the runs.

**The visual comparison** (`tests/ui-baseline/run.mjs compare`, 16.4.3 capture against 16.4.6 capture, both made here
with the same Chromium): **256 states: 256 byte-identical** PNG files (0 pixel-identical, 0 anti-aliasing noise, 0 different or missing). The harness's own baseline was pinned to Chromium 1194, which this environment
does not have, so the comparison is release against release on one browser rather than against the committed
baseline images.

---

## L. Login, MFA, session and invitation security

No authentication, authorisation, session, MFA, invitation or subscription code changed (§N: no `src/` path differs).
What could change is the framework underneath it. That was checked in four ways.

**1. The suites that own these behaviours, on the 16.4.6 build** (all in §J and §K):

| Area | Suites (16.4.6) |
|---|---|
| Platform Owner sign-in, TOTP MFA, recovery codes, sessions, step-up | `verify:platform-auth` **136/136**; `verify:platform-bootstrap` **54/54**; PO-01B browser (sign-in with a wrong then a correct code, recovery-code sign-in, session revocation, sign-out, throttling) **138/138**; the login race **51/51** |
| Session containment, idle expiry, revocation, reconciliation | `verify:platform-containment` **88/88** (in the chain and alone); the timing study (§J.2) |
| The proxy, the trusted-IP gate and the console boundary | `verify:platform-proxy` **61/61**; the platform boundary test **218/218** |
| Company invitations and `/register/accept` | `verify:platform-invitations` **187/187**; `verify:platform-invitation-acceptance` **94/94**; PO-02D3 browser **99/99** |
| User invitations and `/join/accept` | `verify:platform-user-invitations` **73/73**; `verify:platform-user-acceptance` **46/46**; PO-03C user-invitations browser **57/57** on the re-run (56/57 first: U10, §J.2); PO-03D acceptance browser **41/41** |
| Customer sign-in, sessions and Team | `verify:server` (25 suites, 1,137/1,137); `staff-runtime` **20/20**, `staff-replay` **9/9**, `confirm-e2e` **34/34**, `shell-runtime` **533/533** (§K) |
| Access control and crypto policy | `tests/security/access-control` **22/22**; `tests/security/crypto-policy` **18/18** |

**2. The HTTP surface, probed before and after.** `next start` of each release's build was probed in the test
configuration, with every switch at its default (off). The probe covered:
- every built route, plus `/_next/image` (an allowed image, and an external SVG), `/favicon.ico`, an unknown path,
  both acceptance pages and the two login pages;
- each **anonymously**, with a **forged customer session** (a well-formed HS256 token signed with a random key), and
  with a **forged platform session**: 105 targets × 3 identities;
- three Server Action requests: an unknown action from a cross-site origin, from the same origin, and with a forged
  session.

That makes 318 responses per release.

For each response it recorded the status, the redirect target, the security headers, the `Set-Cookie` names and
attributes (never their values) and any internal middleware header.

| | Result (16.4.6 against 16.4.3) |
|---|---|
| Responses compared | **318**, field by field |
| Status codes and redirect targets | **identical**: 18 × 200, 244 × 307, 3 × 400, 51 × 404, 1 × 409, 1 × 500, the same responses in both runs |
| Forged sessions | all 80 targets that send an anonymous visitor to sign-in send a forged customer **and** a forged platform session there too; neither reached any protected page |
| The console, switched off | every `/platform` route answers 404 to all three identities |
| Server Actions | an unknown action is refused: from a cross-site origin 500, from the same origin 409, with a forged session 307 to sign-in — exactly as on 16.4.3 |
| Image optimizer | the allowed image → 200; an external SVG → 400, as on 16.4.3 |
| Security headers (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS) | **identical**, present on every HTML response |
| `Set-Cookie` | identical: only the session-clearing cookie, `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` |
| Internal middleware headers (`x-middleware-*`) | **none**, on any response, in either run |
| **Differences** | **6 fields, one kind:** `Vary` on `/favicon.ico` and the uploads route (3 identities each) now also lists `Accept-Encoding`. This is 16.4.6's `appendHeader` fix: the compression middleware can now extend a `Vary` value it previously could not read (§D). It is correct for caches and changes nothing else. |

One note, the same in both runs: `/auth/clear` redirects to `localhost:3310` rather than `127.0.0.1:3310`. It builds the redirect from `request.url`, which `next start` reports as localhost. Both are the same loopback server, and only internal auth paths are allowed as targets.

**3. The two public acceptance pages, with their switches off** (the default):
- `CUSTOMER_INVITE_ACCEPTANCE_ENABLED` for `/register/accept`;
- `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED` for `/join/accept`.

Each page was requested three ways: anonymously, with a token-like value in the **query string** (`?token=…&t=…`), and with a forged customer session. **30/30 checks pass**:
- each answers 200 with the **switched-off** mode, never ready or signed-in;
- each is `noindex, nofollow, nocache` and `no-referrer`, `Cache-Control: … no-store …`, and sets no cookie;
- the token-like value appears in no header and nowhere in the page except the router's own copy of the URL.

The **first version of this check failed 2 of its 30 checks**. Both failures were the query-string cases, and they were analysed rather than waved through. The App Router writes every page's own URL into its inline flight data: `"c":[…,"accept?token=…"]` and `"q":"?token=…"`. That is `app-render.js`, line for line the same in 16.4.3 and 16.4.6, and `/login?token=…` does the same. It is the request's URL, JSON-escaped, returned to the client that sent it; the page does not read the value. The check was then narrowed to fail on any occurrence **outside** that URL state or in any header: 4 of 4 occurrences are inside it, on both pages.

The invitation token travels only in the URL **fragment** (`#t=…`), which browsers never send to a server. The pages
render no token and no invitation data server-side. Both are `noindex` and send no referrer, and the acceptance
itself goes through the page's own same-origin Server Actions. With either switch on, the acceptance suites above
cover token handling: unknown, expired, revoked and already-used tokens, the durable rate limit, and the
one-transaction acceptance.

**4. Secrets in the build output.** The build was made with random **marker** values for `AUTH_SECRET`,
`PLATFORM_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` and the database password, and the output was then searched for them:

| Searched | `AUTH_SECRET` | `PLATFORM_AUTH_SECRET` | `FIELD_ENCRYPTION_KEYS` | database password |
|---|---|---|---|---|
| `.next/static` (sent to browsers) | 0 files | 0 files | 0 files | 0 files |
| `.next/server` | 0 files | 0 files | 0 files | 0 files |
| `.next/cache` | 0 files | 0 files | 0 files | 0 files |

The name `DATABASE_URL` appears in no file under `.next/static`. The 16.4.3 marker build gave the same result: it stopped at the gate (exit 1), but only after writing its output, which was what was searched. The marker values were random, generated in memory and never printed, and the marker build was replaced afterwards.

**Feature switches.** None is set in this environment, and each is off unless set to exactly `"true"`:
- `PLATFORM_CONSOLE_ENABLED`;
- `PLATFORM_INVITATIONS_ENABLED`;
- `PLATFORM_USER_INVITATIONS_ENABLED`;
- `CUSTOMER_INVITE_ACCEPTANCE_ENABLED`;
- `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED`;
- `CUSTOMER_SEAT_ENFORCEMENT_ENABLED`.

The suites turn a switch on only inside their own test processes. PO-05 changed no switch and no default.

---

## M. Functional and visual differences

### M.1 What the framework itself changes, 16.4.3 → 16.4.6 (from the published packages)

With the version string normalised, 55 runtime files differ between 16.4.3 and 16.4.5. 16.4.6 adds only the
`appendHeader` fix (§D). Each change, and what it means for Elite ERP:

| Area | Change | Bearing on Elite ERP |
|---|---|---|
| Response framing (pc58) | `send-response.js` and `next-server.js` no longer forward `content-length`, `content-encoding` or `transfer-encoding` from a `Response` body that Next.js sends, because the body may have been transparently decoded | Two route handlers set an explicit `Content-Length`: `/api/document-pdf/[type]/[id]` and `/api/import-template/[module]`. Next.js now drops it, and Node frames the body itself. Checked directly in M.2. |
| Internal header (f3mh) | the internal `x-middleware-set-cookie` header is stripped from responses: proxy (middleware) responses in `next-server.js` and non-middleware Edge responses in `web/adapter.js` | The proxy clears session cookies on redirects through `NextResponse`. The `Set-Cookie` still goes out, and the internal duplicate can no longer. The probe checks every route for internal headers (§L). |
| Image optimizer (7qx7) | content-type detection validates the ISOBMFF `ftyp` box size, so a text document such as an SVG can no longer pass as AVIF/HEIC | closes the live code path of §C |
| `'use cache'` (mfr8, vc7v, rhh4) | cache-key and root-param fixes in `use-cache-wrapper.js` | not used |
| Fallback shells (vvgp) | placeholder fallback params only in minimal mode (`app-page-runtime` template) | Cache Components not used |
| Rendering | the Turbopack chunk-group bootstrap is emitted as its own inline script stream before the inlined RSC data, instead of being prepended to the bootstrap script content | The HTML's inline-script layout changes. The CSP already allows inline scripts (`'unsafe-inline'`, no nonce). Covered by the hydration suites and the 256-state visual comparison (§K, M.2). |
| Preview mode | preview-token verification moves from the bundled `jsonwebtoken` to `fast-jwt`, with HS256 pinned | Pages Router preview and draft mode are not used |
| CSP nonce | extraction refactored into `getScriptNonceFromHeaders`, with the same rule | no nonce is used |
| Dev server only | HMR initial-version script, asset-prefix handling, Turbopack HMR | affects `next dev` only |

None of the other 30 changed modules is a routing, redirect, Server Action (handler, encryption, origin / CSRF check),
cookie-parsing or default-header module. The 25 precompiled server runtime bundles change along with them. Their
minified diffs were not attributed line by line, which is why every behaviour above is also tested at runtime (§J–§L,
M.2).

**Next.js defaults did not change.** `dist/server/config-shared.js` (the defaults), `config.js` (loading) and
`config-schema.js` (validation) are identical in 16.4.3 and 16.4.6 once the version string is normalised. The resolved
configuration the build records (`required-server-files.json`) is identical too (§I). The build gate's own upgrade
metadata lists no "future defaults" for the 16.4.6 target.

### M.2 What was observed

| Observation | Result |
|---|---|
| Route table, pages, the eleven build manifests, the resolved configuration | identical (§I) |
| Server Action ids (`server-reference-manifest`) | identical |
| HTTP surface: 318 responses (§L) | identical, except `Vary` gaining `Accept-Encoding` on two routes — the 16.4.6 fix |
| **The two explicit-`Content-Length` downloads** (pc58) | checked directly on 16.4.6 with a session on the fictional seed (8/8): the xlsx import template (9,662 bytes, a complete ZIP) and a quotation PDF (244,877 bytes, `%PDF-` … `%%EOF`) arrive **whole**, `200`, with their content type, `attachment` disposition and `no-store`. Both, and the CSV template, are now sent `Transfer-Encoding: chunked` without `Content-Length`. The browser no longer knows the size in advance, so a progress bar cannot show a percentage. The files are unchanged. (16.4.3 forwarded the route's own header; that is what the fix removes. It was not measured on 16.4.3.) |
| 256 visual states, light / dark, English / Arabic, desktop / mobile | **byte-identical** PNG files |
| Customer browser tier, 49 suites; `verify:server`, 25 suites | the same results (§K) |
| Platform Owner suites: 2,634 server and 760 browser checks | the same totals (§J) |
| Hydration (the inline-script layout change) | `ar-locale-hydration` 169, `business-date-hydration` 108, `settings-timezone-hydration` 85: unchanged and green |

**Conclusion: no functional or visual difference was found.** Two wire-level differences were observed, and both come from the fixes themselves: `Vary` gains `Accept-Encoding` where compression applies, and the two explicit-length downloads are now chunked. Neither changes what a user receives.

---

## N. Freeze verifiers and change control

**No earlier layer was re-baselined, and no existing verifier changed.** PO-05 touches none of the files the earlier
layers record: ACC-01, LCP, PO-01A, PO-01B, PO-01B.1, PO-02A … PO-02D3, PO-03A, PO-03B (with the Team hotfix), PO-03C and
PO-03D. Each layer's drift check passes unchanged inside `verify:document-form` and `verify:page-archetypes`, the two
freeze verifiers. The PO-03D undo proof gives the same result as at PO-03D: 27 files and 119 hunks byte-exact, 9 added
files as recorded, and no `src/` or `drizzle/` path outside the layer.

**The one changed protected value is the lockfile's byte pin.** In `verify/document-form-pins.json`, `package-lock.json`
moves from `dcfa0b4bbdbb6e3d` to `8e7d93fae52124cc`; nothing else in the file changes. This is the procedure of the two
earlier lockfile changes, `cf0c6e5` (SEC-DEP) and `041eb23` (follow-redirects). It was tested separately, with each
case restored afterwards:

| Case | `verify:document-form` | `verify:po05-security-update` |
|---|---|---|
| The pins file put back to `dcfa0b4bbdbb6e3d` while the lockfile is PO-05's (R04) | **fails** (protected files) | **fails** |
| One byte appended to the lockfile (L05) | **fails** | **fails** |
| The lockfile put back to `741686e`'s while `package.json` says 16.4.6 (L06) | **fails** | **fails** (5 checks) |
| As committed | passes | passes |

**The PO-05 record** (`verify/po05-security-update.mts`, generated from the diff against `741686e` and committed in
`f85acb9`). It follows the approved-delta rule of every earlier phase, adapted to two manifest files:
- `package.json`'s 3 hunks and `package-lock.json`'s 17 hunks, each `[741686e's text, PO-05's text]`, widened with
  context until unique;
- `undoPo05`: the hunks undone give `741686e`'s bytes (`baa7ed22b2fe27ce`, `dcfa0b4bbdbb6e3d`);
- `po05Drift`;
- the lockfile pin before and after;
- the 13 changed lock entries;
- the six bundled-metadata entries that must stay out;
- the seven advisories with their identifiers and ranges;
- the build's last recorded stage and its route table (count and sha).

**Its verification** (`npm run verify:po05-security-update`, `verify/verify-po05-security-update.mts`) runs
**19 checks**, and **23** with `-- --build`:
1. the manifests;
2. the lockfile;
3. the installed tree;
4. the advisories;
5. with `--build`, the compiled output.

It is static and local: no network, no database, nothing written. It runs on its own and is not added to the
`verify:static` chain. The handover's §J runs record it: 19/19 at the static step, 23/23 after the build.

**Tamper tests: 21 cases, every one caught, every file restored byte for byte** (sha256 compared; the tree clean before
and after):

| Group | Cases | Caught by |
|---|---|---|
| `package.json` | next back to 16.4.3; next as a range (`^16.4.6`); `eslint-config-next` out of lockstep (16.4.5); React moved (19.2.5); an unrelated dependency added; the existing override removed | `verify:po05-security-update` (2–3 checks each) |
| `package-lock.json` | next's integrity changed by one character; an unrelated package's version changed (clsx); a bundled-metadata entry added; next resolved from a non-registry host; one byte appended; the whole lockfile put back to `741686e`'s | `verify:po05-security-update` (3–5 checks each) **and** `verify:document-form` |
| The record and the pin | an advisory's range widened to cover 16.4.6; an advisory removed; the record's lockfile pin edited; the pins file put back | `verify:po05-security-update`, and `verify:document-form` for the pins file |
| The build output (`--build`) | `.next` says 16.4.3; one route removed from the route manifest; an earlier build stage; an empty build id | `verify:po05-security-update -- --build` |
| The installed tree | `node_modules/next` reports 16.4.3 | `verify:po05-security-update` |

**The PO-05 undo proof** (a scratch script, as in every phase):
- `package.json` and `package-lock.json`, their hunks undone, are `741686e`'s to the byte;
- every other path that differs from `741686e` is on the phase's list: the record, its suite, the pins file (one pin
  moved) and this document;
- no `src/` or `drizzle/` path differs.

Result: **PASS** (2 files, 20 hunks, one pin moved).

---

## O. Compatibility with the Team-field hotfix branch (read-only)

`fix/team-sensitive-fields-exposure` (`94f936e`) is `main` (`621f156`) plus the Team-field fix (`35d5dcc`) and its
handover. Its `package.json` dependency sections, its `package-lock.json` (`dcfa0b4bbdbb6e3d`) and its lockfile pin are
byte-identical to `741686e`'s, so the branch also runs Next.js 16.4.3.

**The experiment.** The branch itself was not modified, committed, rebased, merged or pushed. Detached, disposable
worktrees at `94f936e` were:
1. installed and built as it stands;
2. given the same three-file change, uncommitted:
   - `package.json`'s two dependency lines;
   - `package-lock.json`, replaced by PO-05's file byte for byte;
   - the lockfile pin;
3. installed again, checked and built.

`verify:static` ran on a disposable database pushed from the **branch's own** schema, with no platform SQL, both
without and with the change. Each worktree was then removed.

| Step, in a disposable worktree at `94f936e` | As it stands (16.4.3) | With the three-file change (16.4.6) |
|---|---|---|
| `npm ci` | exit 0 | exit 0, next 16.4.6 |
| `npm ls --all` | — | exit 0 |
| `npm audit --audit-level=high` | — | exit 0 |
| `tsc --noEmit` | — | exit 0 |
| `eslint src --max-warnings=0` | — | exit 0 |
| `verify:static`, on a database pushed from the branch's own schema (67 tables) | **1,836/1,836** over 22 result lines | **1,836/1,836** over 22 result lines, identical suite for suite, including `verify:document-form` with the moved pin |
| Security tests | — | access-control **22/22**; crypto-policy **18/18** |
| `next build` (test configuration) | **exit 1**: 58/58 pages, then the advisory gate (1 `SecurityFatalError`) | **exit 0**: 58/58 pages; no gate error |

The first attempt's `verify:static` ran without its database because of a defect in the scratch harness, not in the change. The helper imported this branch's database script, and its `@/` imports did not resolve on the hotfix branch's code, which has no platform library. That attempt read 1,040/1,043: the three store-model inventory checks that need the database failed. It is recorded and not counted. The corrected harness creates the database with `psql` on the loopback test cluster and pushes the branch's own schema with the branch's own drizzle configuration. It gave the row above, with and without the change. Each worktree was removed afterwards. The branch is still at `94f936e`, with nothing committed, rebased, merged or pushed.

**Recommendation for the owner** (not done here; it needs the owner's approval):

| Question | Answer |
|---|---|
| Versions | the same: `next` 16.4.6 and `eslint-config-next` 16.4.6, exact; React 19.2.4 and sharp 0.35.5 unchanged |
| Files | three: `package.json` (the two dependency lines; no script line, since the PO-05 suite is not on that branch), `package-lock.json` (PO-05's file, byte-identical: `8e7d93fae52124cc`) and `verify/document-form-pins.json` (the lockfile pin). PO-05's record and suite are written against `741686e` and stay on this branch. The hotfix branch's own approved-delta check is unaffected: its `verify:static`, where that check runs, gives the same result with the change as without it, suite for suite. |
| Isolation | one commit containing only these three files: on its own branch from `main`, or on top of the hotfix branch. Keep it apart from the Team-field fix, so either can be reviewed, released or reverted alone. |
| Tests before release | `npm ci`; `npm audit --audit-level=high`; `tsc`; `eslint src --max-warnings=0`; `verify:static` (including `verify:document-form` for the pin); the security tests; `next build` (exit 0) in the test configuration; then the hotfix handover's own checks |
| Clean build possible? | **yes**: shown above. The same three files take the hotfix branch's code from a build the gate stops (exit 1) to a complete build (exit 0). |
| Approval needed | yes. Changing the hotfix branch, `main` or production is outside Prompt 5, and the release order (decision N-2, §P) is the owner's. |

---

## P. Remaining blockers and owner decisions

**Production release status: NO-GO**, for the same reasons as at PO-03D, minus one. The Next.js advisory gate no longer
blocks the build on this branch. These remain:
- D-6, how the staged schema reaches a database;
- D-7, the read-only production measurements and the `users_email_lower_uq` decision;
- the policy decisions L-1 … L-10 and P-1 … P-10, carried unchanged from PO-03D §O;
- an isolated staging environment and a regression on its release candidate (§Q).

**Production itself still runs Next.js 16.4.3.** `main` (`621f156`) and the hotfix branch (`94f936e`) are unchanged.
Both carry the same seven advisories, including the image-optimizer path, which is live on the self-hosted deployment
(§C). The gate stops their build only when an agent runs it. A person or CI can still build and deploy 16.4.3, and that
build carries the advisories (§H). How the update reaches `main` is decision **N-2**.

**Decisions this phase adds:**

| # | Decision | Recommendation |
|---|---|---|
| N-1 | Approve **16.4.6**. The minimum patched release is 16.4.5. | 16.4.6: the same line and dependencies, the newest stable release, and one header-handling fix more (§D). 16.4.5 remains possible: the change would be the same two lines and a regenerated lockfile. |
| N-2 | How the Next.js update reaches `main`: with the Team-field hotfix, before it, or after it | §O: one separate, reviewed commit of three files, on a branch from `main`, or added to the hotfix branch. Only the owner may make it. |
| N-3 | The 13 remaining moderate audit findings. One reaches production: `uuid` through `exceljs`, GHSA-w5hq-g745-h8pq. The others are development tools. | A separate, approved dependency task. npm's suggested "fixes" are semver-major **downgrades** of `exceljs` and `drizzle-kit` and must not be applied. Whether `exceljs` passes a buffer to `uuid` v3/v5/v6, the vulnerable call, was not assessed here. |
| N-4 | Registry-signature and provenance verification where Sigstore is reachable | Run `npm audit signatures` in CI or the staging pipeline. Here it was blocked by the network policy; the registry signatures were verified another way (§F), and the provenance attestations were not verified. |
| N-5 | The two timing-sensitive checks (PO-03D A.1-14) | The owner-approved, test-only hardening of §J.2. Until then: re-run at the same commit and report both results. |
| N-6 | The official Next.js notice (`nextjs.org/blog/november-2026-security-release`) | Read it before staging. It could not be read from this environment (§C); nothing here depends on it. |
| N-7 | The session environment's network allowlist now includes `nextjs.org`, which the owner approved during this phase | Keep it or remove it in the environment settings. It is not part of the repository. |

---

## Q. Prompt 6 prerequisites — isolated staging preparation

**Readiness assessment (Prompt 5 §12).**

| Question | Answer |
|---|---|
| Is the Next.js build blocker resolved? | **Yes, on `feat/platform-owner`:** `next build` exits 0 in the test configuration, with the gate untouched (§H) |
| Is the branch green on the new release? | **Yes.** The full matrix is green at `f85acb9`. One older timing-sensitive check failed once and passed when re-run at the same commit; both results are reported (§J, §J.2). |
| May Prompt 6 (isolated staging **preparation**) begin? | **Yes, from a build and regression standpoint, once the owner authorises it.** Prompt 6 prepares; it does not deploy. |
| May anything be deployed, to staging or to production? | **No.** Staging needs items 1–11 below; production remains NO-GO (§P). |
| Is `main` / production fixed? | **No.** It still runs 16.4.3 (§O, decision N-2). |

Prompt 5 removes the build blocker on this branch. It does **not** make staging ready. Prompt 6 must still resolve, in
order:

1. **D-6 — how the staged schema reaches a database.** The PO-02 foundation SQL, the Trial seed and the staged
   `user_invitations` table need a reviewed, scripted, reversible procedure — never by hand. Prompt 6 rehearses it on
   a disposable copy first.
2. **D-7 — read-only measurements and the e-mail decision.** The case-variant e-mail audit and the other D-7
   measurements must be run read-only against a copy of production data (or production itself, read-only, with
   owner approval). The owner then decides on `users_email_lower_uq`.
3. **An isolated staging database** — neither the production Neon database nor a copy reachable from production.
4. **An isolated staging server** — not the Hostinger production VPS.
5. **Staging-only secrets:** `AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`, `PLATFORM_AUTH_SECRET`, database credentials and
   storage tokens, generated for staging and never shared with production.
6. **Test-only application URLs:** a staging customer origin and console host; `CUSTOMER_PUBLIC_ORIGIN` set to the
   staging customer origin.
7. **Migration rehearsal and rollback** on the staging database, including the release preflight (H-1 / H-2) and the
   guarded seed rollback.
8. **Backup / restore validation** of the staging database (`docs/security/backup-dr.md`).
9. **A feature-flag activation plan**, per environment, all off by default:
   - `PLATFORM_CONSOLE_ENABLED`;
   - `PLATFORM_INVITATIONS_ENABLED`;
   - `PLATFORM_USER_INVITATIONS_ENABLED`;
   - `CUSTOMER_INVITE_ACCEPTANCE_ENABLED`;
   - `CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED`;
   - `CUSTOMER_SEAT_ENFORCEMENT_ENABLED`;
   - company-access enforcement;
   - the trusted-IP and proxy-hop settings.
10. **Owner decisions:** L-1 … L-10 and P-1 … P-10 (carried from PO-03D), and N-1 … N-7 (§P), including the A.1-14
    test-hardening decision (N-5).
11. **A regression on the staging release candidate** — the same matrix as §J–§N, on the staging build.
12. **Release ordering:**
    - the Team-field hotfix and the Next.js update for `main` (§O);
    - the Team session correction (PO-03C B);
    - whether `main` takes Next.js 16.4.6 before, with, or after the hotfix.

---

## R. Proposed Prompt 6 (not executed)

~~~text
PROMPT 6 OF 16 — ISOLATED STAGING PREPARATION (development and staging-preparation only).

Start from feat/platform-owner at the PO-05 handover commit; verify main 621f156, the hotfix branch 94f936e and PR #11
(draft) unchanged, and Next.js 16.4.6 installed with `next build` completing (exit 0).

Authorized: preparing — not deploying — an isolated staging environment.
  - Write the D-6 migration procedure (scripted, guarded, reversible) and rehearse it on disposable *_test_only_*
    databases.
  - Draft the D-7 read-only measurement queries and the plan to run them.
  - Write the staging runbook:
      - staging host and database requirements;
      - the secrets inventory (names only, no values);
      - the staging URLs;
      - the per-environment flag plan;
      - the backup / restore validation steps;
      - the migration rehearsal and rollback steps.
  - Write the staging release-candidate regression plan.

Not authorized:
  - provisioning or accessing any server or database;
  - production Neon or Hostinger access;
  - creating real secrets;
  - running SQL anywhere but loopback test databases;
  - deploying;
  - merging;
  - enabling any flag;
  - any application feature change;
  - any dependency change.

1. Baseline: SHAs, PR #11, `npm ci`, build exit 0, `verify:po05-security-update -- --build`.
2. D-6: the procedure and its rehearsal (forward, the release preflight, rollback), with evidence.
3. D-7: the read-only query set and its expected outputs on fictional fixtures; the owner decision template for
   `users_email_lower_uq`.
4. The staging runbook and the flag activation plan (who switches what, in which order, and how to switch it back).
5. The owner decision sheet for L-1..L-10, P-1..P-10 and N-1..N-7 (A.1-14 is N-5).
6. Handover docs/platform-owner/PO06_STAGING_PREPARATION.md; push feat/platform-owner only; STOP before Prompt 7.
~~~
