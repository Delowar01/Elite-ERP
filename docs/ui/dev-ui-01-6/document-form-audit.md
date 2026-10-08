# DEV-UI-01.6 — READ-ONLY DOCUMENT / FORM SHELL AUDIT

**Headline.** There is no single document editor. There are **8 module form files composed from one shared library** (`sales/_shared/*`, also used by purchasing). The stack is consistent but has three problems:
- **No responsive layout.** Every create, edit and detail page is clean at 1440, 1024 and 768. At 390 most of them overflow the page by 91–229 px (CN, DN and the PO detail are clean).
- **No form-field semantics.** Header labels aren't tied to their inputs, there are 0 `FormField`s, and 5–11 unnamed controls on every create form.
- **Validation is toast-only.** There's no field association, no focus handling, and the toast text is English in AR too.

Line-item editing already scrolls inside its own container, but is keyboard-incomplete. Configure Columns works but isn't accessible and shows English header labels in Arabic. No autosave exists.

## A. Baseline
- **Git:**
  - local `main` = `origin/main` = `ccd7e3902a42057e46d67050d041a5e6974ec6f3`; tree `3311b2df27ef2c930aa6592d0792404b50d88f21`;
  - worktree clean;
  - no `*01-6*` branch locally or on the remote.
- **Read-only:** no branch, edits, commits, pushes, screenshots or deploys. DEV-UI-01.7 not started.
- **Runtime measurement:**
  - **Where:** a scratch detached worktree of `main` with no `.env`, using the existing `tests/ui-baseline/isolation.mjs` harness (refuses anything except `devui010_test_only_*`). The run DB was `devui010_test_only_run` on 127.0.0.1. The seed DB was only queried read-only for document IDs.
  - **What:** 15 routes × EN/AR × 1440/1024/768/390 = 120 measurements, plus interaction probes (validation, item picker, Tab order, add row, Configure Columns, rich text, tabs) on Invoice create at 1440 and 390, EN and AR.
  - **Afterwards:** the worktree was removed; the repository is unchanged.
- **Seed coverage:** the seed only has drafts for QTN-0003, INV-0006 and PO-0003, and no SO, Proforma, DC, CN or DN records. Create pages were measured for all 8 types; edit and detail pages only where records exist.

## B. Document inventory
All 8 types have the same route pattern: list `page.tsx`, `new/page.tsx` (create), `[id]/page.tsx` (view), `[id]/edit/page.tsx` (edit). The form is `*-form.tsx`, a client component with `mode: "create" | "edit"`. Detail actions are in `*-detail-actions.tsx`.

| Type | Statuses (lifecycle matrix) | Editable | Line editor | Totals (form) | Notes / terms | Cfg cols | Primary action (create) | Detail actions by status |
|---|---|---|---|---|---|---|---|---|
| Quotation | draft, sent, accepted, rejected, expired | draft | `variant="full"`, column-driven | TotalsCard | TermsBlock | yes | Save & Submit | status **Select** (all statuses) + Convert |
| Sales Order | draft, confirmed, fulfilled, cancelled | draft | full, column-driven | TotalsCard | TermsBlock | yes | Confirm Order | status Select + Convert |
| Proforma | draft, sent | draft | full, column-driven | TotalsCard | TermsBlock | yes | Send to Client | View Sales Invoice; sent → Record Payment; Convert |
| Sales Invoice | draft, sent, partially_paid, paid, void | draft | full, column-driven | TotalsCard + e-invoice panel (ZATCA countries) | TermsBlock | yes | Send to Client | draft → Send Invoice; else Void (destructive-ghost, if `can`), Record Payment (sent / partial with balance), Convert, Apply Advance |
| Delivery Challan | draft, dispatched, delivered | draft | `variant="qty"`, fixed | none | TermsEditor | no | Create & Dispatch | status Select (no buttons) |
| Credit Note | draft, issued, reversed | draft | `variant="simple"`, fixed | inline strip (**hard-coded "VAT (15%)" label**) | TermsEditor | no | Issue Credit Note | draft → Issue; issued → Reverse (destructive-ghost) |
| Purchase Order | draft, ordered, received, cancelled | draft | full, column-driven | TotalsCard | TermsBlock | yes | Send to Vendor | draft → Cancel (outline) + Send; ordered → Cancel (glass) + Receive; received → Convert + Record Payment |

Debit Note mirrors Credit Note (`variant="simple"`, TermsEditor, draft → Issue Debit Note, issued → Reverse Debit Note, destructive-ghost).

**Common to every type:**
- **Detail page:** Edit (`EditDocumentButton`, drafts only via `canEditDocument`) and Download PDF.
- **Archive / duplicate / delete:** only in the list RowMenu (01.5), not on detail pages.
- **Edit page:** redirects to the detail page when `canEditDocument` is false.
- **Print / PDF:** headless Chromium renders `/print/[type]/[id]` (`lib/pdf/document-pdf.ts`).
- **Preview:** `PreviewDialog` builds an in-page preview from the current form state.

