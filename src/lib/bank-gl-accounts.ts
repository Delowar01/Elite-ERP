/**
 * Which GL account a bank account may be linked to.
 *
 * ## The defect this exists to prevent
 *
 * A bank account was configured in production with `1100 · Accounts Receivable` as its GL account.
 * Every receipt through it then posted **Dr 1100 / Cr 1100** in effect — the bank leg debited the
 * AR control account instead of a bank asset — so AR Aging read 0 while the 1100 control account
 * carried a balance nothing could explain. Worse, `getCashFlow` treats *whatever account a bank
 * account points at* as cash, so AR was also counted as cash. Nothing in the code stopped it.
 *
 * ## What the chart of accounts can actually express
 *
 * `accounts` carries `type` (asset | liability | equity | revenue | expense), `code`, `name`,
 * `isSystem`, `isActive` — and **no cash/bank subtype**. "Cash and bank accounts only" is therefore
 * NOT directly expressible: 1000 Cash, 1100 AR and 1200 Inventory are all `type: "asset"`. A pure
 * whitelist would need either a new column or a code-band convention invented for validation
 * (`codeNum` bands exist today, but only for *presentation* — P&L sections and the current /
 * non-current split, where a wrong bucket is cosmetic and a refused save is not).
 *
 * So the rule is whitelist-by-type plus a blacklist that is itself structural rather than an
 * opinion — the literal set of codes the posting paths resolve by code:
 *
 *   1. the account must be an **asset** (a bank balance is an asset — this alone rules out every
 *      liability, revenue and expense account, including 2000 / 2100 / 2300 / 4000 / 4900), and
 *   2. it must not be a **structural posting account** — one that a posting path looks up by code
 *      and writes to on its own (1100 AR and 1200 Inventory are assets, so only this catches them).
 *
 * `1000 Cash` is deliberately NOT in the structural set: no posting path resolves it: it is only
 * read by `seedOrgDefaults` (to point the seeded bank account at it) and by the cash-flow report
 * (which counts it as cash). It is the intended default target of a bank mapping, and a
 * user-created `1010 · Al Inma Bank` asset is equally eligible.
 */

/**
 * Account codes a posting path resolves BY CODE and writes to structurally. Kept here as the one
 * list, with each code naming where it posts; `verify-bank-gl` greps the source and fails if a
 * `byCode.get("NNNN")` exists that this list does not account for, so the guard cannot drift as
 * new postings are added.
 */
export const STRUCTURAL_POSTING_CODES: readonly string[] = [
  "1100", // Accounts Receivable — invoice posting, credit notes, payments, advance applications
  "1200", // Inventory — purchase-order receipt, debit notes
  "2000", // Accounts Payable — purchase orders, debit notes, PO payments
  "2100", // VAT Payable — invoice posting, credit notes
  "2200", // Salaries Payable — payroll runs
  "2300", // Customer Advances — advance receipts, applications, refunds
  "4000", // Sales Revenue — invoice posting, credit notes
  "4900", // Exchange Gain/Loss — realized FX on payments and advance applications
  "5200", // Salary Expense — payroll runs
];

export type BankGlCandidate = { code: string; name: string; type: string };

/**
 * Why this account may not back a bank account, or null when it may. The message is the one the
 * server returns and the one a replay sees — it names the account, so a refusal is diagnosable
 * from the response alone.
 */
export function bankGlRefusal(account: BankGlCandidate): string | null {
  if (STRUCTURAL_POSTING_CODES.includes(account.code)) {
    return `${account.code} ${account.name} is a control account the system posts to automatically. A bank account linked to it would post receipts into that control account instead of a bank balance. Choose a cash or bank asset account.`;
  }
  if (account.type !== "asset") {
    return `${account.code} ${account.name} is a ${account.type} account. A bank account must be linked to a cash or bank asset account.`;
  }
  return null;
}

/** The accounts a bank account may be linked to — what the GL selector should offer. */
export function eligibleBankGlAccounts<T extends BankGlCandidate>(accounts: T[]): T[] {
  return accounts.filter((a) => bankGlRefusal(a) === null);
}
