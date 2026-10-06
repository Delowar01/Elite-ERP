// Document / form shell (DEV-UI-01.6). Run via `npm run verify:document-form` (part of verify:static).
//
// What it pins, so the document editors cannot drift back:
//   1. FormField     — description / required / error with ids, a render-function contract that hands
//                      the control its ARIA, and no cloning of arbitrary children
//   2. header fields — DocFieldBox binds a real <label> to the editable control; display values are not
//                      labels; the 8 forms use Input / Select primitives (no raw <select>/<input>,
//                      no outline-none), Title on FormField, ids on SelectTrigger (never the Select root)
//   3. layout        — no inline grid recipes in the forms; responsive document classes that stack at
//                      phone width; detail action groups wrap
//   4. save state    — approved Buttons with `loading` on the pressed button; "Unsaved changes" from the
//                      existing dirty flag; a focused role=alert error region; server text untouched
//   5. lines         — real Add / Remove buttons with names, named cells, focus after add / remove, a
//                      true combobox item picker; LineItemDraft unchanged
//   6. columns       — Configure Columns on primitives, every control named, keyboard Move up / down, no
//                      Reset-to-defaults, built-in labels translated at display time only
//   7. terms / text  — Tabs; document-only keyboard reorder (master editor unchanged); the rich-text
//                      field named, a toolbar, dir=auto, a selection-keeping link Dialog
//   8. numbers / RTL — logical end for document numbers; detail line tables on Table `numeric`
//   9. boundaries    — business logic, server actions, dirty-form, print / PDF, shell, DB byte-identical;
//                      submit bodies, dirty snapshots and the line-item shape identical to the baseline

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";
import { t as translate } from "../src/lib/i18n/dict";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const A = "src/app/(app)/";
const SH = A + "sales/_shared/";
/** Source without comments, so a check never matches its own explanation. */
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const h16 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const sha = (p: string) => h16(readFileSync(join(ROOT, p)));
const css = read(A + "mockup-parity.css").replace(/\/\*[\s\S]*?\*\//g, "");
function rules(sel: string) {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) out.push(m[2]);
  return out.join(";");
}
const decl = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim());
/** The balanced-brace block that starts at `start` (a function or type), or "". */
function block(src: string, start: string): string {
  const i = src.indexOf(start);
  if (i < 0) return "";
  let d = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  return "";
}
// The body of a function whose parameter list may itself contain braces (destructured props).
function fnBody(src: string, start: string): string {
  const i = src.indexOf(start);
  if (i < 0) return "";
  let p = 0, j = src.indexOf("(", i);
  for (; j < src.length; j++) { if (src[j] === "(") p++; else if (src[j] === ")" && --p === 0) break; }
  return block(src.slice(j), ")");
}

