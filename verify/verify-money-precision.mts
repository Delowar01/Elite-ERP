/**
 * Static guard: no money path may round to a hardcoded number of decimals.
 *
 * ## Why this asserts a PATTERN, never a count
 *
 * The obvious version of this suite counts the offending call sites and fails when the count goes
 * up — "there are no more than 64 `toFixed(2)` calls". That rule quietly permits a swap: delete one
 * and add another and the number never moves, so the check passes while a brand-new hardcoded
 * rounding sits in the ledger. A budget is not a ban.
 *
 * So the assertion here is that the count is **zero** on every money path, and the failure message
 * names the file and line. There is no threshold to creep upward, and the only way to satisfy it is
 * to route the value through `roundMoney(value, currency)` — the single currency-aware rounder.
 *
 * ## What the failure looked like
 *
 * Sixty-four call sites, each individually reasonable, none of them aware of the currency. In a
 * Kuwaiti or Bahraini organization (3 decimals) every one of them silently truncated the third
 * decimal; in a Japanese one (0 decimals) they invented two. A helper that takes the currency makes
 * the wrong version impossible to write by accident rather than merely discouraged — and this suite
 * is what stops the accidental version coming back.
 *
 * Run: npm run verify:money-precision
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`);
  }
}

/** Every tracked source file under src/. */
function sourceFiles(): string[] {
  return execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

type Hit = { file: string; line: number; text: string };

/**
 * Lines that are exempt, each for a stated reason rather than because they were inconvenient.
 * A blanket "// eslint-disable"-style escape hatch is deliberately NOT offered: an exemption has to
 * be argued here, in one list, where it can be reviewed.
 */
const EXEMPT = [
  // Hours are not money. A time log is denominated in hours, and two decimals is the intended
  // precision regardless of what currency the organization uses.
  { file: "src/app/(app)/projects/actions.ts", contains: "hours: hours.toFixed(2)" },
  // formatQuantity: quantities are not money and legitimately show up to 3 trailing decimals.
  { file: "src/lib/currency/currencies.ts", contains: "minimumFractionDigits: 0, maximumFractionDigits: 3" },
  // Account balances in the Chart of Accounts sidebar are a SUMMARY context — 0 decimals by
  // design, the same rule <Money context="summary"> applies everywhere else.
  { file: "src/app/(app)/finance/_shared/account-ledger-view.tsx", contains: "maximumFractionDigits: 0" },
];

function isExempt(hit: Hit): boolean {
  return EXEMPT.some((e) => hit.file === e.file && hit.text.includes(e.contains));
}

/** A comment line. Prose that mentions `0.005` while explaining why it is wrong is not a defect. */
function isComment(text: string): boolean {
  const t = text.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function scan(pattern: RegExp, files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      if (!isComment(text) && pattern.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits.filter((h) => !isExempt(h));
}

const render = (hits: Hit[]) =>
  hits.map((h) => `      ${h.file}:${h.line}\n        ${h.text}`).join("\n");

console.log("Money precision — no hardcoded decimals on any money path\n");

const files = sourceFiles();
check("source files were found (the scan is not silently empty)", files.length > 0, `      got ${files.length}`);

// 1. `.toFixed(2)` — the original sixty-four.
const toFixed2 = scan(/\.toFixed\(2\)/, files);
check("no .toFixed(2) anywhere under src/", toFixed2.length === 0, render(toFixed2));

// 2. `.toFixed(3)` is not "more correct" than `.toFixed(2)` — it is the same mistake aimed at
//    Kuwait instead of Saudi Arabia. Both are money-shaped minor-unit counts and both are banned.
//    `.toFixed(0)` and `.toFixed(1)` are NOT scanned: every surviving use is a VAT percentage or a
//    count of hours, neither of which is money, and banning them would only teach people to route
//    non-money through a money helper to silence the check.
const toFixed3 = scan(/\.toFixed\(3\)/, files);
check("no .toFixed(3) either — the same bug, aimed elsewhere", toFixed3.length === 0, render(toFixed3));

// 3. Intl formatting pinned to two decimals — the display-side version of the same bug.
const intl2 = scan(/(minimum|maximum)FractionDigits:\s*\d/, files);
check("no hardcoded FractionDigits literals", intl2.length === 0, render(intl2));

// 4. Cent arithmetic: `* 100` / `/ 100` rounding, which assumes a two-decimal minor unit.
//    This is how the journal-entry balance check silently accepted an unbalanced Kuwaiti entry.
const cents = scan(/Math\.round\([^)]*\*\s*100\s*\)/, files);
check("no Math.round(x * 100) cent arithmetic", cents.length === 0, render(cents));

// 5. Half-a-cent tolerances. Half a minor unit is 0.0005 in KWD, so a literal 0.005 tolerated ten
//    times the intended slack on overpayment and paid-in-full checks. `moneyEpsilon(currency)`
//    replaces them.
const eps = scan(/[^.\w]0\.005\b/, files);
check("no hardcoded 0.005 half-cent tolerances", eps.length === 0, render(eps));

// 6. The rounder itself must exist and take a currency — the check above is meaningless if the
//    replacement it points people at does not require the currency.
const currencies = readFileSync(path.join(ROOT, "src/lib/currency/currencies.ts"), "utf8");
check(
  "roundMoney takes a currency code",
  /export function roundMoney\(value: string \| number, currencyCode/.test(currencies),
);
check(
  "moneyEpsilon takes a currency code",
  /export function moneyEpsilon\(currencyCode/.test(currencies),
);
// The org's Number Format decimals setting must not be able to reach money again.
check(
  "formatAmount reads the currency's decimals, not the org setting",
  /const d = cfg\.currencyDecimals;/.test(currencies),
);
// The org's Number Format type must expose the two decimal counts under names that say what they
// are, so a future call site cannot reach for "decimalPlaces" and get money wrong by default.
const nfType = currencies.slice(
  currencies.indexOf("export type NumberFormatConfig"),
  currencies.indexOf("export const DEFAULT_NUMBER_FORMAT"),
);
check("NumberFormatConfig has no bare `decimalPlaces` field", !/^\s*decimalPlaces:/m.test(nfType));
check("NumberFormatConfig names the quantity/rate setting explicitly", /quantityRateDecimals: number;/.test(nfType));
check("NumberFormatConfig names the money setting explicitly", /currencyDecimals: number;/.test(nfType));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
