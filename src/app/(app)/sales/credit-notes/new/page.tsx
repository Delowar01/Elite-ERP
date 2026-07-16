import { and, asc, eq, ne } from "drizzle-orm";
import { db, salesInvoicesTable, customersTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { CnForm } from "../cn-form";

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { invoice } = await searchParams;

  const [invoices, products, [org], numberPreview] = await Promise.all([
    db
      .select({
        id: salesInvoicesTable.id,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        customerName: customersTable.name,
        customerAddress: customersTable.address,
        customerEmail: customersTable.email,
        customerPhone: customersTable.phone,
      })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, session.orgId), ne(salesInvoicesTable.status, "draft"), ne(salesInvoicesTable.status, "void")))
      .orderBy(asc(salesInvoicesTable.invoiceNumber)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "credit_note"),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <CnForm locale={locale} invoices={invoices} products={products} org={org} numberPreview={numberPreview} defaultInvoiceId={invoice} />
    </div>
  );
}
