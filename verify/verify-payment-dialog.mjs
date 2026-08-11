/**
 * FX-7. The two-field Record Payment dialog — received-amount-first.
 *
 * The model under test (Delowar's spec, after the Refrens reference): the bank statement is
 * ground truth. For a foreign document a second field shows the received amount in BASE currency,
 * pre-filled from the rate on file at the payment date; the user editing it IS the override — the
 * effective rate is derived from the two visible figures, never entered directly. A typed base
 * amount supersedes any lookup, so the missing-rate block can only fire when there is no rate
 * AND nothing was typed.
 *
 * What each case is FOR:
 *
 *  - **Pre-fill + live derivation** — the base field tracks amount × rate while untouched; the
 *    rate line re-derives from whichever side changes; once edited, the base figure is pinned.
 *  - **Date change re-resolves the pre-fill** (on-or-before picks the older rate for a backdated
 *    payment) **but never overwrites an edit** — the same override rule as the invoice due date.
 *  - **The deviation warning warns and does not block** — proven by the >10% payment POSTING,
 *    with the derived rate, "derived-from-received" as its source, and the FX line built from the
 *    typed figure. An accepted pre-fill instead stores the resolved rate row's own source.
 *  - **3-decimal base** — a BHD org derives and posts at three decimals.
 *  - **The missing-rate seam** — no rate + nothing typed blocks with the one-click rescue (whose
 *    fetch, against the tier's dark mock port, fails to the manual-entry message); typing the
 *    base figure then posts with no lookup at all.
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
const num = (v) => Math.round(Number(v) * 1000);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });

async function registerOrg(orgName, country) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  ctx.setDefaultTimeout(45000);
  ctx.setDefaultNavigationTimeout(60000);
  const page = await ctx.newPage();
  const email = `pd_${uniq()}@t.dev`;
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

const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(new Date());
const daysAgo = (n) => iso(new Date(Date.now() - n * 86_400_000));

const A = await registerOrg("Dialog FX Co", "Saudi Arabia");
const custA = (await db.query("insert into customers (org_id,name) values ($1,'DL Client') returning id", [A.org])).rows[0].id;
const bankA = (await db.query("select id, gl_account_id, name from bank_accounts where org_id=$1 limit 1", [A.org])).rows[0];
const acctA = async (code) => (await db.query("select id from accounts where org_id=$1 and code=$2", [A.org, code])).rows[0]?.id;
const AR_A = await acctA("1100"), FX_A = await acctA("4900");

const mkSentInvoice = async (org, uid, cust, { currency, total, rate }) => (await db.query(
  `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total,
                               currency, status, exchange_rate, base_total, base_tax_amount, base_paid_amount, created_by_id)
   values ($1,$2,$3,$4,$4,$5,'0','0',$5,$6,'sent',$7,$8,'0','0',$9) returning id`,
  [org, `PD-${uniq()}`, cust, today, total, currency, rate, (Number(total) * Number(rate)).toFixed(3), uid])).rows[0].id;

const setRate = (org, cur, rate, date) => db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,$2,(select currency from orgs where id=$1),$3,$4,'manual')
   on conflict (org_id, from_currency, to_currency, effective_date) do update set rate=$3, source='manual'`,
  [org, cur, rate, date]);

const ledgerBalanced = async (org, label) => {
  const s = (await db.query(
    `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
       from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1`, [org])).rows[0];
  check(`LEDGER BALANCED ${label}`, s.dr === s.cr, `${s.dr} vs ${s.cr}`);
};

/** Poll an input's value until the predicate holds (the pre-fill lands after a server action round-trip). */
async function waitForValue(page, selector, pred, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  let v = "";
  while (Date.now() < until) {
    v = await page.inputValue(selector);
    if (pred(v)) return v;
    await page.waitForTimeout(200);
  }
  return v;
}

// ================= 1. pre-fill, live derivation, and the override rule =================
await setRate(A.org, "USD", "3.60", daysAgo(5));
await setRate(A.org, "USD", "3.75", today);
const inv1 = await mkSentInvoice(A.org, A.uid, custA, { currency: "USD", total: "1000.00", rate: "3.70" });

