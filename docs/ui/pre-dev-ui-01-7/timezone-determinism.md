# Pre-DEV-UI-01.7 (P0.1) — time-zone / date hydration determinism

Base: main `5b603d6` (tree `4824c55`, the P0 merge). Branch
`claude/pre-dev-ui-01-7-timezone-determinism`. A standalone prerequisite correction, separate from
the DEV-UI-01.7 implementation branch. P0 (`ar-locale-determinism.md`) is unchanged.
**DEV-UI-01.7 C0 has not started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases
on localhost, with no repository `.env`. Nothing touched production; nothing was deployed.

## Symptom (found during P0, recorded there as "found, not absorbed")
A browser in Asia/Riyadh against the UTC server: React hydration error #418 on
`/settings/security` — the server wrote "Oct 9, 12:22 PM", the browser "Oct 9, 03:22 PM". The
Compliance Center's consent dates (day only) differ the same way whenever an instant falls on a
different calendar day in the browser's zone than in UTC.

## Root cause
Both screens are client components. A client component renders twice: on the server, then in the
browser to hydrate. Their formatters named a locale but no time zone, so each run used its own:

| Location | Formatter | Rendered where |
|---|---|---|
| `settings/security/security-client.tsx` `fmtDateTime` | `toLocaleString("en-US", { month, day, hour, minute })` | "Last changed …" (password), Active Sessions "Signed in" / "Last active", Security Timeline "When" |
| `settings/compliance/compliance-client.tsx` `fmtDate` | `toLocaleString("en-US", { month, day, year })` | consent records "Date" |

