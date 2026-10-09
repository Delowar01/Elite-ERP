# Pre-DEV-UI-01.7 (P0) — Arabic browser locale, React #418, Western-digit money

Base: main `cfe44c4` (tree `922297a`). Branch `claude/pre-dev-ui-01-7-ar-locale-determinism`.
A standalone prerequisite correction, separate from the DEV-UI-01.7 implementation branch.
**DEV-UI-01.7 C0 has not started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases
on localhost, with no repository `.env`. Nothing touched production; nothing was deployed.

## Symptom (DEV-UI-01.7 Stage 1 audit)
With an **ar-SA browser locale**, React hydration error #418 on 11 routes — dashboard, client
detail, vendor detail, bank accounts, chart of accounts, ledger, journal, reports (P&L, trial
balance, AR aging), payroll, projects, project detail — after which money showed in Arabic-Indic
digits (payroll: 27 text nodes). With an en-US browser locale: 0 console errors in 352 states.

## Root cause
`toLocaleString(undefined, …)` lets the runtime pick the locale. Node takes the host's
`LANG` / `LC_ALL`; a browser takes its UI language. Where the same component renders on the server
and is then hydrated in the browser, the two disagree:

| Location | Runs | Effect before |
|---|---|---|
| `src/lib/currency/currencies.ts` `formatMoneyNumber()` | client components `<Money context="summary">` (`sales/_shared/money.tsx`) and `hr/payroll/payroll-client.tsx`, rendered on the server and hydrated; server components (dashboard KPIs, account ledger rows, project budget pill) | server "13,272" vs ar-SA browser "١٣٬٢٧٢" → **#418**, then the browser's digits. Server output also depended on the host locale (`LC_ALL=ar_SA` → "١٣٬٢٧٢", `de_DE` → "13.272") |
| `src/app/(app)/finance/journal/journal-form.tsx` totals | client component, server-rendered and hydrated | "0.00" vs "٠٫٠٠" → **#418** on `/finance/journal` |
| `src/app/(app)/sales/_shared/totals.ts` `fmt()` | browser only: Record Payment and Apply Advance dialogs, confirmation details | no hydration involved, but an ar-SA browser wrote balances as "٨٬٢٧١٫٣٣" |
| `src/app/(app)/finance/_shared/account-ledger-view.tsx` account balances | server only | output depended on the server host's locale |

The `<Money context="summary">` consumers are exactly the audit's #418 routes; the GL report,
which uses document-context money (`formatAmount`, already explicit), had no #418.

### Every locale-dependent formatting call (read-only audit, before the change)
| Call | Class | Action |
|---|---|---|
| `currencies.ts:457` `formatMoneyNumber` — `toLocaleString(undefined)` | 1 · SSR/client nondeterminism (+ host dependency) | fixed |
| `journal-form.tsx:194, 198` — `toLocaleString(undefined)` | 1 · SSR/client nondeterminism | fixed |
| `totals.ts:54` `fmt` — `toLocaleString(undefined)` | 2 · browser-only, Western-digit violation | fixed |
| `account-ledger-view.tsx:70` — `toLocaleString(undefined)` | server-only host-locale dependency | fixed |
| `currencies.ts:484–499` `formatAmount` / `formatRate` / `formatQuantity` — explicit `en-US` / `en-IN` | 3 · already deterministic (Number Format contract) | unchanged (international grouping now reads the same constant) |
| `dashboard/page.tsx:187`, `hr/attendance/page.tsx:39`, `hr/payroll/page.tsx:19` — dates, explicit `ar-SA` (server components) | 3 · dates, deterministic, Arabic-Indic digits | unchanged — DEV-UI-01.7 `formatDisplayDate`, by decision |
| `hr/attendance/page.tsx:16`, `lib/dashboard-range.ts:134, 144` — dates, explicit `en-US` | 3 · dates | unchanged |
| `settings/security/security-client.tsx:43`, `settings/compliance/compliance-client.tsx:100` — dates, explicit `en-US`, no `timeZone` | 3 · dates (time-zone dependent, see below) | unchanged — out of scope |

No `Intl.NumberFormat`, `toLocaleString()` without arguments or `navigator.language` exists in `src/`.

