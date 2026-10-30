# DEV-UI-01.7 C8 — consolidated remediation: D-2 presentation and DataTable verification

Parent: C7 `004cd35863b8cb73f4e3d9e892c76c9a159c0f09` (tree `4688e6f0faa15a238f0e77608c18ca8f87b3a76c`), on C6 `20eff7d`,
C5 `e8f629b`, C4 `a1dbc6e`, C3 `65e12d6`, C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; this remediation is one commit on C7. Nothing is merged to main.
**DEV-UI-01.7 C8 FINAL RELEASE CLOSURE HAS NOT STARTED.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on 127.0.0.1, with
no repository `.env` (the browser tier's runner reads a temporary `.env` that points only at its own TEST-only database
and is deleted afterwards). Builds are normal, unmocked `next build`s. Nothing touched production; nothing was deployed;
no package, environment, schema, migration or configuration changed.

## Scope

Two bounded corrections, authorized together after the C8 Stage 1 read-only investigation:

* **Task A — D-2, presentation only.** The P0 decision recorded in `docs/ui/pre-dev-ui-01-7/ar-locale-determinism.md`
  ("Hide Profit / Margin until COGS is trustworthy"), held unimplemented through C3 – C7, applied to the two authorized
  on-screen surfaces. No accounting, costing or report calculation changed.
* **Task B — DataTable verification, test-only.** The DataTable runtime suite now waits for — and asserts — the Filters
  popover's Escape contract before it uses the Views menu. No application code changed (the list workspace and its
  saved-view toolbar are byte-identical to C7).

**This is not a globally consistent financial suppression.** The P&L export (CSV / Excel / PDF) still lists Gross
Profit, and Operating Profit, Net Profit and the Balance Sheet's current-period profit are still shown — each an open
decision (below), none decided here.

## Changed files