The server runs in UTC, so its HTML always carried the UTC reading. Any browser outside UTC
computed another string, React rejected the text (#418), discarded the server HTML and re-rendered
the page in the browser's zone. Example instants: 23:30 UTC is the next day in Riyadh (+3) and
Dhaka (+6); 00:30 UTC is still the previous day in New York (−4).

## Display contract — UTC, named explicitly
- These Security Center and Compliance Center timestamps are formatted with `timeZone: "UTC"`.
- **Why UTC.** It is what the server always rendered — the first paint, every JavaScript-disabled
  load and every UTC browser already showed exactly these strings — so the English copy does not
  change. It depends on no runtime. It needs no new preference and infers nothing.
- **Never** the browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.*`),
  the host's (`process.env.TZ`, the Node default) or a conversion to Asia/Riyadh.
- **No visible "UTC" suffix.** It is not needed for determinism and would change the English
  copy. What changes for a user outside UTC: before, after the #418 recovery, these cells showed
  the browser's local time; now they show the UTC reading the server always sent. Labelling the
  zone, or an organisation / user time-zone preference, is a product decision left to DEV-UI-01.7
  (`formatDisplayDate`) — not taken here.
- **The rule for client-side code** (enforced by `verify:date-timezone`): every date formatter in
  a `"use client"` module, or in a module one imports, passes `timeZone: "UTC"` written as that
  literal. Server components are outside the rule — they format once, on the server, and the
  browser receives finished text.

## Audit (read-only, before the change)
Searched under `src/`: `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`,
`Intl.DateTimeFormat` (none exists), `toString` / `toDateString` / `toTimeString`, local-time
getters, every `"use client"` module (163) and the 64 modules they import.

| # | Location | Expression | Runs | Class | Action |
|---|---|---|---|---|---|
| 1 | `settings/security/security-client.tsx:43` `fmtDateTime` | `toLocaleString("en-US", {month, day, hour, minute})`, no zone | client: SSR + hydration | **A** | fixed |
| 2 | `settings/compliance/compliance-client.tsx:100` `fmtDate` | `toLocaleString("en-US", {month, day, year})`, no zone | client: SSR + hydration | **A** | fixed |
| 3 | `sales/credit-notes/cn-list-client.tsx:72–78` `thisMonthCount` | `new Date(issueDate)` + `getFullYear()` / `getMonth()` against `new Date()` | client: SSR + hydration (StatRow "This Month") | **A** — date bucketing, not a formatter | found, not absorbed |
| 4 | `purchasing/debit-notes/dn-list-client.tsx:72–78` `thisMonthCount` | same | same | **A** | found, not absorbed |
| 5 | `sales/_shared/validity-days-dialog.tsx:83` `addDays` → `quotations/quotation-form.tsx:132` Valid Till | parse at local midnight, `setDate`, `toISOString` | client: SSR + hydration (an `<input value>`, so no #418) and the dialog preview | **A** — business date arithmetic | found, not absorbed |
| 6 | `sales/_shared/date-settings-dialog.tsx:67` `addDays` (sales order, purchase order) | same | browser only (dialog) | **B** | found, not absorbed |
| 7 | `hr/attendance/page.tsx:16` `fmtTime` | `toLocaleTimeString("en-US", {hour, minute, hour12})`, no zone | server only | **B** (host zone) | unchanged |
| 8 | `hr/attendance/actions.ts:38` | `toTimeString().slice(0, 5)` against the late cut-off | server action | **B** (host zone; attendance rule) | unchanged |
| 9 | `hr/payroll/page.tsx:17–18` | `getMonth()` / `getFullYear()` → payroll period | server only | **B** (host zone; payroll) | unchanged |
| 10 | `lib/dashboard-range.ts` `resolveRange` / `rangeBuckets` | local getters, `toLocaleDateString("en-US")`, no zone | server only (dashboard page, queries); the client toolbar imports only the range constants | **B** (host zone) | unchanged — a re-proved server-only exception in the guard |
| 11 | `dashboard/page.tsx:187` activity time | `toLocaleString("ar-SA" / "en-US")` | server only | **D** | unchanged (01.7) |
| 12 | `hr/attendance/page.tsx:39` date pill | `toLocaleDateString("ar-SA" / "en-US", …)` | server only | **D** | unchanged (01.7) |
| 13 | `hr/payroll/page.tsx:19` title month | `toLocaleDateString("ar-SA" / "en-US", {month: "long", year})` | server only | **D** | unchanged (01.7) |
| — | `new Date().toISOString().slice(0, 10)` "today" defaults (16 client forms and dialogs); `invoice-form.tsx:62–66` due date (`…T00:00:00Z`, `setUTCDate`); `reports-workspace.tsx`, `statement-view.tsx`, `lib/statements.ts`, `lib/finance-reports.ts`, `lib/import/dates.ts` (`Date.UTC`, `getUTC*`); `notifications-menu.tsx` `timeAgo` (epoch difference, dropdown only); print `fmtDate` (string split) | — | client and server | **C** | unchanged |

Classes: **A** SSR/client nondeterministic (implicit zone); **B** server-only or browser-only but
zone-dependent; **C** already deterministic; **D** the three 01.7 date surfaces.

## Change
`timeZone: "UTC"` added to the two formatters, with a two-line comment pointing here. 2 source
files, 6 lines added, 2 removed. No other source file changes. `DISPLAY_NUMBER_LOCALE` and every
P0 money contract are untouched; no pin changes (neither file is pinned).

## New guards
- **`verify:date-timezone`** (static, wired into `verify:static` after `verify:number-locale`,
  38 checks). Builds the client module graph (every `"use client"` module plus, transitively, what
  it imports; `"use server"` modules are not followed) and, with the TypeScript checker deciding
  which receivers are Dates, requires every date formatter there — `toLocaleString` on a Date,
  `toLocaleDateString`, `toLocaleTimeString`, `Intl.DateTimeFormat` — to pass an options object
  literal with `timeZone: "UTC"`; bans `Date#toString` / `toDateString` / `toTimeString` and Dates
  interpolated into strings there; names file:line. Number formatting is never mistaken for a date.
  One server-only exception (`dashboard-range.ts` `rangeBuckets`) is re-proved on every run: no
  client module imports it and nothing in its module calls it. Then runs every client formatter,
  with its own locale and options, in four child processes with `TZ` = UTC, Asia/Riyadh,
  America/New_York, Asia/Dhaka (proving each zone was in effect) for instants either side of
  midnight UTC: identical strings, equal to the UTC readings. Finally 17 detector fixtures (what
  must be flagged and what must not: number formatting, server-only modules, server actions).
- **`verify/verify-settings-timezone-hydration.mjs`** (browser tier, 85 checks). Registers a TEST
  org and writes the owner's password-change time, one session, two security events and two
  consent records 30 minutes either side of midnight UTC two days ago. For browser zones UTC,
  Asia/Riyadh, America/New_York, Asia/Dhaka × app en (en-US browser) / ar (ar-SA browser): the
  browser really is in that zone (it would print another hour and another calendar day by itself);
  `dir` ltr / rtl; on both pages no page or console error (no #418); every seeded timestamp
  hydrates to exactly the JavaScript-disabled server text, and that text is the UTC reading
  (spelled out without Intl); English headings unchanged. Then per page and language: identical
  strings in all four zones.

## Evidence
### The new guards fail on the old code (`5b603d6` + only the two new tests)
- `verify:date-timezone`: **FAIL, 30/38.** Both formatters named ("no timeZone"). In the child
  processes, 23:30 UTC through the Security Center's format reads UTC "Oct 8, 11:30 PM", Riyadh
  "Oct 9, 02:30 AM", New York "Oct 8, 07:30 PM", Dhaka "Oct 9, 05:30 AM"; the consent date reads
  "Oct 9, 2026" in Riyadh and Dhaka for 23:30 UTC on 8 October and "Oct 8, 2026" in New York for
  00:30 UTC on 9 October. All 17 detector fixtures pass — the detector is sound, the code is not.
- `verify-settings-timezone-hydration`: **FAIL, 45/85.** All 40 failures are the six non-UTC
  states (Riyadh, New York, Dhaka × en / ar): `Minified React error #418` on both pages in all six
  (12 of 12 page states); hydrated ≠ server text (server "Oct 6, 11:30 PM", Riyadh "Oct 7, 02:30
  AM", New York "Oct 6, 07:30 PM"; New York consent "Oct 6, 2026" where the server wrote "Oct 7,
  2026"); not the UTC reading; and the four cross-zone checks. Both UTC states pass — a UTC
  browser agrees with a UTC server, which is why the defect never showed in the existing suites.

### The same tests on the corrected code
- `verify:date-timezone`: **PASS, 38/38.** `verify-settings-timezone-hydration`: **PASS, 85/85**
  — no #418 in any of the 16 page states; server text = hydrated text = UTC reading; one set of
  strings in UTC, Asia/Riyadh, America/New_York and Asia/Dhaka for both pages in both languages;
  `dir` ltr / rtl; English headings and the "Last changed" label unchanged.
- English copy unchanged: the corrected strings are exactly what a UTC server already rendered
  ("Oct 8, 11:30 PM", "Oct 9, 2026" …), asserted value by value in both guards.
- Mutations of the static guard: **13/13 caught** — `timeZone` removed (Security, Compliance);
  the browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, directly and through a
  default parameter); the host's zone (`process.env.TZ`); a conversion to `"Asia/Riyadh"`; a new
  client component file with a zone-less formatter; a zone-less formatter added to an existing
  client component (notifications menu), to a shared module imported by client components
  (`lib/utils.ts`), and as `Intl.DateTimeFormat`; a Date known only by its type formatted with no
  options; `Date#toDateString`; a client import of `rangeBuckets` (breaks the server-only
  exception). The restored tree passes 38/38.

### Verification (isolated worktrees, TEST-only databases, no repository `.env`)
- TypeScript (`tsc --noEmit`) clean; ESLint (changed and new files) clean.
- `npm run verify:static`: exit 0, 19 suites — role matrix 32/32 · confirm policy 62/62 · dirty
  form 66/66 · skeletons 89/89 · contrast 161/161 · typography 43/43 · status registry 88/88 ·
  shell 75/75 · controls 110/110 · datatable 69/69 · document form 76/76 · edit action 59/59 ·
  store model 69/69 · provider harness 302/302 · backup claims 26/26 · money precision 12/12 ·
  **number locale 29/29** · **date timezone 38/38** · ledger-only balances 8/8.
- `npm run verify:server`: exit 0, 24 suites (statements 70/70, project costing 50/50, document
  import 339/339, exchange rates 57/57, money round trip 44/44, settlement 29/29, payment
  reversal 55/55, … DB hardening).
- Full browser tier, fresh build: **48/48 suites** — the new suite 85/85, **P0's
  `verify-ar-locale-hydration` 169/169**, compliance claims, staff runtime 20/20 and staff replay
  9/9 (owner / admin gating unchanged: staff are still redirected from the Compliance Center),
  controls runtime 302/302, shell runtime 341/341, edit-e2e 218/218, document-form runtime
  188/188, datatable runtime 130/130.
- Screenshots (harness build, synthetic seed, frozen clock, server in UTC; the same
  near-midnight fixture; the two rows the harness login itself writes, which carry the run's real
  time, are masked): Security Center and Compliance Center, en and ar, browser UTC and
  Asia/Riyadh. **Before:** UTC ≠ Riyadh on all four page × language pairs, #418 in each Riyadh
  state, the Riyadh page re-rendered in Riyadh time ("Last changed Oct 7, 02:30 AM"; consent
  "Oct 7, 2026" where the server wrote "Oct 6, 2026"). **After:** UTC = Riyadh byte for byte on
  all four, no errors — and identical byte for byte to the UTC screenshots before the change, so
  nothing a UTC reader sees moved.
- Sweep of the 44 DEV-UI-01.7 archetype routes × browser zones UTC / Asia/Riyadh /
  America/New_York / Asia/Dhaka × app en / ar (352 states, same harness): **#418 before 12
  (exactly `/settings/security` and `/settings/compliance` in the three non-UTC zones, both
  languages) → after 0.** No non-200 responses. The only other console lines, 48 in both runs, are
  Chrome's "Blocked attempt to show a 'beforeunload' confirmation panel", logged when the sweep
  navigates straight on from the client, vendor and product detail and "new" forms (their
  unsaved-changes guard) — a sweep artefact, identical before and after.

## Not changed
No archetype work (PageHeader, SectionHeader, EmptyState, StatRow, archetype layouts, dashboard
grid, settings navigation / layout, kanban, headings, responsive fixes); no dashboard, project or
P&L profit presentation, marketing cards or trends; none of the three 01.7 date surfaces; no
translations; no business calculations, accounting, VAT, stock, payroll or project costing; no
schema, migrations, Neon, Blob, auth / RBAC, Nginx, systemd, VPS or environment variables; no
deployment.

### Found, not absorbed
- **Credit-note and debit-note lists, "This Month" — class A, a live #418.**
  `sales/credit-notes/cn-list-client.tsx:72–78` and `purchasing/debit-notes/dn-list-client.tsx:72–78`
  count this month's notes with local-time getters in a client component. `new Date("YYYY-MM-01")`
  is the previous month anywhere west of UTC, and a browser east of UTC reaches the next month
  3 h (Riyadh) / 6 h (Dhaka) before the server does. Measured on the corrected build (synthetic
  seed, clock frozen at 2026-06-15, one note dated 2026-06-01): server "1", New York browser "0"
  and **#418 on both lists**; UTC and Riyadh agree at that instant. Not a formatter, and fixing it
  means deciding which month "This Month" is (UTC, the organisation's, the user's) — a business
  decision, so recorded here, not changed. When it is fixed, `verify:date-timezone` can extend to
  local-time getters in client code.
- **Valid Till / date-settings dialogs one day early east of UTC — classes A / B, business date
  arithmetic.** `addDays` (`sales/_shared/validity-days-dialog.tsx:83`,
  `sales/_shared/date-settings-dialog.tsx:67`) parses the date at LOCAL midnight and then takes
  the UTC date: in Riyadh or Dhaka `addDays("2026-10-09", 30)` is "2026-11-07", not "2026-11-08",
  and `addDays(d, 0)` is the day before. The quotation form derives Valid Till from it at render
  and saves that value; the sales-order and purchase-order date dialogs apply it. Correct in UTC
  and to the west. Recommended as its own correction (parse with `T00:00:00Z`, as
  `invoice-form.tsx` already does).
- **Server-side host-zone dependencies — class B.** Attendance check-in / check-out times and the
  late cut-off, the payroll period, the dashboard date ranges and the three D surfaces follow the
  server host's zone: deterministic per deployment (UTC on Vercel's default and in the test
  harness) and never a hydration hazard, but they would move on a host set to another zone.
- **"Today" defaults are the UTC date — class C.** Deterministic, but between midnight and 03:00
  in Riyadh a new document still defaults to yesterday. A product question; recorded only.

## Recorded for DEV-UI-01.7 (decided in P0, unchanged and not implemented here)
D-1 … D-9 exactly as recorded in `ar-locale-determinism.md` — D-1 dashboard profit / margin /
fake expenses removed; D-2 hide-Profit applies globally (presentation only); D-3 `h3 → h1` in C7
with a zero-pixel gate; D-4 four marketing cards removed, factual ZATCA card kept; D-5 fake trends
and sparklines removed; D-6 StatRow two-across at ≤640px, registry tones only; D-7 settings nav
stacks below 768px; D-8 done (P0); D-9 evolve `PageHeader` in place and narrow the layout pin.
