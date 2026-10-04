# DEV-UI-01.5 — Data tables & list workspace (implementation record)

The list layer moved onto one table foundation:
- the `Table` primitive gains `density`, `list`, numeric / action cells and an empty / no-results row;
- one card + contained-scroll wrapper, density tokens, logical alignment, a sticky named action column and a 36px row menu;
- the document list workspace's search, filters and saved views now use the 01.4 control primitives (Input, Select, Label, Button, Dialog).

This is **presentation and accessibility only**. None of the following changed: filter predicates, URL parameters, saved-view schema / scoping / actions / audit, handlers, permissions, convert targets, lifecycle, status registry, column configuration, DB or shell. There is no column engine, sorting, `aria-sort`, pagination or bulk selection.

| File | Content |
|---|---|
| `c1-correction.md` | **C1** — saved-view rename keeps its unlimited length (the 60-character UI limit applies to Save only), with verification. |
| `c2-correction.md` | **C2** — Views menu → Dialog focus handoff (conditional close-autofocus suppression), with focus-log runtime checks. |
| `datatable-audit.md` | The read-only audit (before state, sections A–AA). |
| `consumer-migrations.md` | Exact per-file consumer list. |
| `screenshot-change-report.json` | All 256 matrix states vs DEV-UI-01.4 (merged C1 state): status, console errors, #418, overflow and top-bar / sidebar pixels, before → after. |
| `list-states-report.json` | The 210 list / data-table states (definitions: `tests/ui-baseline/list-states.mjs`). |
| `controls-states-report.json` | The 112 control-gallery states recaptured vs the 01.4 candidates (only the RowMenu trigger moved). |
| `shell-regression-report.json` | The 44 shell states recaptured vs the 01.4 C1 recaptures. |
| `guardrails-after.json` | Report-only guardrails after this batch. |
| `../../../tests/ui-baseline/candidates/dev-ui-01-5/` | Candidate screenshots: 256 + `lists/` 210. Approved `baseline/` and the 01.1–01.4 candidates are untouched. |

## Locked decisions, as implemented

| | Decision | Implementation |
|---|---|---|
| AA-1 | Sticky action column | `Table` action head / cell → `data-cell="action"`: `position: sticky; inset-inline-end: 0`, `width: 1%`, `border-inline-start`, solid `--surface` (cells) / `--surface-raised` (header), row hover repainted on the sticky cell. Same CSS in LTR and RTL (left edge in Arabic). Tables without actions have no sticky column. Reachable at 390 without scrolling (runtime-measured EN / AR on 4 lists). |
| AA-2 | 36px RowMenu | `DropdownMenuTrigger asChild` → `Button variant="ghost" size="icon"` (36²; legacy 30px `.row-menu-btn` recipe scoped to `:not([data-slot="button"])`). `label` is required: `` `${t(locale,"Actions for")} ${number}` `` ("Actions for INV-0008" / "إجراءات INV-0008"). Placeholder items (no handler / href) are Radix `disabled` (aria-disabled, skipped by the keyboard, 45% opacity). The Convert item carries `aria-expanded`. Content is capped at `--radix-dropdown-menu-content-available-height` and scrolls. Entries, handlers, permissions and convert targets are unchanged. |
| AA-3 | Density | Tokens `--table-header-height` 40 / `--table-row-height` 48 (comfortable, default); `-compact` 36 / 40. Compact is only on ledger / journal / bank accounts / reports / settings tables. `TableSkeleton` follows the token (was 52px). |
| AA-4 | Saved views | `window.prompt` → Dialog (save, rename; Label + Input). **C1:** the Input's `maxLength` is 60 for Save only (= `saveViewAction`'s limit); Rename has no limit, as `renameViewAction` and the replaced prompt (see `c1-correction.md`). **C2:** *Save current view* and *Manage saved views* hand focus straight into their Dialog — the menu's close-autofocus is suppressed only for that handoff; every other close returns focus to the Views trigger (see `c2-correction.md`). The Views menu holds only menu items: *Save current view* · one item per view (applies it; the matching view is `aria-current` + marked) · *Manage saved views* → Dialog listing views with named Rename (→ the rename dialog) and Delete (→ the existing `useConfirm("view.delete")`) icon buttons. `saveViewAction` / `renameViewAction` / `deleteViewAction`, scoping, schema and audit are unchanged; there is no default-view concept. |
| AA-5 | Projects | The fake disabled Filters / Views / Export / Import controls are removed. |
| AA-6 | Negatives | `Num` in `finance/reports/reports-workspace.tsx` no longer adds `text-danger` for `v < 0` (sign and parentheses carry the meaning). Delta / variance badges keep their red. |
| AA-7 | Two filter models | The document workspace stays live (`set` on every change; Clear → `EMPTY_FILTERS`). Master data keeps FilterPanel Apply / Clear (URL params). Both show an active count. |
| Header | `PageHeader` frozen | `/clients` 390 overflow fixed from the page: `<PageHeader className="flex-wrap">`. Header copy on the three master-data list pages now goes through `t()`. |
| Excl. | | Configure Columns / column config, document editor, 19px page headings, StatRow (pinned by the status-registry suite), shell. |

