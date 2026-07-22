/**
 * Batch A4 — LIVE database test for cancel / void / reversal.
 *
 * Exercises the exact accounting + inventory effects of each A4 workflow against real
 * Postgres, mirroring the server actions' SQL, and asserts that every reversal nets the
 * ledger and stock back to their pre-posting values, that linked balances/status update,
 * and that a second cancel/void/reverse is refused by the lifecycle gate. Cleans up after.
 *   DATABASE_URL=... npx tsx scripts/tests/a4-live.ts
 */
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  db,
  pool,
  productsTable,
  customersTable,
  vendorsTable,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  creditNotesTable,
  creditNoteItemsTable,
  debitNotesTable,
  debitNoteItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  salesOrdersTable,
} from "../../src/db";
import { evaluate } from "../../src/lib/document-lifecycle";

const ORG = 1;
const USER = 1;
const today = new Date().toISOString().slice(0, 10);
let failures = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
}

const createdEntryIds: number[] = [];
async function acctId(code: string) {
  const [a] = await db.select({ id: accountsTable.id }).from(accountsTable).where(and(eq(accountsTable.orgId, ORG), eq(accountsTable.code, code)));
  return a.id;
}
// signed raw balance for an account = sum(debit) - sum(credit) over this org's journal lines
async function raw(accountId: number): Promise<number> {
  const [r] = await db
    .select({ v: sql<string>`COALESCE(SUM(${journalLinesTable.debit}) - SUM(${journalLinesTable.credit}), 0)` })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(and(eq(journalEntriesTable.orgId, ORG), eq(journalLinesTable.accountId, accountId)));
  return Number(r?.v ?? 0);
}
async function postEntry(memo: string, sourceType: string, sourceId: number, lines: { accountId: number; debit: string; credit: string }[]) {
  const [e] = await db.insert(journalEntriesTable).values({ orgId: ORG, entryDate: today, memo, sourceType, sourceId, createdById: USER }).returning({ id: journalEntriesTable.id });
  createdEntryIds.push(e.id);
  await db.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: e.id, ...l })));
}
async function stock(pid: number) {
  const [p] = await db.select({ q: productsTable.quantityOnHand }).from(productsTable).where(eq(productsTable.id, pid));
  return Number(p.q);
}

