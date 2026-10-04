# DEV-UI-01.5 — READ-ONLY DATATABLE / LIST WORKSPACE AUDIT

> Read-only audit delivered before implementation (baseline `4768611`). Kept verbatim as the *before* record;
> the reviewer's decisions AA-1…AA-7 and their implementation are in `README.md`.

**Summary:** the app has **one shared table primitive but no DataTable system**.
- `ui/table.tsx` is a thin set of class wrappers.
- Every list builds its own columns, cells, alignment and row actions on top of it.
- Above the table there are four separate toolbar/filter systems and two row-action systems.
- No list has sorting, pagination or selection.

The good news is horizontal overflow. Every measured table already scrolls inside its own container. The only page-level overflow on a list page is `/clients` at 390px (37px EN, 29px AR), and it comes from the page-header actions, not the table.

The main defects:
- **Arabic number alignment:** numbers align to the right in Arabic (the inline start), not the inline end.
- **Unnamed row-menu buttons:** the shared row-menu button has no accessible name.
- **No search-result state:** a search with no results shows an empty table with no message.
- **No density control:** row heights vary from 55 to 123px, because headers and cells wrap with nothing controlling it.

Configure Columns is **not a list feature**. It configures document line-item columns, so it belongs to DEV-UI-01.6.

## A. Baseline
| | |
|---|---|
| local `main` | `476861128617c90f413408f6e9b03011f88bc2a8` |
| `origin/main` (ls-remote) | `476861128617c90f413408f6e9b03011f88bc2a8` |
| tree | `d5054271a2576653ceafdb3fccd1c840b116c334` |
| working tree | clean, before and after |
| DEV-UI-01.5 branch | none (no remote head matches `01-5`, `01.5` or `datatable`) |
| files modified | none |

- **Evidence:**
  - source reading of every table and list consumer;
  - the guardrails JSON;
  - a read-only Playwright probe of a clean `main` worktree.
- **Probe database:** a TEST-ONLY copy of the synthetic seed (`devui010_test_only_run` on 127.0.0.1). I ran it with the harness's own isolation checks; the repository `.env` was never loaded.
- **Probe coverage:**
  - 13 list routes at 1440, 1024, 768 and 390;
  - EN and AR in light, plus EN dark at 1440;
  - interaction probes on Invoices.
- **The probe changed nothing in the repo.** I had to start the local PostgreSQL cluster, which was down. That is local infrastructure, not production.

## B. Architecture map
**Primary system: the 8 document lists** (quotations, sales orders, proforma, invoices, delivery challans, credit notes, purchase orders, debit notes).
```
page.tsx (server: loads ALL non-deleted rows for the org + savedViews + statusOptions)
└─ *-list-client.tsx (client)
   ├─ page heading <h3 text-[19px] font-bold>  (local, not PageHeader)
   ├─ StatRow (sales/_shared/stat-row.tsx: 4 KPI cards, statusStat from the registry)
   ├─ ListWorkspaceToolbar (documents/_workspace/list-workspace-toolbar.tsx)
   │   ├─ search: raw <input> in .topbar-search (live, client-side)
   │   ├─ Filters: Popover with native <select> ×3 + <input type=date> ×2, "Clear filters" (.btn-glass)
   │   ├─ Views: DropdownMenu: Save (window.prompt) / apply / rename (window.prompt) / delete (useConfirm)
   │   └─ actions: Export (DropdownMenu → /documents/export), Import (ImportV2Dialog | ImportDialog), Recycle Bin, Create
   ├─ useListFilters (state in useState; filters the rows array client-side)
   ├─ ListEmptyState (only when rows.length === 0)
   ├─ <Table> (ui/table.tsx) + hand-written <TableHead>/<TableCell> per module
   │   └─ RowMenu (sales/_shared/row-menu.tsx) → DropdownMenu + inline "Convert to…" expansion
   └─ "Showing X of Y …" text
```
**Other systems:**
1. **Master-data lists** (clients, products, vendors):
   - server `page.tsx` + `PageHeader`, with search via URL `q` (server `ilike`, submitted on Enter);
   - `*-toolbar.tsx` with an `Input` and the `FilterPanel` (`ui/filter-panel.tsx`: Apply/Clear, URL);
   - `*-record-actions.tsx` row menus (ghost icon Button, 36px, labelled);
   - an inline `Card` empty state.
2. **Projects:** the legacy `ListToolbar`. Search is live and client-side. Filters, Views, Export and Import are all **disabled placeholders**.
3. **Recycle bins:**
   - the documents bin (`recycle-bin-client.tsx`) has live client search and inline text buttons (Restore / Permanent Delete);
   - the clients/products/vendors bins are plain tables.