## Primitive changes

- **`ui/table.tsx`**
  - `Table({ density = "comfortable", list })` → `<div class="data-table-wrap" data-density><table class="data-table" data-density data-list>`. The wrapper is the 12px card and the horizontal scroll container, with no shadow.
  - `TableHead({ numeric, action })` → `<th scope="col" data-cell>`. An action head renders its text `sr-only`, so the column is named but has no visible label.
  - `TableCell({ numeric, action, wrap })`.
  - `TableEmptyRow({ colSpan })` → `<tr data-empty-row><td colSpan>`.
  - The native `<table>` is retained.
- **CSS** (`mockup-parity.css`, data-table block):
  - Header: caption size, 600, uppercase, `text-align: start`. Cells: 13px body. Logical padding (block 4 / inline 16).
  - `separate` borders, so sticky cells keep their rules.
  - Numeric: `td[data-cell=numeric]` and legacy `td.num` use the numeric face, tabular figures, `text-align: end`, nowrap.
  - List tables (`data-list`) are nowrap unless a cell opts out with `wrap`.
  - Hover is on `--canvas`. `aria-selected` rows are tinted.
  - The empty row is centred with 40px padding.
  - `[dir=rtl] .data-table th` was split off from the doc-editor rule; `.doc-items-table` keeps its own rule.
  - The editor CSS is pinned by hash `93f29b299f31d7f9`.
  - The dead `.list-table` rules and the `.list-toolbar .topbar-search` override are removed.
  - `.toolbar-actions-right` uses `margin-inline-start: auto` (its `[dir]` override is gone).
- **`ui/list-search.tsx`** (new):
  - The list search box, built on Input: 36px, search icon at `start-3`, `ps-9`.
  - `aria-label` = the localized placeholder.
  - Optional clear button (`ghost icon-sm`, "Clear search"). It is shown only when non-empty and clears only the search.
  - Used by the document workspace, Projects, the three master-data toolbars and the recycle bin. The shell's `.topbar-search` is untouched.
- **`ui/filter-panel.tsx`**:
  - Trigger is a `Button secondary` with a count badge. Clear is `outline sm`, Apply is `primary sm`.
  - Labels come translated from the caller.
  - The Apply-based model is unchanged.
- **Workspace filters** (`list-workspace-toolbar.tsx`):
  - Fields: status Select, from / to `Input type=date`, party Select, archived Select.
  - Each field has a `Label htmlFor` bound to a `useId` id.
  - Active count = status + date range (counted as one) + party + archived ≠ default. Search is excluded.
  - The live behaviour, filter keys, `use-list-filters.ts`, `filter-types.ts`, `saved-view-actions.ts` and the export / import URLs are byte-identical (pinned).
- **No-results vs no-records**:
  - `rows.length === 0` keeps `ListEmptyState` (no records). It is now radius 12 with no shadow.
  - `filtered.length === 0` renders a `TableEmptyRow`: "No records match the current search or filters."
  - The "Showing X of Y" line is `role="status" aria-live="polite"`.
- **Products "Low stock ×"**: the clickable Badge is now a real `Button` chip with `aria-label` "Remove filter: Low stock".
- **Payroll lines**: `tabIndex=0`, Enter / Space select, `aria-selected`, a visible focus outline and the selected tint. Click behaviour is unchanged.

## Verification

Everything ran on the final code in isolated git worktrees with **no repository `.env`**. Database suites ran against fresh TEST-ONLY copies of the synthetic seed (`devui010_test_only_*`, host 127.0.0.1). The browser tier's temporary `.env` named only such a copy and was deleted after each run.

- **TypeScript:** clean.
- **ESLint:** 0 errors on all 60 changed TS / JS files.

### `verify:static`

Exit 0:

| Suite | Checks |
|---|---|
| role-matrix | 32/32 |
| confirm-policy | 62/62 |
| dirty-form | 66/66 |
| skeletons | 89/89 |
| contrast | 161/161 |
| typography | 43/43 |
| status-registry | 88/88 |
| shell | 75/75 |
| controls | 110/110 |
| **datatable** (new) | **66/66** |
| edit-action | 59/59 |

