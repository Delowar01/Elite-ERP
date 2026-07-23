import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getColumnConfig } from "@/lib/column-config-server";
import { db, customersTable, productsTable, orgsTable, projectsTable, salesInvoicesTable, salesInvoiceItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { can } from "@/lib/document-lifecycle";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { InvoiceForm } from "../../invoice-form";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "sales_invoice");
  const locale = await getLocale();
  const invId = Number((await params).id);
  if (!Number.isInteger(invId)) notFound();

  const [inv] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, invId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!inv) notFound();
  if (!can("sales_invoice", inv.status, "edit")) redirect(`/sales/invoices/${invId}`);

  const [items, customers, products, [org], projects] = await Promise.all([
    db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
  ]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    taxRatePercent: it.taxRatePercent,
    imageUrl: it.imageUrl ?? "",
    unit: it.unit ?? "",
    customFields: (it.customFields as Record<string, string>) ?? {},
  }));

  return (
    <div className="max-w-6xl mx-auto">
      <InvoiceForm
        locale={locale}
        customers={customers}
        products={products}
        org={org}
        numberPreview={inv.invoiceNumber}
        projects={projects}
        mode="edit"
        columnConfig={columnConfig}
        documentId={invId}
        initial={{
          title: inv.title ?? "",
          customerId: String(inv.customerId),
          projectId: inv.projectId ? String(inv.projectId) : "",
          issueDate: inv.issueDate,
          dueDate: inv.dueDate ?? "",
          discount: inv.discount,
          notes: inv.notes ?? "",
          items: initialItems,
        }}
      />
    </div>
  );
}
