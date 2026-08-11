// Run via `npm run verify:fx-reporting` — tsx with the react-server condition, like every server suite.

/**
 * FX-8, dashboard layer. Every money figure sums STORED base amounts against HAND-COMPUTED
 * expectations — the numbers below were worked out on paper from the fixture rates, not read back
 * from the code under test.
 *
 *  - **Multi-currency org**: SAR base with USD (3.75), BHD-denominated (9.94) and GBP (4.71)
 *    documents at different stored rates; KPIs, receivables/payables and the revenue series land
 *    on the exact base figures.
 *  - **Identity rule is load-bearing**: a base-currency invoice with NULL base columns (the
 *    born-paid conversion shape) counts fully via its document figures — it is NOT bad data.
 *  - **Seeded null-base rows** (foreign, posted, no stored conversion — impossible via FX-6, so
 *    seeded deliberately): excluded from every total AND surfaced by getBaseDataQuality's count.
 *    Drafts with null base columns are by design and never counted.
 *  - **Pure-SAR org**: totals equal plain document sums, data-quality count zero — no regression
 *    for the common case.
 *
 * Mutation-proofed (see the README entry): reading the document total for foreign rows, or
 * coercing null base to the document figure (the 1:1 defect), each fail with the wrong total named.
 */
import { Pool } from "pg";
import { getKpis, getRevenueSeries, getBaseDataQuality } from "../src/app/(app)/dashboard/_shared/queries";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const FIXTURE = "verifyfxr_";
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);

const newOrg = async (label: string, currency: string) =>
  (await pool.query("insert into orgs (name, currency, country) values ($1,$2,'Saudi Arabia') returning id",
    [`${FIXTURE}${label}_${uniq()}`, currency])).rows[0].id as number;
const newUser = async (orgId: number) =>
  (await pool.query("insert into users (org_id,name,email,password_hash,role) values ($1,'FXR',$2,'x','owner') returning id",
    [orgId, `fxr_${uniq()}@t.dev`])).rows[0].id as number;

const org = await newOrg("multi", "SAR");
const uid = await newUser(org);
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'C') returning id", [org])).rows[0].id;
const vend = (await pool.query("insert into vendors (org_id,name) values ($1,'V') returning id", [org])).rows[0].id;

