# DEV-UI-01.7 C0 — foundations, baselines & guardrails

Base: main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50` (tree `e6fce17b50067c22f38bccdd7bc9129b27a94bdf`;
parents `c000a15` and `e9c07e7`). Branch `claude/dev-ui-01-7-page-archetypes`, the long-lived
DEV-UI-01.7 branch for C0–C8. C0 is one commit. It adds three small primitives and two additive
props, records the baseline every later stage is held to, and **migrates no page**.
**DEV-UI-01.7 C1 has not started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env`. Nothing touched production; nothing was deployed.

## Prerequisite chain (closed before C0)

| Correction | Fix | Merge into main |
|---|---|---|
| P0 — Western-digit money (`DISPLAY_NUMBER_LOCALE`) | `45ebb09` | `5b603d6` |
| P0.1 — settings date rendering in UTC (Security / Compliance) | `87455c5` | `c000a15` |
| P0.2 — business dates (CN/DN "This Month", date-only `addDays`) | `e9c07e7` | `1bfdbbf` |

The Stage 1 audit ran on `cfe44c4`, before all three. Its "byte-identical to `cfe44c4`" gate is
superseded: P0–P0.2 changed Arabic money, Security / Compliance times, CN/DN month counts and
computed calendar dates on purpose. **The C0 reference is `1bfdbbf`**, captured fresh (below).

## What changed

| File | Kind | Purpose |
|---|---|---|
| `src/components/ui/section-header.tsx` | new | SectionHeader primitive |
| `src/components/ui/empty-state.tsx` | new | EmptyState primitive |
| `src/lib/i18n/format-date.ts` | new | `formatDisplayDate` |
| `src/components/ui/card.tsx` | additive | CardTitle `as` |
| `src/app/(app)/sales/_shared/stat-row.tsx` | additive | StatRow `value: ReactNode`, `columns` |
| `verify/verify-page-archetypes.mts` | new | static verifier (`verify:page-archetypes`, in `verify:static`) |
| `verify/page-archetype-pins.json` | new | the 1bfdbbf snapshot the static verifier compares against |
| `verify/verify-page-archetypes-runtime.mjs` | new | runtime verifier (`verify:page-archetypes-runtime`) |
| `verify/page-archetype-runtime-baseline.json` | new | the 1bfdbbf runtime baseline (per-state measurements) |
| `verify/page-archetype-actions.json` | new | the 1bfdbbf owner / Staff action inventory |
| `tests/ui-baseline/archetype-states.mjs` | new | the `capture-archetypes` state set and its fixture step |
| `tests/ui-baseline/run.mjs` | additive | `capture-archetypes`; `redirected` compares the route's pathname (query routes) |
| `package.json` | additive | `verify:page-archetypes` (+ in `verify:static`), `verify:page-archetypes-runtime` |
| this document | new | |

No page, layout, consumer component, CSS file, server action, query, schema or migration changed.

## Primitive contracts

### SectionHeader (`src/components/ui/section-header.tsx`)
`{ title; level?: 2 | 3; id?; description?; meta?; actions?; className? }`
- Default `level` 2. Renders a real `<h2>` (`text-title-sm`, 600) or `<h3>` (`text-body-lg`, 600) —
  nothing else can come out: any other level from an untyped caller renders `<h2>`. Never `<h1>`.