## C. Shared architecture map
```
new/page.tsx | [id]/edit/page.tsx  (server: session, org, customers/vendors, products, projects,
                                     number preview, presets, column config, bank accounts, seal)
  → <XForm mode initial …>  (client; one per module — 8 files, 167–327 lines, all similar)
     ├ CurrencyProvider (docMoneyMark)
     ├ .doc-titlebar: h3 + sub + DocTopActions (Save as Draft, Preview)
     ├ inline grid 1.7fr/1fr: [doc-header-grid × n (DocFieldBox + native input/select)] + DocBrandPanel
     ├ .doc-meta-row (inline 1fr 1fr): PartyCardStatic (From) + PartyCardSelect (To; SearchableSelect)
     ├ DocPillsRow (VAT / Currency / Number Format dialogs) + ConfigureColumnsDialog trigger
     ├ LineItemsEditor → ColumnDrivenEditor | FixedEditor → ItemEntryCell (+ RichTextField dialog)
     ├ .doc-bottom-grid: TermsBlock (Terms | Note | Attachment) or TermsEditor + TotalsCard / inline strip
     ├ BankAccountsField, SealSignaturePreview, DocFooterContact
     ├ DocActionBar (Save as Draft | Preview | primary — edit mode: Preview | Save Changes)
     ├ PreviewDialog
     └ useDirtyForm(snapshot); submit() → markClean → <module>/actions.ts → {error} | redirect
[id]/page.tsx (server) → .inv-head (mono number, sub line, StatusBadge, action group)
  → .inv-grid → PartyCardSimple × 2, <Table> lines (01.5 primitive, physical text-right), TotalsStrip,
    PaymentHistory, BankAccountBlocks, DocumentTermsView, notes (SafeRichText), e-invoice panel
```
- **Shape:** answer **(2) — multiple partially shared architectures.**
  - There is one shared component library and one dirty-form hook.
  - But each module hand-composes its own form with its own inline grid styles, header fields and submit wiring.
  - The two variants: full (column-driven, 5 types) and fixed (DC, CN, DN).
- **No sales/purchasing duplication:** purchasing imports `../../sales/_shared/*`.
- **No `<form>` element anywhere:** submit is button `onClick` → server action.

## D. FormField findings
- **API today:** `src/components/ui/form-field.tsx` takes `label`, `htmlFor`, `error`, `span`, `children`. It renders `<Label htmlFor>` and an optional `<p class="text-[12px] text-danger">`.
- **Gaps:** no description slot, no required indicator, no `id` on the error/description, no `aria-describedby`, no `aria-invalid` propagation, and a 12px off-token error size.
- **Usage:** 136 uses in 26 files, **none passing `error`**. The document editors use **0** `FormField`s.
- **Document editors use `DocFieldBox` instead (29 uses):**
  - its `<label>` is a sibling of the control with no `htmlFor`, so the control has **no programmatic label**;
  - it wraps native `<input type=date>` and `<select>` with `outline-none` (G3);
  - its `.input` box is 38px (not the 36px `--control-height`), 12.5px, and **mono by default**, so Payment Terms and Project names render in mono unless `plain`.
- **Measured unnamed controls per create page:** 5 (DC, CN, DN), 8 (Proforma), 10 (Quotation, SO, PO), **11 (Invoice)**. Labels without association: 3–6 per page.
- **Required API change (01.6):**
  - Add to `FormField`: `id?` (generated with `useId`), `description?`, `required?`, `error?`. Emit the description and error ids; supply `aria-describedby` / `aria-invalid` / `aria-required` to the control by cloning the single child, or through a `useFormField()` context.
  - The error becomes `role="alert"`-capable text on `--text-caption`.
  - `DocFieldBox` should accept `htmlFor` / `id` and reuse the same contract, keeping its gear slot.

## E. Header / metadata findings
- **Fields:**
  - number (DocFieldBox, mono, gear → numbering dialog) and date (native date);
  - Invoice adds Payment Terms (native select, drives Due Date — logic unchanged), Due Date and Project;
  - SO, PO and Quotation add Project; Quotation's validity uses a days dialog;
  - CN and DN have "Against Invoice / PO" (a Select primitive whose `<label>` is unassociated) and Reason;
  - DC has Carrier and Vehicle;
  - the title input uses a plain `.field` label, unassociated.
- **Typography:** the document number is correctly mono (`.doc-field .input`), but so is every non-`plain` header select or text.
- **Status:** the detail header uses `StatusBadge` (registry — centralised, G4 0). Editors show no status (drafts only).
- **Layout:**
  - an inline `1.7fr 1fr` grid (header + brand panel) and inline `1fr 1fr` header rows, in all 8 forms (3–5 `gridTemplateColumns` inline styles each), with **no breakpoint**;
  - at 390 the header grid is 255px wide (two ~100–140px fields) beside a squeezed brand panel (91–110px);
  - the `.doc-titlebar` has 22px h3 (G2) and 12.5px sub.
- **Detail header (`.inv-head`):** a mono h3 number, sub-line, then a **non-wrapping** action group, measured at 390:
  - INV-0003: 450px wide (Download PDF, Void, Record Payment, Convert) → page overflow 225 (EN) / 229 (AR);
  - QTN-0001: 416px → 110 / 59.
- **Heading hierarchy:** editor pages start at **h3** (no h1/h2 in `main`); detail pages likewise.