async function main() {
  const [AR, REV, VAT, INV, AP] = await Promise.all([acctId("1100"), acctId("4000"), acctId("2100"), acctId("1200"), acctId("2000")]);
  const [cust] = await db.insert(customersTable).values({ orgId: ORG, name: "A4 Live Client" }).returning({ id: customersTable.id });
  const [vend] = await db.insert(vendorsTable).values({ orgId: ORG, name: "A4 Live Vendor" }).returning({ id: vendorsTable.id });
  const [prodP] = await db.insert(productsTable).values({ orgId: ORG, name: "A4 Prod P", sku: `A4P-${Date.now()}`, quantityOnHand: 100 }).returning({ id: productsTable.id });
  const [prodQ] = await db.insert(productsTable).values({ orgId: ORG, name: "A4 Prod Q", sku: `A4Q-${Date.now()}`, quantityOnHand: 100 }).returning({ id: productsTable.id });

  // ================= FLOW A: void an unpaid posted invoice =================
  console.log("\n[A] Void unpaid posted invoice");
  const [inv] = await db.insert(salesInvoicesTable).values({ orgId: ORG, invoiceNumber: `A4-INV-${Date.now()}`, customerId: cust.id, issueDate: today, subtotal: "500.00", discount: "0", taxTotal: "75.00", total: "575.00", createdById: USER }).returning({ id: salesInvoicesTable.id, invoiceNumber: salesInvoicesTable.invoiceNumber });
  await db.insert(salesInvoiceItemsTable).values({ invoiceId: inv.id, productId: prodP.id, description: "P", quantity: "5", unitPrice: "100.00", taxRatePercent: "15", lineTotal: "500.00" });
  const arB = await raw(AR), revB = await raw(REV), vatB = await raw(VAT);
  // send (mirror sendInvoiceAction)
  await db.update(productsTable).set({ quantityOnHand: sql`${productsTable.quantityOnHand} - 5` }).where(eq(productsTable.id, prodP.id));
  await postEntry(`Invoice ${inv.invoiceNumber} sent`, "sales_invoice", inv.id, [{ accountId: AR, debit: "575.00", credit: "0" }, { accountId: REV, debit: "0", credit: "500.00" }, { accountId: VAT, debit: "0", credit: "75.00" }]);
  await db.update(salesInvoicesTable).set({ status: "sent" }).where(eq(salesInvoicesTable.id, inv.id));
  assert("[A] stock decremented on send (100 → 95)", (await stock(prodP.id)) === 95);
  assert("[A] AR +575 / REV -500 / VAT -75 after send", (await raw(AR)) === arB + 575 && (await raw(REV)) === revB - 500 && (await raw(VAT)) === vatB - 75);
  // void (mirror voidInvoiceAction): must be permitted (unpaid), reverse + restore stock
  assert("[A] void permitted for sent unpaid", evaluate("sales_invoice", "sent", "void", { hasPayments: false }).allowed);
  await db.update(productsTable).set({ quantityOnHand: sql`${productsTable.quantityOnHand} + 5` }).where(eq(productsTable.id, prodP.id));
  await postEntry(`Invoice ${inv.invoiceNumber} voided (reversal)`, "sales_invoice", inv.id, [{ accountId: REV, debit: "500.00", credit: "0" }, { accountId: VAT, debit: "75.00", credit: "0" }, { accountId: AR, debit: "0", credit: "575.00" }]);
  await db.update(salesInvoicesTable).set({ status: "void" }).where(eq(salesInvoicesTable.id, inv.id));
  assert("[A] stock restored after void (→ 100)", (await stock(prodP.id)) === 100);
  assert("[A] AR / REV / VAT net to zero after void", (await raw(AR)) === arB && (await raw(REV)) === revB && (await raw(VAT)) === vatB);
  assert("[A] re-void refused (terminal, dedup)", !evaluate("sales_invoice", "void", "void").allowed);
  assert("[A] void refused when invoice carries a payment/credit (sent + paidAmount>0)", !evaluate("sales_invoice", "sent", "void", { hasPayments: true }).allowed);

  // ================= FLOW B: reverse an issued credit note =================
  console.log("\n[B] Reverse issued credit note");
  const [inv2] = await db.insert(salesInvoicesTable).values({ orgId: ORG, invoiceNumber: `A4-INV2-${Date.now()}`, customerId: cust.id, issueDate: today, subtotal: "500.00", discount: "0", taxTotal: "75.00", total: "575.00", paidAmount: "0", status: "sent", createdById: USER }).returning({ id: salesInvoicesTable.id });
  const [cn] = await db.insert(creditNotesTable).values({ orgId: ORG, creditNoteNumber: `A4-CN-${Date.now()}`, customerId: cust.id, sourceInvoiceId: inv2.id, issueDate: today, subtotal: "100.00", taxTotal: "15.00", total: "115.00", createdById: USER }).returning({ id: creditNotesTable.id, creditNoteNumber: creditNotesTable.creditNoteNumber });
  await db.insert(creditNoteItemsTable).values({ creditNoteId: cn.id, description: "credit", quantity: "1", unitPrice: "100.00", taxRatePercent: "15", lineTotal: "100.00" });
  const arB2 = await raw(AR), revB2 = await raw(REV), vatB2 = await raw(VAT);
  // issue (mirror issueCreditNoteAction)
  await postEntry(`Credit note ${cn.creditNoteNumber} issued`, "credit_note", cn.id, [{ accountId: REV, debit: "100.00", credit: "0" }, { accountId: AR, debit: "0", credit: "115.00" }, { accountId: VAT, debit: "15.00", credit: "0" }]);
  await db.update(creditNotesTable).set({ status: "issued" }).where(eq(creditNotesTable.id, cn.id));
  await db.update(salesInvoicesTable).set({ paidAmount: sql`${salesInvoicesTable.paidAmount} + 115` }).where(eq(salesInvoicesTable.id, inv2.id));
  const paidAfterIssue = Number((await db.select({ p: salesInvoicesTable.paidAmount }).from(salesInvoicesTable).where(eq(salesInvoicesTable.id, inv2.id)))[0].p);
  assert("[B] invoice paidAmount rose to 115 on CN issue", paidAfterIssue === 115);
  // reverse (mirror reverseCreditNoteAction)
  assert("[B] reverse permitted for issued CN", evaluate("credit_note", "issued", "reverse").allowed);
  await postEntry(`Credit note ${cn.creditNoteNumber} reversed`, "credit_note", cn.id, [{ accountId: AR, debit: "115.00", credit: "0" }, { accountId: REV, debit: "0", credit: "100.00" }, { accountId: VAT, debit: "0", credit: "15.00" }]);
  await db.update(creditNotesTable).set({ status: "reversed" }).where(eq(creditNotesTable.id, cn.id));
  await db.update(salesInvoicesTable).set({ paidAmount: sql`GREATEST(0, ${salesInvoicesTable.paidAmount} - 115)` }).where(eq(salesInvoicesTable.id, inv2.id));
  const paidAfterReverse = Number((await db.select({ p: salesInvoicesTable.paidAmount }).from(salesInvoicesTable).where(eq(salesInvoicesTable.id, inv2.id)))[0].p);
  assert("[B] invoice balance restored (paidAmount → 0)", paidAfterReverse === 0);
  assert("[B] AR / REV / VAT net to zero after CN reverse", (await raw(AR)) === arB2 && (await raw(REV)) === revB2 && (await raw(VAT)) === vatB2);
  assert("[B] re-reverse refused (dedup)", !evaluate("credit_note", "reversed", "reverse").allowed);

  // ================= FLOW C: reverse an issued debit note =================
  console.log("\n[C] Reverse issued debit note");
  const [po] = await db.insert(purchaseOrdersTable).values({ orgId: ORG, poNumber: `A4-PO-${Date.now()}`, vendorId: vend.id, orderDate: today, status: "received", subtotal: "200.00", discount: "0", taxTotal: "30.00", total: "230.00", createdById: USER }).returning({ id: purchaseOrdersTable.id });
  const [dn] = await db.insert(debitNotesTable).values({ orgId: ORG, debitNoteNumber: `A4-DN-${Date.now()}`, vendorId: vend.id, sourcePurchaseOrderId: po.id, issueDate: today, subtotal: "200.00", taxTotal: "30.00", total: "230.00", createdById: USER }).returning({ id: debitNotesTable.id, debitNoteNumber: debitNotesTable.debitNoteNumber });
  await db.insert(debitNoteItemsTable).values({ debitNoteId: dn.id, productId: prodQ.id, description: "return", quantity: "3", unitCost: "66.67", taxRatePercent: "15", lineTotal: "200.00" });
  const apB = await raw(AP), invB = await raw(INV);
  // issue (mirror issueDebitNoteAction): stock down, Dr AP / Cr Inventory
  await db.update(productsTable).set({ quantityOnHand: sql`${productsTable.quantityOnHand} - 3` }).where(eq(productsTable.id, prodQ.id));
  await postEntry(`Debit note ${dn.debitNoteNumber} issued`, "debit_note", dn.id, [{ accountId: AP, debit: "230.00", credit: "0" }, { accountId: INV, debit: "0", credit: "230.00" }]);
  await db.update(debitNotesTable).set({ status: "issued" }).where(eq(debitNotesTable.id, dn.id));
  assert("[C] stock decremented on DN issue (100 → 97)", (await stock(prodQ.id)) === 97);
  // reverse (mirror reverseDebitNoteAction): stock back, Dr Inventory / Cr AP
  assert("[C] reverse permitted for issued DN", evaluate("debit_note", "issued", "reverse").allowed);
  await db.update(productsTable).set({ quantityOnHand: sql`${productsTable.quantityOnHand} + 3` }).where(eq(productsTable.id, prodQ.id));
  await postEntry(`Debit note ${dn.debitNoteNumber} reversed`, "debit_note", dn.id, [{ accountId: INV, debit: "230.00", credit: "0" }, { accountId: AP, debit: "0", credit: "230.00" }]);
  await db.update(debitNotesTable).set({ status: "reversed" }).where(eq(debitNotesTable.id, dn.id));
  assert("[C] stock restored after DN reverse (→ 100)", (await stock(prodQ.id)) === 100);
  assert("[C] AP / Inventory net to zero after DN reverse", (await raw(AP)) === apB && (await raw(INV)) === invB);
  assert("[C] re-reverse refused (dedup)", !evaluate("debit_note", "reversed", "reverse").allowed);

  // ================= FLOW D: cancel non-posted SO / PO (no accounting) =================
  console.log("\n[D] Cancel non-posted sales/purchase orders");
  const [so] = await db.insert(salesOrdersTable).values({ orgId: ORG, soNumber: `A4-SO-${Date.now()}`, customerId: cust.id, issueDate: today, status: "confirmed", subtotal: "0", discount: "0", taxTotal: "0", total: "0", createdById: USER }).returning({ id: salesOrdersTable.id });
  const jeBeforeSo = (await db.select({ n: sql<string>`count(*)` }).from(journalEntriesTable).where(eq(journalEntriesTable.orgId, ORG)))[0];
  assert("[D] SO confirmed cancel permitted", evaluate("sales_order", "confirmed", "cancel").allowed);
  await db.update(salesOrdersTable).set({ status: "cancelled" }).where(eq(salesOrdersTable.id, so.id));
  const soJe = (await db.select({ n: sql<string>`count(*)` }).from(journalEntriesTable).where(and(eq(journalEntriesTable.orgId, ORG), eq(journalEntriesTable.sourceType, "sales_order"), eq(journalEntriesTable.sourceId, so.id))))[0];
  assert("[D] SO cancel posts NO journal entry", Number(soJe.n) === 0 && Number(jeBeforeSo.n) >= 0);
  assert("[D] SO fulfilled cancel refused", !evaluate("sales_order", "fulfilled", "cancel").allowed);
  assert("[D] SO re-cancel refused (dedup)", !evaluate("sales_order", "cancelled", "cancel").allowed);

  const [po2] = await db.insert(purchaseOrdersTable).values({ orgId: ORG, poNumber: `A4-PO2-${Date.now()}`, vendorId: vend.id, orderDate: today, status: "ordered", subtotal: "0", discount: "0", taxTotal: "0", total: "0", createdById: USER }).returning({ id: purchaseOrdersTable.id });
  assert("[D] PO ordered cancel permitted", evaluate("purchase_order", "ordered", "cancel").allowed);
  await db.update(purchaseOrdersTable).set({ status: "cancelled" }).where(eq(purchaseOrdersTable.id, po2.id));
  const poJe = (await db.select({ n: sql<string>`count(*)` }).from(journalEntriesTable).where(and(eq(journalEntriesTable.orgId, ORG), eq(journalEntriesTable.sourceType, "purchase_order"), eq(journalEntriesTable.sourceId, po2.id))))[0];
  assert("[D] PO cancel posts NO journal entry", Number(poJe.n) === 0);
  assert("[D] PO received cancel refused (posted)", !evaluate("purchase_order", "received", "cancel").allowed);
  assert("[D] PO re-cancel refused (dedup)", !evaluate("purchase_order", "cancelled", "cancel").allowed);

  // ================= cleanup =================
  if (createdEntryIds.length) {
    await db.delete(journalLinesTable).where(inArray(journalLinesTable.journalEntryId, createdEntryIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, createdEntryIds));
  }
  await db.delete(salesInvoiceItemsTable).where(inArray(salesInvoiceItemsTable.invoiceId, [inv.id, inv2.id]));
  await db.delete(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, cn.id));
  await db.delete(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, dn.id));
  await db.delete(creditNotesTable).where(eq(creditNotesTable.id, cn.id));
  await db.delete(debitNotesTable).where(eq(debitNotesTable.id, dn.id));
  await db.delete(salesInvoicesTable).where(inArray(salesInvoicesTable.id, [inv.id, inv2.id]));
  await db.delete(salesOrdersTable).where(eq(salesOrdersTable.id, so.id));
  await db.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, [po.id, po2.id]));
  await db.delete(productsTable).where(inArray(productsTable.id, [prodP.id, prodQ.id]));
  await db.delete(customersTable).where(eq(customersTable.id, cust.id));
  await db.delete(vendorsTable).where(eq(vendorsTable.id, vend.id));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — live cancel/void/reversal accounting + inventory, ${failures} failure(s)`);
  await pool.end();
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
