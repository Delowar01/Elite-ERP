/**
 * Pre-DEV-UI-01.7 (P0.2): business dates are calendar dates — the same day in every time zone.
 *
 * ## The defects this guards
 *
 * 1. Credit Notes and Debit Notes counted "This Month" in the hydrated list component with
 *    `new Date(issueDate).getMonth()` against the client's own `new Date()`. A "YYYY-MM-01" issue
 *    date read through the runtime's calendar is still the previous month west of UTC, and a
 *    browser east of UTC turns the month hours before the server does: the server rendered one
 *    count, the browser another, and React rejected the page (#418).
 * 2. The Valid Till / Expected Delivery helpers parsed "YYYY-MM-DD" at LOCAL midnight, moved it
 *    with the local calendar and wrote it back out in UTC. Ahead of UTC (Riyadh, Dhaka) that lands
 *    one day early: 2026-10-09 + 30 days became 2026-11-07, and that is the date the quotation,
 *    sales order or purchase order saved.
 *
 * ## The contract (docs/ui/pre-dev-ui-01-7/business-date-determinism.md)
 *
 *  - "This Month" is the server's UTC month, handed to the client as a "YYYY-MM" key and compared
 *    with `issueDate.slice(0, 7)`. The hydrated component creates no Date for it.
 *  - "YYYY-MM-DD" + N days is calendar arithmetic: read at UTC midnight, moved with the UTC
 *    calendar (src/lib/date-only.ts). Never local midnight, never the local calendar.
 *
 * ## What this proves
 *
 *  1. Source, over code that can run in the browser — every "use client" module, plus the
 *     declarations of other modules that client code actually reaches through its imports
 *     (followed declaration by declaration, so a server-only function in a shared module is not
 *     mistaken for client code): no local-calendar getter or setter on a Date (getFullYear,
 *     getMonth, getDate, setDate, …; the TypeScript checker decides what is a Date), no date-time
 *     string parsed without a zone ("…T00:00:00"), no `new Date(y, m, d)`. A failure names file:line.
 *  2. The two list screens: the page passes the UTC month key, the client compares date strings
 *     against it and creates no Date.
 *  3. Behaviour: the `addDays` that the quotation form, the Valid Till dialog and the date-setting
 *     dialog actually use — followed through their imports — run in four child processes whose
 *     time zone is UTC, Asia/Riyadh, America/New_York and Asia/Dhaka: identical, exact results
 *     across month ends, year ends, leap days, zero and negative offsets, and the unchanged
 *     fallback for an unparseable date.
 *  4. The detector itself, on fixtures it must flag and fixtures it must leave alone.
 *
 * The browser half — server-rendered and hydrated "This Month" identical in four browser zones,
 * the dialogs' previews and the saved dates — is verify/verify-business-date-hydration.mjs.
 *
 * Run: npm run verify:business-dates
 */
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka"];