| File | C7 → C8 (sha256, 16) | Change |
|---|---|---|
| `src/app/(app)/projects/[id]/cost-control.tsx` | `10827a6bbbada948` → `4c7a9c36d184733f` | Actual Profit, Profit Margin, the `project_health` badge (Cost & Profitability's meta) and the health colour removed; the KPI row is the four factual figures on `StatRow columns={4}`; the now-unused imports and fields gone (5 hunks) |
| `src/app/(app)/finance/reports/reports-workspace.tsx` | `a3a43b8521157483` → `f3eff79b5f4a060c` | `PnlView` only: the Gross Profit summary card and the Gross Profit row removed, a two-line comment added (2 hunks) |
| `verify/verify-page-archetypes.mts` | `822b4e66c699e950` → `81fe5a67a1b53ae4` | group 16 (C8, 7 checks); groups 6, 11 and 12 undo the seven D-2 hunks before their older pins, their "D-2 held" checks replaced by checks that require the suppression; group 15 undoes the DataTable suite's hunks before its C6 freeze |
| `verify/verify-page-archetypes-runtime.mjs` | `9e9844f037cfa05a` → `ed6f31321756a435` | the project pass and the P&L value checks held to the suppression; the `c3ref` / `c4ref` expectations derived from the records, never re-recorded |
| `verify/verify-datatable-runtime.mjs` | `7dd991ed407faf91` → `a1f6efb9eb734f7c` | the Filters popover's focus-return contract waited for and asserted at both Filters → Views transitions (2 new checks, 130 → 132); failure diagnostics (9 hunks) |
| this document | — | |

`verify/page-archetype-pins.json`, `verify/page-archetype-actions.json` and `verify/page-archetype-runtime-baseline.json`
are unchanged: no pin, action inventory or recorded state (`d6`, `c3ref`, `c4ref`, `c6ref`, `c7ref`) is re-baselined.

## D-2 — what the screen shows now

### Project detail — Cost & Profitability (`/projects/[id]`)

| | C7 | C8 |
|---|---|---|
| Section heading | `SectionHeader level={2}` "Cost & Profitability", meta = `<StatusBadge domain="project_health" status={health} />` | the same h2 and title (renaming it is not authorized — an open decision), **no meta** |
| KPI row | `StatRow columns={3}`, six cards: Sales Value, Invoiced, Collected, Total Cost, Actual Profit, Profit Margin — three across, two at ≤640px | `StatRow columns={4}`, **four** cards in the same order: Sales Value, Invoiced, Collected, Total Cost — four across above 640px, two at ≤640px (D-6) |
| Colour | Actual Profit and Profit Margin in `statusTextClass("project_health", health)` | none: every figure the one plain value colour |
| Everything else | — | unchanged: the page title and status selector, Budget and Tasks · hours, the Revenue and Costs drill-down tables and their document links, the labour estimate, the excluded-document notice, every query |

`cost-control.tsx` no longer imports `statusTextClass` or `StatusBadge` and no longer destructures `profit`,
`marginPercent` or `health`; `src/lib/project-costing.ts` still computes all three (`decae2db39a19061`, unchanged), and
`verify:project-costing` still tests them.

### Profit & Loss (`PnlView` in `/finance/reports`, the default report and `?report=pl`)

| | C7 | C8 |
|---|---|---|
| Summary cards | Revenue · Gross Profit · Net Profit (each with its delta against the previous period) | Revenue · Net Profit (values and deltas as before) |
| Body | Revenue lines, Total Revenue · Cost of Sales lines · **Gross Profit** (final row) · Operating Expenses lines · Operating Profit · Other Income & Expenses (when there are any) · Net Profit / (Loss) | the same without the Gross Profit row: Cost of Sales' lines are followed directly by Operating Expenses |

Every other report (Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR / AP Aging, VAT Summary), the date
presets, the report picker, compare, search, the account drill-downs and the CSV / Excel / PDF links are unchanged;
`src/lib/finance-reports.ts` still computes `grossProfit` (`ec765dd2ce69b9e2`, unchanged).

### The authorized delta — seven hunks

The complete source change is these hunks and nothing else (group 16 proves it; `D2_EDITS` in
`verify/verify-page-archetypes.mts` holds each, C7's text and C8's, byte for byte):

1. `cost-control.tsx` — imports: `statusTextClass` and the `StatusBadge` import removed.
2. `cost-control.tsx` — the destructure: `profit`, `marginPercent`, `health` and `healthText` (with its comment) removed;
   a two-line D-2 comment.
3. `cost-control.tsx` — the SectionHeader's `meta` (the `project_health` badge) removed.
4. `cost-control.tsx` — the StatRow comment and `columns={3}` → `columns={4}`.
5. `cost-control.tsx` — the Actual Profit and Profit Margin items removed.
6. `reports-workspace.tsx` — `PnlView`: the Gross Profit card removed; a two-line D-2 comment.
7. `reports-workspace.tsx` — `PnlView`: the Gross Profit row removed.

## What D-2 does not change (§6) — byte-identical to C7

| File / surface | sha256 (16) | Status |
|---|---|---|
| `src/app/(app)/finance/reports/export/route.ts` — the P&L export still writes Gross Profit, Operating Profit and Net Profit / (Loss) rows; the Balance Sheet export its current-period profit | `1533168860eddde6` | unchanged (business pin, group 4) |
| `src/lib/project-costing.ts` — `profit`, `marginPercent`, `health` | `decae2db39a19061` | unchanged (business pin) |
| `src/lib/finance-reports.ts` — `grossProfit`, operating and net profit | `ec765dd2ce69b9e2` | unchanged (business pin) |
| `src/lib/status-registry.ts` — `project_health` and its mappings | `d30d22a93f40d71f` | unchanged |
| `src/lib/i18n/dict.ts` — every key, "Gross Profit", "Actual Profit", "Profit Margin" and their Arabic included | `ad171858a8128535` | unchanged |
| On screen: Operating Profit, Net Profit (card), Net Profit / (Loss), the Balance Sheet's Current-period Profit / (Loss) | — | still shown, unchanged |
| Database, schema, migrations | — | untouched |

Every file under `src/` other than the two is C7's to the byte (group 16: 497 files, `fcf68a21ad67fc8a`).

## Surviving figures — C7 → C8

Measured by the page-archetype runtime verifier itself (`--measure-out`) on a fresh normal build of exact C7
(`aeXEFaoJHcGKRK0dhLp5H`, the project and P&L passes, 139/139) and of the candidate — twice, on two fresh builds
(`4U7qDMRNucwwfkMaj9Ncr`, the full run, 151/151; `IInSZdAOpKvlOQRnPZPUA`, the same scoped run as C7's, 139/139) — on the
same TEST-only seed, then compared field for field: the candidate's project cards must be C7's
minus Actual Profit and Profit Margin, value for value; a P&L state's every field must be C7's with exactly the Gross
Profit card (label, value, delta) and row (label, value) taken out — the runtime verifier's own derivation; every
other report and statement state identical in every field. **152 / 152 comparisons hold, 0 differ, against both
candidate builds** — 16 project
states (two projects × EN / AR × 1440 / 1024 / 768 / 390: summary, cost cards, badge, breakdown) and 88 report /
statement states and interactions (14 of them P&L).

| State | C7 | C8 |
|---|---|---|
| `/projects/1` | Budget 185,000 · Tasks 8 (0.0 hours) — Sales Value 0 · Invoiced 53,383 · Collected 53,383 · Total Cost 0 · Actual Profit 53,383 · Profit Margin 100.0% · badge Profitable | Budget 185,000 · Tasks 8 (0.0 hours) — Sales Value 0 · Invoiced 53,383 · Collected 53,383 · Total Cost 0 · no badge |
| `/projects/2` | Budget 92,000 · Tasks 0 — Sales Value 0 · Invoiced 28,842 · Collected 11,537 · Total Cost 0 · Actual Profit 28,842 · Profit Margin 100.0% · badge Profitable | Budget 92,000 · Tasks 0 — Sales Value 0 · Invoiced 28,842 · Collected 11,537 · Total Cost 0 · no badge |
| P&L 2026 (EN) | Revenue 87,001 · Gross Profit 87,001 · Net Profit 5,926 — 4000 Sales Revenue 87,000.75 · Total Revenue 87,000.75 · Cost of Sales (no lines) · Gross Profit 87,000.75 · 5200 Salary Expense 81,075.00 · Operating Profit 5,925.75 · Net Profit / (Loss) 5,925.75 | Revenue 87,001 · Net Profit 5,926 — 4000 Sales Revenue 87,000.75 · Total Revenue 87,000.75 · Cost of Sales (no lines) · 5200 Salary Expense 81,075.00 · Operating Profit 5,925.75 · Net Profit / (Loss) 5,925.75 |
| P&L against the previous period | the three cards with ▲ 87,001 · ▲ 87,001 · ▲ 5,926 | Revenue ▲ 87,001 · Net Profit ▲ 5,926 |
| P&L (AR) | الإيرادات 87,001 · إجمالي الربح 87,001 · صافي الربح 5,926 … | الإيرادات 87,001 · صافي الربح 5,926 … (the same rows without إجمالي الربح) |

The seed's Cost of Sales has no lines (no COGS is ever posted), which is why its Gross Profit equalled its revenue — the
measured instance of the problem D-2 hides. Every figure that survives is unchanged to the character, in both
languages, at every width.

## Verifier migration

### `verify/verify-page-archetypes.mts` (226 → 233 checks)

The pattern for every older pin that required the old presentation — no snapshot rebaseline:

1. **The precise delta** — `D2_EDITS`: the seven hunks above, `[C7 text, C8 text]` byte for byte.
2. **Reverse only that delta** — `undoD2(file, text)` replaces each C8 hunk with its C7 text, and the older group's
   check then runs on the result.
3. **The historical guards keep their strength** — groups 6, 11 and 12 compare the undone text against exactly the
   pins they used in C7: C3's 39 hunks (each still C2's code to the character), C4's 32 hunks and the C4 report-body
   hashes (`PnlView` included), the SectionHeader consumer inventory (`D2_SECTION_HEADER`: the one meta entry put back
   before the comparison). Nothing is loosened. Group 16 adds a byte-exact hold: undone, each file must be C7's to
   the byte (`10827a6bbbada948`, `a3a43b8521157483`), so any change outside the seven hunks fails, a comment included.
4. **New affirmative guards** — the "D-2 held" checks are replaced, and group 16 added:

| Group | Check (C8) |
|---|---|
| 11 | C3 section slots, D-2 applied: Cost & Profitability has no meta and no actions |
| 11 | Cost & Profitability KPIs: one StatRow, `columns={4}`, exactly Sales Value, Invoiced, Collected, Total Cost in order, the engine's figures as handed in, all plain |
| 11 | D-2 applied: no Actual Profit, Profit Margin or `project_health` badge; the destructure takes `revenue, cost, rows, labourEstimate, excludedUnconverted` only; the engine still computes `profit`, `marginPercent`, `health` |
| 11 | Project health colour removed: no `statusTextClass`, `healthText`, health → colour map or comparison of health in a Projects file |
| 11 | status only through StatusBadge — C2's badges, domains and raw values, without the cost control's `project_health` one |
| 12 | D-2 applied: the P&L's cards are exactly Revenue and Net Profit; Cost of Sales' lines are followed by Operating Expenses; no `grossProfit` read or "Gross Profit" label in `PnlView`; `finance-reports.ts` and the export route still carry Gross Profit (business pins) |
| 16 | the D-2 delta: each D-2 file is C7's plus exactly its hunks (each once, its C7 form nowhere) |
| 16 | no other application file changed: 497 files under `src/` C7's to the byte |
| 16 | D-2 on screen: no application file outside `src/lib` names or reads what D-2 hides ("Actual Profit", "Profit Margin", "Gross Profit", `grossProfit`, `marginPercent`, `project_health`) — the export route its one named exception |
| 16 | presentation only: the engines, the status registry, the export route (business pins) and the dictionary (`ad171858a8128535`, the Arabic kept) unchanged |
| 16 | the DataTable suite's delta: exactly `DT_EDITS` (9 hunks); undone, the suite is C7's to the byte (`7dd991ed407faf91`) |
| 16 | the DataTable synchronization: both transitions go through `closeFiltersByEscape`, which waits for the popover gone and focus on `main [data-list-filters]`, asserts it as a check and throws when it does not come |
| 16 | the DataTable assertions intact: `openViews()` (its retry kept), `escapeRestoresTrigger()`, `triggerStoleFocus()`, the 400 ms `observe()`, `triggerFocused()`, immediate typing |

Group 15 (C7's freeze of C6) holds the DataTable suite through `undoDT` in the same way.

### `verify/verify-page-archetypes-runtime.mjs` (151 → 151 checks)

* **Project pass (C3)** — the cost row: exactly four cards (Sales Value, Invoiced, Collected, Total Cost), four across
  at 1440 / 1024 / 768 and two at 390, nothing clipped; all four in the one plain value colour; every factual figure
  C2's build showed — Budget, Tasks · hours and the four — to the character (`c3ref`'s first four cost figures); no
  `project_health` badge and no Actual Profit or Profit Margin in the text, an accessible name or a tooltip (EN / AR).
* **Value pass (C4)** — a P&L state (the default route, `?report=pl`, against the previous period, the P&L search)
  must say exactly what `c4ref` recorded without the Gross Profit card and row (`withoutGrossProfit`: the card's lines
  and the row's two lines leave the body, the card the cards and the row the line count; figures re-read from the
  rest); every other state is held to its record as it stands. A new check requires no Gross Profit on all 14 P&L
  states, the summary Revenue and Net Profit.
* `c3ref`, `c4ref`, `d6`, `c6ref`, `c7ref` are not re-recorded. The D-6 geometry record (C1's build: the StatRow
  consumers of that time — the document lists, the Projects list, Security) does not hold the project detail's cost
  row, so it needed nothing; that row's geometry is held by the C3 pass above.

## DataTable — the Filters → Views synchronization (Task B)

### Before (C7)

At the two transitions (status Sent chosen → Save current view; filters cleared → apply the saved view) the suite
pressed Escape on the Filters popover and continued as soon as `layersClosed()` saw the popover leave the DOM. Radix
closes it in two steps: the popover is removed, then — in FocusScope's unmount `setTimeout(0)`, measured 5.6–15.5 ms
later at 1× and up to 111.6 ms at 6× CPU — Popover's `onCloseAutoFocus` returns focus to `button[data-list-filters]`.
The suite's margin to that return was 7–28 ms at 1× and enforced by nothing. A late return explains both recorded
historical failures: it takes focus from the Views trigger (Enter then opens the Filters popover, and `[role="menu"]`
never appears — "saved-view flow ran to completion" timing out), or blurs the Save dialog's input to an outside button
(the 8-entry `out:dialog:save>button` log of the save-handoff failure).

### After (C8)

`closeFiltersByEscape(step)`: Escape; `layersClosed()`; then a bounded `waitForFunction` (5 s) for **both** the popover
gone and `document.activeElement` matching `main [data-list-filters]`; then a new check —
"Filters popover (‹step›): Escape closes it and keyboard focus is back on the Filters trigger before the suite moves on
to Views" — and, if the return never comes, a thrown error that fails the saved-view block (no silent catch, no sleep).
Then Views is used through the existing keyboard flow, unchanged.

### Diagnostics (failure evidence only)

The focus recorder names the Filters trigger (`filters`) apart from the Views trigger (`trigger`), keeps the active
element, and wraps `HTMLElement.prototype.focus` to record each programmatic `focus()` with its caller stack;
`focusState()` adds them to a failing check's detail only (the save handoff, the manage handoff, the focus-return
check, the "ran to completion" catch). Only element roles and stack frames are recorded — no field values, names or
user data beyond the suite's own synthetic view name already in the detail.

