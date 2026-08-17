// Run via `npm run verify:advance-clear` — tsx with the react-server condition.

/**
 * The clearing migration: `payments.salesInvoiceId` goes null for advance receipts, and for nothing
 * else.
 *
 * Three properties, in order of how much damage getting them wrong would do:
 *
 *  1. **It refuses** while any advance receipt has the field set and NO allocation row. Such a
 *     receipt records its applied-ness in exactly one place — the field about to be erased — so
 *     clearing it destroys the fact outright. That population is what the backfill migrates; a
 *     non-zero count means run the backfill, never force the clear.
 *  2. **It is scoped to `kind='advance_receipt'`.** An ordinary payment's `salesInvoiceId` is its
 *     only invoice linkage, and the mutation that drops the filter must fail this suite.
 *  3. **The readers do not move.** Every reader migrated in commits 3, 6, 7 and 8 produces the
 *     SAME figure before and after the clear — which is the property that makes "deploy code, then
 *     clear" safe rather than merely correct.
 *
 * The real script is run as a subprocess, `--org`-scoped to this fixture, so what is verified is
 * the shipped migration rather than a re-implementation of it.
 */
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { db } from "../src/db";
import { getStatement } from "../src/lib/statements";
import { getProjectCostControl } from "../src/lib/project-costing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);

const FIXTURE = "verifyclear_";
async function sweep() {
  await pool.query("delete from advance_application_releases where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from advance_applications where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query(
    `delete from journal_lines where journal_entry_id in
       (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

/** Run the shipped migration, scoped to this org. Returns its exit code and output. */
function runMigration(org: number, apply: boolean): { code: number; out: string } {
  try {
    const out = execFileSync("npx", [
      "tsx", "--env-file-if-exists=.env",
      "scripts/migrations/2026-08-17-clear-advance-sales-invoice-id.ts",
      "--org", String(org), ...(apply ? ["--apply"] : []),
    ], { encoding: "utf8", cwd: process.cwd() });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// ---------------------------------------------------------------------------------------------
// Fixture: one org carrying every population the migration must distinguish.
// ---------------------------------------------------------------------------------------------

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id", [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'C','clr_" + uniq() + "@t.dev','x','owner') returning id", [org])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2300", "Customer Advances", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)", [org, code, name, type, nb]);
}
const acc = new Map<string, number>((await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Clear Client') returning id", [org])).rows[0].id as number;
const project = (await pool.query(
  "insert into projects (org_id,name,status) values ($1,'Clear Project','active') returning id", [org])).rows[0].id as number;

const invoice = (await pool.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,project_id,issue_date,status,subtotal,discount,tax_total,total,paid_amount,base_paid_amount,base_total,base_tax_amount,exchange_rate,created_by_id)
   values ($1,$2,$3,$4,'2026-08-05','paid','5000.00','0','0','5000.00','5000.00','5000.00','5000.00','0','1',$5) returning id`,
  [org, `INVCLR-${uniq()}`, cust, project, user])).rows[0].id as number;
const invEntry = (await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-08-05','Invoice posted','sales_invoice',$2,$3) returning id`, [org, invoice, user])).rows[0].id as number;
await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'5000.000','0'),($1,$3,'0','5000.000')",
  [invEntry, acc.get("1100"), acc.get("4000")]);

const pf = (await pool.query(
  `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,paid_amount,base_paid_amount,created_by_id)
   values ($1,$2,$3,'sent','2026-08-01','4000.00','0','4000.00','4000.00','4000.00',$4) returning id`,
  [org, `PICLR-${uniq()}`, cust, user])).rows[0].id as number;

/** An advance receipt WITH its allocation — the population the clear is for. */
const backed = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,base_amount,base_applied_amount,proforma_invoice_id,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'4000.00','2026-08-01','advance_receipt','4000.00','4000.00',$3,$4,$5) returning id`,
  [org, bank, pf, invoice, user])).rows[0].id as number;
const receiptEntry = (await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-08-01','Advance received','payment',$2,$3) returning id`, [org, backed, user])).rows[0].id as number;
await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'4000.000','0'),($1,$3,'0','4000.000')",
  [receiptEntry, acc.get("1000"), acc.get("2300")]);
const alloc = (await pool.query(
  `insert into advance_applications (org_id,advance_payment_id,sales_invoice_id,applied_amount,carried_base,ar_cleared,applied_date,created_by_id)
   values ($1,$2,$3,'4000.00','4000.00','4000.00','2026-08-06',$4) returning id`, [org, backed, invoice, user])).rows[0].id as number;
const allocEntry = (await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-08-06','Advance applied','advance_application',$2,$3) returning id`, [org, alloc, user])).rows[0].id as number;
await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'4000.000','0'),($1,$3,'0','4000.000')",
  [allocEntry, acc.get("2300"), acc.get("1100")]);

/**
 * An ORDINARY payment on the same invoice — the population that must survive untouched.
 *
 * Inserted with `kind` NULL, which is what the application actually writes: only advances are
 * tagged. An earlier version of this fixture set `kind='invoice_payment'`, a shape production never
 * produces — and a NULL-kind row is precisely what a `kind <> 'advance_receipt'` guard fails to
 * see, so the fixture would have been testing the safe case.
 */
