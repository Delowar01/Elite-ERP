# DEV-UI-01.4 — Consumer migrations (exact lists)

Paths are relative to `src/`. Line numbers are on the committed tree. All rewrites below were made
with a TypeScript-AST script (attributes only — no handler, `disabled`, `aria-*`, text or child
changed) and then checked file by file; `verify:controls` pins the end state.

## 1. Ghost → outline / ghost / destructive-ghost (R2-a) — 43 former `variant="ghost"` sites

Before this batch `ghost` was a *bordered* transparent button. It was renamed `outline` (same look),
and `ghost` became truly borderless. Each of the 43 old ghost sites was classified:

### 1a. Text / cancel actions → `outline` (20, look unchanged)
| Size | Site |
|---|---|
| default | `app/(app)/_shared/confirm-provider.tsx:204` (Cancel) |
| default | `app/(app)/clients/page.tsx:56`, `app/(app)/inventory/products/page.tsx:45`, `app/(app)/purchasing/vendors/page.tsx:44` (Recycle Bin links) |
| default | `app/(app)/clients/recycle-bin/page.tsx:27`, `app/(app)/inventory/products/recycle-bin/page.tsx:27`, `app/(app)/purchasing/vendors/recycle-bin/page.tsx:27` (Back) |
| default | `app/(app)/documents/_workspace/import-dialog.tsx:173`; `import-v2-dialog.tsx:293`, `:392`, `:474` (Back / Cancel) |
| default | `app/(app)/finance/_shared/refund-advance-button.tsx:175` (Cancel) |
| default | `app/(app)/purchasing/orders/po-detail-actions.tsx:87` |
| default | `app/(app)/settings/compliance/compliance-client.tsx:277`, `:321` |
| sm | `app/(app)/clients/recycle-bin-actions.tsx:46`, `app/(app)/inventory/products/recycle-bin-actions.tsx:46`, `app/(app)/purchasing/vendors/recycle-bin-actions.tsx:46` (Restore) |
| sm | `app/(app)/finance/_shared/add-account-dialog.tsx:42`, `app/(app)/settings/presets/bundles-panel.tsx:127` |

### 1b. Icon-only actions → true `ghost` (12, border removed)
`app/(app)/clients/client-record-actions.tsx:57`, `app/(app)/inventory/products/product-record-actions.tsx:55`,
`app/(app)/purchasing/vendors/vendor-record-actions.tsx:55` (record ⋯ menus);
`app/(app)/settings/presets/bundles-panel.tsx:130`, `:205`; `note-templates-panel.tsx:115`;
`numbering-panel.tsx:109`, `:112`, `:125`; `simple-preset-panel.tsx:89`; `terms-groups-panel.tsx:114`;
`app/(app)/settings/team/team-panel.tsx:125` — all `size="icon"` with an `aria-label`.

### 1c. Hand-built danger ghosts (`ghost` + `text-danger hover:…`) → `destructive-ghost` (11)
`app/(app)/clients/recycle-bin-actions.tsx:49`, `app/(app)/inventory/products/recycle-bin-actions.tsx:49`,
`app/(app)/purchasing/vendors/recycle-bin-actions.tsx:49` (Delete permanently, sm);
`app/(app)/purchasing/debit-notes/dn-detail-actions.tsx:57`, `app/(app)/sales/credit-notes/cn-detail-actions.tsx:57`,
`app/(app)/sales/invoices/invoice-detail-actions.tsx:90`, `app/(app)/recycle-bin/recycle-bin-client.tsx:128`;
`app/(app)/settings/presets/bundles-panel.tsx:133`, `note-templates-panel.tsx:118`, `simple-preset-panel.tsx:92`,
`terms-groups-panel.tsx:117` (delete icons). The duplicated `text-danger` / hover classes were removed.

## 2. Raw icon buttons → `<Button variant="ghost" | "destructive-ghost" size="icon-sm">` (3 sites, 4 buttons)

Migrated only where all six criteria held (standalone; one-for-one handler; `disabled`/pending
unchanged; accessible name kept; not DEV-UI-01.5 list/table; not DEV-UI-01.6 document/form):

| Site | Was | Now |
|---|---|---|
| `app/(app)/dashboard/base-currency-notice.tsx:64` | raw `<button>` Dismiss (X) | `ghost icon-sm`, same `onClick`, `disabled={pending}`, `aria-label` |
| `app/(app)/dashboard/customize-layout-dialog.tsx:78`, `:81` | raw Move up / Move down | `ghost icon-sm`, same handlers, same `disabled` bounds, `aria-label`s |
| `app/(app)/settings/presets/seal-signature-panel.tsx:24` | raw delete icon (`hover:text-danger`) | `destructive-ghost icon-sm`, same handler, `aria-label` |