- `id` is on the heading (for a caller's `aria-labelledby`). Description (a `<p>`), meta and actions
  sit outside the heading, so the heading holds only the title.
- Flex row with gaps, `flex-wrap`: meta / actions wrap under the title when the row is narrow.
  Logical layout only — no left / right — so it mirrors under `dir="rtl"` by itself.
- Owns no `<section>`, card, landmark, collapse, page title or dashboard widget shell. Imports only
  React and `cn`; no router, pathname, session, route strings or domain props.
- Empty slots (`false`, `""`, `null`, the results of `cond && …`) render nothing; `0` renders.

### EmptyState (`src/components/ui/empty-state.tsx`)
`{ message; hint?; action?; className? }` — the DEV-UI-01.5 list-card surface (`rounded-xl border
border-line bg-surface py-12 px-6`), centred; message `text-body text-ink-muted`, hint
`text-body-sm text-ink-faint`, action centred below. Not a table no-match row, a loading state, a
skeleton or an error state. `ListEmptyState` is untouched (byte-identical) and still serves its 9
lists; neither imports the other.

### formatDisplayDate (`src/lib/i18n/format-date.ts`)
`formatDisplayDate(value: Date | string, locale: Locale, style: "date" | "dateTime" | "monthYear")`
- English `en-US`; Arabic `ar-SA-u-ca-gregory-nu-latn` — Gregorian, Western digits, no Hijri.
- `timeZone: "UTC"` written in every formatter: the ERP has no organisation time zone yet; when it
  gains one it replaces UTC here, in one place.
- No options bag: nothing can override locale, calendar, digits or zone. No runtime inference
  (browser locale, `navigator.language`, `resolvedOptions().timeZone`, host zone, Riyadh).
- An unparseable value formats as `""`.

| style | en | ar | planned consumer |
|---|---|---|---|
| `date` | Jun 15, 2026 | 15 يونيو 2026 | attendance date pill |
| `dateTime` | Jun 15, 2026, 09:00 AM | 15 يونيو 2026، 09:00 ص | dashboard recent activity |
| `monthYear` | June 2026 | يونيو 2026 | payroll period title |

Why these shapes: each reads identically in Node (the server) and in Chromium (the browser), under
any browser locale or zone, so a client component can use it on both sides of hydration. Two
measured traps decided it: Chromium 141's plain `ar-SA` is the Hijri calendar (Node 22 / ICU 78
says Gregorian), and the numeric Arabic date-time pattern differs between them (`15‏/6‏/2026، 9:00:00 ص`
in Node, no `،` in Chromium). The attendance pill and payroll title keep their English text
exactly when they adopt the helper; the dashboard activity's English text will change from
`6/15/2026, 9:00:00 AM` to `Jun 15, 2026, 09:00 AM` when C6 adopts it — C6's decision to record.
The P0.1 Security / Compliance formatters are unchanged.

### CardTitle `as` (`src/components/ui/card.tsx`)
`as?: "div" | "h2" | "h3"`, default `"div"`. Every existing title renders the same `<div
data-slot="card-title" class="text-title-sm font-semibold text-ink">` as before (proved against
markup captured from 1bfdbbf); `as` never reaches the DOM. No consumer passes it in C0.

### StatRow (`src/app/(app)/sales/_shared/stat-row.tsx`, same path)
- `value: React.ReactNode` (a `<Money>` can go in).
- `columns?: 2 | 3 | 4`. Omitted — every caller in C0 — the row is byte-identical to 1bfdbbf (no
  `data-columns`, no style); any other value from an untyped caller falls back to that. Given, the
  row gets `data-columns` and an inline `grid-template-columns` (an inline style because the
  unlayered `.stat-row-2` rule outranks utilities).
- No D-6: `.stat-row-2` is still the one 4-column rule with no responsive variant; the 800 value
  weight, colours, status attributes and `statusStat()` are unchanged. D-6 (C2) owns the responsive
  behaviour and may move the column count into CSS keyed by `data-columns`.

## Static verifier — `npm run verify:page-archetypes` (in `verify:static`)

| Group | Checks | What |
|---|---|---|
| 1. routes | 4 | the 72 page routes, 7 route handlers, 4 layouts, the 36 in-scope pages |
| 2. guards | 6 | per-page guard snapshot; layout guard; owner/admin pages; `/settings/team` redirect; session pages; detail `notFound()` |
| 3. server data sections | 2 | 295 pinned statements across the 36 pages |
| 4. business logic | 2 | 57 business / query / permission / export / server-action files, 8 directories |
| 5. P0 / P0.1 / P0.2 | 15 | 13 contract sections + the three verifiers still wired / present |
| 6. primitives | 43 | APIs, rendered markup, the 1bfdbbf Card / StatRow markup, formatDisplayDate in 18 host zone × locale combinations, consumer inventory, no D-6 |
| 7. no abstraction creep | 3 | banned abstractions absent; primitives route- and domain-blind; no domain props |
| 8. action inventory (static) | 2 | 197 link targets / server actions of the 36 pages |
| **Total** | **77** | **77/77 on C0** |