// [base, days, expected] — spelled out, not computed: the oracle owes nothing to Date.
const VECTORS: [string, number, string][] = [
  ["2026-10-09", 30, "2026-11-08"], // the reported case
  ["2026-10-09", 0, "2026-10-09"], // zero days is the same day
  ["2026-10-09", 1, "2026-10-10"],
  ["2026-01-31", 1, "2026-02-01"], // month end
  ["2026-01-31", 30, "2026-03-02"],
  ["2026-04-30", 1, "2026-05-01"],
  ["2026-12-31", 1, "2027-01-01"], // year end
  ["2026-12-25", 10, "2027-01-04"],
  ["2028-02-28", 1, "2028-02-29"], // leap year
  ["2028-02-29", 1, "2028-03-01"],
  ["2027-02-28", 1, "2027-03-01"], // not a leap year
  ["2028-02-29", 365, "2029-02-28"],
  ["2026-03-01", -1, "2026-02-28"], // negative days
  ["2026-01-01", -1, "2025-12-31"],
  ["2026-11-08", -30, "2026-10-09"],
  ["2026-03-07", 1, "2026-03-08"], // across New York's spring-forward
  ["2026-10-31", 2, "2026-11-02"], // across New York's fall-back
  ["2026-10-09", 366, "2027-10-10"],
  ["", 5, ""], // the existing fallback: an unparseable date comes back unchanged
  ["not-a-date", 3, "not-a-date"],
  ["2026-13-01", 1, "2026-13-01"],
];
// Where the business-date helper is consumed. The runtime check follows each one's own `addDays`
// binding through its imports, so it tests whatever implementation that file really uses.
const CONSUMERS = [
  ["Quotation Valid Till", "src/app/(app)/sales/quotations/quotation-form.tsx"],
  ["Valid Till dialog preview", "src/app/(app)/sales/_shared/validity-days-dialog.tsx"],
  ["date-setting dialog (sales order / purchase order Expected Delivery)", "src/app/(app)/sales/_shared/date-settings-dialog.tsx"],
] as const;
const LIST_SCREENS = [
  ["Credit Notes", "src/app/(app)/sales/credit-notes/page.tsx", "src/app/(app)/sales/credit-notes/cn-list-client.tsx"],
  ["Debit Notes", "src/app/(app)/purchasing/debit-notes/page.tsx", "src/app/(app)/purchasing/debit-notes/dn-list-client.tsx"],
] as const;

const LOCAL_CALENDAR = new Set([
  "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getSeconds", "getTimezoneOffset",
  "setFullYear", "setMonth", "setDate", "setHours", "setMinutes", "setSeconds",
]);

// ---------- module structure: directives, imports, top-level declarations ----------

type Request = { spec: string; names: string[] | "all" };
type Mod = {
  sf: ts.SourceFile;
  directives: string[];
  decls: Map<string, ts.Node>; // top-level name → the statement that declares it
  exported: Map<string, string>; // exported name → local name
  reexports: { spec: string; map: Map<string, string> | "all" }[]; // export { a as b } from / export * from
  importsByLocal: Map<string, { spec: string; name: string }>; // local binding → (module, exported name or "*")
  sideEffects: ts.Statement[]; // top-level statements that run on import
  requests: Request[]; // every runtime import, for the client graph
};

function parseMod(file: string, text: string): Mod {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const m: Mod = { sf, directives: [], decls: new Map(), exported: new Map(), reexports: [], importsByLocal: new Map(), sideEffects: [], requests: [] };
  let prologue = true;
  const isExported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
  for (const s of sf.statements) {
    if (prologue && ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) {
      m.directives.push(s.expression.text);
      continue;
    }
    prologue = false;
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const spec = s.moduleSpecifier.text;
      const c = s.importClause;
      if (!c) m.requests.push({ spec, names: [] });
      else if (!c.isTypeOnly) {
        const names: string[] = [];
        if (c.name) {
          m.importsByLocal.set(c.name.text, { spec, name: "default" });
          names.push("default");
        }
        const b = c.namedBindings;
        if (b && ts.isNamespaceImport(b)) {
          m.importsByLocal.set(b.name.text, { spec, name: "*" });
          m.requests.push({ spec, names: "all" });
        } else if (b) {
          for (const e of b.elements) {
            if (e.isTypeOnly) continue;
            m.importsByLocal.set(e.name.text, { spec, name: (e.propertyName ?? e.name).text });
            names.push((e.propertyName ?? e.name).text);
          }
        }
        if (names.length) m.requests.push({ spec, names });
      }
    } else if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      const c = s.exportClause;
      if (s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
        const spec = s.moduleSpecifier.text;
        if (!c || !ts.isNamedExports(c)) m.reexports.push({ spec, map: "all" });
        else m.reexports.push({ spec, map: new Map(c.elements.filter((e) => !e.isTypeOnly).map((e) => [e.name.text, (e.propertyName ?? e.name).text])) });
      } else if (c && ts.isNamedExports(c)) {
        for (const e of c.elements) if (!e.isTypeOnly) m.exported.set(e.name.text, (e.propertyName ?? e.name).text);
      }
    } else if (ts.isExportAssignment(s)) {
      m.decls.set("default", s);
      m.exported.set("default", "default");
    } else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) {
      const name = s.name?.text ?? "default";
      m.decls.set(name, s);
      if (isExported(s)) m.exported.set(isDefault(s) ? "default" : name, name);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        for (const id of bindingNames(d.name)) {
          m.decls.set(id, s);
          if (isExported(s)) m.exported.set(id, id);
        }
      }
    } else if (!ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s) && !ts.isModuleDeclaration(s)) {
      m.sideEffects.push(s);
    }
  }
  // Dynamic import() and require() anywhere in the file are client edges too.
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      m.requests.push({ spec: n.arguments[0].text, names: "all" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return m;
}

function bindingNames(n: ts.BindingName): string[] {
  if (ts.isIdentifier(n)) return [n.text];
  return n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));
}