4. **Finance, HR and settings tables:**
   - plain `<Table>` with no toolbar;
   - Payments (no search or filters), journal "recent 15", bank-accounts "recent 10";
   - attendance, leave, payroll (row click selects a payslip), ledger, reports, statements;
   - security, team, compliance, the presets panels.

**Verdict on the four options:** option 3 (a shared workspace plus module-specific tables) together with option 4 (duplicated table logic). There is no single reusable DataTable.
- The 8 document list clients duplicate their table markup almost line for line.
- Master data, Projects and the bins each have their own toolbar.

## C. Table/list inventory
| Route / module | Implementation | Shared pieces | Columns | Sort | Search | Filters | Pagination | Views | Col-config | Select | Bulk | Row actions | Mobile (390) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 document lists | `*-list-client.tsx` | Table, ListWorkspaceToolbar, useListFilters, RowMenu, StatRow, ListEmptyState | 7–10, fixed | — | live, client-side, not in URL | status, date from/to, party, archived (Popover, live) | — (all rows) | yes (user+org, filters only) | — | — | — | RowMenu (30px, unnamed) | contained table scroll; actions off-screen; toolbar wraps to 178px |
| Clients / Vendors | `page.tsx` + `*-toolbar.tsx` | Table, FilterPanel, Input, Checkbox | 5 | — (server `orderBy name`) | URL `q`, Enter, server `ilike` | include archived (Apply) | — | — | — | — | — | `*-record-actions` (36px, named) | clients: **page overflow 37/29px** (header actions); vendors contained |
| Products | same | same | 6 | — | URL `q` | low stock, include archived (Apply) + "Low stock ×" badge | — | — | — | — | — | record actions | contained |
| Projects | `projects-list-client.tsx` | Table, ListToolbar (mostly disabled), RowMenu | 8 | — | live, client-side | disabled placeholder | — | disabled | — | — | — | RowMenu | contained |
| Documents bin | `recycle-bin-client.tsx` | Table | 6 | — | live, client-side | — | — | — | — | — | — | inline Restore / Permanent Delete buttons | (seed empty — not measured) |
| Clients / Products / Vendors bins | `recycle-bin/page.tsx` | Table | 3 | — | — | — | — | — | — | — | — | inline buttons | seed empty |
| Payments | `payments-list-client.tsx` | Table | 9 | — | — | — | — | — | — | — | — | PDF button | contained |
| Journal (recent) | `journal/page.tsx` | Table | 3 | — | — | — | `limit(15)`, not paged | — | — | — | — | — | contained |
| Bank accounts (recent) | `bank-accounts/page.tsx` | Table | 5 | — | — | — | `limit(10)` | — | — | — | — | edit icon | — |
| Ledger / Reports / Statements | `account-ledger-view`, `reports-workspace`, `statement-view` | Table | 6–9 | — | reports: account search | report params (URL) | — | — | — | — | — | — | contained |
| HR attendance / leave / payroll | pages / clients | Table | 3–6 | — | — | leave: Select | — | — | — | payroll: single-row click | — | leave: buttons | contained |
| Settings (team, security, compliance, presets ×6, reference) | panels | Table | 3–6 | — | — | — | security 50, compliance 50/500 | — | — | — | — | DropdownMenu / ghost icons | — |

Only the "SORT" hits in the grep are `Array.sort()` on party options; no column sorting exists. There is no `aria-sort` anywhere.

## D. Shared DataTable foundation
**`ui/table.tsx`:**
- an `overflow-x-auto` wrapper plus class-less `thead/tbody/tr/th/td` pass-throughs;
- no density, alignment, sort, empty or sticky API.

**`.data-table` CSS** (`mockup-parity.css` lines 99–117, 262, 387–391):

| Property | Value | Against Navy Command |
|---|---|---|
| Radius | **14px** | off the 4·6·8·12 family |
| Surface | `--surface` | |
| Border | 1px `--line` | |
| Shadow | `--shadow-card` | |
| Header | 11px, 600, uppercase, 0.05em tracking, `--ink-faint`, `--surface-raised` (dark rgb(32,37,63)) | 11px = caption |
| Cell text | **13.5px** | off the type scale (body is 13) |
| Cell padding | 13px block; inline 20px (12px for `list-table`) | inline set via physical `padding-left/right` |
| Header alignment | `text-align: left` + `[dir=rtl] … right` | physical; needs an override |
| Numeric cells | `td.num` / `th.num` `text-align: right`; `.text-right` in 63 places, `text-end` once | physical — **wrong in Arabic** |
| Hover | `--canvas` | |
| Selected state | none (payroll only bolds the cell) | |
| Sticky header / column | none | |
| Dark mode | follows tokens | |

