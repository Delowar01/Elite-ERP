import Link from "next/link";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Account } from "@/db";
import type { LedgerRow } from "@/lib/accounting";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "../../sales/_shared/money";
import { DISPLAY_NUMBER_LOCALE, formatMoneyNumber } from "@/lib/currency/currencies";
import { AddAccountDialog } from "./add-account-dialog";
import { accountName } from "@/lib/account-names";

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
  inventory_opening: { label: "Inventory", variant: "neutral" },
  inventory_adjustment: { label: "Inventory", variant: "neutral" },
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
                <span className="nm truncate">{accountName(locale, a)}</span>
                <span className="bal">{(balances.get(a.id) ?? 0).toLocaleString(DISPLAY_NUMBER_LOCALE, { maximumFractionDigits: 0 })}</span>
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
          <EmptyState message={t(locale, "Select an account to view its ledger.")} />
        ) : (
          <div className="card" style={{ padding: 20 }}>
            {/* The selected account is the page's h2: code · name, its normal balance beneath, the
                balance beside it. */}
            <SectionHeader
              level={2}
              title={
                <span className="mono">
                  {selectedAccount.code} · {accountName(locale, selectedAccount)}
                </span>
              }
              description={t(locale, NORMAL_BALANCE_CAPTION[selectedAccount.type as (typeof TYPE_ORDER)[number]])}
              meta={
                <span className="org-pill">
                  {t(locale, "Balance")}: <Money amount={balances.get(selectedAccount.id) ?? 0} context="summary" />
                </span>
              }
              className="mb-4"
            />
            {ledgerRows.length === 0 ? (
              <EmptyState message={t(locale, "No transactions yet.")} />
            ) : (
              <Table density="compact">
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
                        <TableCell className="num-tabular">{row.date}</TableCell>
                        <TableCell>{row.memo}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{t(locale, badge.label)}</Badge>
                        </TableCell>
                        <TableCell className="num">{row.debit ? formatMoneyNumber(row.debit, "summary") : "—"}</TableCell>
                        <TableCell className="num">{row.credit ? formatMoneyNumber(row.credit, "summary") : "—"}</TableCell>
                        <TableCell className="num">{formatMoneyNumber(row.runningBalance, "summary")}</TableCell>
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
