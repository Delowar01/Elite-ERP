import "server-only";
import { and, eq, gte, lte, lt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
  bankAccountsTable,
  salesInvoicesTable,
  purchaseOrdersTable,
  creditNotesTable,
  debitNotesTable,
  customersTable,
  vendorsTable,
  type Account,
} from "@/db";
import { roundMoney } from "@/lib/currency/currencies";
import { orgBaseCurrency } from "@/lib/org-currency";
import { baseTotalExpr, baseTaxExpr, basePaidExpr, unconvertedOutstandingPred, unconvertedTotalPred } from "@/lib/base-amounts-sql";

// ─────────────────────────────────────────────────────────────────────────────
// Financial Reporting data layer. Every ledger-based report is generated from the
// POSTED double-entry journal (journal_entries + journal_lines) — drafts/cancelled
// documents never post a journal entry, so the journal is the authoritative posted
// ledger. Document-based reports (aging, VAT) read the source documents directly and
// exclude draft / archived / deleted rows explicitly. All queries are tenant-scoped
// by orgId. Classification into report sections is a PRESENTATION grouping over the
// existing chart-of-accounts `type` + code ranges — it does not add any accounting
// structure.
// ─────────────────────────────────────────────────────────────────────────────

export type DateRange = { from: string; to: string }; // inclusive ISO YYYY-MM-DD

const n = (v: unknown) => Number(v ?? 0);
const codeNum = (code: string) => parseInt(code.replace(/\D/g, ""), 10) || 0;
// Debit-normal accounts (asset/expense) grow with debits; credit-normal (liability/
// equity/revenue) grow with credits.
function signed(normalBalance: string, debit: number, credit: number): number {
  return normalBalance === "debit" ? debit - credit : credit - debit;
}
export function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Sum of debit/credit per account over a date predicate on the entry date.
async function sumsByAccount(orgId: number, where: ReturnType<typeof and> | undefined) {
  const rows = await db
    .select({
      accountId: journalLinesTable.accountId,
      debit: sql<string>`coalesce(sum(${journalLinesTable.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLinesTable.credit}), 0)`,
    })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(where)
    .groupBy(journalLinesTable.accountId);
  return new Map(rows.map((r) => [r.accountId, { debit: n(r.debit), credit: n(r.credit) }]));
}

export type AccountPeriod = {
  id: number;
  code: string;
  name: string;
  type: Account["type"];
  normalBalance: string;
  openingDebit: number;
  openingCredit: number;
  opening: number; // signed
  periodDebit: number;
  periodCredit: number;
  movement: number; // signed period movement
  closing: number; // signed closing (opening + movement)
};

// Per-account opening / period / closing balances for a date range. The single primitive
// behind Trial Balance, P&L, Balance Sheet, and the summary numbers.
export async function getAccountPeriods(orgId: number, range: DateRange): Promise<AccountPeriod[]> {
  const [accounts, opening, period] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(accountsTable.code),
    sumsByAccount(orgId, and(eq(journalEntriesTable.orgId, orgId), lt(journalEntriesTable.entryDate, range.from))),
    sumsByAccount(orgId, and(eq(journalEntriesTable.orgId, orgId), gte(journalEntriesTable.entryDate, range.from), lte(journalEntriesTable.entryDate, range.to))),
  ]);
  return accounts.map((a) => {
    const o = opening.get(a.id) ?? { debit: 0, credit: 0 };
    const p = period.get(a.id) ?? { debit: 0, credit: 0 };
    const openingSigned = signed(a.normalBalance, o.debit, o.credit);
    const movement = signed(a.normalBalance, p.debit, p.credit);
    return {
      id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance,
      openingDebit: o.debit, openingCredit: o.credit, opening: openingSigned,
      periodDebit: p.debit, periodCredit: p.credit, movement,
      closing: openingSigned + movement,
    };
  });
}

