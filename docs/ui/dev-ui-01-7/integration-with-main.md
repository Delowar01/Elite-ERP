# DEV-UI-01.7 — integration with main

The approved DEV-UI-01.7 head `262a92342d63ee96d7675c700ff66bb4f980f8ac` (C8 final, tree
`0e033b52c7978de809daacf2cfd4d0b1582247b7`) is merged into main `32702c3e6690259c99ce7beb4f182c7b8fe37944` (tree
`183736e7a442264fe5a96082895996fecd72dd1f`) on `integration/dev-ui-01-7-main`. The historical branch
`claude/dev-ui-01-7-page-archetypes` is unchanged; it was not rebased or force-pushed. This branch merges nothing to main
and deploys nothing.

All verification ran against `devui010_test_only_*` databases on 127.0.0.1, with no repository `.env`. The browser
tier's runner reads a temporary `.env` that points only at its own TEST-only database, and removes it afterwards.

## What main brought since the branch's base (1bfdbbf)

| Commit | Change |
|---|---|
| `cf0c6e5` | SEC-DEP: vulnerable dependencies remediated, including Next.js 16.3.5 → 16.4.3 |
| `2efc399` | CI: pull-request secret scanning restored |
| `0dedaa4` | Merge of PR #6 (the two above) |
| `486dfc9` | `CLAUDE.md`: pre-launch SaaS development rules and test-data risk acceptance |
| `32702c3` | PR #7: the PDF route renders its print page from `PDF_RENDER_ORIGIN` when it is set |

PR #7 fixes PDF rendering on the VPS:

- **Before:** NextRequest reports the origin as `https://localhost:3200` behind the TLS-terminating proxy, and printing from that origin failed.
- **Now:** the route renders from `PDF_RENDER_ORIGIN` when it is set; the VPS sets it to `http://127.0.0.1:3200`.

## Integration commits

| Commit | What |
|---|---|
| `3a076b4` | `git merge --no-ff` of the UI head. Parents `32702c3` and `262a923`; tree `dafdea970aa549bce37bda950db5f5adadf820bc`, identical to the `git merge-tree` preview |
| `df0f9be` | The page-archetype verifier holds PR #7's hunk (below). Tree `90df504f6027f09662b9de6741824fd8b4093408` |
| this commit | This record, and nothing else |

### Conflicts

**Textual: none.** Two files changed on both sides and merged automatically:

- `package.json`: main's dependency versions, plus the branch's two `verify:page-archetypes*` scripts and its
  `verify:static` entry.
- `verify/document-form-pins.json`: main's lockfile pin, plus the branch's per-file layout pins.

The merged `package-lock.json` is main's byte for byte.

**Semantic: one.** On the raw merge, `verify:page-archetypes` failed 3 of 250 checks:

- the business pin of `src/app/api/document-pdf/[type]/[id]/route.ts` (group 4);
- the whole-`src` freezes of groups 16 and 17.

All three hash the route as 1bfdbbf left it, and PR #7 changed it. The other 20 `verify:static` verifiers passed
unchanged on the raw merge. CI does not run `verify:static`, so CI alone would not have shown this.

### Resolution (`df0f9be`)

The verifier's rule for approved changes is no blanket re-baseline. An approved hunk is recorded byte for byte and undone
wherever older pins read the file; C8 did this with `D2_EDITS`, `DT_EDITS` and `FIN_EDITS`. The integration applies the
same rule to main's change:

- `MAIN_EDITS` holds PR #7's single hunk, `[1bfdbbf text, main text]`.
- `frozen(f)` reads files for every byte-identity hash: the business pins, the pinned directories, and groups 16 and 17.
  It returns the PDF route with PR #7's hunk undone. Content checks still read the file as it is.
- Group 18 requires three things:
  - the hunk appears exactly once;
  - its earlier form appears nowhere;
  - the route with the hunk undone equals its business pin, `6d3dc7899981d148`.

`verify/page-archetype-pins.json` is unchanged. Result: 251/251 (groups 1–17: 250, unchanged; group 18: 1).

