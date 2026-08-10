/**
 * FX-6. Posting-time rate capture, one path per commit — this file grows with each.
 *
 * The standing rule this suite exists to enforce: **no posting-path change ships without a
 * ledger-balance test run before and after** — debits equal credits in base currency, at three
 * decimals, on every path. Every posting event here is bracketed by `ledgerBalanced()` checks, and
 * every per-entry assertion compares exact decimal strings, not tolerances.
 *
 * What each case is FOR:
 *
 *  - **Base-currency send with a DISCOUNT, in an org with an empty rate table.** The no-regression
 *    case for every existing user — a SAR org that never entered a rate must post exactly as
 *    before. The discount is not decoration: the old lines credited the full subtotal against a
 *    discounted total, unbalancing the entry by the discount. The new lines derive the revenue
 *    figure, so this case proves the entry balances by construction.
 *  - **Foreign send with no rate BLOCKS.** No fallback to 1.0, no posting unconverted: status
 *    stays draft, no entry, base columns stay null. Paired with the same document posting
 *    successfully after a rate is entered — same row, no re-creation.
 *  - **The rate is the DOCUMENT date's, not today's.** Two dated rates; a backdated invoice must
 *    pick the older one. This is the assertion the mutation test breaks (capture-with-today).
 *  - **Void reverses what was POSTED.** A newer rate is inserted before voiding; the reversal must
 *    mirror the original entry's lines — the stored conversion — not a fresh lookup.
 *  - **A 3-decimal base org.** BHD base, USD invoice: base amounts land at three decimals and the
 *    entry balances at the third decimal exactly.
 *  - **The FX-5 gap closes.** Base columns are filled BY the posting, asserted null-before /
 *    valued-after with no backfill run.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });

/** Register an org through the real UI and return { page, org, uid }. */
async function registerOrg(orgName, country) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(45000);
  ctx.setDefaultNavigationTimeout(60000);
  const page = await ctx.newPage();
  const email = `fxp_${uniq()}@t.dev`;
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="orgName"]', orgName);
  await page.fill('input[name="name"]', "Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pass);
  const cf = page.locator('input[name="confirmPassword"]');
  if (await cf.count()) await cf.fill(pass);
  await pickCountry(page, country);
  await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
  const u = (await db.query("select id, org_id from users where email=$1", [email])).rows[0];
  return { page, org: u.org_id, uid: u.id };
}

const dialogOf = (page) => page.locator('[role="dialog"]');

/** Sum of all journal debits/credits for an org, as exact numeric strings at scale 3. */
async function ledgerSums(org) {
  const r = await db.query(
    `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
       from journal_lines l join journal_entries e on e.id = l.journal_entry_id
      where e.org_id = $1`, [org]);
  return r.rows[0];
}
async function checkLedgerBalanced(org, label) {
  const s = await ledgerSums(org);
  check(`LEDGER BALANCED ${label}`, s.dr === s.cr, `${s.dr} vs ${s.cr}`);
}

/** The lines of the Nth journal entry (by id) for a source document, sorted by account code. */
async function entriesFor(org, sourceType, sourceId) {
  const r = await db.query(
    `select e.id, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text) order by a.code)
                     from journal_lines l join accounts a on a.id = l.account_id where l.journal_entry_id = e.id) lines
       from journal_entries e where e.org_id=$1 and e.source_type=$2 and e.source_id=$3 order by e.id`,
    [org, sourceType, sourceId]);
  return r.rows;
}

const line = (entry, code) => (entry.lines || []).find((l) => l.code === code);

// ================= Org A: SAR base, EMPTY rate table =================
const A = await registerOrg("FX Posting SAR", "Saudi Arabia");
const custA = (await db.query("insert into customers (org_id,name) values ($1,'FX Client') returning id", [A.org])).rows[0].id;
const prodA = (await db.query(
  "insert into products (org_id,name,sku,unit_price,quantity_on_hand) values ($1,'Panel','FXP-1','500','50') returning id", [A.org])).rows[0].id;

const noRates = (await db.query("select count(*)::int n from exchange_rates where org_id=$1", [A.org])).rows[0].n;
check("PRECONDITION: the SAR org has an EMPTY rate table", noRates === 0, `n=${noRates}`);

const mkInvoice = async (org, uid, cust, { number, currency, issueDate, subtotal, discount, tax, total }) => {
  const inv = (await db.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
     values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'draft',$10) returning id`,
    [org, number, cust, issueDate, subtotal, discount, tax, total, currency, uid])).rows[0].id;
  await db.query(
    `insert into sales_invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate_percent, line_total)
     values ($1,$2,'Panel','2',$3,$4,$5)`, [inv, prodA, subtotal, "15", subtotal]);
  return inv;
};

// A discounted SAR invoice: 1000 − 100 discount = 900 net, 15% VAT = 135, total 1035.
const invBase = await mkInvoice(A.org, A.uid, custA, {
  number: `FXA-${uniq()}`, currency: null, issueDate: "2026-03-15",
  subtotal: "1000.000", discount: "100.000", tax: "135.000", total: "1035.000",
});
// A USD invoice, backdated to sit BETWEEN the two rates seeded later.
const invUsdNo = `FXU-${uniq()}`;
const invUsd = await mkInvoice(A.org, A.uid, custA, {
  number: invUsdNo, currency: "USD", issueDate: "2026-03-15",
  subtotal: "1000.000", discount: "0", tax: "150.000", total: "1150.000",
});

// ---- Case A: base-currency send, discount, no rate table ----
await checkLedgerBalanced(A.org, "before base-currency send");
const b0 = (await db.query("select base_total from sales_invoices where id=$1", [invBase])).rows[0];
check("base columns are NULL before posting (FX-5 gap, pre)", b0.base_total === null, String(b0.base_total));

await A.page.goto(`${BASE}/sales/invoices/${invBase}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(400);
await dialogOf(A.page).getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(2000);