const ordinary = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,base_amount,base_applied_amount,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'1000.00','2026-08-07','1000.00','1000.00',$3,$4) returning id`,
  [org, bank, invoice, user])).rows[0].id as number;

/** An advance receipt with the field set and NO allocation — the refusal population. */
const unbacked = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,base_amount,base_applied_amount,proforma_invoice_id,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'750.00','2026-08-02','advance_receipt','750.00','750.00',$3,$4,$5) returning id`,
  [org, bank, pf, invoice, user])).rows[0].id as number;

// ---------------------------------------------------------------------------------------------
// 1. It refuses while an unbacked receipt exists.
// ---------------------------------------------------------------------------------------------

const refused = runMigration(org, true);
check("REFUSES to clear while a receipt records its applied-ness ONLY in the field",
  refused.code === 2 && /REFUSING TO CLEAR/.test(refused.out), `exit ${refused.code}`);
check("…and names the backfill as the fix, not a force flag",
  /backfill/i.test(refused.out) && /Do NOT force/i.test(refused.out));
check("…having changed NOTHING — every receipt keeps its link",
  mils((await pool.query("select count(*)::int n from payments where org_id=$1 and kind='advance_receipt' and sales_invoice_id is not null", [org])).rows[0].n) === 2000,
  JSON.stringify((await pool.query("select id, sales_invoice_id from payments where org_id=$1 order by id", [org])).rows));

// ---------------------------------------------------------------------------------------------
// 2. Reader figures BEFORE the clear — the baseline the clear must not move.
// ---------------------------------------------------------------------------------------------

// The refusal population is what the backfill would have migrated; here it is simply removed, which
// is the state a real deployment reaches by running the backfill first.
await pool.query("delete from payments where id=$1", [unbacked]);

const readersNow = async () => {
  const statement = await getStatement(org, "client", cust, { from: "1900-01-01", to: "2999-12-31" });
  const costing = await getProjectCostControl(org, project, "SAR");
  const history = (await pool.query(
    `select count(*)::int n from payments p
      where p.org_id=$1 and (p.sales_invoice_id = $2
        or p.id in (select a.advance_payment_id from advance_applications a
                     where a.org_id=$1 and a.sales_invoice_id=$2 and a.released_at is null))`, [org, invoice])).rows[0].n;
  return {
    lineTypes: (statement?.lines ?? []).map((l) => l.docType).sort().join(","),
    advancesHeld: Math.round((statement?.advancesHeld ?? 0) * 1000),
    closing: Math.round((statement?.closing ?? 0) * 1000),
    received: Math.round((costing?.revenue.received ?? 0) * 1000),
    historyRows: Number(history),
  };
};
const before = await readersNow();
check("BASELINE: the statement shows the applied advance, and the project counts its cash",
  before.lineTypes.includes("advance_application") && before.received === 5000000 && before.historyRows === 2,
  JSON.stringify(before));

// ---------------------------------------------------------------------------------------------
// 3. It clears advance receipts, and ONLY advance receipts.
// ---------------------------------------------------------------------------------------------

const applied = runMigration(org, true);
check("with nothing unbacked, the migration APPLIES", applied.code === 0 && /Cleared 1 advance receipt/.test(applied.out),
  applied.out.split("\n").filter((l) => l.trim()).slice(-4).join(" | "));
check("the advance receipt's salesInvoiceId is now NULL",
  (await pool.query("select sales_invoice_id from payments where id=$1", [backed])).rows[0].sales_invoice_id === null);
check("SCOPE: the ordinary payment keeps its invoice link — it is that payment's only linkage",
  (await pool.query("select sales_invoice_id from payments where id=$1", [ordinary])).rows[0].sales_invoice_id === invoice,
  String((await pool.query("select sales_invoice_id from payments where id=$1", [ordinary])).rows[0].sales_invoice_id));
check("proformaInvoiceId is untouched — the receipt's ORIGIN pointer is not an application",
  (await pool.query("select proforma_invoice_id from payments where id=$1", [backed])).rows[0].proforma_invoice_id === pf);
check("the allocation row is untouched — it is where the applied-ness now lives",
  (await pool.query("select count(*)::int n from advance_applications where id=$1 and sales_invoice_id=$2", [alloc, invoice])).rows[0].n === 1);

const rerun = runMigration(org, true);
check("re-running is INERT — nothing left to clear, exit clean",
  rerun.code === 0 && /Cleared 0 advance receipts/.test(rerun.out), rerun.out.split("\n").find((l) => /Cleared/.test(l)) ?? "");

// ---------------------------------------------------------------------------------------------
// 4. The readers did not move — the property that makes "deploy code, then clear" safe.
// ---------------------------------------------------------------------------------------------

const after = await readersNow();
check("STATEMENT unchanged across the clear — the applied-advance line still resolves, through its allocation",
  after.lineTypes === before.lineTypes && after.advancesHeld === before.advancesHeld && after.closing === before.closing,
  `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
check("PROJECT COSTING unchanged — advance cash still counted, from the allocation rather than the link",
  after.received === before.received, `${before.received} vs ${after.received}`);
check("PAYMENT HISTORY unchanged — the transferred advance is still on the invoice it settled",
  after.historyRows === before.historyRows, `${before.historyRows} vs ${after.historyRows}`);

await sweep();
await pool.end();
await db.$client.end?.();
let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCE CLEAR PASS" : "ADVANCE CLEAR FAIL");
process.exit(allOk ? 0 : 1);
