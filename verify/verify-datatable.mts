// Data tables + list workspace (DEV-UI-01.5). Run via `npm run verify:datatable` (part of verify:static).
//
// What it pins, so the list system cannot drift back:
//   1. foundation  — ui/table.tsx API (density, numeric, action, sticky, empty row; nothing more), the
//                    density tokens (two modes only), .data-table on the 12px card / type scale / logical
//                    alignment, the skeleton following the density token
//   2. numbers     — numeric cells at the logical END; no physical `text-right` in any table consumer
//   3. actions     — every action column named + sticky; RowMenu = the 36px ghost icon Button, named,
//                    placeholders truly disabled; master-data record actions named and translated
//   4. search      — every list search on ListSearch (Input foundation, labelled, logical icon); the
//                    shell's `.topbar-search` no longer used by lists
//   5. filters     — workspace: Select / Input / Label primitives, every field labelled, active count,
//                    still LIVE; FilterPanel: Buttons + caller labels, still Apply / Clear
//   6. views       — no window.prompt; save / rename via Dialog; no plain buttons inside the menu
//   7. states      — no-results row in every document list, empty vs no-results distinguished, count
//                    line is a polite status; master-data status <td> not flex; G4 via StatusBadge only
//   8. boundaries  — business logic + saved-view actions + URL search + frozen 01.6 files byte-identical

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const A = "src/app/(app)/";
const table = read("src/components/ui/table.tsx");
const globals = read("src/app/globals.css");
const css = read(A + "mockup-parity.css").replace(/\/\*[\s\S]*?\*\//g, "");
const skeleton = read("src/components/ui/skeleton.tsx");
const rowMenu = read(A + "sales/_shared/row-menu.tsx");
const ws = read(A + "documents/_workspace/list-workspace-toolbar.tsx");
const listSearch = read("src/components/ui/list-search.tsx");
const filterPanel = read("src/components/ui/filter-panel.tsx");
const listToolbar = read(A + "sales/_shared/list-toolbar.tsx");
/** Source without comments, so a check never matches its own explanation. */
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sha = (p: string) => createHash("sha256").update(read(p)).digest("hex").slice(0, 16);

/** The declarations of every rule whose selector list contains `sel` exactly. */
function rules(sel: string) {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(",").map((s) => s.trim()).includes(sel)) out.push(m[2]);
  return out.join(";");
}
const decl = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim());

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
type El = { file: string; tag: string; attrs: Record<string, string>; text: string; line: number };
const els: El[] = [];
const sources: Record<string, string> = {};
for (const file of walk("src")) {
  const text = read(file);
  sources[file] = text;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs: Record<string, string> = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText()] = a.initializer?.getText() ?? "true";
      const parent = ts.isJsxOpeningElement(n) ? n.parent : n;
      els.push({ file, tag: n.tagName.getText(), attrs, text: parent.getText(), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const at = (e: El) => `${e.file.replace(A, "")}:${e.line}`;
// Every file that renders the Table primitive, minus the 01.6 / detail-page tables (line items etc.).
const tableFiles = Object.keys(sources).filter((f) => /from "@\/components\/ui\/table"/.test(sources[f]) && !/\[id\]\/page\.tsx$|line-item-cell|journal-form/.test(f));

// ---------- 1. foundation ----------
check("Table API: density (comfortable default | compact), list, numeric, action, TableEmptyRow — nothing else",
  /density = "comfortable"/.test(table) && /type Density = "comfortable" \| "compact";/.test(table) && /list = false/.test(table) &&
  /data-cell=\{action \? "action" : numeric \? "numeric" : undefined\}/.test(table) && /function TableEmptyRow/.test(table) &&
  !/sort|paginat|aria-sort|selectAll|columns:\s*\w+\[\]/i.test(table.replace(/\/\/.*$/gm, "")));
check("Table keeps native semantics (<table>, <th scope=col>, <td>) inside the scroll/card wrapper",
  /<div className="data-table-wrap"/.test(table) && /<table className=\{cn\("data-table"/.test(table) && /<th scope="col"/.test(table) && /<td /.test(table) && !/role="grid"/.test(table));
check("action header renders its children visually hidden (an accessible name, no visible label)", /\{action \? <span className="sr-only">\{children\}<\/span> : children\}/.test(table));
const tok = (n: string) => globals.match(new RegExp(`--${n}:\\s*(\\d+)px;`))?.[1];
check("density tokens: comfortable header 40 / row 48, compact header 36 / row 40", tok("table-header-height") === "40" && tok("table-row-height") === "48" && tok("table-header-height-compact") === "36" && tok("table-row-height-compact") === "40");
check("only two density modes (no third table density token)", (globals.match(/--table-(row|header)-height[\w-]*:/g) ?? []).length === 4);
const wrap = rules(".data-table-wrap");
check(".data-table-wrap: the 12px card + contained horizontal scroll, no shadow", decl(wrap, "overflow-x").includes("auto") && decl(wrap, "border-radius").includes("12px") && decl(wrap, "box-shadow").length === 0);
const tbl = rules("table.data-table");
check("table.data-table: separate border model (sticky-friendly), no radius > 12, no card shadow", decl(tbl, "border-collapse").includes("separate") && decl(tbl, "box-shadow").length === 0 &&
  decl(tbl, "border-radius").every((r) => parseInt(r) <= 12));
const th = rules("table.data-table thead th");
const td = rules("table.data-table td");
check("header: caption scale, 600, logical start, density height token", decl(th, "font-size").includes("var(--text-caption)") && decl(th, "font-weight").includes("600") &&
  decl(th, "text-align").includes("start") && decl(th, "height").includes("var(--table-header-height)"));
check("cells: body 13px, density height token, logical padding", decl(td, "font-size").includes("var(--text-body)") && decl(td, "height").includes("var(--table-row-height)") && decl(td, "padding-inline").length > 0);
check("compact mode uses the compact tokens", decl(rules('table.data-table[data-density="compact"] td'), "height").includes("var(--table-row-height-compact)") &&
  decl(rules('table.data-table[data-density="compact"] thead th'), "height").includes("var(--table-header-height-compact)"));
const dtCss = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /data-table|list-toolbar|toolbar-actions-right/.test(m[1]));
const physical = dtCss.filter((m) => /(?:^|;)\s*(?:padding|margin|border)-(?:left|right)\s*:|text-align:\s*(?:left|right)|(?:^|;)\s*(?:left|right)\s*:/.test(m[2]) || /\[dir=/.test(m[1])).map((m) => m[1].trim());
check("table / list-toolbar CSS is logical (no physical left/right, no [dir] overrides)", physical.length === 0, physical.join(" | "));
check("list tables: one line per row (headers + cells nowrap unless the cell opts out with wrap)", /white-space:\s*nowrap/.test(rules("table.data-table[data-list] thead th")));
check("skeleton rows follow the comfortable density token (no hard-coded 52px)", /height: "var\(--table-row-height\)"/.test(skeleton) && !/height: 52\b/.test(skeleton) && /rounded-xl/.test(skeleton));

// ---------- 2. numbers ----------
check("numeric cells: tabular figures at the logical END", decl(rules('table.data-table td[data-cell="numeric"]'), "text-align").includes("end") && decl(rules('table.data-table th[data-cell="numeric"]'), "text-align").includes("end") &&
  decl(rules("table.data-table td.num"), "text-align").includes("end"));
const rightInTables = tableFiles.flatMap((f) => (sources[f].match(/\btext-right\b|\bml-auto\b|\bmr-\d|\bpl-\d|\bpr-\d|\bleft-\d|\bright-\d/g) ?? []).map((m) => `${f.replace(A, "")}:${m}`));
check("no physical text-right / ml / mr / pl / pr / left / right in any table consumer", rightInTables.length === 0, rightInTables.join(" "));

// ---------- 3. actions ----------
const actionHeads = els.filter((e) => e.tag === "TableHead" && e.attrs.action);
const unnamedAction = actionHeads.filter((e) => !/>\{t\(locale, "Actions"\)\}</.test(e.text));
check("every action column header is named (sr-only text via t())", actionHeads.length >= 25 && unnamedAction.length === 0, `${actionHeads.length} heads; ${unnamedAction.map(at).join(" ")}`);
const unpaired = tableFiles.filter((f) => (sources[f].match(/<TableHead action/g) ?? []).length > (sources[f].match(/<TableCell action/g) ?? []).length);
check("every action header has its action (sticky) cell", unpaired.length === 0, unpaired.join(" "));
const emptyHeads = els.filter((e) => e.tag === "TableHead" && tableFiles.includes(e.file) && /<TableHead[^>]*\/>$/.test(e.text));
check("no empty <TableHead /> left in the list / table consumers", emptyHeads.length === 0, emptyHeads.map(at).join(" "));
check("action cells are sticky at inset-inline-end with a solid background", decl(rules('table.data-table th[data-cell="action"]'), "position").includes("sticky") &&
  decl(rules('table.data-table th[data-cell="action"]'), "inset-inline-end").includes("0") && decl(rules('table.data-table td[data-cell="action"]'), "background").includes("var(--surface)"));
check("RowMenu trigger = ghost icon Button (36px) via DropdownMenuTrigger asChild, named by a required label",
  /<DropdownMenuTrigger asChild>\s*<Button variant="ghost" size="icon"[^>]*aria-label=\{label\}/.test(rowMenu) && /export function RowMenu\(\{ entries, label \}: \{ entries: RowMenuEntry\[\]; label: string \}\)/.test(rowMenu));
check("RowMenu placeholder actions are truly disabled (Radix disabled), not greyed enabled items", /disabled=\{unavailable\}/.test(rowMenu) && !/pointer-events-none/.test(rowMenu));
const rowMenus = els.filter((e) => e.tag === "RowMenu" && e.file.startsWith("src/"));
const badRowMenus = rowMenus.filter((e) => !/^\{`\$\{t\(locale, "Actions for"\)\} \$\{r\.\w+\}`\}$/.test(e.attrs.label ?? ""));
check("every RowMenu gets a localized row-specific label (Actions for <record>)", rowMenus.length === 9 && badRowMenus.length === 0, `${rowMenus.length}; ${badRowMenus.map(at).join(" ")}`);
check("the legacy 30px kebab recipe no longer applies to the Button trigger", /\.row-menu-btn:not\(\[data-slot="button"\]\) \{ width: 30px;/.test(read(A + "mockup-parity.css")));
check("disabled menu items read as unavailable", decl(rules(".row-menu-item[data-disabled]"), "opacity").length === 1);
check("RowMenu content is capped to the Radix available height and scrolls (Convert expanded on short viewports)",
  /<DropdownMenuContent align="end" className="max-h-\(--radix-dropdown-menu-content-available-height\) overflow-y-auto">/.test(rowMenu));
for (const p of ["clients/page.tsx", "purchasing/vendors/page.tsx", "inventory/products/page.tsx"]) {
  const s = code(read(A + p));
  check(`${p}: page header copy, Recycle Bin and create action go through t()`, /title=\{t\(locale, "/.test(s) && /description=\{t\(locale, "/.test(s) &&
    !/title="|description="/.test(s) && !/\/> (Recycle Bin|New (Client|Vendor|Product))\s*$/m.test(s));
}
for (const [f, ent] of [["clients/client-record-actions.tsx", "Client"], ["inventory/products/product-record-actions.tsx", "Product"], ["purchasing/vendors/vendor-record-actions.tsx", "Vendor"]] as const) {
  const s = read(A + f);
  check(`${ent} record actions: translated, row-labelled trigger (no hard-coded English aria-label)`, new RegExp(`aria-label=\\{label \\?\\? t\\(locale, "${ent} actions"\\)\\}`).test(s) && !/aria-label="/.test(s) && !/> (Archive|Unarchive|Delete)\s*$/m.test(s));
}

// ---------- 4. search ----------
check("ListSearch: Input foundation, logical start icon + padding, accessible name, clear only when non-empty",
  /<Input\b/.test(listSearch) && /absolute start-3/.test(listSearch) && /"ps-9"/.test(listSearch) && /aria-label=\{label\}/.test(listSearch) && /\{clearLabel && value \?/.test(listSearch) && !/topbar-search/.test(code(listSearch)));
const listSearchUsers = ["documents/_workspace/list-workspace-toolbar.tsx", "sales/_shared/list-toolbar.tsx", "clients/clients-toolbar.tsx", "inventory/products/products-toolbar.tsx", "purchasing/vendors/vendors-toolbar.tsx", "recycle-bin/recycle-bin-client.tsx"];
const missingSearch = listSearchUsers.filter((f) => !/<ListSearch\b/.test(read(A + f)) || /topbar-search|left-3|pl-9/.test(read(A + f)));
check("every list search uses ListSearch (not .topbar-search, no physical icon / padding)", missingSearch.length === 0, missingSearch.join(" "));
check(".topbar-search itself is untouched (shell search box)", /\.topbar-search \{ display: flex; align-items: center; gap: 8px; height: 38px; width: 260px;/.test(css));

// ---------- 5. filters ----------
check("workspace filters: no native <select> / raw <input> / <input type=date> left", !/<select\b|<input\b/.test(ws));
const wsLabels = [...ws.matchAll(/<Label htmlFor=\{fid\("([\w-]+)"\)\}/g)].map((m) => m[1]);
const wsIds = [...ws.matchAll(/id=\{fid\("([\w-]+)"\)\}/g)].map((m) => m[1]);
check("workspace filters: every field has a Label bound by id (status, from, to, party, archived)", ["status", "from", "to", "party", "archived"].every((k) => wsLabels.includes(k) && wsIds.includes(k)), wsLabels.join(","));
check("workspace filters: active count = status + date range (one) + party + archived≠all, search excluded",
  /\(f\.status \? 1 : 0\) \+ \(f\.dateFrom \|\| f\.dateTo \? 1 : 0\) \+ \(f\.party \? 1 : 0\) \+ \(f\.archived !== "all" \? 1 : 0\)/.test(ws) && /data-filter-count=\{count\}/.test(ws));
check("workspace filters still apply LIVE (set on every change) and Clear resets to EMPTY_FILTERS", /const set = \(patch: Partial<ListFilterState>\) => setFilters\(\{ \.\.\.filters, \.\.\.patch \}\);/.test(ws) &&
  /onClick=\{\(\) => setFilters\(EMPTY_FILTERS\)\}/.test(ws) && !/Apply/.test(ws));
check("FilterPanel: approved Buttons, caller-provided labels, active count, still Apply / Clear", /applyLabel = "Apply Filters"/.test(filterPanel) && /clearLabel = "Clear"/.test(filterPanel) &&
  /\{clearLabel\}/.test(filterPanel) && /\{applyLabel\}/.test(filterPanel) && /activeCount/.test(filterPanel) && !/<button\b/.test(filterPanel) && /onApply\?\.\(\)/.test(filterPanel));
const fpUsers = els.filter((e) => e.tag === "FilterPanel" && e.file.startsWith(A));
check("FilterPanel callers pass translated labels", fpUsers.length === 3 && fpUsers.every((e) => /^\{t\(locale, /.test(e.attrs.applyLabel ?? "") && /^\{t\(locale, /.test(e.attrs.triggerLabel ?? "")));
const badges = els.filter((e) => e.tag === "Badge" && e.attrs.onClick);
check("no interactive Badge masquerading as a button (Low stock chip is a Button)", badges.length === 0 && /data-filter-chip="low-stock"/.test(read(A + "inventory/products/products-toolbar.tsx")), badges.map(at).join(" "));
check("Projects toolbar: no fake disabled Filters / Views / Export / Import", !/disabled/.test(code(listToolbar)) && !/Filters|Views|Export|Import/.test(code(listToolbar)));

// ---------- 6. saved views ----------
check("saved views: no window.prompt anywhere in the workspace", !/window\.prompt/.test(code(ws)));
check("saved views: save + rename through a Dialog form, delete through the existing confirmation", /<Dialog open=\{naming !== null\}/.test(ws) && /saveViewAction\(module, name, filters\)/.test(ws) &&
  /renameViewAction\(target\.id, name\)/.test(ws) && /action: "view\.delete"/.test(ws) && /deleteViewAction\(v\.id\)/.test(ws));
const viewsMenu = ws.slice(ws.indexOf("data-list-views"), ws.indexOf('<div className="toolbar-actions-right">'));
check("saved views menu: only menu items (no plain buttons inside), apply + manage keyboard-reachable", !/<button\b|<Button\b/.test(viewsMenu.slice(viewsMenu.indexOf("<DropdownMenuContent"))) &&
  /onSelect=\{\(\) => setFilters\(v\.config\)\}/.test(viewsMenu) && /onSelect=\{\(\) => \{ viewsDialogHandoff\.current = true; setManaging\(true\); \}\}/.test(viewsMenu));
// The naming contract is the server's (saved-view-actions.ts, byte-pinned below): Save → ≤ 60 characters,
// Rename → no length limit. The shared naming Input must not add a 60-character limit to Rename.
const nameInputs = [...code(ws).matchAll(/<Input id=\{fid\("view-name"\)\}[^>]*>/g)].map((m) => m[0]);
const svActions = code(read(A + "documents/_workspace/saved-view-actions.ts"));
const renameBody = svActions.slice(svActions.indexOf("export async function renameViewAction"), svActions.indexOf("export async function deleteViewAction"));
check("saved views: Save keeps the 60-character UI maximum, Rename has none (same contract as the server actions)",
  nameInputs.length === 1 && /maxLength=\{naming === "new" \? 60 : undefined\}/.test(nameInputs[0]) && !/maxLength=\{60\}/.test(code(ws)) &&
  /trimmed\.length > 60/.test(svActions.slice(0, svActions.indexOf("export async function renameViewAction"))) && !/(trimmed|name)\.length|\b60\b/.test(renameBody),
  nameInputs.join(" | "));
// C2 — Views menu → Dialog focus handoff: close-autofocus is suppressed ONLY when an item hands off to a
// Dialog (Save current view, Manage saved views); the flag is consumed on close and reset on open, so
// Escape / outside / applying a view keep Radix's normal focus return to the trigger.
const wsc = code(ws).replace(/\s+/g, " ");
const handoffSets = [...wsc.matchAll(/onSelect=\{\(\) => \{ viewsDialogHandoff\.current = true; (openNaming\("new"\)|setManaging\(true\)); \}\}/g)].map((m) => m[1]);
check("views menu: conditional close-autofocus — prevented only during a menu → Dialog handoff, flag consumed",
  /onCloseAutoFocus=\{\(event\) => \{ if \(viewsDialogHandoff\.current\) \{ event\.preventDefault\(\); viewsDialogHandoff\.current = false; \} \}\}/.test(wsc) &&
  (wsc.match(/onCloseAutoFocus=/g) ?? []).length === 1 && !/onCloseAutoFocus=\{\(\w*\) => \w+\.preventDefault\(\)\}/.test(wsc));
check("views menu: only Save current view and Manage saved views set the handoff; applying a view does not; the flag resets on open",
  handoffSets.length === 2 && handoffSets.includes('openNaming("new")') && handoffSets.includes("setManaging(true)") &&
  (wsc.match(/viewsDialogHandoff\.current = true/g) ?? []).length === 2 && /onSelect=\{\(\) => setFilters\(v\.config\)\}/.test(wsc) &&
  /<DropdownMenu onOpenChange=\{\(open\) => \{ if \(open\) viewsDialogHandoff\.current = false; \}\}>/.test(wsc), handoffSets.join(", "));
check("saved views: the matching view is marked current; no default-view concept", /aria-current=\{current \|\| undefined\}/.test(ws) && !/default view|isDefault/i.test(ws));

// ---------- 7. states ----------
const DOC_LISTS = ["sales/quotations/quotations-list-client.tsx", "sales/invoices/invoices-list-client.tsx", "sales/orders/orders-list-client.tsx", "sales/delivery-challans/dc-list-client.tsx",
  "sales/credit-notes/cn-list-client.tsx", "sales/proforma/proforma-list-client.tsx", "purchasing/orders/po-list-client.tsx", "purchasing/debit-notes/dn-list-client.tsx"];
for (const f of DOC_LISTS) {
  const s = read(A + f);
  const heads = (s.match(/<TableHead[\s>]/g) ?? []).length;
  check(`${f.split("/").pop()}: empty (no records) vs no-results (filtered) distinguished; polite count`,
    /rows\.length === 0 \?/.test(s) && /<ListEmptyState/.test(s) && new RegExp(`\\{filtered\\.length === 0 && \\(\\s*<TableEmptyRow colSpan=\\{${heads}\\}>`).test(s) && /role="status" aria-live="polite"/.test(s) && /<Table list>/.test(s));
}
const flexTd = els.filter((e) => e.tag === "TableCell" && /\bflex\b/.test(e.attrs.className ?? ""));
check("no <td> turned into a flex box (status cells use an inner wrapper)", flexTd.length === 0, flexTd.map(at).join(" "));
const noWrapper = ["clients/page.tsx", "inventory/products/page.tsx", "purchasing/vendors/page.tsx"].filter((f) => !/<TableCell>\s*\{\/\*[^*]*\*\/\}\s*<span className="inline-flex items-center gap-1\.5">\s*(\{low \?[\s\S]{0,260})?<StatusBadge/.test(read(A + f)));
check("master-data status cells: badges in an inner inline-flex wrapper", noWrapper.length === 0, noWrapper.join(" "));
const localStatusMaps = tableFiles.filter((f) => /const \w*(STATUS|Status)\w*\s*(:\s*Record<[^>]+>)?\s*=\s*\{[^}]*:\s*"(success|danger|warning|neutral|info)"/.test(sources[f]));
check("status cells use StatusBadge / the registry only (no local status → variant maps)", localStatusMaps.length === 0, localStatusMaps.join(" "));
check("Payroll rows: keyboard selectable, aria-selected, visible focus; selected = tint", /tabIndex=\{0\}/.test(read(A + "hr/payroll/payroll-client.tsx")) && /aria-selected=\{/.test(read(A + "hr/payroll/payroll-client.tsx")) &&
  /e\.key === "Enter" \|\| e\.key === " "/.test(read(A + "hr/payroll/payroll-client.tsx")) && decl(rules('table.data-table tbody tr[aria-selected="true"] > td'), "background").length === 1);
check("Reports: a negative number is not automatically danger red (semantic red kept on deltas / badges)", !/v < 0 \? "text-danger"/.test(read(A + "finance/reports/reports-workspace.tsx")) &&
  /it\.delta >= 0 \? "text-success" : "text-danger"/.test(read(A + "finance/reports/reports-workspace.tsx")));
check("/clients: the frozen PageHeader wraps (className) instead of overflowing at 390px", /<PageHeader\s+className="flex-wrap"/.test(read(A + "clients/page.tsx")));

// ---------- 8. boundaries ----------
const PINNED: Record<string, string> = {
  [A + "documents/_workspace/use-list-filters.ts"]: "e9bc8477a32c2877",
  [A + "documents/_workspace/filter-types.ts"]: "2c4d735888a21013",
  [A + "documents/_workspace/saved-view-actions.ts"]: "4e2a260f754684b0",
  "src/lib/document-list-workspace.ts": "d6c6927c0def33fe",
  // C2: the menu → Dialog focus handoff is local to the Views menu; the shared primitive (01.4 focus
  // behaviour for every other menu) stays byte-identical.
  "src/components/ui/dropdown-menu.tsx": "f9f94b05c82b1ba2",
  [A + "sales/_shared/column-config-actions.ts"]: "6290d21894f90070",
  "src/lib/column-config.ts": "8904cbc74ccd23a5",
  // DEV-UI-01.6 retired the editor-file pins this batch held for it (configure-columns-dialog, line-items-
  // editor, item-entry-cell, rich-text-field, terms-editor, terms-block, party-card, totals-card,
  // doc-field-box, doc-action-bar): 01.6 owns those files and verify-document-form now checks them. The
  // two editor files 01.6 did not touch stay pinned.
  [A + "sales/_shared/line-item-cell.tsx"]: "4b0f7da4f95cb73f",
  [A + "sales/_shared/doc-pills-row.tsx"]: "77929c9bf72b7dfc",
};
const drifted = Object.entries(PINNED).filter(([f, h]) => sha(f) !== h).map(([f]) => f.replace(A, ""));
check("business logic (filters, saved-view actions, export registry, column config) and untouched editor files are byte-identical", drifted.length === 0, drifted.join(" "));
// The .doc-items-table rules are DEV-UI-01.6's (logical numeric alignment); the .line-table rules stay pinned.
const docCss = [...read(A + "mockup-parity.css").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /line-table/.test(m[1]) && !/doc-items-table/.test(m[1])).map((m) => m[0].trim()).join("\n");
check("document line-table CSS (.line-table) unchanged", createHash("sha256").update(docCss).digest("hex").slice(0, 16) === "5c1a34146f7f6ee1");
// The exact URL contract: q = the text, flags = "1".
const PARAM = { q: 'params.set("q", nextQ)', archived: 'params.set("archived", "1")', lowStock: 'params.set("lowStock", "1")' } as const;
const navigates = [["clients/clients-toolbar.tsx", "/clients", ["q", "archived"]], ["purchasing/vendors/vendors-toolbar.tsx", "/purchasing/vendors", ["q", "archived"]], ["inventory/products/products-toolbar.tsx", "/inventory/products", ["q", "lowStock", "archived"]]] as const;
for (const [f, route, keys] of navigates) {
  const s = read(A + f);
  check(`${f.split("/")[0]} search: still Enter → URL (?${keys.join(", ")}) → server, unchanged`, keys.every((k) => s.includes(PARAM[k])) && (s.match(/params\.set\(/g) ?? []).length === keys.length && s.includes(`router.push(\`${route}\${params.toString() ? \`?\${params}\` : ""}\`)`) &&
    /onKeyDown=\{\(e\) => e\.key === "Enter" && navigate\(/.test(s));
}
check("no sorting / pagination / bulk selection introduced in list code", !tableFiles.concat([A + "documents/_workspace/list-workspace-toolbar.tsx"]).some((f) => /aria-sort|pageSize|selectAll|setSort\b|bulk/i.test(read(f.startsWith("src/") ? f : f))));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DATATABLE VERIFICATION PASS" : "DATATABLE VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
