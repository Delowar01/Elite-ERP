import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getColumnConfig } from "@/lib/column-config-server";
import { db, customersTable, productsTable, orgsTable, projectsTable, salesInvoicesTable, salesInvoiceItemsTable, paymentTermPresetsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { canEditDocument } from "@/lib/document-edit";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
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
  // Server-side authorization for a direct edit URL: the SAME shared rule the list menu and
  // the Preview Edit action use — draft-only, and never a record sitting in the Recycle Bin.
  if (!canEditDocument("sales_invoice", { status: inv.status, recordState: inv.deletedAt ? "deleted" : inv.archivedAt ? "archived" : "active" }))
    redirect(`/sales/invoices/${invId}`);

  const [items, customers, products, [org], projects, bankData, paymentTerms] = await Promise.all([
    db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
    getDocumentBankData(session.orgId),
    db.select({ id: paymentTermPresetsTable.id, name: paymentTermPresetsTable.name, netDays: paymentTermPresetsTable.netDays })
      .from(paymentTermPresetsTable).where(eq(paymentTermPresetsTable.orgId, session.orgId)).orderBy(asc(paymentTermPresetsTable.netDays)),
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
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        paymentTerms={paymentTerms}
        initial={{
          title: inv.title ?? "",
          customerId: String(inv.customerId),
          projectId: inv.projectId ? String(inv.projectId) : "",
          issueDate: inv.issueDate,
          dueDate: inv.dueDate ?? "",
          paymentTermId: inv.paymentTermPresetId ? String(inv.paymentTermPresetId) : "",
          discount: inv.discount,
          notes: inv.notes ?? "",
          terms: inv.terms ?? [],
          items: initialItems,
          bankAccountIds: initialSelectedIds(inv.bankAccounts, bankData.bankAccounts),
          currency: inv.currency ?? undefined,
        }}
      />
    </div>
  );
}