`.row-menu-cell` is centred. `table.data-table.line-table` belongs to the document editor (01.6) — the safe-region note is in §Y.

## E. Density findings (measured, EN light; header / first row, px)
| | 1440 | 1024 | 768 | 390 |
|---|---|---|---|---|
| Invoices | 47 / 57 (8/8 rows visible) | 67 / 87 (4 visible) | 67 / 87 | 67 / 87 (3 visible) |
| Quotations | 67 / 67 | 67 / 87 | 67 / 87 | 67 / 87 |
| Purchase orders | 67 / 67 | 67 / 87 | 67 / **107** | 67 / 107 |
| Clients | 47 / 63 | 47 / 63 | 47 / 67 | 47 / 99 |
| Products | 47 / 63 | 47 / 63 | 67 / 67 | 87 / 87 |
| Payments | 47 / 55 | 67 / 87 | 67 / 87 | 67 / 87 |
| Journal (14px pad) | 47 / 55 | 47 / 55 | 47 / 55 | 47 / 55 |

- **Arabic is taller still:** invoices 51/57 at 1440 and 75/99 at 390; purchase orders reach 123px rows.
- **Cell inline padding** is 20/20px (journal 14/14).
- **The 47px header and 55–63px rows are the floor.** Everything above that is wrapping, because there is no `white-space` or min-width policy on headers or text cells.
- **Action targets:** RowMenu 30×30px; record actions 36×36px.
- **Coupling:** `TableSkeleton` hard-codes a 52px row to match `.data-table` (`verify:skeletons` checks the column count).
- **No density model exists** — neither a comfortable/compact token, a class nor a prop. One needs introducing: comfortable plus compact, no third mode.

## F. Column/configuration findings
- Every list table has fixed columns, hand-written per module. The only width hints are `w-10`/`w-12` on the action column and `max-w-[150px] truncate` on Title.
- No min/max widths, no responsive column hiding, no persisted list-column preferences, no locked columns. The action column is just the last header (empty `<TableHead>`, no accessible name).
- **Business vs presentation:**
  - The column sets per module are business content; keep them.
  - Widths, nowrap, truncation, alignment and the action column are presentation, and belong to 01.5.

## G. Sorting findings
- No table supports sorting. Server queries use a fixed `orderBy` (e.g. clients by name, journal by date desc).
- No indicators, no keyboard path, no URL state.
- Per the instruction, none should be introduced. "Sort-icon RTL mirroring" therefore does not apply.

## H. Search findings
| System | Input | Debounce | URL | Semantics | Clear | Label |
|---|---|---|---|---|---|---|
| Workspace (8) | raw `<input>` in `.topbar-search` (38px, radius 10px — off family) | none (client-side `filter()` on every keystroke) | no | substring over number / party / title | no (×) | **none** (placeholder only) |
| Master data (3) | `Input` + icon at physical `left-3` / `pl-9` | n/a (Enter submits) | `?q=` | server `ilike` name/email | no | **none** |
| Projects, documents bin | raw `<input>` | none | no | client substring | no | none |

- **No-results:** the workspace renders an empty table body with no message ("Showing 0 of 8 Invoices."). Master data shows `No clients match "…"` (hardcoded English).
- **Should move onto the 01.4 primitives:** every list search should become the `Input` foundation, with a logical inline-start icon (`start-3` / `ps-9`), an accessible name, and optionally a clear button. The search semantics stay unchanged.

## I. Filter findings
**Two filter shells:**
- **Workspace Popover** — live-apply, local state, dot-only active indicator, no count, no chips:
  - fields: status `<select>`; date-from and date-to `<input type="date">`; party `<select>`; archived `<select>`;
  - all native, 42px tall (legacy `.input`), `<label>`s with no `htmlFor` (**0 of 5 controls labelled**, measured);
  - "Clear filters" is a `.btn-glass`.
- **`FilterPanel`** — Apply/Clear, URL-backed:
  - fields: `Checkbox` + `Label` (good);
  - "Clear" / "Apply Filters" are hardcoded English; Clear is an 11.5px text link;
  - active state is an orange-tinted trigger. Products adds a "Low stock ×" badge (a `Badge` with `onClick`, so it is not a button).

**Projects:** the filter trigger is a disabled placeholder.

**Containment:** popovers are contained at 390 (EN 102–390, AR 0–288) and RTL.

**Shared presentation vs module logic:**
- Shared presentation (01.5):
  - trigger, panel chrome, field components (Select / Input / date field on the 01.4 foundation, labelled);
  - active count, chips, Clear/Apply placement.
- Module business logic (untouched): the filter keys, `useListFilters` predicates, URL params, `filtersToParams`, and the export query.

