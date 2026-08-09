// Run via `npm run verify:<name>`. The script supplies two flags this file cannot supply for
// itself, both for the same reason: ESM evaluates a module's dependencies before any of its own
// statements run, so nothing written here happens early enough to affect its own imports.
//
//   --conditions=react-server  makes `import "server-only"` resolve to the empty module the
//     package ships for the server condition, so the real production code is imported with
//     nothing intercepted. A createRequire cache stub used to sit here instead and never ran.
//
//   --env-file-if-exists=.env  loads DATABASE_URL before the first import. A
//     `process.env.DATABASE_URL ||= readFileSync(".env")` line used to sit here and never ran
//     either, so the suite only worked when the variable happened to be exported in the shell.

import { Pool } from "pg";
import { getProjectCostControl } from "../src/lib/project-costing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ---------------- fixtures ----------------
const org = (await pool.query("insert into orgs (name, currency) values ($1,'SAR') returning id", [`Cost ${uniq()}`])).rows[0].id as number;
const org2 = (await pool.query("insert into orgs (name, currency) values ($1,'SAR') returning id", [`Other ${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'C','c_" + uniq() + "@t.dev','x','owner') returning id", [org],
)).rows[0].id as number;
const user2 = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'D','d_" + uniq() + "@t.dev','x','owner') returning id", [org2],
)).rows[0].id as number;

async function seedAccounts(o: number) {
  for (const [code, name, type, nb] of [
    ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
    ["2000", "Accounts Payable", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
    ["5100", "Operating Expenses", "expense", "debit"], ["1200", "Inventory", "asset", "debit"],
  ] as const) {
    await pool.query(
      "insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true) on conflict do nothing",
      [o, code, name, type, nb],
    );
  }
  const rows = (await pool.query("select id, code from accounts where org_id=$1", [o])).rows;
  return new Map<string, number>(rows.map((r) => [r.code as string, r.id as number]));
}
const acc = await seedAccounts(org);
await seedAccounts(org2);

const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Fair Organisers Ltd') returning id", [org])).rows[0].id as number;
const vend = (await pool.query("insert into vendors (org_id,name) values ($1,'Steel Supply Co') returning id", [org])).rows[0].id as number;

const proj = (await pool.query("insert into projects (org_id,name,status,budget) values ($1,'Riyadh Expo Stand','active',200000) returning id", [org])).rows[0].id as number;
const other = (await pool.query("insert into projects (org_id,name) values ($1,'Unrelated Project') returning id", [org])).rows[0].id as number;
const foreignProj = (await pool.query("insert into projects (org_id,name) values ($1,'Another Org Project') returning id", [org2])).rows[0].id as number;

const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0]?.id as number;

const QUO = `insert into quotations (org_id,quotation_number,customer_id,project_id,issue_date,status,total,currency,created_by_id,archived_at,deleted_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`;
const SO = `insert into sales_orders (org_id,so_number,customer_id,project_id,issue_date,status,total,currency,created_by_id)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`;
const INV = `insert into sales_invoices (org_id,invoice_number,customer_id,project_id,issue_date,status,total,paid_amount,currency,created_by_id,archived_at,deleted_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`;
const PO = `insert into purchase_orders (org_id,po_number,vendor_id,project_id,order_date,status,total,paid_amount,currency,created_by_id)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`;

// --- quotations: 1 sent + 1 accepted counted; draft / rejected / expired / archived / deleted not ---
await q(QUO, [org, "QUO-1", cust, proj, "2026-01-05", "sent", 50000, "SAR", user, null, null]);
await q(QUO, [org, "QUO-2", cust, proj, "2026-01-06", "accepted", 30000, "SAR", user, null, null]);
await q(QUO, [org, "QUO-3", cust, proj, "2026-01-07", "draft", 99999, "SAR", user, null, null]);
await q(QUO, [org, "QUO-4", cust, proj, "2026-01-08", "rejected", 88888, "SAR", user, null, null]);
await q(QUO, [org, "QUO-5", cust, proj, "2026-01-09", "expired", 77777, "SAR", user, null, null]);
await q(QUO, [org, "QUO-6", cust, proj, "2026-01-10", "sent", 66666, "SAR", user, new Date(), null]);
await q(QUO, [org, "QUO-7", cust, proj, "2026-01-11", "sent", 55555, "SAR", user, null, new Date()]);
// foreign currency: excluded from totals, counted as excluded
await q(QUO, [org, "QUO-8", cust, proj, "2026-01-12", "sent", 44444, "USD", user, null, null]);
// another project's quotation must never leak in
await q(QUO, [org, "QUO-9", cust, other, "2026-01-13", "sent", 12345, "SAR", user, null, null]);

// --- sales orders: confirmed + fulfilled counted; draft / cancelled not ---
await q(SO, [org, "SO-1", cust, proj, "2026-01-14", "confirmed", 40000, "SAR", user]);
await q(SO, [org, "SO-2", cust, proj, "2026-01-15", "fulfilled", 25000, "SAR", user]);
await q(SO, [org, "SO-3", cust, proj, "2026-01-16", "draft", 90000, "SAR", user]);
await q(SO, [org, "SO-4", cust, proj, "2026-01-17", "cancelled", 91000, "SAR", user]);

// --- invoices: sent + partially_paid + paid counted; draft / void / archived not ---
const inv1 = await q(INV, [org, "INV-1", cust, proj, "2026-02-01", "sent", 20000, 0, "SAR", user, null, null]);
const inv2 = await q(INV, [org, "INV-2", cust, proj, "2026-02-02", "partially_paid", 30000, 10000, "SAR", user, null, null]);
const inv3 = await q(INV, [org, "INV-3", cust, proj, "2026-02-03", "paid", 15000, 15000, "SAR", user, null, null]);
await q(INV, [org, "INV-4", cust, proj, "2026-02-04", "draft", 70000, 0, "SAR", user, null, null]);
await q(INV, [org, "INV-5", cust, proj, "2026-02-05", "void", 60000, 0, "SAR", user, null, null]);
await q(INV, [org, "INV-6", cust, proj, "2026-02-06", "sent", 50000, 0, "SAR", user, new Date(), null]);
// invoice with no project tag: never counted
await q(INV, [org, "INV-7", cust, null, "2026-02-07", "sent", 45000, 0, "SAR", user, null, null]);

// --- credit note against a project invoice: issued nets off, draft does not ---
await pool.query(
  `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,total,currency,created_by_id)
   values ($1,'CN-1',$2,$3,'2026-02-10','issued',5000,'SAR',$4)`, [org, cust, inv2, user]);
await pool.query(
  `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,total,currency,created_by_id)
   values ($1,'CN-2',$2,$3,'2026-02-11','draft',9000,'SAR',$4)`, [org, cust, inv2, user]);

// --- payments in against project invoices ---
for (const [ref, invId, amt] of [["PAY-A", inv2, 10000], ["PAY-B", inv3, 15000]] as const) {
  await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,sales_invoice_id,created_by_id)
     values ($1,'in',$2,$3,'2026-02-12','bank_transfer',$4,$5,$6)`, [org, bank, amt, ref, invId, user]);
}
// a payment against a NON-project invoice must not be attributed here
await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,reference,sales_invoice_id,created_by_id)
   values ($1,'in',$2,7777,'2026-02-13','PAY-X',(select id from sales_invoices where org_id=$1 and invoice_number='INV-7'),$3)`, [org, bank, user]);

// --- purchase orders: ordered + received counted; draft / cancelled not ---
const po1 = await q(PO, [org, "PO-1", vend, proj, "2026-01-20", "ordered", 12000, 0, "SAR", user]);
const po2 = await q(PO, [org, "PO-2", vend, proj, "2026-01-21", "received", 18000, 6000, "SAR", user]);
await q(PO, [org, "PO-3", vend, proj, "2026-01-22", "draft", 40000, 0, "SAR", user]);
await q(PO, [org, "PO-4", vend, proj, "2026-01-23", "cancelled", 41000, 0, "SAR", user]);
// untagged PO must not count
await q(PO, [org, "PO-5", vend, null, "2026-01-24", "received", 33000, 0, "SAR", user]);

// --- debit note against a project PO: issued nets off committed cost ---
await pool.query(
  `insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,total,currency,created_by_id)
   values ($1,'DN-1',$2,$3,'2026-01-25','issued',2000,'SAR',$4)`, [org, vend, po2, user]);
await pool.query(
  `insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,total,currency,created_by_id)
   values ($1,'DN-2',$2,$3,'2026-01-26','draft',8000,'SAR',$4)`, [org, vend, po2, user]);

// --- payments out against project POs ---
await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,reference,purchase_order_id,created_by_id)
   values ($1,'out',$2,6000,'2026-01-27','PAY-P1',$3,$4)`, [org, bank, po2, user]);
