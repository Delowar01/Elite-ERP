// Run via `npm run verify:advance-release` — tsx with the react-server condition, like every
// server suite.

/**
 * Releasing allocations (D), against a real database.
 *
 * The claim LIFO exists to support is a ROUND TRIP: apply part of an advance, apply the residual
 * that consumes it, release both, and 2300 must stand exactly where it started — not "within a
 * fils". Releasing in the inverse of application order is what makes that exact, and mirroring each
 * application's STORED lines rather than recomputing them is what makes the mirror faithful: a
 * recomputed release would re-derive residuals and FX against today's figures and drift.
 *
 * A foreign advance is used deliberately, because that is where a recomputed release would show
 * its drift — the two applications carry different FX shapes (one proportional, one residual).
 *
 * Driven through the library rather than a UI, because there is deliberately NO direct release
 * action: an allocation is released only as a consequence of voiding an invoice or issuing a
 * credit note. Void cannot reach it today (the lifecycle refuses to void a settled invoice — see
 * verify-advances), and the credit-note path lands in the next commit, so the mechanism is proven
 * here at the level it actually exists.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
// Imported from their own modules rather than the barrel: under tsx's ESM resolution the barrel's
// re-export chain does not expose these names, though the bundler resolves them fine.
import { advanceApplicationsTable } from "../src/db/schema/advance-applications";
import { journalEntriesTable, journalLinesTable } from "../src/db/schema/accounting";
import { releaseAllocations, planAllocations, availabilityOf, type AdvancePot } from "../src/lib/advance-allocations";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);

const FIXTURE = "verifyallocrel_";
async function sweep() {
  await pool.query(`delete from advance_applications where org_id in (select id from orgs where name like $1)`, [`${FIXTURE}%`]);
  await pool.query(
    `delete from journal_lines where journal_entry_id in
       (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id", [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'R','rel_" + uniq() + "@t.dev','x','owner') returning id", [org])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2300", "Customer Advances", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
  ["4900", "Exchange Gain/Loss", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)", [org, code, name, type, nb]);
}
const acc = new Map<string, number>((await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Release Client') returning id", [org])).rows[0].id as number;

// A FOREIGN advance: USD 1,000 received at 3.76 → carried 3,760.00. The invoice books at 3.80.
const pf = (await pool.query(
  `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,currency,created_by_id)
   values ($1,$2,$3,'sent','2026-08-01','1000.00','0','1000.00','USD',$4) returning id`, [org, `PIREL-${uniq()}`, cust, user])).rows[0].id as number;
const advance = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,currency,exchange_rate,base_amount,base_applied_amount,proforma_invoice_id,created_by_id)
   values ($1,'in',$2,'1000.00','2026-08-01','advance_receipt','USD','3.76','3760.00','3760.00',$3,$4) returning id`,
  [org, bank, pf, user])).rows[0].id as number;
// The receipt's OWN journal — Dr Bank / Cr 2300. Without it 2300 starts at zero and the
// round-trip assertion below would be measuring the wrong baseline (the applications would drive
// it negative and "returning to zero" would look like success).
const receiptEntry = (await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-08-01','Advance received','payment',$2,$3) returning id`, [org, advance, user])).rows[0].id as number;
await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'3760.000','0'),($1,$3,'0','3760.000')",
  [receiptEntry, acc.get("1000"), acc.get("2300")]);

const invoice = (await pool.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,subtotal,discount,tax_total,total,paid_amount,base_paid_amount,base_total,base_tax_amount,exchange_rate,currency,created_by_id)
   values ($1,$2,$3,'2026-08-05','sent','2000.00','0','0','2000.00','0','0','7600.00','0','3.80','USD',$4) returning id`,
  [org, `INVREL-${uniq()}`, cust, user])).rows[0].id as number;
await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,'2026-08-05','Invoice posted','sales_invoice',$2,$3)`,
  [org, invoice, user]);

const potNow = async (): Promise<AdvancePot> => {
  const pay = (await pool.query("select amount::text, base_applied_amount::text, currency from payments where id=$1", [advance])).rows[0];
  const alloc = (await pool.query(
    `select coalesce(sum(applied_amount),0)::text a, coalesce(sum(carried_base),0)::text c
       from advance_applications where org_id=$1 and advance_payment_id=$2 and released_at is null`, [org, advance])).rows[0];
  return { amount: pay.amount, carriedBase: pay.base_applied_amount, consumedAmount: alloc.a, consumedCarried: alloc.c, currency: pay.currency };
};
const invoiceNow = async () => {
  const r = (await pool.query(
    "select total::text, paid_amount::text, base_paid_amount::text, base_total::text, exchange_rate::text, currency from sales_invoices where id=$1", [invoice])).rows[0];
  return { total: r.total, paidAmount: r.paid_amount, basePaidAmount: r.base_paid_amount, baseTotal: r.base_total, exchangeRate: r.exchange_rate, currency: r.currency };
};
const gl2300 = async () => Number((await pool.query(
  `select coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0) net from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id where e.org_id=$1 and l.account_id=$2`, [org, acc.get("2300")])).rows[0].net);
const ledgerBalanced = async () => {
  const r = (await pool.query(
    `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
       from journal_lines l join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
  return r.dr === r.cr;
};

/** Apply `amount` of the advance to the invoice, exactly as the action does. */
async function apply(amount: string) {
  const pot = await potNow();
  const inv = await invoiceNow();
  const planned = planAllocations({
    pots: [{ paymentId: advance, pot }],
    limitAmount: amount,
    invoice: inv,
    baseCurrency: "SAR",
    advancesAccountId: acc.get("2300")!,
    arAccountId: acc.get("1100")!,
    fxAccountId: acc.get("4900")!,
  });
  if (!planned.ok) throw new Error(planned.error);
  const step = planned.plan[0];
  await db.transaction(async (tx) => {
    const [alloc] = await tx.insert(advanceApplicationsTable).values({
      orgId: org, advancePaymentId: advance, salesInvoiceId: invoice,
      appliedAmount: step.appliedAmount, carriedBase: step.carriedBase, arCleared: step.arCleared,
      appliedDate: "2026-08-06", createdById: user,
    }).returning({ id: advanceApplicationsTable.id });
    const [entry] = await tx.insert(journalEntriesTable).values({
      orgId: org, entryDate: "2026-08-06", memo: "Advance applied", sourceType: "advance_application",
      sourceId: alloc.id, createdById: user,
    }).returning({ id: journalEntriesTable.id });
    await tx.insert(journalLinesTable).values(step.lines.map((l) => ({ journalEntryId: entry.id, ...l })));
  });
  await pool.query(
    `update sales_invoices set paid_amount = (paid_amount::numeric + $2)::numeric, base_paid_amount = (base_paid_amount::numeric + $3)::numeric where id=$1`,
    [invoice, step.appliedAmount, step.arCleared]);
  return step;
}

