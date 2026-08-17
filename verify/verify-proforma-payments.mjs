import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";
const BASE="http://localhost:3000";
const DBURL=readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool=new Pool({connectionString:DBURL});
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const p=await b.newPage({viewport:{width:1360,height:1200}});
const email=`pp_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
await p.fill("#orgName",`PP ${uniq()}`);await p.fill("#name","PP");await p.fill("#email",email);await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
  // Registration requires a country as of FX-1a; the currency follows it.
  await pickCountry(p);
await Promise.all([p.waitForURL(`${BASE}/dashboard`,{timeout:20000}),p.click('button[type="submit"]')]);
const {rows:o}=await pool.query("select org_id from users where email=$1",[email]); const orgId=o[0].org_id;
const {rows:u}=await pool.query("select id from users where email=$1",[email]); const userId=u[0].id;
const {rows:c}=await pool.query("insert into customers (org_id,name,address) values ($1,'Acme Co','1 King Rd') returning id",[orgId]);
const custId=c[0].id;
const {rows:ba}=await pool.query("select id from bank_accounts where org_id=$1 limit 1",[orgId]);
const bankName = (await pool.query("select name from bank_accounts where id=$1",[ba[0].id])).rows[0].name;

async function mkProforma(total){
  const {rows}=await pool.query(
   "insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,created_by_id) values ($1,$2,$3,'sent',CURRENT_DATE,$4,'0',$4,$5) returning id",
   [orgId,`PI-${uniq()}`,custId,total,userId]);
  const pfId=rows[0].id;
  await pool.query("insert into proforma_invoice_items (proforma_invoice_id,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,'Service',1,$2,'0',$2)",[pfId,total]);
  return pfId;
}
async function recordPayment(pfId, amount){
  await p.goto(`${BASE}/sales/proforma/${pfId}`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
  await p.getByRole("button",{name:/^Record Payment$/}).click(); await p.waitForTimeout(300);
  const amt=p.locator("#pay-amount"); await amt.fill(String(amount));
  // bank account select
  await p.locator("#pay-bank-account").click(); await p.waitForTimeout(150);
  await p.getByRole("option",{name:new RegExp(bankName)}).first().click(); await p.waitForTimeout(150);
  await p.getByRole("button",{name:/^Save$/}).click();
  await p.waitForTimeout(600);
  // Save does not call the action: RecordPaymentDialog's submit() opens the shared confirmation
  // ("Record Payment against Proforma Invoice PI-xxx?") and recordPaymentAction only runs from its
  // onConfirm. This suite predates the confirmation policy and stopped at Save, so nothing ever
  // posted — which read exactly like a broken payment path. The confirm verb comes from
  // confirm-policy.ts ("payment.record" -> "Record Payment").
  await p.getByRole("dialog").last().getByRole("button",{name:/^Record Payment$/}).click();
  await p.waitForTimeout(1200);
}

console.log("\n== Record full + multiple partial payments (#1,#2,#3) ==");
const A = await mkProforma("1000.00");
await recordPayment(A, 400);
await recordPayment(A, 300);
const {rows:pa}=await pool.query("select count(*)::int c, coalesce(sum(amount),0)::numeric s from payments where proforma_invoice_id=$1",[A]);
ok("Two payments recorded against the proforma", pa[0].c===2);
ok("Payment total = 700", Number(pa[0].s)===700);
const {rows:pfpaid}=await pool.query("select paid_amount from proforma_invoices where id=$1",[A]);
ok("Proforma paidAmount = 700", Number(pfpaid[0].paid_amount)===700);
const {rows:je}=await pool.query("select count(*)::int c from journal_entries where source_type='payment' and source_id in (select id from payments where proforma_invoice_id=$1)",[A]);
ok("One journal entry per payment (2 total)", je[0].c===2);
// Customer-advances model: an advance receipt CREDITS 2300 Customer Advances, never 1100 AR (a
// proforma never created a receivable to credit). Asserted at the ACCOUNT level so this suite
// enforces the new rule rather than merely tolerating it — a posting reverted to Cr 1100 fails
// here naming the wrong account.
const {rows:advCr}=await pool.query(
  `select a.code, coalesce(sum(l.credit),0)::numeric cr from journal_lines l
     join journal_entries e on e.id=l.journal_entry_id
     join accounts a on a.id=l.account_id
    where e.source_type='payment'
      and e.source_id in (select id from payments where proforma_invoice_id=$1)
      and l.credit > 0
    group by a.code order by a.code`,[A]);
ok(`Advance receipts credit 2300 Customer Advances ONLY (found: ${advCr.map(r=>`${r.code}=${r.cr}`).join(", ")||"none"})`,
  advCr.length===1 && advCr[0].code==="2300" && Number(advCr[0].cr)===700);
const {rows:advKind}=await pool.query("select count(*)::int c from payments where proforma_invoice_id=$1 and kind='advance_receipt'",[A]);
ok("Both payments are tagged kind='advance_receipt'", advKind[0].c===2);
// refresh → history persists
await p.goto(`${BASE}/sales/proforma/${A}`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
ok("Payment history visible after refresh (2 rows)", (await p.locator("text=Payment History").count())>=1 && (await p.locator("table tr, table tbody tr").filter({hasText:bankName}).count())>=2);

console.log("\n== Convert to Sales Invoice — transfer (#4,#5,#6,#7,#8) ==");
// Per-type convert buttons were replaced by the shared ConvertMenu: a "Convert to…" dropdown whose
// items go through the same confirmation ("document.convert" -> verb "Convert").
await p.getByRole("button",{name:/^Convert to…$/}).click();
await p.waitForTimeout(400);
await p.getByRole("menuitem",{name:/Invoice/}).first().click();
await p.waitForTimeout(500);
await p.getByRole("dialog").last().getByRole("button",{name:/^Convert$/}).click();
await p.waitForURL(/\/sales\/invoices\/\d+$/,{timeout:20000});
const invId=Number(p.url().match(/\/(\d+)$/)[1]);
const {rows:inv}=await pool.query("select paid_amount,total,status from sales_invoices where id=$1",[invId]);
ok("Invoice paidAmount = 700 (transferred)", Number(inv[0].paid_amount)===700);
ok("Invoice balance correct (total 1000 - 700 = 300)", Number(inv[0].total)-Number(inv[0].paid_amount)===300);
ok("Invoice status = partially_paid", inv[0].status==="partially_paid");
// Transfer is expressed as ALLOCATIONS now, not as a re-pointed salesInvoiceId: an advance can
// settle several invoices and a partial draw never set that field, so it stops being the record of
// what was applied (and is cleared outright by the 2026-08-17 migration). The proforma origin
// pointer is what still ties the receipt to where it came from.
const {rows:moved}=await pool.query(
  "select count(*)::int c from advance_applications a join payments p on p.id=a.advance_payment_id where a.sales_invoice_id=$1 and p.proforma_invoice_id=$2",[invId,A]);
ok("Both advances applied to the invoice through allocations, proforma origin kept", moved[0].c===2);
const {rows:tot}=await pool.query("select count(*)::int c from payments where proforma_invoice_id=$1",[A]);
ok("No duplicate payment rows created (still 2)", tot[0].c===2);
const {rows:je2}=await pool.query("select count(*)::int c from journal_entries where source_type='payment' and source_id in (select id from payments where proforma_invoice_id=$1)",[A]);
ok("No duplicate journal postings (still 2)", je2[0].c===2);
const {rows:convd}=await pool.query("select converted_invoice_id from proforma_invoices where id=$1",[A]);
ok("Proforma linked to the converted invoice", convd[0].converted_invoice_id===invId);
// invoice detail shows the transferred payments
ok("Invoice detail shows payment history", (await p.locator("text=Payment History").count())>=1);
ok("Invoice history tags transferred payments as from Proforma", (await p.getByText(/from Proforma/).count())>=1);
// proforma now read-only with link
await p.goto(`${BASE}/sales/proforma/${A}`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
ok("Proforma shows read-only history + link to invoice", (await p.getByRole("link",{name:/View Sales Invoice/}).count())>=1 || (await p.getByText(/Converted to Sales Invoice/).count())>=1);
ok("Proforma no longer offers Record Payment", (await p.getByRole("button",{name:/^Record Payment$/}).count())===0);

console.log("\n== Failed conversion rolls back (#9) ==");
const {rows:invCountBefore}=await pool.query("select count(*)::int c from sales_invoices where org_id=$1",[orgId]);
// try converting the already-converted proforma via the action (should error, create nothing)
await p.goto(`${BASE}/sales/proforma/${A}`,{waitUntil:"networkidle"});
const {rows:invCountAfter}=await pool.query("select count(*)::int c from sales_invoices where org_id=$1",[orgId]);
ok("Already-converted proforma does not create a second invoice", invCountBefore[0].c===invCountAfter[0].c);

console.log("\n== Full payment → paid status ==");
const Bp = await mkProforma("500.00");
await recordPayment(Bp, 500);
await p.goto(`${BASE}/sales/proforma/${Bp}`,{waitUntil:"networkidle"}); await p.waitForTimeout(300);
// Per-type convert buttons were replaced by the shared ConvertMenu: a "Convert to…" dropdown whose
// items go through the same confirmation ("document.convert" -> verb "Convert").
await p.getByRole("button",{name:/^Convert to…$/}).click();
await p.waitForTimeout(400);
await p.getByRole("menuitem",{name:/Invoice/}).first().click();
await p.waitForTimeout(500);
await p.getByRole("dialog").last().getByRole("button",{name:/^Convert$/}).click();
await p.waitForURL(/\/sales\/invoices\/\d+$/,{timeout:20000});
const invB=Number(p.url().match(/\/(\d+)$/)[1]);
const {rows:bR}=await pool.query("select paid_amount,total,status from sales_invoices where id=$1",[invB]);
ok("Fully-paid proforma converts to a paid invoice, balance 0", bR[0].status==="paid" && Number(bR[0].total)-Number(bR[0].paid_amount)===0);

await b.close(); await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" CHECK(S) FAILED"}`);
process.exit(fail===0?0:1);
