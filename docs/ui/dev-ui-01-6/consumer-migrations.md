# DEV-UI-01.6 — Consumer migrations (exact lists)

Paths relative to `src/app/(app)/` unless noted. No payload key, submit body, calculation, status
transition, server action, permission or URL changed in any of them. The submit bodies and the
`useDirtyForm(...)` snapshots of all eight forms are hash-pinned against main `ccd7e39`
(`verify:document-form` §10).

## Shared pieces
| File | Change |
|---|---|
| `src/components/ui/form-field.tsx` | Optional `description` / `required` / `error` with ids derived from `htmlFor` (`fieldIds`); render-function children receive `FieldProps` (`id`, `describedBy`, `invalid`, `required`). Ordinary children render exactly as before; nothing is cloned. The (unused today) error text moved from `text-[12px]` to the `text-caption` step. |
| `sales/_shared/doc-field-box.tsx` | Editable field: a real `<Label htmlFor>` bound to the control; display-only value (document number): a plain caption, no fake label. `mono` for numbers / codes only; numbering gear unchanged. |
| `sales/_shared/doc-top-actions.tsx` | Button primitive (Save as Draft = outline, Preview = secondary); `loading` on the pressed button only; hosts the "Unsaved changes" indicator (`dirty` prop). |
| `sales/_shared/doc-action-bar.tsx` | Button primitive (outline / secondary / primary); `loading` on the pressed button only; every button disabled while busy; edit mode Preview + Save Changes. No inline success colour, no label swap. |
| `sales/_shared/doc-dirty-indicator.tsx` (new) | `role=status` / `aria-live=polite`, text only while the existing `dirty` flag is true. |
| `sales/_shared/doc-form-error.tsx` (new) | Document-level `role=alert` region, `tabIndex=-1`, focused when an error appears, text through `t()` with raw fallback. |
| `sales/_shared/column-label.ts` (new) | `columnDisplayLabel`: a built-in column whose stored label still equals its English default is shown translated; anything else is shown exactly as stored. Never writes. |
| `sales/_shared/line-items-editor.tsx` | Add / Remove are `<button type=button>` with row names ("Remove line item 2"); every cell input named `<column> — Line N`; focus after Add (new row's item field) / after Remove (row now there, else previous, else Add); headers via `columnDisplayLabel`, sr-only "Actions" header; scroll box `.doc-items-scroll` (containing block for that sr-only text). `LineItemDraft` / `emptyLineItem` unchanged. |
| `sales/_shared/item-entry-cell.tsx` | Item name = ARIA 1.2 combobox (`aria-autocomplete=list`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, named); portal = `listbox` of `option`s with `aria-selected`; ArrowDown / ArrowUp / Enter / Escape; active option scrolled into view; portal positioned with `insetInlineStart` (RTL from `innerWidth - rect.right`). Mouse pick / create unchanged. |
| `sales/_shared/configure-columns-dialog.tsx` | Primitives (Button / Input / Select / Label); every control named; keyboard Move up / Move down (first / last disabled; Actions locked last), drag kept; translated built-in labels shown until the user edits a label; fixed validation text through `t()`; Save shows `loading`. No Reset-to-defaults. Persistence call (`saveColumnConfigAction(documentType, cols)`) unchanged. |
| `sales/_shared/totals-card.tsx` | Discount input named ("Discount"). `totals.ts` untouched (pinned). |
| `sales/_shared/terms-block.tsx` | Tabs primitive (tablist / tab / tabpanel); note-template Select named; RTE named "Note"; attachment file input named; remove button names include the file name. |
| `sales/_shared/terms-editor.tsx` | Document terms: named textareas (`Term N`, `dir=auto`), logical numbering, keyboard Move up / Move down with focus kept, focus-visible. `MasterTermsListEditor` (Settings → Presets) renders exactly as before (`TermRow` parameterized by an optional `doc`). |
| `sales/_shared/rich-text-field.tsx` | Required `label` (editable area's name); `role=toolbar` named "Formatting — <label>"; `dir=auto`; focus-visible ring (no `outline-none`); link insertion through a Dialog that captures the selection before opening and restores it before `createLink`; protocols unchanged (http, https, mailto), invalid ones rejected in the Dialog; Cancel changes nothing. |
| `sales/_shared/party-card.tsx` | Empty state = Button; edit pencils named with the party ("Edit business details: <name>", "Edit <name>"); logical position. |
| `mockup-parity.css` | Document selectors only — see README "CSS". |
| `src/lib/i18n/dict.ts` | Additive keys only (server error strings of the 8 action files, new UI strings, two pre-existing footer strings). |

## The eight editors
`sales/quotations/quotation-form.tsx`, `sales/orders/order-form.tsx`, `sales/proforma/proforma-form.tsx`,
`sales/invoices/invoice-form.tsx`, `sales/delivery-challans/dc-form.tsx`, `sales/credit-notes/cn-form.tsx`,
`purchasing/orders/po-form.tsx`, `purchasing/debit-notes/dn-form.tsx`:

- inline `gridTemplateColumns` → `.doc-head-grid` / `.doc-header-grid` / `.doc-meta-row` (stack at ≤ 640px);
- header dates / reasons / carrier on `Input` inside `DocFieldBox htmlFor`; Project / Payment Terms /
  CN-DN source on `Select` with the id on `SelectTrigger` (`__none` sentinel for the empty choice);
- Title on `FormField` (render function → `Input` with id / describedby);
- `DocTopActions dirty={dirtyForm.dirty}`; `<DocFormError>` above the action bar;
  `setFormError(null)` before the save starts and `setFormError(result.error)` after the existing
  `restoreDirty()` + `toast.error(...)` — the only lines added to `submit`;
- CN / DN totals: localized "Total VAT" (no hard-coded percentage).

Not converted to `<form>`; no client-side validation; server errors are not mapped to fields.

## Detail pages (8) and status Selects
`sales/{quotations,orders,proforma,invoices,delivery-challans,credit-notes}/[id]/page.tsx`,
`purchasing/{orders,debit-notes}/[id]/page.tsx`: line tables on `TableHead numeric` /
`TableCell numeric` (no physical `text-right`); the header action group → `.inv-head-actions`
(wraps); notes on the type scale.
`quotation-detail-actions.tsx`, `order-detail-actions.tsx`, `dc-detail-actions.tsx`,
`proforma-detail-actions.tsx`: the status `SelectTrigger` carries a localized `aria-label`
("Change … status"). Status options and transitions unchanged.

## Verifiers changed (boundaries moved deliberately)
- `verify/verify-controls.mts`: the document editor files left `EXCLUDED` (they now use the
  primitives); only `line-item-cell.tsx`, `doc-pills-row.tsx`, `bank-accounts-field.tsx` stay excluded.
- `verify/verify-datatable.mts`: the 01.5 byte pins on the editor files 01.6 owns were retired
  (configure-columns-dialog, line-items-editor, item-entry-cell, rich-text-field, terms-editor,
  terms-block, party-card, totals-card, doc-field-box, doc-action-bar); kept: `line-item-cell`,
  `doc-pills-row`, `column-config-actions`, `column-config`, `dropdown-menu`, list pins. Its CSS pin
  now covers `.line-table` only (same hash as main). The editor files are now pinned by behaviour in
  `verify:document-form` instead.
