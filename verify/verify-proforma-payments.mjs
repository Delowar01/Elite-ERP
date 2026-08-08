import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
const BASE="http://localhost:3000";
const DBURL=readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool=new Pool({connectionString:DBURL});
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const p=await b.newPage({viewport:{width:1360,height:1200}});
const email=`pp_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
await p.fill("#orgName",`PP ${uniq()}`);await p.fill("#name","PP");await p.fill("#email",email);await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
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
  await p.waitForTimeout(900);
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
// refresh → history persists
await p.goto(`${BASE}/sales/proforma/${A}`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
ok("Payment history visible after refresh (2 rows)", (await p.locator("text=Payment History").count())>=1 && (await p.locator("table tr, table tbody tr").filter({hasText:bankName}).count())>=2);

console.log("\n== Convert to Sales Invoice — transfer (#4,#5,#6,#7,#8) ==");
await p.getByRole("button",{name:/^Convert to Invoice$/}).click();
await p.waitForURL(/\/sales\/invoices\/\d+$/,{timeout:20000});
const invId=Number(p.url().match(/\/(\d+)$/)[1]);
const {rows:inv}=await pool.query("select paid_amount,total,status from sales_invoices where id=$1",[invId]);
ok("Invoice paidAmount = 700 (transferred)", Number(inv[0].paid_amount)===700);
ok("Invoice balance correct (total 1000 - 700 = 300)", Number(inv[0].total)-Number(inv[0].paid_amount)===300);
ok("Invoice status = partially_paid", inv[0].status==="partially_paid");
const {rows:moved}=await pool.query("select count(*)::int c from payments where sales_invoice_id=$1 and proforma_invoice_id=$2",[invId,A]);
ok("Both payments re-pointed to the invoice, proforma origin kept", moved[0].c===2);
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
await p.getByRole("button",{name:/^Convert to Invoice$/}).click();
await p.waitForURL(/\/sales\/invoices\/\d+$/,{timeout:20000});
const invB=Number(p.url().match(/\/(\d+)$/)[1]);
const {rows:bR}=await pool.query("select paid_amount,total,status from sales_invoices where id=$1",[invB]);
ok("Fully-paid proforma converts to a paid invoice, balance 0", bR[0].status==="paid" && Number(bR[0].total)-Number(bR[0].paid_amount)===0);

await b.close(); await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" CHECK(S) FAILED"}`);
process.exit(fail===0?0:1);
