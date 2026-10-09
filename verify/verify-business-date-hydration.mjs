/**
 * Pre-DEV-UI-01.7 (P0.2) — business dates are calendar dates: the same in every browser time zone,
 * on the screen and in what is saved.
 *
 * Two defects:
 *  1. Credit Notes and Debit Notes counted "This Month" in the hydrated list component with
 *     `new Date(issueDate).getMonth()` against the browser's own `new Date()`. West of UTC a note
 *     dated the 1st reads as the previous month; east of UTC the browser turns the month hours
 *     before the server does. The server rendered one count, the browser another: React #418.
 *  2. The Valid Till and Expected Delivery helpers parsed "YYYY-MM-DD" at local midnight and wrote
 *     it back in UTC: in Riyadh or Dhaka 2026-10-09 + 30 days was 2026-11-07 — the date saved.
 *
 * Fixture: a fresh TEST-only org with four credit notes and four debit notes dated the last day of
 * the previous UTC month, the 1st, the 15th and the last day of the current UTC month. The
 * browser's clock is pinned to 22:30 UTC on the current month's last day — still this month in
 * UTC and New York, already next month in Riyadh and Dhaka. The server keeps its real clock (same
 * UTC month).
 *
 * "This Month", for browser zones UTC, Asia/Riyadh, America/New_York, Asia/Dhaka × app en (en-US
 * browser) / ar (ar-SA browser), on both lists:
 *   1. the browser's own calendar really disagrees with UTC for this fixture (non-vacuous);
 *   2. no page error and no console error — no #418;
 *   3. the hydrated count is exactly the JavaScript-disabled server count;
 *   4. and it is the UTC answer, 3 (the 1st, the 15th, the last day; not the previous month's);
 * then one count across all zones and both languages.
 *
 * Valid Till (quotation) and Expected Delivery (sales order, purchase order), in the four zones:
 * base date 2026-10-09 + 30 days — the dialog's preview, the field after Apply (for the
 * quotation, the auto-computed Valid Till), and the date the saved draft holds in the database:
 * 2026-11-08 every time.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `bizdate_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const VIEWPORT = { width: 1440, height: 950 };

// ---------- fixture org ----------
const regCtx = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", timezoneId: "UTC" });
regCtx.setDefaultTimeout(45000);
regCtx.setDefaultNavigationTimeout(60000);
const reg = await regCtx.newPage();
await reg.goto(`${BASE}/register`);
await reg.fill('input[name="orgName"]', "Business Date Co");
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

// The current UTC month and the dates either side of its boundaries.
const now = new Date();
const Y = now.getUTCFullYear();
const M = now.getUTCMonth();
const ymd = (d) => d.toISOString().slice(0, 10);
const MONTH_KEY = ymd(now).slice(0, 7);
const PREV_LAST = ymd(new Date(Date.UTC(Y, M, 0)));
const FIRST = ymd(new Date(Date.UTC(Y, M, 1)));
const MID = ymd(new Date(Date.UTC(Y, M, 15)));
const LAST = ymd(new Date(Date.UTC(Y, M + 1, 0)));
const DATES = [PREV_LAST, FIRST, MID, LAST];
const EXPECTED = DATES.filter((d) => d.slice(0, 7) === MONTH_KEY).length; // 3
// 22:30 UTC on the last day: this month in UTC and New York, next month in Riyadh (+3) and Dhaka (+6).
const BROWSER_NOW = new Date(`${LAST}T22:30:00Z`);

const customer = await one("insert into customers (org_id,name,client_type,email,country_code) values ($1,'Acme Co','business','acme@t.dev','SA') returning id", [org]);
const vendor = await one("insert into vendors (org_id,name,email) values ($1,'Northbound Steel','ns@t.dev') returning id", [org]);
const inv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,status,issue_date,due_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id,invoice_type)
   values ($1,'INV-BD-1',$2,'issued',$3,$3,100,15,115,0,'SAR',1,115,15,0,$4,'standard') returning id`,
  [org, customer.id, PREV_LAST, uid],
);
const po = await one(
  `insert into purchase_orders (org_id,po_number,vendor_id,status,order_date,expected_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id)
   values ($1,'PO-BD-1',$2,'received',$3,$3,100,15,115,0,'SAR',1,115,15,0,$4) returning id`,
  [org, vendor.id, PREV_LAST, uid],
);
for (const [i, d] of DATES.entries()) {
  await db.query("insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,created_by_id) values ($1,$2,$3,$4,$5,$6)", [org, `CN-BD-${i + 1}`, customer.id, inv.id, d, uid]);
  await db.query("insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,created_by_id) values ($1,$2,$3,$4,$5,$6)", [org, `DN-BD-${i + 1}`, vendor.id, po.id, d, uid]);
}
const seeded = await one("select (select count(*) from credit_notes where org_id=$1)::int as cn, (select count(*) from debit_notes where org_id=$1)::int as dn", [org]);
check(`fixture: four credit and four debit notes dated ${DATES.join(", ")} (UTC month ${MONTH_KEY}: ${EXPECTED} in it)`, seeded.cn === 4 && seeded.dn === 4 && EXPECTED === 3, JSON.stringify(seeded));

const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka"];
const LANGS = [
  { app: "en", browserLocale: "en-US" },
  { app: "ar", browserLocale: "ar-SA" },
];
const LISTS = [
  ["Credit Notes", "/sales/credit-notes"],
  ["Debit Notes", "/purchasing/debit-notes"],
];

async function contexts(zone, lang, js = true) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: lang.browserLocale, timezoneId: zone, storageState: session, javaScriptEnabled: js });
  ctx.setDefaultTimeout(45000);
  ctx.setDefaultNavigationTimeout(60000);
  await ctx.addCookies([{ name: "locale", value: lang.app, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  if (js) await page.clock.setFixedTime(BROWSER_NOW);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`);
  });
  return { ctx, page, errors };
}

// textContent, so a JavaScript-disabled load (streamed segments in hidden <div id="S:…">) reads the same.
const thisMonth = () => {
  const card = [...document.querySelectorAll(".stat-row-2 .card")].find((c) => ["This Month", "هذا الشهر"].includes(c.querySelector(".kpi-label")?.textContent.trim()));
  return card?.querySelector(".kpi-value")?.textContent.trim() ?? null;
};

// ---------- 1. "This Month" on both lists ----------
const seen = {}; // list → `${zone}|${app}` → hydrated count
for (const lang of LANGS) {
  for (const zone of ZONES) {
    const tag = (label) => `[${zone} · ${lang.app}] ${label}`;
    const live = await contexts(zone, lang);
    const ssr = await contexts(zone, lang, false);

    // Not vacuous: this browser's own calendar disagrees with UTC about this fixture.
    await live.page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const own = await live.page.evaluate((first) => {
      const n = new Date();
      const pad = (x) => String(x).padStart(2, "0");
      const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: local(n), first: local(new Date(first)) };
    }, FIRST);
    const disagrees = own.now !== MONTH_KEY || own.first !== MONTH_KEY;
    check(
      tag(zone === "UTC"
        ? `the browser runs in UTC, clock at ${BROWSER_NOW.toISOString()}: its own calendar says ${own.now}, and ${FIRST} is ${own.first} — the same as UTC`
        : `the browser runs in ${zone}, clock at ${BROWSER_NOW.toISOString()}: its own calendar says ${own.now}, and ${FIRST} is ${own.first} — not UTC's ${MONTH_KEY}`),
      own.zone === zone && (zone === "UTC" ? !disagrees : disagrees),
      JSON.stringify(own),
    );

    for (const [label, path] of LISTS) {
      live.errors.length = 0;
      await live.page.goto(BASE + path, { waitUntil: "networkidle" });
      await live.page.waitForTimeout(800);
      const hydrated = await live.page.evaluate(thisMonth);
      await ssr.page.goto(BASE + path, { waitUntil: "load" });
      const served = await ssr.page.evaluate(thisMonth);
      ((seen[label] ??= {})[`${zone}|${lang.app}`] = hydrated);
      check(tag(`${label}: no page error and no console error (no React #418)`), live.errors.length === 0, live.errors.slice(0, 2).join(" | "));
      check(tag(`${label}: the hydrated "This Month" is exactly the server-rendered count`), hydrated !== null && hydrated === served, `server "${served}" vs hydrated "${hydrated}"`);
      check(tag(`${label}: "This Month" is ${EXPECTED} — the notes dated in the UTC month ${MONTH_KEY}`), hydrated === String(EXPECTED), `"${hydrated}"`);
    }
    await live.ctx.close();
    await ssr.ctx.close();
  }
}
for (const [label] of LISTS) {
  const values = Object.entries(seen[label] ?? {});
  check(`${label}: one "This Month" in UTC, Asia/Riyadh, America/New_York and Asia/Dhaka, in English and Arabic`,
    values.length === ZONES.length * LANGS.length && values.every(([, v]) => v === values[0][1]),
    values.map(([k, v]) => `${k}=${v}`).join(" · "));
}

// ---------- 2. Valid Till / Expected Delivery: preview, field and saved date ----------
const BASE_DATE = "2026-10-09";
const WANT = "2026-11-08";
const field = (page, label) => page.locator(".doc-field").filter({ has: page.locator("label", { hasText: label }) }).locator("input[type=date]").first();
const preview = (dialog) => dialog.locator("p.text-ink-faint .num-tabular").allTextContents();

async function fillItem(page) {
  const row = page.locator(".doc-items-table .item-row").first();
  await row.getByPlaceholder("Item name").fill("Fixture item");
  const nums = row.locator("input[type=number]");
  await nums.nth(1).fill("1");
  await nums.nth(2).fill("100");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
}
async function saveDraft(page, re) {
  await page.locator(".doc-action-bar").getByRole("button", { name: /^Save as Draft$/ }).click();
  await page.waitForURL(re, { timeout: 30000 });
  return Number(page.url().match(/\/(\d+)$/)[1]);
}

const FLOWS = [
  {
    label: "Quotation · Valid Till",
    path: "/sales/quotations/new",
    baseLabel: "Quotation Date",
    targetLabel: "Valid Till Date",
    gear: "Set validity period",
    party: ["To Client", /Acme Co/],
    saved: /\/sales\/quotations\/\d+$/,
    query: "select valid_until::text as d from quotations where id=$1",
  },
  {
    label: "Sales Order · Expected Delivery",
    path: "/sales/orders/new",
    baseLabel: "Order Date",
    targetLabel: "Expected Delivery",
    gear: "Set expected delivery",
    party: ["To Client", /Acme Co/],
    saved: /\/sales\/orders\/\d+$/,
    query: "select expected_date::text as d from sales_orders where id=$1",
  },
  {
    label: "Purchase Order · Expected Delivery",
    path: "/purchasing/orders/new",
    baseLabel: "Order Date",
    targetLabel: "Expected Delivery",
    gear: "Set expected delivery",
    party: ["To Vendor", /Northbound Steel/],
    saved: /\/purchasing\/orders\/\d+$/,
    query: "select expected_date::text as d from purchase_orders where id=$1",
  },
];
for (const zone of ZONES) {
  const { ctx, page, errors } = await contexts(zone, LANGS[0]);
  for (const f of FLOWS) {
    const tag = (label) => `[${zone}] ${f.label}: ${label}`;
    errors.length = 0;
    await page.goto(BASE + f.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await field(page, f.baseLabel).fill(BASE_DATE);
    await page.waitForTimeout(200);
    const auto = f.label.startsWith("Quotation") ? await field(page, f.targetLabel).inputValue() : null;
    await page.getByRole("button", { name: f.gear }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const days = dialog.locator("input[type=number]");
    await days.fill("30");
    const [shownBase, shownTarget] = await preview(dialog);
    check(tag(`the dialog previews ${BASE_DATE} → ${WANT}`), shownBase === BASE_DATE && shownTarget === WANT, `"${shownBase}" → "${shownTarget}"`);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await dialog.waitFor({ state: "detached" }).catch(() => {});
    await page.waitForTimeout(300);
    const value = await field(page, f.targetLabel).inputValue();
    check(tag(`the field holds ${WANT}${auto !== null ? ` (and auto-computed ${WANT} before the dialog)` : ""}`), value === WANT && (auto === null || auto === WANT), `field "${value}"${auto !== null ? `, auto "${auto}"` : ""}`);
    await page.locator(".party-card-v2").getByRole("button", { name: f.party[0] }).click();
    await page.getByRole("option", { name: f.party[1] }).first().click();
    await fillItem(page);
    const id = await saveDraft(page, f.saved);
    const row = await one(f.query, [id]);
    check(tag(`the saved draft #${id} holds ${WANT}`), row?.d === WANT, `saved "${row?.d}"`);
    check(tag("no page error and no console error"), errors.length === 0, errors.slice(0, 2).join(" | "));
  }
  await ctx.close();
}

// The UTC month cannot have turned while this ran, or the server's month and the fixture's differ.
check(`the UTC month was ${MONTH_KEY} for the whole run`, new Date().toISOString().slice(0, 7) === MONTH_KEY, new Date().toISOString());

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) {
  if (!c) ok = false;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x && !c ? "  << " + x : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "BUSINESS DATE HYDRATION PASS" : "BUSINESS DATE HYDRATION FAIL");
process.exit(ok ? 0 : 1);