## F. Party section findings
- **Editor:**
  - "From" (`PartyCardStatic`) shows org data, and its pencil edits the **org master** (`updateOrgContactAction`);
  - "To" (`PartyCardSelect`) is the 01.4 `SearchableSelect` (named by its label, so it's fine). The address, email, phone, VAT/CR shown come **live from the master record**, and its pencil edits the **client/vendor master** (`updatePartyContactAction`);
  - "Add New Client/Vendor" creates a master record in-page.
- **CN / DN:** "To" is read-only and derived from the source invoice or PO (`editable={false}`).
- **No snapshot:** detail pages join `customersTable` live (e.g. `customerName: customersTable.name`). Party display is master data everywhere, so it's presentation-only in the editor; the selection changes `customerId` only.
- **Presentation issues:**
  - the empty state uses legacy `.btn-primary` with `style={{width:"auto"}}` and 12.5 / 11.5px text;
  - the pencil's `aria-label` is a generic "Edit" (no party name);
  - `.pc-edit` uses physical right plus an `[dir=rtl]` override (G1);
  - at 390, `.doc-meta-row` (inline 1fr 1fr) is 393px of content in a 366px box, so the cards overflow.
- **01.6 scope:** layout, labels and empty-state styling only. No data or model change.

## G. Action-bar findings
- **Editor:**
  - `DocTopActions` (titlebar: Save as Draft, Preview) and `DocActionBar` (bottom: Save as Draft, Preview, primary; edit mode: Preview, Save Changes) are legacy `.btn` buttons;
  - "Save as Draft" is styled with an **inline** success colour, so the variant isn't a token;
  - "Saving…" is text only (no 01.4 `loading` / `aria-busy`);
  - the bar is non-sticky and at the page end (top ≈ 2362px at 390 on Invoice);
  - every pending path disables all buttons (`busy`).
- **At 390:** all 3 bottom buttons fit in one 366px row in EN and AR for every type (longest: "Issue Credit Note" / "Create & Dispatch"). The titlebar actions wrap below the title.
- **Detail pages:**
  - `Button` primitives, with destructive-ghost for Void and Reverse (good);
  - the Quotation / SO / DC status **Select has no accessible name**;
  - the action group doesn't wrap, which causes the 390 overflow in E;
  - `const [pending] = useTransition()` is never started in several `*-detail-actions` (invoice, quotation…), so `pending` is always false. Harmless (the confirm dialog owns pending); flagged, not to be changed.
- **Lifecycle and permission conditions** come from `can()` / `canEditDocument` / `status ===` checks. Out of scope; must stay byte-identical in behaviour.

## H. Draft / dirty / autosave findings
- **No autosave anywhere** (no debounce/interval save). Explicit Save only: Save as Draft or primary; edit uses Save Changes.
- **`useDirtyForm`** (`_shared/dirty-form.tsx`) snapshots all form content, guards in-app links, `useGuardedRouter` and `beforeunload`, and uses the global confirm (`navigation.discardUnsavedChanges`). It does `markClean` before a save and `restoreDirty` on error. Behaviour is sound.
- **No visible dirty state:** `dirty` is returned but never rendered.
- **No save-success indication on the page:** the server redirects.
- **Failure:** `toast.error(result.error)` only, with the raw English server string.
- **Recommendation:** visually converge the pending state (01.4 `loading`) and add an optional "Unsaved changes" indicator. **No persistence change.** (Decision AA-4.)

## I. Line-item findings
**Files:** `line-items-editor.tsx` (ColumnDrivenEditor / FixedEditor), `item-entry-cell.tsx`, `line-item-cell.tsx`, `item-image-dialog.tsx`, `line-item-desc.ts`.

- **Row creation:** "Add New Item" and the row delete are `div role="button"` with no `tabIndex` and no key handler, so **neither is keyboard-reachable**.
  - Measured: delete `tabIndex` −1; Tab order goes from the last line cell straight to the Terms tabs.
  - After add, focus stays on `<main>`, not the new row.
  - The delete name is a generic "Remove".
  - Rows are keyed by index.
- **Item name and picker (custom portal):**
  - the input is named only by its placeholder, with `outline-none` and 12px text;
  - the list has no `role` (listbox/option), and the input has no combobox, `aria-expanded` or `aria-activedescendant`;
  - **ArrowDown stays in the input, Escape doesn't close it, and Enter doesn't pick** (measured);
  - positioning is physical `left`, aligned to the input; it stays in the viewport at 390 in EN and AR (AR: list 144–324 vs input 144–313);
  - "Create New Item" creates a product master — business behaviour, unchanged.
- **Line cells** (VAT %, Qty, Unit with datalist, Unit Price, Disc %, custom): **unnamed**, `.item-cell-input` 32px, and numeric alignment computes to physical **right** in EN and AR (the header `th.num` is right too).
- **Computed cells:** Amount, VAT Amt, Disc Amt, Total, formula. The editor's line formula and `totals.ts` stay untouched (pinned).
- **Description:** a rich-text dialog per line (`RichTextField`).
- **Reordering:** none.

## J. Configure Columns findings
- **Applies to** Quotation, SO, Proforma, Invoice and PO (`DOC_TYPES` in `column-config-actions.ts`). DC, CN and DN use fixed columns.
- **Model (`lib/column-config.ts`):**
  - 10 default columns + locked Actions (last);
  - required (cannot hide): description, quantity, unitPrice, taxRatePercent;
  - widths from a fixed `WIDTH_OPTIONS` %, with visible widths summing to ≤100%;
  - custom text, number or formula columns (validated formula vars);
  - `resolveColumns` normalises.
- **Persistence:** per org + user + document type (upsert) plus an activity log; server validation mirrors the client.
- **Presentation and accessibility** (01.6 can own these):
  - **unnamed controls:** 26 of 41 (each row's label input, width select and formula input);
  - **drag-only reorder:** the grip is a `span` (not focusable), so there's no keyboard reorder;
  - **unassociated labels** in "Add Custom Column";
  - **errors:** toast plus an inline AlertCircle with **English** library messages;
  - **no "reset to defaults" button.** `reset()` only re-reads the current columns on open, so adding one is a UX addition: a reviewer call, with persistence unchanged;
  - **English headers in Arabic:** stored `label` values are the English defaults and are rendered raw, so the item table headers and dialog labels **stay English in AR** (measured: AR headers "Item Description, VAT %, Qty…"). The fixed editors translate theirs;
  - **at 390:** the dialog is full-width (0–390) and rows are 348px with no internal overflow, so it's usable but dense;
  - **legacy markup:** `.btn` / `.input` / native select instead of the primitives.
- **Data / persistence semantics:** no bug found; keep byte-identical.

## K. Totals findings
- **TotalsCard (create):** Sub Total, Discount (editable `<input type=number>` — **unnamed**, physical `text-align: right`), Total VAT (n%), Grand Total (22px, 800, display font), and amount in words.
- **TotalsStrip (detail):** the same plus extra rows (Paid, Advance, Credited — `text-success`) and a final row.
- **CN / DN:** an inline strip with **"VAT (15%)" hard-coded in the label** regardless of rate. This is a display defect, not a calculation one.
- **Numbers:** `.v` uses the numeric face and tabular figures (01.1) via `Money` / `DocNum`.
- **Reports:** AA-6 already removed auto-red there; totals have no auto-red.
- **RTL:** rows are flex `space-between`, so they mirror correctly. The discount input stays physically right-aligned.
- **At 390:** the totals column sits off-screen at 353–547 (EN) / −109–85 (AR) because of the `doc-bottom-grid` 1.5fr / 1fr.
- **Out of scope:** formulas (`computeTotals`, `amountInWords`) — pin.

## L. Notes / terms / rich-text findings
- **TermsBlock tabs** (Terms & Conditions / Add Note / Add Attachment) are plain buttons. There's no `tablist`, `tab` or `aria-selected` (measured `null`); the 01.4 Tabs primitive exists.
- **TermsEditor:**
  - each term row is an unlabelled `textarea` (`outline-none`, 12px);
  - the number column is physical `text-right`;
  - reordering is **mouse-drag only**: the grip toggles `draggable` on `mousedown`, so there's no keyboard path;
  - the remove button is named "Remove Term" and has a focus ring (good);
  - group-removal choices use legacy `.btn`.
- **RichTextField:**
  - `contentEditable role="textbox" aria-multiline`, but **no accessible name** (the placeholder is CSS-only);
  - it inherits the page direction (no `dir="auto"`), so mixed EN text in AR is laid out RTL;
  - the toolbar has 10 named 26px buttons, but no `role="toolbar"`;
  - **link insertion uses `window.prompt`** (the pattern 01.5 removed);
  - the close button uses physical margin with an `[dir=rtl]` override (G1);
  - the body is 12.5px.
- **Notes on detail pages:** `SafeRichText` with an 11px uppercase label (G2).
- **Engine and sanitisation** (`sanitize-html.ts`): unchanged; pin.

## M. Validation / error findings
- **No client-side validation.** The server actions return a single English string, e.g. `{ error: "Choose a client." }`, "Add at least one line item.", "Due date cannot be before the issue date.".
- **No field keys and no `fieldErrors`.**
- **Measured empty submit** (EN and AR):
  - the toast is "Choose a client." (English in AR too);
  - 0 `aria-invalid`, 0 `role=alert`;
  - focus drops to `body`; the page stays put; the form state is kept (`restoreDirty`).
- **No first-invalid-field focus and no inline errors** on line items or the header.
- **Field-level association is impossible without either:**
  - (a) client-side pre-checks duplicating the rules — forbidden, since rules can't change; or
  - (b) server error codes — a server change, out of scope.
- **What 01.6 can do:**
  - a translated **document-level error region** (`role="alert"`, `aria-live`), focused on failure, next to the action bar;
  - keep the toast;
  - map the few deterministic messages to fields *only* if the reviewer approves (AA-5).

## N. RTL findings (document scope only)
**Physical rules:**
- CSS:
  - `table.doc-items-table thead th.num { text-align: right }` plus an `[dir=rtl] … th { text-align: right }` override;
  - `.doc-totals-card … input { text-align: right }`;
  - `.pc-edit` and `.rte-close` (left/right plus `[dir]` overrides);
  - `.doc-link-chip`.
- TSX: detail-page line tables use `className="text-right"` on all numeric heads and cells (G1: 54 hits across the 8 detail pages); `preview-dialog.tsx` has 8; `terms-editor` and `item-entry-cell` have 1 each.

**Measured:**
- `.item-cell-input` computes to `right` in EN and AR (start in AR — numbers on the wrong side);
- `th.num` is `right` in both;
- detail `td.text-right` is `right` in AR (should be end, i.e. left).

**Other:**
- Text that doesn't mirror: AR column headers stay English (J), and the toasts are English (M).
- The item picker's portal anchors physically left (safe in practice).
- Mirroring that already works: field order and party cards (grid/flex). The RTE inherits RTL.

## O. Responsive findings — measured at 1440 / 1024 / 768 / 390, EN + AR (page overflow, px)

| Page | 1440 / 1024 / 768 | 390 EN | 390 AR | Cause at 390 |
|---|---|---|---|---|
| Quotation / SO / Proforma / PO create | 0 | 156 | 91 | inline 1.7fr/1fr header grid (brand panel), `.doc-meta-row` 1fr 1fr (393 > 366), `.doc-bottom-grid` 1.5fr/1fr (totals column off-screen), seal box |
| Invoice create | 0 | 157 | 109 | same, plus the e-invoice panel in the totals column |
| DC create | 0 | 15 | 6 | party cards only |
| CN / DN create | 0 | 0 | 0 | single-column header, max-width strip |
| QTN-3 / INV-6 / PO-3 edit | 0 | 156 / 157 / 156 | 123 / 109 / 101 | as create |
| INV-0003 detail (sent) | 0 | 225 | 229 | non-wrapping `.inv-head` action group (450px) + `.inv-grid` 1.6fr/1fr (e-invoice panel off-screen) |
| INV-0006 detail (draft) | 0 | 194 | 198 | `.inv-grid` e-invoice panel |
| QTN-0001 detail | 0 | 110 | 59 | action group (status Select + Convert) |
| PO-0001 detail | 0 | 0 | 0 | — |

How the overflow splits into the three categories:
1. **Document-contained scroll (acceptable):**
   - `.table-scroll` (sw 800 / cw 366) — the item table has `min-width: 800px`, and the column-driven variant is `table-layout: fixed` with % widths of 800;
   - detail `.data-table-wrap`;
   - the Configure Columns dialog (0 internal overflow at 390).
2. **Unacceptable page overflow:** every row of the table above at 390 with a non-zero value. All causes are fixed two-column grids or a non-wrapping flex group. There are **no document responsive rules at all** in `mockup-parity.css`.
3. **Intentional dense desktop structure:** the 800px item editor and the 1.7fr/1fr desktop header — keep at ≥768. 1024 and 768 measured clean.

## P. Mobile line-item findings
At 390 the line editor is a contained 800px horizontal scroll inside a 366px card (EN and AR):
- **What works:** typing, Tab order through the cells, the picker list staying in the viewport, the per-line rich-text dialog.
- **What doesn't:** reaching Delete or Add by keyboard (structural, not a width problem), and roughly 2.2 screen-widths of horizontal scrolling with no frozen item column.
- **Configurable columns are a constraint:** a card layout would have to re-implement user-defined column order, visibility, widths and formula columns per line.

Evidence-based options:
- **A — contained horizontal editor (current):** works now, with no data or behaviour risk.
- **B — priority columns:** conflicts with user-configured visibility.
- **C — line-item cards:** a large rebuild that duplicates the column engine.
- **D — hybrid:** for example, contained table plus a sticky item-name column. That needs separate borders on `.doc-items-table` and touches only editor CSS.

Recommendation in AA-1.

## Q. Mobile action-bar findings
- **Editor:**
  - the 3 bottom buttons fit in one row at 390 for every type, in EN and AR;
  - the titlebar duplicates Save as Draft and Preview at the top, so the most frequent action is reachable without scrolling;
  - destructive lifecycle actions are not on editor pages, only on detail pages;
  - a sticky bottom bar would cover the line editor and the on-screen keyboard while typing.
- **Detail pages:** 2–4 actions in a non-wrapping group overflow at 390 (up to 450px); destructive Void and Reverse are among them.

Recommendation in AA-2.

## R. Accessibility findings (measured / source)
- **Structure:**
  - no `<form>` (0 measured), so the native Enter-to-submit and required semantics are absent;
  - headings start at h3;
  - no fieldsets or groups for header / party / lines / totals.
- **Labels:** 5–11 unnamed controls per create page and 26 in Configure Columns; `DocFieldBox` labels are unassociated; the item name is named by placeholder only; the RTE has no name; the status Select has no name.
- **Keyboard:**
  - Add Item and Delete row are unreachable; focus isn't managed after add or remove;
  - the item picker has no Arrow, Escape or Enter support;
  - Configure Columns and terms have no keyboard reorder;
  - TermsBlock tabs aren't tabs.
- **Announcements:** no live region for save pending, failure or dirty state (toast only); errors are not associated or focused.
- **Focus visibility:** `outline-none` on 3–6 header and line controls per page (G3: 27 document hits) without the 01.4 focus recipe. `.item-cell-input` and `.doc-field` have their own border focus; the item name uses `focus:border-brand-orange` only.
- **Preserved / good:** the SearchableSelect party picker (01.4), the Dialogs (01.4), and named RTE toolbar buttons.

## S. Customer-facing bilingual output boundary
- **PDF and print:** `/print/[type]/[id]` with `print/_shared/pdf-blocks.tsx`, `print/print.css` and `lib/pdf/document-pdf.ts` (Chromium). These share only **logic** with the editor: `totals.ts`, `line-item-desc.ts`, `doc-currency.ts`.
- **Editor-shell only (01.6):** every `sales/_shared` UI component listed in X, the 8 forms, and the detail pages (on-screen view; their `Table` / TotalsStrip / PartyCardSimple are not used by print).
- **Both:** `PreviewDialog` is an on-screen approximation that can be printed (`preview-print-area`). Shared logic helpers matter to both, but only their **calculations**, which are pinned.
- **Recommendation:** 01.6 doesn't touch print / PDF or the bilingual side-by-side output. `PreviewDialog` is limited to dialog chrome (footer buttons). Its document body (8 G1 hits) is left for the future output batch.

## T. Guardrail attribution (entry G1 97 / G2 302 / G3 35 / G4 0 / G5 30·27)
| | Total | Document / form scope | Where |
|---|---|---|---|
| G1 | 97 | **75** | 8 detail pages 54 (`text-right`), `preview-dialog` 8, `mockup-parity.css` document selectors 9 (pc-edit, rte-close, doc-link-chip + `[dir]` overrides), item-entry-cell / terms-editor / client-create / vendor-create dialogs 4. Not counted by G1 but physical: `th.num` right, the discount input right. |
| G2 | 302 | **62** | `mockup-parity.css` document selectors 25 (inv-head h3, doc-titlebar, doc-field label / input, pc-label / name, doc-items-table th, item-name / desc, doc-add-item-btn, rte-body, totals grand / discount, seal, footer, doc-link-chip, rel-node, einvoice); TSX 37 (terms-editor 8, configure-columns 6, terms-block 4, preview 3, settings / pill dialogs 6, party-card 2, item-entry, seal, bank-accounts, cn / dn forms, proforma detail …) |
| G3 | 35 | **27** | the 8 forms 25 (native date / select / title `outline-none`), item-entry-cell 1, rich-text-field 1 |
| G4 | 0 | 0 | stays 0 (`StatusBadge` everywhere) |
| G5 | 30 sites / 27 keys | 2 | `doc-footer-contact.tsx` |

01.6 should reduce only these document-scope hits; preview body and print are excluded.

## U. Dependencies on 01.4 / 01.5
- **From 01.4, reuse:** Button (variants, `loading`), Input, Textarea, Select, SearchableSelect (party picker; its ARIA pattern is the model for the item picker), Checkbox, Tabs (TermsBlock tabs), Dialog, DropdownMenu (ConvertMenu), focus-visible recipe, `--danger-hover`.
- **New primitives:** none needed. The document-only exception is `DocFieldBox`, kept as a styled wrapper on the same label / description / error contract.
- **From 01.5, keep untouched:** the `Table` API, density and sticky action cells, numeric `data-cell`, RowMenu, list-search, filters.
  - Detail-page line tables should **adopt** `TableHead numeric` / `TableCell numeric` (01.5 explicitly deferred them here).
  - The editor's `.doc-items-table` stays a separate, document-scoped table. It is not migrated to `Table`, because of the editable cells, column config and the 800px min-width.
- **01.5 pins that must keep holding:** `configure-columns-dialog.tsx`, `column-config.ts`, `column-config-actions.ts`, `line-items-editor.tsx`, `item-entry-cell.tsx`, `line-item-cell.tsx`, `rich-text-field.tsx`, `terms-editor.tsx`, `terms-block.tsx`, `party-card.tsx`, `totals-card.tsx`, `doc-field-box.tsx`, `doc-pills-row.tsx`, `doc-action-bar.tsx`, and the doc-editor CSS hash `93f29b299f31d7f9`.
  - These are 01.5 freezes that 01.6 owns.
  - The 01.6 implementation must **retire those pins in `verify-datatable.mts` deliberately**: update or remove the editor-file pins, documented. Logic pins (`column-config.ts`, `column-config-actions.ts`) stay.

## V. Screenshot plan (proposal; nothing captured)
- **Existing matrix:** the 256-state matrix already holds `sales-invoice-new`, `sales-invoice-edit` and `sales-invoice-detail` (24 states). They will change; the comparison goes in the change report.
- **Proposed additive `document-states.mjs`** (`run.mjs capture-documents`). Each state below is EN/AR × 1440/1024/768/390 light unless noted:

  | State | Notes |
  |---|---|
  | Invoice create — empty draft | also dark at 1440 |
  | Invoice create — party selected + 3 lines + discount + notes | also dark at 1440 |
  | Item picker open | |
  | Validation error (empty submit → error region) | |
  | Configure Columns open | |
  | Notes tab with rich-text toolbar | |
  | Terms with 2 terms | |
  | Invoice edit (INV-0006) | |
  | Invoice detail — sent (INV-0003, action group) | also dark at 1440 |
  | Invoice detail — draft (INV-0006) | |
  | Quotation create | |
  | Quotation detail (QTN-0001, status Select open) | |
  | PO create | |
  | PO detail — received | |
  | CN create (fixed editor + inline totals) | |
  | DC create | |
  | Dirty indicator / save pending | only if AA-4 approves a deterministic indicator (pending frozen via a stubbed action response in the TEST harness) |

- **Size:** about 16 states × 8 + 6 dark ≈ **134**, captured twice and required byte-identical.
- **Seed gap:** SO, Proforma and DN have no seed records. Their create pages are covered by verifier containment checks, not screenshots (the seed is not altered).

## W. Verification plan
**`verify/verify-document-form.mts` (static, into `verify:static`):**
- **FormField:** emits `id` / `aria-describedby` / `aria-invalid` / `aria-required`; the error and description have ids; caption token.
- **DocFieldBox:** requires `htmlFor`; no native `<select>` or `<input type=date>` with `outline-none` in the forms; header controls use primitives or the documented doc wrapper.
- **Forms:** no inline `gridTemplateColumns` in the 8 forms; document grids use responsive classes with a single-column breakpoint.
- **Action bars:** `loading` instead of "Saving…" text; no inline colour; detail action groups wrap.
- **Line items:**
  - Add and Delete are `<button>` with row-specific names;
  - line inputs are named;
  - the picker has combobox / listbox / option roles and the key handler;
  - the TermsBlock uses Tabs;
  - the RTE has `aria-label` / `aria-labelledby`, `dir="auto"` and no `window.prompt`.
- **Configure Columns:** named controls; keyboard move-up/down; default labels rendered through `t()`.
- **Numbers and RTL:** detail line tables use `numeric` (no `text-right`); `th.num` / `.item-cell-input` / discount use `text-align: end`; no new physical CSS in document selectors.
- **CN / DN:** the totals label isn't hard-coded "15%".
- **Pins (byte):** listed in Y.
- **Mutation-tested** (target ≥ 40).

**`verify/verify-document-form-runtime.mjs` (browser tier, refuses a non-test DB):**
- **Containment:** 0 page overflow on every create, edit and detail page measured, at 1440/1024/768/390 EN and AR; `.table-scroll` still contains the 800px editor.
- **Error association:**
  - every visible control in `main` has an accessible name;
  - FormField error/description ids are referenced, using a fixture page or a real FormField consumer with an error.
- **Validation:** empty submit → translated error region (`role=alert`) and focus moved to it, with the URL unchanged.
- **Dirty and save:**
  - typing marks dirty (indicator if approved);
  - navigating away triggers the existing confirm;
  - Save as Draft shows `aria-busy` while pending;
  - success redirects as before.
- **Keyboard:**
  - Add Item by keyboard → new row and focus in its item name;
  - Delete row by keyboard → row removed and focus moves to a sensible neighbour;
  - picker: ArrowDown / Enter picks and fills price, VAT and unit (values equal to the product's — no calc change); Escape closes.
- **Configure Columns:** keyboard reorder changes the order; Save persists (TEST DB) and the table updates; AR headers translated.
- **RTL numbers:** line inputs, `th.num` and detail numeric cells sit at the logical end in EN and AR.
- **Action bar:** accessible names; detail group wraps (no overflow at 390).
- **No business change:** a draft invoice saved before and after has identical subtotal / tax / total in the DB (TEST) for a fixed line set; the lifecycle buttons per status match the matrix.

**Mutations (runtime, each with a fresh build):**
- inline 2-col grid restored;
- `DocFieldBox` `htmlFor` removed;
- delete `button` → `div`;
- picker Arrow handler removed;
- error region removed;
- `th.num` right restored;
- detail action wrap removed;
- RTE name removed.

**Existing suites coupled to editor selectors** (`.doc-action-bar`, `.doc-pill-btn`, `.doc-field`): dirty-core, draft-buttons, draft-func, edit, preset-zatca, print-apply, vendor-inline, controls-runtime. Keep those selectors stable (selector-only adaptation if unavoidable, documented).

## X. Proposed implementation scope (exact files)
- **FormField and primitives:**
  - `src/components/ui/form-field.tsx`: the D contract, backward compatible for the 136 call sites;
  - no new primitives.
- **Shared document shell:**
  - `sales/_shared/doc-field-box.tsx`: label association, description / error, 36px token, `plain` default for non-codes;
  - `doc-top-actions.tsx`: Button + `loading`;
  - optional `sales/_shared/doc-form-error.tsx` (new): the translated document-level error region.
- **Action bar:**
  - `doc-action-bar.tsx`: Button variants + `loading`, no inline colour, `flex-wrap`;
  - detail action groups via a wrap class in `mockup-parity.css` (`.inv-head` actions);
  - `quotation-` / `order-` / `dc-detail-actions.tsx`: an `aria-label` on the status SelectTrigger only.
- **Header fields:** the 8 forms (`quotation-`, `order-`, `proforma-`, `invoice-`, `dc-`, `cn-`, `po-`, `dn-form.tsx`):
  - inline grids → classes;
  - native date / select → Input type=date / Select primitives inside DocFieldBox, values and handlers unchanged;
  - title field → FormField;
  - error region;
  - CN / DN totals label uses the actual rate display (display only).
- **Party section:** `party-card.tsx` — empty-state Button, a named pencil ("Edit <party>"), logical `.pc-edit` CSS.
- **Line items:**
  - `line-items-editor.tsx`: real buttons for Add and Delete (row-specific names), named cell inputs, focus management, stable row keys if possible without changing data (index keys acceptable if focus is managed — decide in implementation);
  - `item-entry-cell.tsx`: combobox / listbox / option ARIA + Arrow / Enter / Escape, a named input, focus-visible, logical portal alignment.
- **Configure Columns:** `configure-columns-dialog.tsx` — named controls, move-up/down buttons, associated labels, translated default labels at render (presentation only; stored labels unchanged), primitives. No change to `column-config.ts` or the actions.
- **Totals:** `totals-card.tsx` (named discount input, logical alignment) and `totals-strip.tsx` (none, or label only).
- **Notes and terms:**
  - `terms-block.tsx`: Tabs primitive;
  - `terms-editor.tsx`: named textareas, logical numbering, keyboard move-up/down, focus-visible;
  - `rich-text-field.tsx`: name prop, `dir="auto"`, `role="toolbar"`, link Dialog instead of `window.prompt`, logical close.
- **Detail pages:** the 8 `[id]/page.tsx` files:
  - `TableHead` / `TableCell numeric` instead of `text-right`;
  - `.inv-grid` and `.party-row` responsive classes;
  - notes label size token.
  - No data or query change.
- **CSS:** `src/app/(app)/mockup-parity.css`, document selectors only:
  - responsive breakpoints for `.doc-titlebar`, `.doc-head-grid` (new class for the inline grid), `.doc-header-grid`, `.doc-meta-row`, `.doc-bottom-grid`, `.inv-head`, `.inv-grid`, `.party-row`, seal box;
  - logical `th.num`, discount, `.pc-edit`, `.rte-close`;
  - type-scale fixes.
  - The doc-editor CSS hash changes deliberately.
- **Dictionary:** `src/lib/i18n/dict.ts` — additive keys (error region, names, column default labels already present). G5 must not regress.
- **Verification:**
  - `verify/verify-document-form.mts` and `verify/verify-document-form-runtime.mjs` (new);
  - `package.json` gets the script wiring only;
  - `verify/verify-datatable.mts`: retire the 01.5 editor-file pins deliberately (documented) and keep the logic pins.
- **Screenshots and docs:**
  - `tests/ui-baseline/document-states.mjs` and `run.mjs` (capture-documents);
  - `tests/ui-baseline/candidates/dev-ui-01-6/`;
  - `docs/ui/dev-ui-01-6/` (README, audit, consumer migrations, reports).
- **Not included:** `preview-dialog.tsx` body, settings and pill dialogs (`number-settings`, `pill-settings`, `vat-settings`, `currency-pill`, `date-settings`, `validity-days`), `client-create` / `vendor-create` / `party-edit` dialogs (master-data forms, a later batch), `bank-accounts-field`, `seal-signature`, `doc-brand-panel` (layout only via CSS).

## Y. Protected scope / byte pins
**Byte-pin (must stay identical):**
- **Lifecycle and documents:** `src/lib/document-lifecycle.ts`, `document-edit.ts`, `document-duplicate.ts`, `documents.ts`, `document-registry.ts`.
- **Accounting and posting:** `invoice-posting.ts`, `accounting.ts`, `settlement.ts`, `advance-allocations.ts`, `payment-reversal.ts`.
- **Shared libraries:** `status-registry.ts`, `column-config.ts`, `sanitize-html.ts`, `lib/currency/*`, `lib/pdf/*`.
- **Editor logic helpers:** `sales/_shared/totals.ts`, `line-item-desc.ts`, `doc-currency.ts`.
- **Server actions:**
  - all 8 module `actions.ts`, plus `invoices/advance-actions.ts`;
  - `sales/_shared/creation-popup-actions.ts`, `column-config-actions.ts`;
  - `documents/_workspace/saved-view-actions.ts`.
- **Shared app modules:** `_shared/dirty-form.tsx` (semantics; `dirty` is already exposed), `_shared/edit-document.tsx`, `_shared/confirm-provider.tsx`, `_shared/lifecycle-actions.ts`.
- **01.5 list logic:** `use-list-filters.ts`, `filter-types.ts`, `document-list-workspace.ts`.
- **Print:** `print/**` (route, pdf-blocks, print.css).
- **Shell:** `components/layout/*`, `shell.css`, `components/ui/dropdown-menu.tsx`.
- **Data:** `src/db/**`, `drizzle/**`, migrations, `package-lock.json`.
- **Screenshot candidates:** the baseline and the 01.1–01.5 candidates.

**Cannot be pinned (legitimate 01.6 edits):** every file in X, including the 01.5 editor-file pins listed in U, which 01.5 froze precisely for this batch.

## Z. Explicit exclusions
- **No changes to:** DB / drizzle / migrations, lifecycle rules, posting, stock, tax / totals formulas, permissions, tenancy, conversion, cancel / void / reverse, archive / delete, numbering, party master-data semantics (pencil and create still edit master records), column-config persistence, and the server error strings or their shape.
- **Print / PDF:** no print / PDF / bilingual output work; `PreviewDialog` body is excluded.
- **Not reopened:** the shell, the list workspace (01.5) and the status registry.
- **No new features:** no autosave, no client-side validation rules, no line reordering feature (keyboard reorder only where drag already exists — terms, columns), no app-wide G1 sweep.
- **Out of batch:** master-data forms (client / vendor / product) and the settings dialogs.

## AA. Genuine reviewer decisions
1. **Mobile line-item strategy.**
   - **Options:** A — contained horizontal editor (current, 800px min); B — priority columns; C — cards; D — hybrid, A plus a sticky item-name column.
   - **Evidence:** it works today in EN and AR; the column engine is user-configurable (B / C would fork it); the remaining problems are keyboard and a11y, not width.
   - **Impact:** A / D touch editor CSS only; C needs a new editor.
   - **Recommendation:** **A now**, with the accessibility fixes in I. D only if the reviewer wants the sticky item column (low risk, editor CSS).
2. **Mobile action bar.**
   - **Options:** A — keep the inline end-of-form bar (`flex-wrap`), with the titlebar Save Draft / Preview staying at the top; B — sticky bottom bar under 768; C — primary + overflow menu.
   - **Evidence:** all 3 buttons fit at 390 in EN and AR; Save as Draft is already at the top; a sticky bar would cover the line editor and keyboard. Detail action groups (2–4 actions, including destructive) overflow today.
   - **Recommendation:** **A for editors; wrap (not overflow menu) for detail action groups**, so destructive actions stay visible and separately labelled.
3. **Formal reusable document header / shell component.**
   - **Options:** A — new `DocumentFormLayout` components replacing per-form markup; B — keep per-module composition, replace inline grids with shared responsive classes, converge DocFieldBox / FormField.
   - **Evidence:** 8 forms with differing header fields; the shared library already covers the parts.
   - **Recommendation:** **B** (smaller diff, no behaviour risk). Revisit A with the bilingual output batch.
4. **Save / autosave status.** There is no autosave.
   - **Options:** A — no indicator (today); B — transient: "Unsaved changes" text in the titlebar (polite live region) only while dirty, plus `loading` / `aria-busy` while saving, plus the error region on failure; C — persistent status line ("All changes saved" / "Unsaved").
   - **Evidence:** saves redirect, so there's no in-page success state to show.
   - **Recommendation:** **B.**
5. **FormField error / description layout.**
   - **Options:** A — description under the label, error under the control (caption, danger), both via `aria-describedby`; the document-level error region holds server errors, with no field mapping; B — A plus a client-side mapping of the 3–4 deterministic server messages (client, issue date, line items, due date) to fields.
   - **Evidence:** the server returns one untranslated string with no field key.
   - **Recommendation:** **A** (B duplicates rules client-side and is fragile).
6. **Configure Columns presentation.**
   - **Options:** A — keep the dialog; add accessible names, move-up/down buttons alongside drag, associated labels, primitives and translated default labels; B — also add "Reset to defaults" (writes the default config through the existing save action — a new user action, persistence unchanged); C — redesign (e.g. sheet or table).
   - **Recommendation:** **A**, with B as the reviewer's call.
   - Also confirm: translate a column label only when it equals the built-in English default (custom or renamed labels shown as typed).
7. **Editor density.**
   - **Options:** A — header fields on `--control-height` (36) and line cells on `--control-height-compact` (32, already); B — keep the 38px doc fields.
   - **Evidence:** the 38px fields are the only off-token control height in the app after 01.4.
   - **Recommendation:** **A** (desktop and mobile alike; 390 relies on single-column stacking, not smaller controls).

**STOP.** No branch, no edits, no commits or pushes, no merge, no deploy, no production access. DEV-UI-01.7 not started.
