# DEV-UI-01.5 — Consumer migrations (exact lists)

Paths relative to `src/app/(app)/` unless noted. No column set, data source, handler, permission,
filter predicate or URL parameter changed in any of them.

## Shared list pieces
| File | Change |
|---|---|
| `src/components/ui/table.tsx` | `density`, `list`, `numeric`, `action`, `wrap`, `TableEmptyRow`; wrapper `.data-table-wrap` (card + scroll container); `<th scope="col">`. |
| `src/components/ui/list-search.tsx` (new) | the list search: Input foundation, logical start icon, accessible name, optional clear. |
| `src/components/ui/filter-panel.tsx` | Buttons for Clear / Apply, caller (translated) labels, `activeCount`; Apply / Clear model unchanged. |
| `src/components/ui/skeleton.tsx` | `TableSkeleton` rows / header follow `--table-row-height` / `--table-header-height`; radius 12. |
| `documents/_workspace/list-workspace-toolbar.tsx` | ListSearch; filter fields on Select / Input / Label with ids; active count; Views menu = only menu items (save · views · manage); Save / Rename dialogs (no `window.prompt`); Manage dialog (rename → dialog, delete → existing `useConfirm`); current view marked. Filter keys, live `set`, `EMPTY_FILTERS`, export URL, import, saved-view action calls unchanged. |
| `sales/_shared/row-menu.tsx` | trigger = `Button ghost icon` (36px) via `DropdownMenuTrigger asChild`, required `label`; placeholders `disabled` (Radix: aria-disabled, keyboard-skipped); convert item `aria-expanded`; content capped to `--radix-dropdown-menu-content-available-height` and scrolls (the expanded Convert list ran off the top at 1024×768). |
| `sales/_shared/list-toolbar.tsx` (Projects) | ListSearch; the fake disabled Filters / Views / Export / Import removed; Recycle Bin (when given) + Create kept. |
| `sales/_shared/list-empty-state.tsx` | radius 12 / no shadow / type scale. (`stat-row.tsx` is untouched: its markup is pinned by `verify:status-registry`; the KPI figures belong to page-archetype work.) |

## Document lists (8): `sales/quotations`, `sales/invoices`, `sales/orders`, `sales/delivery-challans`, `sales/credit-notes`, `sales/proforma`, `purchasing/orders`, `purchasing/debit-notes` `*-list-client.tsx`
`<Table list>`; Amount `numeric` (head + cell); the empty header → `<TableHead action>{t("Actions")}`;
the RowMenu cell → `<TableCell action>` with `label={`${t("Actions for")} ${number}`}`; a
`TableEmptyRow` ("No records match the current search or filters.") when records exist but none match;
the "Showing X of Y" line → `role="status" aria-live="polite"`, caption size; creator cell
`text-body-sm`. `rows.length === 0` still shows `ListEmptyState`.

## Master data
| File | Change |
|---|---|
| `clients/page.tsx`, `purchasing/vendors/page.tsx`, `inventory/products/page.tsx` | `<Table list>`; headers translated; numeric Unit price / Qty on hand; status badges in an inner `inline-flex` span (the `<td>` stays a table cell); sticky named action column; record actions get `locale` + row label; empty copy translated; header title / description, Recycle Bin and create action through `t()`. **Clients:** `PageHeader className="flex-wrap"` — the frozen component is unchanged; its action group now wraps under the heading at 390px. |
| `clients/clients-toolbar.tsx`, `purchasing/vendors/vendors-toolbar.tsx`, `inventory/products/products-toolbar.tsx` | ListSearch (Enter → same `navigate()` → same URL params); FilterPanel translated labels + `activeCount`; checkbox labels translated. Products: the clickable "Low stock ×" Badge → a real `Button` chip (`aria-label` "Remove filter: Low stock"). |
| `clients/client-record-actions.tsx`, `inventory/products/product-record-actions.tsx`, `purchasing/vendors/vendor-record-actions.tsx` | `locale` + optional `label` props; aria-label, menu labels and toasts translated. Handlers and confirmations unchanged. Detail pages (`[id]/page.tsx`) pass `locale`. |
| `clients/recycle-bin/page.tsx`, `inventory/products/recycle-bin/page.tsx`, `purchasing/vendors/recycle-bin/page.tsx` | `getLocale` + `t`; `<Table list>`; headers translated; sticky named action column; empty copy translated. |

## Other tables
| File | Change |
|---|---|
| `recycle-bin/recycle-bin-client.tsx` | ListSearch; empty bin (no records) vs no-results row distinguished; sticky named action column; type scale. |
| `projects/projects-list-client.tsx` | `<Table list>`; Budget + Tasks numeric; sticky named action column + RowMenu label; no-results row; polite count; empty state = `ListEmptyState` (same copy). |
| `finance/payments/payments-list-client.tsx` | `<Table list>`; Amount numeric; receipt action = `Button ghost icon` with its loading state (was a bare 16px icon button), sticky named action column. |
| `hr/attendance/page.tsx`, `hr/leave/leave-client.tsx` | `<Table list>`; sticky named action column. |
| `hr/payroll/page.tsx`, `hr/payroll/payroll-client.tsx` | numeric Net pay / Basic / Allowances; payroll lines: `tabIndex=0`, Enter / Space selects, `aria-selected`, focus outline, selected tint (click unchanged). |
| `finance/reports/reports-workspace.tsx` | `Num`: no automatic `text-danger` on negatives (AA-6); the 4 report tables `density="compact"`. Delta / badge red unchanged. |
| `finance/_shared/account-ledger-view.tsx`, `finance/journal/page.tsx`, `finance/bank-accounts/page.tsx`, `settings/organization/reference-panels.tsx` | `density="compact"`. |
| `settings/team/team-panel.tsx`, `settings/compliance/compliance-client.tsx`, `settings/security/security-client.tsx`, `settings/presets/{numbering,terms-groups,note-templates,simple-preset,bundles,exchange-rates}-panel.tsx` | compact density (presets / team / compliance / security); numeric columns; sticky named action columns; numbering's edit inputs `ms-auto text-end` (were `ml-auto text-right`). |
| `src/lib/i18n/dict.ts` | 37 additive EN / AR keys (list search placeholders, filter labels, record actions, empty / no-results copy, "Actions for", "Manage saved views", "Clear search", master-data header descriptions, "New Product", …). |

## Harness / tests
`tests/ui-baseline/controls-gallery.tsx` passes the new RowMenu `label`; `verify/verify-controls.mts`:
FilterPanel's Clear follows the 01.4 rule (outline text button) and the 01.5-owned files left its
"not yet migrated" list (01.6 files stay on it). `verify/verify-skeleton-runtime.mjs`: the empty-state
locator `.rounded-2xl.border` → `[data-list-empty]` (selector only; the card is 12px now). New:
`verify/verify-datatable.mts`, `verify/verify-datatable-runtime.mjs`, `tests/ui-baseline/list-states.mjs`,
`run.mjs capture-lists`.

## Untouched by design
`use-list-filters.ts`, `filter-types.ts`, `saved-view-actions.ts`, `src/lib/document-list-workspace.ts`
(byte-identical, pinned by `verify:datatable`); Configure Columns + column config; every DEV-UI-01.6
document-editor file; `components/layout/*` (incl. `page-header.tsx`), `shell.css`, `.topbar-search`;
page headings (19px, page-archetype work); statements and payment-history tables (already logical);
document detail line tables (`[id]/page.tsx`).
