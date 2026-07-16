import { eq, and, desc, inArray } from "drizzle-orm";
import { db, paymentsTable, bankAccountsTable, salesInvoicesTable, customersTable, purchaseOrdersTable, vendorsTable } from "@/db";
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
      .leftJoin(salesInvoicesTable, eq(salesInvoicesTable.id, paymentsTable.salesInvoiceId))
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
      })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.status, "received"))),
  ]);

  const outstandingInvoices = outstandingInvoiceRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customerName,
    balance: Number(r.total) - Number(r.paidAmount),
  }));
  const outstandingPos = outstandingPoRows.map((r) => ({
    id: r.id,
    poNumber: r.poNumber,
    vendorName: r.vendorName,
    balance: Number(r.total) - Number(r.paidAmount),
  }));

  return (
    <PaymentsListClient
      locale={locale}
      rows={rows}
      bankAccounts={bankAccounts}
      outstandingInvoices={outstandingInvoices}
      outstandingPos={outstandingPos}
    />
  );
}