/** Identifiers a node refers to — not property names (`a.b`'s b, `{ b: … }`'s b). */
function references(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n);
      if (!isPropName) out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
function resolve(known: Set<string>, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null; // a package: not this repository's code
  for (const ext of EXTENSIONS) if (known.has(base + ext)) return base + ext;
  return null;
}

/**
 * The code that can run in the browser: whole "use client" modules, and in any other module only
 * the declarations client code reaches (what it imports, what that refers to, across modules).
 * "use server" modules are never followed — the browser only gets a reference to call them.
 */
function clientReachable(mods: Map<string, Mod>) {
  const known = new Set(mods.keys());
  const whole = new Set<string>();
  const nodes = new Map<string, Set<ts.Node>>(); // shared module → reachable statements
  const done = new Set<string>();
  const queue: [string, string][] = []; // [module, exported name or "*"]
  const request = (from: string, spec: string, names: string[] | "all") => {
    const r = resolve(known, from, spec);
    if (!r) return;
    if (names === "all") queue.push([r, "*"]);
    else {
      queue.push([r, "<side-effects>"]);
      for (const n of names) queue.push([r, n]);
    }
  };
  const roots = [...mods].filter(([, m]) => m.directives.includes("use client")).map(([f]) => f);
  for (const f of roots) {
    whole.add(f);
    for (const q of mods.get(f)!.requests) request(f, q.spec, q.names);
  }
  const markLocal = (f: string, local: string) => {
    const m = mods.get(f)!;
    const decl = m.decls.get(local);
    if (decl) {
      const set = nodes.get(f) ?? nodes.set(f, new Set()).get(f)!;
      if (set.has(decl)) return;
      set.add(decl);
      for (const id of references(decl)) {
        if (id !== local && m.decls.has(id)) markLocal(f, id);
        const imp = m.importsByLocal.get(id);
        if (imp) request(f, imp.spec, imp.name === "*" ? "all" : [imp.name]);
      }
    } else {
      const imp = m.importsByLocal.get(local); // `import { x } …; export { x }`
      if (imp) request(f, imp.spec, imp.name === "*" ? "all" : [imp.name]);
    }
  };
  while (queue.length) {
    const [f, name] = queue.pop()!;
    const key = `${f}\0${name}`;
    if (done.has(key)) continue;
    done.add(key);
    const m = mods.get(f)!;
    if (whole.has(f) || m.directives.includes("use server") || m.directives.includes("use client")) continue;
    const set = nodes.get(f) ?? nodes.set(f, new Set()).get(f)!;
    for (const s of m.sideEffects) {
      if (set.has(s)) continue;
      set.add(s);
      for (const id of references(s)) if (m.decls.has(id)) markLocal(f, id);
    }
    if (name === "<side-effects>") continue;
    if (name === "*") {
      for (const local of m.decls.keys()) markLocal(f, local);
      for (const r of m.reexports) request(f, r.spec, "all");
      continue;
    }
    const local = m.exported.get(name);
    if (local !== undefined) {
      markLocal(f, local);
      continue;
    }
    for (const r of m.reexports) {
      if (r.map === "all") request(f, r.spec, [name]);
      else if (r.map.has(name)) request(f, r.spec, [r.map.get(name)!]);
    }
  }
  return { roots, whole, nodes };
}