## J. Saved-view findings
- **Ownership:** `saved_views` table, scoped by org **and** user, per module (one of the 8 document types).
- **Content:** `config` = `ListFilterState` (search, status, dates, party, archived) only — no columns, no sort.
- **Create:** `window.prompt` name, max 60 characters; saving the same name updates (upsert).
- **Rename:** `window.prompt`. **Delete:** `useConfirm("view.delete")`. All three are audited.
- **Apply:** `setFilters(v.config)`, client state only; nothing marks a view as active.
- **No default view. Permissions:** any signed-in user, own views only.
- **Presentation bugs to fix in 01.5, data model untouched:**
  - `window.prompt` (unstyled, not translatable chrome);
  - the rename/delete icon buttons sit inside the menu as plain `<button>`s with `title` only: not menu items, so **unreachable by keyboard** within the Radix roving focus and unnamed for screen readers;
  - no current-view indication.

## K. Configure-columns findings
- **Scope:** `configure-columns-dialog.tsx` is used only by the 5 document **forms** (quotation, sales order, proforma, invoice, purchase order) to configure **line-item** columns.
  - persisted per org + user + documentType in `document_column_configs`;
  - custom text/number/formula columns, widths in %, a locked Actions column, required columns.
- **It never touches list tables, so it is 01.6 scope.**
- **Gaps observed (for 01.6):**
  - reordering is HTML5 drag only (no keyboard reorder);
  - native `<select>` / `.input` controls;
  - `.btn` buttons.
- **01.5 should not touch it.** That includes capturing it as a list state.

## L. Row-action findings
**Two systems:**
- **`RowMenu`** (8 document lists + Projects):
  - `.row-menu-btn` is 30×30px with **no accessible name** (measured null). 01.4 fixed its focus, typography and RTL direction.
  - Up to 8 items, item height 38px EN / 40px AR; a "Convert to…" inline expansion; `danger` items.
  - Contained at 390 and RTL at 1440/390.
  - Placeholder actions ("Record Payment", "Send Reminder", and Delete when not allowed) are greyed with `pointer-events-none` but are **not** `disabled` / `aria-disabled`. They stay focusable, Enter does nothing, and they are announced as enabled.
- **`*-record-actions`** (clients, products, vendors):
  - `Button variant="ghost" size="icon"` (36px), named ("Client actions" — hardcoded English);
  - `useConfirm` for archive/delete; labels hardcoded English.

**Elsewhere:**
- **Recycle bins:** inline text Buttons; the long "Permanent Delete" label widens the column.
- **Links:** the document number is the row's only link; the row itself is not clickable.
- **Reachability at 390:** the action column is last, so in every list the trigger is outside the viewport until the table is scrolled (`inViewport=false` for all lists at 390, and for document lists at 768).

## M. Selection/bulk findings
- **None.**
- Payroll has single-row master/detail selection: `onClick` on the `<tr>`, **mouse-only** (no keyboard, no `aria-selected`), selection shown only by bold text.
- No checkboxes, select-all or bulk actions anywhere — none to be invented.

## N. Pagination findings
- **None.**
- Every list loads all rows. Journal (15) and bank accounts (10) show a fixed "recent" slice; security (50) and compliance (50/500) cap with `limit()`.
- The count line exists only on the document lists ("Showing X of Y").
- Nothing to converge. Introducing pagination would change data loading (business), so it is out of scope.

## O. Empty/loading/error findings
- **Initial loading:** `loading.tsx` + `TableSkeleton` (real column count, 150ms delay) on 21 list routes. Good, and checked by `verify:skeletons`.
- **Refresh loading:** none (client filtering is instant; master data re-navigates).
- **No records:**
  - `ListEmptyState` (document lists): `rounded-2xl` (16px, off family), 12.5px hint, `.btn-primary` with an inline `width:auto`;
  - master data: `Card` with hardcoded English;
  - other tables: an inline "No … yet" row or text.
- **No search / filter results:** missing on the document lists (empty `<tbody>`); master data uses the same card as "no records".
- **Permission-denied:** server guard redirect, nothing list-level.
- **Fetch error:** the generic `(app)/error.tsx` boundary only; no retry inside lists.
- **Shared presentation to standardise (01.5):** the empty / no-results / filtered-empty blocks. The module copy stays.

## P. Status / numeric / date findings
- **Status:** `StatusBadge` from the registry everywhere (G4 = 0).
  - In Clients, Vendors and Products the status `<TableCell>` has `className="flex …"`, which turns the `<td>` into a flex box and breaks table-cell layout (borders and vertical alignment).
  - Archived shows as an extra Badge. No status column width or nowrap policy.
- **Numbers:**
  - `Money` / `DocNum` use the approved formatter with `num-tabular` (Western digits, good);
  - alignment is physical `right` (§Q);
  - quantities in Products are physical `text-right`.
