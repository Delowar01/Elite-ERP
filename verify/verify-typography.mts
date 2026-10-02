// Typography semantics (DEV-UI-01.1-C1). Run via `npm run verify:typography` — deliberately WITHOUT
// --conditions=react-server: it server-renders the real client components <Money>/<DocNum>, which need
// the ordinary React build (the react-server build has no createContext or renderToStaticMarkup).
//
// The locked contract:
//   IBM Plex Sans        ordinary UI, body, headings
//   IBM Plex Sans Arabic Arabic UI (falls through from Plex Sans in --font-ui)
//   IBM Plex Mono        codes, IDs and hashes ONLY — the `font-mono` / `.mono` / --font-mono semantic
//   UI face + tabular    money, prices, rates, quantities, balances, percentages, dates — `num-tabular`
//
// The mistake this suite exists to stop: DEV-UI-01.1 first moved money off Mono by redefining the Mono
// alias itself to the UI face, which silently took Mono away from every document number, SKU, VAT ID
// and account code too. So these checks pin BOTH sides, and pin that the two are independent: the
// numeric style is its own token, and nothing about it can reach the code face.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Money, DocNum } from "../src/app/(app)/sales/_shared/money";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const globals = read("src/app/globals.css");
const mockup = read("src/app/(app)/mockup-parity.css");
const print = read("src/app/print/print.css");
const layout = read("src/app/layout.tsx");