await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,reference,purchase_order_id,created_by_id)
   values ($1,'out',$2,4444,'2026-01-28','PAY-P2',(select id from purchase_orders where org_id=$1 and po_number='PO-5'),$3)`, [org, bank, user]);

// --- journal entries ---
async function post(o: number, uid: number, date: string, memo: string, sourceType: string, projectId: number | null, lines: [number, number, number][]) {
  const je = (await pool.query(
    "insert into journal_entries (org_id, entry_date, memo, source_type, project_id, created_by_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [o, date, memo, sourceType, projectId, uid],
  )).rows[0].id as number;
  for (const [accountId, debit, credit] of lines) {
    await pool.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,$4)", [je, accountId, debit.toFixed(2), credit.toFixed(2)]);
  }
  return je;
}
const EXP = acc.get("5100")!, CASH = acc.get("1000")!, AR = acc.get("1100")!, REV = acc.get("4000")!;
// counted: manual, tagged, expense account
await post(org, user, "2026-02-14", "Site electricity", "manual", proj, [[EXP, 3000, 0], [CASH, 0, 3000]]);
// counted then reversed: nets to zero
await post(org, user, "2026-02-15", "Mis-posted freight", "manual", proj, [[EXP, 1500, 0], [CASH, 0, 1500]]);
await post(org, user, "2026-02-16", "Reversal of mis-posted freight", "manual", proj, [[CASH, 1500, 0], [EXP, 0, 1500]]);
// NOT counted: document-sourced entry (its cost already arrives via the document)
await post(org, user, "2026-02-17", "Invoice posting", "sales_invoice", null, [[AR, 20000, 0], [REV, 0, 20000]]);
// NOT counted: manual entry tagged to a different project
await post(org, user, "2026-02-18", "Other project cost", "manual", other, [[EXP, 9999, 0], [CASH, 0, 9999]]);
// NOT counted: manual entry tagged here but with no expense line
await post(org, user, "2026-02-19", "Owner top-up", "manual", proj, [[CASH, 5000, 0], [AR, 0, 5000]]);

// another org's project, so isolation can be tested for real
await q(QUO, [org2, "QUO-Z", (await pool.query("insert into customers (org_id,name) values ($1,'Z') returning id", [org2])).rows[0].id, foreignProj, "2026-01-05", "sent", 111111, "SAR", user2, null, null]);

// ---------------- the report ----------------
const r = (await getProjectCostControl(org, proj, "SAR"))!;

// 1. committed revenue
check("Quoted Value counts sent + accepted quotations only", near(r.revenue.quoted, 80000), String(r.revenue.quoted));
check("draft / rejected / expired quotations are excluded", !JSON.stringify(r.rows.revenue).includes("QUO-3") && !JSON.stringify(r.rows.revenue).includes("QUO-4") && !JSON.stringify(r.rows.revenue).includes("QUO-5"));
check("archived and soft-deleted quotations are excluded", !JSON.stringify(r.rows.revenue).includes("QUO-6") && !JSON.stringify(r.rows.revenue).includes("QUO-7"));
check("another project's quotation never leaks in", !JSON.stringify(r.rows.revenue).includes("QUO-9"));
check("Confirmed Sales Value counts confirmed + fulfilled sales orders only", near(r.revenue.confirmed, 65000), String(r.revenue.confirmed));

// 2. actual revenue
check("Invoiced Amount counts posted invoices, net of the issued credit note",
  near(r.revenue.invoiced, 20000 + 30000 + 15000 - 5000), String(r.revenue.invoiced));
check("draft, void and archived invoices are excluded", !JSON.stringify(r.rows.revenue).includes("INV-4") && !JSON.stringify(r.rows.revenue).includes("INV-5") && !JSON.stringify(r.rows.revenue).includes("INV-6"));
check("an untagged invoice is excluded", !JSON.stringify(r.rows.revenue).includes("INV-7"));
check("a draft credit note does not reduce revenue", !JSON.stringify(r.rows.revenue).includes("CN-2"));
check("the issued credit note appears as a deduction row", r.rows.revenue.some((x) => x.number === "CN-1" && x.amount === -5000 && x.negative === true));
check("Received Payments counts only payments against this project's invoices", near(r.revenue.received, 25000), String(r.revenue.received));
check("Outstanding Receivables = invoiced − received", near(r.revenue.outstandingReceivable, 60000 - 25000), String(r.revenue.outstandingReceivable));

// 3. committed vs actual cost, kept separate
check("Purchase / Supplier Cost counts ordered + received POs, net of the issued debit note",
  near(r.cost.purchase, 12000 + 18000 - 2000), String(r.cost.purchase));
check("draft and cancelled POs are excluded", !JSON.stringify(r.rows.costs).includes("PO-3") && !JSON.stringify(r.rows.costs).includes("PO-4"));
check("an untagged PO and its payment are excluded", !JSON.stringify(r.rows.costs).includes("PO-5") && !JSON.stringify(r.rows.costs).includes("PAY-P2"));
check("a draft debit note does not reduce cost", !JSON.stringify(r.rows.costs).includes("DN-2"));
check("Amount Paid to Suppliers is cash out only, not the committed total", near(r.cost.paidToSuppliers, 6000), String(r.cost.paidToSuppliers));
check("committed and actual cost are different figures (not mixed)", r.cost.purchase !== r.cost.paidToSuppliers);
check("Outstanding Supplier Cost = committed − paid", near(r.cost.outstandingSupplier, 28000 - 6000), String(r.cost.outstandingSupplier));

// 4. other direct cost
check("Other Direct Project Cost counts tagged manual entries on expense accounts", near(r.cost.other, 3000), String(r.cost.other));
// The ledger keeps both the mistake and its reversal, so both rows are shown — what must not
// happen is the reversed amount surviving in the total.
const freightRows = r.rows.costs.filter((x) => x.number.includes("freight"));
check("a reversed manual entry nets to zero in the total",
  freightRows.length === 2 && near(freightRows.reduce((a, x) => a + x.amount, 0), 0),
  `${freightRows.length} rows, net ${freightRows.reduce((a, x) => a + x.amount, 0)}`);
check("document-sourced journal entries are not double-counted", !JSON.stringify(r.rows.costs).includes("Invoice posting"));
check("a manual entry tagged to another project is excluded", !JSON.stringify(r.rows.costs).includes("Other project cost"));
check("a tagged manual entry with no expense line contributes nothing", !JSON.stringify(r.rows.costs).includes("Owner top-up"));

// 5. totals, profit, margin, health
check("Total Project Cost = purchase cost + other direct cost", near(r.cost.total, 28000 + 3000), String(r.cost.total));
check("the labour estimate is reported separately and excluded from Total Project Cost",
  r.labourEstimate.cost === 0 && near(r.cost.total, r.cost.purchase + r.cost.other));
check("Gross Profit = invoiced − total cost", near(r.profit, 60000 - 31000), String(r.profit));
check("Profit Margin % = profit ÷ invoiced", near(r.marginPercent!, (29000 / 60000) * 100), String(r.marginPercent));
check("health reads Profitable when profit is positive", r.health === "profitable", r.health);

// 6. currency safety
check("a foreign-currency document is excluded from the totals", !JSON.stringify(r.rows.revenue).includes("QUO-8"));
check("excluded foreign-currency documents are reported as a count", r.excludedForeignCurrency === 1, String(r.excludedForeignCurrency));

// 7. drill-through
check("every revenue row links to its own document", r.rows.revenue.every((x) => x.href.startsWith("/")));
check("every cost row links to its own document", r.rows.costs.every((x) => x.href.startsWith("/")));
check("rows are newest first", r.rows.revenue.every((x, i, a) => i === 0 || a[i - 1].date >= x.date));

// 8. tenant isolation
check("a project id from another organization returns nothing", (await getProjectCostControl(org, foreignProj, "SAR")) === null);
check("the other organization's own project is unaffected by this org's data",
  (await getProjectCostControl(org2, foreignProj, "SAR"))!.revenue.quoted === 111111);

// 9. loss and no-revenue states
const lossProj = await q("insert into projects (org_id,name) values ($1,'Loss Project') returning id", [org]);
await q(PO, [org, "PO-L", vend, lossProj, "2026-03-01", "received", 9000, 0, "SAR", user]);
await q(INV, [org, "INV-L", cust, lossProj, "2026-03-02", "sent", 4000, 0, "SAR", user, null, null]);
const loss = (await getProjectCostControl(org, lossProj, "SAR"))!;
check("health reads Loss when cost exceeds revenue", loss.health === "loss" && near(loss.profit, -5000), `${loss.health}/${loss.profit}`);

const emptyProj = await q("insert into projects (org_id,name) values ($1,'Fresh Project') returning id", [org]);
const fresh = (await getProjectCostControl(org, emptyProj, "SAR"))!;
check("health reads No Revenue Yet with nothing invoiced", fresh.health === "no_revenue" && fresh.marginPercent === null);
check("an empty project reports zeroes rather than failing",
  fresh.revenue.invoiced === 0 && fresh.cost.total === 0 && fresh.rows.revenue.length === 0);

const costOnly = await q("insert into projects (org_id,name) values ($1,'Cost Only') returning id", [org]);
await q(PO, [org, "PO-C", vend, costOnly, "2026-03-03", "received", 7000, 0, "SAR", user]);
const co = (await getProjectCostControl(org, costOnly, "SAR"))!;
check("cost with no revenue still reads No Revenue Yet, not Loss", co.health === "no_revenue" && near(co.cost.total, 7000), co.health);

await pool.end();
let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(allOk ? "PROJECT COST CONTROL VERIFICATION PASS" : "PROJECT COST CONTROL VERIFICATION FAIL");
process.exit(allOk ? 0 : 1);
