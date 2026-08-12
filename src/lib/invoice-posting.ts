import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable, productsTable } from "@/db";
import { captureBaseAmounts, subtractMoney, type CapturedBaseAmounts } from "@/lib/posting-currency";

/**
 * The ONE way a sales invoice posts: Dr AR / Cr Revenue (derived) / Cr VAT, plus the stock
 * decrement — extracted from sendInvoiceAction so it has exactly two callers with identical
 * accounting:
 *
 *  - **Send** (draft → sent), the moment posting has always happened.
 *  - **Conversion from a proforma that carries advances.** Such an invoice is born
 *    partially_paid/paid — a PAYMENT status, not a posting status — so it never passes through
 *    send, and before this function existed its revenue, AR and VAT simply never posted and its
 *    stock never decremented. Cash sat in 2300 Customer Advances (correctly) while the P&L showed
 *    nothing. The conversion action now calls `post` inside its own transaction for any invoice
 *    born non-draft. Advance-free conversions still post via send, unchanged — one posting moment
 *    per path, same entry either way.
 *
 * Split into prepare + post because the two halves belong on opposite sides of the caller's
 * transaction boundary: `prepareInvoicePosting` does the fallible lookups (system accounts, FX-6
 * rate capture — a foreign document with no usable rate BLOCKS, returning the missingRate seam
 * instead of posting a wrong ledger), and the returned `post` runs inside the caller's transaction
 * so invoice creation, stock and journal commit or roll back as one.
 *
 * Idempotent by journal identity: `post` refuses to double-post if ANY (sales_invoice, invoiceId)
 * entry already exists — and skips the stock decrement with it, since the two only ever happen
 * together.
 */

export type InvoicePostingItem = { productId: number | null; quantity: string };

/** Matches the transaction callback parameter of db.transaction — no exported type exists for it. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PreparedInvoicePosting = {
  ok: true;
  /** The FX-6 capture the caller stores on the invoice row (exchangeRate/baseTotal/baseTaxAmount). */
  captured: CapturedBaseAmounts;
  post: (tx: DbTransaction, args: { invoiceId: number; memo: string }) => Promise<void>;
};

export type InvoicePostingBlocked = {
  ok: false;
  error: string;
  missingRate?: { currency: string; date: string };
};

export async function prepareInvoicePosting(args: {
  orgId: number;
  userId: number;
  baseCurrency: string;
  /** The invoice's currency column, verbatim — null means base. */
  docCurrency: string | null;
  total: string;
  taxTotal: string;
  /** The invoice's own issue date: the posting's entry date and the FX-6 rate date. */
  issueDate: string;
  items: InvoicePostingItem[];
}): Promise<PreparedInvoicePosting | InvoicePostingBlocked> {
  const { orgId, userId, baseCurrency, docCurrency, total, taxTotal, issueDate, items } = args;

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const ar = byCode.get("1100");
  const revenue = byCode.get("4000");
  const vatPayable = byCode.get("2100");
  if (!ar || !revenue || !vatPayable) {
    return { ok: false, error: "Chart of accounts is missing a required system account (1100/4000/2100)." };
  }

  // FX-6: convert once, at the invoice's own date, and store the result. A base-currency invoice
  // short-circuits to the identity with no rate lookup; a foreign one with no usable rate BLOCKS —
  // posting unconverted or at a guessed rate writes a wrong ledger, and a block is recoverable.
  const captured = await captureBaseAmounts({ orgId, baseCurrency, docCurrency, total, taxTotal, date: issueDate });
  if (!captured.ok) return { ok: false, error: captured.error, missingRate: captured.missingRate };

  // The revenue line is DERIVED so the entry balances by construction — Dr baseTotal always equals
  // Cr revenue + Cr VAT exactly. (The old lines credited the full subtotal against a discounted
  // total, which unbalanced the entry by the discount; deriving the middle line closes that hole
  // for base-currency invoices too.)
  const baseRevenue = subtractMoney(captured.baseTotal, captured.baseTaxAmount, baseCurrency);

  return {
    ok: true,
    captured,
    post: async (tx, { invoiceId, memo }) => {
      const [existing] = await tx
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(and(
          eq(journalEntriesTable.orgId, orgId),
          eq(journalEntriesTable.sourceType, "sales_invoice"),
          eq(journalEntriesTable.sourceId, invoiceId),
        ))
        .limit(1);
      if (existing) return;

      for (const item of items) {
        if (item.productId) {
          await tx
            .update(productsTable)
            .set({ quantityOnHand: sql`${productsTable.quantityOnHand} - ${Math.trunc(Number(item.quantity))}` })
            .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, orgId)));
        }
      }

      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId,
          entryDate: issueDate,
          memo,
          sourceType: "sales_invoice",
          sourceId: invoiceId,
          createdById: userId,
        })
        .returning({ id: journalEntriesTable.id });

      // The ledger holds BASE currency only.
      const lines: { accountId: number; debit: string; credit: string }[] = [
        { accountId: ar.id, debit: captured.baseTotal, credit: "0" },
        { accountId: revenue.id, debit: "0", credit: baseRevenue },
      ];
      if (Number(captured.baseTaxAmount) > 0) {
        lines.push({ accountId: vatPayable.id, debit: "0", credit: captured.baseTaxAmount });
      }
      await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));
    },
  };
}