**Mutations on the integrated tree: 11 / 11 caught.** Each was restored byte for byte.

| Mutation | Fails |
|---|---|
| PR #7 reverted (the route back to `request.nextUrl.origin`) | Group 18 only; without it the revert would pass silently |
| The origin hard-coded to `https://localhost:3200` | 4, 16, 17, 18 |
| `.trim()` dropped, the trailing-slash pattern weakened, or the fallback replaced | 4, 16, 17, 18 each |
| Tenant scope weakened (the org taken from the query string), or `requireSession()` removed | 4, 16, 17, 18 each |
| The hunk duplicated | 4, 16, 17, 18 |
| `src/lib/pdf/document-pdf.ts` changed (`--ignore-certificate-errors`) | 4, 16, 17 |
| `src/proxy.ts` changed | 4, 16, 17 |
| An unpinned file (`src/lib/utils.ts`) changed | 16, 17 |

## Verification of the integrated tree

Target: `df0f9be`, Next.js 16.4.3, Node 22. Builds were normal and unmocked.

| Gate | Result |
|---|---|
| `npm ci` | exit 0 |
| `tsc --noEmit` | exit 0 |
| ESLint `--max-warnings=0` | 0 problems: on `src` (CI's run) and on the 97 code files changed against main |
| `npm audit` | 0 critical, 0 high, 6 moderate (main's); `--audit-level=high` exit 0 |
| Security suite | crypto 18/18; access control 22/22 |
| `verify:static` (21 verifiers) | exit 0. Page archetypes 251/251; every other count as in C8 final (role matrix 32/32 … document form 77/77 … provider harness 302/302) |
| `verify:server` | exit 0: 23 suites, plus the DB hardening check (both append-only triggers) |
| Page-archetype runtime | 157/157. The `--measure-out` record differs from the C8 final record in 0 values; that covers every P&L, Balance Sheet, project, report and statement figure |
| Screenshots: the five C8 sets (EN / AR, light / dark, 1440 / 1024 / 768 / 390) | 1,134 / 1,134 byte-identical to the approved C8 final capture (256 256/256, shell 44/44, lists 210/210, documents 134/134, archetypes 490/490) |
| Print / export evidence | 79 / 80 byte-identical, including all 48 exports. The 80th is `look/pl-search__ar__light__1440.png`; see the note below the table |
| Security route probe | 82 routes; anonymous and forged sessions go to `/login` (login and register stay open; the forged cookie is cleared). Identical to the OPS-SEC record; no secret value in the build output |
| Browser tier (49 suites) | 49 / 49. Every per-suite verdict and count matches the OPS-SEC integration tier. These include Staff runtime 20/20 and replay 9/9, registration currency 20/20, account Arabic 34/34, the three hydration suites, document form 188/188, edit e2e 218/218, DataTable 132/132, controls 302/302, PDF branding 15/15 and private storage 22/22 |

The 80th evidence file differs in 9 pixels, by 1/255 each (card-corner anti-aliasing; 0 at 1 % fuzz). It is
byte-identical to the earlier OPS-SEC integration capture. A control run without the UI commits reproduced it there; it
is noise from a timing-sensitive capture.

## PDF render origin (PR #7) on the integrated build

The probe ran `next start` on 127.0.0.1:3211 against a fresh TEST-only seed copy, with the seed owner's session, and
requested `GET /api/document-pdf/invoice/1`:

| `PDF_RENDER_ORIGIN` | Plain loopback | Forwarded as the VPS's Nginx does (`Host: localhost:3211`, `X-Forwarded-Proto: https`) | No session | Another tenant's session |
|---|---|---|---|---|
| `http://127.0.0.1:3211` (the VPS setting) | 200, PDF, 1 page, INV-0001 | **200, PDF, 1 page, INV-0001** | 307 → `/login` | 404 "Document not found." |
| unset (every other environment) | 200, PDF | **500: `net::ERR_SSL_PROTOCOL_ERROR at https://localhost:3211/print/invoice/1`** (the VPS failure, reproduced as the control) | 307 → `/login` | — |
| `"  http://127.0.0.1:3211/  "` | 200, PDF | 200, PDF | 307 → `/login` | — |

## Database round trips

These are measured, not estimated.

**Method:**
- `next start` ran with a preloaded hook that counts the app's `pg` `query()` and `connect()` calls.
- Requests used the seed owner's session over plain HTTP, with no client-side prefetch.
- 60 routes, each requested three times:
  - 53 of the runtime verifier's 54 DEV-UI-01.7 routes (all but the client not-found state);
  - the P&L and the Balance Sheet;
  - the invoice list, detail and print page;
  - the P&L and Balance Sheet CSV exports.
- Both main `32702c3` and the integrated tree ran this way, each with its own build and a fresh TEST-only seed copy.

**Results:**
- **Status and counts:** 180 / 180 requests return the same status with the same number of database round trips. Each
  side issued 2,134 queries in all (711 / 711 on the warm run).
- **SQL:** 180 / 180 issue the same SQL statements. Their order differs on 48; it differs just as often between two runs
  of the same build, because the queries run concurrently.
- **Examples (warm run):** Dashboard 38 / 38, client detail 18 / 18, project detail 28 / 28, P&L 12 / 12, Balance Sheet
  13 / 13, Presets 34 / 34, P&L CSV export 6 / 6.

The integration adds no database round trip and changes no query; no speed-up is claimed.

The code diff agrees:
- The UI changes add no database, `fetch`, cache or `Promise.all` call.
- Their only two new `await`s are `getLocale()`, which reads a cookie.

## Secret scanning

The scans used gitleaks 8.24.3 with the repository's `.gitleaks.toml` and `--redact`, through `df0f9be`.

- **The PR's whole range** (`main..df0f9be`, 11 non-merge commits): the 6 known generic-api-key false positives and
  nothing else. They are in `verify/verify-page-archetypes-runtime.mjs` (strict comparisons of two arrays' lengths), and
  their fingerprints are in the SEC-SCAN-HIST record.
- **The range the CI action scans for this PR** (`--no-merges --first-parent`): 3 commits, 0 findings. The action
  follows first parents, so it does not reach the UI commits behind the integration merge. The scan above covers them.

## Unchanged from main

The following are byte-identical in the integrated tree:

- **Routing and auth:** `src/proxy.ts`; `src/lib/session.ts`, `auth.ts`, `tenant.ts` and `role-matrix.ts`; `src/lib/security/`; every route under `src/app/api/` and `src/app/auth/`; and `src/app/(auth)/`.
- **PDF and print:** `src/lib/pdf/` and `src/app/print/`.
- **Data:** `src/db/`, `drizzle/` and `drizzle.config.ts`.
- **Engines:** the accounting, finance-report, project-costing and settlement engines; the status registry; and the
  shared exporter.
- **Other libraries:** `src/lib/compliance/`, `src/lib/currency/` and `src/lib/rates/`.
- **Build and CI:** `next.config.ts`, `package-lock.json` and `.github/`.

No server-action module changed. Under `src/lib`, only `i18n/dict.ts` and `i18n/format-date.ts` differ from main.

The C8 financial display policy holds on screen, in print and in the exports:

- **P&L:** no profit figure, and the notice.
- **Balance Sheet:** the current-period result is marked Preliminary, with its disclosure.
- **Projects:** the section is Project Revenue & Costs.

There is no accounting, posting, schema or migration change.

## Not verified here

- **Production:** nothing ran on the VPS, against Neon, or behind the production Nginx. The proxy shape was reproduced on
  loopback only.
- **Chromium:** PDF rendering used this environment's Chromium 141 through `CHROMIUM_EXECUTABLE_PATH`, not the VPS's
  Chrome.
- **Timings:** they were taken against a local database and say nothing about production latency. The database
  comparison counts round trips only.
- **Open items** carried from `c8-final-release-gate.md`:
  - COGS and inventory valuation;
  - the shared exporter's Arabic and long-cell PDF limits;
  - the deferred UI debt;
  - the controls suite's intermittent first-navigation timeout.
