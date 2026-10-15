/**
 * DEV-UI-01.7 C0 — page-archetype foundations and guardrails. Run via `npm run verify:page-archetypes`
 * (part of verify:static).
 *
 * C0 adds three small primitives (SectionHeader, EmptyState, formatDisplayDate) and two additive
 * props (CardTitle `as`, StatRow `columns` / ReactNode values), migrates nothing, and records the
 * baseline that every later 01.7 stage is held to. What it pins comes from main 1bfdbbf and lives
 * in verify/page-archetype-pins.json:
 *
 *   1. routes        — every page and route handler, the layouts, and the 36 DEV-UI-01.7 pages
 *   2. guards        — each 01.7 page's requireSession / requireRole / redirect / notFound calls and
 *                      the role expressions it hands on (isOwner, canDecide, …); the layouts' guards
 *   3. data          — each 01.7 page's server data section: its statements other than the markup
 *                      (the JSX it returns or builds) and other than display-date formatting, which
 *                      later stages move onto formatDisplayDate — so composition work can change the
 *                      markup freely, and a query, a guard or a computation cannot drift with it
 *   4. business      — business, query, permission, export, DB, currency / PDF / print files and the
 *                      01.7 areas' server actions, byte-identical
 *   5. prerequisites — the P0 / P0.1 / P0.2 contracts, pinned as sections (not whole files, since
 *                      their files change later in 01.7), and their verifiers still wired
 *   6. primitives    — the locked APIs and markup of the five C0 changes, rendered; formatDisplayDate
 *                      in 18 host time-zone / locale combinations; the consumer inventory (no
 *                      consumer migrated in C0)
 *   7. creep         — none of the rejected page-level abstractions exist; the shared primitives
 *                      know nothing of routes or domains and use no physical left / right
 *   8. actions       — the static half of the action inventory: each 01.7 page's link targets and
 *                      server actions, through its page-local imports
 *
 * Legacy defects that later stages fix — h3 page titles, overflow, old empty states, inline grids,
 * the kanban, Settings direction — are deliberately NOT failures here. The runtime half
 * (verify/verify-page-archetypes-runtime.mjs) records them as a baseline that may only improve.
 *
 * C1 (master data + entity detail) adds group 9 and turns the C0 "no consumer yet" checks into what
 * C1 migrated: PageHeader evolved in place (one <h1>, meta before actions, a row that wraps; D-9
 * narrows the layout pin to byte pins of every other layout file), and the 12 master-data / entity-
 * detail pages on it — responsive detail grids, h2 section headings (CardTitle as="h2",
 * SectionHeader), their copy through t(), EmptyState in the three master-data recycle bins. Its
 * pins re-baseline: two data statements (New Vendor / New Product read the UI locale) and the
 * consumer inventory; nothing else.
 *
 * `--write-pins` recomputes verify/page-archetype-pins.json from the working tree. Only a stage that
 * deliberately re-baselines may run it, and the diff of that file is what its review reads.
 * docs/ui/dev-ui-01-7/c0-foundations-and-guardrails.md, docs/ui/dev-ui-01-7/c1-master-data-and-detail.md
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = path.resolve(import.meta.dirname, "..");
const PINS_FILE = "verify/page-archetype-pins.json";
const WRITE = process.argv.includes("--write-pins");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const h16 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const A = "src/app/(app)/";
// DEV-UI-01.7 C1: the 12 master-data and entity-detail pages, and the shared header they sit on.
const C1_PAGES = [
  "clients", "clients/[id]", "clients/new", "clients/recycle-bin", "purchasing/vendors", "purchasing/vendors/[id]", "purchasing/vendors/new", "purchasing/vendors/recycle-bin",
  "inventory/products", "inventory/products/[id]", "inventory/products/new", "inventory/products/recycle-bin",
].map((p) => `${A}${p}/page.tsx`);
const C1_DETAIL = C1_PAGES.filter((f) => f.includes("/[id]/"));
const C1_BINS = C1_PAGES.filter((f) => f.includes("/recycle-bin/"));
const PHF = "src/components/layout/page-header.tsx";
// DEV-UI-01.7 C2: the seven HR routes, by the files that render them (a route's client component holds
// its markup where it has one).
const HR = `${A}hr/`;
const C2_ROUTES: Record<string, string[]> = {
  employees: [`${HR}employees/page.tsx`, `${HR}employees/employees-client.tsx`],
  "employees/new": [`${HR}employees/new/page.tsx`],
  "employees/[id]": [`${HR}employees/[id]/page.tsx`],
  departments: [`${HR}departments/page.tsx`],
  attendance: [`${HR}attendance/page.tsx`],
  leave: [`${HR}leave/page.tsx`, `${HR}leave/leave-client.tsx`],
  payroll: [`${HR}payroll/page.tsx`, `${HR}payroll/payroll-client.tsx`],
};
const C2_FILES = Object.values(C2_ROUTES).flat();
/** The file holding each HR route's PageHeader. */
const C2_HEADERS = [
  `${HR}employees/employees-client.tsx`, `${HR}employees/new/page.tsx`, `${HR}employees/[id]/page.tsx`, `${HR}departments/page.tsx`,
  `${HR}attendance/page.tsx`, `${HR}leave/leave-client.tsx`, `${HR}payroll/page.tsx`,
];
const C2_EMPTY = [`${HR}employees/employees-client.tsx`, `${HR}departments/page.tsx`, `${HR}attendance/page.tsx`, `${HR}leave/leave-client.tsx`, `${HR}payroll/page.tsx`];
const C2_STATROWS = [`${HR}employees/employees-client.tsx`, `${HR}payroll/page.tsx`];

let pass = 0;
let fail = 0;
let group = "";
const counts: Record<string, [number, number]> = {};
function section(name: string) {
  group = name;
  counts[group] = [0, 0];
  console.log(`\n${name}`);
}
function check(name: string, ok: boolean, detail?: string) {
  counts[group][ok ? 0 : 1]++;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

// ---------- source helpers ----------

const parsed = new Map<string, ts.SourceFile>();
function parse(f: string): ts.SourceFile {
  let sf = parsed.get(f);
  if (!sf) {
    sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, /x$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    parsed.set(f, sf);
  }
  return sf;
}
/** Files under `dir`, repository-relative, sorted. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir)).sort()) {
    const p = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, p)).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** A node's code with comments, layout and trailing commas normalised away: what it does, not how it is typed out. */
const canon = (n: ts.Node) =>
  printer.printNode(ts.EmitHint.Unspecified, n, n.getSourceFile()).replace(/\s+/g, " ").replace(/,\s*\}/g, " }").replace(/,\s*([\])])/g, "$1").trim();
/** Source without comments, so a check never matches its own explanation. */
const codeOnly = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const hasJsx = (n: ts.Node): boolean => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || !!ts.forEachChild(n, (c) => (hasJsx(c) ? true : undefined));
const directives = (sf: ts.SourceFile) => {
  const out: string[] = [];
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) out.push(s.expression.text);
    else break;
  }
  return out;
};
const hasModifier = (n: ts.Node, k: ts.SyntaxKind) => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === k));
function defaultFunction(sf: ts.SourceFile): ts.FunctionLikeDeclaration | null {
  for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.DefaultKeyword)) return s;
  const assigned = sf.statements.find(ts.isExportAssignment);
  if (assigned && ts.isIdentifier(assigned.expression)) {
    const name = assigned.expression.text;
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer;
    }
  }
  return null;
}
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
/** A page-local import: relative, or `@/app/…`. Anything else (components, lib, packages) is not followed. */
function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/app/")) base = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  for (const ext of EXTENSIONS) if (existsSync(path.join(ROOT, base + ext)) && statSync(path.join(ROOT, base + ext)).isFile()) return base + ext;
  return null;
}
const moduleSpecs = (sf: ts.SourceFile) =>
  sf.statements.flatMap((s) =>
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? [{ node: s, spec: s.moduleSpecifier.text }] : [],
  );

// ---------- the snapshot: what the pins hold, computed from the tree ----------

const appFiles = walk("src/app").map((f) => f.slice("src/app/".length));
const routes = {
  pages: appFiles.filter((f) => /(^|\/)page\.(tsx?|jsx?)$/.test(f)),
  handlers: appFiles.filter((f) => /(^|\/)route\.(tsx?|jsx?)$/.test(f)),
  layouts: appFiles.filter((f) => /(^|\/)layout\.(tsx?|jsx?)$/.test(f)),
};

const GUARD_CALLS = new Set(["requireSession", "requireRole", "getSession", "redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized"]);
/** Guard calls with their arguments, and every expression that reads `<x>.role`, in the context it is used. */
const MISSING = "(page missing)";
const exists = (f: string) => existsSync(path.join(ROOT, f));
function guards(file: string): string[] {
  if (!exists(`src/app/${file}`)) return [MISSING];
  const sf = parse(`src/app/${file}`);
  const out: string[] = [];
  const seen = new Set<ts.Node>(); // `a.role === x || a.role === y` is one expression, recorded once
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GUARD_CALLS.has(n.expression.text)) out.push(canon(n));
    if (ts.isPropertyAccessExpression(n) && n.name.text === "role" && !ts.isPropertyAccessExpression(n.parent)) {
      let e: ts.Node = n;
      while (ts.isBinaryExpression(e.parent) || ts.isParenthesizedExpression(e.parent) || ts.isPrefixUnaryExpression(e.parent) || ts.isConditionalExpression(e.parent)) e = e.parent;
      if (!seen.has(e)) {
        seen.add(e);
        const p = e.parent;
        if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) out.push(`${p.parent.name.getText()}={${canon(e)}}`);
        else if (ts.isVariableDeclaration(p)) out.push(`${p.name.getText()} = ${canon(e)}`);
        else if (ts.isPropertyAssignment(p)) out.push(`${p.name.getText()}: ${canon(e)}`);
        else if (ts.isCallExpression(p)) out.push(canon(p));
        else out.push(canon(e));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.sort();
}

const DISPLAY_DATE_CALLS = new Set(["toLocaleDateString", "toLocaleTimeString", "formatDisplayDate"]);
/** `const label = <date>.toLocaleDateString(…)` and the like: display formatting, which C2/C6 move onto formatDisplayDate. */
function isDisplayDate(st: ts.Statement): boolean {
  if (!ts.isVariableStatement(st)) return false;
  return st.declarationList.declarations.every((d) => {
    const init = d.initializer;
    if (!init || !ts.isCallExpression(init)) return false;
    const c = init.expression;
    const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : "";
    return DISPLAY_DATE_CALLS.has(name);
  });
}
const entry = (s: string) => `${h16(s).slice(0, 12)} ${s.length > 72 ? s.slice(0, 72) + "…" : s}`;
/**
 * A page's server data section: the module's non-markup top-level declarations (helpers, constants,
 * segment config — not imports, types or anything containing JSX), the page function's parameters,
 * and every statement of its body except the markup (statements containing JSX, which includes the
 * returned page) and display-date formatting. One entry per statement: hash + the start of its code.
 */
function dataSection(file: string): string[] {
  if (!exists(`src/app/${file}`)) return [MISSING];
  const sf = parse(`src/app/${file}`);
  const def = defaultFunction(sf);
  const out: string[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || s === def || hasJsx(s)) continue;
    if (ts.isExportAssignment(s)) continue;
    if (ts.isVariableStatement(s) && def && s.declarationList.declarations.some((d) => d.initializer === def)) continue;
    out.push(entry(canon(s)));
  }
  if (!def?.body || !ts.isBlock(def.body)) return [...out, "(no default page function)"];
  out.push(entry(`(params) (${def.parameters.map(canon).join(", ")})`));
  for (const st of def.body.statements) if (!hasJsx(st) && !isDisplayDate(st)) out.push(entry(canon(st)));
  return out;
}

