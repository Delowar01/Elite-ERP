# DEV-UI-01.7 C2 — HR archetype convergence

Parent: C1 `8768cb23795c803ad14abbc3241a9ed44fc72265` (tree `2d8ef0a38b11bce1d7e400b671c63d975cc27f70`),
on C0 `6ad311bb8372b62ac30bf9550f6bbe6f0fd066d7`, on main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C2 is one commit on C1. Nothing is merged to main.
**DEV-UI-01.7 C3 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Nothing touched production; nothing was deployed.

## Scope — the seven HR routes

| Route | File(s) (`src/app/(app)/hr/…`) | C2 change |
|---|---|---|
| `/hr/employees` | `employees/employees-client.tsx` | PageHeader (Add Employee as the action); department filter → `<button type="button" aria-pressed>`; KPI strip → `StatRow`; `EmptyState` |
| `/hr/employees/new` | `employees/new/page.tsx` | PageHeader (New Employee). `EmployeeForm` untouched |
| `/hr/employees/[id]` | `employees/[id]/page.tsx` | PageHeader: the name + monospace code in the h1, the employee StatusBadge as meta; Salary Structure → `SectionHeader level={2}`. `EmployeeForm` / `SalaryForm` untouched |
| `/hr/departments` | `departments/page.tsx` | PageHeader (Departments); the placeholder → `EmptyState` (message, hint, its two links as the action) |
| `/hr/attendance` | `attendance/page.tsx` | PageHeader (Attendance — Today) with the date pill as meta, written by `formatDisplayDate`; `EmptyState`. `AttendanceRowActions` untouched |
| `/hr/leave` | `leave/leave-client.tsx` | PageHeader (Leave Requests, not renamed) with Request Leave as the action; `EmptyState` |
| `/hr/payroll` | `payroll/page.tsx`, `payroll/payroll-client.tsx` | PageHeader (Payroll — ⟨month⟩, month by `formatDisplayDate`) with the period StatusBadge as meta; KPI strip → `StatRow` (Net pay neutral); `EmptyState`; Past payroll runs → `SectionHeader level={2}`; the table / payslip pair stops overriding `.two-col` |

Shared: `src/app/(app)/sales/_shared/stat-row.tsx` (D-6: `columns` through `--stat-cols`) and
`src/app/(app)/mockup-parity.css` (`.stat-row-2`, `.two-col`). `src/lib/i18n/dict.ts` did not change:
every string C2 renders already had its Arabic entry.

Untouched: the eight document lists, Projects (list, detail, cost control) and Settings › Security
(D-6 reaches them through the CSS alone — their sources are byte-pinned to C1), every other page,
`EmployeeForm`, `SalaryForm`, `AttendanceRowActions`, the leave dialog, server actions, queries, the
status registry, loading / not-found / error boundaries, schema, migrations, packages, configuration.

## Changed files