// ── Trial Balance ────────────────────────────────────────────────────────────
export type TrialBalanceRow = AccountPeriod & {
  openingDr: number; openingCr: number; closingDr: number; closingCr: number;
};
export type TrialBalance = {
  rows: TrialBalanceRow[];
  totals: { openingDr: number; openingCr: number; periodDr: number; periodCr: number; closingDr: number; closingCr: number };
  balanced: boolean;
};
const drCr = (normalBalance: string, signedBal: number) =>
  normalBalance === "debit"
    ? { dr: Math.max(signedBal, 0), cr: Math.max(-signedBal, 0) }
    : { dr: Math.max(-signedBal, 0), cr: Math.max(signedBal, 0) };

export async function getTrialBalance(orgId: number, range: DateRange): Promise<TrialBalance> {
  const periods = await getAccountPeriods(orgId, range);
  const rows = periods
    .filter((p) => p.opening !== 0 || p.periodDebit !== 0 || p.periodCredit !== 0 || p.closing !== 0)
    .map((p) => {
      const o = drCr(p.normalBalance, p.opening);
      const c = drCr(p.normalBalance, p.closing);
      return { ...p, openingDr: o.dr, openingCr: o.cr, closingDr: c.dr, closingCr: c.cr };
    });
  const totals = rows.reduce(
    (t, r) => ({
      openingDr: t.openingDr + r.openingDr, openingCr: t.openingCr + r.openingCr,
      periodDr: t.periodDr + r.periodDebit, periodCr: t.periodCr + r.periodCredit,
      closingDr: t.closingDr + r.closingDr, closingCr: t.closingCr + r.closingCr,
    }),
    { openingDr: 0, openingCr: 0, periodDr: 0, periodCr: 0, closingDr: 0, closingCr: 0 },
  );
  // Compared at the BASE currency's minor unit. Rounding to cents reported a Kuwaiti trial balance
  // as balanced when closing debits and credits differed in the third decimal — the report would
  // have said the books balanced while they did not.
  const currency = await orgBaseCurrency(orgId);
  const balanced = roundMoney(totals.closingDr, currency) === roundMoney(totals.closingCr, currency);
  return { rows, totals, balanced };
}

// ── Profit & Loss (period movement of revenue/expense) ──────────────────────
export type PnlLine = { id: number; code: string; name: string; amount: number };
export type ProfitAndLoss = {
  revenue: PnlLine[]; revenueTotal: number;
  costOfSales: PnlLine[]; costOfSalesTotal: number;
  grossProfit: number;
  operatingExpenses: PnlLine[]; operatingExpensesTotal: number;
  operatingProfit: number;
  otherIncome: PnlLine[]; otherIncomeTotal: number;
  otherExpenses: PnlLine[]; otherExpensesTotal: number;
  netProfit: number;
};
// Revenue: operating 4000–4899, other income 4900+. Expense: cost of sales 5000–5099,
// operating 5100–5899, other 5900+.
function pnlLine(p: AccountPeriod): PnlLine { return { id: p.id, code: p.code, name: p.name, amount: p.movement }; }
export async function getProfitAndLoss(orgId: number, range: DateRange): Promise<ProfitAndLoss> {
  const periods = await getAccountPeriods(orgId, range);
  const rev = periods.filter((p) => p.type === "revenue");
  const exp = periods.filter((p) => p.type === "expense");
  const revenue = rev.filter((p) => codeNum(p.code) < 4900).map(pnlLine).filter((l) => l.amount !== 0);
  const otherIncome = rev.filter((p) => codeNum(p.code) >= 4900).map(pnlLine).filter((l) => l.amount !== 0);
  const costOfSales = exp.filter((p) => codeNum(p.code) < 5100).map(pnlLine).filter((l) => l.amount !== 0);
  const operatingExpenses = exp.filter((p) => { const c = codeNum(p.code); return c >= 5100 && c < 5900; }).map(pnlLine).filter((l) => l.amount !== 0);
  const otherExpenses = exp.filter((p) => codeNum(p.code) >= 5900).map(pnlLine).filter((l) => l.amount !== 0);
  const sum = (ls: PnlLine[]) => ls.reduce((s, l) => s + l.amount, 0);
  const revenueTotal = sum(revenue), costOfSalesTotal = sum(costOfSales), operatingExpensesTotal = sum(operatingExpenses);
  const otherIncomeTotal = sum(otherIncome), otherExpensesTotal = sum(otherExpenses);
  const grossProfit = revenueTotal - costOfSalesTotal;
  const operatingProfit = grossProfit - operatingExpensesTotal;
  const netProfit = operatingProfit + otherIncomeTotal - otherExpensesTotal;
  return { revenue, revenueTotal, costOfSales, costOfSalesTotal, grossProfit, operatingExpenses, operatingExpensesTotal, operatingProfit, otherIncome, otherIncomeTotal, otherExpenses, otherExpensesTotal, netProfit };
}