### Unchanged

Every one of the 130 C7 checks — immediate typing into Save with the complete value, no focus theft after the
dialog (`triggerStoleFocus`), the 60-character limit, the manage handoff, rename, Apply's focus return, Escape and
outside close, persistence, RowMenu semantics, filters and search — and `list-workspace-toolbar.tsx`
(`2bd2a430e47a76f5`, `viewsDialogHandoff` included), `use-list-filters.ts`, `saved-view-actions.ts`.

**Test debt (recorded, not changed):** `openViews()` retries a pointer click up to three times when it lands while a
previous layer is still closing — the same asynchronous-close class, masked rather than synchronized. Changing it needs
its own approval.

## Evidence

### DataTable trial matrix (candidate, unmodified suites, no retries)

| # | Condition | Build | Result |
|---|---|---|---|
| dt1–dt5 | DataTable only (`--only=datatable`, the unmodified tier runner), each on a fresh TEST-only database, beside other lanes (load 3.3–6.5) | `c0eIXZQQSOyfxYyD6-hir` | **5 / 5 PASS**, 132/132 each |
| cpu1, cpu2 | DataTable only with 4 busy-loop CPU spinners (load 10.5 / 11.2) | same | **2 / 2 PASS**, 132/132 |
| probe x1 | instrumented Filters → Views probe with the C8 wait, 1× CPU, 20 iterations | same | 20 / 20 — Escape → focus back on Filters 7.1–24.5 ms (median 15.1), the wait resolved 13.9–40.4 ms after Escape; the return came before the wait resolved and before Views was focused in 20 / 20, no Filters `focus()` after Views was focused |
| probe x6 | the same at 6× CPU throttle, 30 iterations | same | 30 / 30 — Escape → focus back 7.3–93.6 ms (median 49.7), the wait resolved 24.0–148.1 ms after Escape; order held in 30 / 30, no late return |
| replays 1–3 | the tier's first 13 suites through DataTable, in its order, on one server and one fresh TEST-only database per replay (the condition that reproduced the historical failure on exact C5); load 9.7 / 2.9 / 0.8 | same | **3 / 3 PASS** — DataTable 132/132 each; every other suite exit 0 each time (account Arabic 34/34, advances 172/172, P0 hydration 169/169, bank GL 21/21, bank opening ✓, P0.2 business-date hydration 108/108, colour theme ✓, compliance claims ✓, confirm e2e 34/34, controls 302/302, currency lock 13/13, dark theme ✓) |
| full tier | the complete 49-suite browser tier, alone, on the final tree | `t_hge_zZaWopbhF9vrd2A` | **PASS** — DataTable 132/132 inside 49/49 suites |

