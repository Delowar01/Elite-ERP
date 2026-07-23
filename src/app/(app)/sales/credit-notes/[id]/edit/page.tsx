import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, creditNotesTable, creditNoteItemsTable, salesInvoicesTable, customersTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { can } from "@/lib/document-lifecycle";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { CnForm } from "../../cn-form";

export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const cnId = Number((await params).id);
  if (!Number.isInteger(cnId)) notFound();

  const [cn] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, cnId), eq(creditNotesTable.orgId, session.orgId)));
  if (!cn) notFound();
  if (!can("credit_note", cn.status, "edit")) redirect(`/sales/credit-notes/${cnId}`);

  const [items, [sourceInvoice], products, [org]] = await Promise.all([
    db.select().from(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, cnId)),
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
      .where(and(eq(salesInvoicesTable.id, cn.sourceInvoiceId), eq(salesInvoicesTable.orgId, session.orgId))),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    taxRatePercent: it.taxRatePercent,
    imageUrl: it.imageUrl ?? "",
    unit: it.unit ?? "",
    customFields: {},
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <CnForm
        locale={locale}
        invoices={sourceInvoice ? [sourceInvoice] : []}
        products={products}
        org={org}
        numberPreview={cn.creditNoteNumber}
        mode="edit"
        documentId={cnId}
        initial={{
          sourceInvoiceId: String(cn.sourceInvoiceId),
          issueDate: cn.issueDate,
          reason: cn.reason ?? "",
          items: initialItems,
        }}
      />
    </div>
  );
}