- **Negatives:** no parentheses formatter exists. Finance reports colour negatives red (`reports-workspace.tsx:65`, `v < 0 ? "text-danger"`), which **conflicts with the locked direction** "do not automatically turn negatives red".
- **Document numbers:** `font-mono` (correct: codes and IDs).
- **Dates:** raw ISO `YYYY-MM-DD` strings with no formatter. No Hijri option in lists. Dates and amounts use `nowrap` only in `list-table`, which no list uses.

## Q. RTL findings (list/table-local only)
- **Numeric cells and headers** compute `text-align: right` in Arabic on every list (measured on all 13). That is the inline start, not the end. The fix is logical `end` in `.data-table` and the 63 `text-right` table usages.
- **Header text:** physical `left` plus a `[dir=rtl]` override (works, but is a G1 hit).
- **Cell padding:** physical `padding-left/right` (symmetric, harmless; G1 hit).
- **`.toolbar-actions-right`:** `margin-left: auto` plus a `[dir=rtl]` swap. Could be `margin-inline-start: auto`.
- **Master-data search icon:** `left-3` / `pl-9` (physical). Visually wrong side in Arabic.
- **Horizontal scroll:** starts at the inline start in both directions (browser default for RTL tables, correct). There is no sticky column to mirror.
- **Already correct:** row-menu placement (01.4-C1 RTL), filter popover RTL, header `letter-spacing` (globally neutralised for Arabic in `globals.css:370`).

## R. Responsive / mobile findings (measured)
| Route | 1440 | 1024 | 768 | 390 (page overflow · table wrap client/scroll width · toolbar height) |
|---|---|---|---|---|
| Invoices EN / AR | 0 · fits | 0 · fits | 0 · 736/849 (AR 736/772) | **0** · 366/849 (AR 366/772) · 178 |
| Quotations | 0 | 0 · 910/926 | 0 · 736/926 | 0 · 366/926 · 178 |
| Purchase orders | 0 | 0 | 0 · 736/906 | 0 · 366/906 (AR 838) · 178 |
| Clients | 0 | 0 | 0 | **37 EN / 29 AR** · 366/553 · 36 |
| Products | 0 | 0 | 0 | 0 · 366/566 |
| Vendors | 0 | 0 | 0 | 0 · 366/519 |
| Payments | 0 | 0 | 0 · 736/843 | 0 · 366/843 |
| Projects | 0 | 0 | 0 | 0 · 366/726 · 178 |
| Attendance / Journal | 0 | 0 | 0 | 0 · contained |

- **Table scroll is contained everywhere** (`overflow-x: auto` wrapper). Category 1, acceptable.
- **The only page-level overflow (category 2) is `/clients` at 390.** The offender is the `PageHeader` actions `div.flex.shrink-0` (Import + Recycle Bin + New Client), ending at x=427. `page-header.tsx` lives in the frozen `components/layout/` (decision AA-4).
- Vendors and products have the same header but shorter labels, so they fit. The earlier DEV-UI-01.3/01.4 "390 debt" on invoice detail and the editor is **document/form overflow (category 3, 01.6)**. Client detail is an entity page, not a list.
- **Toolbar:** wraps to 4 rows (178px) at 390 on the workspace and to 2 rows (86px) at 1024/768.
- **Filters:** usable and contained.
- **Row actions:** reachable only after scrolling the table horizontally.
- **Pagination:** none.
- **Dark mode:** geometry identical to light; header `rgb(32,37,63)`; shadow and border present.

## S. Accessibility findings
- **Good:** `<table>` semantics; `<th>` in `<thead>` (implicit column scope); keyboard-operable Radix menus and popovers; skeletons `aria-busy`.
- **Defects:**
  - **RowMenu trigger unnamed** (all 8 document lists + Projects);
  - **empty action `<th>`**, no `sr-only` label;
  - **search inputs unlabelled** (all systems);
  - **filter fields unlabelled** (workspace);
  - **Views rename/delete** not menu items (no keyboard access, `title` only);
  - **placeholder row actions** not `aria-disabled`;
  - **payroll row selection** mouse-only;
  - **"Showing X of Y"** is not a live region, so filtering is silent to screen readers;
  - **hardcoded English** in master data (headers, empty, actions, `FilterPanel`).
- **Not applicable:** sort and pagination names don't exist.