type Finding = { file: string; line: number; rule: "calendar" | "parse" | "construct"; what: string };

function analyse(root: string, texts: Map<string, string>) {
  const mods = new Map([...texts].map(([f, t]) => [f, parseMod(f, t)]));
  const reach = clientReachable(mods);

  // The checker answers "is this receiver a Date?".
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const options: ts.CompilerOptions = { ...config!.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
  const abs = (f: string) => path.join(root, f);
  const byAbs = new Map([...texts].map(([f, t]) => [abs(f), t]));
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (p) => byAbs.has(p) || fileExists.call(host, p);
  host.readFile = (p) => byAbs.get(p) ?? readFile.call(host, p);
  host.getSourceFile = (p, lang, ...rest) => (byAbs.has(p) ? ts.createSourceFile(p, byAbs.get(p)!, lang, true) : getSourceFile.call(host, p, lang, ...rest));
  const scanned = [...reach.whole, ...reach.nodes.keys()];
  const program = ts.createProgram({ rootNames: scanned.map(abs), options, host });
  const checker = program.getTypeChecker();
  const isDate = (e: ts.Expression) => {
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Date") return true;
    const t = checker.getTypeAtLocation(e);
    return (t.isUnion() ? t.types : [t]).some((p) => checker.getApparentType(p).getSymbol()?.getName() === "Date");
  };
  // The literal text a date argument is built from: "…" + x, `${x}T…`, "…".concat(…).
  const literalText = (e: ts.Expression): string => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => `\u0000${s.literal.text}`).join("");
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return literalText(e.left) + literalText(e.right);
    if (ts.isParenthesizedExpression(e)) return literalText(e.expression);
    return "\u0000";
  };
  const LOCAL_DATETIME = /T\d{2}:\d{2}/;
  const ZONED = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/;

  const findings: Finding[] = [];
  for (const f of scanned) {
    const sf = program.getSourceFile(abs(f))!;
    const only = reach.whole.has(f) ? null : reach.nodes.get(f)!;
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LOCAL_CALENDAR.has(n.expression.name.text) && isDate(n.expression.expression)) {
        const name = n.expression.name.text;
        findings.push({ file: f, line: line(n), rule: "calendar", what: `Date#${name}() reads or moves the runtime's own calendar — use the UTC form (${name.replace(/^(get|set)/, "$1UTC")}) on a UTC-midnight date, or compare "YYYY-MM-DD" text` });
      }
      const isDateCtor = ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date";
      const isDateParse = ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.getText() === "Date.parse";
      const args = isDateCtor || isDateParse ? ((n as ts.NewExpression | ts.CallExpression).arguments ?? []) : [];
      if (args.length === 1) {
        const text = literalText(args[0]);
        if (LOCAL_DATETIME.test(text) && !ZONED.test(text)) {
          findings.push({ file: f, line: line(n), rule: "parse", what: `${args[0].getText().slice(0, 50)} is a date-time with no zone, parsed at the runtime's local time — write the zone ("T00:00:00Z")` });
        }
      }
      if (isDateCtor && args.length >= 2) {
        findings.push({ file: f, line: line(n), rule: "construct", what: "new Date(year, month, …) builds a LOCAL date — use new Date(Date.UTC(…))" });
      }
      ts.forEachChild(n, visit);
    };
    if (only) for (const s of sf.statements) {
      // The program's source file is a fresh parse: match statements by position.
      if ([...only].some((o) => o.pos === s.pos && o.end === s.end)) visit(s);
    }
    else visit(sf);
  }
  return { mods, reach, findings };
}

// ---------- the addDays a consumer really uses, followed through its imports ----------