// ── Balance Sheet (closing as of `to`) ───────────────────────────────────────
export type BsLine = { id: number; code: string; name: string; amount: number };
export type BalanceSheet = {
  currentAssets: BsLine[]; nonCurrentAssets: BsLine[]; totalAssets: number;
  currentLiabilities: BsLine[]; nonCurrentLiabilities: BsLine[]; totalLiabilities: number;
  equity: BsLine[]; equityAccountsTotal: number;
  retainedEarnings: number; currentPeriodProfit: number; totalEquity: number;
  totalLiabilitiesAndEquity: number; balanced: boolean;
};
export async function getBalanceSheet(orgId: number, range: DateRange): Promise<BalanceSheet> {
  const periods = await getAccountPeriods(orgId, range);
  const bsLine = (p: AccountPeriod): BsLine => ({ id: p.id, code: p.code, name: p.name, amount: p.closing });
  const nonZero = (l: BsLine) => l.amount !== 0;
  const assets = periods.filter((p) => p.type === "asset");
  const liabilities = periods.filter((p) => p.type === "liability");
  const equityAccts = periods.filter((p) => p.type === "equity");
  const currentAssets = assets.filter((p) => codeNum(p.code) < 1500).map(bsLine).filter(nonZero);
  const nonCurrentAssets = assets.filter((p) => codeNum(p.code) >= 1500).map(bsLine).filter(nonZero);
  const currentLiabilities = liabilities.filter((p) => codeNum(p.code) < 2500).map(bsLine).filter(nonZero);
  const nonCurrentLiabilities = liabilities.filter((p) => codeNum(p.code) >= 2500).map(bsLine).filter(nonZero);
  const equity = equityAccts.map(bsLine).filter(nonZero);
  const sum = (ls: BsLine[]) => ls.reduce((s, l) => s + l.amount, 0);
  const totalAssets = sum(currentAssets) + sum(nonCurrentAssets);
  const totalLiabilities = sum(currentLiabilities) + sum(nonCurrentLiabilities);
  const equityAccountsTotal = sum(equity);
  // Retained earnings = accumulated P&L before the period; current-period profit = P&L within it.
  const retainedEarnings = periods.filter((p) => p.type === "revenue" || p.type === "expense")
    .reduce((s, p) => s + (p.type === "revenue" ? p.opening : -p.opening), 0);
  const currentPeriodProfit = periods.filter((p) => p.type === "revenue" || p.type === "expense")
    .reduce((s, p) => s + (p.type === "revenue" ? p.movement : -p.movement), 0);
  const totalEquity = equityAccountsTotal + retainedEarnings + currentPeriodProfit;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  // Same reason as the trial balance above: a balance sheet that "balances" only at two decimals
  // is not a balance sheet.
  const bsCurrency = await orgBaseCurrency(orgId);
  const balanced = roundMoney(totalAssets, bsCurrency) === roundMoney(totalLiabilitiesAndEquity, bsCurrency);
  return { currentAssets, nonCurrentAssets, totalAssets, currentLiabilities, nonCurrentLiabilities, totalLiabilities, equity, equityAccountsTotal, retainedEarnings, currentPeriodProfit, totalEquity, totalLiabilitiesAndEquity, balanced };
}

