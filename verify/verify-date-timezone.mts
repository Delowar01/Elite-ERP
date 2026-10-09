/**
 * Pre-DEV-UI-01.7 (P0.1): a date or time that a client component renders reads the same on the
 * server and in every browser, whatever time zone either one runs in.
 *
 * ## The defect this guards
 *
 * `toLocaleString("en-US", { month, day, hour, minute })` with no `timeZone` formats in the zone of
 * whichever runtime calls it. A client component renders twice — on the server, then again in the
 * browser to hydrate — so the Security Center wrote "Oct 9, 12:22 PM" on the server (UTC) and a
 * browser in Riyadh computed "Oct 9, 03:22 PM". React refused that text (error #418) and re-rendered
 * the page. The Compliance Center's consent dates failed the same way across midnight: a consent
 * recorded at 23:30 UTC on 8 October read "Oct 8, 2026" on the server and "Oct 9, 2026" in Riyadh,
 * and one recorded at 00:30 UTC on 9 October read "Oct 8, 2026" in New York.
 *
 * ## The contract (docs/ui/pre-dev-ui-01-7/timezone-determinism.md)
 *
 * Client-side code — every "use client" module and every module one imports — formats a date only
 * with `timeZone: "UTC"`, written as that literal. Never the browser's zone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`), the host's (`process.env.TZ`), another
 * zone or a variable: anything that can differ between the server and the browser re-opens the
 * defect. Server components are deliberately outside this rule — they format once, on the server,
 * and the browser receives finished text, so there is no second render to disagree with.
 *
 * ## What this proves
 *
 *  1. Source: every date formatter in client-side code — toLocaleString on a Date,
 *     toLocaleDateString, toLocaleTimeString, Intl.DateTimeFormat — passes an options object literal
 *     whose timeZone is "UTC", and nothing there calls Date#toString / toDateString / toTimeString or
 *     puts a Date into a string (none of those can name a zone). Whether a receiver is a Date comes
 *     from the TypeScript checker, so number formatting (P0's DISPLAY_NUMBER_LOCALE money) is never
 *     mistaken for a date. A failure names the file and line.
 *  2. Behaviour: each of those formatters, with its own locale and options, run in four child
 *     processes whose time zone is UTC, Asia/Riyadh, America/New_York and Asia/Dhaka, returns
 *     identical strings for instants either side of midnight UTC — the strings a UTC server already
 *     wrote, so English readers see no change.
 *  3. The detector itself, on fixtures it must flag and fixtures it must leave alone.
 *
 * The browser half — server-rendered and hydrated text identical in four browser zones, no #418 —
 * is verify/verify-settings-timezone-hydration.mjs (browser tier).
 *
 * Run: npm run verify:date-timezone
 */
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka"];
// Either side of midnight UTC (the calendar day differs ahead of UTC and behind it), midday, and
// the morning New York changes to daylight saving time.
const INSTANTS = ["2026-10-08T23:30:00Z", "2026-10-09T00:30:00Z", "2026-10-09T12:22:00Z", "2026-03-08T06:45:00Z"];

// Server-side functions that live in a module a client component imports for something else. Each
// entry is re-proved on every run: the function is not imported by any client-side module and not
// called from anywhere else in its own module. An entry with nothing left to excuse fails as stale.
const SERVER_ONLY: { file: string; fn: string; why: string }[] = [
  {
    file: "src/lib/dashboard-range.ts",
    fn: "rangeBuckets",
    why: "dashboard chart bucket labels, built on the server by dashboard/_shared/queries.ts and sent as text; dashboard-toolbar.tsx imports only the range constants",
  },
];

type Method = "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString" | "Intl.DateTimeFormat";
type Sample = { method: Method; locale: unknown; options: unknown };
type Finding = { file: string; line: number; fn: string | null; rule: "missing" | "value" | "nozone"; what: string };
type Site = { file: string; line: number; fn: string | null; method: Method; sample: Sample | null };