| File | Change |
|---|---|
| the 8 HR files above | as in the scope table — markup and two display-date statements only (see Data invariants) |
| `src/app/(app)/sales/_shared/stat-row.tsx` | `columns` → `--stat-cols` custom property instead of an inline `grid-template-columns` |
| `src/app/(app)/mockup-parity.css` | `.stat-row-2` (D-6) and `.two-col` (minmax tracks); the shared `.two-col, .acct-grid` collapse rule split so `.acct-grid` is unchanged |
| `verify/verify-status-registry.mts` | the "employee cards present / on-leave KPIs" coverage entry, for the StatRow (stronger; below) |
| `verify/verify-page-archetypes.mts` | group 10 "C2 — HR archetypes" (13 checks); group 6 / 9 checks follow D-6 and the new consumers (97 → 110 checks) |
| `verify/page-archetype-pins.json` | consumer inventory (+StatRow ×2, SectionHeader ×2, EmptyState ×5, PageHeader ×7, formatDisplayDate ×2) and the `.stat-row-2` rules; data / guards / business / contracts / actions identical to C1 |
| `verify/verify-page-archetypes-runtime.mjs` | C2 targets, two keyboard probes, the D-6 pass and its record, `pressed=` in the action inventory, `--write-d6` (36 → 60 checks; 61 in a re-baseline run) |
| `verify/page-archetype-runtime-baseline.json`, `verify/page-archetype-actions.json` | the 7 HR routes re-recorded; the D-6 record added (measured on C1's build); every other entry as C1 |
| `tests/ui-baseline/archetype-states.mjs` | 16 HR states, 2 keyboard interactions (8), 32 document-list and 8 bank-account states (202 → 266) |
| this document | |

## PageHeader — all seven routes

C1's `PageHeader`, unchanged, on every HR route; each renders exactly one PageHeader and that is the
page's only h1. No `.main-head` and no hand-written heading is left in an HR file.

| Route | title (the h1) | meta | actions |
|---|---|---|---|
| Employees | Employees | — | Add Employee → `/hr/employees/new` (the same link) |
| New Employee | New Employee | — | — |
| Employee detail | ⟨name⟩ `· EMP-001` (monospace span, inside the h1) | employee StatusBadge | — (none invented) |
| Departments | Departments | — | — |
| Attendance | Attendance — Today | the date pill (`.org-pill`) | — |
| Leave | Leave Requests | — | Request Leave (the same button, same `disabled` rule) |
| Payroll | Payroll — June 2026 | payroll-period StatusBadge (outside the h1) | — |

The typography verifier's employee-code rule (`font-mono … · {employee.employeeCode}`) holds: the code
stays in the h1 as part of the entity's title.

## Heading hierarchy

| Route | C1 outline (in `<main>`) | C2 outline |
|---|---|---|
| Employees | h3 Employees | h1 Employees |
| New Employee | h3 New Employee | h1 New Employee |
| Employee detail | h3 Khalid Example (Fictional) · EMP-001 | h1 Khalid Example (Fictional) · EMP-001 → h2 Salary Structure |
| Departments | h3 Departments | h1 Departments |
| Attendance | h3 Attendance — Today | h1 Attendance — Today |
| Leave | h3 Leave Requests | h1 Leave Requests |
| Payroll | h3 Payroll — June 2026 · h3 Past payroll runs | h1 Payroll — June 2026 → h2 Past payroll runs |

Arabic is the same structure (h1 الرواتب — يونيو 2026 → h2 دورات الرواتب السابقة; h1 ⟨name⟩ → h2 هيكل
الراتب). Salary Structure was a styled div; it is `SectionHeader level={2}` with `className="mb-4"`
(the div's bottom margin). Past payroll runs was a `.main-head h3` with a 26 px top margin; it is
`SectionHeader level={2}` with `mt-[26px] mb-[22px]` (the `.main-head` spacing). Every HR state, EN and
AR at 1440 / 1024 / 768 / 390, has exactly one h1 and no heading-level skip.

## Department filter — real toggle buttons

The chips were `<span onClick>`: pointer-only (4 per Employees state in C1), not focusable. They are
`<button type="button" className={cn("tab", active && "active")} aria-pressed={active} onClick=…>` on the
same `.tab-row`: same `.tab` look (Reports already used `button.tab`), `aria-pressed` exactly the
condition that shows a tab active, the same `setActiveDept(null | d.id)`, department ids and names
unchanged. Nothing else is on the buttons (no `tabIndex`, no key handler — the static guard pins the
attribute set): the keyboard path is the button's own. `.tab:focus-visible` (2 px `--focus` outline)
already existed. Filtering (`activeDept === null ? rows : rows.filter(r => r.departmentId === activeDept)`)
is unchanged.

Runtime probe (EN and AR, at 1440 and 390, against the TEST database: 3 departments, 6 employees):

| Step | Result (all four runs) |
|---|---|
| loaded | All departments `aria-pressed="true"` and `.active`; the three departments `false`; 6 cards |
| Tab from the top of the page | reaches All departments (47 presses at 1440, 8 at 390 where the sidebar is off-canvas); `:focus-visible`, ring `solid 2px` |
| Tab, Enter → each department | that department alone pressed and active; its 2 employees' cards, as the database says; focus ring on it |
| Shift+Tab ×3, Space | All departments pressed again; 6 cards |
| Tab, Space → each department | as with Enter |
| Shift+Tab ×3, Enter | All departments; 6 cards |
| click each filter (pointer, as before C2) | the same pressed state and the same cards for each |

Same look, to the pixel: in the Employees screenshots the tab-row band of C2 (buttons) and C1 (spans)
has 0 differing pixels at 1440 (EN light and dark, AR) and at 390 (EN, AR) — the active tab 118 × 30 px
(EN) / 92 × 34 px (AR) in both — once C2's 2 px lower position is allowed for (PageHeader's 24 px
bottom margin against `.main-head`'s 22 px).

The same probe on C1's build (`--only=hr-` with this verifier, unmocked): Tab never reached a chip
(200 presses), so no key was pressed and the keyboard check fails; the chips are `span`s without `type`
or `aria-pressed`. By pointer they gave exactly the cards C2's buttons give — 2 / 2 / 2 per department
and 6 for All, in all four runs — so filtering is unchanged.

## KPI strips → StatRow

**Employees** — `StatRow` with Headcount (plain), Present today (`{ ...statusStat(locale, "attendance",
"present", presentToday), label: t(locale, "Present today") }`), On leave (`statusStat(locale,
"attendance", "on_leave", onLeaveToday)`, the registry's label) and Departments (plain). The counts
(`presentToday` = present + late; `onLeaveToday`) are unchanged. No hand-written `text-success`,
`text-info`, `statusTextClass` or `colorClass` remains in the file.

**Payroll** — `StatRow` with Employees, Gross pay, Deductions and Net pay, the three amounts through
`<Money context="summary">`. Net pay lost its decorative `color: var(--brand-orange)`: it is not a status,
so it renders as a plain value; no payroll tone was invented. The value weight (800) is StatRow's, as it
was (DEV-UI-01.8 owns that sweep). The totals (`grossTotal`, `deductionsTotal`, `netTotal`) are unchanged.

Runtime (every width, EN / AR): Employees — tones `[–, success, info, –]`, classes `[–, text-success,
text-info, –]`, colours `rgb(23,23,63)` / `rgb(23,115,74)` / `rgb(47,79,184)` / `rgb(23,23,63)`; Payroll —
no tone, no class, one colour `rgb(23,23,63)` for all four (Net pay included).

On C1's build the Employees strip had the same labels, values, classes (`text-success`, `text-info`)
and colours — the registry's, by hand — without `data-tone` / `data-status` on the cards; Payroll's Net
pay was `rgb(232, 119, 34)` (`--brand-orange`). At 390 both were four cards a line, with one card past
the viewport on Payroll EN / AR and Employees EN; now two equal columns of 177 px.

## D-6 — the StatRow responsive contract

```css
.stat-row-2 { display: grid; grid-template-columns: repeat(var(--stat-cols, 4), minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
@media (max-width: 640px) {
  .stat-row-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

`StatRow({ items, columns?: 2 | 3 | 4 })` keeps its API and path. Left out, `columns` gives the row
exactly what it was (no attribute, no style) — four columns on desktop. Given, it sets
`style="--stat-cols: N"` (and `data-columns`), never an inline `grid-template-columns`, so the ≤640px rule
always wins: two across at phone width, whatever `columns` says. `minmax(0, 1fr)` keeps equal tracks — a
long value cannot widen its column. Grid tracks follow the inline direction, so RTL mirrors by itself.

**Global impact (intentional, D-6).** Every `.stat-row-2` without its own inline grid changes at
≤640 px; nothing else does:

| Consumer | How | At 390 (C1 → C2) | Above 640 px |
|---|---|---|---|
| Quotations, sales orders, proforma, sales invoices, delivery challans, purchase orders, credit notes, debit notes | `StatRow` | 4 tracks, 4 cards a line (proforma: 3 cards in 4 tracks) → 2 tracks, 2 a line, 2 lines | the C1 record to the pixel |
| Projects list | `StatRow` | 4 → 2 | as C1 |
| Settings › Security | bare `className="stat-row-2 mb-6"` (not in the Stage 1 list; reported here) | 4 → 2 | as C1 |
| Employees, Payroll | `StatRow` (C2) | C1: 4 hand-built cards a line, the widest pushing a card past the viewport (the page overflow below) → 2 | four columns |
| Project detail, cost control | `.stat-row-2` with an inline `gridTemplateColumns` | unchanged — the inline grid still wins | unchanged |

None of those sources changed: the eight list clients, Projects (list, detail, cost control) and the
Security client are byte-pinned to C1 by the static guard. C1's card widths at 390 were uneven (content
sized the `1fr` tracks: 94.8 / 86.7 / 74.3 / 74.3 px on quotations EN); they are now two equal columns
of 177 px.

## Payroll — the table / payslip pair

PayrollClient set `style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}` on its
`.two-col`, so the pair stayed side by side at every width — at 390, two ~170 px columns, the table
scrolling inside one and the payslip squeezed into the other. It keeps only `style={{ gap: 18 }}`;
`.two-col` owns the grid:

```css
.two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1100px) {
  .two-col { grid-template-columns: minmax(0, 1fr); }
  .acct-grid { grid-template-columns: 1fr; }   /* unchanged; C4 */
}
```

Runtime, EN / AR: side by side at 1440 (2 tracks); stacked at 1024, 768 and 390 (1 track, the payslip
below the table); both inside the viewport; the table wrap (`overflow-x: auto`) shows its last column;
page overflow 0 everywhere. Selection state, the row keyboard path, the payslip, the Process payroll
button and `<Money>` are untouched; the probe drove the rows by keyboard at 1440 and 390 (Tab to the first
row, Tab + Enter / Space down all six, Shift+Tab back, the other key): `aria-selected` moved to each row,
the payslip followed it, focus visible, every row kept `tabIndex 0`.

**Where Payroll's 390 overflow came from.** C1's 57 px (EN) / 40 px (AR) at 390 was the hand-built KPI
strip, not the table: four `1fr` columns of money values (C1 card widths 94.8 / 104 / 96.5 / 104 px EN —
wider than a quarter of the phone) pushed the fourth card past the viewport (C1's one offending element),
and Employees' 1 px (EN) was its strip the same way. StatRow with D-6 removes both. The table / payslip
pair never overflowed the page — its table wrap scrolls inside its track: restoring only the inline
grid on C2 (runtime mutation RT3) leaves the page at 0 px but the pair side by side at 1024 / 768 / 390,
which the layout check fails. Both fixes are needed for the brief's result: overflow 0 EN / AR, and the
table and payslip stacked.

The only other `.two-col` is Bank Accounts (`finance/bank-accounts/page.tsx`, inline `marginBottom`
only): its runtime states are identical to C1 at every width, and its screenshots are below.

## Dates — Gregorian, Western digits, no second clock

| Surface | C1 | C2 |
|---|---|---|
| Attendance pill | `new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", …)` | `formatDisplayDate(\`${today}T00:00:00Z\`, locale, "date")` — `today` is the day the page already selected its records for (`todayIso()`, unchanged) |
| Payroll title | `now.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { month: "long", year: "numeric" })` | `formatDisplayDate(\`${periodYear}-${MM}-01T00:00:00Z\`, locale, "monthYear")` — the period the page already selected (`periodMonth` / `periodYear`, unchanged) |

At the frozen instant (2026-06-15T09:00Z): EN "Jun 15, 2026" / "Payroll — June 2026"; AR "15 يونيو 2026" /
"الرواتب — يونيو 2026" (C1: "الرواتب — يونيو ٢٠٢٦"). The runtime verifier checks the helper's strings,
the literal expectations and the rendered PageHeader text, EN and AR at every width; and Chromium
writes the helper's strings exactly as Node does under four browser locales and zones. `fmtTime()`
(check-in / check-out times) and the period selection itself are deferred, as briefed. The dashboard is C6.

## EmptyState

| File | Message |
|---|---|
| `employees/employees-client.tsx` | No employees yet. Add your first employee. |
| `attendance/page.tsx` | No active employees yet — add employees to start tracking attendance. |
| `leave/leave-client.tsx` | No leave requests yet. |
| `payroll/page.tsx` | No active employees with a salary structure — set one on each employee's profile first. |
| `departments/page.tsx` | Managed from the Employees screen — hint: the two existing sentences (46ch measure); action: Go to Employees → `/hr/employees`, Go to Preset Management → `/settings/presets` (same classes) |

The custom shadowed recipe (`rounded-2xl … shadow-elevated`, and the Departments card with its
`padding: 52px 32px` and Building icon) is gone from every HR file. EmptyState's API did not change.
The Departments copy debt (the hint names fixed department names) stays deferred.

## Business and data invariants

- `verify/page-archetype-pins.json`: `data` (51 HR statements: attendance 8, departments 3, employee
  detail 9, new employee 5, employees 7, leave 5, payroll 14), `guards` (10 HR entries, including
  Payroll's `requireRole("owner", "admin")`), `business` (HR actions and `payroll/queries.ts`),
  `contracts` and static `actions` are **identical to C1**. Only `consumers` and the `.stat-row-2` CSS
  changed.
- Every statement of the 15 HR files other than imports and returned JSX (state, memos, counts,
  handlers, queries, calculations, actions) is textually identical to C1 (a C1 → C2 AST comparison of
  `employees-client`, `leave-client`, `payroll-client`, the seven pages, `payroll/queries.ts` and the four
  `actions.ts`) — except two display-only label statements, isolated and pinned:

  ```
  attendance/page.tsx  const todayLabel = formatDisplayDate(`${today}T00:00:00Z`, locale, "date");
  payroll/page.tsx     const monthLabel = formatDisplayDate(`${periodYear}-${String(periodMonth).padStart(2, "0")}-01T00:00:00Z`, locale, "monthYear");
  ```

  C0's data sections already set display-date statements aside, so no data snapshot moved; C2's static
  guard now pins both statements exactly (no `toLocaleDateString` / `"ar-SA"` may come back) — the pin is
  stronger, not wider.
- Status raw values: the seven StatusBadges of the HR files (domains and raw values) are C1's.

## Status-registry verifier

```
old  ["employee cards present / on-leave KPIs", "hr/employees/employees-client.tsx",
       [/className=\{statusTextClass\("attendance", "present"\)\}/, /statusLabel\(locale, "attendance", "on_leave"\)/,
        /className=\{statusTextClass\("attendance", "on_leave"\)\}/],
       [/color: "var\(--(accent-green|warning)\)"/]],
new  ["employee cards present / on-leave KPIs", "hr/employees/employees-client.tsx",
       [/<StatRow\s+items=\{\[[\s\S]*?\{ \.\.\.statusStat\(locale, "attendance", "present", presentToday\), label: t\(locale, "Present today"\) \},
          \s*statusStat\(locale, "attendance", "on_leave", onLeaveToday\),[\s\S]*?\]\}\s*\/>/,
        /<StatusBadge domain="employee" status="inactive" locale=\{locale\} \/>/,
        /<StatusBadge domain="attendance" status=\{r\.todayStatus\} locale=\{locale\} \/>/],
       [/statusTextClass\(/, /\bcolorClass\b/, /\btext-(success|info|warning|danger|corrective)\b/,
        /color: "var\(--(accent-green|warning|success|info|danger)\)"/,
        /t\(locale, (r\.todayStatus|r\.status|"(present|late|absent|on_leave|active|inactive|On leave|Present)")\)/]],
```

Stronger: the two KPIs must come from `statusStat()` inside the StatRow (label, tone and colour from the
registry), the cards' statuses must still be StatusBadges, and no hand-picked status class, `colorClass`,
status colour or raw-status translation may appear anywhere in the file. R1–R4 unchanged and green
(88/88, as C1).

## Static guard — `verify:page-archetypes` (110 checks)

Group 10 "C2 — HR archetypes" (13): one PageHeader per HR route and no `.main-head` / hand-written
heading; the exact title / description / meta / actions of each header; Salary Structure and Past payroll
runs as `SectionHeader level={2}`; the filter buttons (type, `aria-pressed` = the active condition,
`setActiveDept`, the exact attribute set) and no clickable non-button element in any HR file; the exact
Employees and Payroll StatRow items (no hand colour, no orange); no hand-built `.stat-row-2` in HR; the
EmptyState usages (and the Departments hint / links); both date statements; PayrollClient without an
inline grid; the `.two-col` / `.acct-grid` rules; the D-6 consumers byte-pinned to C1 (12 files); the
HR StatusBadges as C1 and no physical left / right. Groups 6 and 9 follow C2: StatRow's `--stat-cols`
output, the 11 StatRow consumers (none passes `columns`), the D-6 CSS as the only `.stat-row-2` rules,
`formatDisplayDate` on exactly the two C2 surfaces, the SectionHeader / EmptyState / PageHeader consumer
lists. C3–C7 legacy defects are not made blocking.

## Runtime — before / after (`verify:page-archetypes-runtime`, 60 checks)

Re-recorded with `--rebaseline=hr-employees,hr-employee-new,hr-employee-detail,hr-departments,
hr-attendance,hr-leave,hr-payroll` (build `k3wp0LvQVYoN31bjrSiXs`, unmocked): 56 owner states, 14 staff,
14 sweep, 35 action lists. Every other entry is byte-identical to C1 (296 owner, 74 staff, 74 sweep,
185 action lists), and a direct comparison of this run's measurements with C1's (unmocked C1 build,
C1 verifier) finds all 629 non-HR entries identical — Projects and Settings › Security included: their
measured states did not change (their overflow was already 0), so they were not re-recorded; their D-6
change is held by the D-6 record below.

| HR states (EN / AR × 4 widths) | C1 | C2 |
|---|---|---|
| one h1 | 0 of 56 | 56 of 56 |
| heading skips | 0 | 0 |
| page overflow | Payroll 390: 57 px EN / 40 px AR; Employees 390 EN: 1 px | 0 everywhere |
| elements past the viewport | 3 states | 0 |
| Arabic-Indic digits | Attendance AR ×4, Payroll AR ×4 | 0 |
| pointer-only clickables | Employees: 4 per state (×8) | 0 |
| unnamed controls | detail 3, new 2 (form internals) | unchanged (out of scope) |
| console / page errors, #418 | 0 | 0 |
| Staff permissions | Payroll → /dashboard; others open | unchanged |

The D-6 record (`d6` in the baseline): the D-6 pass over the document lists, Projects and Security
(80 states) measured on C1's build — `8768cb2`, `src` clean, build `f893fD1JE3WCE_zD8p9Jc` — with
`--write-d6`. Each C2 run is checked against it: route, every card's label / value / tone / classes /
colour, every status badge, every table, the actions — identical at every width; above 640 px the
rows' tracks, cards a line, card widths and row height identical (no desktop change); at 390 the
change is the intended one, printed for review (the 20 phone states `[[4,4,1]] → [[2,2,2]]`, proforma's
two `[[4,3,1]] → [[2,2,2]]`). The targets — two across at 390, four columns above 640, no clipped card, no
card past the viewport, no page overflow, no error — apply to all 12 consumers (96 states).

C1's build under this verifier (`--only=hr-`, the "before"): 46 / 60 — every C2 target fails there
(no PageHeader, h3 titles, the overflow above, 8 Arabic-Indic states, 8 pointer-only states, the chips
unreachable by Tab, Payroll side by side at every width, both strips four across at 390 with a card past
the viewport, Net pay orange); the payroll rows' keyboard path passes, as it already did.

Verify mode against the re-recorded baseline: **60 / 60** — on the re-recording build, again on a fresh
build, and finally on a fresh build of exactly this commit's tree (`XAaxgfaI55ikwbJp1YjcL`; the last
source edit was a CSS comment, and that build's CSS chunks are byte-identical to the screenshot build's).
All three runs measured the 352 owner, 88 Staff and 88 sweep states, 96 D-6 states, 220 action lists and
both probes exactly as the re-recording run did.

## Actions — the one intended delta

C1 → C2, owner (EN + AR at 1440, EN at 390) and Staff (EN + AR at 1440): the department filters appear
— they were spans, not actions — on the Employees lists only:

```
+ button|All departments||type=button|pressed=true          (AR: جميع الأقسام)
+ button|Finance||type=button|pressed=false
+ button|Operations||type=button|pressed=false
+ button|Sales||type=button|pressed=false
```

Every other action is unchanged — Add Employee, the employee card links, Attendance check-in / out,
Request Leave, Approve / Reject, Process payroll run, the payroll rows, the Departments links, every form
submit — and every action list of every other route is identical to C1 (1224 owner, 798 Staff actions
counted). The inventory now records a toggle's state (`pressed=true|false`); the only toggles inside
`<main>` on the 44 routes are these.

## Screenshots

Before = C1 `8768cb2`, captured now on an unmocked C1 build (`f893fD1JE3WCE_zD8p9Jc`) with this
commit's harness — minus the one state C1 cannot do (`i04-department-keyboard`: its chips are not
focusable), which would stop the capture; after = this commit (build `k3wp0LvQVYoN31bjrSiXs`). Same
frozen clock, seed, TEST-only database and pinned Chromium; no masking. `run.mjs compare`, then every
DIFFERENT / MISSING state classified as an HR route (or an interaction on one), a D-6 consumer at 390,
or a state only C2 can capture — anything else would be unexpected.