## T. Touch-target findings (390)
| Target | Current size | Notes |
|---|---|---|
| RowMenu trigger | 30px | below compact 32 |
| Record actions | 36px | |
| Workspace pills (`.doc-pill-btn`) | 36px | |
| `.btn` actions | 36px | |
| `FilterPanel` trigger | 32px (`sm`) | |
| Search box | 38px | |
| Filter fields | 42px (legacy `.input`) | |
| Views rename/delete | ≈26px (`p-1.5` + 14px icon) | **genuine exception, too small** |
| Products "Low stock ×" badge | ≈20px | **genuine exception, too small** |
| Recycle-bin Restore / Delete | 36px | |

**Proposal:**
- **Sizes:** controls on the 01.4 sizes (36 default, 32 compact); the RowMenu trigger per AA-2.
- **Fix:** the two genuine exceptions above.
- **Not proposed:** a blanket 40px.

## U. Guardrail attribution (current G1 176 / G2 326 / G3 44 / G4 0 / G5 30·27)
- **G1 — 45 list-local:**
  - document lists 2 each (header + amount `text-right`) ×8;
  - clients 1, products 5, vendors 1, bins 2 each ×3;
  - payments 2, projects 2, documents bin 1;
  - the 3 master toolbars (`left-3`, `pl-9`) = 6;
  - `mockup-parity.css` 7 (115, 373, 377, 387 padding/margin left/right).
- **G2 — 37 list-local:**
  - `.data-table td` 13.5px;
  - `.topbar-search` 12.5px;
  - `line-table` 12.5px (01.6 region — exclude);
  - list headings 19px ×10;
  - "Showing…" 11.5px ×9; 12.5px cells;
  - `stat-row` 11.5px; `list-empty-state` 12.5px; `filter-panel` 11.5px; workspace views 11.5px.
- **G3 — 9 list-local:**
  - `list-workspace-toolbar.tsx` ×6 (search, selects, dates `outline-none`);
  - `list-toolbar.tsx`; `recycle-bin-client.tsx`;
  - `row-menu.tsx` `outline-none` (already overridden by the 01.4 CSS, but the static hit remains).
- **G4:** 0, must stay 0. **G5:** none of the 27 missing keys are list-specific. The hardcoded English in master data is literal text, not `t()` gaps, so G5 does not count it.
- The 19px list headings are page-heading archetype — propose deferring them, not part of 01.5.

## V. Shell / control dependencies
**Must reuse (01.4 approved):**
- `Button` (incl. `ghost icon`, `icon-sm`, `destructive-ghost`);
- `Input`, `Select`, `Checkbox`, `Label`;
- `DropdownMenu` (RTL wrapper), `Popover`, `Dialog`;
- `--danger-hover`, the focus-visible recipe.

**Hard dependencies:**
- `.doc-pill-btn` and `.btn` (restyled in 01.4) are used by the workspace toolbar;
- the `.row-menu*` CSS is shared with the shell's account menu (only `.row-menu-item`; any change re-verifies the shell).

**Shell frozen:**
- the `/clients` overflow sits in `components/layout/page-header.tsx` (not shell chrome, but in the frozen directory) → AA-4;
- `.topbar-search` is shared by the shell's search box and list toolbars → **list-specific styling must use a list class, not edit `.topbar-search`**.

## W. Screenshot plan (proposal; nothing captured)
- **Existing 256 states that cover lists:**
  - `sales-invoices-list`, `sales-quotations-list`, `clients-list`, `inventory-products`, `projects-list`: 80 states, normal state only;
  - `finance-reports` and `finance-statements` tables: 32.
- **Proposed additive `capture-lists` mode:** real app routes on the deterministic seed, actions driven by keyboard and mouse, EN/AR × 1440/1024/768/390 light, plus dark at 1440.
  1. Invoices: normal, search active, no search results, filters open, active filters (status + date), Views menu open, row menu open, convert submenu expanded (8 × 8 + dark 8 × 2 = **80**).
  2. Clients, Products, Vendors: normal (with record actions), filter panel open, record-actions menu open (3 × 3 × 8 = **72**).
  3. Payments, Projects, Attendance, Journal: normal (4 × 8 = **32**).
  4. Empty: Sales Orders (seed has none) (**8**) plus the documents recycle bin (**8**).