// ---------- the analysis: client-side modules, their date formatters, and what each one names ----------

const directives = (sf: ts.SourceFile) => {
  const out: string[] = [];
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) out.push(s.expression.text);
    else break;
  }
  return out;
};

/** Runtime imports only: `import type`, all-type named imports and `export type` carry no code. */
function imports(sf: ts.SourceFile): { spec: string; names: string[] | "all" }[] {
  const out: { spec: string; names: string[] | "all" }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      if (!c) out.push({ spec: n.moduleSpecifier.text, names: [] });
      else if (!c.isTypeOnly) {
        const b = c.namedBindings;
        if (c.name || (b && ts.isNamespaceImport(b))) out.push({ spec: n.moduleSpecifier.text, names: "all" });
        else if (b && ts.isNamedImports(b)) {
          const names = b.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
          if (names.length) out.push({ spec: n.moduleSpecifier.text, names });
        }
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
      const c = n.exportClause;
      if (!c || !ts.isNamedExports(c)) out.push({ spec: n.moduleSpecifier.text, names: "all" });
      else out.push({ spec: n.moduleSpecifier.text, names: c.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text) });
    } else if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      out.push({ spec: n.arguments[0].text, names: "all" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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

const DATE_OPTION_KEYS = new Set([
  "year", "month", "day", "weekday", "era", "hour", "minute", "second", "fractionalSecondDigits",
  "dayPeriod", "timeZoneName", "dateStyle", "timeStyle", "hour12", "hourCycle", "timeZone",
]);
const propName = (n: ts.PropertyName | undefined) => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null);
const NOT_LITERAL = Symbol("not literal");
function literal(n: ts.Expression): unknown {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) return literal(n.expression);
  if (ts.isArrayLiteralExpression(n)) {
    const items = n.elements.map((e) => literal(e));
    return items.includes(NOT_LITERAL) ? NOT_LITERAL : items;
  }
  if (ts.isObjectLiteralExpression(n)) {
    const out: Record<string, unknown> = {};
    for (const p of n.properties) {
      const k = ts.isPropertyAssignment(p) ? propName(p.name) : null;
      const v = k === null ? NOT_LITERAL : literal((p as ts.PropertyAssignment).initializer);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out[k as string] = v;
    }
    return out;
  }
  return NOT_LITERAL;
}