| Set | States | Byte-identical | Intended differences | Unexpected |
|---|---|---|---|---|
| 256-state matrix | 256 | 228 | 28 — Employees at every width / theme (16); invoices, quotations and projects lists at 390 (12) | 0 |
| lists (DEV-UI-01.5) | 210 | 174 | 36 — Attendance at every width (8); the invoices workspace states, projects and the empty orders list at 390 (28) | 0 |
| shell | 44 | 44 | — | 0 |
| archetypes (266) | 266 | 188 | 78 — HR (54: employees, employee detail, payroll at every width and dark; New Employee, Departments, Attendance, Leave at 1440 / 390; the department-filter click and the payroll keyboard states); D-6 at 390 (20: the eight document lists, Projects, Security); `i04-department-keyboard` (4, C2 only) | 0 |
| documents (DEV-UI-01.6) | 134 | 134 | — | 0 |

So: every C1 state (the 12 master-data / detail pages, the long-name fixture) is byte-identical; the
eight document lists, Projects and Security are byte-identical at 1440 / 1024 / 768 (and dark) and
change only at 390; Bank Accounts is byte-identical at every width; nothing on the dashboard, kanban,
reports, statements, ledger, shell or document editors moved. Looked at by eye: at 390 C1 squeezed four
KPI cards a line (labels wrapping; Payroll's last card past the edge, and Employees' in English), C2 shows two equal
columns with the same values and colours — the table, row menus and dialogs below unchanged, only lower;
Payroll stacks the table (all four columns now visible) above the payslip; the keyboard-chosen
department shows the pressed fill with the 2 px focus ring.

