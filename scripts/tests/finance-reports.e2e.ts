// Verification for the Financial Reporting data layer. Confirms reports reconcile with the posted
// journal + ledgers: Trial Balance balances, Balance Sheet balances (Assets = Liabilities + Equity),
// P&L net profit ties to the Balance Sheet's current-period profit, GL closing == account-period
// closing, Cash Flow opening+net==closing, and aging outstanding ties to unpaid invoice/PO balances.
// Run: DATABASE_URL=... npx tsx scripts/tests/finance-reports.e2e.ts
import "./_shim-server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool, orgsTable, salesInvoicesTable, purchaseOrdersTable } from "../../src/db";
import {
  getTrialBalance, getBalanceSheet, getProfitAndLoss, getGeneralLedger, getCashFlow,
  getReceivableAging, getPayableAging, getVatSummary, getAccountPeriods, previousPeriod, fiscalYearRange,
} from "../../src/lib/finance-reports";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const eq2 = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

async function main() {
  console.log("Financial Reporting E2E\n");
  const range = { from: "1900-01-01", to: "2999-12-31" }; // all-time

  // Pick the org with the most journal entries so the checks exercise real data.
  const [org] = await db.select({ id: orgsTable.id, count: sql<number>`(select count(*) from journal_entries je where je.org_id = ${orgsTable.id})` })
    .from(orgsTable).orderBy(sql`(select count(*) from journal_entries je where je.org_id = ${orgsTable.id}) desc`).limit(1);
  if (!org) throw new Error("no org");
  console.log(`  (using org #${org.id})`);

  // ── Trial Balance balances ──
  const tb = await getTrialBalance(org.id, range);
  check("Trial Balance: total debits == total credits", tb.balanced && eq2(tb.totals.closingDr, tb.totals.closingCr), `${tb.totals.closingDr} vs ${tb.totals.closingCr}`);
  check("Trial Balance: opening debits == opening credits", eq2(tb.totals.openingDr, tb.totals.openingCr));
  check("Trial Balance: period debits == period credits", eq2(tb.totals.periodDr, tb.totals.periodCr));

  // ── Balance Sheet balances ──
  const bs = await getBalanceSheet(org.id, range);
  check("Balance Sheet: Total Assets == Total Liabilities + Equity", bs.balanced, `${round2(bs.totalAssets)} vs ${round2(bs.totalLiabilitiesAndEquity)}`);

  // ── P&L ties to Balance Sheet current-period profit ──
  const pnl = await getProfitAndLoss(org.id, range);
  check("P&L net profit == Balance Sheet current-period profit", eq2(pnl.netProfit, bs.currentPeriodProfit), `${round2(pnl.netProfit)} vs ${round2(bs.currentPeriodProfit)}`);
  check("P&L gross profit == revenue − cost of sales", eq2(pnl.grossProfit, pnl.revenueTotal - pnl.costOfSalesTotal));

  // ── GL closing per account == account-period closing ──
  const periods = await getAccountPeriods(org.id, range);
  const gl = await getGeneralLedger(org.id, range);
  let glOk = true;
  for (const block of gl) {
    const p = periods.find((x) => x.id === block.accountId);
    if (p && !eq2(block.closing, p.closing)) { glOk = false; break; }
  }
  check("General Ledger: each account closing == trial-balance closing", glOk);
  // GL total debit/credit across all accounts must balance too.
  const glDr = gl.reduce((s, b) => s + b.totalDebit, 0);
  const glCr = gl.reduce((s, b) => s + b.totalCredit, 0);
  check("General Ledger: total debits == total credits", eq2(glDr, glCr));

  // ── Cash Flow: opening + net == closing; net == op+inv+fin ──
  const cf = await getCashFlow(org.id, range);
  check("Cash Flow: opening + net movement == closing", eq2(cf.openingCash + cf.netMovement, cf.closingCash));
  check("Cash Flow: net == operating + investing + financing", eq2(cf.netMovement, cf.operating + cf.investing + cf.financing));

  // ── AR aging ties to unpaid invoice balances ──
  const arAging = await getReceivableAging(org.id, range.to);
  const [arExpected] = await db.select({ bal: sql<string>`coalesce(sum(${salesInvoicesTable.total} - ${salesInvoicesTable.paidAmount}), 0)` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, org.id), inArray(salesInvoicesTable.status, ["sent", "partially_paid", "paid"]), isNull(salesInvoicesTable.archivedAt), isNull(salesInvoicesTable.deletedAt)));
  check("AR Aging: total outstanding == sum of unpaid invoice balances", eq2(arAging.totalOutstanding, Number(arExpected.bal)), `${round2(arAging.totalOutstanding)} vs ${Number(arExpected.bal)}`);
  check("AR Aging: bucket totals sum to total outstanding", eq2(arAging.buckets.current + arAging.buckets.d1_30 + arAging.buckets.d31_60 + arAging.buckets.d61_90 + arAging.buckets.d90p, arAging.totalOutstanding));

  // ── AP aging ties to unpaid PO balances ──
  const apAging = await getPayableAging(org.id, range.to);
  const [apExpected] = await db.select({ bal: sql<string>`coalesce(sum(${purchaseOrdersTable.total} - ${purchaseOrdersTable.paidAmount}), 0)` })
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.orgId, org.id), eq(purchaseOrdersTable.status, "received"), isNull(purchaseOrdersTable.archivedAt), isNull(purchaseOrdersTable.deletedAt)));
  check("AP Aging: total outstanding == sum of unpaid PO balances", eq2(apAging.totalOutstanding, Number(apExpected.bal)), `${round2(apAging.totalOutstanding)} vs ${Number(apExpected.bal)}`);

  // ── VAT summary ties to invoice/PO tax totals ──
  const vat = await getVatSummary(org.id, range);
  const [salesVat] = await db.select({ tax: sql<string>`coalesce(sum(${salesInvoicesTable.taxTotal}), 0)` }).from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, org.id), inArray(salesInvoicesTable.status, ["sent", "partially_paid", "paid"]), isNull(salesInvoicesTable.archivedAt), isNull(salesInvoicesTable.deletedAt)));
  check("VAT: output VAT == sales tax − credit-note VAT", eq2(vat.outputVat, Number(salesVat.tax) - vat.creditNoteVat), `${round2(vat.outputVat)} vs ${Number(salesVat.tax) - vat.creditNoteVat}`);
  check("VAT: net VAT == output − input", eq2(vat.netVat, vat.outputVat - vat.inputVat));

  // ── Helpers ──
  const fy = fiscalYearRange(1, new Date(Date.UTC(2026, 5, 15)));
  check("fiscalYearRange(Jan start) → Jan 1–Dec 31", fy.from === "2026-01-01" && fy.to === "2026-12-31", `${fy.from}..${fy.to}`);
  const prev = previousPeriod({ from: "2026-02-01", to: "2026-02-28" });
  check("previousPeriod is the equal-length window immediately before", prev.to === "2026-01-31" && prev.from === "2026-01-04", `${prev.from}..${prev.to}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
