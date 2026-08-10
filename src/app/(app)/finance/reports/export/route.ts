import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { roundMoney } from "@/lib/currency/currencies";
import { getLocale } from "@/lib/i18n/server";
import { accountName } from "@/lib/account-names";
import { exportResponse, type ExportColumn } from "@/lib/report-export";
import {
  resolveRange, isReportKind,
  getProfitAndLoss, getBalanceSheet, getCashFlow, getTrialBalance, getGeneralLedger,
  getReceivableAging, getPayableAging, getVatSummary,
} from "@/lib/finance-reports";

// Financial Reports export. GET /finance/reports/export?report=<kind>&from=&to=&account=&format=csv|xlsx|pdf.
// Recomputes the selected report server-side, tenant-scoped (requireSession → orgId), applying the
// same date range / account filter the workspace shows. Read-only — no accounting effect.

// Financial reports and statements are ledger figures, and the general ledger holds BASE currency
// only — so the rounding follows the organization's base currency, resolved per request.
const moneyFor = (currency: string) => (n: number) => roundMoney(n, currency);

export async function GET(req: Request) {
  const session = await requireSession();
  const money = moneyFor(session.orgCurrency);
  // Exports follow the viewer's language too: an Arabic session that downloads a CSV of English
  // account names is the same defect as an English screen, one layer down.
  const locale = await getLocale();
  const acct = (a: { code: string; name: string }) => accountName(locale, a);
  const url = new URL(req.url);
  const report = url.searchParams.get("report") ?? "pl";
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (!isReportKind(report)) return new Response("Unknown report", { status: 400 });

  const [org] = await db.select({ fiscal: orgsTable.fiscalYearStartMonth }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const range = resolveRange(url.searchParams.get("from"), url.searchParams.get("to"), org?.fiscal ?? 1);
  const accountId = Number(url.searchParams.get("account")) || undefined;

  let title = "", columns: ExportColumn[] = [], rows: Record<string, string>[] = [];

  if (report === "pl") {
    title = "Profit & Loss";
    columns = [{ key: "section", header: "Section" }, { key: "account", header: "Account" }, { key: "amount", header: "Amount" }];
    const d = await getProfitAndLoss(session.orgId, range);
    const grp = (section: string, lines: { code: string; name: string; amount: number }[]) => lines.map((l) => ({ section, account: `${l.code} ${acct(l)}`, amount: money(l.amount) }));
    rows = [
      ...grp("Revenue", d.revenue), { section: "Revenue", account: "Total Revenue", amount: money(d.revenueTotal) },
      ...grp("Cost of Sales", d.costOfSales), { section: "", account: "Gross Profit", amount: money(d.grossProfit) },
      ...grp("Operating Expenses", d.operatingExpenses), { section: "", account: "Operating Profit", amount: money(d.operatingProfit) },
      ...grp("Other Income", d.otherIncome), ...grp("Other Expenses", d.otherExpenses),
      { section: "", account: "Net Profit / (Loss)", amount: money(d.netProfit) },
    ];
  } else if (report === "bs") {
    title = "Balance Sheet";
    columns = [{ key: "section", header: "Section" }, { key: "account", header: "Account" }, { key: "amount", header: "Amount" }];
    const d = await getBalanceSheet(session.orgId, range);
    const grp = (section: string, lines: { code: string; name: string; amount: number }[]) => lines.map((l) => ({ section, account: `${l.code} ${acct(l)}`, amount: money(l.amount) }));
    rows = [
      ...grp("Current Assets", d.currentAssets), ...grp("Non-current Assets", d.nonCurrentAssets),
      { section: "", account: "Total Assets", amount: money(d.totalAssets) },
      ...grp("Current Liabilities", d.currentLiabilities), ...grp("Non-current Liabilities", d.nonCurrentLiabilities),
      { section: "", account: "Total Liabilities", amount: money(d.totalLiabilities) },
      ...grp("Equity", d.equity),
      { section: "Equity", account: "Retained Earnings", amount: money(d.retainedEarnings) },
      { section: "Equity", account: "Current-period Profit / (Loss)", amount: money(d.currentPeriodProfit) },
      { section: "", account: "Total Equity", amount: money(d.totalEquity) },
      { section: "", account: "Total Liabilities + Equity", amount: money(d.totalLiabilitiesAndEquity) },
    ];
  } else if (report === "cf") {
    title = "Cash Flow";
    columns = [{ key: "section", header: "Section" }, { key: "item", header: "Item" }, { key: "amount", header: "Amount" }];
    const d = await getCashFlow(session.orgId, range);
    rows = [
      { section: "", item: "Opening Cash Balance", amount: money(d.openingCash) },
      ...d.operatingRows.map((r) => ({ section: "Operating", item: r.label, amount: money(r.amount) })),
      { section: "", item: "Net Operating", amount: money(d.operating) },
      { section: "", item: "Net Investing", amount: money(d.investing) },
      { section: "", item: "Net Financing", amount: money(d.financing) },
      { section: "", item: "Net Cash Movement", amount: money(d.netMovement) },
      { section: "", item: "Closing Cash Balance", amount: money(d.closingCash) },
    ];
  } else if (report === "tb") {
    title = "Trial Balance";
    columns = [
      { key: "code", header: "Code" }, { key: "account", header: "Account" },
      { key: "odr", header: "Opening Dr" }, { key: "ocr", header: "Opening Cr" },
      { key: "pdr", header: "Period Dr" }, { key: "pcr", header: "Period Cr" },
      { key: "cdr", header: "Closing Dr" }, { key: "ccr", header: "Closing Cr" },
    ];
    const d = await getTrialBalance(session.orgId, range);
    rows = d.rows.map((r) => ({ code: r.code, account: acct(r), odr: money(r.openingDr), ocr: money(r.openingCr), pdr: money(r.periodDebit), pcr: money(r.periodCredit), cdr: money(r.closingDr), ccr: money(r.closingCr) }));
    rows.push({ code: "", account: "TOTAL", odr: money(d.totals.openingDr), ocr: money(d.totals.openingCr), pdr: money(d.totals.periodDr), pcr: money(d.totals.periodCr), cdr: money(d.totals.closingDr), ccr: money(d.totals.closingCr) });
  } else if (report === "gl") {
    title = "General Ledger";
    columns = [
      { key: "date", header: "Date" }, { key: "code", header: "Code" }, { key: "account", header: "Account" },
      { key: "memo", header: "Memo" }, { key: "source", header: "Source" },
      { key: "debit", header: "Debit" }, { key: "credit", header: "Credit" }, { key: "running", header: "Running" },
    ];
    const blocks = await getGeneralLedger(session.orgId, range, accountId);
    for (const b of blocks) {
      rows.push({ date: "", code: b.code, account: `${acct(b)} — Opening`, memo: "", source: "", debit: "", credit: "", running: money(b.opening) });
      for (const r of b.rows) rows.push({ date: r.date, code: b.code, account: acct(b), memo: r.memo, source: r.sourceType, debit: money(r.debit), credit: money(r.credit), running: money(r.running) });
      rows.push({ date: "", code: b.code, account: `${acct(b)} — Closing`, memo: "", source: "", debit: money(b.totalDebit), credit: money(b.totalCredit), running: money(b.closing) });
    }
  } else if (report === "ar" || report === "ap") {
    title = report === "ar" ? "Accounts Receivable Aging" : "Accounts Payable Aging";
    columns = [
      { key: "number", header: "Number" }, { key: "party", header: report === "ar" ? "Customer" : "Vendor" },
      { key: "date", header: "Date" }, { key: "due", header: "Due Date" }, { key: "overdue", header: "Overdue Days" },
      { key: "total", header: "Total" }, { key: "paid", header: "Paid" }, { key: "outstanding", header: "Outstanding" }, { key: "bucket", header: "Bucket" },
    ];
    const d = report === "ar" ? await getReceivableAging(session.orgId, range.to) : await getPayableAging(session.orgId, range.to);
    rows = d.rows.map((r) => ({ number: r.number, party: r.party, date: r.date, due: r.dueDate, overdue: String(r.overdueDays), total: money(r.total), paid: money(r.paid), outstanding: money(r.outstanding), bucket: r.bucket }));
    rows.push({ number: "", party: "TOTAL", date: "", due: "", overdue: "", total: "", paid: "", outstanding: money(d.totalOutstanding), bucket: "" });
  } else {
    title = "VAT Summary";
    columns = [{ key: "item", header: "Item" }, { key: "amount", header: "Amount" }];
    const d = await getVatSummary(session.orgId, range);
    rows = [
      { item: "Output VAT", amount: money(d.outputVat) },
      { item: "Input VAT", amount: money(d.inputVat) },
      { item: "Net VAT Payable / (Recoverable)", amount: money(d.netVat) },
      { item: "Credit-note VAT adjustment", amount: money(d.creditNoteVat) },
      { item: "Debit-note VAT adjustment", amount: money(d.debitNoteVat) },
      { item: "Taxable Sales", amount: money(d.taxableSales) },
      { item: "Zero-rated Sales", amount: money(d.zeroRatedSales) },
      { item: "Taxable Purchases", amount: money(d.taxablePurchases) },
    ];
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return exportResponse(format, `${title} (${range.from} → ${range.to})`, `${report}-${stamp}`, columns, rows);
}
