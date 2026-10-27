# SEC-DEP (October 2026) — consolidated dependency security remediation

**Branch:** `claude/sec-dep-oct-2026`, one commit on approved `main` `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
**Scope:** dependency manifests only — `package.json`, `package-lock.json` — plus the one verification pin that
guards the lockfile (`verify/document-form-pins.json`) and this document. No application source, accounting
calculation, posting logic, permission, authentication semantic, schema or migration changed. Nothing merged or
deployed.
**Gate:** `npm audit --audit-level=high` exits 0 after a clean `npm ci`. It had failed on `main` since 2026-10-01
(DevSecOps runs 156–167, the "Dependency vulnerability scan" job).

## 1. Original audit (main 1bfdbbf, clean `npm ci`, 2026-10-26)

`npm audit`: **18 vulnerable packages — 1 critical, 11 high, 6 moderate** (830 dependencies: 342 prod, 450 dev).
`npm audit --audit-level=high` exit 1.

| Package | Severity | Path | Installed | Advisories (vulnerable range) | First safe |
|---|---|---|---|---|---|
| next | critical | direct, prod | 16.3.5 | GHSA-vcvr-r3jv-pc5j critical (>=16.2.0 <16.3.6) · GHSA-2464-fhr4-w9xw critical (<=16.4.0) · GHSA-673q-mjm6-r5xr critical (<=16.4.0) · GHSA-cjq9-62q9-8jv4 high (<16.3.8) · GHSA-p3m5-59mp-jv5r high (<=16.4.0) · GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-h694-7cp9-m8p3 moderate (<16.3.8) · GHSA-39w2-rjm5-chcv low (<16.3.8) | 16.4.1 |
| zod | high | direct (4.4.3); under @vercel/cli-config (4.1.11, exact pin); under chromium-bidi (3.25.76) | 4.4.3 / 4.1.11 / 3.25.76 | GHSA-mrhx-c7xc-m3w5 high (<4.6.6) | 4.6.6 |
| @vercel/blob → @vercel/oidc → @vercel/cli-config | high | direct, prod | 2.6.1 / 3.8.0 / 0.2.0 | via zod 4.1.11 — all 15 published @vercel/cli-config versions (0.1.0–0.3.3) pin zod exactly 4.1.11 | no upstream fix |
| puppeteer-core → chromium-bidi | high | direct, prod | 25.10.0 / 17.0.2 | via zod 3.25.76 | 25.13.0 |
| undici | high | via @vercel/blob (^6.23.0) | 6.28.1 | GHSA-xjj6-f33q-929c high · GHSA-4qv8-2p9j-2685 moderate (<6.29.1) | 6.29.1 |
| follow-redirects | high | via @sparticuz/chromium-min (^1.15.9) | 1.16.0 | GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c high (>=1.16.0 <1.16.1) | 1.16.1 |
| sharp | high | via next (optional) | 0.35.4 | GHSA-wq5f-xc86-pv6w high (<0.35.5) | 0.35.5 |
| source-map-js | high | via postcss, @tailwindcss/node | 1.2.1 | GHSA-68fv-2mgg-jv7q high (<1.2.2) | 1.2.2 |
| brace-expansion | high | via minimatch 3 / 5 / 10 (eslint; exceljs → archiver; typescript-eslint) | 1.1.18 / 2.1.4 / 5.0.9 | GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p high · GHSA-q2hr-2g5m-vwhr moderate | 1.1.21 / 2.1.7 / 5.0.12 |
| drizzle-kit → @esbuild-kit/* → esbuild | moderate | direct, dev | 0.31.10 / 0.18.20 | GHSA-67mh-4wv8-2f99 (<=0.24.2) | none — npm proposes a downgrade to drizzle-kit 0.18.1 |
| exceljs → uuid | moderate | direct, prod | 4.4.0 / 8.3.2 | GHSA-w5hq-g745-h8pq (<11.1.1) | none — npm proposes a downgrade to exceljs 3.4.0 |

## 2. Changes

Each version is the first release outside every advisory range, except `next`, where the brief set 16.4.3, the
current stable release (16.4.1 is the first outside the ranges).

| Package | Before → after | How | Why |
|---|---|---|---|
| next | 16.3.5 → **16.4.3** (exact pin kept) | `npm install --save-exact` | 11 advisories, 3 critical |
| eslint-config-next | 16.3.5 → **16.4.3** (exact pin kept) | same | kept in lockstep with next |
| zod | ^4.4.3 (4.4.3) → **^4.6.6** (4.6.6) | `npm install zod@4.6.6` | GHSA-mrhx-c7xc-m3w5 |
| puppeteer-core | ^25.10.0 (25.10.0) → **^25.13.0** (25.13.0) | `npm install puppeteer-core@25.13.0` | its chromium-bidi 157.0.8090-0 moves from zod 3 to zod ^4.6.5 (resolved to 4.6.6) |
| zod under @vercel/cli-config | 4.1.11 → **4.6.6**, deduplicated with the root copy | `overrides` (below) | no upstream fix exists |
| undici, source-map-js, brace-expansion (×3), sharp | see §1 | `npm update <name>`, inside the dependents' existing ranges | the advisories in §1 |
| follow-redirects | 1.16.0 → **1.16.1** | `npm update follow-redirects --before=2026-10-20` | the fixed release; 1.16.2, published one day before this change, was deliberately not taken |

The override:

    "overrides": { "@vercel/cli-config": { "zod": "^4.6.6" } }

It is scoped to the one package that pins the vulnerable zod exactly and touches no other zod consumer. zod
4.1.11 → 4.6.6 is a same-major update. @vercel/cli-config uses only `z.object`, `z.string`, `z.boolean`, `z.number`,
`z.literal`, `z.union`, `.omit`, `.parse`, `z.encode` and `z.ZodError`. A smoke test of every zod-backed export
(valid and invalid input, a `writeConfigFile` / `readConfigFile` round trip in a temporary directory) passes 8/8 on
4.6.6. Remove the override once @vercel/cli-config ships a patched zod.

Lockfile: 59 entries change version — next and its SWC binaries and env (16.4.3); eslint-config-next and
@next/eslint-plugin-next (16.4.3); sharp and its platform binaries (0.35.5, libvips 1.3.4); puppeteer-core 25.13.0
with the dependencies it pins (chromium-bidi 157.0.8090-0, devtools-protocol 0.0.1696802, @puppeteer/browsers
3.2.4, webdriver-bidi-protocol 1.0.1, typed-query-selector 2.12.3 and their own small updates); zod 4.6.6, with the two
nested copies removed; undici 6.29.1; follow-redirects 1.16.1; source-map-js 1.2.2; brace-expansion
1.1.21 / 2.1.7 / 5.0.12. Nothing else moved. There was no blanket update, no `npm audit fix --force` and no
`--legacy-peer-deps`.

Verification pin: `verify/document-form-pins.json` holds the lockfile's byte hash, a DEV-UI-01.6 guard that makes
every dependency change deliberate. It is re-pinned from `40bb5a3ae316bb4c` to `31cbbd44355b2a28`, the new lockfile,
and remains a byte-exact check: main's lockfile, or the new one with a single byte appended, fails it. Nothing else in
the pins file changed.

## 3. Result

After a clean `npm ci`: **0 critical, 0 high, 6 moderate**; `npm audit --audit-level=high` **exit 0**; `npm ls`
exit 0.

Negative checks (the candidate's manifests in a scratch directory, lockfile re-resolved, `npm audit
--audit-level=high`):

| Reintroduced | Audit |
|---|---|
| none (control) | exit 0 |
| next / eslint-config-next 16.3.5 | exit 1 — 1 critical |
| next / eslint-config-next 16.4.0 (the last vulnerable release) | exit 1 — 1 critical |
| the @vercel/cli-config zod override removed | exit 1 — 4 high |
| puppeteer-core 25.10.0 | exit 1 — 3 high |
| zod 4.4.3 | exit 1 — 4 high |

The DevSecOps workflow and its `npm audit --audit-level=high` step are unchanged.

## 4. Compatibility

No application compatibility change was needed. TypeScript, ESLint and the production build pass on Next.js 16.4.3
without modification, and the build reports exactly the warnings it reported on 16.3.5: the 12 pre-existing
whole-project tracing warnings from `src/lib/storage/blob-client-fake.ts`, at the same source positions. The route
table is identical: 80 routes, every one dynamic, the proxy (middleware) present.

**Security branch alone (main + this change)** — TEST-only databases, loopback, isolated worktree, no `.env`:

| Gate | Result |
|---|---|
| `npm ci` (clean) | exit 0 |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint src --max-warnings=0` | 0 problems |
| Committed security suite | crypto-policy 18/18 · access-control 22/22 |
| `npm run verify:static` (main's 20 verifiers) | exit 0 — role 32, confirm 62, dirty 66, skeletons 89, contrast 161, typography 43, status registry 88, shell 75, controls 110, datatable 69, document form 76, edit-action 59, store model 69, provider harness 302, backup claims 26, money precision 12, number-locale 29, date-timezone 38, business-dates 44, ledger-only 8 |
| `npm run verify:server` | exit 0 — every suite; DB hardening triggers present |
| `npm run build` (normal, unmocked) | exit 0 |
| `npm audit --audit-level=high` | exit 0 |

The first `verify:static` run stopped at `verify:document-form`'s lockfile pin, as expected, because the lockfile
changed. After the re-pin in §2 every verifier passes. CI's `db:push` step was not run locally: there is no schema or
drizzle-kit change, and no database migration was authorized.

**Temporary integration with DEV-UI-01.7.** A disposable worktree at the approved UI head
`262a92342d63ee96d7675c700ff66bb4f980f8ac`, with this change merged in locally. The merge was automatic and clean;
the merge commit was never pushed and neither approved branch moved. The merged tree differs from the UI head only in
`package.json`, `package-lock.json` and the lockfile pin. Every count matches the DEV-UI-01.7 C8 final release gate.

| Gate | Result |
|---|---|
| `npm ci`, `tsc --noEmit`, `eslint src --max-warnings=0` | exit 0 · 0 errors · 0 problems |
| Security suite · `npm audit --audit-level=high` | 18/18 · 22/22 · exit 0 |
| `npm run verify:static` (21 verifiers) | exit 0 — incl. page archetypes 250/250, document form 77/77, number-locale 29 / date-timezone 38 / business-dates 44 (P0 / P0.1 / P0.2) |
| `npm run verify:server` (24 suites) | exit 0 — statements 70, project costing 50, docs import 339, payment reversal 55, settlement 29, DB hardening, … |
| `npm run build` | exit 0 |
| Page-archetype runtime (`verify:page-archetypes-runtime`, C0–C8) | **157/157** — 648 owner / Staff / sweep states, React #418 zero, the P&L policy, Balance Sheet Preliminary, print, PDF fit, exports against the C8 record, export authorization and tenant scope |
| Runtime measurements vs the C8 final record (`--measure-out`) | **0 differing fields** — every state's outline, headings, overflow and actions, every project figure, every report and statement figure, every export text |
| Full browser tier (`run-browser-suites.mjs`) | **49/49**, every suite's check count identical to the C8 final tier — DataTable 132/132, controls 302/302, AR locale hydration 169/169, business-date hydration 108/108, settings timezone hydration 85/85, private storage 22/22, document attachments 14/14, PDF branding 15/15, staff runtime 20/20, staff replay 9/9 |

**Screenshots** (the C8 final harness, frozen clock, seed, TEST-only database and pinned Chromium; the reference is the
approved C8 final capture): **1,134 / 1,134 byte-identical** — 256-state matrix 256/256, shell 44/44, lists 210/210,
documents 134/134, archetypes 490/490 (EN / AR, light / dark, every width). Next.js 16.4.3 produced no rendering
difference, so there was nothing to classify as an intentional framework change or a regression, and no re-baseline.
The print and export evidence is identical too: 80 / 80 files (P&L / Balance Sheet screenshots and Chromium's print
to PDF, EN / AR; the 48 exports — eight kinds × CSV / Excel / PDF × EN / AR — as CSV, Excel and rendered PDF pages).

## 5. Security verification

| Area | Evidence | Result |
|---|---|---|
| Application code | `git diff main` touches no file under `src/`; `src/proxy.ts`, `src/lib/auth.ts`, the storage clients, the engines and every server action are byte-identical | unchanged |
| Session authentication and the proxy | 82 build routes requested anonymously and with a forged session cookie (valid JWT shape, wrong signature) against Next.js 16.3.5 (UI head) and 16.4.3 (integration) | identical on both: 79 app routes redirect to `/login` (the forged cookie rejected, and cleared on 78 of them); `/login`, `/register` answer, and route a forged cookie through `/auth/clear`; `/favicon.ico` static |
| Public surface | build route tables; the probe above | no route added, removed or made static; the routes answering anonymously are still only `/login`, `/register`, `/favicon.ico` |
| Authorization and tenant isolation | access-control suite 22/22; role matrix 32/32; runtime export authorization and export tenant scope; staff runtime 20/20, staff replay 9/9 | unchanged |
| Financial exports | runtime: anonymous export → 307 `/login`, a second organization's exports carry none of the seeded organization's amounts; 48 exports identical to the C8 record | intact |
| Secret exposure | production builds with marker secrets: no `AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` or database password in `.next/static` or `.next/server`, and the name `DATABASE_URL` absent from client assets, on 16.3.5 and 16.4.3 | none |
| Uploads and storage | private storage 22/22 and document attachments 14/14 (TEST storage driver); `@vercel/blob` 2.6.1 driven through its undici transport against a loopback mock — put / head / list / delete, bearer token on every request, bytes intact — 8/8 on undici 6.28.1 (before) and 6.29.1 (after) | preserved |
| Accounting and data | no engine or schema change; `verify:server` identical; every measured financial value identical to the C8 record | unchanged |

Observation (deployment hygiene, pre-existing): on Next.js 16.3.5 a plain-text search found the build-time database
password and field-encryption key inside the Turbopack build cache (`.next/cache/turbopack/*.sst`); on 16.4.3 it
found neither, but the cache may hold compressed data. Treat `.next/cache` as sensitive and keep it out of every
deployment artifact on either version.

## 6. Remaining findings and deferred work

- **Moderate, no fix short of a downgrade** (carried since Batch 2, unchanged here):
  - drizzle-kit 0.31.10 → @esbuild-kit/core-utils / esm-loader → esbuild 0.18.20 (GHSA-67mh-4wv8-2f99, the esbuild
    development server). Development tooling only; it is not in the production bundle. drizzle-kit 0.31.11, the
    latest release, still depends on the @esbuild-kit chain.
  - exceljs 4.4.0 → uuid 8.3.2 (GHSA-w5hq-g745-h8pq, a missing buffer bounds check in v3 / v5 / v6 when a buffer is
    passed). exceljs 4.4.0 is the latest release.
- **The @vercel/cli-config override** — remove it when an upstream release depends on zod ≥ 4.6.6.
- **Not exercised:** the real Vercel Blob service (no Blob access is authorized; the TEST suites use the storage
  driver's fake and the transport was checked against a loopback mock) and CI's `db:push`. Staging validation is
  still a separate, later step.
- **Newer, non-security releases not taken** (deliberately, to keep the change minimal): zod 4.6.7,
  puppeteer-core 25.16.0, @vercel/blob 2.8.2, follow-redirects 1.16.2 and others listed by `npm outdated`.
- **Pre-existing, unchanged:** the 12 build tracing warnings from `blob-client-fake.ts`; the GitHub Actions Node 20
  deprecation warnings (`actions/checkout@v4`, `actions/setup-node@v4`).

## 7. Recommended merge order

1. Merge this branch into `main` first, through a pull request with a merge commit. Its CI should be fully green;
   the dependency scan passes again.
2. Then merge `claude/dev-ui-01-7-page-archetypes` (approved head `262a923`) with a merge commit, without rebasing
   it. The merge is automatic: DEV-UI-01.7 changes `package.json` scripts and other lines of
   `verify/document-form-pins.json`, not the dependencies or the lockfile pin. The result is exactly the
   integration tree verified in §4 plus this document. Its pull request's dependency scan passes once this branch is
   on `main`.
3. After each merge, rerun the gates in §4 on `main` (TEST-only) and confirm the recorded trees. Nothing is deployed
   by either merge; production deployment remains a separate approval.
