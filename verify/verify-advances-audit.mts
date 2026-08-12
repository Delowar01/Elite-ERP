// Run via `npm run verify:advances-audit` — tsx with the react-server condition, like every
// server suite.

/**
 * The §20 historical audit tool, proven against fabricated legacy damage — the exact shapes the
 * pre-fix code left behind — plus healthy new-model data as a false-positive control:
 *
 *  - A1: a converted, born-paid, BASE-currency invoice with no revenue journal (the P&L bug) and
 *    its old-style transferred receipt (Cr 1100) -> repairable; apply posts Dr 1100 / Cr 4000
 *    once, fills the identity base columns, and leaves stock alone.
 *  - A2: the same shape in a FOREIGN currency with no stored conversion -> manual review, never
 *    mutated (posting it would mean inventing a rate).
 *  - B1: an unapplied old-style advance (Dr Cash / Cr 1100, kind null) -> repairable; apply moves
 *    the credit to 2300 and tags kind='advance_receipt'.
 *  - B2: a three-line entry crediting 1100 -> manual review, never mutated (the shape carries
 *    intent the tool cannot see).
 *  - Healthy control: a new-model advance (Cr 2300) and a converted invoice WITH its journal ->
 *    reported by neither population.
 *
 * The dry run is proven READ-ONLY (row-for-row identical before/after), apply is proven correct
 * AND idempotent (a second apply changes nothing), and the ledger stays balanced throughout.
 */
import { execSync } from "node:child_process";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const FIXTURE = "verifyadvaudit_";
// journal_lines reference accounts without a cascade, so journals must go before the org rows.
async function sweep() {
  await pool.query(
    `delete from journal_lines where journal_entry_id in
       (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id",
  [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'A','adva_" + uniq() + "@t.dev','x','owner') returning id", [org],
)).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2100", "VAT Payable", "liability", "credit"], ["2300", "Customer Advances", "liability", "credit"],
  ["4000", "Sales Revenue", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id",
  [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Legacy Client') returning id", [org])).rows[0].id as number;

async function post(date: string, memo: string, sourceType: string, sourceId: number, lines: [number, number, number][]) {
  const je = (await pool.query(
    "insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [org, date, memo, sourceType, sourceId, user])).rows[0].id;
  for (const [accountId, debit, credit] of lines) {
    await pool.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,$4)",
      [je, accountId, debit.toFixed(3), credit.toFixed(3)]);
  }
  return je as number;
}
const mkPf = async (num: string, total: string, currency: string | null, convertedTo: number | null = null) =>
  (await pool.query(
    `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,currency,converted_invoice_id,created_by_id)
     values ($1,$2,$3,'sent','2026-06-01',$4,'0',$4,$5,$6,$7) returning id`,
    [org, num, cust, total, currency, convertedTo, user])).rows[0].id as number;
const mkInv = async (num: string, total: string, currency: string | null, paid: string) =>
  (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-06-02','paid',$4,'0',$5,$6,$7) returning id`,
    [org, num, cust, total, paid, currency, user])).rows[0].id as number;
const mkPay = async (amount: string, pf: number, inv: number | null) =>
  (await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,payment_date,proforma_invoice_id,sales_invoice_id,created_by_id)
     values ($1,'in',$2,$3,'2026-06-01',$4,$5,$6) returning id`,
    [org, bank, amount, pf, inv, user])).rows[0].id as number;

// ---- A1: base-currency converted invoice, born paid, NO revenue journal; old-style receipt ----
const invA1 = await mkInv("LEG-A1", "6000.00", null, "6000.00");
const pfA1 = await mkPf("PI-A1", "6000.00", null, invA1);
const payA1 = await mkPay("6000.00", pfA1, invA1);
await post("2026-06-01", "Payment received (old model)", "payment", payA1, [[acc.get("1000")!, 6000, 0], [acc.get("1100")!, 0, 6000]]);

// ---- A2: foreign converted invoice, no stored base conversion -> manual ----
const invA2 = await mkInv("LEG-A2", "1000.00", "USD", "1000.00");
await mkPf("PI-A2", "1000.00", "USD", invA2);

// ---- B1: unapplied old-style advance (the reclassification population) ----
const pfB1 = await mkPf("PI-B1", "1000.00", null);
const payB1 = await mkPay("400.00", pfB1, null);
await post("2026-06-03", "Advance (old model, Cr AR)", "payment", payB1, [[acc.get("1000")!, 400, 0], [acc.get("1100")!, 0, 400]]);

// ---- B2: a 1100-crediting entry whose shape is NOT the plain pair -> manual ----
const pfB2 = await mkPf("PI-B2", "1000.00", null);
const payB2 = await mkPay("300.00", pfB2, null);
await post("2026-06-04", "Advance with odd shape", "payment", payB2,
  [[acc.get("1000")!, 300, 0], [acc.get("1100")!, 0, 250], [acc.get("4000")!, 0, 50]]);

// ---- healthy new-model control: correct advance + converted invoice WITH its journal ----
const invOk = await mkInv("LEG-OK", "500.00", null, "500.00");
const pfOk = await mkPf("PI-OK", "500.00", null, invOk);
const payOk = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,proforma_invoice_id,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'500.00','2026-06-01','advance_receipt',$3,$4,$5) returning id`,
  [org, bank, pfOk, invOk, user])).rows[0].id as number;
