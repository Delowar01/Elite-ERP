// Run via `npm run verify:advance-backfill` — tsx with the react-server condition, like every
// server suite.

/**
 * The allocation backfill (§12), proven against fabricated pre-migration data.
 *
 * The migration's whole reason for existing is the RE-KEY: application journals were keyed
 * `(advance_application, payment.id)`, and partial allocation moves that key onto the allocation
 * row. Creating allocation rows without re-keying is worse than doing nothing — the old journal is
 * then orphaned from the identity the new code looks under, so the new code sees an allocation with
 * no journal and posts a duplicate Dr 2300 / Cr 1100. So the assertions below check BOTH halves and
 * that nothing remains keyed by the old identity.
 *
 * Fixtures, all shapes the old code could really leave behind:
 *  - A base-currency application (Dr 2300 / Cr 1100) -> migrates;
 *  - a FOREIGN one carrying a realized-FX line (Dr 2300 / Cr 1100 / Dr 4900) -> migrates, and its
 *    figures come from the JOURNAL, not from a recomputation that would silently restate history;
 *  - an applied receipt with NO application journal (pre-advances history) -> manual review;
 *  - an applied receipt with TWO application journals -> manual review;
 *  - an unapplied receipt and an already-migrated one -> not candidates at all.
 */
import { execSync } from "node:child_process";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);

