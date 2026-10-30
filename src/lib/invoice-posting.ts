import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { captureBaseAmounts, subtractMoney, type CapturedBaseAmounts } from "@/lib/posting-currency";
import {
  COGS_ACCOUNT, INVENTORY_ACCOUNT, InventoryRefusal, hasSourceMovements, inventoryAccounts, issueForSale,
  restorePreValuationQuantities, reverseSourceMovements,
} from "@/lib/inventory-costing";

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
 * entry already exists — and skips the stock issue with it, since the two only ever happen
 * together. It locks the invoice row first, so two concurrent sends serialize and the second finds
 * the first one's entry.
 *
 * ACC-01: posting is also the invoice's stock ISSUE — the one moment stock has always left the
 * books (a delivery challan moves no stock). The stock lines leave at weighted-average cost
 * (src/lib/inventory-costing.ts) and the same entry carries the cost of goods sold,
 * Dr 5000 / Cr 1200, so revenue and its cost post together and the void's mirror reverses both. A
 * stock shortfall or a fractional stock quantity throws `InventoryRefusal`, rolling the caller's
 * transaction back.
 */

export type InvoicePostingItem = { productId: number | null; quantity: string; id?: number };

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
      await tx.execute(sql`select id from sales_invoices where id = ${invoiceId} and org_id = ${orgId} for update`);
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

      const issued = await issueForSale(
        tx,
        { orgId, userId, baseCurrency, date: issueDate },
        { sourceType: "sales_invoice", sourceId: invoiceId, journalEntryId: entry.id, memo },
        items.map((it) => ({ productId: it.productId, quantity: it.quantity, sourceLineId: it.id ?? null })),
      );
      if (Number(issued.cost) !== 0) {
        const acc = await inventoryAccounts(tx, orgId, [COGS_ACCOUNT, INVENTORY_ACCOUNT]);
        lines.push({ accountId: acc.get(COGS_ACCOUNT)!, debit: issued.cost, credit: "0" });
        lines.push({ accountId: acc.get(INVENTORY_ACCOUNT)!, debit: "0", credit: issued.cost });
      }
      await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));
    },
  };
}

/**
 * The ledger-and-stock half of voiding a posted invoice, inside the caller's transaction.
 *
 * FX-6: the reversal MIRRORS the posting entry's own stored lines instead of recomputing from the
 * document — whatever was posted (base figures, a pre-FX-6 foreign posting at face value, a
 * discounted invoice, and since ACC-01 its COGS lines) is negated line for line, so the reversal
 * balances iff the original did and no later rate can leak in. A document with NO posting entry
 * (fixtures inserted as "sent" by SQL) reverses nothing — the old code recomputed from the
 * document's columns and, fed one inconsistent fixture, wrote eleven one-sided entries into the dev
 * ledger before anyone noticed.
 *
 * ACC-01: the stock comes back exactly as it left — each issue movement reversed at its own
 * quantity and cost, matching the mirrored Dr 1200 / Cr 5000. An invoice posted before ACC-01 has
 * no movements: its old decrement is restored unit for unit, with no cost.
 */
export async function reverseInvoicePosting(
  tx: DbTransaction,
  args: { orgId: number; userId: number; baseCurrency: string; invoice: { id: number; invoiceNumber: string }; items: InvoicePostingItem[]; date: string },
) {
  const { orgId, userId, invoice } = args;
  const memo = `Invoice ${invoice.invoiceNumber} voided (reversal)`;
  // Goods a credit note returned to stock came back out of this sale's issue; the void would put the
  // whole issue back on top of them — the same units twice. Their credit notes are reversed first.
  // (An issued credit note settles part of the invoice, and a settled invoice cannot be voided, so
  // only a zero-value note reaches this; the caller holds the invoice's row lock, which every return
  // against it also takes.)
  const returned = await tx.execute(sql`
    select 1 from inventory_movements r join credit_notes c on c.id = r.source_id and c.org_id = r.org_id
     where r.org_id = ${orgId} and r.kind = 'sales_return' and r.source_type = 'credit_note' and c.source_invoice_id = ${invoice.id}
       and not exists (select 1 from inventory_movements x where x.org_id = ${orgId} and x.kind = 'reversal' and x.reverses_movement_id = r.id)
     limit 1`);
  if (returned.rows.length > 0) {
    throw new InventoryRefusal(
      "Goods returned against this invoice's credit notes are back in stock. Reverse those credit notes before voiding the invoice.",
      "البضاعة المرتجعة بإشعارات دائن على هذه الفاتورة عادت إلى المخزون. اعكس تلك الإشعارات قبل إلغاء الفاتورة.",
    );
  }
  const [posting] = await tx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.orgId, orgId),
      eq(journalEntriesTable.sourceType, "sales_invoice"),
      eq(journalEntriesTable.sourceId, invoice.id),
    ))
    .orderBy(journalEntriesTable.id)
    .limit(1);

  let reversalEntryId: number | null = null;
  if (posting) {
    const originalLines = await tx
      .select({ accountId: journalLinesTable.accountId, debit: journalLinesTable.debit, credit: journalLinesTable.credit })
      .from(journalLinesTable)
      .where(eq(journalLinesTable.journalEntryId, posting.id));
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({ orgId, entryDate: args.date, memo, sourceType: "sales_invoice", sourceId: invoice.id, createdById: userId })
      .returning({ id: journalEntriesTable.id });
    await tx.insert(journalLinesTable).values(
      originalLines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
    );
    reversalEntryId = entry.id;
  }

  const ctx = { orgId, userId, baseCurrency: args.baseCurrency, date: args.date };
  const source = { sourceType: "sales_invoice", sourceId: invoice.id, journalEntryId: reversalEntryId, memo };
  if (await hasSourceMovements(tx, orgId, "sales_invoice", invoice.id, ["issue"])) {
    await reverseSourceMovements(tx, ctx, source, ["issue"]);
  } else if (posting) {
    await restorePreValuationQuantities(tx, ctx, source, args.items.map((it) => ({ productId: it.productId, quantity: it.quantity, sourceLineId: it.id ?? null })));
  }
  return { reversalEntryId };
}
