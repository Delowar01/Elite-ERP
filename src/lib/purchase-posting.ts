import "server-only";
import { and, eq } from "drizzle-orm";
import { journalEntriesTable, journalLinesTable, type Tx } from "@/db";
import { subtractMoney } from "@/lib/posting-currency";
import { roundMoney } from "@/lib/currency/currencies";
import { debitNoteLines } from "@/lib/reversal-currency";
import {
  AP_ACCOUNT,
  COGS_ACCOUNT,
  INVENTORY_ACCOUNT,
  NON_STOCK_PURCHASE_ACCOUNT,
  VAT_ACCOUNT,
  allocateByWeight,
  hasSourceMovements,
  inventoryAccounts,
  receiveIntoStock,
  restorePreValuationQuantities,
  returnToSupplier,
  reverseSourceMovements,
  stockLineFlags,
} from "@/lib/inventory-costing";

/**
 * ACC-01 — the ledger and stock halves of the purchase side, run inside the caller's transaction:
 * the receipt of a purchase order, a debit note's purchase return, and that return's reversal.
 * The server actions keep their own lookups, lifecycle checks and locks; what posts lives here so
 * it has one implementation and can be exercised without a session.
 *
 * Both documents split the same way. The base-currency net (`baseTotal − baseTaxAmount`, derived,
 * so every entry balances by construction) is spread over the lines by line value — the document
 * discount applies pro rata — and then:
 *
 *   stock lines      → 1200 Inventory: a receipt adds them to the weighted-average pool at that
 *                      share; a return takes them out at the pool's average, and the difference
 *                      between the supplier's credit and that cost goes to 5000 Cost of Goods Sold
 *   other lines      → 5100 Operating Expenses (free-text lines and services are not stock)
 *   VAT              → 2100, recoverable input tax, never part of cost
 *   the gross        → 2000 Accounts Payable
 */

type DocLine = { id: number; productId: number | null; quantity: string; lineTotal: string };
type Captured = { baseTotal: string; baseTaxAmount: string };
type Line = { accountId: number; debit: string; credit: string };

function splitNet(baseCurrency: string, captured: Captured, items: DocLine[]) {
  const baseNet = subtractMoney(captured.baseTotal, captured.baseTaxAmount, baseCurrency);
  const shares = allocateByWeight(baseNet, items.map((it) => Number(it.lineTotal)), baseCurrency);
  const docLines = items.map((it) => ({ productId: it.productId, quantity: it.quantity, sourceLineId: it.id }));
  return { baseNet, shares, docLines };
}

/**
 * A purchase order's receipt: Dr 1200 stock net · Dr 5100 non-stock net · Dr 2100 VAT /
 * Cr 2000 gross, and the stock lines into the pool at their share. The entry keeps the order date
 * (unchanged FX-6 behaviour); the movements carry the receipt date, the day the goods arrived.
 */
export async function postPurchaseReceipt(
  tx: Tx,
  args: {
    orgId: number;
    userId: number;
    baseCurrency: string;
    po: { id: number; poNumber: string; orderDate: string };
    items: DocLine[];
    captured: Captured;
    receiptDate: string;
  },
) {
  const { orgId, userId, baseCurrency: base, po, items, captured } = args;
  const memo = `Purchase order ${po.poNumber} received`;
  const { baseNet, shares, docLines } = splitNet(base, captured, items);
  const isStock = await stockLineFlags(tx, orgId, docLines);

  const [entry] = await tx
    .insert(journalEntriesTable)
    .values({ orgId, entryDate: po.orderDate, memo, sourceType: "purchase_order", sourceId: po.id, createdById: userId })
    .returning({ id: journalEntriesTable.id });

  const received = await receiveIntoStock(
    tx,
    { orgId, userId, baseCurrency: base, date: args.receiptDate },
    { sourceType: "purchase_order", sourceId: po.id, journalEntryId: entry.id, memo },
    docLines.flatMap((l, i) => (isStock[i] ? [{ ...l, cost: shares[i] }] : [])),
  );
  // Whatever the pool did not take in is expensed, so the entry balances whatever the lines are.
  const expensed = subtractMoney(baseNet, received.value, base);

  const needed = [INVENTORY_ACCOUNT, AP_ACCOUNT];
  if (Number(expensed) !== 0) needed.push(NON_STOCK_PURCHASE_ACCOUNT);
  if (Number(captured.baseTaxAmount) !== 0) needed.push(VAT_ACCOUNT);
  const acc = await inventoryAccounts(tx, orgId, needed);

  // The ledger holds BASE currency only. A zero-value order keeps the old two-line shape.
  const lines: Line[] = [];
  if (Number(received.value) !== 0 || Number(expensed) === 0) lines.push({ accountId: acc.get(INVENTORY_ACCOUNT)!, debit: received.value, credit: "0" });
  if (Number(expensed) !== 0) lines.push({ accountId: acc.get(NON_STOCK_PURCHASE_ACCOUNT)!, debit: expensed, credit: "0" });
  if (Number(captured.baseTaxAmount) !== 0) lines.push({ accountId: acc.get(VAT_ACCOUNT)!, debit: captured.baseTaxAmount, credit: "0" });
  lines.push({ accountId: acc.get(AP_ACCOUNT)!, debit: "0", credit: captured.baseTotal });
  await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));
  return { entryId: entry.id, inventory: received.value, expensed };
}