/** A route literal: a string or template that starts with "/" and a letter. Template holes become ${}. */
function routeLiteral(n: ts.Node): string | null {
  let text: string | null = null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
  else if (ts.isTemplateExpression(n)) text = n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  if (text === null || !/^\/[A-Za-z]/.test(text)) return null;
  if (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) return null;
  return text;
}
/**
 * The static action inventory of a page: route literals (link targets, redirects, pushed URLs) and
 * the server actions it can call, over the page and its page-local imports. A "use server" module
 * is not entered — calling it is the action; what it does is a business pin.
 */
function actions(file: string): string[] {
  const start = `src/app/${file}`;
  if (!exists(start)) return [MISSING];
  const seen = new Set<string>();
  const queue = [start];
  const out: string[] = [];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const sf = parse(f);
    for (const { node, spec } of moduleSpecs(sf)) {
      const r = resolveLocal(f, spec);
      if (!r) continue;
      if (directives(parse(r)).includes("use server")) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
        if (clause && !clause.isTypeOnly && clause.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) out.push(`action:${(el.propertyName ?? el.name).text}`);
        continue;
      }
      queue.push(r);
    }
    const visit = (n: ts.Node) => {
      const r = routeLiteral(n);
      if (r) out.push(r);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort();
}

// Business, query, permission and export logic that 01.7 page-composition work must not touch.
const BUSINESS_FILES = [
  "src/lib/finance-reports.ts", "src/lib/statements.ts", "src/lib/project-costing.ts", "src/lib/accounting.ts", "src/lib/settlement.ts",
  "src/lib/invoice-posting.ts", "src/lib/payment-reversal.ts", "src/lib/advance-allocations.ts", "src/lib/bank-gl-accounts.ts", "src/lib/bank-opening.ts",
  "src/lib/base-currency.ts", "src/lib/dashboard-layout.ts", "src/lib/dashboard-range.ts", "src/lib/report-export.ts", "src/lib/role-matrix.ts",
  "src/lib/session.ts", "src/lib/tenant.ts", "src/lib/auth.ts", "src/lib/status-registry.ts", "src/lib/date-only.ts", "src/lib/documents.ts",
  "src/lib/document-registry.ts", "src/lib/document-hrefs.ts", "src/lib/exchange-rates.ts", "src/proxy.ts",
  "src/app/(app)/dashboard/_shared/queries.ts", "src/app/(app)/hr/payroll/queries.ts",
  "src/app/(app)/documents/export/route.ts", "src/app/(app)/finance/reports/export/route.ts", "src/app/(app)/finance/statements/export/route.ts",
  "src/app/api/document-pdf/[type]/[id]/route.ts", "src/app/api/import-template/[module]/route.ts", "src/app/auth/clear/route.ts", "src/app/uploads/[...path]/route.ts",
];
const BUSINESS_DIRS = ["src/db", "drizzle", "src/lib/currency", "src/lib/pdf", "src/app/print", "src/lib/security", "src/lib/compliance", "src/lib/rates"];
/** The server actions of the 01.7 areas: every "use server" module under them. */
const ACTION_AREAS = ["clients", "dashboard", "finance", "hr", "inventory/products", "projects", "purchasing/vendors", "recycle-bin", "settings"].map((d) => A + d);
const actionFiles = () => ACTION_AREAS.flatMap((d) => walk(d)).filter((f) => /\.tsx?$/.test(f) && directives(parse(f)).includes("use server"));
function dirHash(dir: string) {
  const files = walk(dir);
  const hh = createHash("sha256");
  for (const f of files) {
    hh.update(f + "\0");
    hh.update(readFileSync(path.join(ROOT, f)));
  }
  return `${hh.digest("hex").slice(0, 16)} (${files.length} files)`;
}
const sha = (p: string) => h16(readFileSync(path.join(ROOT, p)));
function business(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...BUSINESS_FILES, ...actionFiles()].sort()) out[f] = existsSync(path.join(ROOT, f)) ? sha(f) : "(missing)";
  for (const d of BUSINESS_DIRS) out[`${d}/**`] = existsSync(path.join(ROOT, d)) ? dirHash(d) : "(missing)";
  return out;
}

