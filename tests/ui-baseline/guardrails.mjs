/**
 * DEV-UI-01.0 — static UI/UX guardrails. REPORT-ONLY.
 *
 *   node tests/ui-baseline/guardrails.mjs              print the summary, write the JSON report
 *   node tests/ui-baseline/guardrails.mjs --json=PATH  write the report somewhere else
 *
 * This measures today's violations so the redesign stages can be held to a falling number. It
 * NEVER fails: the exit code is 0 whatever it finds (non-zero only if the scan itself breaks).
 * Turning any of these into a gate is a later stage's decision, not this batch's.
 *
 * Five measurements, each deliberately simple and deterministic (sorted file walk, no globbing
 * library, no dependency on the build):
 *
 *   G1 physical-direction styling   — ml-/mr-/pl-/pr-/left-/right-/text-left/…, margin-left,
 *                                     marginLeft …; each should become a logical equivalent
 *                                     (ms-/me-/ps-/pe-/start-/end-/text-start …) for RTL.
 *   G2 font sizes off the future scale — DEV-UI-00 §7.1: 11 12 13 14 16 18 20 24 30 px.
 *   G3 outline removal without a focus-visible replacement.
 *   G4 local status → variant/colour maps (should become one shared status registry).
 *   G5 t() keys missing from the dictionary (the AUD-07 i18n gate, measured not enforced).
 *
 * Heuristics are documented next to each detector. A count is a measurement of the pattern, not
 * a claim that every hit is a visible defect — e.g. `left-0` on a full-width overlay is
 * direction-neutral in effect. Each hit carries file:line so a reviewer can judge.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const SRC = join(ROOT, "src");
const jsonArg = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
const OUT = resolve(ROOT, jsonArg ?? "docs/ui/dev-ui-01-0/guardrails-baseline.json");

export const TYPE_SCALE_PX = [11, 12, 13, 14, 16, 18, 20, 24, 30];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((abs) => ({ abs, rel: relative(ROOT, abs), text: readFileSync(abs, "utf8") }));
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

/**
 * The file text with everything OUTSIDE string and template literals replaced by spaces (newlines
 * kept), so offsets and line numbers are unchanged. Class names live in strings; this keeps prose
 * in comments ("right-to-left") and identifiers out of the Tailwind counts.
 */
