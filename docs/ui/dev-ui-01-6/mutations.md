# DEV-UI-01.6 — Mutation record

Each mutant is applied to a disposable copy, the verifier is run, and the mutant is reverted; the clean tree passes afterwards.

## Static (`verify:document-form`): 81/81 caught

```
CAUGHT #1 form-field.tsx: FormField: render-function contract hands {id, describedBy, invalid, required}; plai
CAUGHT #2 form-field.tsx: FormField: description / error text carry ids derived from htmlFor (caption token; t
CAUGHT #3 doc-field-box.tsx: DocFieldBox: an editable field renders a real <Label htmlFor> bound to its control
CAUGHT #4 quotation-form.tsx: every DocFieldBox is either the mono number display or labels a control carrying tha
CAUGHT #5 cn-form.tsx: every DocFieldBox is either the mono number display or labels a control carrying tha
CAUGHT #6 quotation-form.tsx: Title fields on FormField + Input (render contract; same state, placeholder and hand
CAUGHT #7 quotation-form.tsx: the 8 forms: no inline gridTemplateColumns (document classes instead)  << sales/quot
CAUGHT #8 mockup-parity.css: at phone width every two-column document block stacks (head, header rows, party, bot
CAUGHT #9 mockup-parity.css: detail action groups wrap; module action wrappers flatten so each button wraps on it
CAUGHT #10 mockup-parity.css: editor action bar and titlebar actions wrap
CAUGHT #11 mockup-parity.css: editor action bar and titlebar actions wrap
CAUGHT #12 page.tsx: detail action groups wrap; module action wrappers flatten so each button wraps on it
CAUGHT #13 mockup-parity.css: the line editor's scroll box contains its sr-only header text (position: relative), 
CAUGHT #14 line-items-editor.tsx: the line editor's scroll box contains its sr-only header text (position: relative), 
CAUGHT #15 mockup-parity.css: line-table header labels wrap inside their column (no nowrap overlap)
CAUGHT #16 doc-top-actions.tsx: action bars on the Button primitive (outline draft / secondary preview / primary fin
CAUGHT #17 doc-top-actions.tsx: pending save: `loading` on the pressed button only, every button disabled while busy
CAUGHT #18 doc-action-bar.tsx: pending save: `loading` on the pressed button only, every button disabled while busy
CAUGHT #19 doc-action-bar.tsx: action bars on the Button primitive (outline draft / secondary preview / primary fin
CAUGHT #20 doc-form-error.tsx: error region: role=alert, programmatically focusable, focused when an error appears,
CAUGHT #21 doc-form-error.tsx: error region: role=alert, programmatically focusable, focused when an error appears,
CAUGHT #22 doc-dirty-indicator.tsx: Unsaved changes: polite status, text only while dirty, from the existing dirty flag
CAUGHT #23 quotation-form.tsx: Unsaved changes: polite status, text only while dirty, from the existing dirty flag
CAUGHT #24 quotation-form.tsx: every form: error cleared at the start of a save, set after restoreDirty + toast, re
CAUGHT #25 quotation-form.tsx: every form: error cleared at the start of a save, set after restoreDirty + toast, re
CAUGHT #26 quotation-form.tsx: every form: error cleared at the start of a save, set after restoreDirty + toast, re
CAUGHT #27 quotation-form.tsx: submit logic identical to the baseline in all 8 forms (payload keys, actions, markCl
CAUGHT #28 quotation-form.tsx: every form: error cleared at the start of a save, set after restoreDirty + toast, re
CAUGHT #29 invoice-form.tsx: dirty tracking snapshots identical to the baseline (every field still protected)  <<
CAUGHT #30 line-items-editor.tsx: line Add / Remove are real buttons (no div role=button)
CAUGHT #31 line-items-editor.tsx: line Add / Remove are real buttons (no div role=button)
CAUGHT #32 line-items-editor.tsx: focus after Add → the new row's item field; after Remove → the row now there / the p
CAUGHT #33 line-items-editor.tsx: focus after Add → the new row's item field; after Remove → the row now there / the p
CAUGHT #34 line-items-editor.tsx: every editable line cell has an accessible name (column + line)  << sales/_shared/li
CAUGHT #35 item-entry-cell.tsx: item picker: combobox input (autocomplete list, expanded, controls, activedescendant
CAUGHT #36 item-entry-cell.tsx: item picker: combobox input (autocomplete list, expanded, controls, activedescendant
CAUGHT #37 item-entry-cell.tsx: item picker keyboard: ArrowDown / ArrowUp move, Enter picks (no submit), Escape clos
CAUGHT #38 item-entry-cell.tsx: item picker keyboard: ArrowDown / ArrowUp move, Enter picks (no submit), Escape clos
CAUGHT #39 item-entry-cell.tsx: item picker keyboard: ArrowDown / ArrowUp move, Enter picks (no submit), Escape clos
CAUGHT #40 item-entry-cell.tsx: item picker keyboard: ArrowDown / ArrowUp move, Enter picks (no submit), Escape clos
CAUGHT #41 item-entry-cell.tsx: item picker portal: logical inline-start (RTL from innerWidth - rect.right), no phys
CAUGHT #42 item-entry-cell.tsx: item picker portal: logical inline-start (RTL from innerWidth - rect.right), no phys
CAUGHT #43 item-entry-cell.tsx: item picker: listbox of options with aria-selected (items and Create New Item)
CAUGHT #44 item-entry-cell.tsx: item picker: mouse and create behaviour kept (onClick pick / createNew; pointer does
CAUGHT #45 line-items-editor.tsx: LineItemDraft / emptyLineItem unchanged (no React-only keys in the payload; index ke
CAUGHT #46 configure-columns-dialog.tsx: Configure Columns: keyboard Move up / Move down (first / last disabled; Actions stay
CAUGHT #47 configure-columns-dialog.tsx: Configure Columns: the visibility toggle reports its state (aria-pressed)
CAUGHT #48 configure-columns-dialog.tsx: the dialog shows the translation without writing it back (a label is stored only whe
CAUGHT #49 configure-columns-dialog.tsx: Configure Columns: fixed validation text through the dictionary, raw text otherwise
CAUGHT #50 configure-columns-dialog.tsx: Configure Columns: no Reset-to-defaults feature
CAUGHT #51 column-label.ts: built-in labels translated only while they equal the English default; stored labels 
CAUGHT #52 terms-block.tsx: TermsBlock on the Tabs primitive (tablist / tab / tabpanel) — no hand-made tab bar
CAUGHT #53 terms-editor.tsx: document terms: keyboard Move up / Move down (doc controls) with focus kept on the m
CAUGHT #54 terms-editor.tsx: master terms editor (Preset Management) unchanged: no doc controls, original row + A
CAUGHT #55 rich-text-field.tsx: rich text: required label → the editable area's name; toolbar role; dir=auto; aria-m
CAUGHT #56 rich-text-field.tsx: rich text: required label → the editable area's name; toolbar role; dir=auto; aria-m
CAUGHT #57 rich-text-field.tsx: rich text: no window.prompt; link Dialog keeps the selection (captured, then restore
CAUGHT #58 rich-text-field.tsx: rich text: the allowed link protocols are unchanged (http, https, mailto) and invali
CAUGHT #59 mockup-parity.css: document controls show a visible focus ring (focus-visible outline on the focus toke
CAUGHT #60 mockup-parity.css: party edit / rich-text close positioned logically (no [dir] overrides)
CAUGHT #61 mockup-parity.css: document editor numbers at the logical end (th.num, computed td.num, line inputs, di
CAUGHT #62 mockup-parity.css: document editor numbers at the logical end (th.num, computed td.num, line inputs, di
CAUGHT #63 mockup-parity.css: party edit / rich-text close positioned logically (no [dir] overrides)
CAUGHT #64 page.tsx: detail line tables: numeric heads / cells on Table `numeric` (no physical text-right
CAUGHT #65 mockup-parity.css: document controls show a visible focus ring (focus-visible outline on the focus toke
CAUGHT #66 mockup-parity.css: document editor numbers at the logical end (th.num, computed td.num, line inputs, di
CAUGHT #67 totals-card.tsx: totals discount field named
CAUGHT #68 cn-form.tsx: CN / DN totals: localized 'Total VAT' label, no hard-coded VAT (15%)
CAUGHT #69 quotation-detail-actions.tsx: detail status Selects named on their SelectTrigger (localized)
CAUGHT #70 party-card.tsx: party cards: Button empty state, pencils named with the party
CAUGHT #71 totals.ts: protected files byte-identical (lifecycle, posting, status registry, column config, 
CAUGHT #72 sanitize-html.ts: protected files byte-identical (lifecycle, posting, status registry, column config, 
CAUGHT #73 dirty-form.tsx: protected files byte-identical (lifecycle, posting, status registry, column config, 
CAUGHT #74 actions.ts: protected files byte-identical (lifecycle, posting, status registry, column config, 
CAUGHT #75 document-pdf.ts: protected directories byte-identical (currency, PDF, print, layout, db, drizzle)  <<
CAUGHT #76 preview-dialog.tsx: protected files byte-identical (lifecycle, posting, status registry, column config, 
CAUGHT #77 dict.ts: every fixed document-editor string has an Arabic entry (no English leaking into AR) 
CAUGHT #78 dict.ts: every fixed document-editor string has an Arabic entry (no English leaking into AR) 
CAUGHT #79 dict.ts: server action error strings (static) localized for the error region, action files un
CAUGHT #80 quotation-form.tsx: every form: error cleared at the start of a save, set after restoreDirty + toast, re
CAUGHT #81 order-detail-actions.tsx: detail status Selects named on their SelectTrigger (localized)
```