// The prerequisite contracts, as the code that carries them (not whole files: most of these files
// are consumers that later 01.7 stages restyle).
const findAll = (sf: ts.SourceFile, pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};
const fnNamed = (name: string) => (n: ts.Node) => ts.isFunctionDeclaration(n) && n.name?.text === name;
const varNamed = (name: string) => (n: ts.Node) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText() === name);
const callsWith = (arg0: string) => (n: ts.Node) => ts.isCallExpression(n) && n.arguments[0]?.getText() === arg0;
const jsxAttr = (name: string) => (n: ts.Node) => ts.isJsxAttribute(n) && n.name.getText() === name;
const importOf = (spec: string) => (n: ts.Node) => ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === spec;
type Contract = { id: string; file: string; pick: (n: ts.Node) => boolean; count: number; must: RegExp[] };
const SH = A + "sales/_shared/";
const CONTRACTS: Contract[] = [
  { id: "P0 · DISPLAY_NUMBER_LOCALE is en-US", file: "src/lib/currency/currencies.ts", pick: varNamed("DISPLAY_NUMBER_LOCALE"), count: 1, must: [/export const DISPLAY_NUMBER_LOCALE = "en-US";/] },
  { id: "P0 · line-item money fmt() formats in DISPLAY_NUMBER_LOCALE", file: SH + "totals.ts", pick: fnNamed("fmt"), count: 1, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ minimumFractionDigits: dp, maximumFractionDigits: dp \}\)/] },
  { id: "P0 · journal totals format in DISPLAY_NUMBER_LOCALE", file: A + "finance/journal/journal-form.tsx", pick: callsWith("DISPLAY_NUMBER_LOCALE"), count: 2, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ minimumFractionDigits: moneyDp, maximumFractionDigits: moneyDp \}\)/] },
  { id: "P0 · ledger balances format in DISPLAY_NUMBER_LOCALE", file: A + "finance/_shared/account-ledger-view.tsx", pick: callsWith("DISPLAY_NUMBER_LOCALE"), count: 1, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ maximumFractionDigits: 0 \}\)/] },
  { id: "P0.1 · Security Center formats in UTC", file: A + "settings/security/security-client.tsx", pick: fnNamed("fmtDateTime"), count: 1, must: [/toLocaleString\("en-US", \{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" \}\)/] },
  { id: "P0.1 · Compliance Center formats in UTC", file: A + "settings/compliance/compliance-client.tsx", pick: fnNamed("fmtDate"), count: 1, must: [/toLocaleString\("en-US", \{ month: "short", day: "numeric", year: "numeric", timeZone: "UTC" \}\)/] },
  { id: "P0.2 · Credit Notes page hands the client the UTC month", file: A + "sales/credit-notes/page.tsx", pick: jsxAttr("currentMonthKey"), count: 1, must: [/^currentMonthKey=\{new Date\(\)\.toISOString\(\)\.slice\(0, 7\)\}$/] },
  { id: "P0.2 · Debit Notes page hands the client the UTC month", file: A + "purchasing/debit-notes/page.tsx", pick: jsxAttr("currentMonthKey"), count: 1, must: [/^currentMonthKey=\{new Date\(\)\.toISOString\(\)\.slice\(0, 7\)\}$/] },
  { id: "P0.2 · Credit Notes count This Month as date text", file: A + "sales/credit-notes/cn-list-client.tsx", pick: varNamed("thisMonthCount"), count: 1, must: [/r\.issueDate\.slice\(0, 7\) === currentMonthKey/] },
  { id: "P0.2 · Debit Notes count This Month as date text", file: A + "purchasing/debit-notes/dn-list-client.tsx", pick: varNamed("thisMonthCount"), count: 1, must: [/r\.issueDate\.slice\(0, 7\) === currentMonthKey/] },
  { id: "P0.2 · Valid Till dialog uses the calendar addDays", file: SH + "validity-days-dialog.tsx", pick: (n) => importOf("@/lib/date-only")(n) || varNamed("preview")(n), count: 2, must: [/import \{ addDays \} from "@\/lib\/date-only";/, /const preview = addDays\(base, n\);/] },
  { id: "P0.2 · Expected Delivery dialog uses the calendar addDays", file: SH + "date-settings-dialog.tsx", pick: (n) => importOf("@/lib/date-only")(n) || varNamed("preview")(n), count: 2, must: [/import \{ addDays \} from "@\/lib\/date-only";/, /const preview = addDays\(base, Number\(days\) \|\| 0\);/] },
  { id: "P0.2 · the quotation form computes Valid Till with it", file: A + "sales/quotations/quotation-form.tsx", pick: varNamed("effectiveValidUntil"), count: 1, must: [/const effectiveValidUntil = autoValidity \? addDays\(issueDate, validityDays\) : validUntil;/] },
];
function contract(c: Contract): { text: string[]; hash: string } {
  const text = findAll(parse(c.file), c.pick).map(canon);
  return { text, hash: h16(text.join("\n")) };
}

/** Every JSX use of a component across src: `file: <Name attr attr…>` (attribute names only), sorted. */
function uses(name: string, except: string): string[] {
  const out: string[] = [];
  for (const f of walk("src").filter((f) => /\.tsx$/.test(f) && f !== except)) {
    if (!read(f).includes(name)) continue;
    const visit = (n: ts.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === name)
        out.push(`${f}: <${name}${n.attributes.properties.map((a) => " " + (ts.isJsxAttribute(a) ? a.name.getText() : "{…}")).sort().join("")}>`);
      ts.forEachChild(n, visit);
    };
    visit(parse(f));
  }
  return out.sort();
}
/** Modules that import `name` from `spec` (any path ending in it). */
function importers(name: string, specEnd: string): string[] {
  return walk("src")
    .filter((f) => /\.tsx?$/.test(f) && read(f).includes(name))
    .filter((f) =>
      moduleSpecs(parse(f)).some(
        ({ node, spec }) =>
          spec.endsWith(specEnd) && ts.isImportDeclaration(node) && !!node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.some((e) => (e.propertyName ?? e.name).text === name),
      ),
    );
}

/** CSS rules (with their @-rule context) whose selector names `cls`, across the app's stylesheets. */
function cssRules(cls: string): string[] {
  const out: string[] = [];
  for (const f of walk("src").filter((f) => f.endsWith(".css"))) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: string[] = [];
    let buf = "";
    let leaf = true;
    for (const ch of text) {
      if (ch === "{") {
        stack.push((buf.split(";").pop() ?? "").trim().replace(/\s+/g, " "));
        buf = "";
        leaf = true;
      } else if (ch === "}") {
        const sel = stack.pop() ?? "";
        if (leaf && sel.split(",").some((s) => s.includes(cls)))
          out.push(`${f}: ${[...stack, sel].join(" > ")} { ${buf.trim().replace(/\s+/g, " ").replace(/;?\s*$/, ";")} }`);
        buf = "";
        leaf = false;
      } else buf += ch;
    }
  }
  return out;
}

function snapshot(): Pins {
  const pins = WRITE ? null : (JSON.parse(read(PINS_FILE)) as Pins);
  const scope = pins?.routes.scope ?? SCOPE_FROM_AUDIT;
  return {
    baseline: "1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50",
    routes: { ...routes, scope },
    guards: Object.fromEntries([...scope, ...routes.layouts].map((p) => [p, guards(p)])),
    data: Object.fromEntries(scope.map((p) => [p, dataSection(p)])),
    business: business(),
    contracts: Object.fromEntries(CONTRACTS.map((c) => [c.id, contract(c).hash])),
    consumers: {
      CardTitle: uses("CardTitle", "src/components/ui/card.tsx"),
      StatRow: uses("StatRow", SH + "stat-row.tsx"),
      ListEmptyState: uses("ListEmptyState", SH + "list-empty-state.tsx"),
      SectionHeader: uses("SectionHeader", "src/components/ui/section-header.tsx"),
      EmptyState: uses("EmptyState", "src/components/ui/empty-state.tsx"),
      formatDisplayDate: importers("formatDisplayDate", "i18n/format-date"),
      PageHeader: uses("PageHeader", PHF),
    },
    listEmptyState: sha(SH + "list-empty-state.tsx"),
    css: { ".stat-row-2": cssRules(".stat-row-2") },
    actions: Object.fromEntries(scope.map((p) => [p, actions(p)])),
  };
}
type Pins = {
  baseline: string;
  routes: { pages: string[]; handlers: string[]; layouts: string[]; scope: string[] };
  guards: Record<string, string[]>;
  data: Record<string, string[]>;
  business: Record<string, string>;
  contracts: Record<string, string>;
  consumers: Record<string, string[]>;
  listEmptyState: string;
  css: Record<string, string[]>;
  actions: Record<string, string[]>;
};
// The 36 DEV-UI-01.7 pages (Stage 1 audit). Used only when writing the pins; the check reads them back.
const SCOPE_FROM_AUDIT = [
  "clients/[id]", "clients/new", "clients", "clients/recycle-bin", "dashboard", "finance/bank-accounts", "finance/chart-of-accounts", "finance/journal",
  "finance/ledger", "finance/payments", "finance/reports", "finance/statements", "hr/attendance", "hr/departments", "hr/employees/[id]", "hr/employees/new",
  "hr/employees", "hr/leave", "hr/payroll", "inventory/products/[id]", "inventory/products/new", "inventory/products", "inventory/products/recycle-bin",
  "projects/[id]", "projects/new", "projects", "purchasing/vendors/[id]", "purchasing/vendors/new", "purchasing/vendors", "purchasing/vendors/recycle-bin",
  "recycle-bin", "settings/compliance", "settings/organization", "settings/presets", "settings/security", "settings/team",
].map((r) => `(app)/${r}/page.tsx`);

const now = snapshot();
if (WRITE) {
  writeFileSync(path.join(ROOT, PINS_FILE), JSON.stringify(now, null, 2) + "\n");
  console.log(`wrote ${PINS_FILE}`);
  process.exit(0);
}
const pins = JSON.parse(read(PINS_FILE)) as Pins;
const { SectionHeader } = await import("../src/components/ui/section-header");
const { EmptyState } = await import("../src/components/ui/empty-state");
const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } = await import("../src/components/ui/card");
const { StatRow } = await import("../src/app/(app)/sales/_shared/stat-row");
const { statusStat } = await import("../src/lib/status-registry");
const { formatDisplayDate } = await import("../src/lib/i18n/format-date");
const { PageHeader } = await import("../src/components/layout/page-header");
const { t: translate } = await import("../src/lib/i18n/dict");
const same =(a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function delta(want: string[], got: string[]) {
  const w = [...want];
  const extra: string[] = [];
  for (const g of got) {
    const i = w.indexOf(g);
    if (i >= 0) w.splice(i, 1);
    else extra.push(g);
  }
  return [...w.map((x) => `- ${x}`), ...extra.map((x) => `+ ${x}`)].slice(0, 8).join("\n          ");
}

console.log("Page archetypes — C0 foundations and guardrails (baseline 1bfdbbf) + C1 master data and entity detail");

// ---------- 1. routes ----------
section("1. routes");
check(`page routes are the pinned ${pins.routes.pages.length} (the audit counted 72)`, same(now.routes.pages, pins.routes.pages) && pins.routes.pages.length === 72, delta(pins.routes.pages, now.routes.pages));
check(`route handlers are the pinned ${pins.routes.handlers.length}`, same(now.routes.handlers, pins.routes.handlers), delta(pins.routes.handlers, now.routes.handlers));
check(`layouts are the pinned ${pins.routes.layouts.length}`, same(now.routes.layouts, pins.routes.layouts), delta(pins.routes.layouts, now.routes.layouts));
const missingScope = pins.routes.scope.filter((p) => !now.routes.pages.includes(p));
check(`the ${pins.routes.scope.length} DEV-UI-01.7 pages all exist (the audit's 36)`, pins.routes.scope.length === 36 && new Set(pins.routes.scope).size === 36 && missingScope.length === 0, missingScope.join(" "));

// ---------- 2. guards ----------
section("2. guards");
const guardDrift = Object.keys(pins.guards).filter((p) => !same(now.guards[p], pins.guards[p]));
check(`guards of the 36 pages and ${pins.routes.layouts.length} layouts match the snapshot (session / role / redirect / notFound / role expressions)`,
  guardDrift.length === 0 && Object.keys(pins.guards).length === 36 + pins.routes.layouts.length,
  guardDrift.map((p) => `${p}\n          ${delta(pins.guards[p], now.guards[p] ?? [])}`).join("\n          "));
check("the (app) layout requires a session for every page under it", now.guards["(app)/layout.tsx"]?.includes("requireSession()") ?? false, JSON.stringify(now.guards["(app)/layout.tsx"]));
const OWNER_ADMIN = ["hr/payroll", "settings/organization", "settings/presets", "settings/compliance"].map((r) => `(app)/${r}/page.tsx`);
check("Payroll, Business Settings, Presets and Compliance require owner / admin", OWNER_ADMIN.every((p) => now.guards[p]?.includes('requireRole("owner", "admin")')));
check("/settings/team redirects to the Team tab of Business Settings", same(now.guards["(app)/settings/team/page.tsx"], ['redirect("/settings/organization?tab=team")']));
const unguarded = pins.routes.scope.filter((p) => !OWNER_ADMIN.includes(p) && p !== "(app)/settings/team/page.tsx" && !now.guards[p]?.includes("requireSession()"));
check("every other 01.7 page requires a session itself — except New Product, which the (app) layout covers", same(unguarded, ["(app)/inventory/products/new/page.tsx"]), unguarded.join(" "));
const detail = pins.routes.scope.filter((p) => p.includes("/[id]/"));
check(`the ${detail.length} entity detail pages answer an unknown id with notFound()`, detail.length === 5 && detail.every((p) => now.guards[p]?.includes("notFound()")));

// ---------- 3. server data sections ----------
section("3. server data sections");
const dataDrift = pins.routes.scope.filter((p) => !same(now.data[p], pins.data[p]));
const statements = Object.values(pins.data).reduce((n, d) => n + d.length, 0);
check(`server data sections of the 36 pages unchanged (${statements} statements pinned; markup and display-date formatting excluded)`, dataDrift.length === 0,
  dataDrift.map((p) => `${p}\n          ${delta(pins.data[p], now.data[p])}`).join("\n          "));
check("every page's section was found (a default page function in each)", pins.routes.scope.every((p) => !now.data[p].includes("(no default page function)")));

// ---------- 4. business ----------
section("4. business, query, permission and export logic");
const bizDrift = Object.keys(pins.business).filter((k) => now.business[k] !== pins.business[k]);
const bizNew = Object.keys(now.business).filter((k) => !(k in pins.business));
check(`${Object.keys(pins.business).filter((k) => !k.endsWith("/**")).length} business / query / permission / export files and the 01.7 server actions byte-identical`,
  bizDrift.filter((k) => !k.endsWith("/**")).length === 0 && bizNew.length === 0, [...bizDrift.filter((k) => !k.endsWith("/**")), ...bizNew.map((k) => `new: ${k}`)].join(" "));
check(`directories byte-identical (${BUSINESS_DIRS.join(", ")})`, bizDrift.filter((k) => k.endsWith("/**")).length === 0, bizDrift.filter((k) => k.endsWith("/**")).join(" "));

// ---------- 5. prerequisites ----------
section("5. P0 / P0.1 / P0.2 contracts");
for (const c of CONTRACTS) {
  const got = contract(c);
  const missing = c.must.filter((re) => !got.text.some((t) => re.test(t)));
  check(c.id, got.text.length === c.count && missing.length === 0 && got.hash === pins.contracts[c.id],
    `${got.text.length}/${c.count} found; ${missing.map(String).join(" ")} ${got.hash === pins.contracts[c.id] ? "" : "(section changed)"}`);
}
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const chain = pkg.scripts["verify:static"] ?? "";
check("verify:static still runs number-locale (P0), date-timezone (P0.1), business-dates (P0.2) and page-archetypes",
  ["verify:number-locale", "verify:date-timezone", "verify:business-dates", "verify:page-archetypes"].every((s) => chain.includes(`npm run ${s}`)) &&
    pkg.scripts["verify:page-archetypes"] === "tsx verify/verify-page-archetypes.mts");
check("the prerequisites' browser suites are still in place (AR locale, settings time zone, business-date hydration)",
  ["verify/verify-ar-locale-hydration.mjs", "verify/verify-settings-timezone-hydration.mjs", "verify/verify-business-date-hydration.mjs"].every((f) => existsSync(path.join(ROOT, f))));

// ---------- 6. primitives ----------
section("6. primitives");
type Props = Record<string, { type: string; optional: boolean }>;
/** The props type of a component: the type literal of its first parameter (intersections flattened). */
function propsOf(file: string, name: string): Props {
  const fn = findAll(parse(file), fnNamed(name))[0] as ts.FunctionDeclaration | undefined;
  const out: Props = {};
  const add = (t: ts.TypeNode | undefined) => {
    if (!t) return;
    if (ts.isIntersectionTypeNode(t)) t.types.forEach(add);
    else if (ts.isTypeLiteralNode(t)) {
      for (const m of t.members) if (ts.isPropertySignature(m) && m.type) out[m.name.getText()] = { type: m.type.getText(), optional: !!m.questionToken };
    } else if (ts.isTypeReferenceNode(t)) out[`(${t.getText()})`] = { type: t.getText(), optional: false };
  };
  add(fn?.parameters[0]?.type);
  return out;
}
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const headings = (s: string) => [...s.matchAll(/<(h[1-6])\b/g)].map((m) => m[1]);
// Physical direction (DEV-UI-01.0 G1): Tailwind utilities inside strings, and inline-style keys.
const TW_PHYSICAL = /(?<=^|[\s"'`:{(])-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-(?:\[[^\]]+\]|\d[\d./]*|auto|px|full)(?=$|[\s"'`}),])|(?<=^|[\s"'`:{(])(text-left|text-right|float-left|float-right|clear-left|clear-right|border-l|border-r|rounded-l|rounded-r)(?=$|[\s"'`}),])/g;
const JS_PHYSICAL = /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|left|right)\s*:|textAlign:\s*["'](?:left|right)["']/g;
function physical(file: string): string[] {
  const sf = parse(file);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      for (const m of n.text.matchAll(TW_PHYSICAL)) out.push(m[0]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const code = sf.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(JS_PHYSICAL)) out.push(m[0]);
  return out;
}
const imports = (file: string) => moduleSpecs(parse(file)).map((s) => s.spec);
/** Identifiers and strings that would mean a primitive knows where it is: routing, the URL, the session. */
function routeAware(file: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && /^(usePathname|useRouter|useSearchParams|useParams|useSelectedLayoutSegments?|redirect|location|pathname|router|navigator|window|document|cookies|headers|session)$/.test(n.text)) out.push(n.text);
    const r = routeLiteral(n);
    if (r) out.push(r);
    ts.forEachChild(n, visit);
  };
  visit(parse(file));
  return out;
}

// SectionHeader
const SHF = "src/components/ui/section-header.tsx";
const shProps = propsOf(SHF, "SectionHeader");
check("SectionHeader: the locked API — title, level?: 2 | 3, id?, description?, meta?, actions?, className? — and nothing else",
  same(shProps, {
    title: { type: "React.ReactNode", optional: false }, level: { type: "2 | 3", optional: true }, id: { type: "string", optional: true },
    description: { type: "React.ReactNode", optional: true }, meta: { type: "React.ReactNode", optional: true }, actions: { type: "React.ReactNode", optional: true },
    className: { type: "string", optional: true },
  }), JSON.stringify(shProps));