const a1 = (await db.query("select status, exchange_rate, base_total, base_tax_amount, base_paid_amount from sales_invoices where id=$1", [invBase])).rows[0];
check("SAR invoice sent with an empty rate table (no-regression)", a1.status === "sent", a1.status);
check("identity rate stored", Number(a1.exchange_rate) === 1, String(a1.exchange_rate));
check("baseTotal = total (FX-5 gap closed BY POSTING, no backfill ran)", a1.base_total === "1035.000", String(a1.base_total));
check("baseTaxAmount = taxTotal", a1.base_tax_amount === "135.000", String(a1.base_tax_amount));
check("basePaidAmount initialised to zero", a1.base_paid_amount === "0.000", String(a1.base_paid_amount));

const aEntries = await entriesFor(A.org, "sales_invoice", invBase);
check("exactly one posting entry", aEntries.length === 1, `n=${aEntries.length}`);
const aE = aEntries[0];
check("Dr AR = baseTotal 1035.000", line(aE, "1100")?.debit === "1035.000", JSON.stringify(aE.lines));
check("Cr Revenue = 900.000 — DERIVED net of discount, the old lines credited 1000", line(aE, "4000")?.credit === "900.000", line(aE, "4000")?.credit);
check("Cr VAT = 135.000", line(aE, "2100")?.credit === "135.000", line(aE, "2100")?.credit);
check("the DISCOUNTED entry balances exactly (old shape was off by the 100 discount)",
  Number(line(aE, "1100")?.debit) === Number(line(aE, "4000")?.credit) + Number(line(aE, "2100")?.credit));
await checkLedgerBalanced(A.org, "after base-currency send");
const stock = (await db.query("select quantity_on_hand from products where id=$1", [prodA])).rows[0].quantity_on_hand;
check("stock decremented as before", Number(stock) === 48, String(stock));

// ---- Case B: foreign send with NO rate blocks ----
await checkLedgerBalanced(A.org, "before blocked send");
await A.page.goto(`${BASE}/sales/invoices/${invUsd}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(400);
await dialogOf(A.page).getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(2000);

const b1 = (await db.query("select status, exchange_rate, base_total from sales_invoices where id=$1", [invUsd])).rows[0];
check("missing rate BLOCKS: status still draft", b1.status === "draft", b1.status);
check("…no rate invented", b1.exchange_rate === null, String(b1.exchange_rate));
check("…base stays null (unconverted, known bad)", b1.base_total === null, String(b1.base_total));
check("…and NO journal entry was posted", (await entriesFor(A.org, "sales_invoice", invUsd)).length === 0);
const blockText = await A.page.locator("body").innerText();
check("the block names the currency and the date", /USD/.test(blockText) && /2026-03-15/.test(blockText),
  blockText.match(/No USD[^.]*\./)?.[0] ?? "(message not found on page)");
await checkLedgerBalanced(A.org, "after blocked send (unchanged)");

// ---- Case C: rate entered → SAME document posts; document date wins over today ----
// Two rates: only the OLDER one is on-or-before the invoice's 2026-03-15. A lookup keyed on
// today's date would pick 3.75 — that is exactly the mutation this suite is proof against.
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','3.70000000','2026-01-01','manual'), ($1,'USD','SAR','3.75000000','2026-06-01','manual')`,
  [A.org]);

await A.page.goto(`${BASE}/sales/invoices/${invUsd}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(400);
await dialogOf(A.page).getByRole("button", { name: "Send Invoice", exact: true }).click();
await A.page.waitForTimeout(2000);

const c1 = (await db.query("select status, exchange_rate, base_total, base_tax_amount from sales_invoices where id=$1", [invUsd])).rows[0];
check("the SAME blocked document posts once a rate exists (no re-creation)", c1.status === "sent", c1.status);
check("the DOCUMENT date's rate was used (3.70), not today's (3.75)", c1.exchange_rate === "3.70000000", String(c1.exchange_rate));
check("baseTotal = 1150 × 3.70 = 4255.00", c1.base_total === "4255.000", String(c1.base_total));
check("baseTaxAmount = 150 × 3.70 = 555.00", c1.base_tax_amount === "555.000", String(c1.base_tax_amount));

const cEntries = await entriesFor(A.org, "sales_invoice", invUsd);
check("one posting entry for the USD invoice", cEntries.length === 1, `n=${cEntries.length}`);
const cE = cEntries[0];
check("USD entry posts in BASE currency: Dr AR 4255.000", line(cE, "1100")?.debit === "4255.000", JSON.stringify(cE.lines));
check("Cr Revenue 3700.000 (derived)", line(cE, "4000")?.credit === "3700.000", line(cE, "4000")?.credit);
check("Cr VAT 555.000", line(cE, "2100")?.credit === "555.000", line(cE, "2100")?.credit);
await checkLedgerBalanced(A.org, "after foreign send");

// ---- Case D: void reverses the STORED posting, not a fresh lookup ----
// A newer rate lands BEFORE the void. If the reversal did any lookup at all it would find 3.80;
// mirroring the original entry cannot.
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','3.80000000','2026-08-01','manual')`, [A.org]);