## Runtime (`verify-document-form-runtime`, a fresh production build per mutant, TEST-only DB): 14/14 caught (spec §44)

| Mutant | Result | First failing check |
|---|---|---|
| mobile-grid | caught | /sales/quotations/new en@390: header grid stacks to one column |
| docfield-assoc | caught | every visible editor control has an accessible name (8 create + 3 edit forms, EN + AR, 4 widths) |
| delete-div | caught | Remove is a real button with a row-specific name |
| add-focus | caught | after Add, focus is in the new row's item field |
| picker-enter | caught | item picker: Enter picks the active option and never submits the document |
| error-region | caught | en draft: the server error lands in a focused role=alert region, translated (no redirect, nothing saved) |
| error-focus | caught | en draft: the server error lands in a focused role=alert region, translated (no redirect, nothing saved) |
| detail-wrap | caught | /sales/invoices/3 en@390: no page overflow; every header action inside the viewport (the group wraps) |
| numeric-right | caught | AR: editor numbers at the logical end (th, computed cells, line inputs, discount) and the computed values sit on the lef |
| rte-name | caught | en: rich text named (Note), multiline textbox, dir=auto, inside a named toolbar group |
| rte-selection | caught | rich text: the link wraps exactly the selected text and focus returns to the editor |
| cc-move | caught | section 6 (Configure Columns) ran to completion |
| col-translate-renamed | caught | Configure Columns: the new order and the renamed label persist after reload |
| picker-arrowdown | caught | item picker: ArrowDown / ArrowUp move the active option (aria-activedescendant + aria-selected) |

picker-arrowdown was first written as a narrowed condition that no longer compiled (a build failure, not a catch); it was re-expressed as an early return for ArrowDown and caught. error-region was re-run on the final suite, where the toast is read independently of the region.