### Mutations

* **C8 static suite — 34 / 34 caught** (each must fail `verify-page-archetypes.mts`): D-2 reintroduced 7/7 (Actual
  Profit, Profit Margin, the badge as meta and inside the section, a health colour, the Gross Profit card, the Gross
  Profit row); factual content removed 10/10 (Sales Value, Invoiced, Collected, Total Cost, the Cost of Sales lines,
  the project Revenue and Costs drill-downs, the P&L account drill-down, the Revenue card, the Operating Profit row);
  protected files 5/5 (`project-costing.ts`, `finance-reports.ts`, the export route, the status registry, `dict.ts`);
  other drift 4/4 (back to `columns={3}`, the section title decided silently, an app-side DataTable change, another
  C7 line changed); DataTable synchronization weakened 8/8 (the focus-return condition dropped, either transition back
  to a bare Escape, a missing return ignored, a sleep instead of the condition, the excursion rule weakened,
  `openViews()` refactored, typing delayed).
* **Historical mutations D-2 made inapplicable, re-expressed on C8's code — 7 / 7 caught:** C3 M06 (Cost &
  Profitability back to h3), M24 (inline `gridTemplateColumns`), M27 (a manual health colour map, on a surviving
  figure), D03 / D04 (profit / margin recomputed in the page under a factual label); C4 D02 (Gross Profit recomputed),
  D03 (Gross Profit relabelled).
