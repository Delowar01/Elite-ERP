# DEV-UI-01.7 C3 — Projects + kanban

Parent: C2 `c060e8bbeb44feb54f5b666a5e3106e43ea04d70` (tree `be3b1c7e74eb15b430033da5f85532e816379397`),
on C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C3 is one commit on C2. Nothing is merged to main.
**DEV-UI-01.7 C4 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Builds are normal, unmocked `next build`s.
Nothing touched production; nothing was deployed; no package, environment or configuration changed.

## Scope — the Projects family

| Route | File(s) (`src/app/(app)/projects/…`) | C3 change |
|---|---|---|
| `/projects` | `projects-list-client.tsx` | the `div.flex > h3` title → `PageHeader` "Projects". New Project stays in `ListToolbar` (`/projects/new`); search, stats, table, RowMenu, `ListEmptyState`, live region unchanged |
| `/projects/new` | `new/page.tsx` | `.main-head h3` + paragraph → `PageHeader` (title New Project, its existing description). `ProjectForm` untouched |
| `/projects/[id]` (project 1: eight tasks; project 2: none) | `[id]/page.tsx`, `[id]/cost-control.tsx`, `[id]/kanban-board.tsx` | `PageHeader` (name / org-pill as meta / ProjectStatusSelect as action); summary → `StatRow columns={2}` in a 520px box; Cost & Profitability → `SectionHeader` h2 with the health badge as meta, its six KPIs → `StatRow columns={3}`, Revenue / Costs → `SectionHeader` h3s, `.cost-breakdown-grid` on CSS; Tasks → `SectionHeader` h2 with Add Task; column labels → h3; task cards → `<button type="button">` with a full accessible name, focus ring, focus return; three `EmptyState`s; Time logged / Linked Documents → `SectionHeader` h2s; Hours / Amount → `TableHead` / `TableCell numeric` |

Shared: `src/app/(app)/mockup-parity.css` — two additions only (below). `src/lib/i18n/dict.ts` did not
change: every string C3 renders (Projects, Tasks, Priority, Assignee, Unassigned, …) already had Arabic.

Untouched (byte-identical to C2, guarded): `projects/page.tsx`, `project-form.tsx`, `actions.ts`,
`[id]/project-status-select.tsx`, `[id]/log-time-dialog.tsx`, `src/lib/project-costing.ts`,
`src/lib/status-registry.ts`, every other page, schema, migrations, packages, configuration.

## Changed files

