import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { settlementOf } from "@/lib/settlement";
import { db, paymentsTable, bankAccountsTable, salesInvoicesTable, customersTable, purchaseOrdersTable, vendorsTable } from "@/db";
import { advanceInvoiceLinks } from "@/lib/advance-payment-links";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { PaymentsListClient } from "./payments-list-client";

export default async function PaymentsPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;

  const [rows, bankAccounts, outstandingInvoiceRows, outstandingPoRows] = await Promise.all([
    db
      .select({
        id: paymentsTable.id,
        direction: paymentsTable.direction,
        paymentDate: paymentsTable.paymentDate,
        method: paymentsTable.method,
        reference: paymentsTable.reference,
        amount: paymentsTable.amount,
        kind: paymentsTable.kind,
        bankAccountName: bankAccountsTable.name,
        invoiceId: salesInvoicesTable.id,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        customerName: customersTable.name,
        poId: purchaseOrdersTable.id,
        poNumber: purchaseOrdersTable.poNumber,
        vendorName: vendorsTable.name,
      })
      .from(paymentsTable)
      .innerJoin(bankAccountsTable, eq(bankAccountsTable.id, paymentsTable.bankAccountId))
      // Ordinary payments name their invoice through this join; an ADVANCE receipt's invoices come
      // from its allocations below, because one advance can settle several and a partial draw never
      // set the field at all.
      // NULL-safe: ordinary payments carry `kind = NULL`, and `kind <> 'advance_receipt'` is NULL
      // for them, which would drop their invoice columns entirely.
      .leftJoin(salesInvoicesTable, and(eq(salesInvoicesTable.id, paymentsTable.salesInvoiceId), sql`${paymentsTable.kind} is distinct from 'advance_receipt'`))
      .leftJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .leftJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, paymentsTable.purchaseOrderId))
      .leftJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(eq(paymentsTable.orgId, orgId))
      .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id)),
    db
      .select({ id: bankAccountsTable.id, name: bankAccountsTable.name })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, orgId), eq(bankAccountsTable.isActive, true))),
    db
      .select({
        id: salesInvoicesTable.id,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        customerName: customersTable.name,
        total: salesInvoicesTable.total,
        paidAmount: salesInvoicesTable.paidAmount,
        creditedAmount: salesInvoicesTable.creditedAmount,
        currency: salesInvoicesTable.currency,
      })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.status, ["sent", "partially_paid"]))),
    db
      .select({
        id: purchaseOrdersTable.id,
        poNumber: purchaseOrdersTable.poNumber,
        vendorName: vendorsTable.name,
        total: purchaseOrdersTable.total,
        paidAmount: purchaseOrdersTable.paidAmount,
        currency: purchaseOrdersTable.currency,
      })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.status, "received"))),
  ]);

  // Fill the invoice columns for advance receipts from their ALLOCATIONS. The register shows the
  // most recent invoice an advance settled, and says when there are more, rather than showing one
  // of several as though it were the whole story — or, once the field is cleared, showing none.
  const advanceLinks = await advanceInvoiceLinks(orgId, rows.filter((r) => r.kind === "advance_receipt").map((r) => r.id));
  const rowsWithLinks = rows.map((r) => {
    const link = r.kind === "advance_receipt" ? advanceLinks.get(r.id) : undefined;
    return link
      ? {
          ...r,
          invoiceId: link.invoiceId,
          invoiceNumber: link.invoiceCount > 1 ? `${link.invoiceNumber} +${link.invoiceCount - 1}` : link.invoiceNumber,
          customerName: link.customerName,
        }
      : r;
  });

  const outstandingInvoices = outstandingInvoiceRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customerName,
    // Settlement has three channels, and this figure is the one a person acts on — it pre-fills the
    // amount field, so an overstatement is what gets accepted by default. `total − paidAmount` left
    // every credited invoice looking more collectible than it is. `settlementOf` is the same helper
    // the invoice page, the reversal action and the credit-note action settle through.
    balance: Number(settlementOf({
      total: r.total,
      paid: r.paidAmount,
      credited: r.creditedAmount ?? "0",
      docCurrency: r.currency ?? session.orgCurrency,
    }).outstanding),
    currency: r.currency,
  }));
  const outstandingPos = outstandingPoRows.map((r) => ({
    id: r.id,
    poNumber: r.poNumber,
    vendorName: r.vendorName,
    // Purchase orders have NO credited column — `total − paidAmount` is the whole identity here,
    // and mirroring the invoice change onto this row would invent a channel that does not exist.
    balance: Number(r.total) - Number(r.paidAmount),
    currency: r.currency,
  }));

  return (
    // The Payment Records page can list documents in several currencies; the dialog's inputs follow
    // the organization's base currency, which is what an unset document currency means anyway.
    <PaymentsListClient
      locale={locale}
      currency={session.orgCurrency}
      rows={rowsWithLinks}
      bankAccounts={bankAccounts}
      outstandingInvoices={outstandingInvoices}
      outstandingPos={outstandingPos}
    />
  );
}