function resolveHelper(mods: Map<string, Mod>, file: string, name: string, seen = new Set<string>()): { file: string; node: ts.Node } | null {
  const key = `${file}\0${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const m = mods.get(file);
  if (!m) return null;
  const decl = m.decls.get(name);
  if (decl) return { file, node: decl };
  const imp = m.importsByLocal.get(name);
  if (imp && imp.name !== "*") {
    const r = resolve(new Set(mods.keys()), file, imp.spec);
    if (!r) return null;
    const target = mods.get(r)!;
    const local = target.exported.get(imp.name);
    if (local !== undefined) return resolveHelper(mods, r, local, seen);
    for (const re of target.reexports) {
      const rr = resolve(new Set(mods.keys()), r, re.spec);
      const nm = re.map === "all" ? imp.name : re.map.get(imp.name);
      if (rr && nm) {
        const hit = resolveHelper(mods, rr, nm, seen);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** The helper and every top-level declaration of its own module it needs, as runnable JavaScript. */
function sandboxSource(mods: Map<string, Mod>, file: string, node: ts.Node): { js: string; problem?: string } {
  const m = mods.get(file)!;
  const need = new Set<ts.Node>([node]);
  const queue = [node];
  while (queue.length) {
    for (const id of references(queue.pop()!)) {
      const d = m.decls.get(id);
      if (d && !need.has(d)) {
        need.add(d);
        queue.push(d);
      }
      if (m.importsByLocal.has(id) && !m.decls.has(id)) return { js: "", problem: `it depends on the import ${id}` };
    }
  }
  const text = m.sf.statements.filter((s) => need.has(s)).map((s) => s.getText(m.sf)).join("\n");
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return { js: js.replace(/^export\s+(default\s+)?/gm, "") };
}

// ---------- the run ----------

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}
const at = (x: { file: string; line: number }) => `${x.file}:${x.line}`;

console.log("Business dates — calendar dates, the same day in every time zone\n");

// ---------- 1. source ----------
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.posix.join(dir, d.name)) : /\.(tsx?|jsx?|mts|mjs)$/.test(d.name) ? [path.posix.join(dir, d.name)] : [],
  );
const files = walk("src");
const texts = new Map(files.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]));
const real = analyse(ROOT, texts);
const sharedFiles = [...real.reach.nodes.keys()];
check("source files were found (the scan is not silently empty)", files.length > 400, `got ${files.length}`);
check(
  `client-side code is ${real.reach.roots.length} "use client" modules plus the reachable declarations of ${sharedFiles.length} modules they import`,
  real.reach.roots.length > 100 && sharedFiles.length > 20,
);
const dashboardRange = real.reach.nodes.get("src/lib/dashboard-range.ts");
check(
  "the reach is declaration by declaration: of src/lib/dashboard-range.ts only what the client toolbar imports is client code (its server-only range helpers are not)",
  !!dashboardRange && [...dashboardRange].every((s) => !/function (resolveRange|rangeBuckets)|const (fmt|addDays) =/.test(s.getText())),
  dashboardRange ? [...dashboardRange].map((s) => s.getText().slice(0, 50)).join(" | ") : "module not reached at all",
);
const list = (rule: Finding["rule"]) => real.findings.filter((x) => x.rule === rule).map((x) => `${at(x)}  ${x.what}`);
check("no local-calendar getter or setter on a Date in client-side code (getFullYear, getMonth, getDate, setDate, …)", list("calendar").length === 0, list("calendar").join("\n      "));
check('no date-time string parsed without a zone in client-side code ("…T00:00:00")', list("parse").length === 0, list("parse").join("\n      "));
check("no new Date(year, month, …) local construction in client-side code", list("construct").length === 0, list("construct").join("\n      "));

// ---------- 2. the two list screens: one UTC month key, from the server ----------
for (const [label, page, client] of LIST_SCREENS) {
  const p = texts.get(page) ?? "";
  const c = texts.get(client) ?? "";
  check(
    `${label}: the page hands the client the server's UTC month — currentMonthKey from new Date().toISOString().slice(0, 7)`,
    /new Date\(\)\.toISOString\(\)\.slice\(0, 7\)/.test(p) && /currentMonthKey=\{/.test(p),
    page,
  );
  check(
    `${label}: "This Month" compares issueDate.slice(0, 7) with that key, and the hydrated component creates no Date`,
    /\.issueDate\.slice\(0, 7\) === currentMonthKey/.test(c) && !/new Date\b|Date\.now\(/.test(c),
    client,
  );
}

// ---------- 3. behaviour: the addDays each consumer really uses, in four time zones ----------
const helpers = CONSUMERS.map(([label, file]) => {
  const hit = resolveHelper(real.mods, file, "addDays");
  const src = hit ? sandboxSource(real.mods, hit.file, hit.node) : { js: "", problem: "no addDays binding found" };
  return { label, file, via: hit?.file ?? "—", line: hit ? real.mods.get(hit.file)!.sf.getLineAndCharacterOfPosition(hit.node.getStart()).line + 1 : 0, ...src };
});
for (const h of helpers) check(`${h.label} (${h.file}) uses addDays from ${h.via}${h.line ? `:${h.line}` : ""}, which runs standalone`, !h.problem, h.problem);
const CHILD = `
const helpers = JSON.parse(process.env.BD_HELPERS);
const vectors = JSON.parse(process.env.BD_VECTORS);
const out = {};
for (const [label, js] of Object.entries(helpers)) {
  const addDays = new Function(js + "\\nreturn addDays;")();
  for (const [base, days] of vectors) out[label + " | " + JSON.stringify(base) + " + " + days] = addDays(base, days);
}
console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }));
`;
const runnable = Object.fromEntries(helpers.filter((h) => !h.problem).map((h) => [h.label, h.js]));
const runs = ZONES.map((zone) => {
  const r = spawnSync(process.execPath, ["-e", CHILD], {
    encoding: "utf8",
    env: { ...process.env, TZ: zone, BD_HELPERS: JSON.stringify(runnable), BD_VECTORS: JSON.stringify(VECTORS) },
  });
  const lineOut = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (r.status !== 0 || !lineOut) console.log(r.stdout, r.stderr);
  return lineOut ? (JSON.parse(lineOut) as { zone: string; out: Record<string, string> }) : null;
});
check(`the helpers ran in all four time zones (${Object.keys(runnable).length} consumers × ${VECTORS.length} cases)`, runs.every(Boolean) && Object.keys(runnable).length === CONSUMERS.length);
if (runs.every(Boolean)) {
  const ok = runs as { zone: string; out: Record<string, string> }[];
  // Without this the comparisons below could be vacuous: prove each zone was really in effect.
  ZONES.forEach((z, i) => check(`time zone ${z} was in effect in its child process`, ok[i].zone === z, `got ${ok[i].zone}`));
  for (const [label] of CONSUMERS) {
    const keys = Object.keys(ok[0].out).filter((k) => k.startsWith(`${label} | `));
    const diverge = keys.filter((k) => ok.some((r) => r.out[k] !== ok[0].out[k]));
    check(`${label}: identical results in every zone (UTC = Asia/Riyadh = America/New_York = Asia/Dhaka)`, keys.length === VECTORS.length && diverge.length === 0,
      diverge.slice(0, 6).map((k) => `${k}: ${ok.map((r, i) => `${ZONES[i]} "${r.out[k]}"`).join(" · ")}`).join("\n      "));
    const wrong = VECTORS.flatMap(([base, days, want]) => {
      const k = `${label} | ${JSON.stringify(base)} + ${days}`;
      return ok.filter((r) => r.out[k] !== want).map((r) => `${JSON.stringify(base)} + ${days} → ${r.zone} "${r.out[k]}", expected "${want}"`);
    });
    check(`${label}: every case is the calendar answer (month end, year end, leap day, zero, negative, fallback)`, wrong.length === 0, wrong.slice(0, 8).join("\n      "));
  }
  for (const [label] of CONSUMERS) {
    const got = ok.map((r) => r.out[`${label} | "2026-10-09" + 30`]);
    check(`${label}: 2026-10-09 + 30 days → "2026-11-08" in every zone`, got.every((g) => g === "2026-11-08"), got.map((g, i) => `${ZONES[i]} "${g}"`).join(" · "));
  }
}

// ---------- 4. the detector: what it must flag, and what it must leave alone ----------
const FIXTURES: [string, string, number, string][] = [
  ["src/fx/month-count.tsx", `"use client";\nexport function Count({ rows }: { rows: { issueDate: string }[] }) {\n  const now = new Date();\n  return rows.filter((r) => { const d = new Date(r.issueDate); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;\n}`, 4, "client month bucketing with getFullYear / getMonth"],
  ["src/fx/month-key.tsx", `"use client";\nexport function Count({ rows, currentMonthKey }: { rows: { issueDate: string }[]; currentMonthKey: string }) {\n  return rows.filter((r) => r.issueDate.slice(0, 7) === currentMonthKey).length;\n}`, 0, "client month bucketing by a server key passes"],
  ["src/fx/local-add.tsx", `"use client";\nexport function addDays(isoDate: string, days: number) {\n  const d = new Date(isoDate + "T00:00:00");\n  d.setDate(d.getDate() + days);\n  return d.toISOString().slice(0, 10);\n}`, 3, "local-midnight parse + setDate + getDate"],
  ["src/fx/utc-add.tsx", `"use client";\nexport function addDays(isoDate: string, days: number) {\n  const d = new Date(\`\${isoDate}T00:00:00Z\`);\n  d.setUTCDate(d.getUTCDate() + days);\n  return d.toISOString().slice(0, 10);\n}`, 0, "UTC-midnight parse + setUTCDate passes"],
  ["src/fx/template-local.tsx", `"use client";\nexport const at = (d: string) => new Date(\`\${d}T09:30\`).getTime();`, 1, "a template date-time with no zone"],
  ["src/fx/offset.tsx", `"use client";\nexport const at = (d: string) => new Date(\`\${d}T00:00:00+03:00\`).getTime();`, 0, "a date-time with an explicit offset passes"],
  ["src/fx/construct.tsx", `"use client";\nexport const first = (y: number, m: number) => new Date(y, m, 1).toISOString();`, 1, "new Date(year, month, day)"],
  ["src/fx/utc-construct.tsx", `"use client";\nexport const first = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString();`, 0, "new Date(Date.UTC(…)) passes"],
  ["src/fx/elapsed.tsx", `"use client";\nexport const ago = (iso: string) => Date.now() - new Date(iso).getTime();`, 0, "timestamp arithmetic (getTime) is not a calendar"],
  ["src/fx/uses-shared.tsx", `"use client";\nimport { shift } from "@/fx/shared";\nexport const S = shift;`, 0, "a client module importing a shared helper…"],
  ["src/fx/shared.ts", `function inner(d: Date) { d.setDate(d.getDate() + 1); return d; }\nexport function shift(iso: string) { return inner(new Date(iso)).toISOString(); }\nexport function serverOnly(iso: string) { return new Date(iso).getMonth(); }`, 2, "…flags what it reaches (shift → inner), not the server-only export beside it"],
  ["src/fx/uses-reexport.tsx", `"use client";\nimport { deep } from "@/fx/barrel";\nexport const D = deep;`, 0, "a client import through a re-export…"],
  ["src/fx/barrel.ts", `export { deep } from "./deep";`, 0, "(barrel)"],
  ["src/fx/deep.ts", `export const deep = (iso: string) => new Date(iso).getFullYear();`, 1, "…reaches the module behind it"],
  ["src/fx/server-page.tsx", `export default function Page() { return new Date().getMonth(); }`, 0, "a server component is left alone (rendered once)"],
  ["src/fx/uses-action.tsx", `"use client";\nimport { act } from "./actions";\nexport const A = act;`, 0, "a client module calling a server action…"],
  ["src/fx/actions.ts", `"use server";\nexport async function act() { return new Date().getMonth(); }`, 0, '…leaves the "use server" module alone'],
];
const fx = analyse(path.join(ROOT, ".verify-business-dates-fixtures"), new Map(FIXTURES.map(([f, t]) => [f, t])));
for (const [file, , want, label] of FIXTURES) {
  const got = fx.findings.filter((x) => x.file === file);
  check(`detector: ${label} → ${want} finding${want === 1 ? "" : "s"}`, got.length === want, `got ${got.length}: ${got.map((x) => `${x.line} ${x.what.slice(0, 60)}`).join("; ")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
