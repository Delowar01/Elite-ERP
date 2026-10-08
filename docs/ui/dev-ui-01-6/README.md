# DEV-UI-01.6 — Document / form shell (implementation record)

Baseline: main `ccd7e39` (tree `3311b2d`). Branch `claude/dev-ui-01-6-document-form-shell`.
Audit: [`document-form-audit.md`](document-form-audit.md) (sections A–AA, read-only, before any change).
Exact file lists: [`consumer-migrations.md`](consumer-migrations.md). Mutations: [`mutations.md`](mutations.md).

All browser and database work ran in isolated worktrees, against `devui010_test_only_*` databases
on localhost, with no repository `.env`. Nothing touched production; nothing was deployed.

## Locked decisions, as implemented
- **Mobile line items:** the existing table, contained in its own horizontal scroll box
  (`.table-scroll.doc-items-scroll`). No cards, priority columns, sticky item column or second editor.
- **Editor actions:** top and bottom bars kept; both wrap. No sticky mobile footer.
- **Detail actions:** `.inv-head-actions` wraps; destructive actions stay individually visible; no
  overflow-menu migration.
- **No `DocumentFormLayout`**, no `<form>` conversion, no autosave, no client-side validation, no
  server-error-to-field mapping, no "All changes saved".
- **Unsaved changes:** a transient polite status from the existing `useDirtyForm` flag
  (`dirty-form.tsx` byte-identical).
- **Save state:** Button `loading` (spinner + `aria-busy`) on the pressed button only; all save
  buttons disabled while busy (one submission).
- **Error region:** `role=alert`, `tabIndex=-1`, focused when it appears; cleared at the start of a
  save, set after the existing `restoreDirty()` + `toast.error(...)`. Text through `t()` with the
  raw server string as fallback. The existing toast is unchanged (it still shows the server's own
  text); the region shows the translation. All 8 `actions.ts` byte-identical; their static error
  strings got dictionary entries.
- **Configure Columns:** accessibility / presentation only. Keyboard Move up / down, all controls
  named, built-in labels translated at display time only while they equal the English default.
  No Reset-to-defaults; persistence call and `column-config` logic unchanged (pinned).
- **Density:** header controls 36px (`--control-height`); line cells 32px (`--control-height-compact`).
- **CN / DN:** localized "Total VAT", no percentage.

## FormField contract
`FormField` (`src/components/ui/form-field.tsx`) is backward compatible: `htmlFor` stays the
control's id; optional `description`, `required` (visual `*`, `aria-hidden`), `error`, with ids
`<htmlFor>-description` / `<htmlFor>-error` (`fieldIds`). Children are either ordinary nodes
(unchanged) or a render function receiving `{ id, describedBy, invalid, required }` to place on
the focusable element itself (an `Input`, or a Radix `SelectTrigger`, never the `Select` root).
Nothing is cloned. No existing consumer passes `error`, so no existing screen changed (256 matrix:
only the invoice document routes differ).

## DocFieldBox
Editable header fields render a real `<Label htmlFor>` bound to the control inside the field
(runtime: every `.doc-field[data-doc-field=control]` label resolves to a control in that field, 8
create + 3 edit forms, EN + AR, 4 widths). The document number is display-only: a plain caption, no
fake label, monospaced; the numbering gear is unchanged.

## CSS (`mockup-parity.css`, document selectors only)
Responsive head / header / meta / bottom / seal grids and `.inv-grid` / `.party-row` (single column
≤ 640px); `.inv-head` / `.inv-head-actions` / `.doc-titlebar(-actions)` / `.doc-action-bar` wrap;
dirty indicator and error region; field label / control / input tokens; logical numbers
(`th.num`, computed `td.num`, `.item-cell-input`, discount: `text-align: end`; the
`[dir="rtl"]` header override removed); logical party edit and RTE close; line-table header labels
wrap inside their column (long Arabic labels such as "ضريبة القيمة المضافة %" used to run under the
neighbouring column, in main as well); `.doc-items-scroll { position: relative }` (the sr-only
"Actions" header text was positioned against the page and widened it to 775–790px); focus-visible
rings for the item name / line inputs / discount / add & remove / pills / RTE / term inputs / error
region; Configure Columns row layout. The `@media print` block is byte-identical to main.

## Verification
### `verify:static` (isolated worktree, TEST-only verify DB): all suites pass, exit 0
role matrix 32/32 · confirm policy 62/62 · dirty form 66/66 · skeletons 89/89 · contrast 161/161 ·
typography 43/43 · status registry 88/88 · shell 75/75 · controls 110/110 · datatable 69/69 ·
**document form 76/76** (C1; 75/75 at C0) · edit action 59/59 · store model, provider harness, backup claims, money
precision, ledger-only balances: pass. TypeScript (`tsc --noEmit`): clean. ESLint (changed files): clean.

### `verify:document-form` (new, `verify/verify-document-form.mts`, wired into `verify:static`)
FormField API and no cloning; DocFieldBox association; no raw header controls / `outline-none`;
no inline grid recipes; responsive classes; Button action bars with `loading` on the pressed button;
no inline success colour; dirty indicator; error region (role, focus, translation) and the exact
lines added to `submit`; Add / Remove buttons, named cells, focus recipe; combobox / listbox /
option contract and keyboard code; Configure Columns primitives, names, move controls, no Reset,
display-only translation; Tabs; document-only term reorder and the master editor's original markup;
RTE name / toolbar / `dir=auto` / no `window.prompt` / selection-keeping link Dialog / protocols;
numeric Table cells; no hard-coded "VAT (15%)"; logical numbers; focus-visible rules; every fixed
editor string and every static server-action error string has an Arabic entry; byte pins (lifecycle,
posting, status registry, column config, sanitizer, totals / line-item-desc / doc-currency, all 8
`actions.ts` + advance / creation-popup / column-config / saved-view actions, dirty-form,
edit-document, confirm-provider, lifecycle-actions, list logic, dropdown-menu, preview dialog,
money, `shell.css`, `package-lock.json`) and directory pins (`lib/currency`, `lib/pdf`, `app/print`,
`components/layout`, `db`, `drizzle`) in `verify/document-form-pins.json`; submit bodies and
`useDirtyForm` snapshots of all 8 forms hash-identical to main; `LineItemDraft` / `emptyLineItem`
unchanged. **Static mutations: 83/83 caught** (C1; 81/81 at C0).

