import { eq, asc } from "drizzle-orm";
import { db, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getAccountBalances, getAccountLedger } from "@/lib/accounting";
import { AccountLedgerView } from "../_shared/account-ledger-view";

export default async function ChartOfAccountsPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;
  const { account } = await searchParams;

  const [accounts, balances] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(asc(accountsTable.code)),
    getAccountBalances(orgId),
  ]);

  const selectedId = account ? Number(account) : accounts[0]?.id;
  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null;
  const ledgerRows = selectedAccount ? await getAccountLedger(orgId, selectedAccount.id) : [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Chart of Accounts")}</h3>
      </div>
      <AccountLedgerView
        locale={locale}
        basePath="/finance/chart-of-accounts"
        accounts={accounts}
        balances={balances}
        selectedAccount={selectedAccount}
        ledgerRows={ledgerRows}
      />
    </div>
  );
}