| File | Change |
|---|---|
| the five Projects files above | markup only — the static verifier proves each is C2's code plus exactly C3's 39 hunks |
| `src/app/(app)/mockup-parity.css` | `.cost-breakdown-grid` (the approved responsive rule) and `.kanban-col-head h3 { font: inherit; text-wrap: inherit; }` |
| `verify/verify-page-archetypes.mts` | C3 group 11 (26 checks); groups 6 / 9 / 10 adjusted to C3's consumers (below) |
| `verify/page-archetype-pins.json` | consumer inventory only (+14 lines: 2 StatRow, 6 SectionHeader, 3 EmptyState, 3 PageHeader) |
| `verify/verify-status-registry.mts` | the kanban coverage entry, stronger (§28) — nothing else |
| `verify/verify-page-archetypes-runtime.mjs` | C3 targets, the project pass, the kanban / empty / Hours probes, the `c3ref` record, the task-button action allowance |
| `verify/page-archetype-runtime-baseline.json` | the 32 Projects owner states re-recorded; `c3ref` added (measured on C2's build) |
| `verify/page-archetype-actions.json` | the 5 project-detail action lists: + 8 task-card buttons each |
| `tests/ui-baseline/archetype-states.mjs` | New Project (EDGE) and three C3 interactions |
| `verify/verify-ar-locale-hydration.mjs` (P0 browser suite) | its JavaScript-disabled reconstruction also reads React's table-form stream segments — see below; nothing loosened |
| this document | |

### The P0 hydration suite — a reconstruction gap C3 exposed

`verify-ar-locale-hydration.mjs` compares the figures of a hydrated page with the figures of a
JavaScript-disabled load of the same page, which it reconstructs from `<main>` and the hidden
`<div id="S:…">` blocks React streams late segments into. On C3's project detail React streams part of
the Revenue drill table's rows late, and from inside a table it uses its table form — a hidden `<table>`
holding the `S:` tbody / row — which the suite did not read: 43 figures "served" vs 49 hydrated, on 3–4 of
its 4 locale combinations (C2's build: 169/169 the same day). The hydrated page was right (no #418,
Western digits, the same figures). The suite now also counts figures in a hidden container that is, or
holds, an `S:` segment. It reads more of the served page and still demands exact equality: 169/169 on C3
**and** on C2; a deliberate client/server money mismatch on C3 still fails it (65/169). No other change.

### The second CSS rule — why it exists

`globals.css` sets `h1…h6 { font-family: var(--font-ui); font-weight: 600; text-wrap: balance }`
**unlayered**, so it beats Tailwind's layered utilities. A column label that becomes an `<h3>` would drop
from the column head's 700 to 600. `.kanban-col-head h3 { font: inherit; text-wrap: inherit; }` makes the
h3 take the head's own type, exactly what the old `<span>` inherited; the runtime record proves the head
and its label identical to C2 (box and type). It is typographic, scoped to the kanban head, and touches
no layout rule; `.stat-row-2`, `.two-col`, `.acct-grid`, dashboard, Settings, document and print CSS are
untouched (pinned: the stylesheet is C2's plus these two additions, comments and whitespace aside).

## Heading hierarchy

```
/projects             h1 Projects
/projects/new         h1 New Project
/projects/1           h1 Riyadh Tech Expo 2026 booth
                        h2 Cost & Profitability
                          h3 Revenue
                          h3 Costs
                        h2 Tasks
                          h3 To do · h3 In progress · h3 Blocked · h3 Done   (statusLabel(locale, "task", …))
                        h2 Time logged this week
                        h2 Linked Documents
/projects/2           as /projects/1 without the four column h3s (no tasks — EmptyState)
```
Arabic: المشاريع / مشروع جديد / التكلفة والربحية › الإيرادات، التكاليف / المهام › للتنفيذ، قيد التنفيذ، معطَّل، تم /
الساعات المسجلة هذا الأسبوع / المستندات المرتبطة. C2 had every one of these as an h3 (no h1).

## Project StatRows and D-6 colour

* Summary: `StatRow columns={2}` — Budget, Tasks · ⟨hours⟩ hours logged — inside `div.max-w-[520px]`
  (the old inline `maxWidth: 520`); two across at every width (366px wide at 390).
* Cost & Profitability: `StatRow columns={3}` — Sales Value, Invoiced, Collected, Total Cost, Actual
  Profit, Profit Margin — three across at 1440 / 1024 / 768, two across at 390 (D-6's ≤640px rule; C2
  forced three at 390 inline).
* Colour: Collected's green and Total Cost's warning are gone (plain value colour, `rgb(23,23,63)`).
  Actual Profit and Profit Margin keep the health colour, from the registry only —
  `statusTextClass("project_health", health)` around the value node (`profitable` → `text-success`,
  `rgb(23,115,74)`). No `profitTone`, no `accent-*` on a KPI, no `colorClass` (R4), no local map.

## D-2 — held, not decided

Actual Profit, Profit Margin and the `project_health` badge remain; values come only from
`getProjectCostControl(session.orgId, projectId, session.orgCurrency)` (data pin) via the unchanged
destructure. No arithmetic in any Projects file but C2's own (avatar colour index, the 7-day window, list
counts). `project-costing.ts` byte-pinned (`decae2db39a19061`). Runtime: every figure on both projects,
every width, EN / AR, is C2's to the character (the `c3ref` record), and the badge is C2's (status, tone,
label, colours), now outside the h2.

## Cost breakdown — responsive

`.cost-breakdown-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }`
and at `max-width: 900px` `grid-template-columns: minmax(0, 1fr)`; the inline grid is gone.

| width | C2 | C3 |
|---|---|---|
| 1440 | 2 side by side | 2 side by side |
| 1024 | 2 side by side | 2 side by side |
| 768 | 2 side by side (squeezed) | stacked |
| 390 | 2 side by side (squeezed; text wrapping per word) | stacked |

(EN and AR identical in layout.)

## Logical numeric alignment

Hours and Amount — header and cell — use `TableHead numeric` / `TableCell numeric` (`data-cell="numeric"`
→ `text-align: end`, tabular, nowrap). Measured gap between the text and the cell's inline-end padding:

| | C2 header / cell | C3 header / cell |
|---|---|---|
| Amount EN 1440 | start 172.6 / right 0 | end 0 / end 0 |
| Amount AR 1440 | start 213.2 / right 164.5 (wrong side) | end 0 / end 0 |
| Hours EN 1440 | start 61.5 / right 0 | end 0 / end 0 |
| Hours AR 1440 | start 60.2 / right 77.8 (wrong side) | end 0 / end 0 |

(390 alike. Hours measured with one fixture time log — the seed has none in the rolling week — inserted
into the run's TEST-only copy and deleted after.) The drill tables' `.num` cells are untouched (§26).

## Kanban

* **Buttons.** `<button type="button" className="kanban-card block w-full text-start focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-focus" aria-label={taskName(task)}
  data-task-id={task.id} onClick={(e) => openEdit(task, e.currentTarget)}>` — inner `div`s became `span`s
  (valid button content; `.t` keeps `block`, `.meta-row` / `.kanban-avatar` are flex by their CSS). No
  tabIndex, role, key handler, drag or timer: Tab, Enter and Space are the button's own.
* **Accessible name.** `[title, statusLabel(locale, "task", status), "Priority: <t(label)>",
  "Assignee: <name | Unassigned>"].join(", " | "، ")`, e.g. `Post-show teardown, To do, Priority: Medium,
  Assignee: Faisal Dummy (Fictional)` / `Post-show teardown، للتنفيذ، الأولوية: متوسط، المكلَّف: …`. No id.
  The visible card copy is unchanged.
* **Focus ring.** The repository pattern (Button / Checkbox / RadioGroup): 2px solid outline, 2px offset,
  `--color-focus` (`--focus`). Hover (`.kanban-card:hover`) untouched.
* **Focus return.** `opener` ref set by `openEdit` / `openNew` from `e.currentTarget`;
  `DialogContent onCloseAutoFocus` calls `e.preventDefault()` (Radix's own target is null without a
  `DialogTrigger`) and focuses the opener — or, if a save re-rendered the board, the same task's card by
  `data-task-id`. Escape, the close button and Save all return to the exact card; Add Task to itself.
* **Headings.** Tasks h2 (Add Task as its action, unchanged label / variant / dialog); each column label an
  h3 from the registry, count in a `span` outside it; COLUMNS order unchanged; no drag and drop.
* **Status vs priority.** Status: registry only (column h3, card name, Status select, Done `StatusBadge
  task/done`). Priority: the page-local `PRIORITY_LABEL` / `PRIORITY_STYLE`, unchanged (deferred to
  DEV-UI-01.8); no priority domain in the registry.
* **Visual equivalence (§36).** The runtime compares C3's button cards with C2's div cards (the `c3ref`
  record, measured on c060e8b): 51 computed properties per card (width, height, borders, radii,
  background, shadow, padding, margin, font family / size / weight / line-height / letter-spacing, colour,
  text-align, text-transform, cursor, opacity, transform, outline…), the card's box in its column,
  every element inside it (box, type, colour, text), at rest **and hovered**, and every column head —
  EN / AR at 1440 and 390: identical. The focus ring is the only new state.

## Empty states

* Tasks (`tasks.length === 0`): `EmptyState` "No tasks yet. Add the first task to this project." — no
  action inside; Add Task stays in the Tasks header.
* Time logged this week: `EmptyState` "No time logged yet."; LogTimeDialog still only when employees and
  tasks exist; the no-employee note kept.
* Linked Documents: `EmptyState` with the full existing message.

## Action inventory (C2 → C3)

The only intended delta: the populated project's eight task cards are buttons now (they were divs with
`onClick`, counted as pointer-only — 8 per C2 state, 0 in C3). Added, deterministic (`button||type=button|`
+ name), in owner EN 1440 / EN 390 / AR 1440 and Staff EN 1440 / AR 1440 — 5 lists × 8. Everything else
— New Project, project links, RowMenu View, ProjectStatusSelect, Add Task, Save, Log Time,
linked-document links, ProjectForm submit — equivalent: same kinds, names, targets, types, states.

## Project data / business invariants

Data sections pinned and unchanged: list 4 / New 4 / detail 16 statements (the queries, `weekAgoIso()`,
linked documents and their sort, `getProjectCostControl(…)`, `pillParts`); guards and static actions
(5 / 1 / 8) unchanged. Byte pins: `projects/actions.ts` `46855e0429daa0d4`, `src/lib/project-costing.ts`
`decae2db39a19061`, `projects/page.tsx` `7b5c54fc98d94ed6`, `project-form.tsx` `7202780083f91f63`,
`project-status-select.tsx` `8eb0ff66d5388d04`, `log-time-dialog.tsx` `4cdb163691cb2c64`. No
presentation statement moved out of the markup.

## Verifiers

* `verify:page-archetypes` 136/136 (group 11: 26). Group 6: 13 StatRow consumers, only C3's two pass
  `columns`; SectionHeader / EmptyState consumers include the project detail's. Group 9: 22 PageHeader
  consumers. Group 10: the C2 D-6 byte pin now holds the nine files C3 does not own (8 document lists +
  Security); Projects' three are group 11's (C2 code + C3 hunks). No C2 check removed or loosened.
* `verify:status-registry` 88/88; R1–R4 unchanged and green; kanban coverage now requires COLUMNS
  unchanged, the column `<h3>{statusLabel(locale, "task", col.status)}</h3>` with the count outside, the
  Select's `statusLabel(locale, "task", c.status)`, the card name's `statusLabel(locale, "task", task.status)`,
  the Done `StatusBadge task/done`, and forbids raw / hard-coded task statuses through `t()` and a second
  task-status map.
* `verify:page-archetypes-runtime` — see Runtime.
* `verify:static` and `verify:server`: exit 0 (TEST-only database, no `.env`). `tsc --noEmit` and ESLint on
  the changed files: clean.
* Browser tier (`verify:browser`, fresh normal build of the final tree, temporary TEST-only `.env` removed
  after): **49/49 suites** — among them ar-locale-hydration 169/169, controls-runtime 302/302,
  datatable-runtime 130/130, document-form-runtime 188/188, edit-e2e 218/218, dark-theme.

## Runtime (C2 → C3)

`node verify/verify-page-archetypes-runtime.mjs` on C3's build: **82/82 PASS** (exit 0), against the
baseline whose only changes are the 32 Projects owner states (re-recorded with
`--rebaseline=projects,project-new,project-detail,project-empty`), the five project-detail action lists and
the `c3ref` record (`--write-c3ref` on the exact c060e8b build `D13TDfI3-9bRAHLGTvmMq`, src clean). Staff,
sweep, the D-6 record and every other route: unchanged. The same verifier on C2's build (`--only=project`)
gives 65/82 — the C3 targets failing there is the "before".

| measure (owner, EN / AR × 4 widths) | C2 | C3 |
|---|---|---|
| h1 on every Projects page | 0 (titles were h3) | 1 |
| heading skips / overflow / elements past the viewport / errors / #418 | 0 | 0 |
| pointer-only clickables, populated project | 8 | 0 |
| unnamed controls, New Project | 2 | 2 (ProjectForm, out of scope) |
| Arabic-Indic digits | 0 | 0 |
| summary tracks / cards a line | 2 / 2 | 2 / 2 |
| cost KPI tracks at 1440·1024·768 / 390 | 3 / 3 | 3 / **2** |
| breakdown at 1440·1024 / 768·390 | side / side (squeezed) | side / **stacked** |
| kanban tracks 1440 / ≤1024 | 4 / 2 | 4 / 2 |

Probes (EN / AR at 1440 and 390): kanban keyboard — Tab ×50 (1440) / ×11 (390) reaches the first card
(C2: never — a `div`); Enter → Edit Task for that task, Escape → focus back on the same card, Space →
reopened, close button → back, Tab + Enter + Save → back, Shift+Tab to Add Task, Enter → New Task, Escape
→ back to Add Task; pointer click → Edit Task, close → back on the clicked card; tasks in the database
identical before and after. Empty project: Tasks h2, Add Task usable, EmptyState, no board, no error, no
overflow. Kanban visual equivalence vs C2: identical (51 properties, geometry, insides, hover, heads).

## Screenshots

Byte comparison, C2 (c060e8b build, the same harness minus the three interactions C2 cannot perform)
vs C3, same frozen clock, seed, TEST-only database and Chromium; no masking:

| set | states | identical | differ | differences |
|---|---|---|---|---|
| 256-state matrix | 256 | 224 | 32 | `project-detail` 16, `projects-list` 16 |
| shell | 44 | 44 | 0 | — |
| lists | 210 | 202 | 8 | `list-projects` 8 |
| documents | 134 | 134 | 0 | — |
| archetypes | 282 (C2: 270) | 232 | 38 | `a08-projects` 10, `a09-project-kanban` 10, `a10-project-kanban-empty` 10, `c3-project-new` 4, `i03-kanban-task-edit` 4 (the page behind the dialog) — plus 12 new: `i06-kanban-card-focus`, `i07-kanban-keyboard-edit`, `i08-kanban-empty` |

Every differing state is a Projects state; every non-Projects state is byte-identical to C2. Inspected
by eye: list header (h1, New Project in the toolbar); detail at 1440 / 1024 / 768 / 390, EN / AR, light /
dark — PageHeader mirrored, pill then select at the end, 3-across cost KPIs and 2-column breakdown at
1440, breakdown stacked at 768 / 390, cost KPIs 2-across at 390, kanban 4 / 2 columns as before and
mirrored in AR, Tasks / Add Task mirrored, Amount at the logical end; interactions: focus ring on the
card, Edit Task for the focused card, Add Task focused above the EmptyState.

## Mutations

Static (`verify:page-archetypes`, `verify:status-registry`), each mutation applied alone in an isolated
worktree and restored: **58/58 caught** — the brief's 40 (§45 1–40) 40/40, the D-2 guards (§39:
`getProjectCostControl` call altered, its result overwritten in the page, profit recomputed, margin
recomputed; Profit / Margin / badge removal and project-costing.ts are §45 32–35) 4/4, extra 14/14
(COLUMNS reordered, a key handler, a timer focus, a second status map, Done badge replaced, hover rule,
kanban mobile columns, New Project duplicated, LogTimeDialog condition, FigureRow colour, `.acct-grid`,
ProjectForm touched, the 520px box removed, an id in the card name).

Runtime (normal build per mutation, `--only=project`): **6/6 caught** — card not focusable (tabIndex −1),
Enter no longer opens (pointer-only onClick), Escape does not return focus, breakdown two-column at 390,
physical `text-right` on Amount (RTL), injected overflow.

## Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack): C3 build `KoPz7iaPKw9YzbeRAjeVm`; the C2
reference build `D13TDfI3-9bRAHLGTvmMq` (exact c060e8b). No font mocks, no `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`.

## Deferred (not C3)

* `PRIORITY_STYLE` / `PRIORITY_LABEL` → DEV-UI-01.8 (as the Stage 1 audit decided).
* D-2 (whether Actual Profit / Profit Margin should exist for zero-cost projects) — a product question.
* New Project's form has two controls without an accessible name (`unnamed 2`, unchanged since C0;
  `ProjectForm` is out of C3's scope).
* The shared Dialog's close button reads "Close" in Arabic too (`src/components/ui/dialog.tsx`, not C3's).
* The cost control's drill tables keep `.num` and the lower FigureRow colours (§26).
