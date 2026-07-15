import { eq, asc } from "drizzle-orm";
import { db, accountsTable, type Account } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances } from "@/lib/accounting";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Money } from "../../sales/_shared/money";

function Line({ label, value, final, positive }: { label: string; value: number; final?: boolean; positive?: boolean }) {
  return (
    <div className={final ? "payslip-line final" : "payslip-line"}>
      <span>{label}</span>
      <span className={positive && final ? "mono text-success" : "mono"}>
        <Money amount={value} />
      </span>
    </div>
  );
}

function GroupLabel({ top, children }: { top?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", margin: top ? "0 0 14px" : "18px 0 14px" }}>
      {children}
    </div>
  );
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
      <div className="main-head">
        <h3>{t(locale, "Account Reporting")}</h3>
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">{t(locale, "Profit & Loss")}</TabsTrigger>
          <TabsTrigger value="bs">{t(locale, "Balance Sheet")}</TabsTrigger>
          <TabsTrigger value="tb">{t(locale, "Trial Balance")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pl">
          <div className="card" style={{ padding: "22px 24px" }}>
            <GroupLabel top>{t(locale, "Revenue")}</GroupLabel>
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
          <div className="card" style={{ padding: "22px 24px" }}>
            <GroupLabel top>{t(locale, "Assets")}</GroupLabel>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, "Code")}</TableHead>
                <TableHead>{t(locale, "Account")}</TableHead>
                <TableHead className="num">{t(locale, "Debit")}</TableHead>
                <TableHead className="num">{t(locale, "Credit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const bal = balances.get(a.id) ?? 0;
                const debit = a.normalBalance === "debit" ? Math.max(bal, 0) : Math.max(-bal, 0);
                const credit = a.normalBalance === "credit" ? Math.max(bal, 0) : Math.max(-bal, 0);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="mono">{a.code}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="num">{debit ? <Money amount={debit} /> : "—"}</TableCell>
                    <TableCell className="num">{credit ? <Money amount={credit} /> : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="tb-strip">
            <div className="card tb-tile">
              <div className="l">{t(locale, "Total debits")}</div>
              <div className="v">
                <Money amount={totalDebit} />
              </div>
            </div>
            <div className="card tb-tile">
              <div className="l">{t(locale, "Total credits")}</div>
              <div className="v">
                <Money amount={totalCredit} />
              </div>
            </div>
            <div className={tbBalanced ? "card tb-tile balanced" : "card tb-tile"}>
              <div className="l">{t(locale, "Balance check")}</div>
              <div className="v">{tbBalanced ? `✓ ${t(locale, "Balanced")}` : t(locale, "Not balanced")}</div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