/** null when the options name the zone as the literal "UTC"; otherwise what is wrong. */
function zoneProblem(opts: ts.Expression | undefined): { rule: "missing" | "value"; what: string } | null {
  if (!opts) return { rule: "missing", what: "no options, so no timeZone: the runtime's own zone applies" };
  if (!ts.isObjectLiteralExpression(opts)) return { rule: "value", what: `options are ${opts.getText().slice(0, 60)}, not an object literal: the zone cannot be read` };
  const at = opts.properties.findIndex((p) => propName(p.name) === "timeZone");
  if (at < 0) return { rule: "missing", what: "no timeZone: the runtime's own zone applies (the host's on the server, the user's in the browser)" };
  if (opts.properties.slice(at + 1).some(ts.isSpreadAssignment)) return { rule: "value", what: "an object spread after timeZone can replace it" };
  const p = opts.properties[at];
  if (!ts.isPropertyAssignment(p)) return { rule: "value", what: "timeZone is not written as a literal" };
  const v = p.initializer;
  if ((ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && v.text === "UTC") return null;
  return { rule: "value", what: `timeZone is ${v.getText().slice(0, 70)}, not the literal "UTC"` };
}

function topLevelName(n: ts.Node): string | null {
  let cur = n;
  while (cur.parent && !ts.isSourceFile(cur.parent)) cur = cur.parent;
  if (ts.isFunctionDeclaration(cur)) return cur.name?.text ?? null;
  if (ts.isVariableStatement(cur)) {
    const d = cur.declarationList.declarations[0];
    return d && ts.isIdentifier(d.name) ? d.name.text : null;
  }
  return null;
}

/**
 * `texts` maps repository-relative paths ("src/…") to source text; `root` anchors them on disk (or
 * in a virtual directory, for the fixtures). Library and package types still come from disk.
 */
function analyse(root: string, texts: Map<string, string>) {
  const known = new Set(texts.keys());
  const parsed = new Map<string, ts.SourceFile>();
  for (const [f, text] of texts) parsed.set(f, ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, /x$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS));

  // Client-side code: every "use client" module and, transitively, what it imports. A "use server"
  // module reached that way is not followed — the browser only gets a reference to call it.
  const roots = [...parsed.keys()].filter((f) => directives(parsed.get(f)!).includes("use client"));
  const graph = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop()!;
    if (graph.has(f) || directives(parsed.get(f)!).includes("use server")) continue;
    graph.add(f);
    for (const { spec } of imports(parsed.get(f)!)) {
      const r = resolve(known, f, spec);
      if (r && !graph.has(r)) queue.push(r);
    }
  }

  // The checker answers "is this a Date?" for receivers whose spelling does not say.
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const options: ts.CompilerOptions = { ...config!.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
  const abs = (f: string) => path.join(root, f);
  const byAbs = new Map([...texts].map(([f, t]) => [abs(f), t]));
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (p) => byAbs.has(p) || fileExists.call(host, p);
  host.readFile = (p) => byAbs.get(p) ?? readFile.call(host, p);
  host.getSourceFile = (p, lang, ...rest) => (byAbs.has(p) ? ts.createSourceFile(p, byAbs.get(p)!, lang, true) : getSourceFile.call(host, p, lang, ...rest));
  const program = ts.createProgram({ rootNames: [...graph].map(abs), options, host });
  const checker = program.getTypeChecker();
  const isDate = (e: ts.Expression) => {
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Date") return true;
    const t = checker.getTypeAtLocation(e);
    return (t.isUnion() ? t.types : [t]).some((p) => checker.getApparentType(p).getSymbol()?.getName() === "Date");
  };
  const isIntl = (e: ts.Expression) => e.getText().replace(/^globalThis\./, "") === "Intl";

  const sites: Site[] = [];
  const findings: Finding[] = [];
  for (const f of graph) {
    const sf = program.getSourceFile(abs(f))!;
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const formatter = (n: ts.Node, method: Method, locale: ts.Expression | undefined, opts: ts.Expression | undefined) => {
      const loc = locale ? literal(locale) : NOT_LITERAL;
      const opt = opts ? literal(opts) : {};
      const sample = loc !== NOT_LITERAL && opt !== NOT_LITERAL ? { method, locale: loc, options: opt } : null;
      sites.push({ file: f, line: line(n), fn: topLevelName(n), method, sample });
      let problem = zoneProblem(opts);
      // Intl.DateTimeFormat().resolvedOptions() is how code reads the runtime's own zone: on the
      // server that is the host's, in the browser the user's — the two renders disagree.
      if (problem && ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "resolvedOptions") {
        problem = { rule: "value", what: "Intl.DateTimeFormat().resolvedOptions() reads the runtime's own zone (the host's on the server, the user's in the browser)" };
      }
      if (problem) findings.push({ file: f, line: line(n), fn: topLevelName(n), ...problem });
    };
    const nozone = (n: ts.Node, what: string) => findings.push({ file: f, line: line(n), fn: topLevelName(n), rule: "nozone", what });
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        const recv = n.expression.expression;
        const [a0, a1] = n.arguments;
        if (name === "toLocaleDateString" || name === "toLocaleTimeString") formatter(n, name, a0, a1);
        else if (name === "toLocaleString") {
          const dateOptions = !!a1 && ts.isObjectLiteralExpression(a1) && a1.properties.some((p) => DATE_OPTION_KEYS.has(propName(p.name) ?? ""));
          if (dateOptions || isDate(recv)) formatter(n, name, a0, a1);
        } else if (name === "toDateString" || name === "toTimeString") nozone(n, `Date#${name}() always uses the runtime's own zone`);
        else if (name === "toString" && n.arguments.length === 0 && isDate(recv)) nozone(n, "Date#toString() always uses the runtime's own zone");
        else if (name === "DateTimeFormat" && isIntl(recv)) formatter(n, "Intl.DateTimeFormat", a0, a1);
      } else if (ts.isNewExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "DateTimeFormat" && isIntl(n.expression.expression)) {
        formatter(n, "Intl.DateTimeFormat", n.arguments?.[0], n.arguments?.[1]);
      } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "String" && n.arguments[0] && isDate(n.arguments[0])) {
        nozone(n, "String(date) is Date#toString(), which always uses the runtime's own zone");
      } else if (ts.isTemplateExpression(n)) {
        for (const span of n.templateSpans) if (isDate(span.expression)) nozone(span.expression, "a Date in a template string is Date#toString(), which always uses the runtime's own zone");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Server-only exceptions, re-proved here rather than trusted.
  const exceptions = SERVER_ONLY.map((e) => {
    const excused = findings.filter((x) => x.file === e.file && x.fn === e.fn);
    const sf = parsed.get(e.file);
    const problems: string[] = [];
    if (!sf || !graph.has(e.file)) problems.push("the module is no longer reachable from a client component — remove the exception");
    else {
      if (directives(sf).includes("use client")) problems.push(`${e.file} is itself a client module`);
      if (excused.length === 0) problems.push(`nothing left to excuse in ${e.fn} — remove the exception`);
      for (const g of graph) {
        for (const imp of imports(parsed.get(g)!)) {
          if (resolve(known, g, imp.spec) !== e.file) continue;
          if (imp.names === "all" || imp.names.includes(e.fn)) problems.push(`${g} imports ${imp.names === "all" ? "the whole module" : e.fn}`);
        }
      }
      let uses = 0;
      const count = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n.text === e.fn && !(ts.isFunctionDeclaration(n.parent) && n.parent.name === n)) uses++;
        ts.forEachChild(n, count);
      };
      count(sf);
      if (uses > 0) problems.push(`${e.fn} is called inside ${e.file}, where a client import could reach it`);
    }
    return { ...e, excused, problems };
  });
  const excusedSet = new Set(exceptions.filter((e) => e.problems.length === 0).flatMap((e) => e.excused));
  return { roots, graph, sites, findings: findings.filter((x) => !excusedSet.has(x)), exceptions };
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

