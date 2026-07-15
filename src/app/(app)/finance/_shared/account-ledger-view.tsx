import Link from "next/link";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Account } from "@/db";
import type { LedgerRow } from "@/lib/accounting";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "../../sales/_shared/money";
import { AddAccountDialog } from "./add-account-dialog";

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const;
const TYPE_LABEL: Record<(typeof TYPE_ORDER)[number], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};
const NORMAL_BALANCE_CAPTION: Record<(typeof TYPE_ORDER)[number], string> = {
  asset: "Asset · Normal balance: Debit",
  liability: "Liability · Normal balance: Credit",
  equity: "Equity · Normal balance: Credit",
  revenue: "Revenue · Normal balance: Credit",
  expense: "Expense · Normal balance: Debit",
};

const SOURCE_BADGE: Record<string, { label: string; variant: "info" | "success" | "neutral" }> = {
  manual: { label: "Manual", variant: "neutral" },
  sales_invoice: { label: "Sales", variant: "info" },
  credit_note: { label: "Sales", variant: "info" },
  purchase_order: { label: "Purchasing", variant: "neutral" },
  debit_note: { label: "Purchasing", variant: "neutral" },
  payment: { label: "Payment", variant: "success" },
  payroll_run: { label: "Payroll", variant: "neutral" },
  expense: { label: "Expense", variant: "neutral" },
};

export function AccountLedgerView({
  locale,
  basePath,
  accounts,
  balances,
  selectedAccount,
  ledgerRows,
}: {
  locale: Locale;
  basePath: string;
  accounts: Account[];
  balances: Map<number, number>;
  selectedAccount: Account | null;
  ledgerRows: LedgerRow[];
}) {
  const byType = TYPE_ORDER.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="acct-grid">
      <div className="card acct-list-card">
        {byType.map((group) => (
          <div key={group.type}>
            <div className="acct-group-label">{t(locale, TYPE_LABEL[group.type])}</div>
            {group.accounts.map((a) => (
              <Link key={a.id} href={`${basePath}?account=${a.id}`} className={cn("acct-row", selectedAccount?.id === a.id && "selected")}>
                <span className="code">{a.code}</span>
                <span className="nm truncate">{a.name}</span>
                <span className="bal">{(balances.get(a.id) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </Link>
            ))}
          </div>
        ))}
        <div className="p-2 pt-3">
          <AddAccountDialog locale={locale} />
        </div>
      </div>

      <div>
        {!selectedAccount ? (
          <div className="card p-8 text-center text-ink-muted text-sm">{t(locale, "Select an account to view its ledger.")}</div>
        ) : (
          <div className="card" style={{ padding: 20 }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
                  {selectedAccount.code} · {selectedAccount.name}
                </div>
                <div className="text-[11.5px] text-ink-muted mt-0.5">{t(locale, NORMAL_BALANCE_CAPTION[selectedAccount.type as (typeof TYPE_ORDER)[number]])}</div>
              </div>
              <span className="org-pill">
                {t(locale, "Balance")}: <Money amount={balances.get(selectedAccount.id) ?? 0} />
              </span>
            </div>
            {ledgerRows.length === 0 ? (
              <p className="text-ink-muted text-sm py-6 text-center">{t(locale, "No transactions yet.")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t(locale, "Date")}</TableHead>
                    <TableHead>{t(locale, "Memo")}</TableHead>
                    <TableHead>{t(locale, "Source")}</TableHead>
                    <TableHead className="num">{t(locale, "Debit")}</TableHead>
                    <TableHead className="num">{t(locale, "Credit")}</TableHead>
                    <TableHead className="num">{t(locale, "Balance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerRows.map((row, i) => {
                    const badge = SOURCE_BADGE[row.sourceType] ?? { label: row.sourceType, variant: "neutral" as const };
                    return (
                      <TableRow key={i}>
                        <TableCell className="mono">{row.date}</TableCell>
                        <TableCell>{row.memo}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{t(locale, badge.label)}</Badge>
                        </TableCell>
                        <TableCell className="num">{row.debit ? row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</TableCell>
                        <TableCell className="num">{row.credit ? row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</TableCell>
                        <TableCell className="num">{row.runningBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
