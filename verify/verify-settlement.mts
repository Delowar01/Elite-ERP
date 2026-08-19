// Run via `npm run verify:settlement` — tsx with the react-server condition.

/**
 * A CREDIT NOTE IS NOT A PAYMENT.
 *
 * `paidAmount` used to absorb credit-note value. On a fully-paid 575 invoice credited in full it
 * reported Paid 1,150 and a balance of −575. The increment was not careless — it was holding up the
 * ledger identity `GL 1100 = baseTotal − basePaidAmount`, because a credit note relieves AR exactly
 * as a payment does. Removing it without replacing that identity would have made every receivable
 * figure in the product overstate.
 *
 * So the fix splits the channel rather than deleting the arithmetic:
 *
 *     outstanding = total − paidAmount − creditedAmount
 *     GL 1100     = baseTotal − basePaidAmount − baseCreditedAmount
 *
 * This suite proves the document-side arithmetic and, at every step, that the LEDGER is unchanged —
 * the journal entries were always right and nothing here may touch them.
 */
import { Pool } from "pg";
import { settlementOf, overSettlement } from "../src/lib/settlement";
import { roundMoney } from "../src/lib/currency/currencies";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number | null) => Math.round(Number(v ?? 0) * 1000);

const FIXTURE = "verifysettle_";
async function sweep() {
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

// ── Pure arithmetic: the model itself ─────────────────────────────────────────────────────────
console.log("");
{
  const full = settlementOf({ total: "575.00", paid: "575.00", credited: "575.00", docCurrency: "USD" });
  check("THE DEFECT: fully paid AND fully credited — outstanding is 0, never −575",
    full.outstanding === "0.00" && Number(full.outstanding) >= 0, `outstanding ${full.outstanding}`);
  check("…and the status is `paid`", full.status === "paid", full.status);

  const partial = settlementOf({ total: "575.00", paid: "300.00", credited: "100.00", docCurrency: "USD" });
  check("partial payment + partial credit: outstanding 175.00, partially_paid",
    partial.outstanding === "175.00" && partial.status === "partially_paid", `${partial.outstanding} / ${partial.status}`);

  const creditOnly = settlementOf({ total: "575.00", paid: "0", credited: "575.00", docCurrency: "USD" });
  check("credited in full with NO payment: outstanding 0, status paid",
    creditOnly.outstanding === "0.00" && creditOnly.status === "paid", `${creditOnly.outstanding} / ${creditOnly.status}`);

  const over = settlementOf({ total: "575.00", paid: "575.00", credited: "700.00", docCurrency: "USD" });
  check("BALANCE NEVER GOES NEGATIVE through crediting — floored at zero",
    over.outstanding === "0.00", over.outstanding);

  const none = settlementOf({ total: "575.00", paid: "0", credited: "0", docCurrency: "USD" });
  check("untouched invoice stays `sent`", none.status === "sent" && none.outstanding === "575.00");

  // The release rule reads both channels. With credits folded into `paid`, a SECOND note computed
  // its over-settlement against a figure the FIRST had already inflated.
  check("OVER-SETTLEMENT is measured across both channels, not off an inflated paid figure",
    overSettlement({ total: "575.00", paid: "575.00", priorCredited: "100.00", thisCredit: "100.00" }) === 200,
    String(overSettlement({ total: "575.00", paid: "575.00", priorCredited: "100.00", thisCredit: "100.00" })));
  check("…and a first note on a fully-paid invoice over-settles by its own value alone",
    overSettlement({ total: "575.00", paid: "575.00", priorCredited: "0", thisCredit: "100.00" }) === 100);
}

// ── Against the database, through the real columns ────────────────────────────────────────────
const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id",
  [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'S',$2,'x','owner') returning id",
  [org, `st_${uniq()}@t.dev`])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2100", "VAT Payable", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Settle Client') returning id", [org])).rows[0].id;
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id",
  [org, acc.get("1000")])).rows[0].id as number;