const shDefault = html(h(SectionHeader, { title: "Invoices" }));
check("SectionHeader: defaults to a real <h2> with text-title-sm / 600", same(headings(shDefault), ["h2"]) && shDefault.includes('<h2 class="text-title-sm font-semibold text-ink">Invoices</h2>'), shDefault);
const sh3 = html(h(SectionHeader, { title: "Lines", level: 3, id: "lines-h" }));
check("SectionHeader: level 3 is a real <h3> with text-body-lg / 600, and id lands on the heading",
  same(headings(sh3), ["h3"]) && sh3.includes('<h3 id="lines-h" class="text-body-lg font-semibold text-ink">Lines</h3>'), sh3);
const shForced = [1, 4, 5, 6].map((level) => headings(html(h(SectionHeader, { title: "X", level: level as 2 }))).join(""));
check("SectionHeader: no other level can come out — 1, 4, 5 and 6 from an untyped caller still render <h2>", shForced.every((x) => x === "h2"), shForced.join(" "));
const shFull = html(h(SectionHeader, { title: "Recent activity", id: "ra", description: "Last 30 days", meta: "12 items", actions: h("button", { type: "button" }, "View all") }));
const shHeading = shFull.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1];
check("SectionHeader: description, meta and actions render outside the heading (the heading holds only the title)",
  shHeading === "Recent activity" && /<\/h2><p class="mt-0\.5 text-body-sm text-ink-muted">Last 30 days<\/p>/.test(shFull) && />12 items</.test(shFull) && /<button type="button">View all<\/button>/.test(shFull), shFull);
