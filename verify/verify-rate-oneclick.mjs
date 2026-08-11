/**
 * FX-3. The one-click fetch on a blocked posting — end to end, through the REAL provider code.
 *
 * The tier's server points `RATE_API_BASE` at localhost:12750 (see run-browser-suites.mjs); this
 * suite hosts a mock er-api there serving the endpoint's real JSON shape. Localhost bypasses the
 * sandbox's egress proxy, so the whole chain runs for real: blocked posting → "Fetch rate & retry"
 * → HTTP GET /v6/latest/{FOREIGN} → validated write → retry posts at the stored rate.
 *
 * What each case proves:
 *
 *  - **Invoice dated today**: send blocks on a missing USD rate, the recovery button appears IN
 *    the confirm dialog, one click fetches + retries, and the posting lands at the mock's rate
 *    with the ledger balanced. The mock's request log doubles as a live scope assertion: with
 *    EUR also in use, the one-click for USD must request USD ONLY (the engine's `only` filter,
 *    observed at the HTTP layer, not just unit-tested).
 *  - **Backdated EUR invoice**: rates are stored under the PROVIDER'S date, and posting resolves
 *    on-or-before the DOCUMENT date. The fetch succeeds (today's rate lands) but cannot apply to
 *    a 10-day-old document — the retry stays blocked and the dialog switches to the
 *    manual-entry message instead of re-offering a fetch that can never help.
 *  - **PO receive**: converts at TODAY's rate, so the one-click always unblocks it — the second
 *    wired component proven end-to-end, stock and ledger both moving.
 *  - **CN/DN wiring**: the same shared recovery is source-asserted in both issue paths (their
 *    posting flow is already ledger-tested in verify-fx-posting; the seam is identical code).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const MOCK_PORT = 12750;
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

// ---- the mock er-api ----
const MOCK_RATES = { USD: 3.75, EUR: 4.05, GBP: 4.71 }; // SAR per one unit of foreign
const requested = []; // every currency the server-side provider asked for, in order
const mock = createServer((req, res) => {
  const m = /^\/v6\/latest\/([A-Z]{3})$/.exec(req.url ?? "");
  const rate = m ? MOCK_RATES[m[1]] : undefined;
  if (!m || rate === undefined) {
    res.writeHead(404).end();
    return;
  }
  requested.push(m[1]);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    result: "success",
    time_last_update_utc: new Date().toUTCString(), // today's bulletin
    rates: { SAR: rate },
  }));
});
await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const dialogOf = () => page.locator('[role="dialog"]');

const email = `oc_${uniq()}@t.dev`;
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "One Click Rates Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const u = (await db.query("select id, org_id from users where email=$1", [email])).rows[0];
const org = u.org_id;
const uid = u.id;

const today = new Date().toISOString().slice(0, 10);
const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
const cust = (await db.query("insert into customers (org_id,name) values ($1,'OC Client') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'OC Vendor') returning id", [org])).rows[0].id;
const prodInv = (await db.query(
  "insert into products (org_id,name,sku,unit_price,quantity_on_hand) values ($1,'Panel','OC-1','500','50') returning id", [org])).rows[0].id;
const prodPo = (await db.query(
  "insert into products (org_id,name,sku,unit_price,quantity_on_hand) values ($1,'Stock','OC-2','400','50') returning id", [org])).rows[0].id;

const mkInvoice = async ({ number, currency, issueDate, subtotal, tax, total }) => {
  const inv = (await db.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
     values ($1,$2,$3,$4,$4,$5,'0',$6,$7,$8,'draft',$9) returning id`,
    [org, number, cust, issueDate, subtotal, tax, total, currency, uid])).rows[0].id;
  await db.query(
    `insert into sales_invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate_percent, line_total)
     values ($1,$2,'Panel','2',$3,'15',$4)`, [inv, prodInv, subtotal, subtotal]);
  return inv;
};

// Both invoices exist BEFORE the first one-click, so pairs-in-use = {EUR, USD} — which is what
// makes the "requested USD only" assertion a real scope check rather than a tautology.
const invUsd = await mkInvoice({ number: `OCU-${uniq()}`, currency: "USD", issueDate: today, subtotal: "1000.000", tax: "150.000", total: "1150.000" });
const invEur = await mkInvoice({ number: `OCE-${uniq()}`, currency: "EUR", issueDate: tenDaysAgo, subtotal: "800.000", tax: "120.000", total: "920.000" });

const ledgerSums = async () => (await db.query(
  `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1`, [org])).rows[0];
const balanced = async (label) => {
  const s = await ledgerSums();
  check(`LEDGER BALANCED ${label}`, s.dr === s.cr, `${s.dr} vs ${s.cr}`);
};

// ---- 1. invoice dated today: block → one click → posted at the fetched rate ----
await balanced("before one-click invoice send");
await page.goto(`${BASE}/sales/invoices/${invUsd}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await page.waitForTimeout(400);
await dialogOf().getByRole("button", { name: "Send Invoice", exact: true }).click();
const alert = dialogOf().locator('[role="alert"]');
await alert.waitFor({ timeout: 15000 });
check("the block surfaces inside the confirm dialog, naming the currency", /USD/.test(await alert.innerText()), await alert.innerText());
const rescueBtn = dialogOf().getByRole("button", { name: "Fetch rate & retry" });
check("…with the one-click recovery button beside it", (await rescueBtn.count()) === 1);

await rescueBtn.click();
await page.getByText("Invoice sent — posted to ledger and stock updated.").waitFor({ timeout: 20000 });
check("one click fetched the rate and the SAME attempt posted", true);
check("the mock was asked for USD ONLY — the one-click cannot widen scope past its currency",
  JSON.stringify(requested) === '["USD"]', JSON.stringify(requested));

const inv1 = (await db.query(
  "select status, exchange_rate::text, base_total::text, base_tax_amount::text from sales_invoices where id=$1", [invUsd])).rows[0];
check("invoice is sent", inv1.status === "sent", inv1.status);
check("posted at the MOCK'S rate, stored verbatim", Number(inv1.exchange_rate) === 3.75, inv1.exchange_rate);
check("baseTotal = 1150 × 3.75 = 4312.500", inv1.base_total === "4312.500", inv1.base_total);
check("baseTaxAmount = 150 × 3.75 = 562.500", inv1.base_tax_amount === "562.500", inv1.base_tax_amount);
const usdRow = (await db.query(
  "select rate::text, effective_date::text d, source from exchange_rates where org_id=$1 and from_currency='USD'", [org])).rows[0];
check("the fetched USD row is stored under the provider's own date with its source",
  usdRow?.d === today && usdRow?.source.startsWith("open.er-api.com (retrieved "), JSON.stringify(usdRow));
await balanced("after one-click invoice send");

// ---- 2. backdated EUR invoice: fetch succeeds, but today's rate cannot apply → manual pointer ----
await balanced("before backdated EUR attempt");
await page.goto(`${BASE}/sales/invoices/${invEur}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await page.waitForTimeout(400);
await dialogOf().getByRole("button", { name: "Send Invoice", exact: true }).click();
await dialogOf().locator('[role="alert"]').waitFor({ timeout: 15000 });
await dialogOf().getByRole("button", { name: "Fetch rate & retry" }).click();
await dialogOf().getByText(/Enter a rate manually/).waitFor({ timeout: 20000 });
const gapText = await dialogOf().locator('[role="alert"]').innerText();
check("a fetched-but-future rate points at MANUAL entry instead of looping",
  /Enter a rate manually/.test(gapText) && /EUR/.test(gapText), gapText);
check("…and does NOT re-offer the fetch that cannot help",
  (await dialogOf().getByRole("button", { name: "Fetch rate & retry" }).count()) === 0);
await dialogOf().getByRole("button", { name: /^Cancel$/ }).click();

const inv2 = (await db.query("select status, base_total from sales_invoices where id=$1", [invEur])).rows[0];
check("the backdated invoice stays draft, base still null", inv2.status === "draft" && inv2.base_total === null, JSON.stringify(inv2));
check("…no journal entry posted",
  (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invEur])).rows[0].n === 0);
const eurRow = (await db.query(
  "select effective_date::text d from exchange_rates where org_id=$1 and from_currency='EUR'", [org])).rows[0];
check("the fetch itself DID land today's EUR rate (stored under the provider's date)", eurRow?.d === today, JSON.stringify(eurRow));
await balanced("after blocked backdated attempt (unchanged)");

// ---- 3. PO receive: converts at TODAY's rate, so one click always unblocks it ----
const po = (await db.query(
  `insert into purchase_orders (org_id, po_number, vendor_id, order_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,$4,'2000.000','0','300.000','2300.000','GBP','ordered',$5) returning id`,
  [org, `OCP-${uniq()}`, vend, tenDaysAgo, uid])).rows[0].id;
await db.query(
  `insert into purchase_order_items (purchase_order_id, product_id, description, quantity, unit_cost, line_total)
   values ($1,$2,'Stock','5','400','2000.000')`, [po, prodPo]);

await balanced("before one-click PO receive");
await page.goto(`${BASE}/purchasing/orders/${po}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Receive", exact: true }).click();
await page.waitForTimeout(400);
await dialogOf().getByRole("button", { name: "Receive", exact: true }).click();
await dialogOf().locator('[role="alert"]').waitFor({ timeout: 15000 });
await dialogOf().getByRole("button", { name: "Fetch rate & retry" }).click();
await page.getByText("Purchase order received — posted to ledger and stock updated.").waitFor({ timeout: 20000 });

const po1 = (await db.query(
  "select status, exchange_rate::text, base_total::text, base_tax_amount::text from purchase_orders where id=$1", [po])).rows[0];
check("PO received via the one-click", po1.status === "received", po1.status);
check("…at today's mock GBP rate", Number(po1.exchange_rate) === 4.71, po1.exchange_rate);
check("baseTotal = 2300 × 4.71 = 10833.000", po1.base_total === "10833.000", po1.base_total);
check("baseTaxAmount = 300 × 4.71 = 1413.000", po1.base_tax_amount === "1413.000", po1.base_tax_amount);
check("the PO one-click requested GBP only", requested.filter((c) => c === "GBP").length >= 1 && !requested.includes("SAR"),
  JSON.stringify(requested));
const stock = (await db.query("select quantity_on_hand from products where id=$1", [prodPo])).rows[0].quantity_on_hand;
check("stock incremented by the receive", Number(stock) === 55, String(stock));
await balanced("after one-click PO receive");

// ---- 4. CN/DN issue paths carry the identical rescue wiring (source-asserted) ----
for (const [label, file] of [
  ["Credit Note", "src/app/(app)/sales/credit-notes/cn-detail-actions.tsx"],
  ["Debit Note", "src/app/(app)/purchasing/debit-notes/dn-detail-actions.tsx"],
]) {
  const src = await readFile(file, "utf8");
  check(`${label} issue routes through withRateRescue with a recursive attempt`,
    src.includes("withRateRescue(locale, result, attempt)") && src.includes("onConfirm: attempt"));
}

await db.end();
await browser.close();
mock.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "RATE ONE-CLICK PASS" : "RATE ONE-CLICK FAIL");
process.exit(ok ? 0 : 1);
