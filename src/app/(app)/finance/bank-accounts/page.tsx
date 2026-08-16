import { eq, asc, desc } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable, paymentsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances } from "@/lib/accounting";
import { Landmark, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Money } from "../../sales/_shared/money";
import { BankAccountFormDialog } from "./bank-account-form-dialog";
import { accountName } from "@/lib/account-names";
import { eligibleBankGlAccounts } from "@/lib/bank-gl-accounts";

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
  // The selector offers only accounts a bank account MAY back — never a control account the system
  // posts to (see lib/bank-gl-accounts.ts). The server refuses the rest regardless; this keeps the
  // wrong choice from being offered in the first place.
  const glOptions = eligibleBankGlAccounts(accounts);
  // Editing an existing account keeps its CURRENT mapping in the list even when that mapping is a
  // legacy bad one — otherwise the select would silently show a different account than the row is
  // actually linked to. The server allows an unchanged legacy mapping through, so other fields
  // stay editable while the audit script surfaces the row for correction.
  const glOptionsFor = (currentGlId: number) =>
    glOptions.some((a) => a.id === currentGlId)
      ? glOptions
      : [...glOptions, ...accounts.filter((a) => a.id === currentGlId)];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Bank Accounts")}</h3>
        <BankAccountFormDialog
          locale={locale}
          glAccounts={glOptions}
          trigger={
            <Button style={{ width: "auto" }}>
              <Landmark className="size-4" /> {t(locale, "New Account")}
            </Button>
          }
        />
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
                        {glAccount ? `GL ${glAccount.code} · ${accountName(locale, glAccount)}` : "—"}
                        {ba.accountNumberMasked ? ` · ${ba.accountNumberMasked}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={ba.isActive ? "success" : "neutral"}>{ba.isActive ? t(locale, "Active") : t(locale, "Inactive")}</Badge>
                    <BankAccountFormDialog
                      locale={locale}
                      glAccounts={glOptionsFor(ba.glAccountId)}
                      account={{
                        id: ba.id,
                        name: ba.name,
                        bankName: ba.bankName,
                        accountNumberMasked: ba.accountNumberMasked,
                        accountHolder: ba.accountHolder,
                        iban: ba.iban,
                        swift: ba.swift,
                        currency: ba.currency,
                        branch: ba.branch,
                        glAccountId: ba.glAccountId,
                      }}
                      trigger={
                        <button type="button" className="text-ink-faint hover:text-brand-orange" title={t(locale, "Edit")} aria-label={t(locale, "Edit")}>
                          <Pencil className="size-3.5" />
                        </button>
                      }
                    />
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, marginTop: 14 }}>
                  <Money amount={total} context="summary" />
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
                  <Money amount={p.amount} context="summary" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