console.log("Date time zone — client-rendered dates read the same on the server and in every browser\n");

// ---------- 1. source ----------
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.posix.join(dir, d.name)) : /\.(tsx?|jsx?|mts|mjs)$/.test(d.name) ? [path.posix.join(dir, d.name)] : [],
  );
const files = walk("src");
const real = analyse(ROOT, new Map(files.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")])));
const shared = real.graph.size - real.roots.length;
check("source files were found (the scan is not silently empty)", files.length > 400, `got ${files.length}`);
check(
  `client-side code is ${real.roots.length} "use client" modules plus the ${shared} modules they import ("use server" actions are not followed)`,
  real.roots.length > 100 && shared > 20,
);
console.log(`\n  date formatters in client-side code:\n${real.sites.map((s) => `    ${at(s)}  ${s.method}${s.fn ? `  (in ${s.fn})` : ""}`).join("\n")}\n`);
check("date formatters were found in client-side code (the detector is not silently blind)", real.sites.length >= 2, `got ${real.sites.length}`);
for (const e of real.exceptions) {
  check(`server-only exception holds: ${e.file} ${e.fn} — ${e.why}`, e.problems.length === 0, e.problems.join("\n      "));
}
const list = (rule: Finding["rule"]) => real.findings.filter((x) => x.rule === rule).map((x) => `${at(x)}  ${x.what}`);
check("every date formatter in client-side code names its time zone (none falls back to the runtime's)", list("missing").length === 0, list("missing").join("\n      "));
check('…and that zone is the literal "UTC" — not the browser\'s, the host\'s, another zone or a variable', list("value").length === 0, list("value").join("\n      "));
check("no Date#toString / toDateString / toTimeString, and no Date put into a string, in client-side code (none can name a zone)", list("nozone").length === 0, list("nozone").join("\n      "));

// ---------- 2. behaviour: the client formatters, with their own options, in four time zones ----------
const excusedLines = new Set(real.exceptions.flatMap((e) => (e.problems.length ? [] : e.excused.map(at))));
const samples = Object.fromEntries(real.sites.filter((s) => s.sample && !excusedLines.has(at(s))).map((s) => [at(s), s.sample]));
const CHILD = `
const sites = JSON.parse(process.env.DATE_TZ_SITES);
const instants = JSON.parse(process.env.DATE_TZ_INSTANTS);
const out = {};
for (const [id, s] of Object.entries(sites)) for (const i of instants) {
  const d = new Date(i);
  out[id + " @ " + i] = s.method === "Intl.DateTimeFormat" ? new Intl.DateTimeFormat(s.locale, s.options).format(d) : d[s.method](s.locale, s.options);
}
console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }));
`;
const runs = ZONES.map((zone) => {
  const r = spawnSync(process.execPath, ["-e", CHILD], {
    encoding: "utf8",
    env: { ...process.env, TZ: zone, DATE_TZ_SITES: JSON.stringify(samples), DATE_TZ_INSTANTS: JSON.stringify(INSTANTS) },
  });
  const lineOut = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (r.status !== 0 || !lineOut) console.log(r.stdout, r.stderr);
  return lineOut ? (JSON.parse(lineOut) as { zone: string; out: Record<string, string> }) : null;
});
check(`the client date formatters (${Object.keys(samples).length}) ran in all four time zones`, runs.every(Boolean) && Object.keys(samples).length >= 2);
if (runs.every(Boolean)) {
  const ok = runs as { zone: string; out: Record<string, string> }[];
  // Without this the comparison below could be vacuous: prove each zone was really in effect.
  ZONES.forEach((z, i) => check(`time zone ${z} was in effect in its child process`, ok[i].zone === z, `got ${ok[i].zone}`));
  const keys = Object.keys(ok[0].out);
  const diverge = keys.filter((k) => ok.some((r) => r.out[k] !== ok[0].out[k]));
  check(
    "identical strings in every zone (UTC = Asia/Riyadh = America/New_York = Asia/Dhaka)",
    keys.length > 0 && diverge.length === 0,
    diverge.slice(0, 8).map((k) => `${k}: ${ok.map((r, i) => `${ZONES[i]} "${r.out[k]}"`).join(" · ")}`).join("\n      "),
  );

  // The two screens from the defect, spelled out: the strings a UTC server always wrote, so the
  // English copy is unchanged — and now every zone writes them.
  const SPOT: [string, string, string[]][] = [
    ["Security Center (sessions, timeline, password)", "src/app/(app)/settings/security/security-client.tsx", ["Oct 8, 11:30 PM", "Oct 9, 12:30 AM", "Oct 9, 12:22 PM", "Mar 8, 06:45 AM"]],
    ["Compliance Center (consent dates)", "src/app/(app)/settings/compliance/compliance-client.tsx", ["Oct 8, 2026", "Oct 9, 2026", "Oct 9, 2026", "Mar 8, 2026"]],
  ];
  for (const [label, file, want] of SPOT) {
    const id = Object.keys(samples).find((k) => k.startsWith(`${file}:`));
    INSTANTS.forEach((i, n) => {
      const got = ok.map((r) => (id ? r.out[`${id} @ ${i}`] : undefined));
      check(`${label}: ${i} → "${want[n]}" in every zone`, !!id && got.every((g) => g === want[n]), id ? got.map((g, z) => `${ZONES[z]} "${g}"`).join(" · ") : `no formatter found in ${file}`);
    });
  }
}

// ---------- 3. the detector: what it must flag, and what it must leave alone ----------
const FIXTURES: [string, string, number, string][] = [
  ["src/fx/missing.tsx", `"use client";\nexport const A = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric" });`, 1, "a client formatter with no timeZone"],
  ["src/fx/utc.tsx", `"use client";\nexport const B = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });`, 0, 'timeZone: "UTC" passes'],
  ["src/fx/browser.tsx", `"use client";\nexport const C = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });`, 2, "the browser's own zone (reading it, and formatting with it)"],
  ["src/fx/env.tsx", `"use client";\nexport const D = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: process.env.TZ });`, 1, "the host's zone from the environment"],
  ["src/fx/riyadh.tsx", `"use client";\nexport const E = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "Asia/Riyadh" });`, 1, "another fixed zone (the contract is UTC)"],
  ["src/fx/typed.tsx", `"use client";\nexport function F(d: Date) { return d.toLocaleString("en-US"); }`, 1, "a Date known only by its type, formatted with no options"],
  ["src/fx/number.tsx", `"use client";\nexport const G = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });`, 0, "number formatting is not a date"],
  ["src/fx/intl.tsx", `"use client";\nexport const H = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });`, 1, "Intl.DateTimeFormat with no timeZone"],
  ["src/fx/intl-utc.tsx", `"use client";\nexport const I = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });`, 0, "Intl.DateTimeFormat with timeZone UTC passes"],
  ["src/fx/tostring.tsx", `"use client";\nexport const J = (d: Date) => \`\${d.toDateString()} \${String(d)} \${d}\`;`, 3, "toDateString, String(date) and a Date in a template string"],
  ["src/fx/spread-before.tsx", `"use client";\nconst base = { month: "short" } as const;\nexport const K = (iso: string) => new Date(iso).toLocaleString("en-US", { ...base, timeZone: "UTC" });`, 0, "a spread before timeZone cannot replace it"],
  ["src/fx/spread-after.tsx", `"use client";\nconst base = { month: "short" } as const;\nexport const L = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", ...base });`, 1, "a spread after timeZone can replace it"],
  ["src/fx/uses-shared.tsx", `"use client";\nimport { label } from "@/fx/shared";\nexport const M = label;`, 0, "a client module importing a shared formatter…"],
  ["src/fx/shared.ts", `export function label(iso: string) { return new Date(iso).toLocaleDateString("en-US", { month: "long" }); }`, 1, "…flags the shared formatter (imports are followed)"],
  ["src/fx/server-page.tsx", `export function ServerOnly(iso: string) { return new Date(iso).toLocaleDateString("en-US", { month: "long" }); }`, 0, "a server-only module is left alone (no hydration)"],
  ["src/fx/uses-action.tsx", `"use client";\nimport { act } from "./actions";\nexport const N = act;`, 0, "a client module calling a server action…"],
  ["src/fx/actions.ts", `"use server";\nexport async function act(iso: string) { return new Date(iso).toLocaleDateString("en-US"); }`, 0, '…leaves the "use server" module alone'],
];
const fx = analyse(path.join(ROOT, ".verify-date-timezone-fixtures"), new Map(FIXTURES.map(([f, t]) => [f, t])));
for (const [file, , want, label] of FIXTURES) {
  const got = fx.findings.filter((x) => x.file === file);
  check(`detector: ${label} → ${want} finding${want === 1 ? "" : "s"}`, got.length === want, `got ${got.length}: ${got.map((x) => x.what).join("; ")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