await post("2026-06-01", "Advance received (new model)", "payment", payOk, [[acc.get("1000")!, 500, 0], [acc.get("2300")!, 0, 500]]);
await post("2026-06-02", "Invoice LEG-OK issued", "sales_invoice", invOk, [[acc.get("1100")!, 500, 0], [acc.get("4000")!, 0, 500]]);
await post("2026-06-02", "Advance applied", "advance_application", payOk, [[acc.get("2300")!, 500, 0], [acc.get("1100")!, 0, 500]]);

const run = (apply: boolean) =>
  execSync(`npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-12-customer-advances-audit.ts${apply ? " --apply" : ""}`,
    { encoding: "utf8", env: { ...process.env } });

const snapshot = async () => ({
  entries: (await pool.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n as number,
  lines: JSON.stringify((await pool.query(
    `select l.id, l.account_id, l.debit::text, l.credit::text from journal_lines l
       join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1 order by l.id`, [org])).rows),
  kinds: JSON.stringify((await pool.query("select id, kind from payments where org_id=$1 order by id", [org])).rows),
});
const balanced = async () => {
  const r = (await pool.query(
    `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
       from journal_lines l join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
  return r.dr === r.cr ? "" : `${r.dr} vs ${r.cr}`;
};

// ---------- 1. dry run: reports both populations, separately, and mutates NOTHING ----------
const before = await snapshot();
const dry = run(false);
check("dry run announces itself as read-only", /DRY RUN — nothing will be modified/.test(dry));
check("A: the base-currency converted invoice is reported repairable",
  /LEG-A1[\s\S]*?repairable \(base-currency identity\)/.test(dry), dry.match(/.*LEG-A1.*/)?.[0] ?? "not reported");
check("A: the foreign invoice with no stored conversion goes to MANUAL REVIEW, naming the reason",
  /LEG-A2[\s\S]*?MANUAL REVIEW: foreign invoice with no stored base-currency conversion/.test(dry),
  dry.match(/.*LEG-A2[\s\S]{0,160}/)?.[0] ?? "not reported");
check("B: the unapplied old-style advance is reported repairable",
  new RegExp(`payment ${payB1} [\\s\\S]*?repairable \\(reclassify Cr 400`).test(dry), dry.match(new RegExp(`.*payment ${payB1}.*`))?.[0] ?? "not reported");
check("B: the odd-shaped entry goes to MANUAL REVIEW, printing its lines",
  new RegExp(`payment ${payB2}[\\s\\S]*?MANUAL REVIEW: journal shape is not the plain`).test(dry),
  dry.match(new RegExp(`.*payment ${payB2}[\\s\\S]{0,200}`))?.[0] ?? "not reported");
check("the healthy new-model rows are reported by NEITHER population (no false positives)",
  !/LEG-OK/.test(dry) && !new RegExp(`payment ${payOk}\\b`).test(dry));
// The dev database legitimately carries OTHER orgs' legacy rows (fixtures from pre-fix suite
// runs), so totals are asserted for THIS org's contribution, not pinned globally.
check("dry run reports exactly this org's 4 candidate rows (2 per population)",
  (dry.match(new RegExp(`org ${org}  `, "g")) ?? []).length === 4,
  `${(dry.match(new RegExp(`org ${org}  `, "g")) ?? []).length} rows — ` + (dry.match(/Totals.*/)?.[0] ?? "no totals line"));
const afterDry = await snapshot();
check("the dry run modified NOTHING — entries, lines and payment kinds are byte-identical",
  JSON.stringify(before) === JSON.stringify(afterDry));

// ---------- 2. apply: repairs exactly the provable rows ----------
const applied = run(true);
check("apply repairs A1: revenue journal posted exactly once (Dr 1100 6000 / Cr 4000 6000)",
  (await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invA1])).rows[0].n === 1
    && /posted Dr 1100 6000(\.0+)? \/ Cr 4000 6000(\.0+)?$/m.test(applied), applied.match(/.*posted Dr.*/)?.[0] ?? "no repair line");
const a1Lines = (await pool.query(
  `select a.code, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id=l.journal_entry_id join accounts a on a.id=l.account_id
    where e.org_id=$1 and e.source_type='sales_invoice' and e.source_id=$2 order by l.id`, [org, invA1])).rows;
check("…with exactly the normal invoice lines and NO cash line (cash posted once, at receipt)",
  a1Lines.length === 2 && a1Lines.some((l) => l.code === "1100" && Number(l.debit) === 6000)
    && a1Lines.some((l) => l.code === "4000" && Number(l.credit) === 6000), JSON.stringify(a1Lines));
check("…and warns that stock was deliberately not adjusted", /stock NOT adjusted/.test(applied));
const a1Inv = (await pool.query("select exchange_rate::text, base_total::text, base_paid_amount::text from sales_invoices where id=$1", [invA1])).rows[0];
check("…and fills the base-currency identity columns", Number(a1Inv.exchange_rate) === 1 && Number(a1Inv.base_total) === 6000 && Number(a1Inv.base_paid_amount) === 6000, JSON.stringify(a1Inv));
check("apply reclassifies B1: the credit moved from 1100 to 2300 and the payment is tagged",
  (await pool.query(
    `select a.code from journal_lines l join journal_entries e on e.id=l.journal_entry_id
       join accounts a on a.id=l.account_id
      where e.org_id=$1 and e.source_type='payment' and e.source_id=$2 and l.credit > 0`, [org, payB1])).rows[0].code === "2300"
    && (await pool.query("select kind from payments where id=$1", [payB1])).rows[0].kind === "advance_receipt");
check("A2 and B2 remain UNTOUCHED even in apply mode",
  (await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invA2])).rows[0].n === 0
    && (await pool.query("select kind from payments where id=$1", [payB2])).rows[0].kind === null
    && (await pool.query(
      `select count(*)::int n from journal_lines l join journal_entries e on e.id=l.journal_entry_id
         join accounts a on a.id=l.account_id
        where e.org_id=$1 and e.source_type='payment' and e.source_id=$2 and a.code='1100'`, [org, payB2])).rows[0].n === 1);
check("LEDGER BALANCED after the repairs", (await balanced()) === "", await balanced());
// After repair: A1 nets to 0 (Dr 6000 invoice − Cr 6000 old payment), OK nets to 0, B1 moved off
// 1100 — only B2's manual-review Cr 250 remains.
const arNet = (await pool.query(
  `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) net from journal_lines l
     join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1 and l.account_id=$2`, [org, acc.get("1100")])).rows[0].net;
check("AR lands where the fixtures say it must: net −250 (only the manual-review row still credits 1100)",
  Number(arNet) === -250, String(arNet));

// ---------- 3. idempotency: a second apply finds nothing and changes nothing ----------
const afterApply = await snapshot();
const again = run(true);
check("a second apply finds nothing repairable for this org — only the two manual-review rows (A2, B2) keep being reported",
  (again.match(new RegExp(`org ${org}  `, "g")) ?? []).length === 2
    && /LEG-A2[\s\S]*?MANUAL REVIEW/.test(again)
    && new RegExp(`payment ${payB2}[\\s\\S]*?MANUAL REVIEW`).test(again),
  `${(again.match(new RegExp(`org ${org}  `, "g")) ?? []).length} rows — ` + (again.match(/Totals.*/)?.[0] ?? "no totals"));
const afterAgain = await snapshot();
check("…and changes NOTHING — no duplicated revenue, no re-moved lines",
  JSON.stringify(afterApply) === JSON.stringify(afterAgain));

await sweep();
await pool.end();
let allOk = true;
for (const [c, nme, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${nme}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCES AUDIT PASS" : "ADVANCES AUDIT FAIL");
process.exit(allOk ? 0 : 1);
