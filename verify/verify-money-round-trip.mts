// Run via `npm run verify:money-round-trip`. The script supplies two flags this file cannot supply
// for itself — see verify/README.md for why a line at the top of a module is not early enough.

/**
 * FX-0. Money survives a full round trip at its own currency's precision.
 *
 * The static suite (`verify:money-precision`) proves no hardcoded rounding remains in the source.
 * That is a claim about the code. This one is a claim about the **data**: a three-decimal amount
 * computed, written to `numeric(15,3)`, read back, and re-totalled must still be the same number.
 * A column migrated to three decimals is worthless if the code writing into it rounds to two, and
 * a static grep cannot see that.
 *
 * Four currencies, chosen because each breaks a different assumption:
 *
 *  - **KWD (3 decimals)** — the case the old code silently truncated.
 *  - **BHD (3 decimals, 10% VAT)** — the tax figure is asserted to be the RIGHT number, not merely
 *    non-zero. 1,333.35 at 10% is 133.335: a genuine third decimal that only survives if every
 *    step, including the VAT computation, is currency-aware. A non-zero assertion would have
 *    passed just as happily on 133.34, which is the bug.
 *  - **JPY (0 decimals)** — the mirror failure: inventing decimals a currency does not have.
 *  - **SAR (2 decimals)** — the control. If this regressed, the fix broke the common case.
 *
 * The last section is the one worth having: **debits equal credits exactly, at three decimals**,
 * on a real posted journal entry in a Kuwaiti organization. Every other assertion here is about a
 * displayed or stored figure; that one is about the ledger, where a wrong number is worse than a
 * missing feature.
 *
 * Every "it rounds correctly" assertion is paired with an explicit statement of what the OLD
 * two-decimal behaviour would have produced, and asserts the value is not that — so a regression
 * to the previous behaviour fails loudly rather than passing on a coincidence.
 */

import { Pool } from "pg";
import { roundMoney, moneyEpsilon, moneyDecimals, formatAmount, buildMoneyMark, markFormat } from "../src/lib/currency/currencies";
import { computeTotals } from "../src/app/(app)/sales/_shared/totals";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

// Fixtures carry a prefix and are swept first — mutation testing kills this suite part-way
// through, which skips the cleanup at the end and would otherwise leave orphan orgs behind.
const FIXTURE = "verifymp_";

/**
 * Remove every fixture org and everything hanging off it.
 *
 * `journal_lines` references `accounts` WITHOUT `on delete cascade`, so deleting the org alone
 * fails on a foreign key and leaves the fixture wedged — which then breaks the NEXT run's sweep
 * too, not just this one's teardown. The ledger rows therefore come out first, explicitly.
 */
async function sweep() {
  const orgs = (await pool.query("select id from orgs where name like $1", [`${FIXTURE}%`])).rows.map((r) => r.id);
  if (orgs.length === 0) return;
  await pool.query("delete from journal_lines where journal_entry_id in (select id from journal_entries where org_id = any($1))", [orgs]);
  await pool.query("delete from journal_entries where org_id = any($1)", [orgs]);
  await pool.query("delete from orgs where id = any($1)", [orgs]);
}
await sweep();
const newOrg = async (currency: string) =>
  (await pool.query("insert into orgs (name, currency) values ($1,$2) returning id", [`${FIXTURE}${currency}_${uniq()}`, currency]))
    .rows[0].id as number;

// ---------------- 1. the rounder itself ----------------
check("KWD keeps three decimals", roundMoney("1250.075", "KWD") === "1250.075", roundMoney("1250.075", "KWD"));
check("…and is NOT the old two-decimal answer", roundMoney("1250.075", "KWD") !== "1250.08");
check("BHD keeps three decimals", roundMoney("133.335", "BHD") === "133.335", roundMoney("133.335", "BHD"));
check("OMR keeps three decimals", roundMoney("0.001", "OMR") === "0.001", roundMoney("0.001", "OMR"));
check("JPY carries none", roundMoney("1250.4", "JPY") === "1250", roundMoney("1250.4", "JPY"));
check("…and does NOT invent two", roundMoney("1250.4", "JPY") !== "1250.40");
check("SAR still does exactly what it did (control)", roundMoney("1250.075", "SAR") === "1250.08", roundMoney("1250.075", "SAR"));
check("an unknown code degrades to two, not to zero", roundMoney("1250.075", "ZZZ") === "1250.08", roundMoney("1250.075", "ZZZ"));
check("rounds half AWAY from zero, negative side too", roundMoney("-0.0005", "KWD") === "-0.001", roundMoney("-0.0005", "KWD"));