const FIXTURE = "verifyallocbf_";
async function sweep() {
  await pool.query(
    `delete from advance_applications where org_id in (select id from orgs where name like $1)`, [`${FIXTURE}%`]);
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
  "insert into users (org_id,name,email,password_hash,role) values ($1,'B','bf_" + uniq() + "@t.dev','x','owner') returning id", [org],
)).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2300", "Customer Advances", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
  ["4900", "Exchange Gain/Loss", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id",
  [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Backfill Client') returning id", [org])).rows[0].id as number;

const mkInvoice = async (num: string, total: string, currency: string | null, paid: string) =>
  (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-07-02','paid',$4,'0',$5,$6,$7) returning id`,
    [org, num, cust, total, paid, currency, user])).rows[0].id as number;
const mkProforma = async (num: string, invoiceId: number, currency: string | null) =>
  (await pool.query(
    `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,currency,converted_invoice_id,created_by_id)
     values ($1,$2,$3,'sent','2026-07-01','1000','0','1000',$4,$5,$6) returning id`,
    [org, num, cust, currency, invoiceId, user])).rows[0].id as number;
const mkReceipt = async (amount: string, carried: string, currency: string | null, pf: number, inv: number | null) =>
  (await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,currency,base_amount,base_applied_amount,proforma_invoice_id,sales_invoice_id,created_by_id)
     values ($1,'in',$2,$3,'2026-07-01','advance_receipt',$4,$5,$5,$6,$7,$8) returning id`,
    [org, bank, amount, currency, carried, pf, inv, user])).rows[0].id as number;
const post = async (date: string, memo: string, sourceType: string, sourceId: number, lines: [number, number, number][]) => {
  const je = (await pool.query(
    "insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [org, date, memo, sourceType, sourceId, user])).rows[0].id as number;
  for (const [accountId, debit, credit] of lines) {
    await pool.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,$4)",
      [je, accountId, debit.toFixed(3), credit.toFixed(3)]);
  }
  return je;
};

// ---- A: base-currency application ----
const invA = await mkInvoice("BF-A", "6000.00", null, "6000.00");
const pfA = await mkProforma("PIBF-A", invA, null);
const payA = await mkReceipt("6000.00", "6000.00", null, pfA, invA);
const jeA = await post("2026-07-02", "Advance applied to invoice BF-A", "advance_application", payA,
  [[acc.get("2300")!, 6000, 0], [acc.get("1100")!, 0, 6000]]);

// ---- B: foreign application carrying a realized-FX line ----
const invB = await mkInvoice("BF-B", "500.00", "USD", "500.00");
const pfB = await mkProforma("PIBF-B", invB, "USD");
const payB = await mkReceipt("500.00", "1880.00", "USD", pfB, invB);
const jeB = await post("2026-07-02", "Advance applied to invoice BF-B", "advance_application", payB,
  [[acc.get("2300")!, 1880, 0], [acc.get("1100")!, 0, 1900], [acc.get("4900")!, 20, 0]]);

// ---- C: applied receipt with NO application journal (pre-advances history) ----
const invC = await mkInvoice("BF-C", "300.00", null, "300.00");
const pfC = await mkProforma("PIBF-C", invC, null);
const payC = await mkReceipt("300.00", "300.00", null, pfC, invC);

// ---- D: applied receipt with TWO application journals ----
const invD = await mkInvoice("BF-D", "400.00", null, "400.00");
const pfD = await mkProforma("PIBF-D", invD, null);
const payD = await mkReceipt("400.00", "400.00", null, pfD, invD);
await post("2026-07-02", "Advance applied (1)", "advance_application", payD, [[acc.get("2300")!, 200, 0], [acc.get("1100")!, 0, 200]]);
await post("2026-07-02", "Advance applied (2)", "advance_application", payD, [[acc.get("2300")!, 200, 0], [acc.get("1100")!, 0, 200]]);

// ---- E: an UNAPPLIED receipt — never a candidate ----
const invE = await mkInvoice("BF-E", "900.00", null, "0");
const pfE = await mkProforma("PIBF-E", invE, null);
const payE = await mkReceipt("250.00", "250.00", null, pfE, null);

const run = (apply: boolean) =>
  execSync(`npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-16-advance-applications-backfill.ts${apply ? " --apply" : ""}`,
    { encoding: "utf8", env: { ...process.env } });
const snapshot = async () => JSON.stringify({
  allocs: (await pool.query("select * from advance_applications where org_id=$1 order by id", [org])).rows,
  entries: (await pool.query("select id, source_type, source_id, entry_date, memo from journal_entries where org_id=$1 order by id", [org])).rows,
  lines: (await pool.query(
    `select l.id, l.account_id, l.debit::text, l.credit::text from journal_lines l
       join journal_entries e on e.id = l.journal_entry_id where e.org_id=$1 order by l.id`, [org])).rows,
});
const sourceIdOf = async (entryId: number) =>
  (await pool.query("select source_type, source_id from journal_entries where id=$1", [entryId])).rows[0];

// ================= 1. dry run reports and mutates NOTHING =================
const before = await snapshot();
const dry = run(false);
check("dry run announces itself read-only", /DRY RUN — nothing will be modified/.test(dry));
check("A + B are reported as migratable, with the figures taken from their journals",
  new RegExp(`payment ${payA}[\\s\\S]*?carriedBase 6000\\.000 \\(Dr 2300\\), arCleared 6000\\.000`).test(dry)
    && new RegExp(`payment ${payB}[\\s\\S]*?carriedBase 1880\\.000 \\(Dr 2300\\), arCleared 1900\\.000[\\s\\S]*?FX 20\\.000`).test(dry),
  dry.match(new RegExp(`.*payment ${payB}[\\s\\S]{0,220}`))?.[0] ?? "(B not reported)");
check("C (no application journal) goes to MANUAL REVIEW naming pre-advances history",
  new RegExp(`payment ${payC}[\\s\\S]*?MANUAL REVIEW: expected exactly 1 application journal, found 0 \\(pre-advances history`).test(dry),
  dry.match(new RegExp(`.*payment ${payC}[\\s\\S]{0,180}`))?.[0] ?? "(C not reported)");
check("D (two application journals) goes to MANUAL REVIEW naming the count",
  new RegExp(`payment ${payD}[\\s\\S]*?MANUAL REVIEW: expected exactly 1 application journal, found 2`).test(dry),
  dry.match(new RegExp(`.*payment ${payD}[\\s\\S]{0,140}`))?.[0] ?? "(D not reported)");
check("E (unapplied) is not a candidate at all", !new RegExp(`payment ${payE}\\b`).test(dry));
check("the dry run modified NOTHING — allocations, entries and lines byte-identical", before === (await snapshot()));

// ================= 2. apply migrates the provable rows, and RE-KEYS =================
const applied = run(true);
const allocA = (await pool.query(
  "select * from advance_applications where org_id=$1 and advance_payment_id=$2", [org, payA])).rows[0];
check("A: one allocation row, figures matching the journal (6,000 / 6,000 / 6,000)",
  !!allocA && mils(allocA.applied_amount) === 6000000 && mils(allocA.carried_base) === 6000000
    && mils(allocA.ar_cleared) === 6000000 && allocA.sales_invoice_id === invA && allocA.released_at === null,
  JSON.stringify(allocA ?? null));
const allocB = (await pool.query(
  "select * from advance_applications where org_id=$1 and advance_payment_id=$2", [org, payB])).rows[0];
check("B: the FOREIGN allocation takes its figures from the JOURNAL — carried 1,880 vs cleared 1,900, not recomputed",
  !!allocB && mils(allocB.carried_base) === 1880000 && mils(allocB.ar_cleared) === 1900000, JSON.stringify(allocB ?? null));
const keyA = await sourceIdOf(jeA), keyB = await sourceIdOf(jeB);
check("RE-KEY: both journals now point at their allocation row, not at the payment",
  keyA.source_id === allocA.id && keyB.source_id === allocB.id
    && keyA.source_type === "advance_application" && keyB.source_type === "advance_application",
  `${keyA.source_id} vs alloc ${allocA.id}; ${keyB.source_id} vs alloc ${allocB.id}`);
check("…and NOTHING is left keyed by the old payment identity — the duplicate-posting window is closed",
  (await pool.query(
    `select count(*)::int n from journal_entries
      where org_id=$1 and source_type='advance_application' and source_id in ($2,$3)`, [org, payA, payB])).rows[0].n === 0);
const jeBLines = (await pool.query(
  `select a.code, l.debit::text, l.credit::text from journal_lines l join accounts a on a.id=l.account_id
    where l.journal_entry_id=$1 order by l.id`, [jeB])).rows;
check("the journals themselves are untouched — same entry ids, same three lines, no money moved",
  jeBLines.length === 3 && mils(jeBLines[0].debit) === 1880000 && mils(jeBLines[1].credit) === 1900000
    && mils(jeBLines[2].debit) === 20000, JSON.stringify(jeBLines));
check("C and D were NOT migrated even in apply mode",
  (await pool.query(
    "select count(*)::int n from advance_applications where org_id=$1 and advance_payment_id in ($2,$3)", [org, payC, payD])).rows[0].n === 0);
const ledger = (await pool.query(
  `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
     from journal_lines l join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
check("LEDGER BALANCED after the backfill (it moves no money, so this must be unchanged)", ledger.dr === ledger.cr, `${ledger.dr} vs ${ledger.cr}`);
// The script is a MIGRATION: it sweeps every org, so a shared dev database contributes candidates
// from other fixtures and a global "migrated=N" is not this suite's to pin. What belongs to this
// suite is its own org's outcome and its own rows' log lines.
check("apply migrated exactly this org's two eligible rows, and said so per row",
  (await pool.query("select count(*)::int n from advance_applications where org_id=$1", [org])).rows[0].n === 2
    && new RegExp(`\\+ allocation ${allocA.id} created and journal ${jeA} re-keyed`).test(applied)
    && new RegExp(`\\+ allocation ${allocB.id} created and journal ${jeB} re-keyed`).test(applied),
  applied.match(/Totals.*/)?.[0] ?? "(no totals)");

// ================= 3. idempotent: a second apply changes nothing =================
const afterApply = await snapshot();
const again = run(true);
check("a second apply finds only the two manual-review rows for this org",
  new RegExp(`payment ${payC}`).test(again) && new RegExp(`payment ${payD}`).test(again)
    && !new RegExp(`payment ${payA}\\b`).test(again) && !new RegExp(`payment ${payB}\\b`).test(again),
  again.match(/Totals.*/)?.[0] ?? "(no totals)");
check("…and changed NOTHING — no second allocation, no re-keyed journal", afterApply === (await snapshot()));

await sweep();
await pool.end();
let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCE BACKFILL PASS" : "ADVANCE BACKFILL FAIL");
process.exit(allOk ? 0 : 1);
