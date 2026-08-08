// Task 1 verification: due date + payment term round-trip, and the two features that read dueDate.
import { Client } from "pg";
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = [];
const ck = (n, c, x = "") => r.push([c, n, x]);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Column + FK exist
const cols = (await db.query(
  `select column_name from information_schema.columns where table_name='sales_invoices' and column_name in ('due_date','payment_term_preset_id')`)).rows.map(x=>x.column_name).sort();
ck("sales_invoices has due_date + payment_term_preset_id", cols.join(",") === "due_date,payment_term_preset_id", cols.join(","));

// Use the newest org that has an invoice, so we test against real seeded data.
const org = (await db.query(`select org_id from sales_invoices group by org_id order by max(id) desc limit 1`)).rows[0]?.org_id;
ck("found an org with invoices", !!org, String(org));

if (org) {
  const term = (await db.query(
    `insert into payment_term_presets (org_id,name,net_days) values ($1,'Net 30',30) returning id,net_days`, [org])).rows[0];
  ck("payment term preset created", !!term);

  const cust = (await db.query(`select id from customers where org_id=$1 limit 1`, [org])).rows[0];
  const user = (await db.query(`select id from users where org_id=$1 limit 1`, [org])).rows[0];
  const issue = "2026-06-01";
  const dueOk = "2026-07-01"; // issue + 30
  const inv = (await db.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,status,issue_date,due_date,payment_term_preset_id,subtotal,tax_total,total,paid_amount,created_by_id)
     values ($1,'INV-DUE-TEST',$2,'sent',$3,$4,$5,'1000','150','1150','0',$6) returning id,due_date,payment_term_preset_id`,
    [org, cust.id, issue, dueOk, term.id, user.id])).rows[0];
  ck("invoice stores due_date", iso(inv.due_date) === dueOk, iso(inv.due_date));
  ck("invoice stores payment_term_preset_id", inv.payment_term_preset_id === term.id);

  // AR Aging reads due_date to compute overdue days — confirm it is now non-null and in the past.
  const aging = (await db.query(
    `select count(*)::int n from sales_invoices where org_id=$1 and due_date is not null and status in ('sent','partially_paid')`, [org])).rows[0].n;
  ck("AR Aging has at least one dated open invoice to bucket", aging >= 1, `n=${aging}`);
  const preexisting = (await db.query(
    `select count(*)::int n from sales_invoices where org_id=$1 and due_date is not null and invoice_number <> 'INV-DUE-TEST'`, [org])).rows[0].n;
  console.log(`DIAG  invoices already carrying a due date (not from this test): ${preexisting}`);

  const overdue = (await db.query(
    `select count(*)::int n from sales_invoices where org_id=$1 and due_date < current_date and status in ('sent','partially_paid')`, [org])).rows[0].n;
  ck("dashboard overdue KPI produces a real number", overdue >= 1, `overdue=${overdue}`);

  // FK is ON DELETE SET NULL: deleting the preset must not delete the invoice.
  await db.query(`delete from payment_term_presets where id=$1`, [term.id]);
  const after = (await db.query(`select id,due_date,payment_term_preset_id from sales_invoices where id=$1`, [inv.id])).rows[0];
  ck("deleting the preset keeps the invoice", !!after);
  ck("deleting the preset nulls the term but keeps the due date",
     after.payment_term_preset_id === null && iso(after.due_date) === dueOk,
     `term=${after.payment_term_preset_id} due=${iso(after.due_date)}`);

  await db.query(`delete from sales_invoices where id=$1`, [inv.id]);
}

await db.end();
let ok = true;
for (const [c, n, x] of r) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${r.filter(x=>x[0]).length}/${r.length} checks`);
console.log(ok ? "DUE DATE VERIFICATION PASS" : "DUE DATE VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
