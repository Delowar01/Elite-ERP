/**
 * Pre-DEV-UI-01.7 (P0): money and numbers render the same characters on the server and in every
 * browser — Western digits, whatever the browser's language or the server host's locale.
 *
 * ## The defect this guards
 *
 * `toLocaleString(undefined, …)` lets the runtime choose the locale. Node takes the host's LANG /
 * LC_ALL; a browser takes its own UI language. `<Money context="summary">` is a client component,
 * so the server rendered "13,272" and a browser running in Arabic (ar-SA) re-rendered "١٣٬٢٧٢".
 * React refused to hydrate that text (error #418) on eleven routes — dashboard, client and vendor
 * detail, bank accounts, chart of accounts, ledger, journal, reports, payroll, projects, project
 * detail — and then showed the browser's Arabic-Indic digits. A German browser gets "13.272": the
 * same failure with other separators. Every server-rendered summary figure depended on the host's
 * locale in the same way, so a VPS started under ar_SA would have served Arabic-Indic money.
 *
 * ## What this proves
 *
 *  1. Source: no implicit-locale number formatting is left under src/. A pattern ban, not a budget
 *     — the count must be zero and a failure names the file and line.
 *  2. Behaviour: the real formatters, run in three child processes whose host locale is en_US,
 *     ar_SA and de_DE, return byte-identical strings with Western digits, "," grouping, "." decimal
 *     and "-" minus — equal to the en-US strings an unconfigured server already produced, so
 *     precision, currency minor units, Indian / international grouping, negatives and rounding are
 *     all unchanged.
 *
 * The browser half — no #418 with an ar-SA browser, server and hydrated figures identical — is
 * verify/verify-ar-locale-hydration.mjs (browser tier).
 *
 * Run: npm run verify:number-locale
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// Values that exercise every rule the formatters own: zero, small integers, thousands, millions,
// decimals, negatives, half-way rounding in both directions, and a negative that rounds to zero.
const SUMMARY_VALUES = [0, 7, 999, 1234, 13271.58, 1234567.891, -1234.5, -88125.4, 0.5, 1.5, 2.5, 999.5, -0.4];
const DOCUMENT_VALUES = [0, 7, 1234.5, 1234.567, -1234.567, 13271.58, 1234567.891];
const CURRENCY_VALUES = [0, 7, 1250.5, 1250.075, 8271.25, -1234.5678, 1234567.891];
const CURRENCIES = ["SAR", "USD", "KWD", "BHD", "OMR", "JPY"];
const NUMBER_FORMAT_VALUES = [0, 2.5, 1234.567, 12345678.9, -98765.4321];

// ---------- child mode: print what the real formatters return under this process's host locale ----------
if (process.argv.includes("--sample")) {
  const cur = await import("../src/lib/currency/currencies");
  const totals = await import("../src/app/(app)/sales/_shared/totals");
  const base = cur.DEFAULT_NUMBER_FORMAT;
  const configs = {
    international: { ...base, digitGrouping: "international" as const },
    indian: { ...base, digitGrouping: "indian" as const },
    kwd: { ...base, currencyDecimals: 3, quantityRateDecimals: 3 },
    rounded: { ...base, roundRates: true, roundQuantities: true },
  };
  const out: Record<string, string> = {};
  for (const v of SUMMARY_VALUES) out[`formatMoneyNumber(${v}, summary)`] = cur.formatMoneyNumber(v, "summary");
  for (const v of DOCUMENT_VALUES) out[`formatMoneyNumber(${v}, document)`] = cur.formatMoneyNumber(v, "document");
  for (const c of CURRENCIES) for (const v of CURRENCY_VALUES) out[`fmt(${v}, ${c})`] = totals.fmt(v, c);
  for (const [name, cfg] of Object.entries(configs)) {
    for (const v of NUMBER_FORMAT_VALUES) {
      out[`formatAmount(${v}, ${name})`] = cur.formatAmount(v, cfg);
      out[`formatRate(${v}, ${name})`] = cur.formatRate(v, cfg);
      out[`formatQuantity(${v}, ${name})`] = cur.formatQuantity(v, cfg);
    }
  }
  console.log(JSON.stringify({ hostLocale: new Intl.NumberFormat().resolvedOptions().locale, out }));
  process.exit(0);
}

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

console.log("Number locale — deterministic, Western-digit money and number formatting\n");

// ---------- 1. source: no implicit-locale number formatting under src/ ----------
const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
check("source files were found (the scan is not silently empty)", files.length > 100, `got ${files.length}`);
const isComment = (t: string) => /^\s*(\/\/|\*|\/\*)/.test(t);
const BANNED: [RegExp, string][] = [
  [/\.toLocaleString\(\s*undefined\b/, "no toLocaleString(undefined, …) — the runtime would pick the locale"],
  [/\.toLocaleString\(\s*\)/, "no toLocaleString() — the runtime would pick the locale"],
  [/Intl\.NumberFormat\(\s*(undefined\b|\))/, "no Intl.NumberFormat without a locale"],
  [/navigator\.languages?\b/, "the browser's language is never used as a formatting locale"],
];
for (const [re, what] of BANNED) {
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (!isComment(line) && re.test(line)) hits.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  check(what, hits.length === 0, hits.join("\n      "));
}

// ---------- 2. behaviour: the real formatters under three host locales ----------
// The child is this same file, run with --sample under the same loader (tsx) the parent runs under.
function sample(lc: string): { hostLocale: string; out: Record<string, string> } | null {
  const loader = process.execArgv.length ? process.execArgv : ["--import", "tsx"];
  const r = spawnSync(process.execPath, [...loader, path.join(ROOT, "verify/verify-number-locale.mts"), "--sample"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: lc, LANG: lc, LANGUAGE: "" },
  });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (r.status !== 0 || !line) {
    console.log(r.stdout, r.stderr);
    return null;
  }
  return JSON.parse(line);
}

const HOSTS: [string, string][] = [["en_US.UTF-8", "en-US"], ["ar_SA.UTF-8", "ar-SA"], ["de_DE.UTF-8", "de-DE"]];
const runs = HOSTS.map(([lc]) => sample(lc));
check("the formatters ran in all three host locales", runs.every(Boolean));
if (runs.every(Boolean)) {
  const [en, ar, de] = runs as NonNullable<(typeof runs)[number]>[];
  // Without this the comparison below could be vacuous: prove the hostile locale was really in effect.
  HOSTS.forEach(([lc, want], i) => {
    const got = (runs[i] as NonNullable<(typeof runs)[number]>).hostLocale;
    check(`host locale ${lc} was in effect in its child process (default locale ${want})`, got === want, `got ${got}`);
  });

  const keys = Object.keys(en.out);

  const diverge = keys.filter((k) => en.out[k] !== ar.out[k] || en.out[k] !== de.out[k]);
  check(
    "identical strings whatever the host locale (en_US = ar_SA = de_DE)",
    diverge.length === 0,
    diverge.slice(0, 8).map((k) => `${k}: en "${en.out[k]}" · ar "${ar.out[k]}" · de "${de.out[k]}"`).join("\n      "),
  );

  // Western digits, "," grouping, "." decimal, ASCII "-" — nothing else (no Arabic-Indic digits,
  // no Arabic separators ٫ ٬, no letter marks, no spaces of any kind).
  const SHAPE = /^-?[0-9][0-9,]*(\.[0-9]+)?$/;
  for (const [name, run] of [["en_US", en], ["ar_SA", ar], ["de_DE", de]] as const) {
    const bad = keys.filter((k) => !SHAPE.test(run.out[k]));
    check(`${name} host: every string is Western digits with "," grouping and "." decimal`, bad.length === 0,
      bad.slice(0, 8).map((k) => `${k} = "${run.out[k]}" ${[...run.out[k]].map((c) => c.codePointAt(0)!.toString(16)).join(" ")}`).join("\n      "));
  }

  // The contract, value by value: exactly what Intl produces for the formatter's own options in the
  // locale an unconfigured server already used — so nothing an English user sees changes. The
  // decimals come from the formatter's documented rule, the grouping from its configuration.
  const ref = (locale: string, v: number, min: number, max: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }).format(v);
  const DP: Record<string, number> = { SAR: 2, USD: 2, KWD: 3, BHD: 3, OMR: 3, JPY: 0 };
  const expected: Record<string, string> = {};
  for (const v of SUMMARY_VALUES) expected[`formatMoneyNumber(${v}, summary)`] = ref("en-US", v, 0, 0);
  for (const v of DOCUMENT_VALUES) expected[`formatMoneyNumber(${v}, document)`] = ref("en-US", v, 2, 2);
  for (const c of CURRENCIES) for (const v of CURRENCY_VALUES) expected[`fmt(${v}, ${c})`] = ref("en-US", v, DP[c], DP[c]);
  const grouping: Record<string, string> = { international: "en-US", indian: "en-IN", kwd: "en-US", rounded: "en-US" };
  const money: Record<string, number> = { international: 2, indian: 2, kwd: 3, rounded: 2 };
  const rate: Record<string, number> = { international: 2, indian: 2, kwd: 3, rounded: 0 };
  for (const name of Object.keys(grouping)) {
    for (const v of NUMBER_FORMAT_VALUES) {
      expected[`formatAmount(${v}, ${name})`] = ref(grouping[name], v, money[name], money[name]);
      expected[`formatRate(${v}, ${name})`] = ref(grouping[name], v, rate[name], rate[name]);
      expected[`formatQuantity(${v}, ${name})`] = name === "rounded" ? new Intl.NumberFormat("en-US").format(Math.round(v)) : ref(grouping[name], v, 0, 3);
    }
  }
  const missing = Object.keys(expected).filter((k) => !(k in en.out));
  check(`every formatter case produced output (${Object.keys(expected).length} cases)`,
    missing.length === 0 && keys.length === Object.keys(expected).length, `missing ${missing.slice(0, 5).join(", ")}; got ${keys.length}`);
  for (const [name, run] of [["en_US", en], ["ar_SA", ar], ["de_DE", de]] as const) {
    const wrong = keys.filter((k) => run.out[k] !== expected[k]);
    check(`${name} host: every string equals the en-US contract (precision, minor units, grouping, negatives, rounding)`, wrong.length === 0,
      wrong.slice(0, 8).map((k) => `${k} = "${run.out[k]}", expected "${expected[k]}"`).join("\n      "));
  }

  // A few spelled out, so the contract is readable without running anything.
  const SPOT: [string, string][] = [
    ["formatMoneyNumber(13271.58, summary)", "13,272"],
    ["formatMoneyNumber(-1234.5, summary)", "-1,235"],
    ["formatMoneyNumber(1234.5, document)", "1,234.50"],
    ["fmt(8271.25, SAR)", "8,271.25"],
    ["fmt(1250.075, KWD)", "1,250.075"],
    ["fmt(-1234.5678, KWD)", "-1,234.568"],
    ["fmt(1250.5, JPY)", "1,251"],
    ["formatAmount(12345678.9, international)", "12,345,678.90"],
    ["formatAmount(12345678.9, indian)", "1,23,45,678.90"],
    ["formatAmount(-98765.4321, kwd)", "-98,765.432"],
    ["formatQuantity(2.5, international)", "2.5"],
    ["formatRate(1234.567, rounded)", "1,235"],
  ];
  for (const [k, want] of SPOT) {
    check(`${k} → "${want}" under every host locale`, [en, ar, de].every((r) => r.out[k] === want), `en "${en.out[k]}" · ar "${ar.out[k]}" · de "${de.out[k]}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
