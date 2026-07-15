import { eq, asc } from "drizzle-orm";
import { db, accountsTable, type Account } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances } from "@/lib/accounting";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Line({ label, value, final, positive }: { label: string; value: number; final?: boolean; positive?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2.5 text-[13.5px]",
        final ? "border-t border-line-strong mt-1.5 pt-3 font-bold" : "border-b border-line last:border-0",
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono", final && positive && "text-success")}>{fmt(value)}</span>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1 mt-4 first:mt-0">{children}</div>;
}

export default async function ReportsPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;

  const [accounts, balances] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(asc(accountsTable.code)),
    getAccountBalances(orgId),
  ]);

  const byType = (type: Account["type"]) => accounts.filter((a) => a.type === type);
  const sumType = (type: Account["type"]) => byType(type).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);

  const revenueTotal = sumType("revenue");
  const expenseTotal = sumType("expense");
  const netProfit = revenueTotal - expenseTotal;

  const assetTotal = sumType("asset");
  const liabilityTotal = sumType("liability");
  const equityAccountsTotal = sumType("equity");
  const totalEquity = equityAccountsTotal + netProfit;

  const totalDebit = accounts.reduce((s, a) => {
    const bal = balances.get(a.id) ?? 0;
    return s + (a.normalBalance === "debit" ? Math.max(bal, 0) : Math.max(-bal, 0));
  }, 0);
  const totalCredit = accounts.reduce((s, a) => {
    const bal = balances.get(a.id) ?? 0;
    return s + (a.normalBalance === "credit" ? Math.max(bal, 0) : Math.max(-bal, 0));
  }, 0);
  const tbBalanced = Math.round(totalDebit * 100) === Math.round(totalCredit * 100);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Account Reporting")}</h3>
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">{t(locale, "Profit & Loss")}</TabsTrigger>
          <TabsTrigger value="bs">{t(locale, "Balance Sheet")}</TabsTrigger>
          <TabsTrigger value="tb">{t(locale, "Trial Balance")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pl">
          <div className="rounded-2xl border border-line bg-surface shadow-elevated p-6">
            <GroupLabel>{t(locale, "Revenue")}</GroupLabel>
            {byType("revenue").map((a) => (
              <Line key={a.id} label={a.name} value={balances.get(a.id) ?? 0} />
            ))}
            <GroupLabel>{t(locale, "Expenses")}</GroupLabel>
            {byType("expense").map((a) => (
              <Line key={a.id} label={a.name} value={balances.get(a.id) ?? 0} />
            ))}
            <Line label={t(locale, "Net Profit")} value={netProfit} final positive />
          </div>
        </TabsContent>

        <TabsContent value="bs">
          <div className="rounded-2xl border border-line bg-surface shadow-elevated p-6">
            <GroupLabel>{t(locale, "Assets")}</GroupLabel>
            {byType("asset").map((a) => (
              <Line key={a.id} label={a.name} value={balances.get(a.id) ?? 0} />
            ))}
            <Line label={t(locale, "Total Assets")} value={assetTotal} final />

            <GroupLabel>{t(locale, "Liabilities")}</GroupLabel>
            {byType("liability").map((a) => (
              <Line key={a.id} label={a.name} value={balances.get(a.id) ?? 0} />
            ))}
            <Line label={t(locale, "Total Liabilities")} value={liabilityTotal} final />

            <GroupLabel>{t(locale, "Equity")}</GroupLabel>
            {byType("equity").map((a) => (
              <Line key={a.id} label={a.name} value={balances.get(a.id) ?? 0} />
            ))}
            <Line label={t(locale, "Retained Earnings (Current Period)")} value={netProfit} />
            <Line label={t(locale, "Total Equity")} value={totalEquity} final />
          </div>
        </TabsContent>

        <TabsContent value="tb">
          <div className="rounded-2xl border border-line bg-surface shadow-elevated overflow-hidden">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-surface-raised border-b border-line">
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-faint font-semibold">{t(locale, "Code")}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-faint font-semibold">{t(locale, "Account")}</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-faint font-semibold">{t(locale, "Debit")}</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-faint font-semibold">{t(locale, "Credit")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const bal = balances.get(a.id) ?? 0;
                  const debit = a.normalBalance === "debit" ? Math.max(bal, 0) : Math.max(-bal, 0);
                  const credit = a.normalBalance === "credit" ? Math.max(bal, 0) : Math.max(-bal, 0);
                  return (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                      <td className="px-4 py-2.5">{a.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{debit ? fmt(debit) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{credit ? fmt(credit) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Total debits")}</div>
              <div className="font-mono text-[15px] font-bold mt-1">{fmt(totalDebit)}</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Total credits")}</div>
              <div className="font-mono text-[15px] font-bold mt-1">{fmt(totalCredit)}</div>
            </div>
            <div className={cn("rounded-2xl border p-4", tbBalanced ? "border-success bg-success-bg" : "border-line bg-surface")}>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Balance check")}</div>
              <div className={cn("text-[15px] font-bold mt-1", tbBalanced ? "text-success" : "text-ink-muted")}>
                {tbBalanced ? `✓ ${t(locale, "Balanced")}` : t(locale, "Not balanced")}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