// ---------------- 2. the tolerance ----------------
check("half a fils is 0.0005, not 0.005", moneyEpsilon("KWD") === 0.0005, String(moneyEpsilon("KWD")));
check("half a halala is 0.005", moneyEpsilon("SAR") === 0.005, String(moneyEpsilon("SAR")));
check("half a yen is 0.5", moneyEpsilon("JPY") === 0.5, String(moneyEpsilon("JPY")));
check("the KWD tolerance is ten times TIGHTER than the old constant", moneyEpsilon("KWD") < 0.005);

// ---------------- 3. totals, computed through the real production helper ----------------
// 1,333.35 at 10% VAT is 133.335 — a genuine third decimal, not a rounding artefact.
const bhd = computeTotals([{ quantity: "1", unitPrice: "1333.35", taxRatePercent: "10" }], 0, "BHD");
check("BHD subtotal keeps its third decimal", bhd.subtotal === "1333.350", bhd.subtotal);
check("BHD VAT at 10% is EXACTLY 133.335", bhd.taxTotal === "133.335", bhd.taxTotal);
check("…and is not the two-decimal 133.34 (the figure a tax authority would reject)", bhd.taxTotal !== "133.34");
check("…nor 133.33", bhd.taxTotal !== "133.33");
check("BHD total is exactly 1466.685", bhd.total === "1466.685", bhd.total);
check("BHD total equals subtotal + VAT to the fils",
  Number(bhd.total) === Number(bhd.subtotal) + Number(bhd.taxTotal),
  `${bhd.total} vs ${Number(bhd.subtotal) + Number(bhd.taxTotal)}`);

const kwd = computeTotals([{ quantity: "3", unitPrice: "416.675", taxRatePercent: "0" }], 0, "KWD");
check("KWD subtotal 3 x 416.675 is 1250.025", kwd.subtotal === "1250.025", kwd.subtotal);
check("…and not the truncated 1250.03", kwd.subtotal !== "1250.03");

const jpy = computeTotals([{ quantity: "1", unitPrice: "1250.4", taxRatePercent: "0" }], 0, "JPY");
check("JPY total carries no decimal point at all", jpy.total === "1250", jpy.total);

const sar = computeTotals([{ quantity: "2", unitPrice: "100", taxRatePercent: "15" }], 0, "SAR");
check("SAR control: 200 at 15% is 30.00", sar.taxTotal === "30.00", sar.taxTotal);
check("SAR control: total 230.00", sar.total === "230.00", sar.total);

// ---------------- 4. display follows the CURRENCY, not the org's Number Format setting ----------------
// A Kuwaiti org left on the default "2 decimal places" must still print three on money.
const kwdMark = buildMoneyMark({ currencyCode: "KWD", decimalPlaces: 2 });
check("a KWD org on the default setting still displays three decimals",
  formatAmount(1250.075, markFormat(kwdMark)) === "1,250.075", formatAmount(1250.075, markFormat(kwdMark)));
check("…and not the setting's two", formatAmount(1250.075, markFormat(kwdMark)) !== "1,250.08");
const jpyMark = buildMoneyMark({ currencyCode: "JPY", decimalPlaces: 3 });
check("a JPY org asking for three decimals still displays none",
  formatAmount(1250, markFormat(jpyMark)) === "1,250", formatAmount(1250, markFormat(jpyMark)));

// ---------------- 5. the database actually stores the third decimal ----------------
// numeric(15,3) is the claim; this is the proof. A column migrated to three decimals is worthless
// if it silently rounds on write.
const kwdOrg = await newOrg("KWD");
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'MP',$2,'x','owner') returning id",
  [kwdOrg, `mp_${uniq()}@t.dev`])).rows[0].id;
const cust = (await pool.query(
  "insert into customers (org_id, name) values ($1,$2) returning id", [kwdOrg, "verifymp customer"])).rows[0].id;
const invNo = `MP-${uniq()}`;
const inv = (await pool.query(
  `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,'2026-01-01',$4,'0',$5,$6,'KWD','draft',$7) returning id`,
  [kwdOrg, invNo, cust, kwd.subtotal, kwd.taxTotal, kwd.total, user])).rows[0].id;