await A.page.goto(`${BASE}/sales/invoices/${inv1}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(300);
check("the second field exists for a foreign document", (await A.page.locator("#pay-base-received").count()) === 1);
let v = await waitForValue(A.page, "#pay-base-received", (x) => Number(x) > 0);
check("pre-filled with amount × today's fetched rate (1000 × 3.75)", Number(v) === 3750, v);
check("the effective rate line reads from the two figures", (await A.page.getByTestId("effective-rate").innerText()).includes("3.7500"),
  await A.page.getByTestId("effective-rate").innerText());

await A.page.locator("#pay-amount").fill("100");
v = await waitForValue(A.page, "#pay-base-received", (x) => Number(x) === 375);
check("editing the AMOUNT recomputes the untouched pre-fill (100 × 3.75)", Number(v) === 375, v);

// Backdate the payment: on-or-before resolves the OLDER rate; the untouched pre-fill follows.
await A.page.locator("#pay-date").fill(daysAgo(4));
v = await waitForValue(A.page, "#pay-base-received", (x) => Number(x) === 360);
check("a date change re-resolves the pre-fill (100 × the older 3.60)", Number(v) === 360, v);
await A.page.locator("#pay-date").fill(today);
await waitForValue(A.page, "#pay-base-received", (x) => Number(x) === 375);

// The override: type the bank-statement figure. The rate follows IT, and nothing overwrites it.
await A.page.locator("#pay-base-received").fill("500");
await A.page.waitForTimeout(300);
check("editing the base figure re-derives the rate (500 / 100 = 5.0000)",
  (await A.page.getByTestId("effective-rate").innerText()).includes("5.0000"), await A.page.getByTestId("effective-rate").innerText());
check("…and the >10% deviation warning shows (5.00 vs 3.75 on file)", (await A.page.getByRole("status").count()) === 1);
await A.page.locator("#pay-date").fill(daysAgo(4));
await A.page.waitForTimeout(1200);
check("OVERRIDE RULE: a date change does NOT overwrite the edited figure", (await A.page.inputValue("#pay-base-received")) === "500");
await A.page.locator("#pay-date").fill(today);
await A.page.waitForTimeout(800);

// ---- the warning does not block: this payment POSTS, at the derived rate ----
await ledgerBalanced(A.org, "before the deviating payment");
await A.page.locator("#pay-bank-account").click();
await A.page.waitForTimeout(150);
await A.page.getByRole("option", { name: new RegExp(bankA.name) }).first().click();
await A.page.getByRole("button", { name: /^Save$/ }).click();
await A.page.waitForTimeout(500);
await A.page.getByRole("dialog").last().getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(1500);

const p1 = (await db.query(
  `select amount::text, exchange_rate::text, base_amount::text, base_applied_amount::text, rate_source
     from payments where org_id=$1 and sales_invoice_id=$2`, [A.org, inv1])).rows[0];
check("WARN-NOT-BLOCK: the deviating payment posted, base figure taken verbatim",
  p1 && num(p1.base_amount) === 500000 && num(p1.amount) === 100000, JSON.stringify(p1));
check("…exchangeRate is the DERIVED 5.0, rateSource records the override",
  Number(p1?.exchange_rate) === 5 && p1?.rate_source === "derived-from-received", JSON.stringify(p1));
const l1 = (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='payment' order by l.id`, [A.org])).rows;
check("the FX line is built FROM the typed figure: Dr bank 500 / Cr AR 370 (booked 3.70) / Cr 4900 130",
  l1.length === 3 && num(l1.find((l) => l.account_id === bankA.gl_account_id)?.debit) === 500000
    && num(l1.find((l) => l.account_id === AR_A)?.credit) === 370000
    && num(l1.find((l) => l.account_id === FX_A)?.credit) === 130000,
  JSON.stringify(l1));
await ledgerBalanced(A.org, "after the deviating payment");