### Pin strategy (`verify/page-archetype-pins.json`)
Pins protect what composition work must not move, without freezing the markup C1–C7 rewrite:

- **Routes** — sorted lists of every `page.tsx`, `route.ts` and `layout.tsx`, and the 36-page scope.
- **Guards** — from the TypeScript AST of each in-scope page and every layout: each
  `requireSession` / `requireRole` / `getSession` / `redirect` / `notFound` call with its
  arguments, and every expression that reads `session.role`, in the context it is used
  (`isOwner={session.role === "owner"}`, `canDecide = …`). Markup around them may change; these
  may not.
- **Server data sections** — per page, one entry per statement (hash + the start of its code):
  the module's non-markup top-level declarations, the page function's parameters, and every body
  statement **except** markup (any statement containing JSX — so the returned page and JSX built
  before it, e.g. the dashboard's widget map) and display-date formatting (`toLocaleDateString` /
  `toLocaleTimeString` / `formatDisplayDate` initialisers — exactly the lines C2/C6 move onto
  `formatDisplayDate`). Code is compared in canonical form (the TypeScript printer, comments,
  layout and trailing commas normalised), so reformatting does not trip it and a changed query,
  guard or computation does.
- **Business** — byte pins (sha256, 16 hex) of finance reports, statements, project costing,
  accounting, settlement, invoice posting, payment reversal, advance allocations, bank GL / opening,
  base currency, dashboard layout / range / queries, payroll queries, report export, the three export
  route handlers and the other handlers, role matrix, session, tenant, auth, the middleware
  (`src/proxy.ts`), status registry, `date-only.ts`, documents / registry / hrefs, exchange rates, and
  every `"use server"` module under the 01.7 areas (23); directory pins of `src/db`, `drizzle`,
  `src/lib/currency`, `src/lib/pdf`, `src/app/print`, `src/lib/security`, `src/lib/compliance`,
  `src/lib/rates` (same convention as `verify/document-form-pins.json`).
- **Prerequisite contracts** — sections, not files (their files change later in 01.7): P0
  `DISPLAY_NUMBER_LOCALE = "en-US"`, line-item `fmt`, journal totals, ledger balances; P0.1 the
  Security `fmtDateTime` and Compliance `fmtDate`; P0.2 the CN/DN pages' `currentMonthKey`, the
  CN/DN `thisMonthCount` date-text comparison, the Valid Till / Expected Delivery dialogs' import of
  `addDays` from `date-only` and their previews, the quotation form's Valid Till. Each is a hash of
  its canonical code plus the exact expression it must contain.
- **Consumers** — every JSX use of `CardTitle` (4), `StatRow` (9), `ListEmptyState` (9),
  `SectionHeader` (0), `EmptyState` (0) and every importer of `formatDisplayDate` (0). A stage that
  migrates a consumer updates this list on purpose.
- **CSS** — every `.stat-row-2` rule, with its `@media` context (one rule, none responsive).
- **Static actions** — per page, every route literal (`/clients/new`, `/clients/${}`…) and every
  server action imported, through the page's page-local imports (a `"use server"` module is not
  entered).

**Derivation.** `--write-pins` was run on a pristine detached `1bfdbbf` worktree (only the verifier
copied in) and on the C0 tree; the two files are byte-identical. A later stage that changes a pinned
value on purpose re-runs `--write-pins` and its review reads the diff of the pins file.

## Route and guard inventory (1bfdbbf)