function stringsOnly(f) {
  const out = f.text.replace(/[^\n]/g, " ").split("");
  const sf = ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, f.rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const copy = (start, end) => {
    for (let i = start; i < end; i++) out[i] = f.text[i];
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      copy(node.getStart(sf), node.getEnd());
    } else if (ts.isJsxText(node)) {
      // JSX text is rendered prose, not classes — leave blank.
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.join("");
}
const isPrintCss = (rel) => rel.startsWith("src/app/print/");

// ------------------------------------------------------------------------------------------------
// G1 — physical direction.
// Tailwind: the utility must start a class token (start of string, whitespace, quote, backtick or
// a variant colon) so `border-l` inside `border-light` is not matched. CSS: property names. JSX
// inline styles: camelCase keys.
const TW_PHYSICAL = /(?<=^|[\s"'`:{(])-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-(?:\[[^\]]+\]|\d[\d./]*|auto|px|full)(?=$|[\s"'`}),])|(?<=^|[\s"'`:{(])(text-left|text-right|float-left|float-right|clear-left|clear-right|border-l|border-r|rounded-l|rounded-r)(?=$|[\s"'`}),])/g;
const CSS_PHYSICAL = /(?<![\w-])(margin-left|margin-right|padding-left|padding-right|border-left(?:-[a-z]+)?|border-right(?:-[a-z]+)?|left|right|text-align:\s*(?:left|right)|float:\s*(?:left|right))\s*:/g;
const JS_PHYSICAL = /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|textAlign:\s*["'](?:left|right)["']|left|right)\s*:/g;

function g1() {
  const hits = [];
  for (const f of files) {
    if (f.rel.endsWith(".css")) {
      // strip comments so commented-out rules are not counted
      const text = f.text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      for (const m of text.matchAll(CSS_PHYSICAL)) {
        const prop = m[1].replace(/\s+/g, " ");
        hits.push({ file: f.rel, line: lineOf(text, m.index), kind: "css", token: prop.replace(/:.*$/, "") + (prop.includes(":") ? `: ${prop.split(":")[1].trim()}` : "") });
      }
      continue;
    }
    const strings = stringsOnly(f);
    for (const m of strings.matchAll(TW_PHYSICAL)) {
      hits.push({ file: f.rel, line: lineOf(strings, m.index), kind: "tailwind", token: m[0].replace(/^-/, "") });
    }
    // JSX inline style objects only: require `style={{` earlier on the same line or the key inside
    // a `style` object literal. Restricting to lines containing `style` keeps object keys like
    // `{ left: 0 }` in chart math (SVG coordinates) out of the count.
    const lines = f.text.split("\n");
    lines.forEach((l, i) => {
      if (!/style\s*=\s*\{\{|style:\s*\{|CSSProperties/.test(l)) return;
      for (const m of l.matchAll(JS_PHYSICAL)) hits.push({ file: f.rel, line: i + 1, kind: "inline-style", token: m[1] });
    });
  }
  return hits;
}

// ------------------------------------------------------------------------------------------------
// G2 — font sizes outside the future 9-step scale.
const TW_NAMED = { "text-xs": 12, "text-sm": 14, "text-base": 16, "text-lg": 18, "text-xl": 20, "text-2xl": 24, "text-3xl": 30, "text-4xl": 36, "text-5xl": 48, "text-6xl": 60, "text-7xl": 72, "text-8xl": 96, "text-9xl": 128 };
function toPx(v) {
  const m = String(v).trim().match(/^(-?[\d.]+)(px|rem|em|pt)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === "rem") return Math.round(n * 16 * 100) / 100;
  if (m[2] === "pt") return Math.round((n * 4) / 3 * 100) / 100;
  if (m[2] === "em") return null; // relative to parent — not resolvable statically
  return n;
}
function g2() {
  const hits = [];
  const unresolved = [];
  for (const f of files) {
    const scope = isPrintCss(f.rel) ? "print" : "screen";
    if (f.rel.endsWith(".css")) {
      const text = f.text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      for (const m of text.matchAll(/(?<![\w-])font-size\s*:\s*([^;}\n]+)/g)) {
        const px = toPx(m[1].replace(/!important/, ""));
        if (px === null) unresolved.push({ file: f.rel, line: lineOf(text, m.index), value: m[1].trim() });
        else if (!TYPE_SCALE_PX.includes(px)) hits.push({ file: f.rel, line: lineOf(text, m.index), scope, value: m[1].trim(), px });
      }
      for (const m of text.matchAll(/(?<![\w-])font\s*:\s*[^;}\n]*?\b([\d.]+(?:px|rem|pt))\b/g)) {
        const px = toPx(m[1]);
        if (px !== null && !TYPE_SCALE_PX.includes(px)) hits.push({ file: f.rel, line: lineOf(text, m.index), scope, value: `font: …${m[1]}`, px });
      }
      continue;
    }
    const strings = stringsOnly(f);
    for (const m of strings.matchAll(/(?<=^|[\s"'`:{(])text-\[([\d.]+(?:px|rem|pt|em)?)\]/g)) {
      const px = toPx(m[1]);
      if (px === null) unresolved.push({ file: f.rel, line: lineOf(strings, m.index), value: m[0] });
      else if (!TYPE_SCALE_PX.includes(px)) hits.push({ file: f.rel, line: lineOf(strings, m.index), scope, value: m[0], px });
    }
    for (const m of strings.matchAll(/(?<=^|[\s"'`:{(])(text-(?:xs|sm|base|lg|xl|[2-9]xl))(?=$|[\s"'`}),/])/g)) {
      const px = TW_NAMED[m[1]];
      if (!TYPE_SCALE_PX.includes(px)) hits.push({ file: f.rel, line: lineOf(strings, m.index), scope, value: m[1], px });
    }
    for (const m of f.text.matchAll(/\bfontSize\s*:\s*(["'`]?)([\d.]+(?:px|rem|pt)?)\1/g)) {
      const px = toPx(m[2]);
      if (px !== null && !TYPE_SCALE_PX.includes(px)) hits.push({ file: f.rel, line: lineOf(f.text, m.index), scope, value: `fontSize: ${m[2]}`, px });
    }
  }
  return { hits, unresolved };
}

// ------------------------------------------------------------------------------------------------
// G3 — focus indication removed without a focus-visible replacement.
// TSX: a class string (the quoted/backticked literal containing the token) with outline-none or
// outline-hidden and no `focus-visible:` utility in the same literal. CSS: an `outline: none|0`
// declaration whose rule selector does not itself target :focus-visible.
function g3() {
  const hits = [];
  let withReplacement = 0;
  for (const f of files) {
    if (f.rel.endsWith(".css")) {
      const text = f.text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const [, selector, body] = m;
        const d = body.match(/(?<![\w-])outline\s*:\s*(none|0)\b/);
        if (!d) continue;
        if (/:focus-visible/.test(selector)) {
          withReplacement++;
          continue;
        }
        hits.push({ file: f.rel, line: lineOf(text, m.index + selector.length + 1 + d.index), kind: "css", selector: selector.trim().replace(/\s+/g, " ").slice(0, 120) });
      }
      continue;
    }
    for (const m of f.text.matchAll(/(["'`])((?:(?!\1)[\s\S])*?\boutline-(?:none|hidden)\b(?:(?!\1)[\s\S])*?)\1/g)) {
      if (/focus-visible:/.test(m[2])) {
        withReplacement++;
        continue;
      }
      const tokenIdx = m.index + m[0].search(/\boutline-(?:none|hidden)\b/);
      hits.push({ file: f.rel, line: lineOf(f.text, tokenIdx), kind: "tailwind", classes: m[2].replace(/\s+/g, " ").slice(0, 140) });
    }
  }
  return { hits, withReplacement };
}

// ------------------------------------------------------------------------------------------------
// G4 — local status → variant/colour maps.
// An object literal (found with the TypeScript parser) with at least two property keys that are
// known business statuses, whose values are strings or objects carrying a colour/variant token.
const STATUSES = new Set(
  "draft sent paid partially_paid partial unpaid void voided pending approved rejected accepted expired active inactive completed cancelled canceled on_hold planned todo in_progress done blocked ordered received confirmed fulfilled processed overdue archived deleted present absent late on_leave issued open closed posted reversed delivered converted failed success".split(" "),
);
const VARIANTISH = /\b(success|warning|danger|destructive|error|info|neutral|muted|secondary|default|outline|primary|pill|tone|variant)\b|\b(bg|text|border|ring)-[a-z]|#[0-9a-f]{3,8}\b|var\(--/i;
function g4() {
  const maps = [];
  for (const f of files) {
    if (!/\.tsx?$/.test(f.rel)) continue;
    const sf = ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, f.rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const keys = [];
        let variantValues = 0;
        for (const p of node.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (!name || !STATUSES.has(name.toLowerCase())) continue;
          keys.push(name);
          if (VARIANTISH.test(p.initializer.getText(sf))) variantValues++;
        }
        if (keys.length >= 2 && variantValues >= 2) {
          maps.push({ file: f.rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, keys: keys.length, sample: keys.slice(0, 6).join(",") });
          return; // don't double-count nested maps
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return maps;
}

// ------------------------------------------------------------------------------------------------
// G5 — t() keys missing from the dictionary.
// Dictionary keys are read from the DICT object literal in src/lib/i18n/dict.ts with the
// TypeScript parser (DICT is not exported). Call sites are every call to an identifier `t` whose
// second argument is a string literal or a no-substitution template. Calls with a computed second
// argument are counted separately: they cannot be checked statically.
function g5() {
  const dictFile = files.find((f) => f.rel === "src/lib/i18n/dict.ts");
  const dsf = ts.createSourceFile(dictFile.rel, dictFile.text, ts.ScriptTarget.Latest, true);
  const keys = new Set();
  let duplicateKeys = 0;
  ts.forEachChild(dsf, function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(dsf) === "DICT" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const p of node.initializer.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name) ? p.name.text : p.name.getText(dsf);
        if (keys.has(k)) duplicateKeys++;
        keys.add(k);
      }
    }
    ts.forEachChild(node, find);
  });

  const missing = [];
  let literalCalls = 0;
  let dynamicCalls = 0;
  for (const f of files) {
    if (!/\.tsx?$/.test(f.rel) || f.rel === dictFile.rel) continue;
    if (!f.text.includes("t(")) continue;
    const sf = ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, f.rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length >= 2) {
        const a = node.arguments[1];
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          literalCalls++;
          if (!keys.has(a.text)) missing.push({ file: f.rel, line: sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1, key: a.text.slice(0, 100) });
        } else dynamicCalls++;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { dictionaryKeys: keys.size, duplicateKeys, literalCalls, dynamicCalls, missing, distinctMissingKeys: new Set(missing.map((m) => m.key)).size };
}

// ------------------------------------------------------------------------------------------------
const byFile = (hits) => {
  const m = {};
  for (const h of hits) m[h.file] = (m[h.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};
const byToken = (hits, key) => {
  const m = {};
  for (const h of hits) m[h[key]] = (m[h[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
};

const r1 = g1();
const r2 = g2();
const r3 = g3();
const r4 = g4();
const r5 = g5();

const report = {
  batch: "DEV-UI-01.0",
  mode: "REPORT-ONLY — never fails",
  scanned: { root: "src/", files: files.length, extensions: [".ts", ".tsx", ".css"] },
  typeScalePx: TYPE_SCALE_PX,
  G1_physicalDirection: { total: r1.length, byKind: byToken(r1, "kind"), byToken: byToken(r1, "token"), byFile: byFile(r1), hits: r1 },
  G2_fontSizeOffScale: {
    total: r2.hits.length,
    screen: r2.hits.filter((h) => h.scope === "screen").length,
    print: r2.hits.filter((h) => h.scope === "print").length,
    byPx: byToken(r2.hits, "px"),
    byFile: byFile(r2.hits),
    unresolved: r2.unresolved,
    hits: r2.hits,
  },
  G3_outlineWithoutFocusVisible: { total: r3.hits.length, withFocusVisibleReplacement: r3.withReplacement, byKind: byToken(r3.hits, "kind"), byFile: byFile(r3.hits), hits: r3.hits },
  G4_localStatusVariantMaps: { total: r4.length, byFile: byFile(r4), maps: r4 },
  G5_i18nDictionaryGaps: {
    dictionaryKeys: r5.dictionaryKeys,
    duplicateKeys: r5.duplicateKeys,
    literalTCalls: r5.literalCalls,
    dynamicTCallsUncheckable: r5.dynamicCalls,
    missingCallSites: r5.missing.length,
    distinctMissingKeys: r5.distinctMissingKeys,
    byFile: byFile(r5.missing),
    missing: r5.missing,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

console.log("DEV-UI-01.0 static guardrails — REPORT-ONLY (exit 0 regardless of counts)\n");
console.log(`scanned ${files.length} files under src/`);
console.log(`G1 physical-direction styling ........ ${r1.length}  (${Object.entries(report.G1_physicalDirection.byKind).map(([k, v]) => `${k} ${v}`).join(", ")}) in ${Object.keys(report.G1_physicalDirection.byFile).length} files`);
console.log(`G2 font sizes off the 9-step scale ... ${r2.hits.length}  (screen ${report.G2_fontSizeOffScale.screen}, print ${report.G2_fontSizeOffScale.print}; ${r2.unresolved.length} unresolvable) in ${Object.keys(report.G2_fontSizeOffScale.byFile).length} files`);
console.log(`G3 outline removed, no focus-visible . ${r3.hits.length}  (${r3.withReplacement} with a focus-visible replacement)`);
console.log(`G4 local status→variant maps ......... ${r4.length}  in ${Object.keys(report.G4_localStatusVariantMaps.byFile).length} files`);
console.log(`G5 t() keys missing from dictionary .. ${r5.missing.length} call sites, ${r5.distinctMissingKeys} distinct keys  (dict ${r5.dictionaryKeys} keys, ${r5.literalCalls} literal calls, ${r5.dynamicCalls} dynamic calls not checkable)`);
console.log(`\nreport → ${relative(ROOT, OUT)}`);