* **Runtime — 3 / 3 caught** (each its own worktree and fresh build): RM1 C7's `cost-control.tsx` (135/139, the four
  D-2 checks fail), RM2 C7's `reports-workspace.tsx` (136/139: value equality, D-2, the picker probe), RM3 Total Cost
  removed (136/139).
* **DataTable, app-side, in isolated mutation builds** — each in its own worktree with one mutation of
  `list-workspace-toolbar.tsx`, a fresh normal build, the unmodified tier runner (`--only=datatable`), a fresh TEST-only
  database, no retries; never committed, the worktrees removed:
  * **M1** — the Filters popover's focus return removed (`onCloseAutoFocus` → `preventDefault()`): **caught**,
    120/122. The new check fails ("Filters popover (status Sent chosen, before Save current view) …"; active element
    `body`, no `focus()` call), and the saved-view block stops on the thrown error instead of moving on.
  * **M2** — the `viewsDialogHandoff` suppression removed: **caught**, 125/128. The save handoff fails
    (`out:dialog:save>trigger`; the typed name cut to "oas"), and so do the save itself and "ran to completion".
  * **M3** — the focus return delayed by ~150 ms (still made): the C8 suite **stays green, 132/132**, because it waits
    for the actual return. **The C7 suite on the same build (the control) fails 129/130**: the save-handoff check fails
    with exactly the historical 8-entry log (`…"dialog:save","out:dialog:save>button","dialog:save"`, the value
    intact). That is recorded signature 1, now reproduced deterministically by a late Filters return, and the C8 wait
    closes it.
  * **M4** — saved-view typing broken (the name keeps 8 characters): **caught**, 125/128 (value "Sent vie").
  * **M4b** — saved-view focus broken (the name field is not focused when its Dialog opens): **caught**, 121/122. The
    suite's existing wait for the Save input to hold focus times out, and the block reports it.