const stored = (await pool.query("select subtotal, tax_total, total from sales_invoices where id=$1", [inv])).rows[0];
check("the stored subtotal kept its third decimal", stored.subtotal === "1250.025", String(stored.subtotal));
check("…so the write did not silently round to 1250.03", String(stored.subtotal) !== "1250.03");
check("the stored total round-trips unchanged", Number(stored.total) === Number(kwd.total), `${stored.total} vs ${kwd.total}`);

// A three-decimal figure that is NOT representable in two decimals, stored and read back.
await pool.query("update sales_invoices set tax_total=$1 where id=$2", ["133.335", inv]);
const tax = (await pool.query("select tax_total from sales_invoices where id=$1", [inv])).rows[0].tax_total;
check("a bare 0.005-style third decimal survives the column", tax === "133.335", String(tax));

// ---------------- 6. THE LEDGER: debits equal credits, exactly, at three decimals ----------------
// The assertion this whole task exists to protect. A Kuwaiti journal entry whose two sides differ
// by one fils must not be able to look balanced.
const acct = async (code: string, name: string, type: string, normal: string) =>
  (await pool.query(
    `insert into accounts (org_id, code, name, type, normal_balance) values ($1,$2,$3,$4,$5) returning id`,
    [kwdOrg, code, name, type, normal])).rows[0].id;
const bankAcct = await acct("1000", "Cash", "asset", "debit");
const revAcct = await acct("4000", "Revenue", "revenue", "credit");

const entry = (await pool.query(
  `insert into journal_entries (org_id, entry_date, memo, source_type, created_by_id) values ($1,'2026-01-01','verifymp kwd','manual',$2) returning id`,
  [kwdOrg, user])).rows[0].id;
await pool.query(`insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,'0')`,
  [entry, bankAcct, "1250.025"]);
await pool.query(`insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,'0',$3)`,
  [entry, revAcct, "1250.025"]);

const sums = (await pool.query(
  `select coalesce(sum(debit),0)::text dr, coalesce(sum(credit),0)::text cr
     from journal_lines where journal_entry_id=$1`, [entry])).rows[0];
check("KWD ledger: debits equal credits as exact decimal strings",
  roundMoney(sums.dr, "KWD") === roundMoney(sums.cr, "KWD"), `${sums.dr} vs ${sums.cr}`);
check("KWD ledger: both sides kept the third decimal",
  roundMoney(sums.dr, "KWD") === "1250.025", roundMoney(sums.dr, "KWD"));
check("KWD ledger: the difference is exactly zero, not merely small",
  Number(sums.dr) - Number(sums.cr) === 0, String(Number(sums.dr) - Number(sums.cr)));

// The negative control: an entry off by ONE FILS must NOT compare equal. Without this, the
// assertion above would pass just as happily if both sides were being rounded to two decimals
// before comparison — which is precisely the bug.
const badEntry = (await pool.query(
  `insert into journal_entries (org_id, entry_date, memo, source_type, created_by_id) values ($1,'2026-01-01','verifymp kwd off-by-one','manual',$2) returning id`,
  [kwdOrg, user])).rows[0].id;
await pool.query(`insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,'0')`,
  [badEntry, bankAcct, "1250.025"]);
await pool.query(`insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,'0',$3)`,
  [badEntry, revAcct, "1250.026"]);
const badSums = (await pool.query(
  `select coalesce(sum(debit),0)::text dr, coalesce(sum(credit),0)::text cr
     from journal_lines where journal_entry_id=$1`, [badEntry])).rows[0];
check("CONTROL: a one-fils imbalance is detected, not rounded away",
  roundMoney(badSums.dr, "KWD") !== roundMoney(badSums.cr, "KWD"), `${badSums.dr} vs ${badSums.cr}`);
check("CONTROL: …and the old two-decimal comparison WOULD have called it balanced",
  roundMoney(badSums.dr, "SAR") === roundMoney(badSums.cr, "SAR"),
  `${roundMoney(badSums.dr, "SAR")} vs ${roundMoney(badSums.cr, "SAR")}`);

// ---------------- 7. minor units, as the catalogue states them ----------------
for (const [code, dp] of [["KWD", 3], ["BHD", 3], ["OMR", 3], ["SAR", 2], ["AED", 2], ["QAR", 2], ["USD", 2], ["JPY", 0]] as const) {
  check(`${code} has ${dp} minor-unit decimals`, moneyDecimals("document", code) === dp, String(moneyDecimals("document", code)));
}

// ---------------- cleanup ----------------
await sweep();
await pool.end();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "MONEY ROUND TRIP PASS" : "MONEY ROUND TRIP FAIL");
process.exit(ok ? 0 : 1);