The captures (`{c1,c2}-{256,lists,shell,arch,docs}`, each with its `manifest.json`) and the classified
compare logs are review evidence in this session's scratch space, not committed.

## Mutations

Each mutation edits one file in a mutation worktree, runs the verifiers that must catch it, and
restores the file; caught = every listed verifier fails. Static: **47 / 47** (the brief's 23 items as 31
mutations, all caught; 16 extra, all caught). Runtime (rebuilt, `--only` run): **5 / 5**. Together
**52 / 52**.

| §33 item | Mutation(s) | Caught by |
|---|---|---|
| 1 Employees title back to h3 | R01 `.main-head h3` | PageHeader per route; PageHeader consumers |
| 2 department button → span | R02 | filter buttons check |
| 3 `aria-pressed` removed | R03 | filter buttons check |
| 4 keyboard filter broken | R04 `tabIndex={-1}`, R04b `onKeyDown` preventDefault; RT1 (runtime) | filter attribute set; the keyboard probe |
| 5 Employees inline KPI cards | R05 | Employees KPIs; StatRow consumers; status-registry coverage |
| 6 Present colour by hand | R06 `colorClass: "text-success"`; RT5 (runtime, `text-warning`) | Employees KPIs; registry R4 + coverage; the strip check |
| 7 On leave colour by hand | R07 | Employees KPIs; registry R4 + coverage |
| 8 Payroll inline KPI cards | R08 | Payroll KPIs; StatRow consumers |
| 9 Net pay orange again | R09 | Payroll KPIs (no brand-orange) |
| 10 mobile rule back to 4 columns | R10, R10b (rule removed); RT2 (runtime) | D-6 CSS check; the 390 two-across check |
| 11 StatRow CSS loses minmax | R11 | D-6 CSS check |
| 12 `columns` inline grid again | R12 | StatRow columns output check |
| 13 PayrollClient inline grid | R13; RT3 (runtime) | payroll layout (static); payroll layout probe (runtime) |
| 14 `.two-col` loses minmax | R14 (≤1100 px), R14b (desktop) | `.two-col` / `.acct-grid` rules |
| 15 Attendance plain `ar-SA` | R15; RT4 (runtime) | dates check; Arabic-Indic and pill checks |
| 16 Payroll title plain `ar-SA` | R16 | dates check |
| 17 Salary Structure → div | R17 | section headings; SectionHeader consumers |
| 18 Past payroll runs → h3 | R18 (`.main-head h3`), R18b (`level={3}`) | section headings |
| 19 HR custom empty recipe | R19 | empty states; EmptyState consumers |
| 20 payroll / attendance query | R20 (active filter), R20b (net ignores deductions), R20c (UTC period month) | data sections pinned |
| 21 payroll guard | R21 (`staff` admitted) | guards; owner / admin rule; data |
| 22 document list edited for D-6 | R22 (quotations `columns`), R22b (Security inline grid) | D-6 sources byte-pinned; StatRow consumers |
| 23 C1 contract regresses | R23 (vendor Statement of Account h3), R23b (PageHeader title not an h1) | C1 detail checks; PageHeader contract |