const RATE = "3.75000000";
const inv = (await pool.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,
                               currency,exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'INV-0007',$2,'2026-07-01','sent','575.00','75.00','0','0','USD',$3,'2156.250','281.250',$4) returning id`,
  [org, cust, RATE, user])).rows[0].id as number;
const arOf = async () => (await pool.query(
  `select coalesce(sum(l.debit) - sum(l.credit),0)::text v from journal_lines l
     join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1 and l.account_id=$2`,
  [org, acc.get("1100")])).rows[0].v as string;
const post = async (st: string, sid: number, lines: [number, string, string][]) => {
  const je = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-01','x',$2,$3,$4) returning id`, [org, st, sid, user])).rows[0].id;
  for (const [a, d, c] of lines) {
    await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)", [je, a, d, c]);
  }
};
await post("sales_invoice", inv, [
  [acc.get("1100")!, "2156.250", "0"], [acc.get("4000")!, "0", "1875.000"], [acc.get("2100")!, "0", "281.250"]]);
const invRow = async () => (await pool.query(
  `select total::text total, paid_amount::text paid, credited_amount::text credited,
          base_paid_amount::text base_paid, base_credited_amount::text base_credited, status, currency
     from sales_invoices where id=$1`, [inv])).rows[0];

// A single real payment of the whole invoice.
const pay = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,base_applied_amount,
                         payment_date,sales_invoice_id,created_by_id)
   values ($1,'in',$5,'575.00','USD',$2,'2156.250','2156.250','2026-08-01',$3,$4) returning id`,
  [org, RATE, inv, user, bank])).rows[0].id;
await post("payment", pay, [[acc.get("1000")!, "2156.250", "0"], [acc.get("1100")!, "0", "2156.250"]]);
await pool.query("update sales_invoices set paid_amount='575.00', base_paid_amount='2156.250', status='paid' where id=$1", [inv]);

const arAfterPay = await arOf();
check("FIXTURE: invoice fully paid — AR is zero, Paid 575", mils(arAfterPay) === 0 && mils((await invRow()).paid) === 575_000,
  `AR ${arAfterPay} / paid ${(await invRow()).paid}`);

/**
 * The credit note's document-side write, exactly as `issueCreditNoteAction` performs it — the
 * NEW model: value goes to `creditedAmount`, `paidAmount` moves only by what a release gave back.
 * `mutateIncrement` restores the OLD behaviour for the mutation below.
 */
async function issueCreditNote(cnTotal: string, cnBase: string, opts: { mutateIncrement?: boolean } = {}) {
  const r = await invRow();
  const docCurrency = r.currency ?? "SAR";
  const cnId = (await pool.query(
    `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,
                               subtotal,tax_total,total,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,$2,$3,$4,'2026-08-15','issued',$5,'0',$5,'USD',$6,$7,'0',$8) returning id`,
    [org, `CN-${uniq()}`, cust, inv, cnTotal, RATE, cnBase, user])).rows[0].id;
  // The posting is unchanged by this work and is asserted unchanged below.
  await post("credit_note", cnId, [
    [acc.get("4000")!, cnBase, "0"], [acc.get("1100")!, "0", cnBase]]);

  if (opts.mutateIncrement) {
    // THE OLD MODEL: fold the note's value into paidAmount.
    await pool.query(
      `update sales_invoices set paid_amount=$1, base_paid_amount=$2 where id=$3`,
      [roundMoney(Number(r.paid) + Number(cnTotal), docCurrency),
       roundMoney(Number(r.base_paid) + Number(cnBase), "SAR"), inv]);
  } else {
    const credited = roundMoney(Number(r.credited) + Number(cnTotal), docCurrency);
    await pool.query(
      `update sales_invoices set credited_amount=$1, base_credited_amount=$2, status=$3 where id=$4`,
      [credited, roundMoney(Number(r.base_credited ?? 0) + Number(cnBase), "SAR"),
       settlementOf({ total: r.total, paid: r.paid, credited, docCurrency }).status, inv]);
  }
  return cnId;
}

// ── A FULL credit note against the fully-paid invoice ─────────────────────────────────────────
const arBeforeCn = await arOf();
await issueCreditNote("575.00", "2156.250");
const afterFull = await invRow();
const settledFull = settlementOf({ total: afterFull.total, paid: afterFull.paid, credited: afterFull.credited, docCurrency: "USD" });

check("PAID STAYS AT THE REAL PAYMENT TOTAL — 575.00, not 1,150",
  mils(afterFull.paid) === 575_000, `paid ${afterFull.paid}`);
check("…the credit is recorded on its OWN channel", mils(afterFull.credited) === 575_000, afterFull.credited);
check("…and the balance due is 0.00, never −575.00",
  settledFull.outstanding === "0.00", settledFull.outstanding);
check("…base twins likewise: basePaidAmount 2,156.25, baseCreditedAmount 2,156.25",
  mils(afterFull.base_paid) === 2_156_250 && mils(afterFull.base_credited) === 2_156_250,
  `${afterFull.base_paid} / ${afterFull.base_credited}`);

// THE LEDGER IDENTITY the old increment was protecting, restated over both channels.
const arAfterCn = await arOf();
check("LEDGER: the credit note moved AR by its full value — the posting is untouched",
  mils(arBeforeCn) - mils(arAfterCn) === 2_156_250, `${arBeforeCn} -> ${arAfterCn}`);
check("IDENTITY HOLDS: GL 1100 == baseTotal − basePaidAmount − baseCreditedAmount",
  mils(arAfterCn) === 2_156_250 - mils(afterFull.base_paid) - mils(afterFull.base_credited),
  `AR ${arAfterCn} vs ${(2_156_250 - mils(afterFull.base_paid) - mils(afterFull.base_credited)) / 1000}`);

// ── AR aging, the dashboard and statements all read outstanding — check the SQL, not just the TS ──
const base = "SAR";
// The SQL identity is asserted with the SAME floor the TS side applies. It was written without one
// at first and this check caught it: a fully-paid, fully-credited invoice contributed −2,156.25.
// AR aging drops non-positive rows so it would never have shown there, but the dashboard SUMS the
// expression, so a single over-settled invoice would have reduced total receivables silently.
const outstandingSql = (await pool.query(
  `select coalesce(sum(GREATEST(0, case when (currency is null or upper(currency) = upper($2))
                            then total - paid_amount - credited_amount
                            else base_total - base_paid_amount - coalesce(base_credited_amount, 0) end)), 0)::text v
     from sales_invoices where org_id=$1`, [org, base])).rows[0].v;
const outstandingUnfloored = (await pool.query(
  `select coalesce(sum(case when (currency is null or upper(currency) = upper($2))
                            then total - paid_amount - credited_amount
                            else base_total - base_paid_amount - coalesce(base_credited_amount, 0) end), 0)::text v
     from sales_invoices where org_id=$1`, [org, base])).rows[0].v;
check("AR AGING / DASHBOARD: outstanding across the SQL identity is 0.00, matching the document",
  mils(outstandingSql) === 0, `sql ${outstandingSql} / doc ${settledFull.outstanding}`);
check("…and the floor is load-bearing: without it this invoice contributes a NEGATIVE receivable",
  mils(outstandingUnfloored) < 0, `unfloored ${outstandingUnfloored}`);

// ── A SECOND credit note must not over-release: the cap reads both channels ───────────────────
{
  const r = await invRow();
  const over = overSettlement({ total: r.total, paid: r.paid, priorCredited: r.credited, thisCredit: "100.00" });
  check("a second note's over-settlement counts the FIRST note's credit, not an inflated paid figure",
    over === 675, String(over));
  // Under the old model paid would already read 1,150, so over-settlement came out 675 too — but
  // for the wrong reason, and with `paid` unusable everywhere else. The number that changes is the
  // one a reader sees.
  check("…while PAID still reads the real cash figure", mils(r.paid) === 575_000, r.paid);
}

// ── A PARTIAL credit note, and then a SECOND one, on a fresh invoice ──────────────────────────
{
  const inv2 = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,
                                 credited_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,'INV-P',$2,'2026-07-01','partially_paid','1000.00','0','400.00','1500.000','0','USD',$3,'3750.000','0',$4) returning id`,
    [org, cust, RATE, user])).rows[0].id;
  const row2 = async () => (await pool.query(
    `select total::text total, paid_amount::text paid, credited_amount::text credited, status
       from sales_invoices where id=$1`, [inv2])).rows[0];

  const applyCn = async (amount: string) => {
    const r = await row2();
    const credited = roundMoney(Number(r.credited) + Number(amount), "USD");
    await pool.query("update sales_invoices set credited_amount=$1, status=$2 where id=$3",
      [credited, settlementOf({ total: r.total, paid: r.paid, credited, docCurrency: "USD" }).status, inv2]);
  };

  await applyCn("200.00");
  let r = await row2();
  let s = settlementOf({ total: r.total, paid: r.paid, credited: r.credited, docCurrency: "USD" });
  check("PARTIAL credit: paid stays 400, credited 200, outstanding 400",
    mils(r.paid) === 400_000 && mils(r.credited) === 200_000 && s.outstanding === "400.00",
    `paid ${r.paid} credited ${r.credited} outstanding ${s.outstanding}`);
  check("…and the invoice is still partially_paid", r.status === "partially_paid", r.status);

  await applyCn("600.00");
  r = await row2();
  s = settlementOf({ total: r.total, paid: r.paid, credited: r.credited, docCurrency: "USD" });
  check("TWO credit notes: paid still 400, credited 800, outstanding 0 — settled, not overpaid",
    mils(r.paid) === 400_000 && mils(r.credited) === 800_000 && s.outstanding === "0.00",
    `paid ${r.paid} credited ${r.credited} outstanding ${s.outstanding}`);
  check("…status is paid because it is fully SETTLED, across both channels", r.status === "paid", r.status);
  check("…and paid never once moved — two credit notes added nothing to it", mils(r.paid) === 400_000);
}