// ── General Ledger ───────────────────────────────────────────────────────────
export type GlRow = { entryId: number; date: string; account: string; accountCode: string; memo: string; sourceType: string; sourceId: number | null; debit: number; credit: number; running: number };
export type GlAccountBlock = { accountId: number; code: string; name: string; opening: number; rows: GlRow[]; closing: number; totalDebit: number; totalCredit: number };
// Ledger for one or all accounts over a range, each with its opening balance (before `from`).
export async function getGeneralLedger(orgId: number, range: DateRange, accountId?: number): Promise<GlAccountBlock[]> {
  const accounts = (await db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(accountsTable.code))
    .filter((a) => !accountId || a.id === accountId);
  if (accounts.length === 0) return [];
  const ids = accounts.map((a) => a.id);
  const [openingSums, lines] = await Promise.all([
    sumsByAccount(orgId, and(eq(journalEntriesTable.orgId, orgId), lt(journalEntriesTable.entryDate, range.from), inArray(journalLinesTable.accountId, ids))),
    db.select({
      accountId: journalLinesTable.accountId,
      entryId: journalEntriesTable.id,
      date: journalEntriesTable.entryDate,
      entryMemo: journalEntriesTable.memo,
      lineMemo: journalLinesTable.memo,
      sourceType: journalEntriesTable.sourceType,
      sourceId: journalEntriesTable.sourceId,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    }).from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .where(and(eq(journalEntriesTable.orgId, orgId), gte(journalEntriesTable.entryDate, range.from), lte(journalEntriesTable.entryDate, range.to), inArray(journalLinesTable.accountId, ids)))
      .orderBy(journalEntriesTable.entryDate, journalEntriesTable.id),
  ]);
  return accounts.map((a) => {
    const o = openingSums.get(a.id) ?? { debit: 0, credit: 0 };
    const opening = signed(a.normalBalance, o.debit, o.credit);
    let running = opening;
    let totalDebit = 0, totalCredit = 0;
    const rows: GlRow[] = lines.filter((l) => l.accountId === a.id).map((l) => {
      const debit = n(l.debit), credit = n(l.credit);
      running += signed(a.normalBalance, debit, credit);
      totalDebit += debit; totalCredit += credit;
      return { entryId: l.entryId, date: l.date, account: a.name, accountCode: a.code, memo: l.lineMemo || l.entryMemo, sourceType: l.sourceType, sourceId: l.sourceId, debit, credit, running };
    });
    return { accountId: a.id, code: a.code, name: a.name, opening, rows, closing: running, totalDebit, totalCredit };
  }).filter((b) => b.rows.length > 0 || b.opening !== 0);
}

