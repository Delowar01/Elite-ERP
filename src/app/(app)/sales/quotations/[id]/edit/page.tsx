import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getColumnConfig } from "@/lib/column-config-server";
import { db, customersTable, productsTable, orgsTable, projectsTable, quotationsTable, quotationItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { canEditDocument } from "@/lib/document-edit";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { QuotationForm } from "../../quotation-form";

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "quotation");
  const locale = await getLocale();
  const quotationId = Number((await params).id);
  if (!Number.isInteger(quotationId)) notFound();

  const [quotation] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, quotationId), eq(quotationsTable.orgId, session.orgId)));
  if (!quotation) notFound();
  // Server-side authorization for a direct edit URL: the SAME shared rule the list menu and
  // the Preview Edit action use — draft-only, and never a record sitting in the Recycle Bin.
  if (!canEditDocument("quotation", { status: quotation.status, recordState: quotation.deletedAt ? "deleted" : quotation.archivedAt ? "archived" : "active" }))
    redirect(`/sales/quotations/${quotationId}`);

  const [items, customers, products, [org], projects, bankData] = await Promise.all([
    db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, quotationId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
    getDocumentBankData(session.orgId),
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
    <div className="max-w-5xl mx-auto">
      <QuotationForm
        locale={locale}
        customers={customers}
        products={products}
        org={org}
        numberPreview={quotation.quotationNumber}
        projects={projects}
        mode="edit"
        columnConfig={columnConfig}
        documentId={quotationId}
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        defaultValidityDays={org.defaultValidityDays}
        initial={{
          title: quotation.title ?? "",
          customerId: String(quotation.customerId),
          projectId: quotation.projectId ? String(quotation.projectId) : "",
          issueDate: quotation.issueDate,
          validUntil: quotation.validUntil ?? "",
          discount: quotation.discount,
          notes: quotation.notes ?? "",
          terms: quotation.terms ?? [],
          items: initialItems,
          bankAccountIds: initialSelectedIds(quotation.bankAccounts, bankData.bankAccounts),
          currency: quotation.currency ?? undefined,
        }}
      />
    </div>
  );
}
