# Pre-DEV-UI-01.7 (P0.2) — business-date determinism

Base: main `c000a15` (tree `eebb2de`, the P0.1 merge). Branch
`claude/pre-dev-ui-01-7-business-date-determinism`. A standalone prerequisite correction, separate
from the DEV-UI-01.7 implementation branch. P0 (`ar-locale-determinism.md`) and P0.1
(`timezone-determinism.md`) are unchanged. **DEV-UI-01.7 C0 has not started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases
on localhost, with no repository `.env`. Nothing touched production; nothing was deployed.

## The two defects (found in P0.1, confirmed by independent review)
### A. Credit Notes / Debit Notes "This Month"
`cn-list-client.tsx` and `dn-list-client.tsx` — hydrated client components — counted
`new Date(r.issueDate)` whose `getFullYear()` / `getMonth()` matched the client's own `new Date()`.
Two faults in one line:
- **Hydration.** The server counts in its zone (UTC), the browser in its own. A browser east of
  UTC turns the month 3 h (Riyadh) / 6 h (Dhaka) before the server does; the count changes during
  hydration and React rejects the page (#418).
- **Date-only semantics.** `issueDate` is a calendar date. `new Date("YYYY-MM-01")` is UTC
  midnight, which west of UTC (New York) is still the last day of the previous month — the note
  moves to another month just by being read through the runtime's calendar.

### B. Date-only `addDays`
`sales/_shared/validity-days-dialog.tsx` (Valid Till, also used by the quotation form's
auto-computed Valid Till) and `sales/_shared/date-settings-dialog.tsx` (sales-order and
purchase-order Expected Delivery) each did:

    const d = new Date(isoDate + "T00:00:00"); // LOCAL midnight
    d.setDate(d.getDate() + days);              // local calendar
    return d.toISOString().slice(0, 10);       // written back in UTC

Ahead of UTC, local midnight is the previous day in UTC: in Riyadh and Dhaka `2026-10-09` + 30
days was **2026-11-07**, and `+ 0` was the day before. The server actions store the client's date
verbatim (`validUntil: input.validUntil || null`, `expectedDate: input.expectedDate || null`), so
that wrong date is what quotations, sales orders and purchase orders saved.

## Locked semantics
### "This Month" — the server's UTC month
- The page (a Server Component) decides the month once per render:
  `currentMonthKey={new Date().toISOString().slice(0, 7)}` — "YYYY-MM", UTC.
- The list compares text: `r.issueDate.slice(0, 7) === currentMonthKey`. The hydrated component
  creates no Date: no browser clock, no browser or host zone, no `navigator`, no locale, no Riyadh.
- Temporary contract until Elite ERP has an organisation / business time zone; that setting can
  replace the key's source in the two pages without touching the comparison.

### Date-only arithmetic — calendar days
- `YYYY-MM-DD + N days` is calendar arithmetic: `src/lib/date-only.ts` `addDays` reads the date at
  UTC midnight (`T00:00:00Z`) and moves it with the UTC calendar (`setUTCDate(getUTCDate() + N)`).
  The result is the same in every browser, Node or host zone and locale — 2026-10-09 + 30 is
  2026-11-08 everywhere.
- Unchanged fallback: an unparseable date comes back as given (`""` → `""`).
- One helper instead of two copies: both dialogs import it; `validity-days-dialog.tsx` re-exports
  it, so the quotation form's import is untouched. The invoice form's own due-date helper was
  already this exact UTC pattern (`T00:00:00Z` + `setUTCDate`) and is deliberately left alone.

## Audit (read-only, before the change)
Searched under `src/`: `getMonth` / `getFullYear` / `getDate` / `setDate` and the other
local-calendar accessors, `T00:00:00` parsing, `new Date(YYYY-MM-DD)`, `toISOString().slice(0, 10)`,
functions named `addDays` / `daysBetween` / `todayIso` / `ymd`, current-month / current-year
logic, and business-date comparisons through `Date`.

| # | Location | What | Runs | Class | Action |
|---|---|---|---|---|---|
| 1 | `sales/credit-notes/cn-list-client.tsx:72–78` | "This Month": local `getFullYear` / `getMonth` vs the client's `new Date()` | client, SSR + hydration | **A** | fixed |
| 2 | `purchasing/debit-notes/dn-list-client.tsx:72–78` | same | client, SSR + hydration | **A** | fixed |
| 3 | `sales/_shared/validity-days-dialog.tsx:82–87` `addDays` (exported; quotation Valid Till + dialog preview) | local-midnight parse, `setDate`, `toISOString` | client, SSR + hydration (input value) + dialog | **A** | fixed (shared helper) |
| 4 | `sales/_shared/date-settings-dialog.tsx:67–72` `addDays` (SO / PO Expected Delivery) | same | client (dialog) | **A** | fixed (shared helper) |
| 5 | `hr/payroll/page.tsx:16–18` | payroll period from local `getMonth` / `getFullYear` | server | **B** | deferred |
| 6 | `lib/dashboard-range.ts` `resolveRange` / `rangeBuckets` / `fmt` / `addDays` | local getters, local-midnight parse, `new Date(y, m, d)` | server only (the client toolbar imports only constants) | **B** | deferred |
| 7 | `dashboard/_shared/queries.ts:229–230` `getRecentActivity` | range bounds `new Date(start + "T00:00:00")` (local midnight) | server | **B** | deferred — newly located, part of the dashboard-range behaviour |
| 8 | `hr/attendance/actions.ts:38`, `hr/attendance/page.tsx:16` | check-in time / late cut-off in host time | server | **B** | deferred |
| 9 | `sales/invoices/invoice-form.tsx:62–66` `addDays` | `T00:00:00Z` + `setUTCDate` | client | **C** | unchanged (the reference) |
| 10 | `_shared/duplicate-actions.ts:42–57` `today` / `addDays` / `daysBetween`; `hr/leave/actions.ts:58–66` `datesBetween` | UTC | server actions | **C** | unchanged |
| 11 | `lib/finance-reports.ts`, `lib/statements.ts`, `finance/reports/reports-workspace.tsx`, `finance/statements/statement-view.tsx`, `lib/import/dates.ts` | `Date.UTC`, `getUTC*`, `T00:00:00Z` | client and server | **C** | unchanged |
| 12 | `documents/_workspace/use-list-filters.ts:25–27`; `dashboard/_shared/queries.ts:130, 153, 179` | "YYYY-MM-DD" string comparisons (filters, overdue) | client / server | **C** | unchanged |
| 13 | `new Date().toISOString().slice(0, 10)` "today" defaults (16 client forms and dialogs, attendance / employees / duplicate) | UTC date | client and server | **C** | unchanged (UTC "today" semantics deferred) |
| 14 | print `${issueDate}T00:00:00Z` (ZATCA QR); print `fmtDate` | UTC / string split | server | **C** | unchanged |
| 15 | Security / Compliance formatters (P0.1); dashboard activity time, attendance date pill, payroll title month (01.7) | timestamps / display | client / server | **D** | governed by P0.1 / 01.7 |

Classes: **A** the confirmed defect, included; **B** server-only, zone-dependent business
semantics, not part of these defects; **C** already deterministic UTC / date-only logic; **D**
timestamp or display logic governed by P0 / P0.1 / 01.7.

## Change
| File | Change |
|---|---|
| `src/lib/date-only.ts` (new) | `addDays(isoDate, days)` — UTC calendar arithmetic, documented |
| `sales/_shared/date-settings-dialog.tsx` | imports the helper; its local copy removed |
| `sales/_shared/validity-days-dialog.tsx` | imports and re-exports the helper; its local copy removed |
| `sales/credit-notes/page.tsx`, `purchasing/debit-notes/page.tsx` | pass `currentMonthKey` (UTC "YYYY-MM") |
| `sales/credit-notes/cn-list-client.tsx`, `purchasing/debit-notes/dn-list-client.tsx` | `currentMonthKey` prop; "This Month" = `issueDate.slice(0, 7) === currentMonthKey` |
| `package.json` | `verify:business-dates`, wired into `verify:static` after `verify:date-timezone` |

No other source file changes. The quotation, sales-order, purchase-order and invoice forms are
untouched; so are the list layouts and StatRow.

### Pins
None affected. Neither dialog, nor the list clients, nor their pages are pinned in
`verify/document-form-pins.json`; `src/lib/date-only.ts` sits outside the pinned directories
(`src/lib/currency/**`, `src/lib/pdf/**`). `verify:document-form` 76/76 with every pin
byte-identical.

## New guards
- **`verify:business-dates`** (static, in `verify:static`, 44 checks). Over code that can run in
  the browser — every `"use client"` module plus, in other modules, only the declarations client
  code actually reaches through its imports (so a server-only function in a shared module, such as
  `dashboard-range.ts`'s range helpers, is not mistaken for client code): no local-calendar getter
  or setter on a Date (the TypeScript checker decides what is a Date), no date-time string parsed
  without a zone, no `new Date(y, m, d)`. The two list screens: the page passes the UTC month key;
  the client compares date text and creates no Date. Behaviour: the `addDays` that the quotation
  form, the Valid Till dialog and the date-setting dialog really use — followed through their
  imports — in four child processes (UTC, Asia/Riyadh, America/New_York, Asia/Dhaka, each proved
  in effect): 21 spelled-out cases (the reported 2026-10-09 + 30, zero, month end, year end, leap
  days, negative days, both New York DST changes, and the unparseable-date fallback), identical
  and exact everywhere. 17 detector fixtures.
- **`verify/verify-business-date-hydration.mjs`** (browser tier, 108 checks). A TEST org with
  four credit and four debit notes dated the previous month's last day and the 1st / 15th / last
  day of the current UTC month; every browser's clock pinned to 22:30 UTC on the month's last day
  (still this month in UTC and New York, already next month in Riyadh and Dhaka). Browser zones
  UTC, Asia/Riyadh, America/New_York, Asia/Dhaka × en / ar on both lists: the browser's own
  calendar really disagrees (non-vacuous), no #418, hydrated = JavaScript-disabled server count =
  3, one value in every zone and language. Then in the four zones, Quotation Valid Till and Sales
  Order / Purchase Order Expected Delivery from 2026-10-09 + 30: the dialog preview, the field
  after Apply (and the quotation's auto-computed Valid Till), and the date the saved draft holds
  in the database — 2026-11-08 every time.

## Evidence
### The new guards fail on the old code (`c000a15` + only the two new tests)
- `verify:business-dates`: **FAIL, 29/44.** Named: `cn-list-client.tsx:76` and
  `dn-list-client.tsx:76` (`getFullYear` ×2, `getMonth` ×2 each), both dialogs' `setDate` /
  `getDate` and their `isoDate + "T00:00:00"` local parse; neither page passes a month key. The
  real helpers in Riyadh and Dhaka: 2026-10-09 + 30 → "2026-11-07", + 0 → "2026-10-08",
  2026-01-31 + 1 → "2026-01-31", 2026-12-31 + 1 → "2026-12-31" (UTC and New York correct). All 17
  detector fixtures pass — the detector is sound, the code is not.
- `verify-business-date-hydration`: **FAIL, 52/108.** Every UTC check passes (a UTC browser
  agrees with a UTC server); all 56 failures are non-UTC. "This Month": server "3", Riyadh and
  Dhaka hydrated "0", New York "2" — `Minified React error #418` on both lists in all 12 non-UTC
  page states (Riyadh, New York, Dhaka × en / ar). Riyadh and Dhaka, all three flows: preview
  "2026-10-09 → 2026-11-07", field "2026-11-07" (the quotation's auto-computed Valid Till too) and
  **saved drafts holding 2026-11-07** (6 drafts). New York's flows pass (behind UTC the old
  helper happened to land on the right day). Both cross-zone checks fail.

### The same tests on the corrected code
- `verify:business-dates`: **PASS, 44/44.** `verify-business-date-hydration`: **PASS, 108/108**
  — "This Month" 3 = server = hydrated in all 16 list states, no #418, one value across four
  zones and two languages; the three flows preview, show and save 2026-11-08 in all four zones
  (12 saved drafts checked in the database).
- Mutations of the static guard: **12/12 caught** — the browser's `new Date()` month logic
  restored (Credit Notes; Debit Notes); the server key removed with the client falling back to
  its own clock; the client deriving the month from its own clock instead of the key;
  local-midnight parsing restored in the helper; `setUTCDate` → `setDate`; `getUTCDate` →
  `getDate`; a duplicate unsafe `addDays` added to the purchase-order form; the date-setting
  dialog dropping the helper for its own unsafe copy; a local-calendar `monthKeyOf` added to the
  shared module and used by the Credit Notes list; the helper delegating to a private
  local-calendar `shift()`; a new client component using `new Date(year, month, 1)`. The restored
  tree passes 44/44.

### Verification (isolated worktrees, TEST-only databases, no repository `.env`)
- TypeScript (`tsc --noEmit`) clean; ESLint (changed and new files) clean.
- `npm run verify:static`: exit 0, 20 suites — role matrix 32/32 · confirm policy 62/62 · dirty
  form 66/66 · skeletons 89/89 · contrast 161/161 · typography 43/43 · status registry 88/88 ·
  shell 75/75 · controls 110/110 · datatable 69/69 · **document form 76/76** · edit action 59/59
  · store model 69/69 · provider harness 302/302 · backup claims 26/26 · money precision 12/12 ·
  **number locale 29/29** · **date timezone 38/38** · **business dates 44/44** · ledger-only
  balances 8/8.
- `npm run verify:server`: exit 0, 24 suites (credit-note release 40/40, note FX 40/40,
  statements 70/70, document import 339/339, settlement 29/29, payment reversal 55/55, … DB
  hardening).
- Full browser tier, fresh build: **49/49 suites** — the new suite 108/108, **P0
  `verify-ar-locale-hydration` 169/169**, **P0.1 `verify-settings-timezone-hydration` 85/85**,
  datatable runtime 130/130 (the Credit / Debit Notes lists among them), favorites 20/20,
  skeleton runtime 11/11, document-form runtime 188/188 (all eight create forms), edit-e2e
  218/218, edit, draft buttons, draft func, duplicate 40/40, dirty core 72/72, dirty UI 8/8,
  vendor inline 31/31 (purchase-order form), confirm-e2e 34/34, note currency 19/19.
- Save path: the server actions store the submitted date verbatim; the suite submits real drafts
  through the existing Save as Draft flow and reads `quotations.valid_until`,
  `sales_orders.expected_date` and `purchase_orders.expected_date` back from the TEST database —
  2026-11-08 in all 12 (UTC, Riyadh, New York, Dhaka × three flows); on the old code 2026-11-07 in
  the 6 Riyadh / Dhaka drafts.
- Screenshots (harness build, synthetic seed, server AND browser clocks frozen at 22:30 UTC on
  30 June 2026 — June in UTC, 1 July in Riyadh; notes dated 31 May and 1 / 15 / 30 June):
  Credit Notes list, Debit Notes list, the Sales Order Expected Delivery dialog and the Quotation
  date fields, browser UTC vs Asia/Riyadh. **Before:** Riyadh "This Month" 0 (#418) where UTC
  shows 3; Riyadh preview "2026-10-09 → 2026-11-07" and Valid Till 11/07/2026. **After:** UTC =
  Riyadh byte for byte on all four, and byte-identical to the UTC screenshots before the change —
  no visual drift anywhere else.

## Not changed
No archetype work (PageHeader, SectionHeader, EmptyState, StatRow layout / styling, dashboard and
settings layouts, kanban, headings, responsive work); no profit / margin / marketing-card / trend
work; none of the 01.7 date display surfaces; no organisation or user time-zone setting; no
attendance, payroll-period, dashboard-range or generic "today" changes; no DB / schema /
migrations, Neon, Blob, auth / RBAC, accounting, VAT, stock or journal behaviour; no Nginx,
systemd, VPS or environment variables; no deployment.

### Deferred, unchanged (recorded)
Attendance display time and late cut-off (host zone); payroll period derivation (host zone);
dashboard range resolution and `getRecentActivity` bounds (host zone; local-midnight bounds newly
located at `dashboard/_shared/queries.ts:229–230`); dashboard activity date, attendance date
pill, payroll title month (01.7); UTC "today" defaults.

## Recorded for DEV-UI-01.7 (decided in P0, unchanged and not implemented here)
D-1 … D-9 exactly as recorded in `ar-locale-determinism.md`.