await A.page.goto(`${BASE}/sales/invoices/${invUsd}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: "Void", exact: true }).click();
await A.page.waitForTimeout(400);
await dialogOf(A.page).getByRole("button", { name: "Void", exact: true }).click();
await A.page.waitForTimeout(2000);

const dEntries = await entriesFor(A.org, "sales_invoice", invUsd);
check("void added exactly one reversal entry", dEntries.length === 2, `n=${dEntries.length}`);
const dE = dEntries[1];
check("reversal mirrors the STORED amounts: Cr AR 4255.000 (not 3.80-based 4370)", line(dE, "1100")?.credit === "4255.000", JSON.stringify(dE.lines));
check("reversal Dr Revenue 3700.000", line(dE, "4000")?.debit === "3700.000", line(dE, "4000")?.debit);
check("reversal Dr VAT 555.000", line(dE, "2100")?.debit === "555.000", line(dE, "2100")?.debit);
await checkLedgerBalanced(A.org, "after void");

// ================= Org B: BHD base (3 decimals) =================
const B = await registerOrg("FX Posting BHD", "Bahrain");
const orgBCur = (await db.query("select currency from orgs where id=$1", [B.org])).rows[0].currency;
check("the Bahrain org's base currency is BHD", orgBCur === "BHD", orgBCur);

const custB = (await db.query("insert into customers (org_id,name) values ($1,'FX Client BH') returning id", [B.org])).rows[0].id;
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','BHD','0.37600000','2026-01-01','manual')`, [B.org]);

// USD 1001.000 (tax 91.000) at 0.376 → BHD 376.376 / 34.216 — genuine third decimals.
const invBhd = (await db.query(
  `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,'2026-03-15','2026-03-15','910.000','0','91.000','1001.000','USD','draft',$4) returning id`,
  [B.org, `FXB-${uniq()}`, custB, B.uid])).rows[0].id;
await db.query(
  `insert into sales_invoice_items (invoice_id, description, quantity, unit_price, tax_rate_percent, line_total)
   values ($1,'Service','1','910.000','10','910.000')`, [invBhd]);

await checkLedgerBalanced(B.org, "BHD org before send");
await B.page.goto(`${BASE}/sales/invoices/${invBhd}`, { waitUntil: "networkidle" });
await B.page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await B.page.waitForTimeout(400);
await dialogOf(B.page).getByRole("button", { name: "Send Invoice", exact: true }).click();
await B.page.waitForTimeout(2000);

const e1 = (await db.query("select status, exchange_rate, base_total, base_tax_amount from sales_invoices where id=$1", [invBhd])).rows[0];
check("USD invoice posts in the BHD org", e1.status === "sent", e1.status);
check("BHD baseTotal lands at THREE decimals: 1001 × 0.376 = 376.376", e1.base_total === "376.376", String(e1.base_total));
check("BHD baseTaxAmount 91 × 0.376 = 34.216", e1.base_tax_amount === "34.216", String(e1.base_tax_amount));
const eEntries = await entriesFor(B.org, "sales_invoice", invBhd);
const eE = eEntries[0];
check("BHD entry: Dr AR 376.376", line(eE, "1100")?.debit === "376.376", JSON.stringify(eE?.lines));
check("BHD entry: Cr Revenue 342.160 (derived at the third decimal)", line(eE, "4000")?.credit === "342.160", line(eE, "4000")?.credit);
check("BHD entry: Cr VAT 34.216", line(eE, "2100")?.credit === "34.216", line(eE, "2100")?.credit);
// Compared in integer thousandths, not floats — 376.376 − 342.160 − 34.216 in doubles is 5.7e-14,
// which fails a === 0 while the ledger is exactly right. The same value-vs-representation trap the
// README warns about, from the other side.
const mils = (v) => Math.round(Number(v) * 1000);
check("BHD entry balances at the third decimal exactly",
  mils(line(eE, "1100")?.debit) - mils(line(eE, "4000")?.credit) - mils(line(eE, "2100")?.credit) === 0);
await checkLedgerBalanced(B.org, "BHD org after send");

// ================= report =================
await browser.close();
await db.end();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "FX POSTING PASS" : "FX POSTING FAIL");
process.exit(ok ? 0 : 1);