## Change
`src/lib/currency/currencies.ts` exports `DISPLAY_NUMBER_LOCALE = "en-US"` — what an unconfigured
server already produced — and the four call sites above pass it instead of `undefined`.
`groupingLocale("international")` returns the same constant (output identical). Nothing else:
the fraction-digit options, `moneyDecimals`, `roundMoney`, `computeTotals`, the Indian grouping
(`en-IN`) and every calculation are untouched. 4 source files, 29 lines added, 9 removed.

### Why `totals.ts` changed (a 01.6-pinned file)
`fmt()` is money output in the ERP UI, rendered in the browser; leaving it would keep an
Arabic browser writing balances in Arabic-Indic digits (and a German one with German separators).
Changing the call sites instead would leave a runtime-locale formatter behind for the next caller.
The change is the locale argument only; its contract — the currency's minor unit
(`moneyDecimals("document", currencyCode)`, KWD/BHD/OMR 3, JPY 0) — is unchanged and is asserted
value by value by `verify:number-locale`.

### Pins updated (`verify/document-form-pins.json`) — only these two
| Pin | Before | After |
|---|---|---|
| `src/app/(app)/sales/_shared/totals.ts` | `79eb1e779628705d` | `d4da23202cd65d2e` |
| `src/lib/currency/**` (3 files) | `e42a44dd85676a62` | `f20adbeb2aabb8af` |

Before the update `verify:document-form` failed on exactly these two (74/76), proving both pins
live; the other 46 pins are unchanged.

## New guards
- **`verify:number-locale`** (static, wired into `verify:static`, 29 checks). Bans implicit-locale
  number formatting under `src/` (zero tolerance, names file:line). Runs the real formatters in
  three child processes with host locale `en_US`, `ar_SA` and `de_DE` (and checks that locale was
  in effect): identical strings, Western digits / "," / "." / "-", and equal value by value to the
  en-US contract (summary 0 decimals, document 2, `fmt` at the currency's minor unit, Indian vs
  international grouping, rate/quantity rounding, negatives, half-way rounding) — 122 cases.
- **`verify/verify-ar-locale-hydration.mjs`** (browser tier, 169 checks). Registers a TEST org,
  posts an invoice, a payment, a PO, capital and a salary structure, then opens the 11 routes
  (13 states) under browser `ar-SA` / `en-US` × app `ar` / `en`: no page or console error, no
  Arabic-Indic digits or separators in `<main>` (the two server-formatted DATE strings above
  excepted), hydrated figures equal to a JavaScript-disabled server render; plus the Record
  Payment dialog's balance and amount placeholder.

## Evidence
### The new guards fail on the old code (`cfe44c4` + only the two new tests)
- `verify:number-locale`: **FAIL, 16/29.** Five `toLocaleString(undefined)` call sites named; under
  `LC_ALL=ar_SA` `formatMoneyNumber(13271.58, "summary")` = "١٣٬٢٧٢" and
  `fmt(8271.25, "SAR")` = "٨٬٢٧١٫٢٥"; under `de_DE` "13.272" and "8.271,25". The en_US host
  passes every contract check (that is the old behaviour on an English host), and
  `formatAmount` / `formatRate` / `formatQuantity` pass everywhere (already explicit).
- `verify-ar-locale-hydration`: **FAIL, 87/169.** All 82 failures are the two `ar-SA` browser
  combinations (41 each): `Minified React error #418` on every route, money such as
  `span.num-tabular "١٣٬٢٧٢"` and the journal's `div.v "٠٫٠٠"`, hydrated ≠ server-rendered
  figures, and the Record Payment balance "٨٬٢٧١٫٣٣". Both `en-US` browser combinations passed.

### The same tests on the corrected code
- `verify:number-locale`: **PASS, 29/29.** `verify-ar-locale-hydration`: **PASS, 169/169.**
- English unchanged: the 582 figure strings in the 26 `en-US` browser states are byte-identical
  before and after. In the `ar-SA` states the figures now equal the `en-US` browser's (26/26);
  figure strings with Arabic-Indic digits or separators: 198 → 0.
- Mutations of the new static guard: **10/10 caught** (each call site back to `undefined`, the
  locale switched to `ar-SA`, `navigator.language`, international grouping moved to `de-DE`,
  summary precision 0 → 2, KWD minor unit lost in `fmt`, Indian grouping dropped).