const carriedOriginal = 3760000;
check("fixture: the advance carries 3,760.00 for USD 1,000 at 3.76", mils((await potNow()).carriedBase) === carriedOriginal);

// ---- apply a partial draw, then the residual that consumes the advance ----
const first = await apply("600.00");
check("first application: 600 USD clears AR at the BOOKED rate (600 × 3.80 = 2,280.00), carried share 2,256.00",
  mils(first.arCleared) === 2280000 && mils(first.carriedBase) === 2256000, JSON.stringify(first));
const second = await apply("400.00");
check("second application CONSUMES the advance and takes the carried RESIDUAL (3,760.00 − 2,256.00 = 1,504.00)",
  second.emptiesAdvance && mils(second.carriedBase) === 1504000, JSON.stringify(second));
check("the two applications' carried shares sum to the original EXACTLY",
  mils(first.carriedBase) + mils(second.carriedBase) === carriedOriginal,
  `${first.carriedBase} + ${second.carriedBase}`);
const glAfterApply = await gl2300();
check("2300 is fully drawn down by the applications — the 3,760.00 received is entirely allocated, nothing stranded",
  Math.round(glAfterApply * 1000) === 0, String(glAfterApply));
check("LEDGER BALANCED after both applications", await ledgerBalanced());

// ---- release both, newest first ----
const released = await db.transaction((tx) =>
  releaseAllocations(tx, { orgId: org, userId: user, salesInvoiceId: invoice, reason: "invoice_void", date: "2026-08-07", memoSubject: "round-trip test" }));
check("both allocations released, NEWEST FIRST (LIFO — the inverse of application order)",
  released.length === 2 && released[0].allocationId > released[1].allocationId,
  released.map((r) => `${r.allocationId}:${r.appliedAmount}`).join(", "));
check("each release MIRRORS its application — the released carried figures are the applied ones, not recomputed",
  mils(released[0].carriedBase) === mils(second.carriedBase) && mils(released[1].carriedBase) === mils(first.carriedBase),
  released.map((r) => r.carriedBase).join(", "));
const glAfterRelease = await gl2300();
check("ROUND TRIP: 2300 stands EXACTLY where it started — the full 3,760.00 available again, to the thousandth",
  Math.round(glAfterRelease * 1000) === carriedOriginal, `${glAfterRelease} vs ${carriedOriginal / 1000}`);
check("LEDGER BALANCED after the releases", await ledgerBalanced());
const potAfterRelease = await potNow();
check("availability is restored with NO compensating write — released rows simply stop counting",
  mils(availabilityOf(potAfterRelease, "SAR").availableAmount) === 1000000
    && mils(availabilityOf(potAfterRelease, "SAR").availableCarried) === carriedOriginal,
  JSON.stringify(availabilityOf(potAfterRelease, "SAR")));

// ---- releasing again is inert ----
const entriesBefore = (await pool.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n;
const again = await db.transaction((tx) =>
  releaseAllocations(tx, { orgId: org, userId: user, salesInvoiceId: invoice, reason: "invoice_void", date: "2026-08-07", memoSubject: "retry" }));
check("a repeated release is INERT — no allocation re-released, no second reversing entry",
  again.length === 0 && (await pool.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n === entriesBefore);

// ---- and the advance can be applied AGAIN, exactly as before ----
await pool.query("update sales_invoices set paid_amount='0', base_paid_amount='0' where id=$1", [invoice]);
const reapplied = await apply("600.00");
check("RE-APPLY after release reproduces the first application's figures exactly — the round trip is idempotent",
  mils(reapplied.arCleared) === mils(first.arCleared) && mils(reapplied.carriedBase) === mils(first.carriedBase),
  `${reapplied.carriedBase}/${reapplied.arCleared} vs ${first.carriedBase}/${first.arCleared}`);
check("LEDGER BALANCED after re-applying", await ledgerBalanced());
const activeNow = (await db.select({ id: advanceApplicationsTable.id }).from(advanceApplicationsTable)
  .where(and(eq(advanceApplicationsTable.orgId, org), isNull(advanceApplicationsTable.releasedAt)))).length;
check("released allocations stay on the books — history is marked, never deleted",
  activeNow === 1 && (await pool.query("select count(*)::int n from advance_applications where org_id=$1", [org])).rows[0].n === 3);

await sweep();
await pool.end();
let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCE RELEASE PASS" : "ADVANCE RELEASE FAIL");
process.exit(allOk ? 0 : 1);