const shEmpty = html(h(SectionHeader, { title: "T", description: false, meta: "", actions: null }));
check("SectionHeader: empty slots (false, \"\", null) render nothing", !/<p|text-body-sm|gap-2/.test(shEmpty), shEmpty);
check("SectionHeader: flex row with gaps that wraps — logical layout, no physical left / right", /^<div data-slot="section-header" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"/.test(shDefault) && physical(SHF).length === 0, physical(SHF).join(" "));
check("SectionHeader: imports only react and the cn helper; no router, pathname, session or route strings",
  same(imports(SHF).sort(), ["@/lib/utils", "react"]) && routeAware(SHF).length === 0, [...imports(SHF), ...routeAware(SHF)].join(" "));
const shTags = findAll(parse(SHF), (n) => ts.isStringLiteral(n) && /^h[1-6]$/.test(n.text)).map((n) => (n as ts.StringLiteral).text).sort();
check("SectionHeader: the only heading elements in its source are h2 and h3", same(shTags, ["h2", "h3"]), shTags.join(" "));

// EmptyState
const ESF = "src/components/ui/empty-state.tsx";
const esProps = propsOf(ESF, "EmptyState");
check("EmptyState: the locked API — message, hint?, action?, className? — and nothing else",
  same(esProps, { message: { type: "React.ReactNode", optional: false }, hint: { type: "React.ReactNode", optional: true }, action: { type: "React.ReactNode", optional: true }, className: { type: "string", optional: true } }),
  JSON.stringify(esProps));
const es = html(h(EmptyState, { message: "No clients yet.", hint: "Add your first client.", action: h("a", { href: "/x" }, "Add") }));
check("EmptyState: the DEV-UI-01.5 list-card surface (rounded-xl, border-line, bg-surface, py-12, px-6), centred",
  /^<div data-slot="empty-state" class="rounded-xl border border-line bg-surface py-12 px-6 text-center">/.test(es), es);
check("EmptyState: message, hint and action in the ListEmptyState type scale",
  es.includes('<p class="text-body text-ink-muted">No clients yet.</p><p class="mt-1.5 text-body-sm text-ink-faint">Add your first client.</p><div class="mt-5 flex flex-wrap items-center justify-center gap-2"><a href="/x">Add</a></div>'), es);
const esBare = html(h(EmptyState, { message: "Nothing", hint: false, action: null, className: "mt-4" }));
check("EmptyState: no hint / action markup when they are absent; className merges", esBare === '<div data-slot="empty-state" class="rounded-xl border border-line bg-surface py-12 px-6 text-center mt-4"><p class="text-body text-ink-muted">Nothing</p></div>', esBare);
check("EmptyState: imports only react and the cn helper; no route awareness; no physical left / right",
  same(imports(ESF).sort(), ["@/lib/utils", "react"]) && routeAware(ESF).length === 0 && physical(ESF).length === 0, [...imports(ESF), ...routeAware(ESF), ...physical(ESF)].join(" "));
check("ListEmptyState byte-identical to 1bfdbbf, and neither empty state imports the other",
  now.listEmptyState === pins.listEmptyState && !read(SH + "list-empty-state.tsx").includes("empty-state\"") && !imports(ESF).some((s) => s.includes("list-empty-state")));
check("ListEmptyState still serves its 9 lists — the 8 document lists and Projects (not replaced by EmptyState)", same(now.consumers.ListEmptyState, pins.consumers.ListEmptyState) && pins.consumers.ListEmptyState.length === 9,
  delta(pins.consumers.ListEmptyState, now.consumers.ListEmptyState));

// CardTitle (+ the rest of the Card family, unchanged)
// Markup captured from the 1bfdbbf components.
const CARD_1BFDBBF: [string, () => string, string][] = [
  ["Card", () => html(h(Card, null, "x")), '<div data-slot="card" class="card">x</div>'],
  ["Card (hoverable is ignored)", () => html(h(Card, { hoverable: true, className: "p-4", id: "c1" }, "x")), '<div data-slot="card" class="card p-4" id="c1">x</div>'],
  ["CardHeader", () => html(h(CardHeader, null, "x")), '<div data-slot="card-header" class="flex flex-col gap-1 px-5 pt-5">x</div>'],
  ["CardTitle", () => html(h(CardTitle, null, "Contact")), '<div data-slot="card-title" class="text-title-sm font-semibold text-ink">Contact</div>'],
  ["CardTitle with class / id / aria", () => html(h(CardTitle, { className: "text-body-lg mb-2", id: "t1", "aria-label": "Lbl" }, "Contact")),
    '<div data-slot="card-title" class="font-semibold text-ink text-body-lg mb-2" id="t1" aria-label="Lbl">Contact</div>'],
  ["CardDescription", () => html(h(CardDescription, null, "x")), '<div data-slot="card-description" class="text-xs text-ink-muted">x</div>'],
  ["CardContent", () => html(h(CardContent, { className: "pt-5" }, "x")), '<div data-slot="card-content" class="px-5 pb-5 pt-5">x</div>'],
  ["CardFooter", () => html(h(CardFooter, null, "x")), '<div data-slot="card-footer" class="flex items-center px-5 pb-5">x</div>'],
];
const cardDiff = CARD_1BFDBBF.filter(([, render, want]) => render() !== want);
check("Card family renders exactly the 1bfdbbf markup — CardTitle still a <div> by default, same classes", cardDiff.length === 0, cardDiff.map(([n, r]) => `${n}: ${r()}`).join(" | "));
const ctProps = propsOf("src/components/ui/card.tsx", "CardTitle");
check('CardTitle: `as` accepts only "div" | "h2" | "h3", defaulting to "div"',
  ctProps.as?.type === '"div" | "h2" | "h3"' && ctProps.as.optional && /\bas: Comp = "div"/.test(read("src/components/ui/card.tsx")), JSON.stringify(ctProps));
const ctH2 = html(h(CardTitle, { as: "h2", id: "h" }, "Contact"));
const ctH3 = html(h(CardTitle, { as: "h3" }, "Contact"));
check("CardTitle as h2 / h3: the same slot and classes on a real heading, and `as` never reaches the DOM",
  ctH2 === '<h2 data-slot="card-title" class="text-title-sm font-semibold text-ink" id="h">Contact</h2>' && ctH3 === '<h3 data-slot="card-title" class="text-title-sm font-semibold text-ink">Contact</h3>', `${ctH2} ${ctH3}`);
// C1: the four CardTitle consumers are the entity-detail side cards; each now passes as="h2"
// (group 9 checks the value). No other CardTitle passes `as`.
const ctAs = now.consumers.CardTitle.filter((u) => / as\b/.test(u));
check(`CardTitle consumers as pinned (${pins.consumers.CardTitle.length}); \`as\` only on the C1 entity-detail side cards (${ctAs.length})`,
  same(now.consumers.CardTitle, pins.consumers.CardTitle) && ctAs.length === 4 && ctAs.every((u) => C1_DETAIL.some((f) => u.startsWith(`${f}: `))), delta(pins.consumers.CardTitle, now.consumers.CardTitle));

// StatRow
const SRF = SH + "stat-row.tsx";
const srProps = propsOf(SRF, "StatRow");
const srItem = findAll(parse(SRF), (n) => ts.isTypeAliasDeclaration(n) && n.name.text === "StatItem")[0] as ts.TypeAliasDeclaration | undefined;
const srValue = srItem && ts.isTypeLiteralNode(srItem.type) ? srItem.type.members.find((m) => m.name?.getText() === "value") : undefined;
check("StatRow: `value` is a React.ReactNode (a <Money> can go in)", !!srValue && ts.isPropertySignature(srValue) && srValue.type?.getText() === "React.ReactNode" && !srValue.questionToken);
check("StatRow: `columns` accepts only 2 | 3 | 4, and is optional", same(srProps, { items: { type: "StatItem[]", optional: false }, columns: { type: "2 | 3 | 4", optional: true } }), JSON.stringify(srProps));
const srItems = [
  { label: "Total Credit Notes", value: "12" },
  statusStat("en", "credit_note", "issued", 5),
  statusStat("ar", "sales_invoice", "partially_paid", 2),
  { label: "This Month", value: "3", colorClass: "text-success" },
];
// Markup captured from the 1bfdbbf StatRow for the same items.
const KPI = (label: string, cls: string, value: string, attrs = "") =>
  `<div class="card" style="padding:16px 18px"${attrs}><div class="kpi-label" style="font-size:11.5px;color:var(--ink-muted)">${label}</div><div class="kpi-value ${cls}" style="font-family:var(--font-display);font-weight:800;font-size:20px;margin-top:4px">${value}</div></div>`;
const SR_1BFDBBF = `<div class="stat-row-2">${KPI("Total Credit Notes", "", "12")}${KPI("Issued", "text-corrective", "5", ' data-status-domain="credit_note" data-status="issued" data-tone="corrective"')}${KPI("مدفوع جزئيًا", "text-warning", "2", ' data-status-domain="sales_invoice" data-status="partially_paid" data-tone="warning"')}${KPI("This Month", "text-success", "3")}</div>`;
const srNow = html(h(StatRow, { items: srItems }));
check("StatRow without `columns` renders exactly the 1bfdbbf markup — no data-columns, no style on the row, weight 800 kept", srNow === SR_1BFDBBF && html(h(StatRow, { items: [] })) === '<div class="stat-row-2"></div>', srNow);
const srBad = [5, 1, 0, 3.5, "3", null].map((c) => html(h(StatRow, { items: srItems, columns: c as 2 })));
check("StatRow: any other `columns` from an untyped caller falls back to the default row", srBad.every((x) => x === SR_1BFDBBF));
const srCols = ([2, 3, 4] as const).map((c) => html(h(StatRow, { items: srItems.slice(0, 1), columns: c })));
// D-6 (C2): `columns` sets --stat-cols; the .stat-row-2 rule owns the grid, so its ≤640px rule reaches
// every row — an inline grid-template-columns (C0's first form) would beat that media rule.
check("StatRow columns 2 / 3 / 4: the same .stat-row-2 row with --stat-cols set (D-6) — no inline grid-template-columns to beat the phone rule",
  srCols.every((x, i) => x.startsWith(`<div class="stat-row-2" data-columns="${i + 2}" style="--stat-cols:${i + 2}">`)) &&
    !/grid-template-columns/.test(srCols.join("")) && !/gridTemplateColumns|grid-template-columns/.test(codeOnly(read(SRF))), srCols.join(" "));
const srNode = html(h(StatRow, { items: [{ label: "Balance", value: h("span", { className: "money" }, "SAR 1,250.00") }] }));
check("StatRow: a ReactNode value renders inside the kpi-value", srNode.includes('margin-top:4px"><span class="money">SAR 1,250.00</span></div>'), srNode);
check(`StatRow consumers as pinned (${pins.consumers.StatRow.length}) — C0's nine, plus the Employees and Payroll strips (C2); none passes \`columns\``,
  same(now.consumers.StatRow, pins.consumers.StatRow) && now.consumers.StatRow.length === 11 && !now.consumers.StatRow.some((u) => / columns\b/.test(u)) &&
    C2_STATROWS.every((f) => now.consumers.StatRow.some((u) => u.startsWith(`${f}: `))), delta(pins.consumers.StatRow, now.consumers.StatRow));
// D-6 (approved; C2): every KPI row is --stat-cols columns (default 4) on minmax(0, 1fr) tracks, and two
// across at ≤640px. These are the only rules naming .stat-row-2.
const D6_RULES = [
  `${A}mockup-parity.css: .stat-row-2 { display: grid; grid-template-columns: repeat(var(--stat-cols, 4), minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }`,
  `${A}mockup-parity.css: @media (max-width: 640px) > .stat-row-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
];
check("D-6: .stat-row-2 is --stat-cols columns (default 4) of minmax(0, 1fr), and two across at ≤640px — the only rules for it",
  same(now.css[".stat-row-2"], D6_RULES) && same(now.css[".stat-row-2"], pins.css[".stat-row-2"]), now.css[".stat-row-2"].join(" | "));
check("StatRow / CardTitle: no physical left / right; StatRow still imports only status-registry types",
  physical(SRF).length === 0 && physical("src/components/ui/card.tsx").length === 0 && same(imports(SRF), ["@/lib/status-registry"]) && /^import type /m.test(read(SRF)));

// formatDisplayDate
const FDF = "src/lib/i18n/format-date.ts";
const fdSf = parse(FDF);
const fdFn = findAll(fdSf, fnNamed("formatDisplayDate"))[0] as ts.FunctionDeclaration | undefined;
check("formatDisplayDate(value: Date | string, locale: Locale, style: DisplayDateStyle) — three parameters, no options bag",
  !!fdFn && fdFn.parameters.map((p) => `${p.name.getText()}: ${p.type?.getText()}`).join(", ") === "value: Date | string, locale: Locale, style: DisplayDateStyle" && hasModifier(fdFn, ts.SyntaxKind.ExportKeyword));
const fdStyle = findAll(fdSf, (n) => ts.isTypeAliasDeclaration(n) && n.name.text === "DisplayDateStyle")[0] as ts.TypeAliasDeclaration | undefined;
check('formatDisplayDate: three shapes only — "date" | "dateTime" | "monthYear"', fdStyle?.type.getText() === '"date" | "dateTime" | "monthYear"', fdStyle?.type.getText());
const formatters = findAll(fdSf, (n) => (ts.isNewExpression(n) || ts.isCallExpression(n)) && n.expression.getText().replace(/^globalThis\./, "") === "Intl.DateTimeFormat") as (ts.NewExpression | ts.CallExpression)[];
const fmtProblems: string[] = [];
const locCount: Record<string, number> = {};
for (const f of formatters) {
  const [loc, opts] = f.arguments ?? [];
  const at = `line ${fdSf.getLineAndCharacterOfPosition(f.getStart()).line + 1}`;
  if (!loc || !ts.isStringLiteral(loc)) fmtProblems.push(`${at}: the locale is not written out`);
  else if (!["en-US", "ar-SA-u-ca-gregory-nu-latn"].includes(loc.text)) fmtProblems.push(`${at}: locale "${loc.text}"`);
  else locCount[loc.text] = (locCount[loc.text] ?? 0) + 1;
  if (!opts || !ts.isObjectLiteralExpression(opts)) fmtProblems.push(`${at}: options are not an object literal`);
  else {
    for (const p of opts.properties) {
      if (!ts.isPropertyAssignment(p)) fmtProblems.push(`${at}: ${p.getText()} (spread / shorthand)`);
      else if (!["year", "month", "day", "hour", "minute", "timeZone"].includes(p.name.getText())) fmtProblems.push(`${at}: option ${p.name.getText()}`);
    }
    const tz = opts.properties.find((p) => p.name?.getText() === "timeZone");
    if (!tz || !ts.isPropertyAssignment(tz) || !ts.isStringLiteral(tz.initializer) || tz.initializer.text !== "UTC") fmtProblems.push(`${at}: timeZone is not the literal "UTC"`);
  }
}
check('formatDisplayDate: six formatters, each with a written-out locale — en-US ×3, ar-SA-u-ca-gregory-nu-latn ×3 — and an explicit timeZone: "UTC"',
  formatters.length === 6 && fmtProblems.length === 0 && locCount["en-US"] === 3 && locCount["ar-SA-u-ca-gregory-nu-latn"] === 3, fmtProblems.join("; ") || JSON.stringify(locCount));
const fdCode = fdSf.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const inference = [/\bnavigator\b/, /resolvedOptions/, /\bprocess\b/, /toLocale(Date|Time)?String/, /getTimezoneOffset/, /Riyadh/, /\bcalendar\b/, /numberingSystem/, /hour12|hourCycle/, /localeMatcher/, /Intl\.Locale/, /\bundefined\b/, /"default"/]
  .filter((re) => re.test(fdCode));
check("formatDisplayDate: no runtime inference — no navigator, resolvedOptions, process / host zone, toLocale*String, Riyadh, calendar / numbering / hour-cycle overrides",
  inference.length === 0, inference.map(String).join(" "));
check("formatDisplayDate: imports nothing at runtime (the Locale type only)", same(imports(FDF), ["./dict"]) && /^import type \{ Locale \} from "\.\/dict";$/m.test(fdSf.text));

// The behaviour, in child processes whose host time zone and locale differ. Spelled out, not
// computed: the oracle owes nothing to Intl.
const EXPECTED: [string, string, string, string, string, string, string][] = [
  ["2026-06-15T09:00:00Z", "Jun 15, 2026", "Jun 15, 2026, 09:00 AM", "June 2026", "15 يونيو 2026", "15 يونيو 2026، 09:00 ص", "يونيو 2026"],
  ["2026-10-08T23:30:00Z", "Oct 8, 2026", "Oct 8, 2026, 11:30 PM", "October 2026", "8 أكتوبر 2026", "8 أكتوبر 2026، 11:30 م", "أكتوبر 2026"],
  ["2026-10-09T00:30:00Z", "Oct 9, 2026", "Oct 9, 2026, 12:30 AM", "October 2026", "9 أكتوبر 2026", "9 أكتوبر 2026، 12:30 ص", "أكتوبر 2026"],
  ["2026-12-31T23:59:59Z", "Dec 31, 2026", "Dec 31, 2026, 11:59 PM", "December 2026", "31 ديسمبر 2026", "31 ديسمبر 2026، 11:59 م", "ديسمبر 2026"],
  ["2027-01-01T00:00:00Z", "Jan 1, 2027", "Jan 1, 2027, 12:00 AM", "January 2027", "1 يناير 2027", "1 يناير 2027، 12:00 ص", "يناير 2027"],
  ["2026-03-08T06:45:00Z", "Mar 8, 2026", "Mar 8, 2026, 06:45 AM", "March 2026", "8 مارس 2026", "8 مارس 2026، 06:45 ص", "مارس 2026"],
];
const STYLES = ["date", "dateTime", "monthYear"] as const;
const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
const HOST_LOCALES = ["en_US.UTF-8", "ar_SA.UTF-8", "C"];
const js = ts.transpileModule(fdSf.text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const CHILD = `
const m = { exports: {} };
new Function("module", "exports", "require", process.env.FD_JS)(m, m.exports, (s) => { throw new Error("format-date.ts must not import " + s); });
const f = m.exports.formatDisplayDate;
const out = {};
for (const i of JSON.parse(process.env.FD_INSTANTS)) for (const l of ["en", "ar"]) for (const s of ["date", "dateTime", "monthYear"]) {
  out[i + "|" + l + "|" + s] = f(new Date(i), l, s);
  out["string " + i + "|" + l + "|" + s] = f(i, l, s);
}
out.invalid = JSON.stringify([f("not a date", "en", "date"), f(new Date(NaN), "ar", "dateTime"), f("", "ar", "monthYear")]);
const r = new Intl.DateTimeFormat().resolvedOptions();
console.log(JSON.stringify({ zone: r.timeZone, locale: r.locale, digits: r.numberingSystem, out }));
`;
const runs = ZONES.flatMap((zone) =>
  HOST_LOCALES.map((loc) => {
    const r = spawnSync(process.execPath, ["-e", CHILD], {
      encoding: "utf8",
      // A clean environment: only the zone and locale under test (and PATH) reach the child.
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", TZ: zone, LC_ALL: loc, LANG: loc, FD_JS: js, FD_INSTANTS: JSON.stringify(EXPECTED.map((e) => e[0])) },
    });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
    return { zone, loc, res: line ? (JSON.parse(line) as { zone: string; locale: string; digits: string; out: Record<string, string> }) : null, err: r.stderr };
  }),
);
check(`formatDisplayDate ran in ${runs.length} child processes (${ZONES.length} host time zones × ${HOST_LOCALES.length} host locales)`, runs.every((r) => r.res), runs.find((r) => !r.res)?.err.slice(0, 300));
if (runs.every((r) => r.res)) {
  const ok = runs.map((r) => ({ ...r, res: r.res! }));
  check("…and each child really had its zone and locale in effect (ar_SA defaults to Arabic-Indic digits — the trap)",
    ok.every((r) => r.res.zone === r.zone && r.res.locale === (r.loc.startsWith("ar") ? "ar-SA" : "en-US")) && ok.filter((r) => r.loc.startsWith("ar")).every((r) => r.res.digits === "arab"),
    ok.map((r) => `${r.zone}/${r.loc}: ${r.res.zone} ${r.res.locale} ${r.res.digits}`).join(", "));
  const keys = Object.keys(ok[0].res.out);
  const diverge = keys.filter((k) => ok.some((r) => r.res.out[k] !== ok[0].res.out[k]));
  check("identical output in every host zone and locale", diverge.length === 0, diverge.slice(0, 5).map((k) => `${k}: ${ok.map((r) => r.res.out[k]).join(" · ")}`).join("\n          "));
  const wrong: string[] = [];
  for (const [i, ...want] of EXPECTED)
    (["en", "ar"] as const).forEach((l, li) => STYLES.forEach((s, si) => {
      const w = want[li * 3 + si];
      for (const k of [`${i}|${l}|${s}`, `string ${i}|${l}|${s}`]) if (ok[0].res.out[k] !== w) wrong.push(`${k}: "${ok[0].res.out[k]}" ≠ "${w}"`);
    }));
  check("the exact strings: en-US and Arabic, the calendar day of the instant in UTC (23:30 UTC is still the 8th, 00:30 the 9th), Date or ISO string alike",
    wrong.length === 0, wrong.slice(0, 6).join("\n          "));
  const all = Object.values(ok[0].res.out).join(" ");
  check("Western digits only — no Arabic-Indic (٠–٩) or extended (۰–۹) digits anywhere", !/[٠-٩۰-۹]/.test(all));
  const GREGORIAN_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const arOut = Object.entries(ok[0].res.out).filter(([k]) => k.includes("|ar|")).map(([, v]) => v);
  check("Arabic is Gregorian: every Arabic date names a Gregorian month, and no Hijri era (هـ) or Hijri month appears",
    arOut.length > 0 && arOut.every((v) => GREGORIAN_AR.some((mo) => v.includes(mo))) && !/هـ|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو القعدة|ذو الحجة/.test(all));
  check('an invalid date formats as "" (never "Invalid Date")', ok[0].res.out.invalid === '["","",""]', ok[0].res.out.invalid);
}
const resolved = (["en", "ar"] as const).flatMap((l) => STYLES.map((s) => formatDisplayDate("2026-06-15T09:00:00Z", l, s)));
check("in this process too (the verifier's own zone and locale) the output is the expected one", same(resolved, EXPECTED[0].slice(1)), resolved.join(" | "));
check("consumers: formatDisplayDate on exactly the two C2 date surfaces — Attendance's date pill and Payroll's title month (Dashboard's dates are C6)",
  same(now.consumers.formatDisplayDate, pins.consumers.formatDisplayDate) && same(now.consumers.formatDisplayDate, [`${HR}attendance/page.tsx`, `${HR}payroll/page.tsx`]),
  now.consumers.formatDisplayDate.join(" "));
const fileOf = (u: string) => u.slice(0, u.indexOf(": <"));
check("consumers: SectionHeader on the client / vendor Statement of Account (C1) and Salary Structure / Past payroll runs (C2); EmptyState in the three master-data bins (C1) and the five HR empty states (C2)",
  same(now.consumers.SectionHeader, pins.consumers.SectionHeader) && same(now.consumers.EmptyState, pins.consumers.EmptyState) &&
    same(now.consumers.SectionHeader.map(fileOf), [`${A}clients/[id]/page.tsx`, `${HR}employees/[id]/page.tsx`, `${HR}payroll/page.tsx`, `${A}purchasing/vendors/[id]/page.tsx`]) &&
    same(now.consumers.EmptyState.map(fileOf), [...C1_BINS, ...C2_EMPTY].sort()),
  [...now.consumers.SectionHeader, ...now.consumers.EmptyState].join(" "));

// ---------- 7. no abstraction creep ----------
section("7. no abstraction creep");
const BANNED = ["PageLayout", "MasterDataShell", "ReportShell", "DashboardSection", "EntityDetailHeader", "SettingsSection"];
const BANNED_FILES = BANNED.map((b) => b.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase()));
const creep: string[] = [];
for (const f of walk("src").filter((f) => /\.(tsx?|css)$/.test(f))) {
  const base = path.posix.basename(f).replace(/\.[^.]+$/, "");
  if (BANNED_FILES.includes(base)) creep.push(`${f} (file)`);
  if (!/\.tsx?$/.test(f) || !BANNED.some((b) => read(f).includes(b))) continue;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && BANNED.includes(n.text)) creep.push(`${f}: ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
check(`none of the rejected abstractions exist — ${BANNED.join(", ")}`, creep.length === 0, creep.join(" "));
const PRIMS = [SHF, ESF, FDF, "src/components/ui/card.tsx", SRF, PHF];
const aware = PRIMS.flatMap((f) => routeAware(f).map((x) => `${f}: ${x}`));
const domainImports = PRIMS.flatMap((f) => imports(f).filter((s) => /^(next\/|@\/db|@\/app|@\/lib\/(session|tenant|auth|role-matrix))/.test(s)).map((s) => `${f}: ${s}`));
check("the shared primitives (and C1's PageHeader) do not branch on routes or domains: no router / pathname / session, no route strings, no app / DB / session imports",
  aware.length === 0 && domainImports.length === 0, [...aware, ...domainImports].join(" "));
const phProps = propsOf(PHF, "PageHeader");
const props = [shProps, esProps, phProps].flatMap((p) => Object.keys(p));
check("no business-domain props on the new primitives (title / level / id / description / meta / actions / message / hint / action / className only)",
  props.every((k) => ["title", "level", "id", "description", "meta", "actions", "className", "message", "hint", "action"].includes(k)), props.join(" "));

// ---------- 8. actions (static) ----------
section("8. action inventory (static half)");
const actDrift = pins.routes.scope.filter((p) => !same(now.actions[p], pins.actions[p]));
const nActs = Object.values(pins.actions).reduce((n, a) => n + a.length, 0);
check(`link targets and server actions of the 36 pages unchanged (${nActs} pinned, through page-local imports)`, actDrift.length === 0,
  actDrift.map((p) => `${p}\n          ${delta(pins.actions[p], now.actions[p])}`).join("\n          "));
const emptyInventory = pins.routes.scope.filter((p) => now.actions[p].length === 0);
check("every page has an inventory (the scan is not silently empty)", emptyInventory.length === 0, emptyInventory.join(" "));

// ---------- 9. C1 — master data and entity detail ----------
section("9. C1 — master data and entity detail");
/** Source without comments, so a check never matches its own explanation. */
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
type El = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const jsxEls = (f: string, tag: string) => findAll(parse(f), (n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === tag) as El[];
const attr = (el: El, name: string) => el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
const rel = (f: string) => f.replace(A, "");

// PageHeader, evolved in place (D-9)
check("PageHeader: the C1 API — title, description?, meta?, actions? (React.ReactNode), className? — and nothing else",
  same(phProps, {
    title: { type: "React.ReactNode", optional: false },
    description: { type: "React.ReactNode", optional: true },
    meta: { type: "React.ReactNode", optional: true },
    actions: { type: "React.ReactNode", optional: true },
    className: { type: "string", optional: true },
  }), JSON.stringify(phProps));
const PH_ROW = '<div data-slot="page-header" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6';
const PH_H1 = '<h1 class="text-page font-semibold break-words">';
const phFull = html(h(PageHeader, { title: "Al Noor Contracting (Fictional)", description: "Client profile", meta: h("span", null, "Active"), actions: h("button", { type: "button" }, "Actions") }));
check("PageHeader: the C1 markup — one wrapping flex row (flex-wrap, items-start, justify-between, gap-x-4 / gap-y-3), a min-w-0 title column with the h1 and the description, then one group: meta, then actions",
  phFull === `${PH_ROW}"><div class="min-w-0">${PH_H1}Al Noor Contracting (Fictional)</h1><p class="mt-1 text-body-lg text-ink-muted">Client profile</p></div>` +
    '<div class="flex min-w-0 flex-wrap items-center gap-2"><div data-slot="page-header-meta" class="flex flex-wrap items-center gap-2"><span>Active</span></div>' +
    '<div data-slot="page-header-actions" class="flex flex-wrap items-center gap-2"><button type="button">Actions</button></div></div></div>', phFull);
const phH1 = phFull.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
const phNode = html(h(PageHeader, { title: h("span", null, "X"), description: h("strong", null, "D"), meta: "M", actions: "A" }));
check("PageHeader: exactly one <h1>, holding only the title — description, meta and actions render outside it (string or element title alike)",
  same(headings(phFull), ["h1"]) && phH1 === "Al Noor Contracting (Fictional)" && same(headings(phNode), ["h1"]) && phNode.includes(`${PH_H1}<span>X</span></h1>`), `${phFull} ${phNode}`);
const phMeta = html(h(PageHeader, { title: "T", meta: "M" }));
const phActs = html(h(PageHeader, { title: "T", actions: "A" }));
const iMeta = phFull.indexOf('data-slot="page-header-meta"');
const iActs = phFull.indexOf('data-slot="page-header-actions"');
check("PageHeader: meta after the title and before the actions; each group only when it is given",
  phFull.indexOf("</h1>") < iMeta && iMeta < iActs && phMeta.includes("page-header-meta") && !phMeta.includes("page-header-actions") && phActs.includes("page-header-actions") && !phActs.includes("page-header-meta"),
  `${phMeta} ${phActs}`);
const phBare = html(h(PageHeader, { title: "Products", description: false, meta: "", actions: null, className: "mt-2" }));
check('PageHeader: empty slots (false, "", null) render nothing; className merges onto the row', phBare === `${PH_ROW} mt-2"><div class="min-w-0">${PH_H1}Products</h1></div></div>`, phBare);
const phCode = strip(read(PHF));
const phLayout = [/\babsolute\b/, /\bfixed\b/, /\bsticky\b/, /\binset-/, /\btranslate-/, /(?<![\w-])w-(\d|\[|full|screen)/, /(?<![\w-])max-w-/, /(?<![\w-])min-w-(?!0\b)/, /\bshrink-0\b/, /\bflex-nowrap\b/, /font-extrabold|font-bold|text-2xl/]
  .filter((re) => re.test(phCode));
check("PageHeader: a text-page / 600 title (no font-extrabold, no text-2xl) that wraps in a min-w-0 column; logical layout only — no left / right, no fixed width, nothing positioned, no shrink-0 group",
  phCode.includes(PH_H1.replace("class=", "className=")) && phLayout.length === 0 && physical(PHF).length === 0, [...phLayout.map(String), ...physical(PHF)].join(" "));
check("PageHeader: imports only react and the cn helper", same(imports(PHF), ["react", "@/lib/utils"]), imports(PHF).join(" "));
const phUses = now.consumers.PageHeader;
check(`PageHeader consumers: the 12 C1 pages and, since C2, the 7 HR routes — one header each, none patching it with a className (${phUses.length})`,
  same(phUses, pins.consumers.PageHeader) && same(phUses.map(fileOf).sort(), [...C1_PAGES, ...C2_HEADERS].sort()) && !phUses.some((u) => / className\b/.test(u)),
  delta([...C1_PAGES, ...C2_HEADERS].sort(), phUses.map(fileOf).sort()));

// D-9: the layout pin narrowed — every other layout file byte-pinned, one by one
const dfPins = JSON.parse(read("verify/document-form-pins.json")) as Record<string, string>;
const layoutFiles = walk("src/components/layout");
const layoutPinned = Object.keys(dfPins).filter((k) => k.startsWith("src/components/layout/"));
const layoutDrift = layoutPinned.filter((f) => !exists(f) || sha(f) !== dfPins[f]);
check(`D-9: no src/components/layout/** directory pin; the ${layoutFiles.length - 1} other layout files byte-pinned one by one in verify/document-form-pins.json (a new, removed or changed layout file fails) — page-header.tsx alone is free, held by this group`,
  !layoutPinned.some((k) => k.endsWith("**")) && same([...layoutPinned].sort(), layoutFiles.filter((f) => f !== PHF)) && layoutDrift.length === 0 && layoutFiles.includes(PHF),
  `pinned ${layoutPinned.length}; changed ${layoutDrift.join(" ")}; unpinned ${layoutFiles.filter((f) => f !== PHF && !layoutPinned.includes(f)).join(" ")}`);

// Headings: h1 from PageHeader, then h2 sections — no hand-written headings, no h1 → h3 jump
const handHeadings = C1_PAGES.flatMap((f) => findAll(parse(f), (n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check('C1 pages: no hand-written heading and no .main-head — the h1 comes from PageHeader, the h2s from CardTitle as="h2" and SectionHeader',
  handHeadings.length === 0 && C1_PAGES.every((f) => !strip(read(f)).includes("main-head")), handHeadings.join(" "));
const cardTitles = C1_DETAIL.flatMap((f) => jsxEls(f, "CardTitle").map((el) => `${rel(f)}: as=${attr(el, "as")?.initializer?.getText() ?? "(div)"}`));
check(`C1 detail pages: every side-card title is a real <h2> — CardTitle as="h2" (${cardTitles.length}: client Details, Invoices; vendor Purchase Orders; product Stock)`,
  cardTitles.length === 4 && cardTitles.every((x) => x.endsWith('as="h2"')), cardTitles.join(" "));
const sectionHeads = C1_PAGES.flatMap((f) => jsxEls(f, "SectionHeader").map((el) => `${rel(f)}: level=${attr(el, "level")?.initializer?.getText() ?? "(default)"} title=${attr(el, "title")?.initializer?.getText()}`));
check("C1 detail pages: Statement of Account is a SectionHeader at level 2 on client and vendor detail (it was an h3 under the h1)",
  same(sectionHeads, ['clients/[id]/page.tsx: level={2} title={t(locale, "Statement of Account")}', 'purchasing/vendors/[id]/page.tsx: level={2} title={t(locale, "Statement of Account")}']), sectionHeads.join(" | "));

// Responsive entity-detail composition
const classTokens = (f: string) => findAll(parse(f), (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)).flatMap((n) => (n as ts.StringLiteral).text.split(/\s+/));
const fixedGrid = C1_PAGES.flatMap((f) => classTokens(f).filter((c) => /^(grid-cols-([2-9]|1[0-2])|col-span-([2-9]|1[0-2]))$/.test(c)).map((c) => `${rel(f)}: ${c}`));
const detailGrid = C1_DETAIL.filter((f) => !["grid-cols-1", "lg:grid-cols-3", "lg:col-span-2"].every((c) => classTokens(f).includes(c))).map(rel);
check("C1 pages: no multi-column grid below a breakpoint (no bare grid-cols-N / col-span-N); the three detail pages are one column, then form 2/3 + side 1/3 from lg (grid-cols-1 lg:grid-cols-3, lg:col-span-2)",
  fixedGrid.length === 0 && detailGrid.length === 0, [...fixedGrid, ...detailGrid.map((f) => `${f}: no responsive grid`)].join(" "));

// Page copy through t(), with Arabic
/** Literal text an expression renders as-is: strings and template text, through ?:, &&, ||, ?? and parentheses — not t()'s argument. */
const textLits = (e: ts.Expression | undefined): string[] => {
  if (!e) return [];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
  if (ts.isParenthesizedExpression(e)) return textLits(e.expression);
  if (ts.isConditionalExpression(e)) return [...textLits(e.whenTrue), ...textLits(e.whenFalse)];
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return textLits(e.right);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return [...textLits(e.left), ...textLits(e.right)];
  return [];
};
const USER_FACING = new Set(["title", "description", "submitLabel", "label", "message", "hint", "placeholder", "aria-label", "moduleLabel", "alt"]);
const english: string[] = [];
const keysUsed = new Set<string>();
for (const f of C1_PAGES) {
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && /[A-Za-z]{2,}/.test(n.text)) english.push(`${rel(f)}: "${n.text.trim()}"`);
    if (ts.isJsxAttribute(n) && USER_FACING.has(n.name.getText()) && n.initializer) {
      const lits = ts.isStringLiteral(n.initializer) ? [n.initializer.text] : ts.isJsxExpression(n.initializer) ? textLits(n.initializer.expression) : [];
      for (const s of lits) if (/[A-Za-z]{2,}/.test(s)) english.push(`${rel(f)}: ${n.name.getText()}="${s}"`);
    }
    if (ts.isJsxExpression(n) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) for (const s of textLits(n.expression)) if (/[A-Za-z]{2,}/.test(s)) english.push(`${rel(f)}: {"${s}"}`);
    if (ts.isCallExpression(n) && n.expression.getText() === "t" && n.arguments.length === 2) for (const k of textLits(n.arguments[1])) keysUsed.add(k);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
const ternaries = C1_PAGES.filter((f) => /\blocale\s*!?==?\s*["'](ar|en)["']|["'](ar|en)["']\s*!?==?\s*locale\b/.test(strip(read(f)))).map(rel);
check("C1 pages: no English typed outside t() — JSX text, user-facing props (title, description, submitLabel, label, message…), text in JSX expressions — and no inline locale ternaries",
  english.length === 0 && ternaries.length === 0, [...english, ...ternaries.map((f) => `${f}: locale ternary`)].join(" | "));
const C1_COPY = [
  "Client profile", "Vendor profile", "Save changes", "No invoices yet.", "Purchase Orders", "No purchase orders yet.", "SKU", "Stock", "Quantity on hand", "Reorder level",
  "New Vendor", "Add a vendor to order and receive against.", "Create Vendor", "New Product", "Add a product to your inventory catalog.", "Create Product", "Create Client",
  "Clients — Recycle Bin", "Vendors — Recycle Bin", "Products — Recycle Bin", "Deleted clients live here until restored or permanently deleted.",
  "Deleted vendors live here until restored or permanently deleted.", "Deleted products live here until restored or permanently deleted.", "Back to Clients", "Back to Vendors", "Back to Products",
];
const notMoved = C1_COPY.filter((k) => !keysUsed.has(k));
const noArabic = [...keysUsed].filter((k) => translate("ar", k) === k || !/[\u0600-\u06FF]/.test(translate("ar", k)));
check(`C1 pages: the ${C1_COPY.length} strings C1 moved go through t(), and every t() key on the 12 pages (${keysUsed.size}) has an Arabic entry`,
  notMoved.length === 0 && noArabic.length === 0, [...notMoved.map((k) => `not via t(): ${k}`), ...noArabic.map((k) => `no Arabic: ${k}`)].join(" | "));
const localeReads = C1_PAGES.filter((f) => now.data[f.replace("src/app/", "")]?.some((e) => e.endsWith(" const locale = await getLocale();"))).map(rel);
check("C1 pages: all 12 read the UI locale with getLocale() — New Vendor and New Product gained exactly that statement in C1 (their only data change; group 3)",
  localeReads.length === 12, C1_PAGES.map(rel).filter((f) => !localeReads.includes(f)).join(" "));

// Recycle bins: EmptyState
const binEmpty = C1_BINS.map((f) => jsxEls(f, "EmptyState").map((el) => el.attributes.properties.map((p) => p.getText()).join(" ")));
const binOld = C1_BINS.filter((f) => /py-12 text-center|from "@\/components\/ui\/card"/.test(strip(read(f)))).map(rel);
check("C1 recycle bins: an empty bin is one EmptyState with the same message (there was no action; none added); the Card py-12 recipe is gone",
  binEmpty.length === 3 && binEmpty.every((x) => same(x, ['message={t(locale, "Recycle Bin is empty.")}'])) && binOld.length === 0, `${JSON.stringify(binEmpty)} ${binOld.join(" ")}`);

// Direction and status
const physC1 = C1_PAGES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
check("C1 pages: no physical left / right (none in C0 either)", physC1.length === 0, physC1.join(" "));
// The StatusBadges of the 12 pages in C0 (6ad311b), attribute for attribute.
const C0_BADGES: Record<string, string[]> = {
  "clients/page.tsx": ['domain="active_flag" status={c.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "clients/[id]/page.tsx": ['domain="active_flag" status={client.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "purchasing/vendors/page.tsx": ['domain="active_flag" status={v.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "purchasing/vendors/[id]/page.tsx": ['domain="active_flag" status={vendor.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "inventory/products/page.tsx": ['domain="stock" status="low_stock" locale={locale}', 'domain="active_flag" status={p.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "inventory/products/[id]/page.tsx": ['domain="stock" status={low ? "low_stock" : "in_stock"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
};
const badgesNow = Object.fromEntries(C1_PAGES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
const TONE = /\b(?:text|bg|border)-(?:success|danger|warning|info|neutral|corrective|positive|negative)\b|^(?:success|danger|warning|info|neutral|corrective)$/;
const toneMaps = [
  ...C1_PAGES.flatMap((f) => findAll(parse(f), (n) => ts.isObjectLiteralExpression(n) && n.properties.some((p) => ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) && TONE.test(p.initializer.text))).map(() => `${rel(f)}: object map`)),
  ...C1_PAGES.flatMap((f) => findAll(parse(f), (n) => ts.isVariableDeclaration(n) && /tone|status(map|class|color|variant|style)|badge(map|class|color)|colou?r(map|s)\b/i.test(n.name.getText())).map((n) => `${rel(f)}: ${(n as ts.VariableDeclaration).name.getText()}`)),
];
check("C1 pages: status only through StatusBadge — the same 13 badges, domains and status values as C0 — and no local tone / status / colour map",
  same(badgesNow, C0_BADGES) && toneMaps.length === 0, `${JSON.stringify(badgesNow)} ${toneMaps.join(" ")}`);

// ---------- 10. C2 — HR archetypes ----------
section("10. C2 — HR archetypes");
/** Code with all whitespace removed: a structural comparison that ignores layout. */
const squash = (s: string) => s.replace(/\s+/g, "");
const isEl = (n: ts.Node): n is El => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n);
const inside = (root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, visit);
  return out;
};
const attrText = (el: El | undefined, name: string) => (el ? squash(attr(el, name)?.initializer?.getText() ?? "") : "");

// Page h1 and section headings
const perRoute = Object.entries(C2_ROUTES).map(([r, files]) => [r, files.reduce((n, f) => n + jsxEls(f, "PageHeader").length, 0)] as const);
const hrHand = C2_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check("C2: each of the 7 HR routes renders exactly one PageHeader (its page h1); no .main-head and no hand-written heading left in any HR file",
  perRoute.every(([, n]) => n === 1) && hrHand.length === 0 && C2_FILES.every((f) => !codeOnly(read(f)).includes("main-head")),
  `${perRoute.map(([r, n]) => `${r}:${n}`).join(" ")} ${hrHand.join(" ")}`);
const HEADER_SLOTS: [string, Record<"title" | "description" | "meta" | "actions", string>][] = [
  [`${HR}employees/employees-client.tsx`, { title: '{t(locale,"Employees")}', description: "", meta: "",
    actions: '{<Linkhref="/hr/employees/new"className="btnbtn-primary"style={{width:"auto",padding:"018px"}}><PlusclassName="size-3.5"/>{t(locale,"AddEmployee")}</Link>}' }],
  [`${HR}employees/new/page.tsx`, { title: '{t(locale,"NewEmployee")}', description: "", meta: "", actions: "" }],
  [`${HR}employees/[id]/page.tsx`, { title: '{<>{employee.name}<spanclassName="font-monotext-[13px]text-ink-muted">·{employee.employeeCode}</span></>}', description: "",
    meta: '{<StatusBadgedomain="employee"status={employee.status}locale={locale}/>}', actions: "" }],
  [`${HR}departments/page.tsx`, { title: '{t(locale,"Departments")}', description: "", meta: "", actions: "" }],
  [`${HR}attendance/page.tsx`, { title: '{`${t(locale,"Attendance")}—${t(locale,"Today")}`}', description: "", meta: '{<spanclassName="org-pill">{todayLabel}</span>}', actions: "" }],
  [`${HR}leave/leave-client.tsx`, { title: '{t(locale,"LeaveRequests")}', description: "", meta: "",
    actions: '{<ButtononClick={()=>setOpen(true)}disabled={employees.length===0}style={{padding:"018px"}}><PlusclassName="size-3.5"/>{t(locale,"RequestLeave")}</Button>}' }],
  [`${HR}payroll/page.tsx`, { title: '{`${t(locale,"Payroll")}—${monthLabel}`}', description: "", meta: '{<StatusBadgedomain="payroll_period"status={run?"processed":"draft"}locale={locale}/>}', actions: "" }],
];
const headerBad = HEADER_SLOTS.flatMap(([f, want]) => {
  const el = jsxEls(f, "PageHeader")[0];
  return (Object.keys(want) as (keyof typeof want)[]).filter((k) => attrText(el, k) !== want[k]).map((k) => `${rel(f)} ${k}: ${attrText(el, k)}`);
});
check("C2 headers: the title each route had (Employees, New Employee, the employee's name + monospace code, Departments, Attendance — Today, Leave Requests, Payroll — <month>); statuses and the date pill as meta, outside the h1; Add Employee and Request Leave as the actions, as they were",
  headerBad.length === 0, headerBad.slice(0, 4).join(" | "));
const sectionsIn = (f: string) => jsxEls(f, "SectionHeader").map((el) => `${attrText(el, "level")} ${attrText(el, "title")}`);
check("C2 section headings: Salary Structure (employee detail) and Past payroll runs (payroll) are SectionHeader h2s — h1 → h2, no skip",
  same(sectionsIn(`${HR}employees/[id]/page.tsx`), ['{2} {t(locale,"SalaryStructure")}']) && same(sectionsIn(`${HR}payroll/page.tsx`), ['{2} {t(locale,"Pastpayrollruns")}']),
  `${sectionsIn(`${HR}employees/[id]/page.tsx`)} | ${sectionsIn(`${HR}payroll/page.tsx`)}`);

// Department filter
const ECF = `${HR}employees/employees-client.tsx`;
const tabRow = findAll(parse(ECF), (n) => ts.isJsxElement(n) && attrText(n.openingElement, "className") === '"tab-row"')[0] as ts.JsxElement | undefined;
const filterEls = tabRow ? (inside(tabRow, (n) => isEl(n) && /^\{cn\("tab"/.test(attrText(n, "className"))) as El[]) : [];
// The keyboard path is the button's own (Tab, Enter, Space): nothing on a filter but its key, type,
// className, aria-pressed and onClick — no tabIndex, no key or pointer handler of its own.
const attrNames = (el: El) => el.attributes.properties.map((p) => (ts.isJsxAttribute(p) ? p.name.getText() : "{…}")).filter((n) => n !== "key").sort().join(" ");
const filterBad = filterEls.filter((el) => el.tagName.getText() !== "button" || attrText(el, "type") !== '"button"' || attrNames(el) !== "aria-pressed className onClick type" ||
  // aria-pressed is exactly the condition that shows the tab as active
  attrText(el, "className") !== `{cn("tab",${attrText(el, "aria-pressed").slice(1, -1)}&&"active")}`);
const clickables = C2_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && !!attr(n, "onClick") && /^[a-z]/.test(n.tagName.getText()) && n.tagName.getText() !== "button").map((n) => `${rel(f)}: <${(n as El).tagName.getText()} onClick>`));
check('C2 department filter: real <button type="button"> toggles on the .tab row (All departments + one per department), each aria-pressed exactly when shown active, still calling setActiveDept(null / d.id), with nothing else on them (no tabIndex, no key handler: the button\'s own keyboard behaviour); no clickable span or div left in any HR file',
  tabRow !== undefined && filterEls.length === 2 && filterBad.length === 0 && clickables.length === 0 &&
    attrText(filterEls[0], "onClick") === "{()=>setActiveDept(null)}" && attrText(filterEls[1], "onClick") === "{()=>setActiveDept(d.id)}",
  `${filterEls.length} filters; ${filterBad.map((el) => el.getText().slice(0, 80)).join(" | ")} ${clickables.join(" ")}`);

// KPI strips on StatRow
const statItems = (f: string) => jsxEls(f, "StatRow").map((el) => attrText(el, "items"));
const EMP_ITEMS =
  '{[{label:t(locale,"Headcount"),value:rows.length},{...statusStat(locale,"attendance","present",presentToday),label:t(locale,"Presenttoday")},' +
  'statusStat(locale,"attendance","on_leave",onLeaveToday),{label:t(locale,"Departments"),value:departments.length},]}';
const PAY_ITEMS =
  '{[{label:t(locale,"Employees"),value:lines.length},{label:t(locale,"Grosspay"),value:<Moneyamount={grossTotal}context="summary"/>},' +
  '{label:t(locale,"Deductions"),value:<Moneyamount={deductionsTotal}context="summary"/>},{label:t(locale,"Netpay"),value:<Moneyamount={netTotal}context="summary"/>},]}';
const empCode = codeOnly(read(ECF));
check("C2 Employees KPIs: one StatRow — Headcount and Departments plain; Present today and On Leave from statusStat (attendance present / on_leave: label, tone, colour from the registry); nothing coloured by hand",
  same(statItems(ECF), [EMP_ITEMS]) && !/statusTextClass\(|\bcolorClass\b|\btext-(success|info|warning|danger|corrective)\b|var\(--(success|info|accent-green)\)/.test(empCode),
  statItems(ECF).join(" "));
const PAYF = `${HR}payroll/page.tsx`;
check("C2 Payroll KPIs: one StatRow — Employees, Gross pay, Deductions, Net pay through <Money>; Net pay neutral (the decorative orange is gone, no invented tone)",
  same(statItems(PAYF), [PAY_ITEMS]) && !/brand-orange|\bcolorClass\b|\bcolor:/.test(codeOnly(read(PAYF))), statItems(PAYF).join(" "));
const legacyKpis = C2_FILES.filter((f) => /stat-row-2/.test(codeOnly(read(f)))).map(rel);
check("C2: no hand-built .stat-row-2 KPI cards left in any HR file", legacyKpis.length === 0, legacyKpis.join(" "));

// Empty states
const emptyOf = (f: string) => jsxEls(f, "EmptyState").map((el) => el.attributes.properties.map((p) => (ts.isJsxAttribute(p) ? p.name.getText() : "{…}")).sort().join(" ") + " " + attrText(el, "message"));
const EMPTY_WANT: Record<string, string[]> = {
  [`${HR}employees/employees-client.tsx`]: ['message {t(locale,"Noemployeesyet.Addyourfirstemployee.")}'],
  [`${HR}attendance/page.tsx`]: ['message {t(locale,"Noactiveemployeesyet—addemployeestostarttrackingattendance.")}'],
  [`${HR}leave/leave-client.tsx`]: ['message {t(locale,"Noleaverequestsyet.")}'],
  [`${HR}payroll/page.tsx`]: [`message {t(locale,"Noactiveemployeeswithasalarystructure—setoneoneachemployee'sprofilefirst.")}`],
  [`${HR}departments/page.tsx`]: ['action hint message {t(locale,"ManagedfromtheEmployeesscreen")}'],
};
const emptyBad = Object.entries(EMPTY_WANT).filter(([f, want]) => !same(emptyOf(f), want)).map(([f]) => `${rel(f)}: ${emptyOf(f)}`);
const deptEmpty = jsxEls(`${HR}departments/page.tsx`, "EmptyState")[0];
const deptAction = attrText(deptEmpty, "action");
const deptHint = attrText(deptEmpty, "hint");
const oldEmpty = C2_FILES.filter((f) => /rounded-2xl border border-line bg-surface shadow-elevated|padding: "52px 32px"/.test(codeOnly(read(f)))).map(rel);
check("C2 empty states: EmptyState in Employees, Attendance, Leave, Payroll and the Departments placeholder (message / hint / its two links as the action, targets unchanged); the custom shadowed recipe is gone",
  emptyBad.length === 0 && oldEmpty.length === 0 && /^\{<><Linkhref="\/hr\/employees"[\s\S]*<Linkhref="\/settings\/presets"[\s\S]*<\/>\}$/.test(deptAction) &&
    deptHint.includes('{t(locale,"Departmentsarethefiltertabsatthetop') && deptHint.includes('{t(locale,"DepartmentnamesaremanagedinPresetManagement'),
  [...emptyBad, ...oldEmpty, deptAction.slice(0, 60)].join(" | "));

// Dates
const ATTF = `${HR}attendance/page.tsx`;
check("C2 dates: Attendance's pill and Payroll's title month go through formatDisplayDate, from the day / period the page already selected (UTC midnight) — no second clock; no plain ar-SA or toLocaleDateString left on either",
  /const todayLabel = formatDisplayDate\(`\$\{today\}T00:00:00Z`, locale, "date"\);/.test(read(ATTF)) &&
    /const monthLabel = formatDisplayDate\(`\$\{periodYear\}-\$\{String\(periodMonth\)\.padStart\(2, "0"\)\}-01T00:00:00Z`, locale, "monthYear"\);/.test(read(PAYF)) &&
    [ATTF, PAYF].every((f) => !/toLocaleDateString|"ar-SA"/.test(codeOnly(read(f)))));

// Payroll layout and the two grid recipes
const PCF = `${HR}payroll/payroll-client.tsx`;
check("C2 payroll layout: PayrollClient no longer overrides .two-col (no inline display / gridTemplateColumns; only its 18px gap)",
  !/gridTemplateColumns|display: "grid"/.test(codeOnly(read(PCF))) && /<div className="two-col" style=\{\{ gap: 18 \}\}>/.test(read(PCF)));
const twoCol = cssRules(".two-col");
const acctGrid = cssRules(".acct-grid ").concat(cssRules(".acct-grid").filter((r) => / \.acct-grid \{|^[^:]+: \.acct-grid \{|> \.acct-grid \{/.test(r)));
check(".two-col on minmax(0, 1fr) tracks — two on desktop, one at ≤1100px (C2); .acct-grid's rules unchanged (280px 1fr; 1fr at ≤1100px) until C4",
  same(twoCol, [`${A}mockup-parity.css: .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }`, `${A}mockup-parity.css: @media (max-width: 1100px) > .two-col { grid-template-columns: minmax(0, 1fr); }`]) &&
    same([...new Set(acctGrid)], [`${A}mockup-parity.css: .acct-grid { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }`, `${A}mockup-parity.css: @media (max-width: 1100px) > .acct-grid { grid-template-columns: 1fr; }`]),
  [...twoCol, ...new Set(acctGrid)].join(" | "));

// D-6 reaches other pages through CSS and the component only
const D6_SOURCES: Record<string, string> = {
  "sales/quotations/quotations-list-client.tsx": "370f5b3d84d2c8a5",
  "sales/orders/orders-list-client.tsx": "c3f158801b7afc05",
  "sales/proforma/proforma-list-client.tsx": "b183ef64e1f23f75",
  "sales/invoices/invoices-list-client.tsx": "df9124a4c3c54d3c",
  "sales/delivery-challans/dc-list-client.tsx": "c837d62b68edfe78",
  "purchasing/orders/po-list-client.tsx": "5df02b6f339170af",
  "sales/credit-notes/cn-list-client.tsx": "32532d3b1813b82f",
  "purchasing/debit-notes/dn-list-client.tsx": "ccfc2e25e738df80",
  "projects/projects-list-client.tsx": "790f9f6b644e6f02",
  "projects/[id]/page.tsx": "1df7311426f32ad0",
  "projects/[id]/cost-control.tsx": "2b8a78d963ff9394",
  "settings/security/security-client.tsx": "97d7c211bd24e412",
};
const d6Drift = Object.entries(D6_SOURCES).filter(([f, hsh]) => !exists(A + f) || sha(A + f) !== hsh).map(([f]) => f);
check(`D-6 reaches every other KPI row through the CSS and the StatRow component only — the eight document lists, Projects (list, detail, cost control) and Security byte-identical to C1 (${Object.keys(D6_SOURCES).length} files)`,
  d6Drift.length === 0, d6Drift.join(" "));

// Status and direction
const C1_HR_BADGES: Record<string, string[]> = {
  "hr/employees/employees-client.tsx": ['domain="employee" status="inactive" locale={locale}', 'domain="attendance" status={r.todayStatus} locale={locale}'],
  "hr/employees/[id]/page.tsx": ['domain="employee" status={employee.status} locale={locale}'],
  "hr/attendance/page.tsx": ['domain="attendance" status={status} locale={locale}'],
  "hr/leave/leave-client.tsx": ['domain="leave" status={r.status} locale={locale}'],
  "hr/payroll/page.tsx": ['domain="payroll_period" status={run ? "processed" : "draft"} locale={locale}', 'domain="payroll_run" status={r.status} locale={locale}'],
};
const hrBadges = Object.fromEntries(C2_FILES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
const hrPhys = C2_FILES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
check("C2 HR files: status only through StatusBadge — the same 7 badges, domains and raw values as C1; no physical left / right",
  same(hrBadges, C1_HR_BADGES) && hrPhys.length === 0, `${JSON.stringify(hrBadges)} ${hrPhys.join(" ")}`);

console.log("\nGroups:");
for (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);
console.log(`\n${pass}/${pass + fail} checks`);
console.log(fail === 0 ? "PAGE ARCHETYPES VERIFICATION PASS" : "PAGE ARCHETYPES VERIFICATION FAIL");
process.exit(fail === 0 ? 0 : 1);