/** All declarations of a custom property in a stylesheet (any block). */
const decls = (css: string, name: string) =>
  [...css.matchAll(new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
/** The declaration block of the first rule whose selector starts with `sel`. */
const rule = (css: string, sel: string) => {
  const i = css.indexOf(sel);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
};

// ---------- 1. the code semantic resolves to IBM Plex Mono ----------
check("layout binds IBM Plex Mono to --font-mono-raw", /IBM_Plex_Mono\(\{\s*variable:\s*"--font-mono-raw"/.test(layout));
const codeFamily = decls(globals, "--font-code-family");
check("--font-code-family is declared once and starts with IBM Plex Mono (--font-mono-raw)",
  codeFamily.length === 1 && codeFamily[0].startsWith("var(--font-mono-raw)"), codeFamily.join(" | "));
const monoDecls = decls(globals, "--font-mono");
check("every --font-mono declaration (root alias + Tailwind theme) is the code family",
  monoDecls.length >= 2 && monoDecls.every((d) => d === "var(--font-code-family)"), monoDecls.join(" | "));
const codeDecls = decls(globals, "--font-code");
check("Tailwind `font-code` is the code family", codeDecls.length >= 1 && codeDecls.every((d) => d === "var(--font-code-family)"), codeDecls.join(" | "));
check("the legacy .mono class is the code face", /font-family:\s*var\(--font-mono\)/.test(rule(mockup, ".mono {")), rule(mockup, ".mono {"));
for (const sel of [".hash-strip {", ".cmdk-kbd {", ".acct-row .code {", ".einvoice-panel .badge-zatca {"]) {
  check(`code rule ${sel.replace(" {", "")} uses the code face`, /var\(--font-code-family\)|var\(--font-mono\)/.test(rule(mockup, sel)));
}

// ---------- 2. the numeric semantic is the UI face with tabular figures ----------
const numeric = decls(globals, "--font-numeric");
check("--font-numeric is the UI face", numeric.length === 1 && numeric[0] === "var(--font-ui)", numeric.join(" | "));
const util = globals.match(/@utility num-tabular\s*\{([^}]*)\}/)?.[1] ?? "";
check("`num-tabular` sets the numeric family", /font-family:\s*var\(--font-numeric\)/.test(util), util.trim());
check("`num-tabular` sets tabular figures", /font-variant-numeric:\s*tabular-nums/.test(util));
check("body text uses tabular figures by default", /font-variant-numeric:\s*tabular-nums/.test(rule(globals, "body {")));

// ---------- 3. independence: changing the numeric style cannot touch Mono ----------
const ui = decls(globals, "--font-ui");
check("--font-ui never references the code face", ui.length === 1 && !/mono/i.test(ui[0]), ui.join(" | "));
check("--font-numeric never references the code face", numeric.every((d) => !/mono|code/i.test(d)));
check("no Mono/code token is defined in terms of the UI, numeric or body face",
  [...monoDecls, ...codeDecls, ...codeFamily].every((d) => !/--font-(ui|numeric|body)/.test(d)));
check("--font-mono is not defined in terms of --font-numeric (a numeric change cannot reach Mono)",
  monoDecls.every((d) => !d.includes("--font-numeric")));

// ---------- 4. shared financial components render numeric typography ----------
const money = renderToStaticMarkup(createElement(Money, { amount: 1234.5 }));
const moneyCls = renderToStaticMarkup(createElement(Money, { amount: 1234.5, className: "font-semibold" }));
const docnum = renderToStaticMarkup(createElement(DocNum, { value: 12.5, kind: "quantity" }));
const rate = renderToStaticMarkup(createElement(DocNum, { value: 3.75, kind: "rate" }));
check("<Money> renders with num-tabular", /^<span class="[^"]*\bnum-tabular\b/.test(money), money);
check("<Money> keeps num-tabular when a caller adds classes", /\bnum-tabular\b/.test(moneyCls) && /\bfont-semibold\b/.test(moneyCls), moneyCls);
check("<DocNum> (quantity) renders with num-tabular", /\bnum-tabular\b/.test(docnum), docnum);
check("<DocNum> (rate) renders with num-tabular", /\bnum-tabular\b/.test(rate), rate);
check("neither component emits a code-face class", ![money, docnum, rate].some((h) => /\b(font-mono|mono)\b/.test(h)));

// ---------- 5. representative numeric CSS rules ----------
for (const [css, sel, label] of [
  [mockup, "table.data-table td.num {", "data-table numeric cell"],
  [mockup, ".totals-strip .t-row .v {", "document totals"],
  [mockup, ".item-cell-input {", "line-item qty/price input"],
  [mockup, "table.data-table.line-table .cellval {", "line-item computed amount"],
  [mockup, ".acct-row .bal {", "account balance"],
  [mockup, ".tb-tile .v {", "journal totals tile"],
  [print, "table.pdf-items tbody td.num {", "PDF line amounts"],
  [print, ".totals-box .t-row .v {", "PDF totals"],
] as const) {
  const r = rule(css, sel);
  check(`numeric rule (${label}) uses the numeric face + tabular figures`, /var\(--font-numeric\)/.test(r) && /tabular-nums/.test(r) && !/--font-mono/.test(r), r.slice(0, 120));
}

// ---------- 6. representative code/ID call sites keep the code face ----------
const app = (p: string) => read(`src/app/(app)/${p}`);
const CODE_SITES: [string, RegExp, string][] = [
  ["sales/invoices/[id]/page.tsx", /<h3 className="mono">\{invoice\.invoiceNumber\}<\/h3>/, "invoice number heading"],
  ["sales/invoices/invoices-list-client.tsx", /className="hover:text-brand-orange font-mono">/, "invoice number link in list"],
  ["purchasing/orders/[id]/page.tsx", /<h3 className="mono">\{po\.poNumber\}<\/h3>/, "PO number heading"],
  ["inventory/products/page.tsx", /<TableCell className="font-mono text-xs">\{p\.sku\}<\/TableCell>/, "product SKU"],
  ["clients/client-form.tsx", /id="vatNumber"[^>]*className="font-mono"/, "client VAT number input"],
  ["sales/_shared/party-card.tsx", /<span className="font-mono">\{selected\.vatNumber\}<\/span>/, "party VAT number"],
  ["finance/reports/reports-workspace.tsx", /<TableCell className="mono">\{r\.code\}<\/TableCell>/, "trial-balance account code"],
  ["finance/_shared/add-account-dialog.tsx", /id="acc-code"[^>]*className="font-mono"/, "account code input"],
  ["hr/employees/[id]/page.tsx", /font-mono[^"]*">· \{employee\.employeeCode\}/, "employee code"],
  ["settings/presets/numbering-panel.tsx", /<TableCell className="font-mono text-xs">\{seq\.prefix\}<\/TableCell>/, "numbering prefix"],
  ["settings/security/security-client.tsx", /font-mono[^"]*">\{s\.ipAddress/, "session IP address"],
];
for (const [file, re, label] of CODE_SITES) check(`code site keeps Mono: ${label}`, re.test(app(file)), file);

// ---------- 7. no numeric component is ever placed in the code face ----------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
  });
}
const root = new URL("../src", import.meta.url).pathname;
let monoWrapped = 0;
const offenders: string[] = [];
for (const file of walk(root)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // an element on the same line that is classed mono AND whose content is <Money/<DocNum
    if (/className=["{`][^"}`]*\b(font-mono|mono)\b[^"}`]*["}`][^>]*>\s*(?:[^<]{0,4})?<(Money|DocNum)\b/.test(line)) {
      monoWrapped++;
      offenders.push(`${file.replace(root, "src")}:${i + 1}`);
    }
    // Money/DocNum given a code-face class directly
    if (/<(Money|DocNum)\b[^>]*className=["{`][^"}`]*\b(font-mono|mono)\b/.test(line)) {
      monoWrapped++;
      offenders.push(`${file.replace(root, "src")}:${i + 1}`);
    }
  });
}
check("no Money/DocNum is wrapped in or given a code-face class", monoWrapped === 0, offenders.slice(0, 6).join(" "));
const literal = walk(root).filter((f) => /fontFamily="IBM Plex Mono"/.test(readFileSync(f, "utf8")));
check("no hard-coded IBM Plex Mono family literal (it never matches the self-hosted face)", literal.length === 0, literal.join(" "));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "TYPOGRAPHY VERIFICATION PASS" : "TYPOGRAPHY VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