- **Total ≈ 200 states,** reproducible twice.
- **Not applicable:** selection and pagination (they don't exist); Configure Columns (01.6).
- **Prior candidates** (baseline, 01.1–01.4) stay untouched. A new `candidates/dev-ui-01-5/` holds the 256 + `lists/`.

## X. Verification plan
**`verify/verify-datatable.mts`** (static, in `verify:static`):
- **`.data-table` CSS:**
  - radius in family; header and cell sizes on the type scale;
  - logical alignment (no physical `text-align`, padding or margin in the table/list rules, no `[dir]` overrides);
  - the density tokens exist and the skeleton row height equals the comfortable row.
- **Numbers:** numeric cells use the logical end; no `text-right` in the table consumers.
- **Accessible names:** every `RowMenu` trigger and action `<th>` named; search inputs and filter fields labelled.
- **Controls:**
  - no native `<select>` / `<input type=date>` in list toolbars;
  - no `window.prompt` in saved views;
  - Views rename/delete are menu items or buttons with names;
  - placeholder actions use `disabled`.
- **Empty states:** the no-results state is present in every document list.
- **Status:** StatusBadge only (G4 = 0); no `flex` on `<td>`.
- **Boundaries:** the `useListFilters` predicates, `filtersToParams`, saved-view actions and the URL params are byte-identical; DataTable is used in the list files; the 01.6 files are untouched.
- Mutation-tested (≈30 mutations).

**`verify/verify-datatable-runtime.mjs`** (required; TEST-ONLY browser tier):
- **Layout:**
  - page overflow 0 and contained table scroll on every list at 1440/1024/768/390 EN/AR;
  - measured header/row heights match the density tokens;
  - numbers end-aligned EN and AR;
  - action reachability at 390 (per AA-1).
- **Behaviour:**
  - row menu: name, keyboard open, convert, Escape focus return;
  - filters: open/close, labelled fields, active count;
  - search: label, no-results message, live count announcement;
  - Views: keyboard rename/delete reachable;
  - payroll row keyboard select.
- **Regressions:**
  - **business invariants:** filter results equal before/after for a fixed query set, and `?q=` server search unchanged;
  - shell menus unaffected.
- **Runtime mutations:** RowMenu name removed, numeric `right` restored, no-results message removed, sticky/containment broken.

## Y. Proposed DEV-UI-01.5 implementation scope (exact files)
| File | Class | Purpose / why 01.5 |
|---|---|---|
| `src/components/ui/table.tsx` | reusable primitive | density (`comfortable` / `compact`), `numeric` cells (logical end), optional sticky end column (AA-1), named action header, `TableEmpty` / no-results row |
| `src/app/(app)/mockup-parity.css` — **only** the `table.data-table`, `.list-table`, `.list-toolbar`, `.toolbar-actions-right`, `.row-menu-btn` (size), `.row-menu-cell`, `.stat-row-2` rules | CSS | tokens, radius 12, type scale, logical props. **Exclude** `.line-table`, `.doc-items-table`, `.totals-strip` and `.topbar-search` (shell) |
| `src/app/globals.css` | CSS tokens | `--table-row-height` / `--table-row-height-compact` (and header) only |
| `src/components/ui/skeleton.tsx` — `TableSkeleton` row height | reusable primitive | keep the skeleton row equal to the density token |
| `src/app/(app)/documents/_workspace/list-workspace-toolbar.tsx` | shared workspace | Input search (labelled, logical icon, clear); filter fields → Select / Input / date on the 01.4 foundation with labels; active count; Views rename/delete accessible; prompt → Dialog. **Logic untouched:** `set()`, `filtersToParams`, export URL, import, saved-view action calls |
| `src/app/(app)/documents/_workspace/use-list-filters.ts`, `filter-types.ts` | — | **no change** (business; verified byte-identical) |
| `src/components/ui/filter-panel.tsx` | reusable primitive | translated Clear/Apply, Button `ghost` Clear, active count |
| `src/app/(app)/sales/_shared/row-menu.tsx` | shared workspace (list row actions) | named trigger (`aria-label`), size per AA-2, placeholders `disabled`. Convert behaviour unchanged |
| `src/app/(app)/sales/_shared/list-empty-state.tsx`, `stat-row.tsx`, `list-toolbar.tsx` | shared workspace | radius / type scale / weights; Projects toolbar's disabled placeholders shown honestly (kept, or hidden per AA-5) |
| 8 × `*-list-client.tsx` | direct consumer migration | numeric columns → `numeric`, action header name, no-results row, count line as `role="status"`. Columns and row-entry logic unchanged |
| `clients|inventory/products|purchasing/vendors/page.tsx`, their `*-toolbar.tsx`, `*-record-actions.tsx` | direct consumer migration | `td` without `flex` (inner wrapper), logical search icon, labelled search, numeric alignment, translated strings (labels only). The `?q=` server query is unchanged |
| `projects-list-client.tsx`, `recycle-bin-client.tsx`, the 3 `*/recycle-bin/page.tsx`, `finance/payments/payments-list-client.tsx`, `hr/payroll/payroll-client.tsx` (row selection keyboard / `aria-selected` only) | direct consumer migration | alignment, names, empty / no-results |
| Other plain tables (attendance, leave, journal, bank-accounts, settings panels) | consumer (alignment only) | logical numeric alignment via the `numeric` prop; nothing else |
| `src/app/(app)/finance/reports/reports-workspace.tsx` — **only** line 65 (negative colour), if AA-6 says so | consumer | remove automatic red (presentation) |
| `verify/verify-datatable.mts`, `verify/verify-datatable-runtime.mjs`, `package.json` (script + `verify:static`) | verification | as in §X |
| `tests/ui-baseline/list-states.mjs`, `run.mjs` (`capture-lists`) | screenshots | as in §W |
| `docs/ui/dev-ui-01-5/*` | docs | audit, decisions, migrations, reports |

## Z. Explicit exclusions
- **Data and logic:** DB / drizzle / migrations / `src/db`; business logic; accounting / inventory / payroll calculations; lifecycle; the status registry (G4 = 0); permissions; search semantics (client predicates, server `ilike`, `q` / `archived` / `lowStock` params); the saved-view data model and actions; the column-config data model.
- **Behaviours not to add or change:** pagination, sorting or bulk selection; export / import logic.
- **Other batches:**
  - **01.3 — shell:** `components/layout/*` (incl. `page-header.tsx` unless AA-4), `shell.css`, `.topbar-search`.
  - **01.6 — document / form:** `configure-columns-dialog.tsx`, `line-items-editor`, `item-entry-cell`, `.line-table`, `.doc-items-table`, the doc header / pills / action bar, document breadcrumbs, document-editor overflow.
  - **Page-archetype work:** the 19px list headings.
- **Platform:** the org theme engine; production / Vercel configuration. No production access.

## AA. Genuine reviewer decisions
1. **Mobile table strategy and the action column.**
   - (A) Keep contained horizontal scroll (works today: 0 page overflow on every list except the `/clients` header) and make the action column **sticky at the inline end** so row actions are always reachable.
   - (B) Responsive card rows below 768px.
   - Evidence: tables are 470–930px wide at 390, scroll is contained, and actions are off-screen on every list at 390.
   - Impact: (A) is CSS plus a primitive prop with no markup restructuring. (B) means per-module card layouts across ~14 tables.
   - **Recommend (A)** for all list types. Card rows are not justified by the current content.
2. **Row-menu trigger size.**
   - (A) 32px (`icon-sm`, compact).
   - (B) 36px (`icon`, default — matches the existing 36px master-data record actions).
   - Evidence: rows are ≥55px, so 36 fits without growing them; today the two systems are inconsistent (30 vs 36).
   - **Recommend (B) 36**, and converge `RowMenu` onto `Button variant="ghost" size="icon"` with an `aria-label`.
3. **Default density per table type.**
   - (A) Comfortable for all lists, compact only for finance ledgers, reports and settings preset panels.
   - (B) Comfortable everywhere, with compact as an opt-in prop and no consumer using it yet.
   - Evidence: today the floor is a 47px header / 55–63px rows, and wrapping inflates rows to 123px. A nowrap/truncation policy is needed in both cases.
   - **Recommend (A):** comfortable ≈ 48px row / 40px header (12px block padding + 20px line + border); compact = 40 / 36.
4. **`/clients` 390 overflow source.** It is the `PageHeader` actions `shrink-0` in `components/layout/page-header.tsx` (frozen directory, not shell chrome).
   - (A) Authorise one change there (`flex-wrap`, allow shrinking).
   - (B) Keep `PageHeader` frozen and pass fewer or compact actions from the Clients page.
   - (C) Defer to the page-archetype batch.
   - **Recommend (A).** It is a containment fix of the "fix the list rather than the shell" kind, but the file sits in the frozen directory, so it needs your explicit approval.
5. **Projects toolbar's disabled placeholders** (Filters, Views, Export, Import).
   - (A) Keep them as disabled controls (honest "not available").
   - (B) Hide them until implemented.
   - **Recommend (B):** disabled pills read as broken. This is presentation-only and changes no feature.
6. **Automatic red negatives in Finance Reports** (`reports-workspace.tsx:65`).
   - (A) Remove the red in 01.5 (presentation of a finance table).
   - (B) Leave it for a finance/report batch.
   - Evidence: it conflicts with the locked direction; no parentheses formatter exists, so 01.5 would show plain minus.
   - **Recommend (A)**, colour only, no formatting change.
7. **Workspace filter apply model.** Workspace filters apply live (client state); `FilterPanel` lists apply on "Apply" (server navigation).
   - (A) Keep both behaviours and unify only the chrome.
   - (B) Make all lists "Apply".
   - **Recommend (A).** (B) changes interaction semantics and needs your approval.

**STOPPED.** Read-only audit only:
- no branch, edits, commits, pushes, screenshots, deployment or production access;
- the probe used an isolated worktree of `main` and a TEST-ONLY database;
- DEV-UI-01.6 not started.
