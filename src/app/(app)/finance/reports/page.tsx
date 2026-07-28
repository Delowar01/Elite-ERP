import { eq, asc } from "drizzle-orm";
import { db, accountsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import {
  resolveRange, isReportKind, previousPeriod, type ReportKind, type DateRange,
  getProfitAndLoss, getBalanceSheet, getCashFlow, getTrialBalance, getGeneralLedger,
  getReceivableAging, getPayableAging, getVatSummary,
} from "@/lib/finance-reports";
import { ReportsWorkspace, type ReportPayload } from "./reports-workspace";

// Financial Reports workspace. Server component: resolves the date range (defaulting to the org's
// fiscal year), recomputes ONLY the selected report (+ previous period when comparing), and hands
// the serializable result to the client workspace for filtering / drill-down / export / print.
// Tenant-scoped via requireSession; finance is readable by all roles (matches the module's policy).
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const report: ReportKind = isReportKind(one("report") ?? "") ? (one("report") as ReportKind) : "pl";
  const [org] = await db.select({ fiscal: orgsTable.fiscalYearStartMonth }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const range = resolveRange(one("from"), one("to"), org?.fiscal ?? 1);
  const compare = one("compare") === "1";
  const accountId = Number(one("account")) || undefined;
  const prev = compare ? previousPeriod(range) : undefined;

  const accounts = await db
    .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
    .from(accountsTable).where(eq(accountsTable.orgId, session.orgId)).orderBy(asc(accountsTable.code));

  const payload = await buildPayload(session.orgId, report, range, prev, accountId);

  return (
    <ReportsWorkspace
      locale={locale}
      report={report}
      range={range}
      compare={compare}
      accountId={accountId}
      fiscalStartMonth={org?.fiscal ?? 1}
      accounts={accounts}
      payload={payload}
    />
  );
}

async function buildPayload(orgId: number, report: ReportKind, range: DateRange, prev: DateRange | undefined, accountId?: number): Promise<ReportPayload> {
  switch (report) {
    case "pl": {
      const [d, p] = await Promise.all([getProfitAndLoss(orgId, range), prev ? getProfitAndLoss(orgId, prev) : Promise.resolve(undefined)]);
      return { kind: "pl", pl: d, plPrev: p };
    }
    case "bs": {
      const [d, p] = await Promise.all([getBalanceSheet(orgId, range), prev ? getBalanceSheet(orgId, prev) : Promise.resolve(undefined)]);
      return { kind: "bs", bs: d, bsPrev: p };
    }
    case "cf": {
      const [d, p] = await Promise.all([getCashFlow(orgId, range), prev ? getCashFlow(orgId, prev) : Promise.resolve(undefined)]);
      return { kind: "cf", cf: d, cfPrev: p };
    }
    case "tb":
      return { kind: "tb", tb: await getTrialBalance(orgId, range) };
    case "gl":
      return { kind: "gl", gl: await getGeneralLedger(orgId, range, accountId) };
    case "ar":
      return { kind: "ar", ar: await getReceivableAging(orgId, range.to) };
    case "ap":
      return { kind: "ap", ap: await getPayableAging(orgId, range.to) };
    case "vat": {
      const [d, p] = await Promise.all([getVatSummary(orgId, range), prev ? getVatSummary(orgId, prev) : Promise.resolve(undefined)]);
      return { kind: "vat", vat: d, vatPrev: p };
    }
  }
}
