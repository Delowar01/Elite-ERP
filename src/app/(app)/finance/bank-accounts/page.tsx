import { eq, asc, desc } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable, paymentsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances } from "@/lib/accounting";
import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { BankAccountDialog } from "./bank-account-dialog";

export default async function BankAccountsPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;

  const [bankAccounts, accounts, balances, recentPayments] = await Promise.all([
    db.select().from(bankAccountsTable).where(eq(bankAccountsTable.orgId, orgId)).orderBy(asc(bankAccountsTable.name)),
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(asc(accountsTable.code)),
    getAccountBalances(orgId),
    db
      .select({
        id: paymentsTable.id,
        direction: paymentsTable.direction,
        amount: paymentsTable.amount,
        paymentDate: paymentsTable.paymentDate,
        reference: paymentsTable.reference,
        bankAccountName: bankAccountsTable.name,
      })
      .from(paymentsTable)
      .innerJoin(bankAccountsTable, eq(bankAccountsTable.id, paymentsTable.bankAccountId))
      .where(eq(paymentsTable.orgId, orgId))
      .orderBy(desc(paymentsTable.paymentDate))
      .limit(10),
  ]);

  const accountByGl = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Bank Accounts")}</h3>
        <BankAccountDialog locale={locale} accounts={accounts} />
      </div>

      {bankAccounts.length === 0 ? (
        <p className="text-ink-muted text-sm">{t(locale, "No bank accounts yet.")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {bankAccounts.map((ba) => {
            const glAccount = accountByGl.get(ba.glAccountId);
            const glBalance = balances.get(ba.glAccountId) ?? 0;
            const total = Number(ba.openingBalance) + glBalance;
            return (
              <div key={ba.id} className="rounded-2xl border border-line bg-surface shadow-elevated p-5">
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 items-start">
                    <div className="size-[38px] rounded-[10px] flex items-center justify-center bg-[var(--accent-orange-bg)] text-brand-orange shrink-0">
                      <Landmark className="size-[17px]" />
                    </div>
                    <div>
                      <div className="font-bold text-[14px]">{ba.name}</div>
                      <div className="text-[11.5px] text-ink-muted mt-0.5">
                        {glAccount ? `GL ${glAccount.code} · ${glAccount.name}` : "—"}
                        {ba.accountNumberMasked ? ` · ${ba.accountNumberMasked}` : ""}
                      </div>
                    </div>
                  </div>
                  <Badge variant={ba.isActive ? "success" : "neutral"}>{ba.isActive ? t(locale, "Active") : t(locale, "Inactive")}</Badge>
                </div>
                <div className="font-display font-extrabold text-[22px] mt-3.5 font-tabular">
                  {t(locale, "SAR")} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-3">
        <h3 className="text-[15px] font-bold">{t(locale, "Recent payment records")}</h3>
      </div>
      {recentPayments.length === 0 ? (
        <p className="text-ink-muted text-sm">{t(locale, "No payment records yet.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead>{t(locale, "Direction")}</TableHead>
              <TableHead>{t(locale, "Reference")}</TableHead>
              <TableHead>{t(locale, "Bank Account")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentPayments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.paymentDate}</TableCell>
                <TableCell>
                  <Badge variant={p.direction === "in" ? "success" : "danger"}>{p.direction === "in" ? t(locale, "In") : t(locale, "Out")}</Badge>
                </TableCell>
                <TableCell>{p.reference ?? "—"}</TableCell>
                <TableCell>{p.bankAccountName}</TableCell>
                <TableCell className="text-right font-mono">{Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