* **Historical suites (C1 – C7) on the candidate — 364 caught, 0 missed, 14 not applicable, of 378:** C1 27/27,
  C2 46/47, C3 49/58, C4 62/66, C5 68/68, C6 62/62, C7 50/50 (its X12 — the DataTable suite changed — caught through
  group 15's undo). The 14 that no longer apply, each accounted for:
  * C2 X09 and C3 X11 (`.acct-grid`): C4 itself made exactly that change, so their anchor is absent on C4 – C7 as on
    C8 — pre-existing, not C8's.
  * C3 M32 / M33 / M34 and C4 M10 / D01: they remove Actual Profit, Profit Margin, the badge, the Gross Profit row and
    card — exactly the state D-2 now requires; their inverses are D1 – D7 above (7/7 caught). Obsolete by design.
  * C3 M06, M24, M27, D03, D04 and C4 D02, D03: their anchors were D-2's lines; each is re-expressed on C8's code
    (above, 7/7 caught).

  Every suite restored its worktree to the candidate (`61d581d3e525`).

### Screenshots (exact C7 → candidate, the harness's five sets)

Exact C7 (build `jH-PXpVWQAofuzV-p6ja2`, `src` clean) against the candidate (`FMZnqDrCIc6Tm6yvMrlZB`), the same harness
(`run.mjs` `030bd93ff4ce2ce8`), 1,108 states compared by PNG sha256: **1,036 byte-identical; 72 differ, every one on a
D-2 surface; 0 differ anywhere else; 0 missing on either side.**

| Set | States | Byte-identical | Differ (all on a D-2 surface) |
|---|---|---|---|
| 256 (EN / AR × light / dark × 1440 / 1024 / 768 / 390) | 256 | 224 | 32 — `project-detail` (`/projects/1`) × 16, `finance-reports` (the P&L, `/finance/reports`) × 16 |
| shell | 44 | 44 | 0 |
| lists | 210 | 210 | 0 |
| docs | 134 | 134 | 0 |
| arch | 464 | 424 | 40 — a09 project kanban × 10, a10 empty project × 10, c4 profit & loss × 4, i03 task edit × 4, i06 card focus × 4, i07 keyboard edit × 4, i08 empty kanban × 4 |

76 captured states are on a D-2 route; 72 changed and 4 did not — i09, the report picker by keyboard, which ends on
Trial Balance (no P&L on screen). The changes are the intended ones and nothing else: the project page is 90 px
shorter at every width in English (98 px at 390 in Arabic) because the cost row lost a line of cards (two lines of
three → one line of four above 640px; three lines of two → two at 390) and everything below it moved up; the P&L shows
one card and one row fewer (at 390 the page is 125 px shorter in English, 137 px in Arabic). Six of the 72 (i03 × 4,
i07 at 390 × 2 — the Edit Task dialog over the project) differ by at most 1/255 on 78 – 213 px of the dimmed page
behind the modal (the harness's anti-aliasing class): the page beneath was scrolled to the same card, from a different
absolute offset.

### Regression gates

All run on the final tree. The five files' diff is `61d581d3e525` in the main checkout and in every worktree used,
and this document is the only other change.

* `verify:page-archetypes` **233/233**: groups 1–15 (C0 – C7) green with their pins unchanged; group 16 (C8) 7/7.
* `verify:static` exit 0. Every count is C7's except page archetypes (226 → 233):
  * role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89, contrast 161/161;
  * typography 43/43, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69, document form 77/77;
  * edit-action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26, money precision 12/12;
  * number-locale (P0) 29/29, date-timezone (P0.1) 38/38, business-dates (P0.2) 44/44, ledger-only balances 8/8;
  * page archetypes 233/233.
* `verify:server` exit 0, on a fresh TEST-only database with no `.env`:
  * statements 70/70; project costing 50/50 — the engine's profit, margin and health are still computed and tested;
  * docs import 339/339, client import ✓, quotation import ✓, exchange rates 57/57, registration currency 34/34;
  * money round-trip 44/44, base backfill 21/21, rate fetch 27/27, FX reporting 16/16;
  * advances audit 18/18, advance allocations 23/23, advance backfill 16/16, advance release 15/15, credit-note
    release 40/40, advance refunds 10/10, advance clear 13/13, note FX 40/40;
  * settlement 29/29, payment reversal 55/55, bank opening 18/18, bank opening backfill 31/31;
  * DB hardening: both append-only triggers present.
* `tsc --noEmit` exit 0; ESLint `--max-warnings=0` on the five changed code files: 0 errors, 0 warnings.
* `verify:page-archetypes-runtime` **151/151** (build `4U7qDMRNucwwfkMaj9Ncr`): C1 – C7's runtime targets and C8's.
* **Browser tier: 49/49 suites passed** (`exit 0`). This was the complete `verify/run-browser-suites.mjs`, run alone in
  1,604 s. It used a fresh normal build of the final tree (`t_hge_zZaWopbhF9vrd2A`), a fresh TEST-only database, and a
  temporary `.env` pointing only at that database (removed afterwards; no repository `.env`). One run, none omitted:
  * account Arabic 34/34, advances 172/172, **P0 Arabic-locale hydration 169/169**, bank GL 21/21, bank opening ✓;
  * **P0.2 business-date hydration 108/108**, colour theme ✓, compliance claims ✓, confirm e2e 34/34;
  * controls 302/302, currency lock 13/13, dark theme ✓, **DataTable 132/132**, DC without bank 21/21;
  * delete refusal 16/16, dirty core 72/72, dirty UI 8/8, document attachments 14/14, document form 188/188;
  * draft buttons ✓, draft func ✓, duplicate 40/40, edit e2e 218/218, edit ✓, expense categories hidden 16/16;
  * favorites 20/20, FX dashboard 6/6, FX posting 108/108, note currency 19/19, payment dialog 28/28, payment FX 66/66;
  * PDF branding 15/15, preset ZATCA ✓, print apply ✓, private storage 22/22, proforma payments ✓;
  * rate one-click 28/28, rate screen 13/13, register outstanding 5/5, registration currency 20/20;
  * reversal status 16/16, **P0.1 settings time-zone hydration 85/85**, shell 341/341, sidebar scroll 14/14;
  * skeleton 11/11, Staff replay 9/9, Staff runtime 20/20, statement reversal 25/25, vendor inline 31/31.

  ✓ is the suite's verdict line, for suites that print no count. Every count equals C7's gate run except DataTable
  (130 → 132, the two new checks).

### Action and permission parity

Owner action inventory 1629 and Staff 1050 — identical to the recorded inventory (`page-archetype-actions.json`
unchanged); where Staff land on every route as the baseline; never-worse counters unchanged (overflow 0, heading
skips 0, tables past the viewport 0, Arabic-Indic digits 0, unnamed controls 64, pointer-only 16, unsaved prompts 48);
zero React #418 across 648 states. D-2 removed no button, link or control: the badge was a status, the cards and the
row were figures.

### Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack), every build fresh from its own tree. There are no font
mocks, no `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, and no package, Next config, environment, server or deployment change.
Every build compiled with the same 12 Turbopack warnings as before: the `blob-client-fake.ts` file pattern, which predates C8.

| Build | Tree | Used for |
|---|---|---|
| `jH-PXpVWQAofuzV-p6ja2` | exact C7 (`src` clean) | the C7 screenshots (five sets) |
| `aeXEFaoJHcGKRK0dhLp5H` | exact C7 | the C7 value measurement (139/139) |
| `FMZnqDrCIc6Tm6yvMrlZB` | candidate (`61d581d3e525`) | the candidate screenshots |
| `4U7qDMRNucwwfkMaj9Ncr` | candidate | runtime **151/151** and a value measurement |
| `IInSZdAOpKvlOQRnPZPUA` | candidate | the second value measurement (139/139) |
| `c0eIXZQQSOyfxYyD6-hir` | candidate | DataTable dt1–dt5, cpu1–cpu2, the probes, replays 1–3 |
| `zTjTNiiRglC7wKWivyV3Z`, `iyVb9jCdjgcWNqJe_9TGJ`, `X4eUj8wYtj70FaggFEoQS` | mutation worktrees | RM1, RM2, RM3 |
| one per mutation (worktrees removed) | mutation worktrees | M1, M2, M3 (with the C7-suite control), M4, M4b |
| `t_hge_zZaWopbhF9vrd2A` | **the final tree** | the full browser tier, **49/49** |

## Open decisions — not decided by C8

1. **Gross Profit in the P&L export** — CSV / Excel / PDF still write it (`export/route.ts`, unchanged, a business
   pin). The screen and the export now disagree; a decision is needed before any claim of consistent suppression.
2. **Operating Profit, Net Profit and Net Profit / (Loss)** on the P&L screen (and in its export) — computed from the
   same ledger without COGS, so overstated in the same way; still shown.
3. **The Balance Sheet's Current-period Profit / (Loss)** (screen and export) — needed for the equity identity; still
   shown.
4. **The project section title "Cost & Profitability"** — kept as authorized; whether to rename it is open.
5. **COGS / inventory valuation** — the root cause (no cost of sales is ever posted); accounting work outside DEV-UI.
6. **DataTable** — the `openViews()` pointer-click retry (test debt above); the stronger final-candidate budget
   (10 isolated runs, 10 tier-prefix replays, 3 full tiers) belongs to the final C8 closure.

## Next state

**DEV-UI-01.7 C8 FINAL RELEASE CLOSURE HAS NOT STARTED.** This commit awaits independent review.
