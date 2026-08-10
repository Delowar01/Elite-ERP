// Run via `npm run verify:base-backfill`. The script supplies the two flags this file cannot
// supply for itself — see verify/README.md.

/**
 * FX-5. The base-amount backfill fills exactly the rows it should and no others.
 *
 * Four properties, each with a control that fails if the guard it tests were deleted:
 *
 *  - **Base-currency rows are filled with the identity conversion** — rate 1, base amounts equal
 *    to the document's own amounts, `basePaidAmount` included where the table has one. A null
 *    document currency counts as base, because that is what null means everywhere in the schema.
 *  - **A foreign-currency row is NEVER touched.** Its base amounts stay null and it is counted in
 *    `skippedForeign`. The assertion is not just "still null" but also that the reported count is
 *    non-zero — an absence check with no positive control passes just as happily when the query is
 *    broken.
 *  - **Cross-org isolation.** The same currency code is base in one fixture org and foreign in
 *    another; each org's rows are classified against its own base. A global default would fill the
 *    USD row in the Saudi org or skip it in the US org — either way a fixture catches it.
 *  - **Idempotent.** A second run reports zero filled, and a row's values are byte-identical after
 *    it. The guard is `base_total is null`, so the re-run test also plants a row whose base_total
 *    was already set to a DIFFERENT value than the mechanical fill would produce, and asserts the
 *    backfill does not "correct" it — filled once means filled, not continuously re-derived.
 */

import { Pool } from "pg";
import { backfillBaseAmounts, BACKFILL_TABLES } from "../scripts/backfill-base-amounts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const FIXTURE = "verifybf_";
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);

const newOrg = async (label: string, currency: string) =>
  (await pool.query("insert into orgs (name, currency) values ($1,$2) returning id",
    [`${FIXTURE}${label}_${uniq()}`, currency])).rows[0].id as number;
const newUser = async (orgId: number) =>
  (await pool.query("insert into users (org_id,name,email,password_hash,role) values ($1,'BF',$2,'x','owner') returning id",
    [orgId, `bf_${uniq()}@t.dev`])).rows[0].id as number;
const newCustomer = async (orgId: number) =>
  (await pool.query("insert into customers (org_id,name) values ($1,'bf customer') returning id", [orgId])).rows[0].id as number;

// Two orgs with DIFFERENT base currencies, so the same code (USD) is base in one and foreign in
// the other — the cross-org isolation case is real data, not an argument.
const sarOrg = await newOrg("sar", "SAR");
const usdOrg = await newOrg("usd", "USD");
const sarUser = await newUser(sarOrg);
const usdUser = await newUser(usdOrg);
const sarCust = await newCustomer(sarOrg);
const usdCust = await newCustomer(usdOrg);

