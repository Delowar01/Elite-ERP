/**
 * Pre-DEV-UI-01.7 (P0) — an Arabic browser must not change, or break, how money renders.
 *
 * The DEV-UI-01.7 Stage 1 audit measured React hydration error #418 on eleven routes as soon as
 * the BROWSER ran in Arabic (ar-SA), whatever language the app itself was set to. `<Money
 * context="summary">`, the payroll figures and the journal totals were formatted with
 * `toLocaleString(undefined, …)`: the server wrote "13,272", the browser computed "١٣٬٢٧٢", React
 * refused the mismatch and re-rendered the page with the browser's Arabic-Indic digits.
 *
 * For each of the eleven routes (reports in three variants), under four combinations of browser
 * locale (ar-SA, en-US) and app language (ar, en):
 *   1. no page error and no console error — no #418;
 *   2. Western digits: no Arabic-Indic digit, Arabic separator (٫ ٬) or Arabic letter mark in
 *      <main> — except two DATE strings the server formats for Arabic on purpose (dashboard
 *      activity times, the payroll period title). Those are explicit-locale, identical on server
 *      and client, not money, and scheduled for DEV-UI-01.7's formatDisplayDate by decision;
 *   3. the figures on the hydrated page are exactly the figures the server rendered — read from a
 *      JavaScript-disabled load of the same page.
 * Plus the Record Payment dialog, whose balances are formatted in the browser only (no hydration
 * involved): they must not follow the browser's language either.
 *
 * Runs against a fresh TEST-only org it registers and fills itself. Set AR_LOCALE_DUMP=<file> to
 * write the hydrated figures per state (used to compare English output before and after a change).
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `ar_locale_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const VIEWPORT = { width: 1440, height: 950 };

// ---------- fixture org: registered through the UI, then filled with posted figures ----------
const regCtx = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", timezoneId: "UTC" });
regCtx.setDefaultTimeout(45000);
regCtx.setDefaultNavigationTimeout(60000);
const reg = await regCtx.newPage();
await reg.goto(`${BASE}/register`);
await reg.fill('input[name="orgName"]', "Locale Determinism Co");
await reg.fill('input[name="name"]', "Owner");
await reg.fill('input[name="email"]', email);
await reg.fill('input[name="password"]', pass);
const cf = reg.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(reg);
await reg.getByRole("button", { name: /register|create|sign up/i }).first().click();
await reg.waitForURL(/\/dashboard/, { timeout: 40000 });
const session = await regCtx.storageState();
await regCtx.close();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const { org_id: org, id: uid } = await one("select org_id, id from users where email=$1", [email]);
const acc = new Map((await db.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = await one("select id, gl_account_id from bank_accounts where org_id=$1 order by id limit 1", [org]);
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function nextNumber(type) {
  const s = await one("select prefix, next_number, padding from document_sequences where org_id=$1 and document_type=$2", [org, type]);
  await db.query("update document_sequences set next_number=next_number+1 where org_id=$1 and document_type=$2", [org, type]);
  return `${s.prefix}${String(s.next_number).padStart(s.padding, "0")}`;
}
async function post(memo, sourceType, sourceId, projectId, lines) {
  const je = await one(
    "insert into journal_entries (org_id,entry_date,memo,source_type,source_id,project_id,created_by_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [org, day(), memo, sourceType, sourceId, projectId, uid],
  );
  for (const [accountId, debit, credit] of lines) {
    await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)", [je.id, accountId, debit, credit]);
  }
}

// Amounts with thousands and decimals, so every rule (grouping, rounding, minor units) shows.
const INV = { subtotal: 11540.5, tax: 1731.08, total: 13271.58, paid: 5000.25 };
const client = await one("insert into customers (org_id,name,client_type,email,country_code) values ($1,'Locale Client','business','client@t.dev','SA') returning id", [org]);
const vendor = await one("insert into vendors (org_id,name,email) values ($1,'Locale Vendor','vendor@t.dev') returning id", [org]);
const project = await one(
  "insert into projects (org_id,name,client_id,status,start_date,end_date,budget,description) values ($1,'Locale Project',$2,'active',$3,$4,185000.5,'Synthetic.') returning id",
  [org, client.id, day(), day(60)],
);
const invNo = await nextNumber("sales_invoice");
const inv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,project_id,status,issue_date,due_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id,invoice_type)
   values ($1,$2,$3,$4,'partially_paid',$5,$6,$7,$8,$9,$10,'SAR',1,$9,$8,$10,$11,'standard') returning id`,
  [org, invNo, client.id, project.id, day(), day(30), INV.subtotal, INV.tax, INV.total, INV.paid, uid],
);
await db.query(
  "insert into sales_invoice_items (invoice_id,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,'Synthetic service',1,$2,15,$2)",
  [inv.id, INV.subtotal],
);
await post(`Invoice ${invNo}`, "sales_invoice", inv.id, project.id, [[acc.get("1100"), INV.total, 0], [acc.get("4000"), 0, INV.subtotal], [acc.get("2100"), 0, INV.tax]]);
const pay = await one(
  `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,payment_date,method,reference,sales_invoice_id,created_by_id)
   values ($1,'in',$2,$3,'SAR',1,$3,$4,'bank_transfer',$5,$6,$7) returning id`,
  [org, bank.id, INV.paid, day(), `TRX-${invNo}`, inv.id, uid],
);
await post(`Payment for ${invNo}`, "payment", pay.id, null, [[bank.gl_account_id, INV.paid, 0], [acc.get("1100"), 0, INV.paid]]);
const poNo = await nextNumber("purchase_order");
const po = await one(
  `insert into purchase_orders (org_id,po_number,vendor_id,status,order_date,expected_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id)
   values ($1,$2,$3,'received',$4,$5,4200.65,630.1,4830.75,0,'SAR',1,4830.75,630.1,0,$6) returning id`,
  [org, poNo, vendor.id, day(), day(14), uid],
);
await post(`Purchase order ${poNo}`, "purchase_order", po.id, null, [[acc.get("1200"), 4200.65, 0], [acc.get("2100"), 630.1, 0], [acc.get("2000"), 0, 4830.75]]);
await post("Owner capital", "manual", null, null, [[bank.gl_account_id, 250000, 0], [acc.get("3000"), 0, 250000]]);
const emp = await one(
  "insert into employees (org_id,employee_code,name,email,designation,employment_type,join_date,status) values ($1,'EMP-901','Locale Employee','emp901@t.dev','Analyst','full_time',$2,'active') returning id",
  [org, day(-30)],
);
await db.query("insert into salary_structures (org_id,employee_id,basic_salary,allowances,deductions,effective_from) values ($1,$2,12500.5,3125,1250.75,$3)", [org, emp.id, day(-30)]);
check("fixture: invoice, payment, purchase order, capital and payroll inputs are in place",
  !!inv?.id && !!pay?.id && !!po?.id && !!emp?.id && acc.size > 5 && !!bank?.gl_account_id);

// ---------- the eleven #418 routes from the Stage 1 audit (reports in three variants) ----------
const ROUTES = [
  ["dashboard", "/dashboard"],
  ["client detail", `/clients/${client.id}`],
  ["vendor detail", `/purchasing/vendors/${vendor.id}`],
  ["bank accounts", "/finance/bank-accounts"],
  ["chart of accounts", "/finance/chart-of-accounts"],
  ["ledger", "/finance/ledger"],
  ["journal", "/finance/journal"],
  ["reports · profit & loss", "/finance/reports"],
  ["reports · trial balance", "/finance/reports?report=tb"],
  ["reports · AR aging", "/finance/reports?report=ar"],
  ["payroll", "/hr/payroll"],
  ["projects", "/projects"],
  ["project detail", `/projects/${project.id}`],
];
const COMBOS = [
  { browserLocale: "ar-SA", app: "ar" },
  { browserLocale: "ar-SA", app: "en" },
  { browserLocale: "en-US", app: "en" },
  { browserLocale: "en-US", app: "ar" },
];

// Every element that can carry a figure. textContent (not innerText), so a JavaScript-disabled load
// — where streamed segments sit in hidden <div id="S:…"> blocks — reads the same strings.
const FIGURES = ".num-tabular, .tb-tile .v, .acct-row .bal, td, .kpi-value, .bc-stat-row .val, .bc-bignum, .fin-profit-value, .payslip-line span";
const figures = (page) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .filter((e) => e.closest("main, div[hidden][id^='S:']"))
        .map((e) => e.textContent.replace(/\s+/g, " ").trim())
        .filter((s) => /[0-9٠-٩۰-۹]/.test(s)),
    FIGURES,
  );
const NON_WESTERN = /[٠-٩۰-۹٫٬؜]/;
const nonWesternInMain = (page, path) =>
  page.evaluate(
    ({ p, src }) => {
      const re = new RegExp(src);
      const tw = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
      const hits = [];
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!re.test(n.nodeValue)) continue;
        const el = n.parentElement;
        // DATES, not money — formatted for Arabic on the server with an explicit locale (so the
        // server and the browser agree and nothing hydrates differently). Western-digit dates are
        // DEV-UI-01.7's formatDisplayDate work, by decision.
        if (el.closest(".activity-time")) continue;
        if (p === "/hr/payroll" && el.closest(".main-head h3")) continue;
        hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${n.nodeValue.trim().slice(0, 28)}"`);
      }
      return hits;
    },
    { p: path, src: NON_WESTERN.source },
  );
const sorted = (a) => JSON.stringify([...a].sort());
const firstDiff = (a, b) => {
  const x = [...a].sort();
  const y = [...b].sort();
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `server "${y[i]}" vs hydrated "${x[i]}"`;
  return "";
};
const money2 = (v) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const balance = money2(INV.total - INV.paid);

const dump = {};
for (const combo of COMBOS) {
  const tagOf = (label) => `[browser ${combo.browserLocale} · app ${combo.app}] ${label}`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: combo.browserLocale, timezoneId: "UTC", storageState: session });
  const ssr = await browser.newContext({ viewport: VIEWPORT, locale: combo.browserLocale, timezoneId: "UTC", storageState: session, javaScriptEnabled: false });
  for (const c of [ctx, ssr]) {
    c.setDefaultTimeout(45000);
    c.setDefaultNavigationTimeout(60000);
    await c.addCookies([{ name: "locale", value: combo.app, domain: "localhost", path: "/" }]);
  }
  const page = await ctx.newPage();
  const ssrPage = await ssr.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`);
  });

  // Not vacuous: this browser really would have written the figure its own way.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const own = await page.evaluate(() => ({ lang: navigator.language, sample: (1234.5).toLocaleString() }));
  check(
    tagOf(`the browser runs in ${combo.browserLocale} and would format 1234.5 as "${combo.browserLocale === "ar-SA" ? "١٬٢٣٤٫٥" : "1,234.5"}" by itself`),
    own.lang === combo.browserLocale && own.sample === (combo.browserLocale === "ar-SA" ? "١٬٢٣٤٫٥" : "1,234.5"),
    JSON.stringify(own),
  );

  for (const [label, path] of ROUTES) {
    errors.length = 0;
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const hydrated = await figures(page);
    const nonWestern = await nonWesternInMain(page, path.split("?")[0]);
    await ssrPage.goto(BASE + path, { waitUntil: "load" });
    const served = await figures(ssrPage);
    dump[`${combo.browserLocale}|${combo.app}|${label}`] = hydrated;
    check(`${tagOf(label)}: no page error and no console error (no React #418)`, errors.length === 0, errors.slice(0, 2).join(" | "));
    check(`${tagOf(label)}: figures in Western digits (no Arabic-Indic digits or separators in the page)`, nonWestern.length === 0, nonWestern.slice(0, 3).join(" | "));
    check(
      `${tagOf(label)}: the hydrated figures are exactly the server-rendered figures`,
      hydrated.length > 0 && sorted(hydrated) === sorted(served),
      `${hydrated.length} hydrated / ${served.length} served; ${firstDiff(hydrated, served)}`,
    );
  }

  // Record Payment: the document balances in this dialog are formatted in the browser only.
  errors.length = 0;
  await page.goto(`${BASE}/finance/payments`, { waitUntil: "networkidle" });
  await page.locator(".main-head button").first().click();
  await page.locator("#pay-source").click();
  await page.waitForTimeout(300);
  const options = await page.locator("[role=option]").allInnerTexts();
  check(
    tagOf(`Record Payment: the open invoice's balance reads "${balance}" in Western digits`),
    options.some((o) => o.includes(balance)) && !options.some((o) => NON_WESTERN.test(o)),
    options.join(" | ").slice(0, 160),
  );
  await page.locator("[role=option]").first().click();
  const placeholder = await page.locator("#pay-amount").getAttribute("placeholder");
  check(tagOf(`Record Payment: the amount placeholder reads "${balance}"`), placeholder === balance, String(placeholder));
  await page.keyboard.press("Escape");

  await ctx.close();
  await ssr.close();
}

if (process.env.AR_LOCALE_DUMP) writeFileSync(process.env.AR_LOCALE_DUMP, JSON.stringify(dump, null, 1));

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) {
  if (!c) ok = false;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x && !c ? "  << " + x : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "AR LOCALE HYDRATION PASS" : "AR LOCALE HYDRATION FAIL");
process.exit(ok ? 0 : 1);