Extra (all caught): Present through `statusTextClass` in an ad-hoc item; a raw attendance status
translated instead of StatusBadge; `aria-pressed` out of sync; the employee code out of the h1 / out of
its monospace span (typography too); the Payroll badge inside the h1; Leave renamed "Leave"; a
Departments link target; the D-6 breakpoint moved; `.acct-grid` touched; the Attendance pill from a second
clock; Employees passing `columns`; past runs losing the tenant filter; a status raw value; a
hand-written heading; physical `ml-auto` in an HR file.

Runtime notes. RT1's first run aborted instead of failing a check: with the departments out of the tab
order, Tab went on to an employee card and Enter opened it, so the pointer phase found no filter row. The
probe now presses keys only once Tab has reached the filters and starts its pointer phase on a fresh
Employees page; re-run, RT1 fails "department filter by keyboard". RT3 was first expected to fail the
overflow check; it fails the layout check instead — see "Where Payroll's 390 overflow came from".

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint, every changed source / verifier / harness file | clean |
| `npm run verify:static` (21 verifiers) | all pass — role-matrix 32, confirm-policy 62, dirty-form 66, skeletons 89, contrast 161, typography 43, status-registry 88, shell 75, controls 110, datatable 69, document-form 76, edit-action 59, store-model 69, provider-harness 302, backup-claims 26, money-precision 12, number-locale 29 (P0), date-timezone 38 (P0.1), business-dates 44 (P0.2), ledger-only-balances 8, page-archetypes 110; every count as C1 but page-archetypes (97 → 110) |
| `npm run verify:server` | all pass, every count as C1 (statements 70, project-costing 50, docs-import 339, …, bank-opening-backfill 31, DB hardening) |
| `verify:page-archetypes` | 110 / 110 |
| `verify:page-archetypes-runtime` | 61 / 61 re-recording the HR routes; 60 / 60 verifying, three times — on the re-recording build, on a fresh build, and on a fresh build of exactly this commit's tree (`XAaxgfaI55ikwbJp1YjcL`); all three measured identically (856 entries) |
| browser tier (`verify/run-browser-suites.mjs`, 49 suites) | 49 / 49, every check count as C1 — incl. ar-locale-hydration (P0 Arabic money), settings-timezone-hydration (P0.1), business-date-hydration (P0.2), datatable-runtime (the payroll row keyboard path), controls-runtime, shell-runtime |
| mutations | 47 / 47 static, 5 / 5 runtime |
| screenshots | 910 states C1 → C2: 768 byte-identical, 142 intended differences, 0 unexpected (above) |