// Fixture invoices in the SAR org: one null-currency (=> base), one explicit SAR (=> base),
// one USD (=> foreign, must be skipped), one already-converted (=> must not be re-derived).
const mkInvoice = async (orgId: number, userId: number, custId: number, currency: string | null, extra = "") => {
  const cols = extra ? `, ${extra.split("=")[0].trim()}` : "";
  const vals = extra ? `, ${extra.split("=")[1].trim()}` : "";
  return (await pool.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, subtotal, discount, tax_total, total, paid_amount, currency, status, created_by_id${cols})
     values ($1,$2,$3,'2026-01-01','100.000','0','15.000','115.000','15.000',$4,'draft',$5${vals}) returning id`,
    [orgId, `BF-${uniq()}`, custId, currency, userId])).rows[0].id as number;
};

const nullCurrency = await mkInvoice(sarOrg, sarUser, sarCust, null);
const explicitBase = await mkInvoice(sarOrg, sarUser, sarCust, "SAR");
const foreignInSar = await mkInvoice(sarOrg, sarUser, sarCust, "USD");
const usdInUsdOrg = await mkInvoice(usdOrg, usdUser, usdCust, "USD");   // base THERE
const sarInUsdOrg = await mkInvoice(usdOrg, usdUser, usdCust, "SAR");   // foreign THERE
// Already converted at a real (non-identity) rate: the backfill must leave it byte-identical.
const preConverted = await mkInvoice(sarOrg, sarUser, sarCust, "USD",
  "exchange_rate = '3.75000000'");
await pool.query("update sales_invoices set base_total='431.250', base_tax_amount='56.250' where id=$1", [preConverted]);

// A quotation too, so a no-paid-amount table is exercised alongside the paid one.
const quo = (await pool.query(
  `insert into quotations (org_id, quotation_number, customer_id, issue_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,'2026-01-01','200.000','0','30.000','230.000',null,'draft',$4) returning id`,
  [sarOrg, `BFQ-${uniq()}`, sarCust, sarUser])).rows[0].id as number;

// ---------------- run 1 ----------------
const run1 = await backfillBaseAmounts(pool, [sarOrg, usdOrg]);
const inv = async (id: number) =>
  (await pool.query("select exchange_rate, base_total, base_tax_amount, base_paid_amount from sales_invoices where id=$1", [id])).rows[0];

const a = await inv(nullCurrency);
check("null currency counts as base: filled", a.base_total === "115.000", JSON.stringify(a));
check("…with rate exactly 1", Number(a.exchange_rate) === 1, String(a.exchange_rate));
check("…tax filled from tax_total", a.base_tax_amount === "15.000", String(a.base_tax_amount));
check("…paid filled from paid_amount", a.base_paid_amount === "15.000", String(a.base_paid_amount));

const b = await inv(explicitBase);
check("explicit base currency: filled the same way", b.base_total === "115.000" && Number(b.exchange_rate) === 1, JSON.stringify(b));

const c = await inv(foreignInSar);
check("foreign row in SAR org: base_total STAYS NULL", c.base_total === null, String(c.base_total));
check("…rate stays null too (no fake identity rate)", c.exchange_rate === null, String(c.exchange_rate));
check("…and it is COUNTED, not silently ignored", run1.skippedForeign > 0, String(run1.skippedForeign));

const d = await inv(usdInUsdOrg);
check("the SAME code (USD) is base in the US org: filled", d.base_total === "115.000", JSON.stringify(d));
const e = await inv(sarInUsdOrg);
check("…and SAR is foreign there: stays null", e.base_total === null, String(e.base_total));

const f = await inv(preConverted);
check("an already-converted row keeps its REAL rate", f.exchange_rate === "3.75000000", String(f.exchange_rate));
check("…and its real base amounts (not re-derived to the identity)", f.base_total === "431.250", String(f.base_total));

const q = (await pool.query("select exchange_rate, base_total, base_tax_amount from quotations where id=$1", [quo])).rows[0];
check("quotations (no paid column) fill too", q.base_total === "230.000" && Number(q.exchange_rate) === 1, JSON.stringify(q));

// Exactly four: nullCurrency, explicitBase, usdInUsdOrg, and the quotation. NOT preConverted — a
// USD row whose base_total was already set, so the null-guard excludes it from the fill and its
// non-null base_total excludes it from the foreign count too.
check("run 1 filled exactly the four base rows", run1.filled === 4, String(run1.filled));
check("run 1 skipped exactly the two foreign rows", run1.skippedForeign === 2, String(run1.skippedForeign));
check("the report covers all seven tables", run1.perTable.length === BACKFILL_TABLES.length, String(run1.perTable.length));

// ---------------- run 2: idempotence ----------------
const run2 = await backfillBaseAmounts(pool, [sarOrg, usdOrg]);
check("a second run fills NOTHING", run2.filled === 0, String(run2.filled));
check("…and still reports the same foreign rows as unconverted", run2.skippedForeign === 2, String(run2.skippedForeign));
const a2 = await inv(nullCurrency);
check("a filled row is byte-identical after the re-run", JSON.stringify(a2) === JSON.stringify(a));

// ---------------- the filter narrows; the JOIN classifies ----------------
// Cross-org isolation was already proven above INSIDE one filtered call: the same code (USD) was
// filled in one org and skipped in the other in a single invocation, so classification comes from
// the per-row join, not from the filter. What remains to check is that the filter itself is
// honoured — a third fixture org NOT in the filter list must be left untouched by a filtered run.
// (The suite deliberately never calls the backfill unfiltered: that would write identity fills
// into every real org in the database, and a verify suite does not mutate rows it did not create.)
const outsideOrg = await newOrg("outside", "SAR");
const outsideUser = await newUser(outsideOrg);
const outsideCust = await newCustomer(outsideOrg);
const outsideInv = await mkInvoice(outsideOrg, outsideUser, outsideCust, null);
await backfillBaseAmounts(pool, [sarOrg, usdOrg]);
const o = await inv(outsideInv);
check("a filtered run leaves orgs outside the filter untouched", o.base_total === null, String(o.base_total));
// CONTROL: the same org, once included, fills — so the assertion above cannot pass on a broken query.
const run3 = await backfillBaseAmounts(pool, [outsideOrg]);
check("CONTROL: including that org fills its row", run3.filled === 1 && (await inv(outsideInv)).base_total === "115.000",
  String(run3.filled));

// ---------------- cleanup ----------------
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
await pool.end();

let ok = true;
for (const [cd, n, x] of results) { if (!cd) ok = false; console.log(`${cd ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "BASE BACKFILL PASS" : "BASE BACKFILL FAIL");
process.exit(ok ? 0 : 1);