const today = new Date().toISOString().slice(0, 10);
type Inv = { currency: string | null; status: string; total: string; paid?: string; rate?: string | null; baseTotal?: string | null; basePaid?: string | null };
const mkInvoice = async (o: number, u: number, c: number, i: Inv) =>
  pool.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total, paid_amount,
                                 currency, status, exchange_rate, base_total, base_paid_amount, created_by_id)
     values ($1,$2,$3,$4,$4,$5,'0','0',$5,$6,$7,$8,$9,$10,$11,$12)`,
    [o, `FXR-${uniq()}`, c, today, i.total, i.paid ?? "0", i.currency, i.status, i.rate ?? null, i.baseTotal ?? null, i.basePaid ?? null, u]);
const mkPo = async (o: number, u: number, v: number, i: Inv) =>
  pool.query(
    `insert into purchase_orders (org_id, po_number, vendor_id, order_date, subtotal, discount, tax_total, total, paid_amount,
                                  currency, status, exchange_rate, base_total, base_paid_amount, created_by_id)
     values ($1,$2,$3,$4,$5,'0','0',$5,$6,$7,$8,$9,$10,$11,$12)`,
    [o, `FXRP-${uniq()}`, v, today, i.total, i.paid ?? "0", i.currency, i.status, i.rate ?? null, i.baseTotal ?? null, i.basePaid ?? null, u]);

// ---- fixtures, with the expected figures worked out BY HAND from the stated rates ----
// A1  SAR sent, 1000, unpaid, identity columns present        → sales 1000.00, recv 1000.00
// A2  SAR partially_paid 500 (paid 200) with NULL base cols   → sales  500.00, recv  300.00  (identity rule, NOT bad data)
// U1  USD sent 1000 @3.75 → base 3750.00, unpaid              → sales 3750.00, recv 3750.00
// B1  BHD-doc partially_paid 100 @9.94 → base 994.00, paid 40 (basePaid 397.60) → sales 994.00, recv 596.40
// N1  USD sent 800, NO stored conversion (seeded bad row)     → excluded everywhere, counted = 1
// D1  USD DRAFT 999, null base                                → invisible: not a total, not a count
// P1  GBP received 2300 @4.71 → base 10833.00, paid 1000 (basePaid 4710.00) → pay 6123.00
// P2  GBP received 600, NO stored conversion (seeded bad row) → excluded, counted = 1
// P3  SAR received 700, unpaid, identity                      → pay 700.00
await mkInvoice(org, uid, cust, { currency: null, status: "sent", total: "1000.00", rate: "1", baseTotal: "1000.00", basePaid: "0" });
await mkInvoice(org, uid, cust, { currency: null, status: "partially_paid", total: "500.00", paid: "200.00" });
await mkInvoice(org, uid, cust, { currency: "USD", status: "sent", total: "1000.00", rate: "3.75", baseTotal: "3750.00", basePaid: "0" });
await mkInvoice(org, uid, cust, { currency: "BHD", status: "partially_paid", total: "100.00", paid: "40.00", rate: "9.94", baseTotal: "994.00", basePaid: "397.60" });
await mkInvoice(org, uid, cust, { currency: "USD", status: "sent", total: "800.00" });
await mkInvoice(org, uid, cust, { currency: "USD", status: "draft", total: "999.00" });
await mkPo(org, uid, vend, { currency: "GBP", status: "received", total: "2300.00", paid: "1000.00", rate: "4.71", baseTotal: "10833.00", basePaid: "4710.00" });
await mkPo(org, uid, vend, { currency: "GBP", status: "received", total: "600.00" });
await mkPo(org, uid, vend, { currency: null, status: "received", total: "700.00", rate: "1", baseTotal: "700.00", basePaid: "0" });

const range = { start: today, end: today, prevStart: "2000-01-01", prevEnd: "2000-01-02", key: "today" } as never;

// ---- 1. the multi-currency org, against the hand-computed figures ----
const kpis = await getKpis(org, range);
check("Total Sales = 1000 + 500 + 3750 + 994 = 6244.00 (N1 excluded, D1 draft)", kpis.totalSalesThisMonth === 6244, String(kpis.totalSalesThisMonth));
check("Receivables = 1000 + 300 + 3750 + 596.40 = 5646.40 — both sides base, never mixed", kpis.totalReceivables === 5646.4, String(kpis.totalReceivables));
check("Payables = 6123 + 700 = 6823.00", kpis.totalPayables === 6823, String(kpis.totalPayables));
const series = await getRevenueSeries(org, range);
const seriesTotal = series.reduce((s, b) => s + b.total, 0);
check("the revenue series sums to the same 6244.00", seriesTotal === 6244, String(seriesTotal));

// ---- 2. the visible count: seeded bad rows surfaced, drafts and identity-nulls not ----
const dq = await getBaseDataQuality(org);
check("data quality counts EXACTLY the two seeded bad rows (1 invoice + 1 PO)",
  dq.invoices === 1 && dq.purchaseOrders === 1 && dq.total === 2, JSON.stringify(dq));

// ---- 3. pure-SAR org: document sums, zero count — the common case regresses nowhere ----
const orgS = await newOrg("sar", "SAR");
const uidS = await newUser(orgS);
const custS = (await pool.query("insert into customers (org_id,name) values ($1,'C') returning id", [orgS])).rows[0].id;
const vendS = (await pool.query("insert into vendors (org_id,name) values ($1,'V') returning id", [orgS])).rows[0].id;
await mkInvoice(orgS, uidS, custS, { currency: null, status: "sent", total: "900.00", rate: "1", baseTotal: "900.00", basePaid: "0" });
await mkPo(orgS, uidS, vendS, { currency: null, status: "received", total: "400.00", rate: "1", baseTotal: "400.00", basePaid: "0" });
const kpisS = await getKpis(orgS, range);
const dqS = await getBaseDataQuality(orgS);
check("pure-SAR org: sales 900, receivables 900, payables 400 — unchanged semantics",
  kpisS.totalSalesThisMonth === 900 && kpisS.totalReceivables === 900 && kpisS.totalPayables === 400, JSON.stringify(kpisS));
check("pure-SAR org: data-quality count is zero", dqS.total === 0, JSON.stringify(dqS));

// ---------------- cleanup ----------------
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
await pool.end();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "FX REPORTING PASS" : "FX REPORTING FAIL");
process.exit(ok ? 0 : 1);