### `verify-document-form-runtime` (new, browser tier, refuses a non-test database)
188 checks. Containment of 8 create + 3 edit forms at 1440 / 1024 / 768 / 390 EN + AR (page overflow 0, the
800px line table inside its own scroll box, header grid single-column at 390, line headers fit their
columns); every visible editor control named; DocFieldBox labels bound; detail pages + actions inside
390; Unsaved changes on edit / gone on revert; the navigation confirmation still intercepts; pending
save `aria-busy` on the pressed button only (draft and primary), one submission; the existing toast;
the focused, translated error region, form state kept, no redirect; Add / Remove by keyboard and
focus; picker ARIA, ArrowDown / ArrowUp / Enter / Escape, Enter never submits, keyboard pick = mouse
pick = product master (350 / 15 / hr), active option scrolled into view, list at the field's inline
start inside 390 (EN + AR); Configure Columns names, keyboard moves with focus kept, persistence in
the TEST DB, AR labels translated, a renamed label kept as typed, configuration restored; terms
keyboard moves; Settings master terms editor unchanged; RTE name / toolbar / `dir=auto`, link Dialog
(Cancel no-op, `javascript:` rejected, link wraps exactly the selection, focus back); numbers at the
logical end (editor EN + AR, detail numeric cells EN + AR); status Select named; lifecycle actions
identical to the pre-change probe; totals equal the business formula, and saving the TEST draft
unchanged keeps subtotal / discount / VAT / total. **Runtime mutations (spec §44): 14/14 caught.**

### Full browser tier (isolated worktree, fresh build, TEST-only browser DB)
**46/46 suites pass**, among them document-form runtime 188/188, datatable runtime 130/130, controls
runtime 302/302, shell runtime 341/341, dirty-core 72/72, dirty-ui 8/8, edit-e2e 132/132, draft-buttons,
draft-func, edit, duplicate 40/40, document-attachments 14/14, color / dark theme, pdf-branding 15/15,
print-apply, preset-zatca, vendor-inline 31/31. No existing suite or assertion was changed.

### Guardrails (report-only, `guardrails-after.json`)
| | entry | after |
|---|---|---|
| G1 physical direction | 97 | 36 |
| G2 off-scale font sizes | 302 | 280 |
| G3 outline removed w/o focus-visible | 35 | 8 |
| G4 local status maps | 0 | 0 |
| G5 missing dictionary keys | 30 / 27 | 28 / 25 |

Every reduction is in a document file (8 forms, 8 detail pages, the shared document components,
document selectors in `mockup-parity.css`, the editor footer strings); no file got worse.

## Screenshots
- `tests/ui-baseline/candidates/dev-ui-01-6/documents/`: **134** document states
  (`run.mjs capture-documents`, `tests/ui-baseline/document-states.mjs`): invoice empty / populated
  (+ dark 1440), picker open, error region, Configure Columns, note / RTE, terms, dirty, save pending,
  invoice edit, sent and draft invoice detail (+ dark 1440), quotation create, quotation detail with
  the status Select open, PO create / detail, CN create, DC create — EN / AR, 1440 / 1024 / 768 / 390.
  Captured twice from two fresh builds: 134/134 byte-identical; all HTTP 200, no overflow, no console
  errors (`document-states-report.json`).
- 256 matrix, twice on final code: 256/256 byte-identical between runs. Against the 01.5 matrix only
  `sales-invoice-new` / `-edit` / `-detail` changed (48 states, stored in the candidate folder with
  the run manifest); 12 overflow states at 390 fixed; nothing new non-200, no new console error or
  overflow; shell / topbar / sidebar and every other state byte-identical
  (`screenshot-change-report.json`). Pre-existing, unchanged: hydration #418 on AR dashboard /
  client-detail, overflow on client-detail / settings-organization / hr-employees at 390.
- Recaptures for evidence: list states 210/210 identical to 01.5; control gallery identical to 01.5
  (the same 12 menu states that 01.5 already recorded as changed against 01.4).
- Baseline and the 01.1–01.5 candidates, print routes, print CSS and the PDF generator: unchanged.

## 01.5 pins retired deliberately
`verify-datatable.mts` no longer byte-pins the editor files this phase owns (configure-columns-dialog,
line-items-editor, item-entry-cell, rich-text-field, terms-editor, terms-block, party-card,
totals-card, doc-field-box, doc-action-bar) and its CSS pin covers `.line-table` only; the
`column-config` / `column-config-actions` / `line-item-cell` / `doc-pills-row` / dropdown / list pins
stay. `verify-controls.mts` no longer excludes the document editor files.

## Known remaining debt (not in scope)
- Editor and detail headings stay `h3` (DEV-UI-01.7).
- The existing toast shows the server's English text in Arabic; the error region translates it.
- Pre-existing app-wide items listed above (hydration #418, three non-document 390 overflows).