/**
 * A debit note's purchase return: Dr 2000 for the gross the supplier credits (at the PO's stored rate)
 * / Cr 1200 the returned stock at the weighted-average cost · Cr 5100 the non-stock lines · Cr 2100
 * VAT, ± 5000 for the price variance — the supplier's credit for the stock lines less the cost they
 * left at (see returnToSupplier). The units that stay keep their average.
 */
export async function postPurchaseReturn(
  tx: Tx,
  args: {
    orgId: number;
    userId: number;
    baseCurrency: string;
    dn: { id: number; debitNoteNumber: string; issueDate: string };
    items: DocLine[];
    captured: Captured;
  },
) {
  const { orgId, userId, baseCurrency: base, dn, items, captured } = args;
  const memo = `Debit note ${dn.debitNoteNumber} issued`;
  const { baseNet, shares, docLines } = splitNet(base, captured, items);
  const isStock = await stockLineFlags(tx, orgId, docLines);

  const [entry] = await tx
    .insert(journalEntriesTable)
    .values({ orgId, entryDate: dn.issueDate, memo, sourceType: "debit_note", sourceId: dn.id, createdById: userId })
    .returning({ id: journalEntriesTable.id });

  const relieved = await returnToSupplier(
    tx,
    { orgId, userId, baseCurrency: base, date: dn.issueDate },
    { sourceType: "debit_note", sourceId: dn.id, journalEntryId: entry.id, memo },
    docLines.flatMap((l, i) => (isStock[i] ? [{ ...l, value: shares[i] }] : [])),
  );
  const unExpensed = subtractMoney(subtractMoney(baseNet, relieved.inventoryCredit, base), relieved.variance, base);

  const needed = [INVENTORY_ACCOUNT, AP_ACCOUNT];
  if (Number(unExpensed) !== 0) needed.push(NON_STOCK_PURCHASE_ACCOUNT);
  if (Number(captured.baseTaxAmount) !== 0) needed.push(VAT_ACCOUNT);
  if (Number(relieved.variance) !== 0) needed.push(COGS_ACCOUNT);
  const acc = await inventoryAccounts(tx, orgId, needed);

  const otherSide: Line[] = [];
  if (Number(relieved.inventoryCredit) !== 0) otherSide.push({ accountId: acc.get(INVENTORY_ACCOUNT)!, debit: "0", credit: relieved.inventoryCredit });
  if (Number(unExpensed) !== 0) otherSide.push({ accountId: acc.get(NON_STOCK_PURCHASE_ACCOUNT)!, debit: "0", credit: unExpensed });
  if (Number(captured.baseTaxAmount) !== 0) otherSide.push({ accountId: acc.get(VAT_ACCOUNT)!, debit: "0", credit: captured.baseTaxAmount });
  // The price variance: a positive one is credit the supplier gave beyond the units' weighted-average cost
  // (it reduces cost of sales), a negative one credit short of it (it adds to cost of sales).
  if (Number(relieved.variance) > 0) otherSide.push({ accountId: acc.get(COGS_ACCOUNT)!, debit: "0", credit: relieved.variance });
  if (Number(relieved.variance) < 0) otherSide.push({ accountId: acc.get(COGS_ACCOUNT)!, debit: roundMoney(-Number(relieved.variance), base), credit: "0" });
  // A zero-value note keeps the old two-line shape.
  if (otherSide.length === 0) otherSide.push({ accountId: acc.get(INVENTORY_ACCOUNT)!, debit: "0", credit: captured.baseTotal });

  // BASE currency only. Dr AP for the gross, against the split — balanced by construction.
  await tx.insert(journalLinesTable).values(
    debitNoteLines({ baseTotal: captured.baseTotal, apAccountId: acc.get(AP_ACCOUNT)!, inventoryAccountId: acc.get(INVENTORY_ACCOUNT)!, otherSide })
      .map((l) => ({ journalEntryId: entry.id, ...l })),
  );
  return { entryId: entry.id, ...relieved, unExpensed };
}

/**
 * Reverse an issued debit note: mirror its posting entry line for line (FX-6 — whatever was
 * posted, at the stored figures) and put the returned stock back exactly as it left. A note issued
 * before ACC-01 has no movements: its old decrement is restored unit for unit, with no cost.
 */
export async function reversePurchaseReturn(
  tx: Tx,
  args: { orgId: number; userId: number; baseCurrency: string; dn: { id: number; debitNoteNumber: string }; items: DocLine[]; date: string },
) {
  const { orgId, userId, dn } = args;
  const memo = `Debit note ${dn.debitNoteNumber} reversed`;
  const [posting] = await tx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.orgId, orgId), eq(journalEntriesTable.sourceType, "debit_note"), eq(journalEntriesTable.sourceId, dn.id)))
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
      .values({ orgId, entryDate: args.date, memo, sourceType: "debit_note", sourceId: dn.id, createdById: userId })
      .returning({ id: journalEntriesTable.id });
    await tx.insert(journalLinesTable).values(
      originalLines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
    );
    reversalEntryId = entry.id;
  }

  const ctx = { orgId, userId, baseCurrency: args.baseCurrency, date: args.date };
  const source = { sourceType: "debit_note", sourceId: dn.id, journalEntryId: reversalEntryId, memo };
  if (await hasSourceMovements(tx, orgId, "debit_note", dn.id, ["purchase_return"])) {
    await reverseSourceMovements(tx, ctx, source, ["purchase_return"]);
  } else if (posting) {
    await restorePreValuationQuantities(tx, ctx, source, args.items.map((it) => ({ productId: it.productId, quantity: it.quantity, sourceLineId: it.id })));
  }
  return { reversalEntryId };
}
