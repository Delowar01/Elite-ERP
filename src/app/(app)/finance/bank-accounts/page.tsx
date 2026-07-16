import { eq, asc, desc } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable, paymentsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances } from "@/lib/accounting";
import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Money } from "../../sales/_shared/money";
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
    <div className="max-w-5xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Bank Accounts")}</h3>
        <BankAccountDialog locale={locale} accounts={accounts} />
      </div>

      {bankAccounts.length === 0 ? (
        <p className="text-ink-muted text-sm mb-6">{t(locale, "No bank accounts yet.")}</p>
      ) : (
        <div className="two-col" style={{ marginBottom: 20 }}>
          {bankAccounts.map((ba) => {
            const glAccount = accountByGl.get(ba.glAccountId);
            const glBalance = balances.get(ba.glAccountId) ?? 0;
            const total = Number(ba.openingBalance) + glBalance;
            return (
              <div key={ba.id} className="card" style={{ padding: "18px 20px" }}>
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 items-start">
                    <div className="kpi-chip" style={{ width: 38, height: 38, background: "var(--accent-orange-bg)", color: "var(--brand-orange)" }}>
                      <Landmark className="size-[17px]" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{ba.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 2 }}>
                        {glAccount ? `GL ${glAccount.code} · ${glAccount.name}` : "—"}
                        {ba.accountNumberMasked ? ` · ${ba.accountNumberMasked}` : ""}
                      </div>
                    </div>
                  </div>
                  <Badge variant={ba.isActive ? "success" : "neutral"}>{ba.isActive ? t(locale, "Active") : t(locale, "Inactive")}</Badge>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, marginTop: 14 }}>
                  <Money amount={total} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="main-head" style={{ marginTop: 4 }}>
        <h3 style={{ fontSize: 15 }}>{t(locale, "Recent payment records")}</h3>
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
              <TableHead className="num">{t(locale, "Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentPayments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="mono">{p.paymentDate}</TableCell>
                <TableCell>
                  <Badge variant={p.direction === "in" ? "success" : "danger"}>{p.direction === "in" ? t(locale, "In") : t(locale, "Out")}</Badge>
                </TableCell>
                <TableCell>{p.reference ?? "—"}</TableCell>
                <TableCell>{p.bankAccountName}</TableCell>
                <TableCell className="num">
                  <Money amount={p.amount} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