### Verification (isolated worktree, TEST-only databases, no repository `.env`)
- TypeScript (`tsc --noEmit`) clean; ESLint (changed and new files) clean.
- `npm run verify:static`: exit 0, 18 suites — role matrix 32/32 · confirm policy 62/62 · dirty
  form 66/66 · skeletons 89/89 · contrast 161/161 · typography 43/43 · status registry 88/88 ·
  shell 75/75 · controls 110/110 · datatable 69/69 · **document form 76/76** · edit action 59/59 ·
  store model 69/69 · provider harness 302/302 · backup claims 26/26 · money precision 12/12 ·
  **number locale 29/29** · ledger-only balances 8/8.
- `npm run verify:server`: exit 0, 24 suites, among them statements 70/70, project costing 50/50,
  money round trip 44/44, FX reporting 16/16, settlement 29/29, payment reversal 55/55, bank
  opening 18/18, document import 339/339.
- Full browser tier, fresh build: **47/47 suites** — the new suite 169/169, document-form runtime
  188/188, edit-e2e 218/218, payment dialog 28/28, advances 172/172, account Arabic 34/34, FX
  dashboard 6/6, dirty core 72/72, datatable runtime 130/130, shell runtime 341/341.
- Screenshot matrix (`run.mjs capture`, 256 states) against the approved images (01.6 states over
  the 01.5 set): **218 byte-identical, 38 changed**. All 128 EN states identical. Every changed
  state is one of the 40 AR states 01.6 recorded with #418 (dashboard, client detail, finance
  reports, project detail) — money now in Western digits; the other two recorded states
  (projects list, AR, 390, light and dark) are pixel-identical because the only money on that
  page, the Budget column, sits outside the visible part of the table's own scroll box. Console
  errors: 0 in all 256 states (previously 40). Page overflow unchanged (the known
  client-detail / settings-organization / employees states at 390).
- Stage 1 archetype harness, `ar-SA` browser, 44 route states × 1440 / 390: before — #418 on
  14 route states (the 11 routes), errors in 28 states, 244 Arabic-Indic text nodes; after —
  **0 #418, 0 errors**, 12 Arabic-Indic text nodes, all in the three server-formatted DATE
  surfaces left to DEV-UI-01.7 (dashboard activity times, attendance date pill, payroll title).

## Not changed
No archetype work (PageHeader, SectionHeader, EmptyState, StatRow, dashboard grid, settings
navigation, kanban, headings, responsive layouts); no date presentation; no translations; no
business calculations, queries, accounting, VAT, stock, payroll or project-costing logic; no
schema, migrations, Neon, Blob, auth/RBAC, Nginx, systemd, VPS or environment variables; no
deployment.

### Found, not absorbed
`settings/security/security-client.tsx:43` and `settings/compliance/compliance-client.tsx:100`
format dates in client components with an explicit `en-US` locale but no `timeZone`, so the
browser's time zone decides the text. Measured: a browser in Asia/Riyadh against the UTC server
renders "Oct 9, 03:22 PM" where the server wrote "Oct 9, 12:22 PM" → **#418 on
`/settings/security`** (none in a UTC browser). The compliance date (day only) differs only
across midnight. A time-zone date defect — not number locale and outside the audited #418 set —
so it is recorded here for the DEV-UI-01.7 date work rather than changed.

## Recorded for DEV-UI-01.7 (decided, not implemented here)
- **D-1** Dashboard: remove Total Profit, Profit Margin and the fake Total Expenses presentation;
  queries and calculations untouched.
- **D-2** "Hide Profit / Margin until COGS is trustworthy" applies globally: Project Cost &
  Profitability hides Actual Profit, Profit Margin and the profitability-derived health badge
  (keeps Sales Value, Invoiced, Collected, Total Cost and the drill-downs; `project-costing.ts`
  unchanged); the P&L hides the Gross Profit presentation (`finance-reports.ts` unchanged).
  Presentation suppression only.
- **D-3** Document list / detail / editor page titles `h3 → h1` in C7, zero-pixel-diff gate.
- **D-4** Remove the four dashboard marketing / coming-soon cards; keep the factual ZATCA card
  where the country profile enables it.
- **D-5** Remove fake / placeholder dashboard trends and sparklines; keep real Sales and Invoice
  trends.
- **D-6** StatRow two-across at ≤640px; semantic value tones only from the status registry.
- **D-7** Settings navigation stacks above the content below 768px.
- **D-8** This correction.
- **D-9** Evolve `PageHeader` in place; replace the broad `src/components/layout/**` pin with
  narrowed file pins, documented.