// ── Cash Flow ────────────────────────────────────────────────────────────────
export type CashFlow = {
  openingCash: number; closingCash: number; netMovement: number;
  operating: number; investing: number; financing: number;
  operatingRows: { label: string; amount: number }[];
  cashAccountIds: number[];
};
export async function getCashFlow(orgId: number, range: DateRange): Promise<CashFlow> {
  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId));
  const banks = await db.select({ glAccountId: bankAccountsTable.glAccountId }).from(bankAccountsTable).where(eq(bankAccountsTable.orgId, orgId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cashIds = new Set<number>(banks.map((b) => b.glAccountId));
  for (const a of accounts) if (a.type === "asset" && a.code === "1000") cashIds.add(a.id);
  const cashAccountIds = [...cashIds];
  if (cashAccountIds.length === 0) return { openingCash: 0, closingCash: 0, netMovement: 0, operating: 0, investing: 0, financing: 0, operatingRows: [], cashAccountIds };

  // Opening/closing cash = signed asset balance of cash accounts before `from` / through `to`.
  const [openSums, throughSums] = await Promise.all([
    sumsByAccount(orgId, and(eq(journalEntriesTable.orgId, orgId), lt(journalEntriesTable.entryDate, range.from), inArray(journalLinesTable.accountId, cashAccountIds))),
    sumsByAccount(orgId, and(eq(journalEntriesTable.orgId, orgId), lte(journalEntriesTable.entryDate, range.to), inArray(journalLinesTable.accountId, cashAccountIds))),
  ]);
  const sumCash = (m: Map<number, { debit: number; credit: number }>) => cashAccountIds.reduce((s, id) => { const v = m.get(id) ?? { debit: 0, credit: 0 }; return s + (v.debit - v.credit); }, 0);
  const openingCash = sumCash(openSums);
  const closingCash = sumCash(throughSums);
  const netMovement = closingCash - openingCash;

  // Classify each period entry that touches cash by its non-cash legs' account type.
  const periodLines = await db.select({
    entryId: journalLinesTable.journalEntryId,
    accountId: journalLinesTable.accountId,
    sourceType: journalEntriesTable.sourceType,
    debit: journalLinesTable.debit,
    credit: journalLinesTable.credit,
  }).from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(and(eq(journalEntriesTable.orgId, orgId), gte(journalEntriesTable.entryDate, range.from), lte(journalEntriesTable.entryDate, range.to)));

  const entries = new Map<number, { cashDelta: number; nonCashTypes: { type: string; code: string }[]; sourceType: string }>();
  for (const l of periodLines) {
    const e = entries.get(l.entryId) ?? { cashDelta: 0, nonCashTypes: [], sourceType: l.sourceType };
    if (cashIds.has(l.accountId)) e.cashDelta += n(l.debit) - n(l.credit);
    else { const acc = byId.get(l.accountId); if (acc) e.nonCashTypes.push({ type: acc.type, code: acc.code }); }
    entries.set(l.entryId, e);
  }
  let operating = 0, investing = 0, financing = 0;
  const opBySource = new Map<string, number>();
  for (const e of entries.values()) {
    if (e.cashDelta === 0) continue;
    const hasEquity = e.nonCashTypes.some((t) => t.type === "equity");
    const hasNonCurrentAsset = e.nonCashTypes.some((t) => t.type === "asset" && codeNum(t.code) >= 1500);
    if (hasEquity) financing += e.cashDelta;
    else if (hasNonCurrentAsset) investing += e.cashDelta;
    else { operating += e.cashDelta; opBySource.set(e.sourceType, (opBySource.get(e.sourceType) ?? 0) + e.cashDelta); }
  }
  const operatingRows = [...opBySource.entries()].map(([label, amount]) => ({ label, amount }));
  return { openingCash, closingCash, netMovement, operating, investing, financing, operatingRows, cashAccountIds };
}

// ── Aging (AR from invoices, AP from purchase orders) ────────────────────────
export type AgingRow = {
  id: number; number: string; party: string; date: string; dueDate: string;
  total: number; paid: number; outstanding: number; overdueDays: number; bucket: AgingBucketKey;
};
export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90p";
export const AGING_BUCKETS: AgingBucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90p"];
export type Aging = {
  rows: AgingRow[];
  buckets: Record<AgingBucketKey, number>;
  totalOutstanding: number;
  /** FX-8: posted documents EXCLUDED from every figure above — foreign with no stored base conversion. */
  excluded: number;
};

function bucketFor(overdueDays: number): AgingBucketKey {
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "d1_30";
  if (overdueDays <= 60) return "d31_60";
  if (overdueDays <= 90) return "d61_90";
  return "d90p";
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}
function agingFrom(asOf: string, docs: { id: number; number: string; party: string; date: string; due: string | null; total: number; paid: number; unconverted?: boolean }[]): Aging {
  const buckets: Record<AgingBucketKey, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const rows: AgingRow[] = [];
  // FX-8: a foreign document with no stored base conversion has no honest base figure — excluded
  // from rows and buckets, COUNTED so the report can say so instead of totalling quietly short.
  let excluded = 0;
  for (const d of docs) {
    if (d.unconverted) {
      excluded += 1;
      continue;
    }
    const outstanding = Math.round((d.total - d.paid) * 100) / 100;
    if (outstanding <= 0) continue;
    const dueDate = d.due || d.date;
    const overdueDays = Math.max(0, daysBetween(dueDate, asOf));
    const bucket = bucketFor(overdueDays);
    buckets[bucket] += outstanding;
    rows.push({ id: d.id, number: d.number, party: d.party, date: d.date, dueDate, total: d.total, paid: d.paid, outstanding, overdueDays, bucket });
  }
  rows.sort((a, b) => b.overdueDays - a.overdueDays);
  const totalOutstanding = AGING_BUCKETS.reduce((s, k) => s + buckets[k], 0);
  return { rows, buckets, totalOutstanding, excluded };
}

export async function getReceivableAging(orgId: number, asOf: string): Promise<Aging> {
  // FX-8: BOTH sides in base — baseTotal − basePaidAmount — never a base total minus a foreign
  // paid amount, which is the mix basePaidAmount exists to prevent.
  const base = await orgBaseCurrency(orgId);
  const rows = await db.select({
    id: salesInvoicesTable.id, number: salesInvoicesTable.invoiceNumber, party: customersTable.name,
    date: salesInvoicesTable.issueDate, due: salesInvoicesTable.dueDate,
    total: baseTotalExpr(salesInvoicesTable, base), paid: basePaidExpr(salesInvoicesTable, base),
    unconverted: unconvertedOutstandingPred(salesInvoicesTable, base),
  }).from(salesInvoicesTable)
    .leftJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .where(and(
      eq(salesInvoicesTable.orgId, orgId),
      inArray(salesInvoicesTable.status, ["sent", "partially_paid", "paid"]),
      isNull(salesInvoicesTable.archivedAt),
      isNull(salesInvoicesTable.deletedAt),
      lte(salesInvoicesTable.issueDate, asOf),
    ));
  return agingFrom(asOf, rows.map((r) => ({ id: r.id, number: r.number, party: r.party ?? "—", date: r.date, due: r.due, total: n(r.total), paid: n(r.paid), unconverted: !!r.unconverted })));
}

export async function getPayableAging(orgId: number, asOf: string): Promise<Aging> {
  const base = await orgBaseCurrency(orgId);
  const rows = await db.select({
    id: purchaseOrdersTable.id, number: purchaseOrdersTable.poNumber, party: vendorsTable.name,
    date: purchaseOrdersTable.orderDate, due: purchaseOrdersTable.expectedDate,
    total: baseTotalExpr(purchaseOrdersTable, base), paid: basePaidExpr(purchaseOrdersTable, base),
    unconverted: unconvertedOutstandingPred(purchaseOrdersTable, base),
  }).from(purchaseOrdersTable)
    .leftJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
    .where(and(
      eq(purchaseOrdersTable.orgId, orgId),
      eq(purchaseOrdersTable.status, "received"),
      isNull(purchaseOrdersTable.archivedAt),
      isNull(purchaseOrdersTable.deletedAt),
      lte(purchaseOrdersTable.orderDate, asOf),
    ));
  return agingFrom(asOf, rows.map((r) => ({ id: r.id, number: r.number, party: r.party ?? "—", date: r.date, due: r.due, total: n(r.total), paid: n(r.paid), unconverted: !!r.unconverted })));
}

// ── VAT Summary (Phase 1 document data) ──────────────────────────────────────
// FX-8: all figures in BASE currency via the stored base columns. The taxable base is DERIVED as
// baseTotal − baseTaxAmount (the same derived-middle-figure rule posting follows) rather than
// converting `subtotal` separately. Foreign documents with no stored conversion contribute NULL —
// dropped by sum() — and are counted into `excluded` so the report names the omission.
export type VatSummary = {
  outputVat: number; inputVat: number; netVat: number;
  creditNoteVat: number; debitNoteVat: number;
  taxableSales: number; zeroRatedSales: number; taxablePurchases: number;
  /** Posted documents excluded from every figure above — foreign with no stored base conversion. */
  excluded: number;
};
async function sumTax(orgId: number, base: string, table: typeof salesInvoicesTable | typeof purchaseOrdersTable, dateCol: typeof salesInvoicesTable.issueDate, statusIn: string[], range: DateRange) {
  const baseTotal = baseTotalExpr(table, base);
  const baseTax = baseTaxExpr(table, base);
  const [r] = await db.select({
    tax: sql<string>`coalesce(sum(${baseTax}), 0)`,
    subtotal: sql<string>`coalesce(sum(${baseTotal} - ${baseTax}), 0)`,
    zero: sql<string>`coalesce(sum(case when ${table.taxTotal} = 0 then ${baseTotal} else 0 end), 0)`,
    excluded: sql<number>`count(*) filter (where ${unconvertedTotalPred(table, base)})::int`,
  }).from(table)
    .where(and(eq(table.orgId, orgId), inArray(table.status, statusIn), isNull(table.archivedAt), isNull(table.deletedAt), gte(dateCol, range.from), lte(dateCol, range.to)));
  return { tax: n(r?.tax), subtotal: n(r?.subtotal), zero: n(r?.zero), excluded: r?.excluded ?? 0 };
}
async function sumNoteTax(orgId: number, base: string, table: typeof creditNotesTable | typeof debitNotesTable, range: DateRange) {
  const [r] = await db.select({
    tax: sql<string>`coalesce(sum(${baseTaxExpr(table, base)}), 0)`,
    excluded: sql<number>`count(*) filter (where ${unconvertedTotalPred(table, base)})::int`,
  }).from(table)
    .where(and(eq(table.orgId, orgId), eq(table.status, "issued"), isNull(table.archivedAt), isNull(table.deletedAt), gte(table.issueDate, range.from), lte(table.issueDate, range.to)));
  return { tax: n(r?.tax), excluded: r?.excluded ?? 0 };
}
export async function getVatSummary(orgId: number, range: DateRange): Promise<VatSummary> {
  const base = await orgBaseCurrency(orgId);
  const [sales, purchases, cn, dn] = await Promise.all([
    sumTax(orgId, base, salesInvoicesTable, salesInvoicesTable.issueDate, ["sent", "partially_paid", "paid"], range),
    sumTax(orgId, base, purchaseOrdersTable as unknown as typeof salesInvoicesTable, purchaseOrdersTable.orderDate as unknown as typeof salesInvoicesTable.issueDate, ["received"], range),
    sumNoteTax(orgId, base, creditNotesTable, range),
    sumNoteTax(orgId, base, debitNotesTable, range),
  ]);
  // Credit notes reduce output VAT; debit notes reduce input VAT.
  const outputVat = sales.tax - cn.tax;
  const inputVat = purchases.tax - dn.tax;
  return {
    outputVat, inputVat, netVat: outputVat - inputVat,
    creditNoteVat: cn.tax, debitNoteVat: dn.tax,
    taxableSales: sales.subtotal, zeroRatedSales: sales.zero, taxablePurchases: purchases.subtotal,
    excluded: sales.excluded + purchases.excluded + cn.excluded + dn.excluded,
  };
}

// ── Fiscal-year helper (from org setting) ────────────────────────────────────
// Returns the fiscal-year range containing (or most recently starting before) `ref`,
// given the org's fiscal-year start month (1–12).
export function fiscalYearRange(startMonth: number, ref: Date = new Date()): DateRange {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const from = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const to = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));
  to.setUTCDate(to.getUTCDate() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const REPORT_KINDS = ["pl", "bs", "cf", "tb", "gl", "ar", "ap", "vat"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export function isReportKind(x: string): x is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(x);
}

// Resolve the effective date range from raw query params, defaulting to the current fiscal year.
export function resolveRange(from: string | null | undefined, to: string | null | undefined, fiscalStartMonth: number): DateRange {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (from && to && iso.test(from) && iso.test(to)) return { from, to };
  return fiscalYearRange(fiscalStartMonth);
}

// Previous period of equal length immediately before `range` (for comparison columns).
export function previousPeriod(range: DateRange): DateRange {
  const len = daysBetween(range.from, range.to);
  const prevTo = dayBefore(range.from);
  const prevFrom = new Date(prevTo + "T00:00:00Z");
  prevFrom.setUTCDate(prevFrom.getUTCDate() - len);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo };
}