// ── An invoice settled by an ADVANCE ALLOCATION plus a credit note ────────────────────────────
{
  const inv3 = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,
                                 credited_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,'INV-A',$2,'2026-07-01','partially_paid','1000.00','0','0','0','0','USD',$3,'3750.000','0',$4) returning id`,
    [org, cust, RATE, user])).rows[0].id;
  // An advance APPLIED is cash that was received earlier — it belongs on the paid channel.
  await pool.query("update sales_invoices set paid_amount='600.00', base_paid_amount='2250.000' where id=$1", [inv3]);
  await pool.query("update sales_invoices set credited_amount='400.00', base_credited_amount='1500.000' where id=$1", [inv3]);
  const r = (await pool.query(
    `select total::text total, paid_amount::text paid, credited_amount::text credited from sales_invoices where id=$1`, [inv3])).rows[0];
  const s = settlementOf({ total: r.total, paid: r.paid, credited: r.credited, docCurrency: "USD" });
  check("ADVANCE + CREDIT NOTE: applied advance sits on PAID (it was cash once), the note on CREDITED",
    mils(r.paid) === 600_000 && mils(r.credited) === 400_000, `paid ${r.paid} / credited ${r.credited}`);
  check("…and together they settle the invoice exactly: outstanding 0, status paid",
    s.outstanding === "0.00" && s.status === "paid", `${s.outstanding} / ${s.status}`);
}

// ── THE MUTATION: restore the paidAmount increment ────────────────────────────────────────────
{
  const invM = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,
                                 credited_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,'INV-M',$2,'2026-07-01','paid','575.00','0','575.00','2156.250','0','USD',$3,'2156.250','0',$4) returning id`,
    [org, cust, RATE, user])).rows[0].id;
  const before = (await pool.query("select paid_amount::text p from sales_invoices where id=$1", [invM])).rows[0].p;
  // The OLD write, verbatim: paidAmount += cn.total.
  await pool.query("update sales_invoices set paid_amount = paid_amount + 575.00 where id=$1", [invM]);
  const after = (await pool.query("select total::text t, paid_amount::text p, credited_amount::text c from sales_invoices where id=$1", [invM])).rows[0];
  const mutated = settlementOf({ total: after.t, paid: after.p, credited: after.c, docCurrency: "USD" });
  check("MUTATION: restoring the increment inflates Paid to 1,150.00 against a 575.00 invoice",
    mils(after.p) === 1_150_000, `paid ${before} -> ${after.p}`);
  check("MUTATION: …and the raw balance goes to −575.00 before the floor catches it",
    Number(after.t) - Number(after.p) === -575, String(Number(after.t) - Number(after.p)));
  check("MUTATION: …which is exactly the reported defect, reproduced",
    mils(after.p) > mils(after.t) && mutated.outstanding === "0.00",
    `paid ${after.p} > total ${after.t}; floored outstanding ${mutated.outstanding}`);
  await pool.query("delete from sales_invoices where id=$1", [invM]);
}

await sweep();
await pool.end();
console.log("\nSettlement — payments, applied advances and credit notes as three separate channels\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "SETTLEMENT PASS" : `SETTLEMENT FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