type El = { file: string; tag: string; attrs: Record<string, string>; text: string; line: number };
function elements(file: string): El[] {
  const text = read(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: El[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs: Record<string, string> = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText()] = a.initializer?.getText() ?? "true";
      const parent = ts.isJsxOpeningElement(n) ? n.parent : n;
      out.push({ file, tag: n.tagName.getText(), attrs, text: parent.getText(), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const at = (e: El) => `${e.file.replace(A, "")}:${e.line}`;

const FORMS = [
  "sales/quotations/quotation-form.tsx", "sales/orders/order-form.tsx", "sales/proforma/proforma-form.tsx", "sales/invoices/invoice-form.tsx",
  "sales/delivery-challans/dc-form.tsx", "sales/credit-notes/cn-form.tsx", "purchasing/orders/po-form.tsx", "purchasing/debit-notes/dn-form.tsx",
].map((f) => A + f);
const DETAILS = ["quotations", "orders", "proforma", "invoices", "delivery-challans", "credit-notes"].map((m) => `${A}sales/${m}/[id]/page.tsx`)
  .concat(["orders", "debit-notes"].map((m) => `${A}purchasing/${m}/[id]/page.tsx`));
const formSrc = Object.fromEntries(FORMS.map((f) => [f, read(f)]));
const short = (f: string) => f.replace(A, "");

// ---------- 1. FormField ----------
const formField = read("src/components/ui/form-field.tsx");
const ffCode = code(formField);
check("FormField: optional description / required / error, `htmlFor` stays the control id",
  /description\?: string/.test(ffCode) && /required\?: boolean/.test(ffCode) && /error\?: string/.test(ffCode) && /htmlFor: string;/.test(ffCode) && /<Label htmlFor=\{htmlFor\}>/.test(ffCode));
check("FormField: description / error text carry ids derived from htmlFor (caption token; the error is marked)",
  /description: `\$\{htmlFor\}-description`, error: `\$\{htmlFor\}-error`/.test(ffCode) && /<p id=\{ids\.description\} className="text-caption/.test(ffCode) &&
  /<p id=\{ids\.error\} className="text-caption text-danger"/.test(ffCode) && !/text-\[12px\]/.test(ffCode));
// DEV-UI-01.6-C1: the rendered error is announced (role=alert); the description is help text, never an alert.
const ffError = ffCode.match(/<p id=\{ids\.error\}[^>]*>/)?.[0] ?? "";
const ffDescription = ffCode.match(/<p id=\{ids\.description\}[^>]*>/)?.[0] ?? "";
check("FormField: the error is an alert (id from htmlFor, caption + danger tokens, role=alert, data-field-error); the description is not",
  /\bid=\{ids\.error\}/.test(ffError) && /className="text-caption text-danger"/.test(ffError) && /\brole="alert"/.test(ffError) && /\bdata-field-error=""/.test(ffError) &&
  ffDescription !== "" && !/role=|aria-live/.test(ffDescription), ffError);
check("FormField: render-function contract hands {id, describedBy, invalid, required}; plain children still render",
  /children: React\.ReactNode \| \(\(field: FieldProps\) => React\.ReactNode\)/.test(ffCode) && /typeof children === "function" \? children\(field\) : children/.test(ffCode) &&
  /const field: FieldProps = \{ id: htmlFor, describedBy, invalid: error \? true : undefined, required: required \? true : undefined \}/.test(ffCode));
check("FormField: no cloning of arbitrary children (ARIA goes only where the caller puts it)", !/cloneElement|Children\.(map|only|forEach)|isValidElement/.test(ffCode));

// ---------- 2. header fields ----------
const dfb = code(read(SH + "doc-field-box.tsx"));
check("DocFieldBox: an editable field renders a real <Label htmlFor> bound to its control",
  /\{htmlFor \? \(\s*<Label htmlFor=\{htmlFor\} className="doc-field-label">/.test(dfb) && /htmlFor\?: string/.test(dfb));
check("DocFieldBox: a display value is plain text — no label without a control; code face only via `mono`",
  /<div className="doc-field-label">\{caption\}<\/div>/.test(dfb) && !/<label\b/.test(dfb) && /mono \? "input mono" : "input"/.test(dfb));
check("DocFieldBox: numbering gear behaviour unchanged (NumberSettingsDialog for gearDocType, gearDialog slot)",
  /<NumberSettingsDialog\s+locale=\{locale\}\s+documentType=\{gearDocType\}/.test(dfb) && /gearDialog \? \(\s*gearDialog/.test(dfb));
const formEls = FORMS.flatMap((f) => elements(f));
const raw = formEls.filter((e) => e.tag === "select" || e.tag === "input" || e.tag === "textarea");
check("the 8 forms: no raw <select> / <input> / <textarea> (header controls are Input / Select primitives)", raw.length === 0, raw.map(at).join(" "));
const outlineNone = FORMS.filter((f) => /outline-none/.test(code(formSrc[f])));
check("the 8 forms: no outline-none (controls keep the approved focus treatment)", outlineNone.length === 0, outlineNone.map(short).join(" "));
const boxes = formEls.filter((e) => e.tag === "DocFieldBox");
const badBoxes = boxes.filter((b) => {
  if (!b.attrs.htmlFor) return !("mono" in b.attrs) || !("gear" in b.attrs); // display = the document number
  const id = b.attrs.htmlFor;
  return !new RegExp(`id=${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(b.text);
});
check("every DocFieldBox is either the mono number display or labels a control carrying that exact id", boxes.length >= 24 && badBoxes.length === 0, `${boxes.length}; ${badBoxes.map(at).join(" ")}`);
const selectRootIds = formEls.filter((e) => e.tag === "Select" && ("id" in e.attrs || "aria-label" in e.attrs || "aria-describedby" in e.attrs));
const triggers = formEls.filter((e) => e.tag === "SelectTrigger");
check("Radix Select: ids / ARIA on SelectTrigger, never on the Select root", selectRootIds.length === 0 && triggers.length >= 7 && triggers.every((e) => "id" in e.attrs), `${triggers.length} triggers; ${selectRootIds.map(at).join(" ")}`);
const titles = FORMS.filter((f) => /setTitle/.test(formSrc[f]));
const badTitles = titles.filter((f) => !/<FormField label=\{t\(locale, "[^"]+ Title"\)\} htmlFor=\{`\$\{fid\}-title`\}>\s*\{\(field\) => \(\s*<Input id=\{field\.id\} aria-describedby=\{field\.describedBy\} value=\{title\} onChange=\{\(e\) => setTitle\(e\.target\.value\)\} placeholder=\{t\(locale, "[^"]+"\)\} \/>/.test(formSrc[f]));
check("Title fields on FormField + Input (render contract; same state, placeholder and handler)", titles.length === 5 && badTitles.length === 0, `${titles.length}; ${badTitles.map(short).join(" ")}`);
check("Payment Terms → Due Date wiring unchanged (choosePaymentTerm on the Select, setDueDate on the date)",
  /onValueChange=\{\(v\) => choosePaymentTerm\(v === NONE \? "" : v\)\}/.test(formSrc[FORMS[3]]) && /onChange=\{\(e\) => setDueDate\(e\.target\.value\)\}/.test(formSrc[FORMS[3]]) &&
  /function choosePaymentTerm\(id: string\) \{\s*setPaymentTermId\(id\);/.test(formSrc[FORMS[3]]));
check("CN / DN source document Select: same value / handler / edit lock",
  /<Select value=\{sourceInvoiceId\} onValueChange=\{setSourceInvoiceId\} disabled=\{isEdit\}>/.test(formSrc[FORMS[5]]) &&
  /<Select value=\{sourcePurchaseOrderId\} onValueChange=\{setSourcePurchaseOrderId\} disabled=\{isEdit\}>/.test(formSrc[FORMS[7]]));

// ---------- 3. layout ----------
const inlineGrid = FORMS.filter((f) => /gridTemplateColumns/.test(formSrc[f]));
check("the 8 forms: no inline gridTemplateColumns (document classes instead)", inlineGrid.length === 0, inlineGrid.map(short).join(" "));
check("document grid classes keep the desktop layout (header 1.7fr/1fr, rows 1fr 1fr, bottom 1.5fr/1fr)",
  decl(rules(".doc-head-grid"), "grid-template-columns")[0] === "minmax(0, 1.7fr) minmax(0, 1fr)" &&
  decl(rules(".doc-header-grid"), "grid-template-columns")[0] === "minmax(0, 1fr) minmax(0, 1fr)" &&
  decl(rules(".doc-meta-row"), "grid-template-columns")[0] === "minmax(0, 1fr) minmax(0, 1fr)" &&
  decl(rules(".doc-bottom-grid"), "grid-template-columns")[0] === "minmax(0, 1.5fr) minmax(0, 1fr)");
const phone = css.match(/@media \(max-width: 640px\) \{\s*([^{}]+)\{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/);
const stacked = phone ? phone[1].split(",").map((s) => s.trim()) : [];
check("at phone width every two-column document block stacks (head, header rows, party, bottom, seal, detail grid, party row)",
  [".doc-head-grid", ".doc-header-grid", ".doc-meta-row", ".doc-bottom-grid", ".seal-sig-grid", ".inv-grid", ".party-row"].every((s) => stacked.includes(s)), stacked.join(" "));
check("detail action groups wrap; module action wrappers flatten so each button wraps on its own",
  /flex-wrap: wrap/.test(rules(".inv-head-actions")) && /flex-wrap: wrap/.test(rules(".inv-head")) && decl(rules(".inv-head-actions > div"), "display")[0] === "contents" &&
  DETAILS.every((f) => /<div className="inv-head-actions">/.test(read(f))));
check("editor action bar and titlebar actions wrap", /flex-wrap: wrap/.test(rules(".doc-action-bar")) && /flex-wrap: wrap/.test(rules(".doc-titlebar-actions")) && /flex-wrap: wrap/.test(rules(".doc-titlebar")));
check("the 800px line editor still scrolls inside .table-scroll", /overflow-x: auto/.test(rules(".table-scroll")) && /min-width: 800px/.test(rules("table.doc-items-table")));
check("line-table header labels wrap inside their column (no nowrap overlap)", decl(rules("table.doc-items-table thead th"), "white-space")[0] === "normal");
check("the line editor's scroll box contains its sr-only header text (position: relative), so the page never widens",
  /position: relative/.test(rules(".doc-items-scroll")) && (read(SH + "line-items-editor.tsx").match(/<div className="table-scroll doc-items-scroll">/g) ?? []).length === 2);

// ---------- 4. save state ----------
const bar = code(read(SH + "doc-action-bar.tsx"));
const top = code(read(SH + "doc-top-actions.tsx"));
check("action bars on the Button primitive (outline draft / secondary preview / primary final), no legacy .btn",
  !/className="btn/.test(bar + top) && (bar.match(/variant="outline"/g) ?? []).length === 1 && (bar.match(/variant="secondary"/g) ?? []).length === 2 &&
  !/variant="(success|ghost|default)"/.test(bar + top) && (top.match(/variant="outline"/g) ?? []).length === 1 && (top.match(/variant="secondary"/g) ?? []).length === 1);
check("pending save: `loading` on the pressed button only, every button disabled while busy",
  /loading=\{busy && pressed === "draft"\}/.test(bar) && (bar.match(/loading=\{busy && pressed === "primary"\}/g) ?? []).length === 2 && /loading=\{busy && pressed\}/.test(top) &&
  (bar.match(/disabled=\{busy\}/g) ?? []).length === 3 && /disabled=\{busy\}/.test(top));
check("no hand-coloured success draft button and no 'Saving…' label swap", !/var\(--success\)/.test(bar) && !/Saving…/.test(bar + top));
check("create vs edit and preview behaviour preserved (Save Changes in edit mode, disabled Preview without a handler)",
  /if \(editMode\)/.test(bar) && /t\(locale, "Save Changes"\)/.test(bar) && /title=\{t\(locale, "Save the document first to preview\."\)\}/.test(bar) && /t\(locale, primaryLabel\)/.test(bar));
const dirtyInd = code(read(SH + "doc-dirty-indicator.tsx"));
check("Unsaved changes: polite status, text only while dirty, from the existing dirty flag",
  /role="status" aria-live="polite"/.test(dirtyInd) && /\{dirty \? t\(locale, "Unsaved changes"\) : ""\}/.test(dirtyInd) && /<DocDirtyIndicator locale=\{locale\} dirty=\{dirty\} \/>/.test(top) &&
  FORMS.every((f) => /dirty=\{dirtyForm\.dirty\} \/>/.test(formSrc[f])));
const err = code(read(SH + "doc-form-error.tsx"));
check("error region: role=alert, programmatically focusable, focused when an error appears, translated with raw fallback",
  /role="alert"/.test(err) && /tabIndex=\{-1\}/.test(err) && /useEffect\(\(\) => \{\s*if \(error\) ref\.current\?\.focus\(\);\s*\}, \[error\]\);/.test(err) && /\{t\(locale, error\)\}/.test(err));
const badErr = FORMS.filter((f) => {
  const s = formSrc[f];
  return !/setFormError\(null\);\s*start\(async \(\) => \{/.test(s) || !/dirtyForm\.restoreDirty\(\);\s*toast\.error\(result\.error\);\s*setFormError\(result\.error\);/.test(s) || !/<DocFormError locale=\{locale\} error=\{formError\} \/>/.test(s);
});
check("every form: error cleared at the start of a save, set after restoreDirty + toast, region rendered", badErr.length === 0, badErr.map(short).join(" "));
const SERVER_MESSAGES = ["Choose a client.", "Choose a vendor.", "Add at least one line item.", "Issue date is required.", "Order date is required.", "Due date cannot be before the issue date.",
  "Choose the invoice this credit note is against.", "Choose the purchase order this debit note is against."];
const dupRules = FORMS.filter((f) => SERVER_MESSAGES.some((m) => formSrc[f].includes(m)));
check("no client-side duplicate of server validation (server messages are only displayed, never re-checked)", dupRules.length === 0, dupRules.map(short).join(" "));
check("no <form> architecture in the 8 editors (explicit button handlers unchanged)", FORMS.every((f) => !/<form\b/.test(formSrc[f])));

// ---------- 5. line items ----------
const lie = code(read(SH + "line-items-editor.tsx"));
const lieEls = elements(SH + "line-items-editor.tsx");
check("line Add / Remove are real buttons (no div role=button)", !/role="button"/.test(lie) &&
  /<button type="button" className="doc-add-item-btn" data-line-add="" onClick=\{onAdd\}>/.test(lie) && /<button type="button" className="item-del-btn" onClick=\{onRemove\} aria-label=\{name\}/.test(lie));
check("Remove names its line (\"Remove line item N\"); Add is named by its text", /const name = `\$\{t\(locale, "Remove line item"\)\} \$\{index \+ 1\}`;/.test(lie) && /\{t\(locale, "Add New Item"\)\}/.test(lie));
const unnamedCells = lieEls.filter((e) => e.tag === "input" && /item-cell-input/.test(e.attrs.className ?? "") && !("aria-label" in e.attrs));
check("every editable line cell has an accessible name (column + line)", unnamedCells.length === 0 && lieEls.filter((e) => e.tag === "input" && "aria-label" in e.attrs).length >= 10, unnamedCells.map(at).join(" "));
check("focus after Add → the new row's item field; after Remove → the row now there / the previous / Add",
  /afterAdd: \(\) => \{ pending\.current = items\.length; \}/.test(lie) && /afterRemove: \(index: number\) => \{ pending\.current = index; \}/.test(lie) &&
  /rows\[Math\.min\(target, rows\.length - 1\)\]/.test(lie) && /\[data-line-item-name\]/.test(lie) && /\[data-line-add\]/.test(lie) &&
  (lie.match(/focus\.afterRemove\(index\);/g) ?? []).length === 2 && (lie.match(/focus\.afterAdd\(\);/g) ?? []).length === 2);
const mainLie = "e020baaf41358458";
check("LineItemDraft / emptyLineItem unchanged (no React-only keys in the payload; index keys kept)",
  h16(block(read(SH + "line-items-editor.tsx"), "export type LineItemDraft = ") + block(read(SH + "line-items-editor.tsx"), "export const emptyLineItem = ")) === mainLie &&
  !/_id|_key|crypto\.randomUUID|uuid/.test(lie));
const iec = code(read(SH + "item-entry-cell.tsx"));
check("item picker: combobox input (autocomplete list, expanded, controls, activedescendant, named, data hook)",
  /role="combobox"/.test(iec) && /aria-autocomplete="list"/.test(iec) && /aria-expanded=\{open\}/.test(iec) && /aria-controls=\{listId\}/.test(iec) &&
  /aria-activedescendant=\{activeIndex >= 0 \? optionId\(activeIndex\) : undefined\}/.test(iec) && /aria-label=\{nameLabel \?\? t\(locale, "Item name"\)\}/.test(iec) && /data-line-item-name=""/.test(iec));
check("item picker: listbox of options with aria-selected (items and Create New Item)",
  /role="listbox"/.test(iec) && (iec.match(/role="option"/g) ?? []).length === 2 && (iec.match(/aria-selected=\{activeIndex === /g) ?? []).length === 2);
check("item picker keyboard: ArrowDown / ArrowUp move, Enter picks (no submit), Escape closes, active option scrolled into view",
  /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/.test(iec) && /\(cur \+ 1\) % options\.length/.test(iec) && /cur <= 0 \? options\.length - 1 : cur - 1/.test(iec) &&
  /e\.key === "Enter"/.test(iec) && /if \(o\.kind === "item"\) pick\(o\.product\);\s*else createNew\(\);/.test(iec) && /e\.key === "Escape"\) \{\s*if \(open\) \{ e\.preventDefault\(\); setOpen\(false\); \}/.test(iec) &&
  /scrollIntoView\(\{ block: "nearest" \}\)/.test(iec) && /onKeyDown=\{onKeyDown\}/.test(iec));
check("item picker: mouse and create behaviour kept (onClick pick / createNew; pointer does not steal focus)",
  /onClick=\{\(\) => pick\(p\)\}/.test(iec) && /onClick=\{createNew\}/.test(iec) && (iec.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) ?? []).length === 2);
check("item picker portal: logical inline-start (RTL from innerWidth - rect.right), no physical left",
  /start: rtl \? window\.innerWidth - r\.right : r\.left/.test(iec) && /insetInlineStart: rect\.start/.test(iec) && !/left: rect\.left/.test(iec));

// ---------- 6. Configure Columns ----------
const ccPath = SH + "configure-columns-dialog.tsx";
const cc = code(read(ccPath));
const ccEls = elements(ccPath);
check("Configure Columns: approved controls only (no raw <input> / <select> / legacy .btn)",
  !ccEls.some((e) => e.tag === "input" || e.tag === "select" || e.tag === "button") && !/className="btn/.test(cc));
const named = (e: El) => "aria-label" in e.attrs || "id" in e.attrs;
const ccUnnamed = ccEls.filter((e) => ["Input", "SelectTrigger"].includes(e.tag) && !named(e))
  .concat(ccEls.filter((e) => e.tag === "Button" && !("aria-label" in e.attrs) && !/>\s*(\{t\(|<Plus)/.test(e.text)));
check("Configure Columns: every row control named (label, width, formula, visibility, remove, move)", ccUnnamed.length === 0, ccUnnamed.map(at).join(" "));
check("Configure Columns: the visibility toggle reports its state (aria-pressed)", /aria-pressed=\{c\.visible\}/.test(cc));
const ccLabels = ccEls.filter((e) => e.tag === "Label");
check("Configure Columns: Add Custom Column labels bound to their fields", ccLabels.length >= 5 && ccLabels.every((l) => /^\{f\("(label|type|width|visible|formula)"\)\}$/.test(l.attrs.htmlFor ?? "")));
check("Configure Columns: keyboard Move up / Move down (first / last disabled; Actions stays last)",
  /disabled=\{idx === 0\} onClick=\{\(\) => moveByKey\(c\.key, idx, "up"\)\}/.test(cc) && /disabled=\{idx === editable\.length - 1\} onClick=\{\(\) => moveByKey\(c\.key, idx, "down"\)\}/.test(cc) &&
  /return \[\.\.\.list, prev\.find\(\(c\) => c\.key === ACTIONS_KEY\)!\];/.test(cc) && /draggable/.test(cc));
check("Configure Columns: no Reset-to-defaults feature", !/reset to default|resetToDefault|Reset to defaults|DEFAULT_COLUMNS/i.test(cc));
check("Configure Columns: persistence unchanged (saveColumnConfigAction(documentType, cols); resolveColumns / validateColumns)",
  /await saveColumnConfigAction\(documentType, cols\);/.test(cc) && /const configError = validateColumns\(cols\);/.test(cc) && /const applied = resolveColumns\(cols\);/.test(cc));
check("Configure Columns: fixed validation text through the dictionary, raw text otherwise",
  /\{t\(locale, configError\)\}/.test(cc) && /toast\.error\(t\(locale, configError\)\)/.test(cc));
const colLabel = code(read(SH + "column-label.ts"));
check("built-in labels translated only while they equal the English default; stored labels never written",
  /return original !== undefined && column\.label === original \? t\(locale, original\) : column\.label;/.test(colLabel) && !/\.label\s*=[^=]/.test(colLabel) &&
  /const DEFAULT_LABELS = new Map\(DEFAULT_COLUMNS\.map\(\(c\) => \[c\.key, c\.label\]\)\);/.test(colLabel));
check("the dialog shows the translation without writing it back (a label is stored only when the user edits it)",
  /return touched\.has\(c\.key\) \? c\.label : columnDisplayLabel\(locale, c\);/.test(cc) && /value=\{labelValue\(c\)\} onChange=\{\(e\) => editLabel\(c, e\.target\.value\)\}/.test(cc) &&
  /update\(c\.key, \{ label: value \}\);/.test(cc));
check("item-table headers use the same display rule", /columnDisplayLabel\(locale, c\)/.test(lie) && !/\{c\.key === ACTIONS_KEY \? "" : c\.label\}/.test(lie));

// ---------- 7. terms / rich text ----------
const tb = code(read(SH + "terms-block.tsx"));
check("TermsBlock on the Tabs primitive (tablist / tab / tabpanel) — no hand-made tab bar",
  /<Tabs value=\{tab\} onValueChange=/.test(tb) && (tb.match(/<TabsTrigger value=/g) ?? []).length === 3 && (tb.match(/<TabsContent value=/g) ?? []).length === 3 && !/doc-tabbar/.test(tb));
const te = read(SH + "terms-editor.tsx");
const docTermsEd = fnBody(te, "export function DocumentTermsEditor(");
const masterEd = fnBody(te, "export function MasterTermsListEditor(");
check("document terms: keyboard Move up / Move down (doc controls) with focus kept on the moved term",
  /doc=\{\{\s*name: `\$\{t\(locale, "Term"\)\} \$\{i \+ 1\}`,\s*onMoveUp: i > 0 \? \(\) => move\(i, i - 1, "up"\) : undefined,\s*onMoveDown: i < terms\.length - 1 \? \(\) => move\(i, i \+ 1, "down"\) : undefined,/.test(docTermsEd) &&
  /\[data-term-move="\$\{p\.dir\}"\]/.test(docTermsEd) && /draggable=\{draggable\}/.test(te));
check("master terms editor (Preset Management) unchanged: no doc controls, original row + Add button markup",
  !/doc=\{/.test(masterEd) && /className="doc-pill-btn" style=\{\{ height: 30, fontSize: 11\.5 \}\} onClick=\{\(\) => onChange\(\[\.\.\.terms, ""\]\)\}/.test(masterEd) &&
  /: "text-\[11\.5px\] text-ink-faint w-6 text-right shrink-0 mt-1\.5"/.test(te) &&
  /: "flex-1 min-h-8 py-1\.5 rounded-\[8px\] border border-line px-2 text-\[12px\] leading-snug outline-none focus:border-brand-orange bg-surface resize-none overflow-hidden"/.test(te));
check("document terms rows: named field, logical numbering, focus recipe (doc branch)",
  /aria-label=\{doc\?\.name\}/.test(te) && /doc \? "text-caption text-ink-faint w-6 text-end shrink-0 mt-1\.5"/.test(te) && /\? "doc-term-input /.test(te) && /\.doc-term-input:focus-visible/.test(css));
const rte = code(read(SH + "rich-text-field.tsx"));
check("rich text: required label → the editable area's name; toolbar role; dir=auto; aria-multiline kept",
  /label: string;/.test(rte) && /aria-label=\{label\}/.test(rte) && /className="rte-toolbar" role="toolbar" aria-label=/.test(rte) && /dir="auto"/.test(rte) && /aria-multiline="true"/.test(rte) &&
  !/outline-none/.test(rte));
check("rich text: every caller passes a name", ["terms-block.tsx", "item-entry-cell.tsx"].every((f) => elements(SH + f).filter((e) => e.tag === "RichTextField").every((e) => "label" in e.attrs)));
check("rich text: no window.prompt; link Dialog keeps the selection (captured, then restored before createLink)",
  !/window\.prompt/.test(rte) && /savedRange\.current = range && ref\.current\?\.contains\(range\.commonAncestorContainer\) \? range\.cloneRange\(\) : null;/.test(rte) &&
  /onCloseAutoFocus=\{restoreAndApply\}/.test(rte) && /el\.focus\(\);[\s\S]*sel\?\.addRange\(range\);[\s\S]*document\.execCommand\("createLink", false, link\);\s*emit\(\);/.test(rte));
check("rich text: the allowed link protocols are unchanged (http, https, mailto) and invalid ones rejected",
  /const ALLOWED_LINK = \/\^\(https\?:\\\/\\\/\|mailto:\)\/i;/.test(read(SH + "rich-text-field.tsx")) && /if \(!ALLOWED_LINK\.test\(target\)\) \{\s*setUrlRejected\(true\);\s*return;/.test(rte));

// ---------- 8. numbers / RTL ----------
const detailRight = DETAILS.filter((f) => /text-right/.test(read(f)));
const numericCells = DETAILS.reduce((n, f) => n + (read(f).match(/<TableCell numeric/g) ?? []).length, 0);
check("detail line tables: numeric heads / cells on Table `numeric` (no physical text-right)", detailRight.length === 0 && numericCells >= 27, `${numericCells}; ${detailRight.map(short).join(" ")}`);
check("document editor numbers at the logical end (th.num, computed td.num, line inputs, discount) — no physical right / [dir] override",
  decl(rules("table.doc-items-table thead th.num"), "text-align")[0] === "end" && decl(rules("table.doc-items-table td.num"), "text-align")[0] === "end" && decl(rules(".item-cell-input"), "text-align")[0] === "end" &&
  decl(rules(".doc-totals-card .t-row.discount .v input"), "text-align")[0] === "end" && !/\[dir="rtl"\] table\.doc-items-table/.test(css));
check("party edit / rich-text close positioned logically (no [dir] overrides)",
  decl(rules(".party-card-v2 .pc-edit"), "inset-inline-end").length === 1 && !/\[dir="rtl"\] \.party-card-v2/.test(css) &&
  decl(rules(".rte-toolbar .rte-close"), "margin-inline-start")[0] === "auto" && !/\[dir="rtl"\] \.rte-toolbar/.test(css));
check("CN / DN totals: localized 'Total VAT' label, no hard-coded VAT (15%)",
  [FORMS[5], FORMS[7]].every((f) => !/\(15%\)/.test(formSrc[f]) && /<span>\{t\(locale, "Total VAT"\)\}<\/span>/.test(formSrc[f])));
check("totals discount field named", /aria-label=\{t\(locale, "Discount"\)\}/.test(read(SH + "totals-card.tsx")));

// ---------- 9. other controls ----------
const statusFiles = [["sales/quotations/quotation-detail-actions.tsx", "Change quotation status"], ["sales/orders/order-detail-actions.tsx", "Change sales order status"],
  ["sales/delivery-challans/dc-detail-actions.tsx", "Change delivery challan status"], ["sales/proforma/proforma-detail-actions.tsx", "Change proforma status"]];
check("detail status Selects named on their SelectTrigger (localized)", statusFiles.every(([f, k]) => new RegExp(`<SelectTrigger className="w-\\d+" aria-label=\\{t\\(locale, "${k}"\\)\\}>`).test(read(A + f))));
const party = code(read(SH + "party-card.tsx"));
check("party cards: Button empty state, pencils named with the party", !/btn btn-primary/.test(party) && /<Button type="button" onClick=\{\(\) => setCreateOpen\(true\)\}>/.test(party) &&
  /const openLabel = selected \? `\$\{t\(locale, "Edit"\)\} \$\{selected\.name\}` : t\(locale, "Edit"\);/.test(party) && /: \$\{name\}`;/.test(party) &&
  /title=\{openLabel\} aria-label=\{openLabel\}/.test(party) && /title=\{editLabel\} aria-label=\{editLabel\}/.test(party));
check("document headings left for DEV-UI-01.7 (editor titles stay h3)", FORMS.every((f) => /<h3>/.test(formSrc[f])));

const FOCUS_SELECTORS = [".item-name-input", ".item-cell-input", ".doc-totals-card .t-row.discount .v input", ".item-del-btn", ".doc-add-item-btn", ".doc-pill-btn",
  ".rte-editable", ".doc-term-input", ".doc-form-error"];
const noFocus = FOCUS_SELECTORS.filter((sel) => !/outline: 2px solid var\(--focus\)/.test(rules(`${sel}:focus-visible`)));
check("document controls show a visible focus ring (focus-visible outline on the focus token)", noFocus.length === 0, noFocus.join(" "));
const I18N_FILES = [...FORMS, ...readdirSync(join(ROOT, SH)).filter((f) => /\.tsx?$/.test(f)).map((f) => SH + f),
  ...["quotations/quotation-detail-actions.tsx", "orders/order-detail-actions.tsx", "delivery-challans/dc-detail-actions.tsx", "proforma/proforma-detail-actions.tsx"].map((f) => `${A}sales/${f}`)];
const untranslated = new Set<string>();
for (const f of I18N_FILES) for (const m of code(read(f)).matchAll(/\bt\(locale, "((?:[^"\\]|\\.)+)"\)/g)) if (translate("ar", m[1]) === m[1]) untranslated.add(m[1]);
check("every fixed document-editor string has an Arabic entry (no English leaking into AR)", untranslated.size === 0, [...untranslated].slice(0, 6).join(" | "));
const ACTION_FILES = ["sales/quotations", "sales/orders", "sales/proforma", "sales/invoices", "sales/delivery-challans", "sales/credit-notes", "purchasing/orders", "purchasing/debit-notes"].map((d) => `${A}${d}/actions.ts`);
const serverErrors = new Set(ACTION_FILES.flatMap((f) => [...read(f).matchAll(/\berror: "((?:[^"\\]|\\.)+)"/g)].map((m) => m[1])));
const untranslatedErrors = [...serverErrors].filter((e) => translate("ar", e) === e);
check("server action error strings (static) localized for the error region, action files untouched", serverErrors.size >= 20 && untranslatedErrors.length === 0, untranslatedErrors.slice(0, 6).join(" | "));

// ---------- 10. boundaries ----------
// Byte pins captured from main ccd7e39 (sha256, 16 hex). Directory pins hash sorted paths + contents.
const PINS = JSON.parse(read("verify/document-form-pins.json")) as Record<string, string>;
const fileDrift = Object.entries(PINS).filter(([p, hsh]) => !p.endsWith("/**") && sha(p) !== hsh).map(([p]) => p);
function dirHash(dir: string) {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  const hh = createHash("sha256");
  for (const f of files.sort()) { hh.update(f + "\0"); hh.update(readFileSync(join(ROOT, f))); }
  return hh.digest("hex").slice(0, 16);
}
const dirDrift = Object.entries(PINS).filter(([p, hsh]) => p.endsWith("/**") && dirHash(p.slice(0, -3)) !== hsh.split(" ")[0]).map(([p]) => p);
check("protected files byte-identical (lifecycle, posting, status registry, column config, sanitizer, editor maths, server actions, dirty-form, list logic, dropdown, preview body, shell.css, lockfile)",
  fileDrift.length === 0 && Object.keys(PINS).length >= 40, fileDrift.join(" "));
check("protected directories byte-identical (currency, PDF, print, layout, db, drizzle)", dirDrift.length === 0, dirDrift.join(" "));
const SUBMIT: Record<string, string> = {
  "sales/quotations/quotation-form.tsx": "9bdada8919ca1c68", "sales/orders/order-form.tsx": "5878b69222c20ecc", "sales/proforma/proforma-form.tsx": "298ddfd557fa4b5b",
  "sales/invoices/invoice-form.tsx": "9ac743493b5e4887", "sales/delivery-challans/dc-form.tsx": "b43736b93681d299", "sales/credit-notes/cn-form.tsx": "6e40556ff6eda6e1",
  "purchasing/orders/po-form.tsx": "e6e2d3f1586a6d38", "purchasing/debit-notes/dn-form.tsx": "adafe510c0c4f8ce",
};
const submitDrift = Object.entries(SUBMIT).filter(([f, hsh]) => h16(block(read(A + f), "function submit(").split("\n").filter((l) => !/setFormError\(/.test(l)).join("\n")) !== hsh).map(([f]) => f);
check("submit logic identical to the baseline in all 8 forms (payload keys, actions, markClean / restoreDirty, toast) — only the error-region lines added",
  submitDrift.length === 0, submitDrift.join(" "));
const DIRTY: Record<string, string> = {
  "sales/quotations/quotation-form.tsx": "01596803cf4eb563", "sales/orders/order-form.tsx": "69aad27e09648caf", "sales/proforma/proforma-form.tsx": "e2de446d3b83d5d9",
  "sales/invoices/invoice-form.tsx": "4a550f69747f8850", "sales/delivery-challans/dc-form.tsx": "1a5b2f2430e0229c", "sales/credit-notes/cn-form.tsx": "4725470e76fcf37a",
  "purchasing/orders/po-form.tsx": "26b3df5cffab929b", "purchasing/debit-notes/dn-form.tsx": "f48c81ab279a0fac",
};
const dirtyDrift = Object.entries(DIRTY).filter(([f, hsh]) => h16(read(A + f).split("\n").filter((l) => /useDirtyForm\(/.test(l) && !/import/.test(l)).join("\n") + "\n") !== hsh).map(([f]) => f);
check("dirty tracking snapshots identical to the baseline (every field still protected)", dirtyDrift.length === 0, dirtyDrift.join(" "));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DOCUMENT FORM VERIFICATION PASS" : "DOCUMENT FORM VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