Also passing: store-model, provider-harness, backup-claims, money-precision and ledger-only-balances.

### `verify:datatable` (new, `verify/verify-datatable.mts`, wired into `verify:static`)

What it checks:
- **Table API:** only `density` / `list` / `numeric` / `action` / `wrap` / `TableEmptyRow`; `th scope=col`.
- **Density tokens:** 40 / 48 / 36 / 40, with exactly two modes.
- **Card wrapper:** radius 12, no shadow.
- **Type scale:** header and cells on the scale.
- **Logical CSS:** no physical alignment in table / list CSS or in any table consumer.
- **Numbers:** numeric cells end-aligned.
- **Action columns:**
  - every action head is named via `t()` and paired with a sticky action cell;
  - no empty `<TableHead />`.
- **RowMenu:**
  - Button trigger + required `label`; all 9 RowMenus use `` `${t("Actions for")} ${record}` ``;
  - placeholders truly disabled; content capped to the available height.
- **Record actions:** translated.
- **ListSearch:**
  - on every list; `.topbar-search` untouched;
  - master-data list header copy goes through `t()`.
- **Workspace filters:**
  - no native select / input;
  - five labels bound by id;
  - active-count formula;
  - live `set` + `EMPTY_FILTERS`.
- **FilterPanel:** Buttons + translated labels; the Low stock chip is a Button.
- **Projects:** no fakes.
- **Saved views:**
  - no `window.prompt`;
  - menu items only;
  - Manage dialog;
  - existing actions and `useConfirm`.
- **No-results / counts:** no-results rows; polite counts.
- **Small fixes:** status `<td>` not flex; payroll keyboard; reports `Num` without auto-red; `/clients` `flex-wrap`.
- **Exclusions:** no sort / pagination / bulk.
- **Contracts:** exact URL-param contract of the master-data toolbars.
- **Byte pins (sha256):** `use-list-filters`, `filter-types`, `saved-view-actions`, `document-list-workspace`, Configure Columns + column config, and the 11 document-editor files; plus the document-editor CSS hash.

**Mutation-tested: 45 mutations, 45 caught.**

### `verify-datatable-runtime` (new, browser tier, refuses a non-test database)

**123/123.** It covers:
- **Containment:** 10 lists × 1440 / 1024 / 768 / 390 × EN / AR — no page overflow, and the table scroll stays inside its wrapper.
- **Sticky actions at 390:** the action cell is visible without scrolling (EN / AR, 4 lists).
- **Density:** row heights 48 and compact 40.
- **Numbers:** amounts at the logical end in EN and AR.
- **RowMenu:**
  - 36² trigger with the localized row name;
  - keyboard skips disabled placeholders;
  - Convert opens from the keyboard with `aria-expanded`; Escape returns focus;
  - the expanded menu stays inside 1024×768 for every row.
- **Workspace filters and search:**
  - five labelled fields; live status filter; active count;
  - date range counts as one; Clear;
  - search label and polite count; no-results row; clear-search clears only the search.
- **Saved views:**
  - save dialog → menu item → apply marks the current view;
  - Manage → rename dialog → delete through the confirmation.
- **Master data:**
  - clients `Enter → ?q=` server search;
  - products FilterPanel `?lowStock=1`, count, chip removes;
  - Arabic header / create / Recycle Bin translated.
- **Payroll:** keyboard selection (`aria-selected`, focus ring).
- **Shell:** the account menu is still fine.

**Runtime mutations (each with a fresh build): 6 / 6 caught.**

| Mutation | Result |
|---|---|
| RowMenu name removed | caught |
| Physical `text-align: right` restored on numeric cells | caught (Arabic `endGap` 31.6px) |
| Sticky action column → static | caught (12 failures) |
| No-results row removed | caught |
| Workspace filter label unbound | caught |
| RowMenu height cap removed | caught (menu top −39px) |

### Full browser tier

**45 / 45 suites pass.** Selected results:

| Suite | Result |
|---|---|
| datatable-runtime | 123/123 |
| shell-runtime | 341/341 |
| controls-runtime | 302/302 |
| dirty-core | 72/72 |
| dirty-ui | 8/8 |
| confirm-e2e | 34/34 |
| edit-e2e | 132/132 |
| favorites | 20/20 |
| skeleton-runtime | 11/11 |

Also passing: color-theme, dark-theme, staff-runtime and vendor-inline.

`verify-skeleton-runtime` first failed 10/11 inside the tier and passed 11/11 after a selector-only adaptation (below).

### Guardrails (report-only)