C0 and C1 guards: unchanged and green — the C1 runtime targets (one PageHeader / h1, detail outlines,
no overflow, C1 Arabic copy), D-9 and the document-form pins (76 / 76), the C0 primitive contracts and
route / business / data guards.

## Environment note — the build is unmocked again

C1 ran its runtime and screenshot suites with a TEST-only `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` file
because this container's unmocked `next build` failed on the `next/font/google` fetch. At the start of
C2 the normal, unmocked build worked, so every C2 build, measurement and capture is unmocked. The C1
"before" references were re-measured / re-captured on an unmocked build of the C1 tree for the
comparison (C1's runtime verifier: 36/36 on it; its measurements against the mocked C1 run: 748 / 748
fields identical). No `.env`, Next config, font declaration or package changed. The release
requirement stands: C8 / the final merge needs a successful unmocked production `next build`.

## Deferred — recorded, not C2's

- `fmtTime()` check-in / check-out times (still `toLocaleTimeString("en-US")`), the period selection in
  Payroll (server-local month), the HR Snapshot "Absent" semantics — as briefed.
- The Departments placeholder's copy (fixed department names in its hint); the nav's "Leave" vs the
  page's "Leave Requests".
- EmployeeForm / SalaryForm unnamed controls (detail 3, new 2 per state) — form-control cleanup is not C2's.
- Settings › Security keeps its hand-built KPI cards (bare `.stat-row-2`, inline colours) — Settings is C5.
- `.acct-grid` (C4); Projects headings / kanban / cost control (C3); the dashboard (C6); document h3 → h1 (C7).
- Not-found pages still stream with HTTP 200; loading boundaries and `error.tsx` unchanged.