**Left as they are (ambiguous or excluded), by design:** payment-history row actions (delete /
reverse / refund — table rows, DEV-UI-01.5), `app/(app)/finance/bank-accounts/page.tsx` row edit
(table), `app/(app)/finance/journal/journal-form.tsx` line remove (form lines, DEV-UI-01.6),
`app/(app)/finance/payments/payments-list-client.tsx` (list workspace), `sales/_shared/bank-accounts-field.tsx`
(document form), `documents/_workspace/list-workspace-toolbar.tsx` (DEV-UI-01.5), the Compliance
table's text "Remove" button (table row), and every icon button in the excluded structures (§6).
No `link`-variant migrations were made (no case was presentation-only beyond doubt).

## 3. Dead `style={{ width: "auto" }}` on the modern `<Button>` — 39 removals

`<Button>` is `inline-flex` with no width of its own, so `width: auto` was a no-op (left over from
the `.btn-primary { width: 100% }` era). Removed only on `<Button>`; **legacy `.btn` width overrides
were not touched** (`.btn-primary { width: 100% }` is kept, R1).

`documents/_workspace/import-dialog.tsx:137, 173, 176` · `import-v2-dialog.tsx:293, 294, 386, 392, 393, 468, 474, 475, 517, 521`
· `finance/_shared/refund-advance-button.tsx:175, 176` · `finance/bank-accounts/page.tsx:82` ·
`finance/journal/journal-form.tsx:209` · `finance/payments/payments-list-client.tsx:96` ·
`hr/leave/leave-client.tsx:81`, `hr/payroll/payroll-client.tsx:109` (width removed, `padding: 0 18px`
kept) · `purchasing/debit-notes/dn-detail-actions.tsx:48, 57` · `purchasing/orders/po-detail-actions.tsx:87, 90, 100, 103, 124`
· `recycle-bin/recycle-bin-client.tsx:124, 128` · `sales/_shared/convert-menu.tsx:39` ·
`sales/credit-notes/cn-detail-actions.tsx:48, 57` · `sales/invoices/apply-advance-dialog.tsx:84` ·
`sales/invoices/invoice-detail-actions.tsx:76, 90, 105` · `sales/proforma/proforma-detail-actions.tsx:63`
(`asChild`; the child `<Link>` has no width class), `:97` · `settings/security/security-client.tsx:200`
(all under `app/(app)/`; line numbers as before the removal).

## 4. Native controls → primitives

| Site | Was | Now |
|---|---|---|
| `app/(app)/settings/compliance/compliance-client.tsx` — Erase customer | native `<select>` with an empty first option | `Select` (`value=""` shows the placeholder "Select a customer"; items `String(c.id)`), `<label htmlFor="erase-customer">` |
| same — Consent subject | native `<select>` | `Select`, `<label htmlFor="consent-subject">` |
| `app/(app)/finance/reports/reports-workspace.tsx` — Compare with previous period | native checkbox | `Checkbox` (`onCheckedChange` sets / clears `compare=1` exactly as before) |
| `components/client/client-type-select.tsx` — Client Type | hand-built radio markup | `RadioGroup` / `RadioGroupItem` (native radios, R4-b). The form still submits `clientType` through its own hidden input; the group's `name` is distinct so it never collides |

## 5. Not migrated on purpose

* `.btn` / `.btn-primary` / `.btn-glass` / `.btn-accent` markup (≈73 sites) — restyled in CSS only (R1-a).
* "Saving…" buttons (33) — `loading` exists on `<Button>`, none migrated (R5-ii).
* Card radios (`settings/organization/company-panels.tsx` colour mode) and document-workspace radios
  (`documents/_workspace/import-v2-dialog.tsx`) — untouched.
* `FormField` — untouched (deferred to DEV-UI-01.6).

## 6. Excluded structures (untouched in this batch; `verify:controls` asserts none uses the 01.4 API)

DEV-UI-01.5: `components/ui/table.tsx` (DataTable), `documents/_workspace/list-workspace-toolbar.tsx`
(filter popover, toolbar), `sales/_shared/list-toolbar.tsx`, `sales/_shared/configure-columns-dialog.tsx`,
`sales/_shared/row-menu.tsx` content / workflow (only `.row-menu-btn` focus CSS changed).
DEV-UI-01.6: `sales/_shared/line-items-editor.tsx`, `line-item-cell.tsx`, `item-entry-cell.tsx`,
`rich-text-field.tsx`, `terms-editor.tsx`, `terms-block.tsx`, `party-card.tsx`, `totals-card.tsx`,
`doc-field-box.tsx`, `doc-pills-row.tsx`, `bank-accounts-field.tsx`, the doc gear, form layouts,
`components/ui/form-field.tsx`.
DEV-UI-01.3: `components/layout/*`, `app/(app)/shell.css`.

Shared-primitive consequences inside excluded screens (expected, not edits to them): document-header
`SelectTrigger`s (`cn-form` / `dn-form`, classes `input plain … border-0`) now get the input
background and the keyboard focus outline from the Select primitive; party-card's `SearchableSelect`
gets listbox semantics.