// ---- an ACCEPTED pre-fill stores the resolved rate row's own source ----
await A.page.goto(`${BASE}/sales/invoices/${inv1}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(300);
await A.page.locator("#pay-amount").fill("200");
await waitForValue(A.page, "#pay-base-received", (x) => Number(x) === 750);
await A.page.locator("#pay-bank-account").click();
await A.page.waitForTimeout(150);
await A.page.getByRole("option", { name: new RegExp(bankA.name) }).first().click();
await A.page.getByRole("button", { name: /^Save$/ }).click();
await A.page.waitForTimeout(500);
await A.page.getByRole("dialog").last().getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(1500);
const p2 = (await db.query(
  `select exchange_rate::text, base_amount::text, rate_source from payments
    where org_id=$1 and sales_invoice_id=$2 order by id desc limit 1`, [A.org, inv1])).rows[0];
check("an untouched pre-fill posts at the resolved rate with ITS source, not 'derived'",
  Number(p2?.exchange_rate) === 3.75 && num(p2?.base_amount) === 750000 && p2?.rate_source === "manual", JSON.stringify(p2));
await ledgerBalanced(A.org, "after the accepted-pre-fill payment");

// ================= 2. base-currency documents: one field, exactly as before =================
const invSar = await mkSentInvoice(A.org, A.uid, custA, { currency: null, total: "800.00", rate: "1" });
await A.page.goto(`${BASE}/sales/invoices/${invSar}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(400);
check("no second field and no rate line for a base-currency document",
  (await A.page.locator("#pay-base-received").count()) === 0 && (await A.page.getByTestId("effective-rate").count()) === 0);
await A.page.keyboard.press("Escape");

// ================= 3. three-decimal base: BHD derives and posts at 3 dp =================
const B = await registerOrg("Dialog FX BHD", "Bahrain");
const custB = (await db.query("insert into customers (org_id,name) values ($1,'BHD Client') returning id", [B.org])).rows[0].id;
const bankB = (await db.query("select id, gl_account_id, name from bank_accounts where org_id=$1 limit 1", [B.org])).rows[0];
await setRate(B.org, "USD", "0.37700", today);
const invB = await mkSentInvoice(B.org, B.uid, custB, { currency: "USD", total: "100.00", rate: "0.37600" });
await B.page.goto(`${BASE}/sales/invoices/${invB}`, { waitUntil: "networkidle" });
await B.page.getByRole("button", { name: /^Record Payment$/ }).click();
await B.page.waitForTimeout(300);
const vb = await waitForValue(B.page, "#pay-base-received", (x) => Number(x) > 0);
check("BHD pre-fill lands at THREE decimals (100 × 0.377 = 37.700)", vb === "37.700", vb);
await B.page.locator("#pay-base-received").fill("37.775");
await B.page.waitForTimeout(300);
check("BHD derivation reads at 4 dp from a 3-dp figure (0.3778)",
  (await B.page.getByTestId("effective-rate").innerText()).includes("0.3778") ||
  (await B.page.getByTestId("effective-rate").innerText()).includes("0.3777"),
  await B.page.getByTestId("effective-rate").innerText());
await ledgerBalanced(B.org, "before the BHD payment");
await B.page.locator("#pay-bank-account").click();
await B.page.waitForTimeout(150);
await B.page.getByRole("option", { name: new RegExp(bankB.name) }).first().click();
await B.page.getByRole("button", { name: /^Save$/ }).click();
await B.page.waitForTimeout(500);
await B.page.getByRole("dialog").last().getByRole("button", { name: /^Record Payment$/ }).click();
await B.page.waitForTimeout(1500);
const pB = (await db.query(
  `select base_amount::text, base_applied_amount::text, rate_source from payments where org_id=$1`, [B.org])).rows[0];
check("BHD payment posts the typed 3-dp figure against the booked 3-dp applied (37.600, closing derived)",
  pB && num(pB.base_amount) === 37775 && num(pB.base_applied_amount) === 37600 && pB.rate_source === "derived-from-received", JSON.stringify(pB));
await ledgerBalanced(B.org, "after the BHD payment");

// ================= 4. the missing-rate seam, and typing as its supersession =================
// JPY has a BOOKED rate on the invoice (posted historically) but NO rate row today.
const invJpy = await mkSentInvoice(A.org, A.uid, custA, { currency: "JPY", total: "10000", rate: "0.02500" });
await A.page.goto(`${BASE}/sales/invoices/${invJpy}`, { waitUntil: "networkidle" });
await A.page.getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.waitForTimeout(800);
check("no rate on file → the base field stays empty (nothing invented)", (await A.page.inputValue("#pay-base-received")) === "");
await A.page.locator("#pay-bank-account").click();
await A.page.waitForTimeout(150);
await A.page.getByRole("option", { name: new RegExp(bankA.name) }).first().click();
await A.page.getByRole("button", { name: /^Save$/ }).click();
await A.page.waitForTimeout(500);
await A.page.getByRole("dialog").last().getByRole("button", { name: /^Record Payment$/ }).click();
const alert = A.page.getByRole("dialog").last().locator('[role="alert"]');
await alert.waitFor({ timeout: 15000 });
check("submitting with no rate AND nothing typed blocks, naming the currency", /JPY/.test(await alert.innerText()), await alert.innerText());
const rescue = A.page.getByRole("dialog").last().getByRole("button", { name: "Fetch rate & retry" });
check("…with the one-click fetch beside it (the FX-3 seam extends to payments)", (await rescue.count()) === 1);
await rescue.click();
await A.page.getByText(/Automatic fetch could not get a rate/).waitFor({ timeout: 20000 });
check("the failed fetch points at manual entry (tier's rate endpoint is dark by design)", true);
await A.page.getByRole("dialog").last().getByRole("button", { name: /^Cancel$/ }).click();
await A.page.waitForTimeout(400);

// A typed base amount IS the rate — nothing blocks on a lookup the user has superseded.
await ledgerBalanced(A.org, "before the typed-JPY payment");
await A.page.locator("#pay-base-received").fill("250.00");
await A.page.getByRole("button", { name: /^Save$/ }).click();
await A.page.waitForTimeout(500);
await A.page.getByRole("dialog").last().getByRole("button", { name: /^Record Payment$/ }).click();
await A.page.getByText("Payment recorded — posted to ledger.").waitFor({ timeout: 15000 });
const pJ = (await db.query(
  `select base_amount::text, base_applied_amount::text, exchange_rate::text, rate_source
     from payments where org_id=$1 and sales_invoice_id=$2`, [A.org, invJpy])).rows[0];
check("TYPED SUPERSEDES: the JPY payment posted with no rate row at all",
  pJ && num(pJ.base_amount) === 250000 && num(pJ.base_applied_amount) === 250000 && pJ.rate_source === "derived-from-received", JSON.stringify(pJ));
await ledgerBalanced(A.org, "after the typed-JPY payment");

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "PAYMENT DIALOG PASS" : "PAYMENT DIALOG FAIL");
process.exit(ok ? 0 : 1);