72 `page.tsx`; 7 route handlers (`(app)/documents/export`, `(app)/finance/reports/export`,
`(app)/finance/statements/export`, `api/document-pdf/[type]/[id]`, `api/import-template/[module]`,
`auth/clear`, `uploads/[...path]`); 4 layouts — `(app)/layout.tsx` calls `requireSession()` for every
page under it; `(auth)/layout.tsx` sends a signed-in user to `/dashboard`.

| 01.7 page | Guard | Role expressions handed on |
|---|---|---|
| clients, clients/new, vendors, vendors/new, products, finance/* (7), hr/attendance, hr/departments, hr/employees, hr/employees/new, projects, projects/new | `requireSession()` | — |
| clients/[id], hr/employees/[id], inventory/products/[id], projects/[id], purchasing/vendors/[id] | `requireSession()` + `notFound()` (unknown id) | — |
| clients/recycle-bin, purchasing/vendors/recycle-bin, inventory/products/recycle-bin | `requireSession()` | `isOwner={session.role === "owner"}` |
| recycle-bin | `requireSession()` | `isOwner={session.role === "owner"}`; `role: session.role` into the permanent-delete permission check |
| dashboard | `requireSession()` | `getBaseCurrencyConfirmation(session.orgId, session.role)` |
| hr/leave | `requireSession()` | `canDecide = owner \|\| admin` |
| settings/security | `requireSession()` | `isAdmin = owner \|\| admin` |
| hr/payroll, settings/presets, settings/compliance | `requireRole("owner", "admin")` | — |
| settings/organization (Business Settings) | `requireRole("owner", "admin")` | `currentUserRole={session.role}` |
| settings/team | `redirect("/settings/organization?tab=team")` | — |
| inventory/products/new | none in the page — the `(app)` layout's `requireSession()` | — |

At runtime a Staff member lands on `/dashboard` from Payroll, Business Settings (all three tabs),
Presets, Compliance and `/settings/team`, and opens every other 01.7 route where it is.

## Action inventory — method

Two halves, both pinned:
- **Static** (`verify:page-archetypes`, group 8): route literals and imported server actions per
  page — 197 entries.
- **Runtime** (`verify/page-archetype-actions.json`): in the browser, every link, button, tab, menu
  trigger, combobox and toggle in `<main>` — the outermost interactive element only — as
  `kind | visible name | target | type | state` (state: disabled, `popup=menu|dialog`, selected tab,
  checked). Owner: EN + AR at 1440 and EN at 390 (1212 entries); Staff: EN + AR at 1440 (790).
  Labels are recorded exactly as rendered, in both languages — nothing normalised, translated or
  renamed. It is an order-insensitive multiset per route state; any added or removed entry fails.

## Runtime verifier — `npm run verify:page-archetypes-runtime`

Not a `verify:browser` suite: it starts its own production server on 127.0.0.1:3170 against its own
`devui010_test_only_archetypes` copy of the synthetic seed. It refuses a tree with a `.env`, any
non-`devui010_test_only_*` database or non-loopback host (`tests/ui-baseline/isolation.mjs`),
freezes the server and browser clocks at `2026-06-15T09:00:00Z`, runs the pinned Chromium 141
(version checked against the baseline) with every non-loopback request refused, and checks that the
build it serves is the build on disk. Browsers are realistic and adversarial: English in
America/New_York (en-US), Arabic in Asia/Riyadh (ar-SA), plus a sweep at 1440 in Pacific/Pago_Pago
where the frozen instant is still the previous day.

44 routes cover the 36 pages (report, statement and Settings tab variants, an empty project, an
unknown id): **352 owner states** (× EN/AR × 1440/1024/768/390), **88 Staff** and **88 sweep**
states — 528.

- **Exact** (a stage that changes one on purpose re-baselines with `--write-baseline`): status and
  final path, `lang` / `dir`, the heading outline in `<main>`, the owner and Staff action
  inventories, where Staff land (permissions).
- **May only improve**: page overflow, overflowing elements, distance from one `h1`, heading-level
  skips, tables past the viewport, Arabic-Indic digits, unnamed controls, pointer-only clickables,
  "unsaved changes" prompts on pages nobody typed into, console and page errors, and the Settings
  navigation staying at the inline start once it gets there.
- **Hard**: zero React #418 in every state.
- formatDisplayDate in Chromium under en-US/New York, ar-SA/Riyadh, ar-EG/Pago Pago and
  fr-FR/Kiritimati writes exactly Node's 36 strings.

## Known baseline defects for later stages (1bfdbbf, recorded, not failures)

| Defect | Where (states) | Stage |
|---|---|---|
| No `h1` in `<main>` (page titles are `h3`/`h4`) | 32 of 44 routes (256 states) — every non-master-data page | C1 (D-9 PageHeader), C7 (D-3) |
| Heading-level skip (`h1` → `h3` "Statement of Account") | client / vendor detail, all widths (16) | C1–C3 |
| Page overflow at 390 (EN / AR px) | client detail (65 / 54), chart of accounts and ledger (139 / 122), payroll (57 / 40), Settings organization (92 / —), business (80 / —), team (44 / —), compliance (32 / 0), employees (1 / 0). In Arabic the Settings content runs past the *left* edge, which a page's scroll width cannot register: 16 / 3 / 1 elements beyond the viewport, recorded as overflowing elements | C2–C5 |
| Table reaching past the viewport at 390 | chart of accounts, ledger (EN + AR) | C3 |
| Arabic-Indic digits in Arabic | dashboard recent activity (4 per state), attendance pill, payroll title — the three planned `formatDisplayDate` consumers | C2 / C6 |
| Settings navigation at the inline end in Arabic | Settings organization (all tabs) and `/settings/team`, all widths (16) | C5 (D-7) |
| Controls without a name | client detail / new (6), journal (6), reports (1), employee detail (3) / new (2), project new (2), Settings organization (12) / business (2) | C1–C5 |
| Pointer-only clickables (not keyboard-reachable) | project kanban cards (8), employees department chips (4), journal (1), presets (1) | C3 / C4 |
| "Unsaved changes" prompt on leaving a form nobody typed into | client, vendor and product detail / new (48 states) | out of 01.7 scope unless a stage touches those forms |
| Unknown id renders the not-found page with HTTP 200 | `/clients/999999` (streamed response) | — (recorded) |
| Dashboard profit / margin / expenses, marketing cards, trends | dashboard | C6 (D-1, D-4, D-5) |

Console errors: none in any of the 528 states. React #418: none.

## Screenshots

Step A — reference: a detached worktree at exactly `1bfdbbf` (no app file differs), a TEST template
freshly prepared from that tree's own schema and seed, a fresh run copy per capture, frozen clock,
UTC, pinned Chromium, reduced motion, scale 1: the existing 256-state matrix with the pristine
1bfdbbf harness, and the archetype set with the C0 harness files copied in.
Step B — the C0 worktree, the identical captures.

The archetype set (`node tests/ui-baseline/run.mjs capture-archetypes`): the 15 Stage 1 states —
dashboard, clients list, client detail, empty clients recycle bin, employees, employee detail,
payroll, projects, project kanban, empty kanban, Trial Balance, a statement with a party, ledger,
Settings business, Settings security — × EN/AR × 4 widths in light (120) and × EN/AR at 1440 in dark
(30), full page; plus the 12 interaction states that exist today (department chosen in the
employees filter, keyboard focus on the report picker, a kanban task opened for editing; EN/AR at
1440 and 390), viewport. Not captured, because the page cannot do it yet: choosing a department or
moving / opening a kanban card by keyboard — those arrive with their stages. 162 states.

One fixture step belongs to the archetype set and the runtime verifier, no masking: audit stamps
(`created_at`, `updated_at`, `last_activity_at`, `password_changed_at`) later than the frozen
instant were written by the database's own clock (the login's session and security event; the
seeded chart of accounts, departments, cash account and owner password date) and would print the
real time of the run or of the last re-seed on the Security page. In the run's TEST copy they are
moved to the frozen instant; business dates are untouched. Found by auditing the template for
stamps later than the frozen instant after the first reference capture showed the real seeding time
in "Password — Last changed".

### Results

| Comparison | States | Result |
|---|---|---|
| 256-state matrix, 1bfdbbf → C0 | 256 | **256 byte-identical**, 0 different |
| Archetype set, 1bfdbbf → C0 | 162 | **162 byte-identical**, 0 different |
| Archetype set, C0 run 1 → C0 run 2 (determinism; run 2 on a fresh build and a fresh run DB) | 162 | **162 byte-identical** |
| Archetype set, 1bfdbbf before → after the fixture step | 162 | 152 byte-identical; the 10 Security states differ (password date, the fix) |

Every captured C0 state (256 + 162) answered HTTP 200 with no console error, and none redirected.
Builds: 1bfdbbf `PgIjIMEJJgKSQlPVygFDl`; C0 `1nO-Vq912judYP6loBG6s` (runtime, 256, archetype run 1)
and `WQvmhamj5YaSjgebPCIpl` (archetype run 2). Chromium 141.0.7390.37 throughout.

**Prerequisite-era differences, documented separately (not a C0 gate).** The approved images in
`tests/ui-baseline/baseline/` are DEV-UI-01.0's and were not touched. Against the last pre-P0 capture
of the 256 matrix (DEV-UI-01.6 final), the fresh 1bfdbbf capture is 218 byte-identical and 38
changed — all 38 Arabic (dashboard, client detail, finance reports, project detail, projects list),
money now in Western digits: exactly the split P0 recorded (`../pre-dev-ui-01-7/ar-locale-determinism.md`).
P0.1 and P0.2 change no state of the 256 matrix (Security, Compliance, CN/DN and the date dialogs are
not in it).

The runtime baseline is deterministic too: two independent 1bfdbbf runs wrote byte-identical
`page-archetype-runtime-baseline.json` and `page-archetype-actions.json`, and C0 measures the same
values (29/29).

## Verification

All on the final C0 tree, in isolated worktrees with no `.env`, against `devui010_test_only_*`
databases on 127.0.0.1.

| Run | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint on every changed / new code file (9) | clean |
| `npm run verify:static` (21 suites) | exit 0 — role matrix 32/32, confirm policy 62/62, dirty form 66/66, skeletons 89/89, contrast 161/161, typography 43/43, **status registry 88/88**, **shell 75/75**, **controls 110/110**, **DataTable 69/69**, **document form 76/76**, **edit action 59/59**, store model 69/69, provider harness 302/302, backup claims 26/26, money precision 12/12, **number-locale (P0) 29/29**, **date-timezone (P0.1) 38/38**, **business-dates (P0.2) 44/44**, ledger-only balances 8/8, **page-archetypes 77/77** |
| `npm run verify:server` (24 suites) | exit 0, no failing check (statements 70/70, project costing 50/50, docs import 339/339, …, DB hardening triggers present) |
| `verify:page-archetypes-runtime` | **29/29** against the 1bfdbbf baseline — 528 states, zero React #418 |
| `verify:browser`, full tier | **49/49 suites** — incl. **AR locale hydration (P0) 169/169**, **settings time-zone hydration (P0.1) 85/85**, **business-date hydration (P0.2) 108/108**, shell runtime 341/341, controls runtime 302/302, DataTable runtime 130/130, document-form runtime 188/188, edit e2e 218/218 |
| 256-state matrix, 1bfdbbf → C0 | 256 / 256 byte-identical |
| `capture-archetypes`, 1bfdbbf → C0 | 162 / 162 byte-identical |
| `capture-archetypes` twice on C0 | 162 / 162 byte-identical |

No earlier verifier was changed or weakened; `verify:static` gains one suite.

## Mutations

Each mutation was applied in an isolated worktree, the verifier run, and the tree restored
byte-for-byte (sha256 checked; the verifier green again afterwards).

**Static (`verify:page-archetypes`) — 39 / 39 variants caught, 18 / 18 classes.**

| # | Class | Variants | Caught by |
|---|---|---|---|
| 1 | remove an authenticated route guard | Payroll `requireRole` → `requireSession`; the `(app)` layout loses `requireSession`; Clients loses it | guard snapshot + owner/admin / layout / session checks + data section |
| 2 | alter a pinned server data section | Clients query includes archived rows; ordering changed | data sections |
| 3 | edit a protected business / query file | `finance-reports.ts`; dashboard queries; a 01.7 server action | business pins |
| 4 | add / remove an in-scope route | `clients/archive` added; `hr/leave` removed | routes (+ guards, data, actions for the removal) |
| 5 | alter an existing action target | New Client → `/clients/create`; Recycle Bin → `/recycle-bin` | static action inventory |
| 6 | CardTitle defaults to h2 | default `as` → `"h2"` | 1bfdbbf Card markup; `as` contract |
| 7 | SectionHeader h1 | h1 by default; level 1 allowed | heading checks |
| 8 | pathname / router in SectionHeader | `usePathname()` branching the gap on Settings | imports / route-awareness / layout checks |
| 9 | physical left / right / ml / mr in a new primitive | `ml-auto`; `text-left`; inline `marginRight` | physical-direction checks + markup |
| 10 | EmptyState modifies / replaces ListEmptyState | ListEmptyState rewritten onto EmptyState; its surface edited; a consumer swapped | ListEmptyState pin; consumer inventory |
| 11 | implicit locale in formatDisplayDate | `undefined`; `navigator.language` | written-out locale; no inference; 18-process output |
| 12 | Arabic-Indic digits | `-nu-latn` dropped; plain `ar-SA` | locale check; exact strings; Western digits |
| 13 | remove explicit UTC | `timeZone` removed; `Asia/Riyadh` | explicit UTC; identical output in every host zone |
| 14 | arbitrary StatRow columns | `columns?: number`, guard removed | `columns` type; untyped fallback |
| 15 | StatRow output changes with columns omitted | `data-columns` always; a style always | 1bfdbbf StatRow markup |
| 16 | P0 money contract | `DISPLAY_NUMBER_LOCALE = "ar-SA"`; line-item `fmt` on the runtime locale | P0 contract sections (+ currency dir pin) |
| 17 | P0.1 timezone contract | Security loses `timeZone: "UTC"`; Compliance in Riyadh | P0.1 contract sections |
| 18 | P0.2 date-only / current-month contract | `addDays` on the local calendar; CN "This Month" by the browser's clock; DN month key from the local date; a local `addDays` in the Valid Till dialog | `date-only.ts` pin; P0.2 contract sections |

**Runtime (`verify:page-archetypes-runtime`) — 4 / 4 caught**, one build with all four, each on its
own route so its failure is attributable (21 / 29 checks, then restored):

| Mutation | Caught by |
|---|---|
| New Client → `/clients/create` | owner and Staff action inventories (`- /clients/new`, `+ /clients/create`, EN and AR) |
| Payroll loses `requireRole("owner", "admin")` | permissions (Staff land on `/hr/payroll`, not `/dashboard`), the Staff-redirect check, the Staff action inventory |
| Departments page gets `minWidth: 1200` | page overflow never worse (0 → 24…822 px), overflowing elements never more |
| Projects list renders `new Date().toString()` | zero React #418 (12 states incl. the sweep), page errors never more |

## Out of scope (not done in C0)

PageHeader, SettingsNav, `mockup-parity.css` archetype rules, every page and consumer (master data,
entity detail, HR, projects, kanban, finance / reports, Settings, dashboard), document headings and
any heading hierarchy, existing EmptyState / StatRow / CardTitle consumers; D-1, D-2, D-3, D-4, D-5,
D-6 (C2), D-7 (C5), D-9 (C1). No business, accounting, VAT, stock, journal, report, payroll or
project-costing calculation; no DB / schema / migration; no Neon or Blob; no auth / RBAC, route
behaviour or permission change; no PDF, import / export; no VPS / Nginx / systemd / environment
change; no deployment; no DEV-UI-01.8 debt.