| Guardrail | Entry | After |
|---|---|---|
| G1 | 176 | **97** (−79) |
| G2 | 326 | **302** (−24) |
| G3 | 44 | **35** (−9) |
| G4 | 0 | 0 |
| G5 | 30 sites · 27 keys | 30 · 27 |

Every decrease is in list / table files: `mockup-parity.css` table / toolbar rules, the list clients, master-data pages / toolbars, finance / HR / settings tables and the workspace toolbar. No file increased. G5 holds because all new copy (37 keys) is in the dictionary.

### Existing suites adapted — selector only, no assertion changed

`verify/verify-skeleton-runtime.mjs` located the list empty state by its old class `.rounded-2xl.border`. The card is now 12px (`rounded-xl`), so the locator found nothing. It now uses the component's `[data-list-empty]` hook, and the dark-mode solid-background assertion is unchanged.

`verify/verify-controls.mts`: the 01.5-owned files left its "not yet migrated" exclusion list; 01.6 files stay on it. FilterPanel's Clear follows its existing outline rule.

### Screenshots

- **256-state matrix:** two runs on the final code, each from a fresh build → **256 / 256 byte-identical**.
  - **Versus DEV-UI-01.4** (the committed 01.4 candidates; C1 left them byte-identical): 144 identical, 112 changed (every list, recycle-bin, report, settings and detail table).
  - **Errors:** 0 non-200; React #418 40 → 40 (pre-existing); 0 other console errors.
  - **Overflow:** 24 → **20** states, none increased.
    - `/clients` 390: EN 37 → **0**, AR 29 → **0**.
    - Invoice detail 390: EN 298 → 287, AR 302 → 253 (its tables now scroll inside the card).
  - **Height:** no page grew taller; 64 got shorter.
  - **Shell chrome:** **0 changed pixels in the top bar and sidebar.** Four Arabic 390 states are reported as changed only because the narrower page moves the RTL top bar; viewport-aligned they show 0. Details in `screenshot-change-report.json`.
- **List / data-table states** (`capture-lists`, new): **210 states**, twice → **210 / 210 byte-identical**; 0 non-200, 0 overflow, 0 console errors apart from #418 on Arabic Projects / Journal (debt 2).

  | Area | States |
  |---|---|
  | Invoices | normal (light + dark), search, no-results, filters open / active, Views menu, Manage saved views, row menu (light + dark), Convert expanded |
  | Clients / Products / Vendors | normal, filter panel, record menu |
  | Other lists | Payments, Projects, Attendance, Journal (compact, scrolled to the table) |
  | Empty states | Sales Orders (empty module), Recycle Bin |

  - Axes: EN / AR × 1440 / 1024 / 768 / 390 light, with dark 1440–390 for the invoice normal / row-menu states.
  - Arabic sticky + numeric: in every AR state, plus `inv-sticky-scrolled` at 390 (EN / AR).
  - Committed as `candidates/dev-ui-01-5/lists/`; per-state detail in `list-states-report.json`.
- **Control gallery:** 112 states recaptured twice (byte-identical).
  - 100 are byte-identical to the 01.4 candidates.
  - The 12 `menus` states changed: the 36px RowMenu trigger also pushes the submenu demo down 6px.
  - Details in `controls-states-report.json`.
- **Shell regression:** the 44 shell states were recaptured twice (byte-identical). Against the 01.4 C0 shell capture:
  - 36 identical;
  - 4 = the Arabic open-menu states C1 already changed;
  - 4 = `/recycle-bin` page content (`shell-s10`).
  - **0 top-bar / sidebar pixels** changed by this batch.
  - Details in `shell-regression-report.json`.

## Known remaining debt

1. **Payroll at 390px** has page overflow (57px EN / 40px AR). It comes from the payslip card in the page's two-column layout. This is page-archetype work, and the overflow is identical on main.
2. **React #418** (text hydration mismatch) on Arabic `/projects` and `/finance/journal`. It is already present in every candidate since the 01.0 baseline for `/projects`. Journal only received `density="compact"` in this batch. Arabic date / number formatting between server and client is the suspected cause, and it is not list-layer work.
3. 19px page headings, `PageHeader` copy on the remaining modules, and the KPI `StatRow` figures (inline 11.5px / 800 / 20px) belong to page-archetype work.
4. The radius-12 card and density are now shared. Statements and payment-history tables were already logical and were left as they were.
5. Document detail line tables (`[id]/page.tsx`) and the line-items editor are DEV-UI-01.6.
6. Inline-submenu roving focus: the hidden Convert targets are correctly skipped while collapsed. This is Radix behaviour and needs no change.
7. The unlayered `* { border-color }` rule (01.4 debt 1) still forces `!` on some border utilities, for example the Low stock chip's `border-warning!`.
